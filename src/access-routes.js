import { verifyFirebaseConnection } from './firebase-admin.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginUser, setSessionCookie, clearSessionCookie, requireSession, requireDirector, sanitizeUser, createRealtimeToken, getSessionUser, revokeSessions, changeOwnPassword } from './auth.js';
import { listAccounts, saveAccount, removeAccount } from './accounts.js';

const router = express.Router();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const publicAppFile = path.join(publicDir, 'app.html');
function publicNoLoginAppHtml() {
  let html = fs.readFileSync(publicAppFile, 'utf8');
  html = html.replace('</head>', '<style>#logoutBtn{display:none!important}</style><script>window.__HTX_PUBLIC_NO_LOGIN__=true;</script></head>');
  html = html.replace('function showLogin(){', 'function showLogin(){if(window.__HTX_PUBLIC_NO_LOGIN__){setCloudStatus("Database chưa kết nối","offline");return;}');
  html = html.replace('async function restoreSession() {', 'async function restoreSession() {if(window.__HTX_PUBLIC_NO_LOGIN__){currentUser={id:"public-director",name:"Giám đốc",username:"giamdoc",role:"director",active:true,loginAllowed:true,mustChangePassword:false};enterApp();setCloudStatus("Database chưa kết nối","offline");return;}');
  return html;
}
const attempts = new Map();
const windowMs = 15 * 60 * 1000;
function takeAttempt(req, res, next) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const name = String(req.body?.username || '').trim().toLowerCase().slice(0, 64);
  const keys = [[`ip:${ip}`, 300], [`account:${ip}:${name}`, 20]];
  if (attempts.size > 10000) return res.status(429).json({ error: 'Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau.' });
  for (const [key, limit] of keys) {
    const entry = attempts.get(key) || { count: 0, until: now + windowMs };
    if (entry.count >= limit) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((entry.until - now) / 1000)));
      return res.status(429).json({ error: 'Đã thử đăng nhập quá nhiều lần. Vui lòng chờ 15 phút.' });
    }
    entry.count++;
    attempts.set(key, entry);
  }
  req.attemptKey = keys[1][0];
  next();
}
// Browser requests that modify state must originate from this application.
router.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (!req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Yêu cầu khác nguồn không được chấp nhận.' });
  const origin = req.get('origin');
  if (origin) {
    const hosts = [req.get('host'), String(req.get('x-forwarded-host') || '').split(',')[0].trim()].filter(Boolean);
    try {
      if (!hosts.includes(new URL(origin).host) && origin !== process.env.APP_ORIGIN)
        return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    } catch { return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' }); }
  }
  if (!req.is('application/json')) return res.status(415).json({ error: 'Yêu cầu phải dùng application/json.' });
  next();
});
router.post(['/api/auth/temporary', '/api/auth/restore'], (req, res) => {
  res.status(410).json({ error: 'Đăng nhập tạm và khôi phục không cần mật khẩu đã bị tắt. Vui lòng đăng nhập.', code: 'LOGIN_REQUIRED' });
});
// Do not consume password-attempt quota when the database itself is unavailable.
router.post('/api/auth/login', async (req,res,next)=>{
  if(typeof req.body?.username!=='string'||typeof req.body?.password!=='string'||!req.body.username.trim()||!req.body.password)
    return res.status(400).json({error:'Vui lòng nhập tài khoản và mật khẩu.'});
  try {
    const health=await verifyFirebaseConnection();
    if(!health.connected)return res.status(503).json({error:health.error,code:health.code,requestId:req.requestId});
    next();
  } catch(err){next(err);}
}, takeAttempt, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password)
      return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu.' });
    const user = await loginUser(username, password);
    if (!user) return res.status(401).json({ error: 'Thông tin đăng nhập không đúng, tài khoản bị khóa hoặc chưa được Giám đốc cấp quyền.' });
    attempts.delete(req.attemptKey);
    await setSessionCookie(res, user, req);
    res.json({ ok: true, user: sanitizeUser(user), firebaseToken: await createRealtimeToken(user) });
  } catch (err) { next(err); }
});
router.get('/api/auth/me', requireSession, async (req, res, next) => {
  try { res.json({ ok: true, user: sanitizeUser(req.user), ...(req.query.light ? {} : { firebaseToken: await createRealtimeToken(req.user) }) }); }
  catch (err) { next(err); }
});
router.post('/api/auth/change-password', requireSession, async (req, res, next) => {
  try {
    const user = await changeOwnPassword(req.user, req.body?.currentPassword, req.body?.newPassword);
    await setSessionCookie(res, user, req);
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) { next(err); }
});
router.post('/api/auth/logout', async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (user) await revokeSessions(user);
    clearSessionCookie(res, req);
    res.json({ ok: true });
  } catch (err) { clearSessionCookie(res, req); next(err); }
});
// All remaining APIs are private, including Firebase configuration and diagnostics.
router.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/health') return requireSession(req, res, next);
  next();
});
router.use('/api/database-status', requireDirector);
router.get('/api/admin/users', requireDirector, async (req, res, next) => {
  try { res.json({ users: await listAccounts(req.user) }); } catch (err) { next(err); }
});
router.post('/api/admin/users', requireDirector, async (req, res, next) => {
  try { const user = await saveAccount(req.user, req.body); res.status(201).json({ ok: true, user: sanitizeUser(user) }); } catch (err) { next(err); }
});
router.patch('/api/admin/users/:id', requireDirector, async (req, res, next) => {
  try {
    const user = await saveAccount(req.user, req.body, req.params.id);
    if (String(user.id) === String(req.user.id)) await setSessionCookie(res, user, req);
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) { next(err); }
});
router.delete('/api/admin/users/:id', requireDirector, async (req, res, next) => {
  try { await removeAccount(req.user, req.params.id); res.json({ ok: true }); } catch (err) { next(err); }
});
router.get(['/', '/index.html', '/login', '/login.html', '/app', '/app.html'], (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(publicNoLoginAppHtml());
  } catch (err) { next(err); }
});
export default router;
