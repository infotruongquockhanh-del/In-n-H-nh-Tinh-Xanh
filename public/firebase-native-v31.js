import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, inMemoryPersistence, onAuthStateChanged, signOut, createUserWithEmailAndPassword, deleteUser, updatePassword } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, addDoc, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const realFetch = window.fetch.bind(window);
const EXPECTED_PROJECT_ID = 'in-hanh-tinh-xanh-ea08e';
const COLLECTION_KEYS = {
  htx_users_v6: 'users',
  htx_auto_quotes_v5: 'orders',
  htx_customer_profiles_v10: 'customers',
  htx_inventory_v7: 'inventory',
  htx_custom_products_v7: 'customProducts'
};
const SETTINGS_KEYS = new Set(['htx_payroll_v17','htx_work_month_v7','htx_price_adjustments_v6','htx_catalog_overrides_v7']);
const ALL_KEYS = [...Object.keys(COLLECTION_KEYS), ...SETTINGS_KEYS];
let app, auth, db, profile, config;

function cleanEmail(value){ return String(value || '').trim().toLowerCase(); }
function appIdFromEmail(email){
  let h = 2166136261;
  for (const ch of cleanEmail(email)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 202600000000 + (h >>> 0);
}
function safeId(value){ return String(value).replaceAll('/','_'); }
function now(){ return new Date().toISOString(); }
function jsonResponse(status, body){ return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}); }
function appError(message,status=400,code='NATIVE_FIREBASE_ERROR'){ return Object.assign(new Error(message),{status,code}); }
function publicUser(data){
  if(!data) return null;
  return {
    id:data.id, name:data.name || data.username || '', username:data.username || '',
    role:data.role || '', active:data.active !== false,
    loginAllowed:data.active !== false && ['director','accounting','sales','designer','printing'].includes(data.role),
    mustChangePassword:false, nativeFirebase:true
  };
}
function role(){ return profile?.role || ''; }
function requireRole(allowed){
  if(!profile || profile.active === false || !allowed.includes(role())) throw appError('Bạn không có quyền thực hiện thao tác này.',403,'ACCESS_DENIED');
}
async function loadConfig(){
  const res = await realFetch('/firebase-applet-config.json', {cache:'no-store'});
  if(!res.ok) throw appError('Không tải được cấu hình Firebase.',503,'FIREBASE_CONFIG_MISSING');
  const cfg = await res.json();
  if(!cfg.apiKey || !cfg.projectId || !cfg.appId) throw appError('Cấu hình Firebase chưa đầy đủ.',503,'FIREBASE_CONFIG_MISSING');
  if(cfg.projectId!==EXPECTED_PROJECT_ID) throw appError('Website đang trỏ nhầm Firebase project '+cfg.projectId+'. Cần đăng ký Web App trong '+EXPECTED_PROJECT_ID+' và cập nhật firebase-applet-config.json.',503,'FIREBASE_PROJECT_MISMATCH');
  return cfg;
}
function waitForAuth(timeout=5000){
  return new Promise(resolve=>{
    if(auth.currentUser) return resolve(auth.currentUser);
    let done=false, unsub=()=>{};
    const finish=user=>{ if(done)return; done=true; try{unsub();}catch{} resolve(user||null); };
    unsub=onAuthStateChanged(auth,finish,()=>finish(null));
    setTimeout(()=>finish(auth.currentUser),timeout);
  });
}
function authErrorText(err){
  const code=String(err?.code||'');
  if(code==='auth/configuration-not-found') return 'Firebase Authentication của project in-hanh-tinh-xanh-ea08e chưa được khởi tạo. Vào Firebase Console → Authentication → Get started, sau đó bật Google Sign-in.';
  if(code==='auth/operation-not-allowed') return 'Google Sign-in chưa được bật trong Firebase Authentication.';
  if(code==='auth/unauthorized-domain') return 'Tên miền '+location.hostname+' chưa được thêm vào Firebase Authentication → Authorized domains.';
  if(code==='auth/popup-blocked') return 'Trình duyệt đang chặn cửa sổ đăng nhập. Hãy cho phép popup cho website này rồi thử lại.';
  if(code==='auth/popup-closed-by-user') return 'Bạn đã đóng cửa sổ Google trước khi đăng nhập xong.';
  if(code==='auth/network-request-failed') return 'Không kết nối được tới Firebase/Google. Kiểm tra mạng rồi thử lại.';
  if(code==='auth/api-key-not-valid.-please-pass-a-valid-api-key.' || code==='auth/invalid-api-key') return 'Firebase API key không hợp lệ hoặc đang dùng sai project.';
  const message=String(err?.message||'');
  if(code==='permission-denied' && /firestore|firestore.googleapis.com/i.test(message)) return 'Cloud Firestore chưa được bật hoặc chưa tạo database cho project in-hanh-tinh-xanh-ea08e. Hãy bật Firestore API và tạo Firestore Database trước.';
  if(code==='failed-precondition' && /firestore|database/i.test(message)) return 'Firestore Database chưa sẵn sàng. Hãy tạo database (default) trong Firebase Console.';
  return message||'Không đăng nhập được bằng Google.';
}
function showGoogleLogin(message=''){
  const gate=document.getElementById('authGate');
  const shell=document.getElementById('erpShell');
  if(shell) shell.style.display='none';
  if(!gate) return;
  gate.classList.remove('hidden'); gate.style.display='grid';
  gate.innerHTML=`<div class="auth-box" style="max-width:440px;text-align:center">
    <div style="font-size:38px;margin-bottom:8px">🌿</div>
    <h1 style="margin-bottom:8px">HÀNH TINH XANH</h1>
    <p style="margin:0 0 18px;color:#607066">Đăng nhập bằng tài khoản Google đã được cấp quyền.</p>
    <button id="firebaseGoogleLoginBtn" type="button" style="width:100%;border:0;border-radius:10px;padding:12px 16px;background:#07562f;color:#fff;font-weight:700;cursor:pointer">Đăng nhập bằng Google</button>
    <div id="firebaseLoginMessage" style="min-height:22px;margin-top:14px;color:#b83434;font-size:13px;line-height:1.45">${message||''}</div>
    <div style="margin-top:10px;color:#7a8780;font-size:11px">Firebase project yêu cầu: ${EXPECTED_PROJECT_ID}</div>
  </div>`;
}
async function ensureFirebaseUser(){
  await setPersistence(auth,browserLocalPersistence);
  const existing=auth.currentUser || await waitForAuth(1200);
  if(existing) return existing;
  location.replace('/');
  return await new Promise(()=>{});
}
async function allUserRows(){
  const snap=await getDocs(collection(db,'users'));
  return snap.docs.map(d=>({__docId:d.id,...d.data()}));
}
async function allInviteRows(){
  const snap=await getDocs(collection(db,'accessByEmail'));
  return snap.docs.map(d=>({__docId:d.id,email:d.id,...d.data()}));
}
async function ensureProfile(user){
  const snap=await getDoc(doc(db,'users',user.uid));
  if(!snap.exists()){
    await signOut(auth);
    throw appError('Tài khoản chưa được Giám đốc tạo hoặc phân quyền.',403,'ACCOUNT_NOT_PROVISIONED');
  }
  const data={...snap.data(),uid:user.uid};
  if(data.active===false || !['director','accounting','sales','designer','printing'].includes(data.role)){
    await signOut(auth);
    throw appError('Tài khoản đang bị khóa hoặc chưa được phân quyền.',403,'ACCOUNT_DISABLED');
  }
  return data;
}
async function initNative(){
  config=await loadConfig();
  app=initializeApp(config,'htx-native-v31');
  auth=getAuth(app);
  db=getFirestore(app);
  const user=await ensureFirebaseUser();
  profile=await ensureProfile(user);
  return publicUser(profile);
}
async function readCollection(name){
  const snap=await getDocs(collection(db,name));
  return snap.docs.map(d=>({...(d.data()||{}), id:d.data()?.id ?? d.id}));
}
async function listAccounts(){
  requireRole(['director']);
  return (await allUserRows())
    .filter(u=>/^[a-z0-9][a-z0-9._-]{2,63}$/.test(String(u.username||'')))
    .map(publicUser);
}
async function readState(){
  const state={};
  const jobs=Object.entries(COLLECTION_KEYS).map(async([key,name])=>{
    if(key==='htx_users_v6'){ state[key]=role()==='director'?await listAccounts():[publicUser(profile)]; return; }
    state[key]=await readCollection(name);
  });
  for(const key of SETTINGS_KEYS){
    jobs.push((async()=>{ const s=await getDoc(doc(db,'settings',key)); state[key]=s.exists()?(s.data().value ?? null):null; })());
  }
  await Promise.all(jobs);
  return state;
}
async function saveSetting(key,value){
  const allowed=key==='htx_payroll_v17'?['director','accounting']:['director','accounting','sales'];
  requireRole(allowed);
  const ref=doc(db,'settings',key);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref), old=snap.exists()?snap.data():{};
    tx.set(ref,{...old,value,version:Number(old.version||0)+1,updatedAt:now(),updatedBy:(profile.username||profile.email)},{merge:false});
  });
  return {ok:true};
}
async function saveWholeCollection(key,value){
  requireRole(['director','accounting','sales']);
  if(!Array.isArray(value)) throw appError('Dữ liệu phải là mảng.');
  const name=COLLECTION_KEYS[key];
  if(!name || key==='htx_users_v6') throw appError('Nhóm dữ liệu này không hỗ trợ ghi toàn bộ.',400);
  const batch=writeBatch(db);
  for(const item of value) batch.set(doc(db,name,safeId(item.id ?? crypto.randomUUID())),item,{merge:true});
  await batch.commit();
  return {ok:true,writes:value.length,removed:0};
}
async function findCustomerForOrder(item){
  if(item.customerId) return item.customerId;
  const ci=item.customerInfo||{};
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'');
  const rows=await readCollection('customers');
  const tax=norm(ci.taxCode), phone=norm(ci.phone), email=norm(ci.email), name=String(ci.name||item.customer||'').trim().toLowerCase();
  let match=rows.find(c=>tax && norm(c.taxCode)===tax) || rows.find(c=>phone && norm(c.phone)===phone) || rows.find(c=>email && norm(c.email)===email);
  if(!match && name){
    const same=rows.filter(c=>String(c.name||'').trim().toLowerCase()===name && !c.mergedInto);
    if(same.length===1) match=same[0];
  }
  if(match) return match.id;
  if(!name) return null;
  const id=Date.now()*1000+Math.floor(Math.random()*1000);
  const customer={id,code:'KH'+String(id).slice(-8),name:ci.name||item.customer||'Khách hàng',company:ci.company||'',address:ci.address||'',phone:ci.phone||'',email:ci.email||'',cccd:ci.cccd||'',taxCode:ci.taxCode||'',tier:'Mới',createdAt:now(),updatedAt:now(),version:1};
  await setDoc(doc(db,'customers',String(id)),customer);
  return id;
}
async function audit(action,data={}){
  try{ await addDoc(collection(db,'auditLogs'),{action,...data,userId:profile.id,username:(profile.username||profile.email),role:profile.role,at:now()}); }catch{}
}
async function upsertEntity(key,id,item,expectedVersion=0){
  const name=COLLECTION_KEYS[key];
  if(!name || key==='htx_users_v6') throw appError('Nhóm dữ liệu không hỗ trợ thao tác này.');
  if(key==='htx_inventory_v7'||key==='htx_custom_products_v7') requireRole(['director','accounting','sales']);
  else if(key==='htx_customer_profiles_v10') requireRole(['director','accounting','sales']);
  else if(key==='htx_auto_quotes_v5') requireRole(['director','accounting','sales','designer','printing']);
  const incoming={...item};
  if(key==='htx_auto_quotes_v5' && !incoming.customerId){
    const customerId=await findCustomerForOrder(incoming);
    if(customerId) incoming.customerId=customerId;
  }
  const ref=doc(db,name,safeId(id));
  const saved=await runTransaction(db,async tx=>{
    const snap=await tx.get(ref), old=snap.exists()?snap.data():null, current=Number(old?.version||0);
    if(old && expectedVersion>0 && current!==Number(expectedVersion)) throw appError('Dữ liệu vừa thay đổi ở nơi khác. Vui lòng tải lại.',409,'VERSION_CONFLICT');
    if(['designer','printing'].includes(role()) && key==='htx_auto_quotes_v5' && old){
      const allowed=new Set(['status','designerId','designerName','designWork','version','updatedAt','updatedBy','id']);
      for(const k of Object.keys(incoming)) if(!(k in old) || JSON.stringify(incoming[k])!==JSON.stringify(old[k])) if(!allowed.has(k)) throw appError('Vai trò này chỉ được cập nhật tiến độ sản xuất.',403);
    }
    const next={...(old||{}),...incoming,id:incoming.id ?? old?.id ?? id,version:current+1,updatedAt:now(),updatedBy:(profile.username||profile.email)};
    tx.set(ref,next,{merge:false});
    return next;
  });
  await audit('entity_upsert',{key,entityId:String(id)});
  return saved;
}
async function deleteEntityNative(key,id,expectedVersion=0){
  const name=COLLECTION_KEYS[key];
  if(!name || key==='htx_users_v6') throw appError('Không hỗ trợ xóa nhóm dữ liệu này.');
  if(['htx_auto_quotes_v5','htx_customer_profiles_v10'].includes(key)) requireRole(['director']);
  else requireRole(['director','accounting','sales']);
  const ref=doc(db,name,safeId(id));
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists()) return;
    const current=Number(snap.data().version||0);
    if(expectedVersion>0 && current!==Number(expectedVersion)) throw appError('Dữ liệu vừa thay đổi ở nơi khác.',409,'VERSION_CONFLICT');
    tx.delete(ref);
  });
  await audit('entity_delete',{key,entityId:String(id)});
  return {ok:true};
}
function validUsername(value){
  const username=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw appError('Tên đăng nhập: 3–64 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  return username;
}
function makeAuthEmail(username){
  return 'u-'+crypto.randomUUID().replaceAll('-','')+'@auth.inhanhtinhxanh.invalid';
}
async function findUserById(id){
  const sid=String(id);
  return (await allUserRows()).find(u=>String(u.id)===sid)||null;
}
async function provisionIdentity(username,password){
  if(typeof password!=='string'||password.length<8||password.length>128) throw appError('Mật khẩu phải có từ 8 đến 128 ký tự.');
  const secondaryApp=initializeApp(config,'htx-provision-'+crypto.randomUUID());
  const secondaryAuth=getAuth(secondaryApp);
  await setPersistence(secondaryAuth,inMemoryPersistence);
  const authEmail=makeAuthEmail(username);
  try{
    const cred=await createUserWithEmailAndPassword(secondaryAuth,authEmail,password);
    return {secondaryApp,secondaryAuth,user:cred.user,authEmail};
  }catch(err){
    try{await deleteApp(secondaryApp);}catch{}
    throw err;
  }
}
async function cleanupProvision(prov,removeUser=false){
  if(removeUser&&prov?.user){try{await deleteUser(prov.user);}catch{}}
  try{await signOut(prov?.secondaryAuth);}catch{}
  try{await deleteApp(prov?.secondaryApp);}catch{}
}
async function createAccountNative(body){
  requireRole(['director']);
  const username=validUsername(body.username);
  const name=String(body.name||'').trim();
  if(!name||name.length>120) throw appError('Họ tên phải có từ 1 đến 120 ký tự.');
  if(!['director','accounting','sales','designer','printing'].includes(body.role)) throw appError('Phân quyền không hợp lệ.');
  if((await getDoc(doc(db,'loginIndex',username))).exists()) throw appError('Tên đăng nhập đã tồn tại.',409);
  const prov=await provisionIdentity(username,body.password);
  const id=Date.now()*1000+Math.floor(Math.random()*1000), createdAt=now();
  const item={id,uid:prov.user.uid,username,name,role:body.role,active:true,accessApproved:true,authEmail:prov.authEmail,authMode:'password',createdAt,updatedAt:createdAt,provisionedAt:createdAt,provisionedByDirectorId:String(profile.id)};
  try{
    const batch=writeBatch(db);
    batch.set(doc(db,'users',prov.user.uid),item);
    batch.set(doc(db,'loginIndex',username),{username,uid:prov.user.uid,userId:id,authEmail:prov.authEmail,active:true,createdAt,updatedAt:createdAt});
    await batch.commit();
    await audit('account_create',{entityId:String(id),username});
    return publicUser(item);
  }catch(err){
    await cleanupProvision(prov,true);
    throw err;
  }finally{
    await cleanupProvision(prov,false);
  }
}
async function patchAccountNative(id,body){
  requireRole(['director']);
  const old=await findUserById(id);
  if(!old) throw appError('Không tìm thấy tài khoản.',404);
  const all=await allUserRows();
  const next={...old,updatedAt:now()};
  if(body.role!==undefined){
    if(!['director','accounting','sales','designer','printing'].includes(body.role)) throw appError('Phân quyền không hợp lệ.');
    next.role=body.role;
  }
  if(body.active!==undefined) next.active=!!body.active;
  if(body.name!==undefined){
    next.name=String(body.name).trim();
    if(!next.name) throw appError('Họ tên không hợp lệ.');
  }
  const otherDirectors=all.filter(u=>String(u.id)!==String(old.id)&&u.role==='director'&&u.active!==false);
  if(old.role==='director' && old.active!==false && (next.role!=='director'||next.active===false) && otherDirectors.length===0)
    throw appError('Phải giữ ít nhất một tài khoản Giám đốc đang hoạt động.',403);

  if(body.password!==undefined){
    if(String(old.id)===String(profile.id)){
      if(typeof body.password!=='string'||body.password.length<8) throw appError('Mật khẩu phải có ít nhất 8 ký tự.');
      await updatePassword(auth.currentUser,body.password);
      await audit('account_password_change',{entityId:String(id),username:old.username});
      return publicUser(next);
    }
    const prov=await provisionIdentity(old.username,body.password);
    const replacement={...next,uid:prov.user.uid,authEmail:prov.authEmail,authMode:'password'};
    try{
      const batch=writeBatch(db);
      batch.set(doc(db,'users',prov.user.uid),replacement);
      batch.delete(doc(db,'users',old.__docId));
      batch.set(doc(db,'loginIndex',old.username),{username:old.username,uid:prov.user.uid,userId:old.id,authEmail:prov.authEmail,active:replacement.active!==false,updatedAt:now()},{merge:true});
      await batch.commit();
      await audit('account_password_reset',{entityId:String(id),username:old.username});
      return publicUser(replacement);
    }catch(err){
      await cleanupProvision(prov,true);
      throw err;
    }finally{
      await cleanupProvision(prov,false);
    }
  }

  await setDoc(doc(db,'users',old.__docId),next,{merge:false});
  await setDoc(doc(db,'loginIndex',old.username),{active:next.active!==false,updatedAt:now()},{merge:true});
  await audit('account_update',{entityId:String(id),username:old.username});
  return publicUser(next);
}
async function deleteAccountNative(id){
  requireRole(['director']);
  if(String(id)===String(profile.id)) throw appError('Không thể xóa tài khoản đang sử dụng.',403);
  const old=await findUserById(id);
  if(!old) throw appError('Không tìm thấy tài khoản.',404);
  if(old.role==='director'&&old.active!==false){
    const others=(await allUserRows()).filter(u=>String(u.id)!==String(old.id)&&u.role==='director'&&u.active!==false);
    if(!others.length) throw appError('Phải giữ ít nhất một tài khoản Giám đốc đang hoạt động.',403);
  }
  const batch=writeBatch(db);
  batch.delete(doc(db,'users',old.__docId));
  batch.delete(doc(db,'loginIndex',old.username));
  await batch.commit();
  await audit('account_delete',{entityId:String(id),username:old.username});
  return {ok:true};
}
function kpiCalc(count,rule='milestones'){
  count=Number(count||0);
  if(count<100) return {count,status:'Không đạt KPI',amount:count*5000,percent:0,rule};
  if(rule==='per-product') return {count,status:'Đạt KPI',amount:count*10000,percent:100,rule};
  const amount=count>=200?2000000:count>=150?1500000:1000000;
  return {count,status:'Đạt KPI',amount,percent:100,rule:'milestones'};
}
async function designSummaryNative(month,employeeId){
  requireRole(['director','accounting']);
  const rows=await readCollection('designCompletions');
  const filtered=rows.filter(x=>x.month===month && String(x.employeeId)===String(employeeId));
  const count=filtered.reduce((n,x)=>n+Number(x.count||0),0);
  const pol=await getDoc(doc(db,'config','designKpiPolicy'));
  return {...kpiCalc(count,pol.exists()?pol.data().rule:'milestones'),month,employeeId,orderIds:filtered.map(x=>x.orderId),capturedAt:now()};
}
async function completeDesignNative(orderId,input){
  const orderRef=doc(db,'orders',safeId(orderId)), snap=await getDoc(orderRef);
  if(!snap.exists()) throw appError('Không tìm thấy đơn.',404);
  const order=snap.data();
  if(!['director','accounting'].includes(role()) && !(role()==='designer' && String(profile.id)===String(order.designerId))) throw appError('Không có quyền xác nhận thiết kế.',403);
  const ledgerRef=doc(db,'designCompletions',safeId(orderId)), ledger=await getDoc(ledgerRef);
  if(ledger.exists()) return {ok:true,item:order,completion:ledger.data(),alreadyCompleted:true};
  const count=Number(order.designProductCount ?? input.count);
  if(!Number.isSafeInteger(count)||count<=0) throw appError('Cần xác nhận số sản phẩm thiết kế.');
  if(Number(order.designFee??order.totals?.designFee??0)!==count*40000) throw appError('Phí thiết kế chưa khớp 40.000đ/sản phẩm.');
  const employee=(await allUserRows()).find(u=>String(u.id)===String(order.designerId) && u.role==='designer' && u.active!==false);
  if(!employee) throw appError('Không tìm thấy nhân viên thiết kế được phân công.');
  const date=String(input.date||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}));
  const completion={orderId:String(orderId),employeeId:order.designerId,employeeName:employee.name||employee.email,count,fee:count*40000,date,month:date.slice(0,7),confirmedBy:(profile.username||profile.email),confirmedAt:now()};
  const next={...order,designProductCount:count,designWork:completion,version:Number(order.version||0)+1,updatedAt:now(),updatedBy:(profile.username||profile.email)};
  const batch=writeBatch(db); batch.set(orderRef,next); batch.set(ledgerRef,completion); await batch.commit();
  return {ok:true,item:next,completion};
}
async function savePayrollNative(month,employeeId,body){
  requireRole(['director','accounting']);
  const ref=doc(db,'settings','htx_payroll_v17'), snap=await getDoc(ref), old=snap.exists()?snap.data():{}, all=structuredClone(old.value||{});
  const rows=Array.isArray(all[month])?all[month]:[], idx=rows.findIndex(r=>String(r.employeeId)===String(employeeId)), prior=idx>=0?rows[idx]:null;
  if(Number(body.expectedVersion||0)!==Number(prior?.version||0)) throw appError('Bảng lương vừa thay đổi.',409);
  let record={...(prior||{}),...(body.record||{}),employeeId:Number(employeeId)||employeeId,month,version:Number(prior?.version||0)+1,updatedAt:now(),updatedBy:(profile.username||profile.email)};
  if(record.role==='designer' && (body.refreshDesignKpi===true || !prior)){
    record.designKpi=await designSummaryNative(month,employeeId); record.kpiBonus=record.designKpi.amount; record.kpiPercent=record.designKpi.percent;
  }
  if(idx>=0) rows[idx]=record; else rows.push(record); all[month]=rows;
  await setDoc(ref,{...old,value:all,version:Number(old.version||0)+1,updatedAt:now(),updatedBy:(profile.username||profile.email)},{merge:false});
  return record;
}
async function deletePayrollNative(month,employeeId,body){
  requireRole(['director','accounting']);
  const ref=doc(db,'settings','htx_payroll_v17'), snap=await getDoc(ref), old=snap.exists()?snap.data():{}, all=structuredClone(old.value||{});
  const rows=Array.isArray(all[month])?all[month]:[], target=rows.find(r=>String(r.employeeId)===String(employeeId));
  if(target && Number(body.expectedVersion||0)!==Number(target.version||0)) throw appError('Phiếu lương vừa thay đổi.',409);
  all[month]=rows.filter(r=>String(r.employeeId)!==String(employeeId));
  await setDoc(ref,{...old,value:all,version:Number(old.version||0)+1,updatedAt:now(),updatedBy:(profile.username||profile.email)},{merge:false});
  return {ok:true};
}
async function backupNative(){
  requireRole(['director']);
  const state=await readState();
  const counts={};
  for(const [k,v] of Object.entries(state)) counts[k]=Array.isArray(v)?v.length:(v&&typeof v==='object'?Object.keys(v).length:0);
  return {format:'HTX-FIREBASE-NATIVE-V31',exportedAt:now(),databaseId:'(default)',state,counts};
}
async function duplicateGroups(){
  requireRole(['director']);
  const rows=(await readCollection('customers')).filter(x=>!x.mergedInto), groups=[], seen=new Set();
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'');
  for(let i=0;i<rows.length;i++){
    if(seen.has(String(rows[i].id))) continue;
    const group=[rows[i]];
    for(let j=i+1;j<rows.length;j++){
      const a=rows[i],b=rows[j];
      const strong=(norm(a.taxCode)&&norm(a.taxCode)===norm(b.taxCode))||(norm(a.phone)&&norm(a.phone)===norm(b.phone))||(norm(a.email)&&norm(a.email)===norm(b.email));
      if(strong) group.push(b);
    }
    if(group.length>1){ group.forEach(x=>seen.add(String(x.id))); groups.push(group); }
  }
  return groups;
}
async function mergeCustomersNative(body){
  requireRole(['director']);
  if(body.confirm!==true) throw appError('Cần xác nhận gộp.');
  const ids=(body.ids||[]).map(String), target=String(body.targetId);
  if(!ids.includes(target)) throw appError('Hồ sơ chính không hợp lệ.');
  const customers=await readCollection('customers'), orders=await readCollection('orders'), batch=writeBatch(db);
  for(const c of customers) if(ids.includes(String(c.id)) && String(c.id)!==target) batch.set(doc(db,'customers',safeId(c.id)),{...c,mergedInto:Number(target)||target,mergedAt:now(),mergedBy:(profile.username||profile.email)},{merge:false});
  for(const o of orders) if(ids.includes(String(o.customerId)) && String(o.customerId)!==target) batch.set(doc(db,'orders',safeId(o.id)),{...o,customerId:Number(target)||target,version:Number(o.version||0)+1,updatedAt:now(),updatedBy:(profile.username||profile.email)},{merge:false});
  await batch.commit(); return {ok:true,targetId:body.targetId};
}
function localDraftKey(){
  const key='firebase_native_draft_key_'+auth.currentUser.uid;
  let value=localStorage.getItem(key);
  if(!value){
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    let s=''; for(const b of bytes)s+=String.fromCharCode(b); value=btoa(s); localStorage.setItem(key,value);
  }
  return value;
}
async function restoreMissingNative(backup,apply){
  requireRole(['director']);
  if(!backup?.state) throw appError('File sao lưu không hợp lệ.');
  let created=0,existing=0,conflicts=0;
  for(const [key,name] of Object.entries(COLLECTION_KEYS)){
    if(key==='htx_users_v6') continue;
    for(const item of backup.state[key]||[]){
      const ref=doc(db,name,safeId(item.id)), snap=await getDoc(ref);
      if(!snap.exists()){ created++; if(apply) await setDoc(ref,item); }
      else if(JSON.stringify(snap.data())===JSON.stringify(item)) existing++; else conflicts++;
    }
  }
  return {created,existing,conflicts,applied:!!apply};
}
async function databaseSummary(){
  requireRole(['director']);
  const names=['users','orders','customers','inventory','customProducts','auditLogs','designCompletions'];
  const summary={}; for(const name of names) summary[name]=(await getDocs(collection(db,name))).size; return summary;
}
async function handleApi(rawPath,options={}){
  const parsedUrl=new URL(rawPath,location.origin);
  const path=parsedUrl.pathname;
  const method=String(options.method||'GET').toUpperCase();
  const body=options.body?JSON.parse(options.body):{};
  try{
    if(path==='/api/health') return jsonResponse(200,{ok:true,version:'31.3.0',mode:'firebase-native',databaseId:'(default)',authentication:'firebase-password'});
    if(path==='/api/firebase-config') return jsonResponse(200,{configured:true,config});
    if(path==='/api/database-status') return jsonResponse(200,{database:{connected:true,backend:'firebase-web-sdk',projectId:config.projectId,databaseId:'(default)'}});
    if(path==='/api/auth/me') return jsonResponse(200,{ok:true,user:publicUser(profile),firebaseNative:true});
    if(path==='/api/auth/login') return jsonResponse(200,{ok:true,user:publicUser(profile),firebaseNative:true});
    if(path==='/api/auth/change-password'){ if(typeof body.newPassword!=='string'||body.newPassword.length<8) throw appError('Mật khẩu mới phải có ít nhất 8 ký tự.'); await updatePassword(auth.currentUser,body.newPassword); return jsonResponse(200,{ok:true}); }
    if(path==='/api/auth/logout'){ await signOut(auth); profile=null; return jsonResponse(200,{ok:true}); }
    if(path==='/api/auth/draft-key') return jsonResponse(200,{key:localDraftKey()});
    if(path==='/api/state' && method==='GET') return jsonResponse(200,{state:await readState(),settingDigests:{},firebaseNative:true});
    if(path.startsWith('/api/state/') && method==='PUT'){
      const key=decodeURIComponent(path.slice('/api/state/'.length));
      const result=SETTINGS_KEYS.has(key)?await saveSetting(key,body.value):await saveWholeCollection(key,body.value);
      return jsonResponse(200,{ok:true,...result});
    }
    if(path.startsWith('/api/entity/')){
      const parts=path.split('/').slice(3).map(decodeURIComponent), key=parts[0], id=parts.slice(1).join('/');
      if(method==='PUT') return jsonResponse(200,{ok:true,item:await upsertEntity(key,id,body.item,Number(body.expectedVersion||0))});
      if(method==='DELETE') return jsonResponse(200,await deleteEntityNative(key,id,Number(body.expectedVersion||0)));
    }
    if(path==='/api/admin/users' && method==='GET') return jsonResponse(200,{users:await listAccounts()});
    if(path==='/api/admin/users' && method==='POST') return jsonResponse(201,{ok:true,user:await createAccountNative(body)});
    if(path.startsWith('/api/admin/users/') && method==='PATCH') return jsonResponse(200,{ok:true,user:await patchAccountNative(decodeURIComponent(path.split('/').pop()),body)});
    if(path.startsWith('/api/admin/users/') && method==='DELETE') return jsonResponse(200,await deleteAccountNative(decodeURIComponent(path.split('/').pop())));
    if(path==='/api/admin/database-summary') return jsonResponse(200,{summary:await databaseSummary()});
    if(path==='/api/admin/backup' && method==='GET') return jsonResponse(200,await backupNative());
    if(path==='/api/admin/backup/preview' && method==='POST') return jsonResponse(200,await restoreMissingNative(body.backup,false));
    if(path==='/api/admin/backup/restore-missing' && method==='POST'){
      if(body.confirm!=='RESTORE_MISSING_ONLY') throw appError('Cần xác nhận khôi phục bản ghi thiếu.');
      return jsonResponse(200,await restoreMissingNative(body.backup,true));
    }
    if(path==='/api/admin/customers/duplicates') return jsonResponse(200,{groups:await duplicateGroups()});
    if(path==='/api/admin/customers/merge' && method==='POST') return jsonResponse(200,await mergeCustomersNative(body));
    if(/^\/api\/orders\/[^/]+\/design-complete$/.test(path) && method==='POST') return jsonResponse(200,await completeDesignNative(decodeURIComponent(path.split('/')[3]),body));
    if(path==='/api/payroll/design-summary'){
      return jsonResponse(200,await designSummaryNative(parsedUrl.searchParams.get('month'),parsedUrl.searchParams.get('employeeId')));
    }
    if(/^\/api\/payroll\/[^/]+\/[^/]+$/.test(path)){
      const p=path.split('/'); if(method==='PUT') return jsonResponse(200,{ok:true,record:await savePayrollNative(decodeURIComponent(p[3]),decodeURIComponent(p[4]),body)});
      if(method==='DELETE') return jsonResponse(200,await deletePayrollNative(decodeURIComponent(p[3]),decodeURIComponent(p[4]),body));
    }
    if(path==='/api/admin/design-kpi-policy' && method==='PUT'){
      requireRole(['director']); if(!['milestones','per-product'].includes(body.rule)) throw appError('Quy tắc KPI không hợp lệ.');
      const value={rule:body.rule,updatedAt:now(),updatedBy:(profile.username||profile.email)}; await setDoc(doc(db,'config','designKpiPolicy'),value,{merge:true}); return jsonResponse(200,value);
    }
    if(path.startsWith('/api/admin/sheets/')) return jsonResponse(409,{error:'Google Sheets sync cũ đã tắt trong Firebase Native V31 để tránh ghi đè dữ liệu.'});
    return jsonResponse(404,{error:'API cũ không còn được sử dụng trong Firebase Native V31.'});
  }catch(err){
    console.error('[HTX Firebase Native]',err);
    return jsonResponse(Number(err.status||500),{error:String(err.message||'Lỗi Firebase.'),code:err.code||'NATIVE_FIREBASE_ERROR'});
  }
}
function installUiTweaks(){
  const password=document.getElementById('newAccountPassword');
  if(password){ password.value='firebase-google-auth'; const field=password.closest('.field')||password.parentElement; if(field) field.style.display='none'; }
  const userInput=document.getElementById('newAccountUsername');
  if(userInput){ userInput.placeholder='nhanvien@gmail.com'; const label=userInput.closest('.field')?.querySelector('label'); if(label) label.textContent='Email Google'; }
  const hidePasswordButtons=()=>document.querySelectorAll('[data-user-action="password"]').forEach(b=>b.style.display='none');
  hidePasswordButtons(); new MutationObserver(hidePasswordButtons).observe(document.body,{childList:true,subtree:true});
}
const ready=(async()=>{
  const user=await initNative();
  window.fetch=async function(input,options){
    const raw=typeof input==='string'?input:input?.url||'';
    const u=new URL(raw,location.origin);
    if(u.origin===location.origin && u.pathname.startsWith('/api/')) return handleApi(u.pathname+u.search,options||{});
    return realFetch(input,options);
  };
  installUiTweaks();
  window.dispatchEvent(new CustomEvent('htx:native-firebase-ready',{detail:{user,projectId:config.projectId,databaseId:'(default)'}}));
  return {user,projectId:config.projectId,databaseId:'(default)'};
})();
window.HTXFirebaseNativeShowFatal=(err)=>showGoogleLogin(authErrorText(err));
window.HTXFirebaseNativeReady=ready;
window.HTXFirebaseNative={ready,reauthenticate:async()=>{await signOut(auth);profile=null;location.replace('/');},getProfile:()=>publicUser(profile)};
