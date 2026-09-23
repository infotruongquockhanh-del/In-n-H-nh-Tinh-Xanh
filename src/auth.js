import { within } from './database-errors.js';
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { db, adminAuth } from './firebase-admin.js';
import { SESSION_COOKIE } from './constants.js';
import { ACCESS_POLICY_VERSION, approved, publicUser, legacyHash, hashPassword, verifyPassword, validSessionClaims, fail } from './access-policy.js';

const configured = process.env.SESSION_SECRET;
const unsafeDefault = 'HTX_DEV_ONLY_CHANGE_THIS_SESSION_SECRET_2026';
const secretText = configured && configured.length >= 32 && configured !== unsafeDefault ? configured : randomBytes(48).toString('hex');
const secret = new TextEncoder().encode(secretText);
if (secretText !== configured) console.warn('[SECURITY] Cần SESSION_SECRET riêng (ít nhất 32 ký tự) để giữ phiên qua các lần khởi động. Đang dùng khóa ngẫu nhiên tạm thời; không dùng khóa mặc định cũ.');

// Compatibility export used by older callers; new passwords use scrypt.
export const passwordHash = (username, password) => hashPassword(password);
export const sanitizeUser = publicUser;
export function simpleHash(text) {
  let h = 2166136261;
  for (const ch of String(text ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export async function loginUser(username, password) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname || uname.length > 64 || typeof password !== 'string' || password.length > 128) return null;
  const query = db.collection('users').where('username', '==', uname).limit(2);
  return db.runTransaction(async tx => {
    const snap = await tx.get(query);
    if (snap.size !== 1) return null;
    const doc = snap.docs[0];
    const user = { ...doc.data(), id: doc.data().id ?? doc.id };
    if (!approved(user) || !verifyPassword(uname, password, user.passwordHash)) return null;
    const changes = {};
    if (password.length < 8 || password === '123456') changes.mustChangePassword = true;
    else if (!String(user.passwordHash).startsWith('scrypt$')) changes.passwordHash = hashPassword(password);
    if (Object.keys(changes).length) tx.set(db.collection('users').doc(doc.id), changes, { merge: true });
    return { ...user, ...changes };
  });
}
export async function signSession(user) {
  if (!approved(user)) throw fail('Tài khoản chưa được cấp quyền truy cập.', 403);
  return new SignJWT({ uid: String(user.id), sv: Number(user.authVersion || 0), policy: ACCESS_POLICY_VERSION })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('htx-server').setAudience('htx-web')
    .setIssuedAt().setExpirationTime('12h').sign(secret);
}
function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production' || !!req?.secure || req?.headers?.['x-forwarded-proto'] === 'https' };
}
export async function setSessionCookie(res, user, req = null) {
  const token = await signSession(user);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: 12 * 60 * 60 * 1000 });
  // Never return a session bearer token to browser JavaScript.
}
export function clearSessionCookie(res, req = null) { res.clearCookie(SESSION_COOKIE, cookieOptions(req)); }
export async function getSessionUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], issuer: 'htx-server', audience: 'htx-web' }));
  } catch { return null; }
  const uid = String(payload.uid || '');
  if (!uid || uid.includes('/')) return null;
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return null;
  const user = { ...doc.data(), id: doc.data().id ?? doc.id };
  return validSessionClaims(payload, user) ? user : null;
}
export async function requireSession(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.', code: 'LOGIN_REQUIRED' });
    req.user = user;
    if (user.mustChangePassword && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(req.path))
      return res.status(403).json({ error: 'Vui lòng đổi mật khẩu trước khi sử dụng phần mềm.', code: 'PASSWORD_CHANGE_REQUIRED' });
    next();
  } catch (err) { next(err); }
}
export function requireDirector(req, res, next) {
  if (req.user?.role !== 'director') return res.status(403).json({ error: 'Chỉ Giám đốc có quyền thực hiện thao tác này.' });
  next();
}
export async function revokeSessions(user) {
  if (!user) return;
  const ref = db.collection('users').doc(String(user.id));
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (doc.exists) tx.set(ref, { authVersion: Number(doc.data().authVersion || 0) + 1 }, { merge: true });
  });
  try { await adminAuth.revokeRefreshTokens?.(String(user.id)); } catch (err) { console.warn('[Auth] Firebase revoke:', err.code || 'unavailable'); }
}
export async function changeOwnPassword(user, currentPassword, newPassword) {
  const passwordHash = hashPassword(newPassword);
  const ref = db.collection('users').doc(String(user.id));
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || !approved(doc.data()) || Number(doc.data().authVersion || 0) !== Number(user.authVersion || 0)) throw fail('Vui lòng đăng nhập lại.', 401);
    const old = doc.data();
    if (!verifyPassword(old.username, currentPassword, old.passwordHash)) throw fail('Mật khẩu hiện tại không đúng.', 400);
    if (newPassword === currentPassword) throw fail('Mật khẩu mới phải khác mật khẩu hiện tại.');
    const next = { ...old, passwordHash, mustChangePassword: false, authVersion: Number(old.authVersion || 0) + 1, updatedAt: new Date().toISOString() };
    tx.set(ref, next);
    return next;
  });
}
export async function createRealtimeToken(user) {
  if (!approved(user) || user.mustChangePassword) return null;
  try {
    return await within(adminAuth.createCustomToken(String(user.id), {
      username: String(user.username || ''), role: user.role,
      policy: ACCESS_POLICY_VERSION, sv: Number(user.authVersion || 0)
    }),4000);
  } catch (err) { console.warn('[Auth] Realtime token:', err.code || 'unavailable'); return null; }
}
// Old Firebase sessions must never bypass an explicit password login.
export async function restoreUserFromFirebaseIdToken() { return null; }
