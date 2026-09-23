import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInWithCustomToken, signOut, setPersistence, inMemoryPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
let app, auth, db;
let unsubscribers = [];
let generation = 0;
const officeRoles = ['director','accounting','sales'];
const maps = [
  { name:'orders', key:'htx_auto_quotes_v5', roles:['director','accounting','sales','designer','printing'] },
  { name:'customers', key:'htx_customer_profiles_v10', roles:['director','accounting','sales','designer','printing'] },
  { name:'inventory', key:'htx_inventory_v7', roles:officeRoles },
  { name:'customProducts', key:'htx_custom_products_v7', roles:officeRoles }
];
const settings = [
  { key:'htx_work_month_v7', roles:['director','accounting','sales','designer','printing'] },
  { key:'htx_price_adjustments_v6', roles:officeRoles },
  { key:'htx_catalog_overrides_v7', roles:officeRoles },
  { key:'htx_payroll_v17', roles:['director','accounting'] }
];
function cache(key, value, expectedGeneration) {
  if (expectedGeneration !== generation) return;
  window.__HTXRealtimeHydrating = true;
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); }
  finally { window.__HTXRealtimeHydrating = false; }
  window.dispatchEvent(new CustomEvent('htx:realtime', { detail:{ key, at:Date.now() } }));
}
function error(err) {
  window.dispatchEvent(new CustomEvent('htx:realtime-error', { detail:{ message:err.message } }));
}
function stopListeners() {
  generation++;
  for (const stop of unsubscribers) { try { stop(); } catch {} }
  unsubscribers = [];
}
async function start(token, user) {
  stopListeners();
  if (!token || !user?.loginAllowed || user.mustChangePassword) return false;
  const expectedGeneration = generation;
  if (!app) {
    const response = await fetch('/api/firebase-config', { credentials:'same-origin', cache:'no-store' });
    const data = await response.json();
    if (!response.ok || !data.config) return false;
    app = initializeApp(data.config);
    auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    db = data.config.firestoreDatabaseId ? getFirestore(app, data.config.firestoreDatabaseId) : getFirestore(app);
  }
  await signInWithCustomToken(auth, token);
  if (expectedGeneration !== generation) { await signOut(auth); return false; }
  for (const item of maps) {
    if (!item.roles.includes(user.role)) continue;
    unsubscribers.push(onSnapshot(collection(db, item.name), snapshot => {
      const rows = snapshot.docs.map(d => d.data());
      if (item.name === 'orders') rows.sort((a,b) => Number(b.id || 0) - Number(a.id || 0));
      cache(item.key, rows, expectedGeneration);
    }, error));
  }
  for (const item of settings) {
    if (!item.roles.includes(user.role)) continue;
    unsubscribers.push(onSnapshot(doc(db, 'settings', item.key), snapshot => {
      cache(item.key, snapshot.exists() ? snapshot.data()?.value ?? null : null, expectedGeneration);
    }, error));
  }
  return true;
}
async function stop() {
  stopListeners();
  if (auth) await signOut(auth);
}
window.HTXRealtime = { start, stop, stopListeners };
window.HTXRealtimeReady = Promise.resolve(window.HTXRealtime);
