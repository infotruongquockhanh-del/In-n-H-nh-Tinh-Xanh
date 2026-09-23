// skip-v30
if(Number(JSON.parse((await import('node:fs')).readFileSync('package.json','utf8')).version.split('.')[0])>=30){console.log('V30: historical migration skipped');process.exit(0);}
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const write = (path, value) => fs.writeFileSync(new URL(path, root), value);
function replaceOnce(source, from, to) {
  if (!source.includes(from)) throw new Error('Missing migration anchor: ' + from.slice(0, 90));
  return source.replace(from, to);
}
function between(source, from, until, replacement) {
  const start = source.indexOf(from), end = source.indexOf(until, start + from.length);
  if (start < 0 || end < 0) throw new Error('Missing migration section: ' + from);
  return source.slice(0, start) + replacement + source.slice(end);
}
let server = read('server.js');
if (!server.includes('// HTX_AUTH_V28')) {
  server = "// HTX_AUTH_V28\nimport accessRoutes from './src/access-routes.js';\n" + server;
  server = replaceOnce(server, 'const port = 3000;', "const port = Number(process.env.PORT || 3000);\napp.set('trust proxy', 1);");
  server = replaceOnce(server, 'app.use(cookieParser());', 'app.use(cookieParser());\napp.use(accessRoutes);');
  server = between(server, 'app.post("/api/auth/temporary"', 'app.get("/api/database-status"', '');
  server = between(server, 'app.post("/api/auth/logout"', 'app.get("/api/state"', '');
  server = between(server, 'app.get("/api/health"', 'app.get("/api/firebase-config"', `app.get('/api/health', async (req, res) => {\n  const database = await verifyFirebaseConnection();\n  res.setHeader('Cache-Control','no-store');\n  res.status(database.connected ? 200 : 503).json({ok:database.connected,version:'28.0.0',authentication:'required'});\n});\n\n`);
  server = replaceOnce(server, 'app.use(express.static', `app.use('/api', (req, res) => res.status(404).json({error:'API không tồn tại.'}));\napp.use((req, res, next) => {\n  let decoded;\n  try { decoded = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }\n  if (/\\.html(?:\\/|$)/i.test(decoded)) return res.sendStatus(404);\n  next();\n});\napp.use(express.static`);
  server = between(server, 'app.get(["/", "/index.html", "/app.html"]', 'app.use((err,req,res,next)', '');
  write('server.js', server);
}
let store = read('src/state-store.js');
if (!store.includes('// HTX_AUTH_V28')) {
  store = "// HTX_AUTH_V28\nimport { publicUser, approved, canRead, fail } from './access-policy.js';\nimport { ensureDirectorBootstrap } from './bootstrap-auth.js';\n" + store;
  store = replaceOnce(store, '  delete copy.updatedBy;', '  delete copy.updatedBy;\n  delete copy.version;');
  store = between(store, 'async function readCollection(', 'async function writeCollection(', `async function readCollection(key, collection, user) {\n  const snap = await db.collection(collection).get();\n  let rows = snap.docs.map(doc => ({...doc.data(), id:doc.data().id ?? doc.id}));\n  if (key === 'htx_users_v6') {\n    if (user.role !== 'director') rows = rows.filter(approved);\n    return rows.map(publicUser);\n  }\n  if (!canRead(user.role, key)) return null;\n  if (key === 'htx_auto_quotes_v5') rows.sort((a,b)=>Number(b.id||0)-Number(a.id||0));\n  return rows.map(cleanDocData);\n}\n\n`);
  store = replaceOnce(store, 'async function writeCollection(key,collection,value,user){', `async function writeCollection(key,collection,value,user){\n  if (key === 'htx_users_v6') throw fail('Tài khoản chỉ được quản lý qua API tài khoản của Giám đốc.',403);`);
  store = replaceOnce(store, 'export async function readStateKey(key,user={role:"director"}){', `export async function readStateKey(key,user={role:"director"}){\n  if (key !== 'htx_users_v6' && !canRead(user.role,key)) return null;`);
  store = replaceOnce(store, 'await Promise.all(SYNC_KEYS.map(async key=>{', `await Promise.all(SYNC_KEYS.map(async key=>{\n    if (key !== 'htx_users_v6' && !canRead(user.role,key)) { state[key]=null; return; }`);
  store = replaceOnce(store, 'export async function ensureBootstrap(){', 'export async function ensureBootstrap(){\n  await ensureDirectorBootstrap();');
  store = between(store, '  const userId="202609190001";', '  await db.collection("config").doc("company")', '');
  store = replaceOnce(store, '["designer","printing"].includes(user.role) && current)', '["designer","printing"].includes(user.role))');
  write('src/state-store.js', store);
}
let html = read('public/app.html');
if (!html.includes('<!-- HTX_AUTH_V28 -->')) {
  html = between(html, '/* V27.4 HARD DISABLE LOGIN */', '</head>', `#erpShell.auth-locked{display:none!important}\n#authGate.hidden{display:none!important}\n</style>\n`);
  html = replaceOnce(html, '<script>window.__HTX_NO_LOGIN__=true;</script>', `<script>\nfor(const key of Object.keys(localStorage)){if(key.startsWith('htx_'))localStorage.removeItem(key)}\n</script>`);
  const gateStart = html.indexOf('<div class="auth-gate hidden"');
  const shellStart = html.indexOf('<div class="erp-shell" id="erpShell">', gateStart);
  if (gateStart < 0 || shellStart < 0) throw new Error('Login markup not found');
  html = html.slice(0, gateStart) + '<div class="auth-gate" id="authGate"><div class="auth-box"><h1>HÀNH TINH XANH</h1><p>Đang kiểm tra phiên đăng nhập…</p></div></div>\n' + html.slice(shellStart);
  html = replaceOnce(html, '<div class="erp-shell" id="erpShell">', '<div class="erp-shell auth-locked" id="erpShell">');
  html = between(html, 'function ensureDefaultDirector(){', 'function roleLabel(', '');
  html = between(html, 'function showLogin(){', 'async function getDatabaseHealth(){', `function showLogin(){\n  lockApplication();\n  clearPrivateCache();\n  currentUser=null;\n  try{window.HTXRealtime?.stopListeners?.()}catch{}\n  location.replace('/');\n}\n\n`);
  html = between(html, 'async function login(){', 'function applyPermissions(){', read('scripts/fragments/session-ui.js') + '\n');
  html = between(html, 'function createAccount(){', 'function openPriceAdjust(', read('scripts/fragments/accounts-ui.js') + '\n');
  html = between(html, 'async function backendTemporarySession(){', 'async function backendLogin(', '');
  html = between(html, 'function localLoginFallback(', 'function ensureAppScrollUnlocked(', '');
  html = replaceOnce(html, '$("logoutBtn").style.display="none";', '$("logoutBtn").style.display="";');
  for (const line of [
    '  $("loginBtn").addEventListener("click",login);',
    '  $("showCreateFirstBtn").addEventListener("click",showFirstAccountForm);',
    '  $("createFirstBtn").addEventListener("click",createFirstAccount);',
    '  $("backLoginBtn").addEventListener("click",showLogin);',
    '  $("loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter")login()});',
    '  ensureDefaultDirector();',
    '  $("loginUsername").value="giamdoc";'
  ]) html = replaceOnce(html, line, '');
  html = html.replaceAll('this===localStorage && !window.__HTXRealtimeHydrating', 'this===localStorage && cloudSyncReady && !cloudHydrating && currentUser && !window.__HTXRealtimeHydrating');
  html = replaceOnce(html, 'function scheduleCollectionDelta(key,oldRaw,newRaw){', 'function scheduleCollectionDelta(key,oldRaw,newRaw){\n  if(!cloudSyncReady || cloudHydrating || !currentUser)return;');
  html = replaceOnce(html, 'async function retryPendingRealtimeWrites(){', 'async function retryPendingRealtimeWrites(){\n  if(!cloudSyncReady || !currentUser)return;');
  html = replaceOnce(html, 'if(!(key in payload.state))continue;', 'if(!(key in payload.state)){__nativeRemoveItem.call(localStorage,key);continue;}');
  html = replaceOnce(html, '    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);', `    if(res.status===401){showLogin();return false;}\n    if(res.status===403){showToast(data.error||'Bạn không có quyền thực hiện thao tác này.');return false;}\n    if(!res.ok)throw new Error(data.error||\`HTTP \${res.status}\`);`);
  html = replaceOnce(html, '      setCloudStatus("Cloud: hết phiên","offline");', '      setCloudStatus("Cloud: hết phiên","offline");\n      showLogin();');
  html = html.replaceAll('Tối thiểu 4 ký tự', 'Tối thiểu 8 ký tự');
  html = html.replaceAll('V27.4', 'V28.0').replaceAll('realtime.js?v=27.4','realtime.js?v=28.0');
  html = '<!-- HTX_AUTH_V28 -->\n' + html;
  write('public/app.html', html);
}
write('public/index.html', read('public/login.html'));
for (const forbidden of ['__HTX_NO_LOGIN__', '/api/auth/temporary', 'fallbackUser', 'localLoginFallback', 'ensureDefaultDirector', 'createFirstAccount', 'has-cached-session .auth-gate']) {
  if (html.includes(forbidden)) throw new Error('Unsafe legacy UI remains: ' + forbidden);
}
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=/.test(match[1]) || /type=["'](?:module|application\/)/.test(match[1])) continue;
  new vm.Script(match[2], { filename: 'public/app.html inline script' });
}
console.log('HTX V28 migration: source patched and inline JavaScript syntax verified.');
