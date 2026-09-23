import { db } from './firebase-admin.js';
import { hashPassword, normalizeUsername, fail } from './access-policy.js';

// Do not reset an existing director password or recreate demo staff.
export async function ensureDirectorBootstrap() {
  const password = process.env.BOOTSTRAP_DIRECTOR_PASSWORD;
  return db.runTransaction(async tx => {
    const snap = await tx.get(db.collection('users'));
    const directors = snap.docs.filter(d => d.data().role === 'director');
    if (directors.length) return { created: false };
    if (!password) throw fail('Chưa có tài khoản Giám đốc. Quản trị viên cần cấu hình BOOTSTRAP_DIRECTOR_PASSWORD (ít nhất 8 ký tự) trên máy chủ; không có đăng ký công khai.', 503);
    const username = normalizeUsername(process.env.BOOTSTRAP_DIRECTOR_USERNAME || 'giamdoc');
    if (snap.docs.some(d => d.data().username === username)) throw fail('Tên tài khoản Giám đốc khởi tạo đã tồn tại. Không ghi đè tài khoản hiện có.', 503);
    const id = 202609190001;
    if (snap.docs.some(d => d.id === String(id))) throw fail('Mã tài khoản Giám đốc khởi tạo đã tồn tại. Không ghi đè dữ liệu.', 503);
    tx.set(db.collection('users').doc(String(id)), {
      id, username, name: 'Giám đốc', role: 'director', active: true,
      passwordHash: hashPassword(password), authVersion: 1,
      accessApproved: true, provisionedByDirectorId: 'server-bootstrap',
      mustChangePassword: true, createdAt: new Date().toISOString()
    });
    return { created: true };
  });
}
