'use strict';
const $ = id => document.getElementById(id);
// Old browser cache is never an authentication source. Server data is not deleted.
try { for (const store of [localStorage, sessionStorage]) {
  for (const key of ['htx_cached_user','htx_session_token','htx_session_v6']) store.removeItem(key);
} } catch { /* Storage can be blocked; server-side login must still work. */ }
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.map(reg => reg.unregister()))).catch(() => {});
if (window.caches) caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(() => {});
async function request(url, body) {
  const res = await fetch(url, { signal:AbortSignal.timeout(25000), method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error || 'Không thể xử lý yêu cầu. Vui lòng thử lại.') + (data.code ? ' ['+data.code+']' : '') + (data.requestId ? ' Mã hỗ trợ: '+data.requestId : ''));
  return data;
}
function showChangePassword() {
  $('loginForm').hidden = true; $('passwordForm').hidden = false;
  $('authTitle').textContent = 'Đổi mật khẩu';
  $('authDesc').textContent = 'Vui lòng đặt mật khẩu riêng có ít nhất 8 ký tự trước khi sử dụng phần mềm.';
  $('authMsg').textContent = '';
  $('currentPassword').focus();
}
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('loginBtn').disabled = true; $('authMsg').textContent = 'Đang xác thực…';
  try {
    const data = await request('/api/auth/login', { username: $('loginUsername').value.trim(), password: $('loginPassword').value });
    $('loginPassword').value = '';
    if (data.user?.mustChangePassword) showChangePassword();
    else location.replace('/app.html#orders');
  } catch (err) { $('authMsg').textContent = err.message || 'Không kết nối được máy chủ.'; }
  finally { $('loginBtn').disabled = false; }
});
$('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('newPassword').value !== $('confirmPassword').value) { $('authMsg').textContent = 'Hai mật khẩu mới chưa trùng nhau.'; return; }
  $('changeBtn').disabled = true;
  try {
    await request('/api/auth/change-password', { currentPassword: $('currentPassword').value, newPassword: $('newPassword').value });
    $('passwordForm').reset(); location.replace('/app.html#orders');
  } catch (err) { $('authMsg').textContent = err.message || 'Không kết nối được máy chủ.'; }
  finally { $('changeBtn').disabled = false; }
});
$('cancelChangeBtn').addEventListener('click', async () => {
  try { await request('/api/auth/logout', {}); } finally { location.replace('/'); }
});
if (new URLSearchParams(location.search).get('change') === '1') {
  fetch('/api/auth/me?light=1', { credentials: 'same-origin', cache: 'no-store' }).then(async res => {
    const data = await res.json();
    if (res.ok && data.user?.mustChangePassword) showChangePassword();
  }).catch(() => {});
}
