/* Authenticated, versioned persistence. Encrypted pending edits survive F5; never replay conflicts automatically. */
'use strict';
const v30Sync={key:null,owner:null,ready:null,ops:new Map(),ack:new Map(),busy:0,chain:Promise.resolve(),digests:{},poll:null};
const stableV30=value=>Array.isArray(value)?value.map(stableV30):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableV30(value[k])])):value;
const sameV30=(a,b)=>JSON.stringify(stableV30(a))===JSON.stringify(stableV30(b));
function encryptedKeyV30(op){return `htx_pending_v30_${v30Sync.owner}_${op.mutationId}`;}
function bytesBase64V30(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function fromBase64V30(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function updatePendingV30(){
 let bar=$('pendingV30');if(!bar){bar=document.createElement('div');bar.id='pendingV30';bar.className='pending-v30';$('erpShell')?.before(bar);}
 const count=v30Sync.ops.size;bar.hidden=!count;
 if(count)bar.innerHTML=`<b>${count} thay đổi CHƯA lưu xong.</b> Bản nháp được giữ riêng; không xem đây là dữ liệu đã lưu máy chủ. <button class="ghost-btn" onclick="retryPendingV30()">Thử lưu lại</button> <button class="ghost-btn" onclick="downloadPendingV30()">Tải bản nháp</button> <button class="ghost-btn" onclick="discardPendingV30()">Bỏ bản nháp sau đối chiếu</button>`;
 if(count)setCloudStatus(`${count} thay đổi chưa lưu`,'offline');
}
async function requestV30(url,options={}){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(new Error(data.error||`Không xử lý được yêu cầu (${response.status}).`),{status:response.status});return data;
}
async function initPendingV30(){
 if(v30Sync.owner===String(currentUser?.id)&&v30Sync.ready)return v30Sync.ready;
 v30Sync.owner=String(currentUser?.id);v30Sync.ops.clear();v30Sync.ack.clear();
 v30Sync.ready=(async()=>{
  const result=await requestV30('/api/auth/draft-key');
  v30Sync.key=await crypto.subtle.importKey('raw',fromBase64V30(result.key),'AES-GCM',false,['encrypt','decrypt']);
  for(const key of Object.keys(localStorage))if(key.startsWith(`htx_pending_v30_${v30Sync.owner}_`)){
   try{const {iv,cipher}=JSON.parse(localStorage.getItem(key));const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64V30(iv)},v30Sync.key,fromBase64V30(cipher));const op=JSON.parse(new TextDecoder().decode(bytes));v30Sync.ops.set(op.mutationId,op);}
   catch{showToast('Có bản nháp không giải mã được. Giữ lại file mã hóa và kiểm tra khóa SESSION_SECRET cũ; không xóa dữ liệu.');}
  }
  updatePendingV30();
 })();
 return v30Sync.ready;
}
async function persistPendingV30(op){
 await initPendingV30();v30Sync.ops.set(op.mutationId,op);updatePendingV30();
 const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},v30Sync.key,new TextEncoder().encode(JSON.stringify(op)));
 __nativeSetItem.call(localStorage,encryptedKeyV30(op),JSON.stringify({iv:bytesBase64V30(iv),cipher:bytesBase64V30(new Uint8Array(bytes))}));
}
function finishPendingV30(op){v30Sync.ops.delete(op.mutationId);__nativeRemoveItem.call(localStorage,encryptedKeyV30(op));updatePendingV30();}
async function sendOpV30(op){
 if(op.blocked){showToast('Bản nháp bị xung đột. Tải bản nháp và đối chiếu với dữ liệu mới; không tự ghi đè.');return false;}
 try{
  const k=op.key+'/'+op.id;
  op.expectedVersion=Math.max(Number(op.expectedVersion||0),Number(v30Sync.ack.get(k)||0));
  await persistPendingV30(op);v30Sync.busy++;
  const data=await requestV30(`/api/entity/${encodeURIComponent(op.key)}/${encodeURIComponent(op.id)}`,{method:op.type==='delete'?'DELETE':'PUT',body:JSON.stringify(op.type==='delete'?{expectedVersion:op.expectedVersion}:{item:op.item,expectedVersion:op.expectedVersion,mutationId:op.mutationId})});
  if(data.item){
    v30Sync.ack.set(k,data.item.version);
    const arr=parseArrayRaw(localStorage.getItem(op.key)),i=arr.findIndex((r,n)=>entityIdFor(op.key,r,n)===op.id);
    if(i>=0){
      const later=[...v30Sync.ops.values()].some(p=>p.mutationId!==op.mutationId&&p.key===op.key&&p.id===op.id&&p.queuedAt>op.queuedAt);
      arr[i]=later?{...arr[i],version:data.item.version,customerId:data.item.customerId,designWork:data.item.designWork}:data.item;
      __nativeSetItem.call(localStorage,op.key,JSON.stringify(arr));
    }
  }
  finishPendingV30(op);return true;
 }catch(err){
  if([400,401,403,409].includes(err.status)){op.blocked=true;op.error=err.message;try{await persistPendingV30(op);}catch{}}
  showToast('CHƯA LƯU: '+err.message);setCloudStatus('Chưa lưu — cần kiểm tra','offline');return false;
 }finally{v30Sync.busy=Math.max(0,v30Sync.busy-1);}
}
function deltaV30(key,before,after){
 const a=new Map(before.map((r,i)=>[entityIdFor(key,r,i),r])),b=new Map(after.map((r,i)=>[entityIdFor(key,r,i),r])),ops=[];
 for(const [id,value]of b){const old=a.get(id);if(sameV30(old,value))continue;
  const item=old?Object.fromEntries(Object.entries(value).filter(([k,v])=>!['version','updatedAt','updatedBy','lastMutationId'].includes(k)&&!sameV30(v,old[k]))):{...value};
  if(!Object.keys(item).length)continue;
  item.id=value.id??id;
  ops.push({key,id,item,type:'upsert',expectedVersion:Number(old?.version||0),mutationId:crypto.randomUUID(),queuedAt:Date.now()});
 }
 for(const [id,value]of a)if(!b.has(id))ops.push({key,id,type:'delete',expectedVersion:Number(value.version||0),mutationId:crypto.randomUUID(),queuedAt:Date.now()});
 return ops;
}
pushCollectionDelta=async function(key,oldRaw,newRaw){
 if(!currentUser||!cloudSyncReady){showToast('Chưa xác thực/kết nối; không lưu dữ liệu.');return false;}
 const ops=deltaV30(key,parseArrayRaw(oldRaw),parseArrayRaw(newRaw));
 if(!ops.length)return true;
 try{for(const op of ops)await persistPendingV30(op);}catch(err){showToast('Không giữ được bản nháp: '+err.message);return false;}
 const task=v30Sync.chain.then(async()=>{let ok=true;for(const op of ops)if(!await sendOpV30(op)){ok=false;break;}if(ok){await hydrateFromBackend();setCloudStatus('Đã lưu máy chủ','ok');}return ok;});
 v30Sync.chain=task.catch(()=>false);return task;
};
writeHistory=function(list){
 if(!Array.isArray(list))throw new Error('Danh sách đơn không hợp lệ.');
 const key='htx_auto_quotes_v5',old=localStorage.getItem(key)||'[]',next=JSON.stringify(list);
 __nativeSetItem.call(localStorage,key,next);
 lastOrderPersistPromise=pushCollectionDelta(key,old,next).catch(err=>{showToast('Chưa lưu: '+err.message);return false;});
 return lastOrderPersistPromise;
};
queuePendingOperation=function(op){return persistPendingV30({...op,mutationId:op.mutationId||crypto.randomUUID(),queuedAt:Date.now()});};
retryPendingRealtimeWrites=async function(){return retryPendingV30();};
sendEntityOperation=async function(op){return sendOpV30({...op,mutationId:op.mutationId||crypto.randomUUID(),queuedAt:op.queuedAt||Date.now()});};
async function retryPendingV30(){
 await initPendingV30();const ops=[...v30Sync.ops.values()].sort((a,b)=>a.queuedAt-b.queuedAt);
 for(const op of ops)if(!await sendOpV30(op))break;
 if(!v30Sync.ops.size){await hydrateFromBackend();renderHistory();renderCustomers();}
}
function downloadJSONV30(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function downloadPendingV30(){await initPendingV30();downloadJSONV30({format:'HTX-PENDING-EDITS',owner:v30Sync.owner,exportedAt:new Date().toISOString(),operations:[...v30Sync.ops.values()]},'HTX-ban-nhap-chua-luu.json');}
async function discardPendingV30(){
 await downloadPendingV30();
 if(!confirm('Đã tải bản nháp để lưu riêng? Bỏ các bản nháp đang chờ trên máy này và tải lại dữ liệu máy chủ? Dữ liệu máy chủ không bị xóa.'))return;
 for(const op of [...v30Sync.ops.values()])finishPendingV30(op);
 await hydrateFromBackend();renderHistory();renderCustomers();
}
hydrateFromBackend=async function(){
 const payload=await requestV30('/api/state');
 if(!payload.state||typeof payload.state!=='object')throw new Error('Máy chủ trả dữ liệu không hợp lệ.');
 v30Sync.digests=payload.settingDigests||{};
 cloudHydrating=true;
 try{for(const key of CLOUD_SYNC_KEYS){const value=payload.state[key];if(value===undefined||value===null)__nativeRemoveItem.call(localStorage,key);else __nativeSetItem.call(localStorage,key,typeof value==='string'?value:JSON.stringify(value));}}
 finally{cloudHydrating=false;}
 cloudSyncReady=true;
 try{await initPendingV30();}catch(err){setCloudStatus('Cần cấu hình khóa lưu bản nháp','offline');console.warn(err.message);}
 updatePendingV30();
 if(!v30Sync.ops.size)setCloudStatus('Đã tải dữ liệu máy chủ','ok');
};
saveStateV29=async function(key,value){
 if(!currentUser||!cloudSyncReady)throw new Error('Chưa kết nối máy chủ.');
 const data=await requestV30('/api/state/'+encodeURIComponent(key),{method:'PUT',body:JSON.stringify({value,expectedDigest:v30Sync.digests[key]})});
 await hydrateFromBackend();return data;
};
cloudPushKey=async function(key){try{await saveStateV29(key,cloudValueParse(localStorage.getItem(key)));}catch(err){showToast('CHƯA LƯU: '+err.message);setCloudStatus('Chưa lưu cấu hình','offline');}};
clearPrivateCache=function(){
 cloudSyncReady=false;for(const timer of cloudSyncTimers.values())clearTimeout(timer);for(const timer of realtimeDeltaTimers.values())clearTimeout(timer);
 cloudSyncTimers.clear();realtimeDeltaTimers.clear();realtimeDeltaPending.clear();
 for(const key of Object.keys(localStorage))if(key.startsWith('htx_')&&!key.startsWith('htx_pending_v30_'))__nativeRemoveItem.call(localStorage,key);
};
startRealtime=async function(){
 try{window.HTXRealtime?.stopListeners?.();}catch{}
 if(v30Sync.poll)clearInterval(v30Sync.poll);
 v30Sync.poll=setInterval(async()=>{
  if(!currentUser||!cloudSyncReady||v30Sync.busy||v30Sync.ops.size||document.hidden)return;
  try{await hydrateFromBackend();if($('page-orders')?.classList.contains('active'))renderHistory();if($('page-customers')?.classList.contains('active'))renderCustomers();}catch{}
 },10000);return true;
};
window.addEventListener('beforeunload',event=>{if(v30Sync.busy||v30Sync.ops.size){event.preventDefault();event.returnValue='Còn thay đổi chưa lưu.';}});
