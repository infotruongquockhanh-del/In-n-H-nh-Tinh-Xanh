async function accountRequest(method, id, body = {}) {
  if (currentUser?.role !== 'director') throw new Error('Chỉ Giám đốc được quản lý tài khoản.');
  const response = await fetch('/api/admin/users' + (id === null ? '' : '/' + encodeURIComponent(id)), {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { showLogin(); throw new Error('Vui lòng đăng nhập lại.'); }
  if (!response.ok) throw new Error(data.error || 'Không lưu được tài khoản.');
  await hydrateFromBackend();
  renderAccounts(); refreshDesignerControls(); renderHistory();
  return data;
}
async function createAccount() {
  if (currentUser?.role !== 'director') { showToast('Chỉ Giám đốc được tạo tài khoản.'); return; }
  const input = { name: $('newAccountName').value.trim(), username: $('newAccountUsername').value.trim().toLowerCase(), password: $('newAccountPassword').value, role: $('newAccountRole').value };
  if (!input.name || input.username.length < 3 || input.password.length < 8) {
    showToast('Nhập họ tên, tên đăng nhập ít nhất 3 ký tự và mật khẩu ít nhất 8 ký tự.'); return;
  }
  $('createAccountBtn').disabled = true;
  try {
    await accountRequest('POST', null, input);
    $('newAccountName').value = ''; $('newAccountUsername').value = ''; $('newAccountPassword').value = '';
    showToast('Đã lưu tài khoản và phân quyền trên máy chủ.');
  } catch (err) { alert(err.message); }
  finally { $('createAccountBtn').disabled = false; }
}
function renderAccounts() {
  const body = $('accountsBody');
  if (!body) return;
  if (currentUser?.role !== 'director') {
    body.innerHTML = '<tr><td colspan="5">Chỉ Giám đốc được quản lý tài khoản.</td></tr>'; return;
  }
  body.innerHTML = getUsers().map(user => {
    const own = String(user.id) === String(currentUser.id);
    const status = user.loginAllowed ? 'Đang hoạt động' : user.active === false ? 'Đang khóa' : 'Chờ Giám đốc cấp quyền';
    const button = (action, label) => `<button class="ghost-btn" type="button" data-user-action="${action}" data-user-id="${esc(user.id)}">${label}</button>`;
    return `<tr><td><b>${esc(user.name || '')}</b>${own ? '<div class="muted">Tài khoản đang đăng nhập</div>' : ''}</td><td>${esc(user.username)}</td><td><span class="role-badge">${esc(roleLabel(user.role))}</span></td><td>${status}</td><td><div class="account-actions">${button('password','Đổi mật khẩu')}${own ? '' : button('role','Phân quyền') + button('toggle', user.loginAllowed ? 'Khóa' : 'Cấp quyền / Mở khóa') + button('delete','Xóa')}</div></td></tr>`;
  }).join('');
}
async function handleAccountAction(event) {
  const button = event.target.closest('[data-user-action]');
  if (!button || currentUser?.role !== 'director') return;
  button.disabled = true;
  try {
    const id = button.dataset.userId;
    if (button.dataset.userAction === 'password') await resetUserPassword(id);
    else if (button.dataset.userAction === 'toggle') await toggleUserActive(id);
    else if (button.dataset.userAction === 'delete') await deleteUser(id);
    else if (button.dataset.userAction === 'role') {
      const user = getUsers().find(item => String(item.id) === String(id));
      if (!user) return;
      const role = prompt('Nhập mã phân quyền: director (Giám đốc), accounting (Kế toán), sales (Kinh doanh), designer (Thiết kế), printing (In ấn):', user.role);
      if (role === null) return;
      if (!['director','accounting','sales','designer','printing'].includes(role.trim())) throw new Error('Phân quyền không hợp lệ.');
      await accountRequest('PATCH', id, { role: role.trim() });
      showToast('Đã cập nhật phân quyền. Nhân viên cần đăng nhập lại.');
    }
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; }
}
async function resetUserPassword(id) {
  const user = getUsers().find(item => String(item.id) === String(id));
  if (!user || currentUser?.role !== 'director') return;
  const password = prompt(`Nhập mật khẩu mới cho ${user.name || user.username} (ít nhất 8 ký tự):`);
  if (password === null) return;
  await accountRequest('PATCH', id, { password });
  showToast('Đã đổi mật khẩu trên máy chủ.');
}
async function toggleUserActive(id) {
  const user = getUsers().find(item => String(item.id) === String(id));
  if (!user || currentUser?.role !== 'director') return;
  const input = { active: !user.loginAllowed };
  if (!user.loginAllowed) {
    const password = prompt(`Đặt mật khẩu mới cho ${user.name || user.username} trước khi cấp lại quyền (ít nhất 8 ký tự):`);
    if (password === null) return;
    input.password = password;
  }
  await accountRequest('PATCH', id, input);
  showToast(input.active ? 'Đã cấp quyền đăng nhập.' : 'Đã khóa tài khoản và vô hiệu hóa phiên cũ.');
}
async function deleteUser(id) {
  if (currentUser?.role !== 'director') return;
  const user = getUsers().find(item => String(item.id) === String(id));
  if (!user || !confirm(`Xóa tài khoản ${user.username}?`)) return;
  await accountRequest('DELETE', id);
  showToast('Đã xóa tài khoản trên máy chủ.');
}
