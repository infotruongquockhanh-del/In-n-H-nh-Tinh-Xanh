let sessionCheckTimer = null;
function clearPrivateCache() {
  cloudSyncReady = false;
  for (const timer of cloudSyncTimers.values()) clearTimeout(timer);
  for (const timer of realtimeDeltaTimers.values()) clearTimeout(timer);
  cloudSyncTimers.clear(); realtimeDeltaTimers.clear(); realtimeDeltaPending.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('htx_')) __nativeRemoveItem.call(localStorage, key);
  }
}
function lockApplication() {
  cloudSyncReady = false;
  document.documentElement.classList.remove('has-cached-session');
  $('erpShell')?.classList.add('auth-locked');
  $('authGate')?.classList.remove('hidden');
  if ($('erpShell')) $('erpShell').style.display = 'none';
  if ($('authGate')) $('authGate').style.display = 'grid';
}
async function login() { location.replace('/'); }
async function restoreSession() {
  lockApplication();
  clearPrivateCache();
  currentUser = null;
  try {
    const data = await backendMe();
    if (!data?.user?.loginAllowed) { showLogin(); return; }
    if (data.user.mustChangePassword) { location.replace('/?change=1'); return; }
    currentUser = data.user;
    await hydrateFromBackend();
    __nativeSetItem.call(localStorage, SESSION_KEY, String(currentUser.id));
    enterApp();
    if (data.firebaseToken) void startRealtime(data.firebaseToken, currentUser);
    if (sessionCheckTimer) clearInterval(sessionCheckTimer);
    sessionCheckTimer = setInterval(checkActiveSession, 30000);
  } catch (err) {
    console.warn('Session verification failed:', err.message);
    showLogin();
  }
}
async function checkActiveSession() {
  if (!currentUser) return;
  try {
    const response = await fetch('/api/auth/me?light=1', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.user?.loginAllowed) { showLogin(); return; }
    if (data.user.mustChangePassword) { location.replace('/?change=1'); return; }
    if (currentUser.role !== data.user.role) {
      currentUser = data.user;
      await hydrateFromBackend();
      enterApp();
    }
  } catch { setCloudStatus('Chưa kiểm tra được phiên — kiểm tra mạng', 'offline'); }
}
window.addEventListener('focus', () => { if (currentUser) void checkActiveSession(); });
window.addEventListener('pageshow', event => { if (event.persisted) void restoreSession(); });
window.addEventListener('storage', event => {
  if (event.key === SESSION_KEY && !event.newValue && currentUser) showLogin();
});
async function logout() {
  lockApplication();
  if (sessionCheckTimer) clearInterval(sessionCheckTimer);
  try { await window.HTXRealtime?.stop?.(); } catch {}
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } finally {
    clearPrivateCache(); currentUser = null; location.replace('/');
  }
}
function enterApp() {
  if (!currentUser?.loginAllowed || currentUser.mustChangePassword) { showLogin(); return; }
  $('authGate')?.classList.add('hidden');
  if ($('authGate')) $('authGate').style.display = 'none';
  $('erpShell')?.classList.remove('auth-locked');
  if ($('erpShell')) $('erpShell').style.removeProperty('display');
  $('currentUserName').textContent = currentUser.name || currentUser.username;
  $('currentUserRole').textContent = roleLabel(currentUser.role);
  $('userAvatar').textContent = (currentUser.name || currentUser.username || 'U').charAt(0).toUpperCase();
  if ($('logoutBtn')) $('logoutBtn').style.display = '';
  applyPermissions();
  refreshDesignerControls();
  renderConfigurator(); renderQuote(); renderHistory(); renderDashboard(); renderWorkMonth();
  renderCustomers(); renderPricebook(); renderInventory(); renderPayroll(); renderAccounts();
  const requested = location.hash.replace(/^#/, '').trim();
  const pages = ['orders','quote','customers','dashboard','pricebook','inventory','payroll','accounts'];
  const page = pages.includes(requested) && hasPagePermission(requested) ? requested : pages.find(hasPagePermission);
  if (!page) { showLogin(); return; }
  navigate(page, true);
}
