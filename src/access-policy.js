import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ACCESS_POLICY_VERSION = 28;
export const ROLES = ['director', 'accounting', 'sales', 'designer', 'printing'];
export const USER_KEY = 'htx_users_v6';
export function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export function approved(user) {
  return !!user && user.active !== false && ROLES.includes(user.role) &&
    (user.role === 'director' ||
      (user.accessApproved === true && !!user.provisionedByDirectorId));
}
export function publicUser(user) {
  if (!user) return null;
  return Object.fromEntries(Object.entries({
    id: user.id, name: user.name, username: user.username, role: user.role,
    active: user.active !== false, loginAllowed: approved(user),
    mustChangePassword: user.mustChangePassword === true,
    createdAt: user.createdAt, updatedAt: user.updatedAt
  }).filter(([, value]) => value !== undefined));
}
export function legacyHash(username, password) {
  const text = `${String(username).toLowerCase()}|HTX|${password}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw fail('Mật khẩu phải có từ 8 đến 128 ký tự.');
}
export function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(username, password, stored) {
  if (typeof password !== 'string' || !password.length || password.length > 128) return false;
  if (typeof stored !== 'string') return false;
  try {
    if (/^[0-9a-f]{8}$/.test(stored)) {
      return timingSafeEqual(Buffer.from(legacyHash(username, password)), Buffer.from(stored));
    }
    if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(stored)) return false;
    const [, salt, expected] = stored.split('$');
    return timingSafeEqual(scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
export function normalizeUsername(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(name))
    throw fail('Tên đăng nhập: 3–64 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  return name;
}
export function validSessionClaims(payload, user) {
  return approved(user) && payload?.policy === ACCESS_POLICY_VERSION &&
    String(payload.uid) === String(user.id) &&
    Number(payload.sv) === Number(user.authVersion || 0);
}
// Read access is independent of write access. Staff never receive password hashes.
export const READ_KEYS = {
  director: ['*'],
  accounting: ['htx_auto_quotes_v5','htx_customer_profiles_v10','htx_inventory_v7','htx_custom_products_v7','htx_payroll_v17','htx_work_month_v7','htx_price_adjustments_v6','htx_catalog_overrides_v7'],
  sales: ['htx_auto_quotes_v5','htx_customer_profiles_v10','htx_inventory_v7','htx_custom_products_v7','htx_work_month_v7','htx_price_adjustments_v6','htx_catalog_overrides_v7'],
  designer: ['htx_auto_quotes_v5','htx_customer_profiles_v10','htx_work_month_v7'],
  printing: ['htx_auto_quotes_v5','htx_customer_profiles_v10','htx_work_month_v7']
};
export function canRead(role, key) {
  const permissions = READ_KEYS[role] || [];
  return permissions.includes('*') || permissions.includes(key);
}
export function requireDirectorRecord(user) {
  if (!approved(user) || user.role !== 'director') throw fail('Chỉ Giám đốc có quyền quản lý tài khoản.', 403);
}
