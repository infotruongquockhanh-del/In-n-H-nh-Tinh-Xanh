import { createHash, randomUUID } from 'node:crypto';
import { db, getFirebaseDiagnostics } from './firebase-admin.js';
import { COLLECTION_KEYS, SETTINGS_KEYS, ROLE_PERMISSIONS } from './constants.js';
import { canRead, fail } from './access-policy.js';
import '../public/business-v30.js';
const B=globalThis.HTXBusinessV30;
export const ORDER_KEY='htx_auto_quotes_v5',CUSTOMER_KEY='htx_customer_profiles_v10';
export function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
export const digest=value=>createHash('sha256').update(JSON.stringify(stable(value??null))).digest('hex');
const same=(a,b)=>digest(a)===digest(b);
const now=()=>new Date().toISOString();
export const readRows=snap=>snap.docs.map(d=>({...d.data(),id:d.data().id??d.id,_docId:d.id}));
const permissions=(role,key)=>(ROLE_PERMISSIONS[role]||[]).some(p=>p==='*'||p===key);
function docId(id){const value=String(id??'');if(!value||value.length>150||value.includes('/')||['__proto__','constructor','prototype'].includes(value))throw fail('Mã bản ghi không hợp lệ.');return value;}
function clean(value){const copy=structuredClone(value||{});for(const key of ['_docId','__docId','_updated','lastMutationId'])delete copy[key];return copy;}
function editableOrder(value){const copy=clean(value);for(const key of ['status','updatedAt','updatedBy','version','customerId','designWork'])delete copy[key];return copy;}
export function historyWrite(tx,collection,id,before,after,actor,action='update'){
  // Before-images and tombstones share the same transaction as the actual change.
  // This history is NOT a replacement for an independent disaster-recovery backup.
  tx.set(db.collection('dataHistory').doc(randomUUID()),{collection,entityId:String(id),before:before??null,afterHash:after==null?null:digest(after),action,actor:actor?.username||'system',at:now()});
}
function versionCheck(current,expected){
  if(expected===undefined||expected===null||!Number.isInteger(Number(expected))||Number(expected)<0)throw fail('Thiếu phiên bản dữ liệu; hãy tải lại trước khi lưu.',409);
  if(current&&Number(current.version||0)!==Number(expected))throw Object.assign(fail('Bản ghi vừa thay đổi. Đã giữ bản nháp; tải lại và đối chiếu trước khi lưu.',409),{currentVersion:Number(current.version||0)});
  if(!current&&Number(expected)!==0)throw fail('Bản ghi đã bị xóa. Không tự tạo lại từ dữ liệu cũ.',409);
}
function customerFields(order){const ci=order.customerInfo||{};return Object.fromEntries(['name','company','address','phone','email','taxCode','cccd'].map(k=>[k,String((k==='name'?(ci.name||order.customer):ci[k])||'').trim()]));}
function numericCustomerId(key){return String(parseInt(createHash('sha256').update(key).digest('hex').slice(0,12),16)+100000000000000);}
function customerIdentity(ci,orderId){
  if(ci.taxCode)return 'tax:'+B.norm(ci.taxCode);
  if(ci.phone)return 'phone:'+B.phone(ci.phone);
  if(ci.email)return 'email:'+B.norm(ci.email);
  if(ci.cccd)return 'cccd:'+B.norm(ci.cccd);
  if(ci.name&&!['quý khách hàng','khách vãng lai','khách hàng'].includes(B.norm(ci.name)))return 'name:'+B.norm(ci.name)+'|'+B.norm(ci.company)+'|'+B.norm(ci.address);
  return 'order:'+orderId;
}
function prepareCustomer(order,current,profiles,actor){
  if(order.crmSuppressed)return {customerId:current?.customerId??null};
  const ci=customerFields(order);
  if(!ci.name)return {customerId:current?.customerId??null};
  // A saved customerId is stable across progress, payment and employee updates.
  const explicit=String(order.customerId??current?.customerId??order.customerInfo?.id??'');
  if(explicit){
    const p=B.resolveCustomer({customerId:explicit},profiles);
    if(!p)throw fail('Hồ sơ khách hàng liên kết không tồn tại. Chọn lại khách hàng hoặc khôi phục hồ sơ trước khi lưu.',409);
    return {customerId:p.id};
  }
  const resolved=B.resolveCustomer(order,profiles);
  if(resolved)return {customerId:resolved.id};
  const ambiguous=profiles.filter(p=>!p.mergedInto&&B.customerMatch(ci,p));
  if(ambiguous.length>1)throw fail('Có nhiều hồ sơ trùng thông tin khách hàng. Giám đốc cần kiểm tra trùng trước khi lưu.',409);
  const id=numericCustomerId(customerIdentity(ci,order.id));
  const occupied=profiles.find(p=>String(p.id)===id);
  if(occupied)throw fail('Thông tin khách hàng xung đột với hồ sơ hiện có. Chọn hồ sơ chính xác trước khi lưu.',409);
  const customer={id:Number(id),code:'KH-'+id.slice(-8),...ci,tier:'Mới',owner:order.preparedBy||actor.username,note:'',createdAt:now(),updatedAt:now(),version:1,sourceOrderId:String(order.id)};
  return {customerId:customer.id,newCustomer:customer};
}
function validateDesign(order,current){
  if(order.designProductCount===undefined||order.designProductCount===null)return;
  const count=Number(order.designProductCount);
  if(!Number.isSafeInteger(count)||count<0||count>1000000)throw fail('Số sản phẩm thiết kế phải là số nguyên không âm.');
  if(Number(order.designFee??order.totals?.designFee??0)!==count*40000)throw fail('Phí thiết kế phải bằng số sản phẩm × 40.000đ.');
  if(current?.designWork&&count!==Number(current.designWork.count))throw fail('Thiết kế đã xác nhận hoàn thành. Không sửa số sản phẩm làm thay đổi KPI đã ghi nhận.',409);
}
export async function safeUpsert(key,id,item,expected,actor,mutationId=''){
  const collection=COLLECTION_KEYS[key];
  if(!collection||key==='htx_users_v6')throw fail('Nhóm dữ liệu không hỗ trợ cập nhật tại đây.',403);
  if(!permissions(actor.role,key))throw fail('Bạn không có quyền lưu dữ liệu này.',403);
  id=docId(id);if(!item||typeof item!=='object'||Array.isArray(item))throw fail('Dữ liệu bản ghi không hợp lệ.');
  if(item.id!==undefined&&String(item.id)!==id)throw fail('Mã bản ghi không khớp.');
  const ref=db.collection(collection).doc(id);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref),current=snap.exists?snap.data():null;
    if(mutationId&&current?.lastMutationId===mutationId)return clean(current);
    versionCheck(current,expected);
    if(key===ORDER_KEY&&['designer','printing'].includes(actor.role)){
      if(!current||(item.customerId!==undefined&&String(item.customerId??'')!==String(current.customerId??''))||!same(editableOrder(current),editableOrder({...current,...item})))throw fail('Nhân viên sản xuất chỉ được cập nhật tiến độ đơn có sẵn.',403);
    }
    let next={...(current||{}),...clean(item),version:Number(current?.version||0)+1,updatedAt:now(),updatedBy:actor.username};
    if(key===ORDER_KEY){
      next.designWork=current?.designWork??null;
      validateDesign(next,current);
      if(current?.paid&&Number(next.total??0)>Number(current.total??0)){
        next.paid=false;next.receivedAmount=Math.max(Number(current.receivedAmount||0),Number(current.total||0));
      }
      const profiles=readRows(await tx.get(db.collection('customers')));
      const link=prepareCustomer(next,current,profiles,actor);next.customerId=link.customerId;
      if(link.newCustomer){const cr=db.collection('customers').doc(String(link.customerId));historyWrite(tx,'customers',link.customerId,null,link.newCustomer,actor,'create');tx.set(cr,link.newCustomer);}
    }
    if(key===CUSTOMER_KEY)next.mergedInto=current?.mergedInto??null;
    if(mutationId)next.lastMutationId=String(mutationId).slice(0,100);
    historyWrite(tx,collection,id,current,next,actor,current?'update':'create');tx.set(ref,next);
    return clean(next);
  });
}
export async function safeDelete(key,id,expected,actor){
  const collection=COLLECTION_KEYS[key];
  if(!collection||key==='htx_users_v6'||!permissions(actor.role,key))throw fail('Không có quyền xóa dữ liệu này.',403);
  if([ORDER_KEY,CUSTOMER_KEY].includes(key)&&actor.role!=='director')throw fail('Chỉ Giám đốc được xóa đơn hoặc hồ sơ khách hàng.',403);
  id=docId(id);const ref=db.collection(collection).doc(id);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)return {ok:true};
    const current=snap.data();versionCheck(current,expected);
    if(key===CUSTOMER_KEY){const orders=readRows(await tx.get(db.collection('orders')));if(orders.some(o=>String(o.customerId)===id&&!o.crmSuppressed))throw fail('Khách hàng đang liên kết với đơn. Không xóa hồ sơ làm đứt liên kết; dùng chức năng kiểm tra trùng nếu cần gộp.',409);}
    historyWrite(tx,collection,id,current,null,actor,'delete');tx.delete(ref);return {ok:true};
  });
}
export async function safeWriteState(key,value,actor,expectedDigest){
  if(key==='htx_payroll_v17')throw fail('Lưu lương qua từng nhân viên để tránh ghi đè kỳ lương khác.',409);
  if(key==='htx_users_v6')throw fail('Tài khoản chỉ được quản lý bởi Giám đốc qua chức năng tài khoản.',403);
  if(!permissions(actor.role,key))throw fail('Không có quyền cập nhật dữ liệu này.',403);
  if(COLLECTION_KEYS[key]){
    if(!Array.isArray(value))throw fail('Dữ liệu phải là danh sách.');
    // No implicit collection deletions; all changed rows are version-checked.
    const existing=await db.collection(COLLECTION_KEYS[key]).get();
    const byId=new Map(existing.docs.map(d=>[d.id,d.data()]));let writes=0;
    for(const item of value){
      const id=docId(item?.id??item?.key);const before=byId.get(id);
      if(before&&same(clean(before),clean(item)))continue;
      await safeUpsert(key,id,item,before?item.version:0,actor);writes++;
    }
    return {writes,removed:0};
  }
  if(!SETTINGS_KEYS.includes(key))throw fail('Key không hợp lệ.');
  const ref=db.collection('settings').doc(key);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref),before=snap.exists?snap.data():null;
    if(expectedDigest!==digest(before?.value??null))throw fail('Cấu hình vừa thay đổi hoặc đang dùng bản cũ. Tải lại trước khi lưu; không ghi đè.',409);
    const after={...(before||{}),value,version:Number(before?.version||0)+1,updatedAt:now(),updatedBy:actor.username};
    historyWrite(tx,'settings',key,before,after,actor);tx.set(ref,after);return {writes:1,removed:0,digest:digest(value)};
  });
}
export async function settingDigests(actor,state){
  if(state)return Object.fromEntries(SETTINGS_KEYS.filter(k=>canRead(actor.role,k)).map(k=>[k,digest(state[k]??null)]));
  const result={};for(const key of SETTINGS_KEYS)if(canRead(actor.role,key)){const d=await db.collection('settings').doc(key).get();result[key]=digest(d.exists?d.data()?.value:null);}return result;
}
const backupNames=['orders','customers','inventory','customProducts','settings','config','auditLogs','dataHistory','designCompletions'];
export async function backupBusiness(actor){
  if(actor.role!=='director')throw fail('Chỉ Giám đốc được sao lưu.',403);
  const collections=await db.runTransaction(async tx=>{
    const out={};
    for(const name of backupNames){const snap=await tx.get(db.collection(name));out[name]=Object.fromEntries(snap.docs.filter(d=>name!=='settings'||SETTINGS_KEYS.includes(d.id)).filter(d=>name!=='config'||['company','priceBook','designKpiPolicy'].includes(d.id)).filter(d=>name!=='dataHistory'||['orders','customers','inventory','customProducts','designCompletions'].includes(d.data().collection)||(d.data().collection==='settings'&&SETTINGS_KEYS.includes(d.data().entityId))).map(d=>[d.id,d.data()]));}
    return out;
  });
  return {format:'HTX-BUSINESS-BACKUP',schemaVersion:30,exportedAt:now(),storage:getFirebaseDiagnostics(),scope:'business-data-and-history; excludes passwords, session keys and service credentials',collections,counts:Object.fromEntries(Object.entries(collections).map(([k,v])=>[k,Object.keys(v).length])),sha256:digest(collections)};
}
export function validateBackup(backup){
  if(backup?.format!=='HTX-BUSINESS-BACKUP'||backup.schemaVersion!==30||!backup.collections||digest(backup.collections)!==backup.sha256)throw fail('File sao lưu không hợp lệ hoặc checksum không khớp.');
  for(const [name,docs]of Object.entries(backup.collections)){
    if(!backupNames.includes(name)||!docs||typeof docs!=='object'||Array.isArray(docs))throw fail('Nhóm dữ liệu sao lưu không hợp lệ.');
    for(const [id,data]of Object.entries(docs)){docId(id);if(!data||typeof data!=='object'||Array.isArray(data))throw fail('Bản ghi sao lưu không hợp lệ.');
      if(name==='settings'&&!SETTINGS_KEYS.includes(id))throw fail('Không khôi phục Secrets qua file dữ liệu kinh doanh.');
      if(name==='config'&&!['company','priceBook','designKpiPolicy'].includes(id))throw fail('Không khôi phục cấu hình xác thực.');}
  }
}
export async function restoreMissing(backup,actor,apply=false){
  if(actor.role!=='director')throw fail('Chỉ Giám đốc được khôi phục.',403);validateBackup(backup);
  const report={created:0,existing:0,conflicts:0,conflictIds:[],apply};
  for(const [name,docs]of Object.entries(backup.collections))for(const [id,data]of Object.entries(docs)){
    const outcome=await db.runTransaction(async tx=>{const ref=db.collection(name).doc(id),snap=await tx.get(ref);
      if(snap.exists)return same(snap.data(),data)?'existing':'conflicts';
      if(apply){if(name!=='dataHistory')historyWrite(tx,name,id,null,data,actor,'restore_missing');tx.set(ref,data);}return 'created';});
    report[outcome]++;if(outcome==='conflicts'&&report.conflictIds.length<100)report.conflictIds.push(name+'/'+id);
  }
  return report;
}
export async function customerDuplicates(){
  const all=readRows(await db.collection('customers').get()).filter(p=>!p.mergedInto);const groups=[],used=new Set();
  for(const p of all){if(used.has(String(p.id)))continue;const group=[p];
    for(const q of all){if(q===p||used.has(String(q.id)))continue;if(group.every(r=>B.customerMatch(r,q)&&B.norm(r.name)===B.norm(q.name)&&B.norm(r.company)===B.norm(q.company)))group.push(q);}
    if(group.length>1){group.forEach(q=>used.add(String(q.id)));groups.push(group.map(clean));}
  }
  return groups;
}
export async function mergeCustomers(ids,targetId,actor){
  if(actor.role!=='director')throw fail('Chỉ Giám đốc được gộp hồ sơ.',403);
  if(!Array.isArray(ids)||ids.length<2||ids.length>30||!ids.map(String).includes(String(targetId)))throw fail('Chọn 2–30 hồ sơ và hồ sơ giữ lại.');
  ids=[...new Set(ids.map(docId))];targetId=docId(targetId);
  return db.runTransaction(async tx=>{
    const customers=readRows(await tx.get(db.collection('customers'))),orders=readRows(await tx.get(db.collection('orders')));
    const group=ids.map(id=>customers.find(p=>String(p.id)===id&&!p.mergedInto));
    if(group.some(p=>!p))throw fail('Hồ sơ vừa thay đổi; kiểm tra trùng lại.',409);
    if(!group.every(p=>group.every(q=>B.customerMatch(p,q)&&B.norm(p.name)===B.norm(q.name)&&B.norm(p.company)===B.norm(q.company))))throw fail('Thông tin hồ sơ không đủ chắc chắn để gộp. Không tự gộp chỉ vì trùng tên.',409);
    const target=group.find(p=>String(p.id)===targetId);
    const affected=orders.filter(o=>!o.crmSuppressed&&(ids.includes(String(o.customerId))||(!o.customerId&&group.some(p=>B.customerMatch(customerFields(o),p)))));
    if(affected.length+group.length>180)throw fail('Nhóm có quá nhiều đơn để gộp an toàn trong một lần. Cần di chuyển có kiểm soát.',409);
    for(const p of group)if(String(p.id)!==targetId){const after={...clean(p),mergedInto:target.id,version:Number(p.version||0)+1,updatedAt:now()};historyWrite(tx,'customers',p._docId,clean(p),after,actor,'merge_archive');tx.set(db.collection('customers').doc(p._docId),after);}
    for(const o of affected){const after={...clean(o),customerId:target.id,version:Number(o.version||0)+1,updatedAt:now(),updatedBy:actor.username};historyWrite(tx,'orders',o._docId,clean(o),after,actor,'link_customer');tx.set(db.collection('orders').doc(o._docId),after);}
    return {ok:true,archived:group.length-1,linkedOrders:affected.length,targetId:target.id};
  });
}
