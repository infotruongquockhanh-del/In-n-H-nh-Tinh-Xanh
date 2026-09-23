/* Public errors are allow-listed: never disclose SDK messages, credentials or DB identifiers. */
export const DATABASE_ERRORS = Object.freeze({
  DB_PERMISSION_DENIED: 'Máy chủ chưa có quyền truy cập cơ sở dữ liệu. Cần kiểm tra quyền của tài khoản dịch vụ Google.',
  DB_CREDENTIALS_UNAVAILABLE: 'Máy chủ chưa xác thực được với Google. Cần kiểm tra thông tin xác thực của dịch vụ.',
  DB_CONFIG_INVALID: 'Cấu hình kết nối cơ sở dữ liệu không hợp lệ. Không thay thế hoặc khởi tạo dữ liệu mới.',
  DB_TARGET_MISMATCH: 'Các cấu hình đang chỉ tới cơ sở dữ liệu khác nhau. Cần xác nhận đúng nơi lưu dữ liệu cũ.',
  DB_UNSAFE_STORAGE: 'Máy chủ đang cấu hình lưu trữ tạm không an toàn. Cần kết nối đúng cơ sở dữ liệu bền vững.',
  DB_NOT_FOUND: 'Không truy cập được cơ sở dữ liệu đã cấu hình. Kiểm tra đúng project và tên database; không tạo database mới để thay thế.',
  DB_API_DISABLED: 'Dịch vụ cơ sở dữ liệu Google đang bị vô hiệu hóa hoặc chưa được cho phép trong project.',
  DB_QUOTA_EXCEEDED: 'Cơ sở dữ liệu đang vượt hạn mức. Chưa thay đổi dữ liệu; vui lòng kiểm tra hạn mức Google.',
  DB_UNAVAILABLE: 'Kết nối cơ sở dữ liệu đang gián đoạn. Vui lòng thử lại sau ít phút.',
  DB_DEADLINE_EXCEEDED: 'Cơ sở dữ liệu phản hồi quá chậm. Vui lòng thử lại; không cần đổi mật khẩu.',
  DB_PRECONDITION_FAILED: 'Cơ sở dữ liệu chưa đáp ứng yêu cầu truy vấn. Cần xem mã lỗi trong nhật ký máy chủ.'
});
export function databaseError(code, cause) {
  const key = Object.hasOwn(DATABASE_ERRORS, code) ? code : 'DB_CONFIG_INVALID';
  return Object.assign(new Error(DATABASE_ERRORS[key], { cause }), { code: key, status: 503 });
}
export function classifyDatabaseError(error) {
  const own = String(error?.code || '');
  if (Object.hasOwn(DATABASE_ERRORS, own)) return own;
  const text = String(error?.message || '').slice(0, 20000);
  // A disabled API often also has the numeric PERMISSION_DENIED code.
  if (/SERVICE_DISABLED|API has not been used|accessNotConfigured|firestore.*(?:disabled|has not been used)/i.test(text)) return 'DB_API_DISABLED';
  if (/default credentials|metadata.*(?:unavailable|not.*found)|invalid_grant|invalid.*credential|Failed to parse private key|UNAUTHENTICATED/i.test(text) || own === '16' || own === '401' || /invalid-credential/.test(own)) return 'DB_CREDENTIALS_UNAVAILABLE';
  if (own === '7' || own === '403' || /PERMISSION_DENIED|insufficient permissions|permission denied|permission .*denied/i.test(text)) return 'DB_PERMISSION_DENIED';
  if (own === '5' || /(?:database|project).*does not exist|NOT_FOUND/i.test(text)) return 'DB_NOT_FOUND';
  if (own === '8' || /RESOURCE_EXHAUSTED|QUOTA_EXCEEDED/i.test(text)) return 'DB_QUOTA_EXCEEDED';
  if (own === '4' || /DEADLINE_EXCEEDED/i.test(text)) return 'DB_DEADLINE_EXCEEDED';
  if (own === '14' || own === '10' || /UNAVAILABLE|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(text)) return 'DB_UNAVAILABLE';
  if (own === '9' || /FAILED_PRECONDITION/i.test(text)) return 'DB_PRECONDITION_FAILED';
  return null;
}
export function publicDatabaseFailure(error) {
  const code = classifyDatabaseError(error);
  return code ? { code, error: DATABASE_ERRORS[code] } : null;
}
export async function within(promise, ms = 8000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(databaseError('DB_DEADLINE_EXCEEDED')), ms);
    })]);
  } finally { clearTimeout(timer); }
}
// Coalesce probes, cache briefly, and do not start unlimited reads after timeouts.
export function createDatabaseProbe(read, { timeoutMs = 8000, ttlMs = 5000, now = Date.now } = {}) {
  let pending = null, cached = null, timestamp = -Infinity;
  return async function probe() {
    if (cached && now() - timestamp < ttlMs) return cached;
    if (!pending) {
      const current = Promise.resolve().then(read).then(
        () => ({ connected: true, code: 'OK' }),
        error => ({ connected: false, ...(publicDatabaseFailure(error) || { code: 'DB_UNAVAILABLE', error: DATABASE_ERRORS.DB_UNAVAILABLE }) })
      );
      pending = current;
      current.then(value => { cached = value; timestamp = now(); if (pending === current) pending = null; });
    }
    try { return await within(pending, timeoutMs); }
    catch (error) { cached = { connected: false, ...publicDatabaseFailure(error) }; timestamp = now(); return cached; }
  };
}
