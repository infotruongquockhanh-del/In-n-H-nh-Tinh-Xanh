import { randomInt } from 'node:crypto';
import { db } from './firebase-admin.js';
import { ROLES, approved, publicUser, normalizeUsername, hashPassword, requireDirectorRecord, fail } from './access-policy.js';

function details(input, previous = {}) {
  const name = String(input.name ?? previous.name ?? '').trim();
  const role = input.role ?? previous.role;
  if (!name || name.length > 120) throw fail('Họ tên phải có từ 1 đến 120 ký tự.');
  if (!ROLES.includes(role)) throw fail('Phân quyền không hợp lệ.');
  if ('active' in input && typeof input.active !== 'boolean') throw fail('Trạng thái tài khoản không hợp lệ.');
  return { name, role, active: input.active ?? previous.active ?? true };
}
export async function listAccounts(actor) {
  requireDirectorRecord(actor);
  const snap = await db.collection('users').get();
  return snap.docs.map(d => publicUser({ ...d.data(), id: d.data().id ?? d.id }));
}
export async function saveAccount(actor, input, id = null) {
  requireDirectorRecord(actor);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Dữ liệu tài khoản không hợp lệ.');
  if (id !== null && !/^\d{1,16}$/.test(String(id))) throw fail('Mã tài khoản không hợp lệ.');
  const credential = input.password !== undefined ? hashPassword(input.password) : null;
  if (id === null && !credential) throw fail('Vui lòng nhập mật khẩu cho tài khoản mới.');
  const userId = id ?? String(Date.now() * 1000 + randomInt(1000));
  const ref = db.collection('users').doc(String(userId));
  const result = await db.runTransaction(async tx => {
    const all = await tx.get(db.collection('users'));
    const records = all.docs.map(d => ({ ...d.data(), id: d.data().id ?? d.id, _docId: d.id }));
    const currentActor = records.find(u => String(u.id) === String(actor.id));
    requireDirectorRecord(currentActor);
    if (Number(currentActor.authVersion || 0) !== Number(actor.authVersion || 0)) throw fail('Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 401);
    const previous = records.find(u => u._docId === String(userId));
    if (id !== null && !previous) throw fail('Không tìm thấy tài khoản.', 404);
    if (id === null && previous) throw fail('Trùng mã tài khoản. Vui lòng thử lại.', 409);
    const username = id === null ? normalizeUsername(input.username) : previous.username;
    if (id !== null && input.username !== undefined && input.username !== previous.username) throw fail('Không đổi tên đăng nhập của tài khoản đã tạo.');
    if (records.some(u => u._docId !== String(userId) && String(u.username).toLowerCase() === username)) throw fail('Tên đăng nhập đã tồn tại.', 409);
    const next = { ...(previous || {}), ...details(input, previous || {}), id: previous?.id ?? Number(userId), username };
    delete next._docId;
    if (String(userId) === String(actor.id) && (next.role !== 'director' || next.active === false))
      throw fail('Không thể tự khóa hoặc hạ quyền tài khoản Giám đốc đang đăng nhập.', 403);
    if (previous?.role === 'director' && approved(previous) && (next.role !== 'director' || !next.active) &&
        records.filter(u => u._docId !== String(userId) && u.role === 'director' && approved(u)).length === 0)
      throw fail('Phải giữ ít nhất một tài khoản Giám đốc đang hoạt động.', 403);
    next.accessApproved = true;
    next.provisionedByDirectorId = previous?.provisionedByDirectorId || String(actor.id);
    next.provisionedAt = previous?.provisionedAt || new Date().toISOString();
    next.createdAt = previous?.createdAt || new Date().toISOString();
    next.updatedAt = new Date().toISOString();
    next.updatedBy = actor.username;
    if (credential) { next.passwordHash = credential; next.mustChangePassword = false; }
    next.authVersion = Number(previous?.authVersion || 0) + 1;
    tx.set(ref, next);
    return next;
  });
  await db.collection('auditLogs').add({ action: id === null ? 'account_create' : 'account_update', entityId: String(userId), userId: actor.id, username: actor.username, at: new Date().toISOString() });
  return result;
}
export async function removeAccount(actor, id) {
  requireDirectorRecord(actor);
  if (!/^\d{1,16}$/.test(String(id))) throw fail('Mã tài khoản không hợp lệ.');
  if (String(id) === String(actor.id)) throw fail('Không thể xóa tài khoản đang đăng nhập.', 403);
  await db.runTransaction(async tx => {
    const all = await tx.get(db.collection('users'));
    const records = all.docs.map(d => ({ ...d.data(), id: d.data().id ?? d.id, _docId: d.id }));
    const currentActor = records.find(u => String(u.id) === String(actor.id));
    requireDirectorRecord(currentActor);
    if (Number(currentActor.authVersion || 0) !== Number(actor.authVersion || 0)) throw fail('Vui lòng đăng nhập lại.', 401);
    const target = records.find(u => u._docId === String(id));
    if (!target) throw fail('Không tìm thấy tài khoản.', 404);
    if (target.role === 'director' && records.filter(u => u._docId !== String(id) && u.role === 'director' && approved(u)).length === 0)
      throw fail('Phải giữ ít nhất một tài khoản Giám đốc đang hoạt động.', 403);
    tx.delete(db.collection('users').doc(String(id)));
  });
  await db.collection('auditLogs').add({ action: 'account_delete', entityId: String(id), userId: actor.id, username: actor.username, at: new Date().toISOString() });
}
