import { db } from './firebase-admin.js';
import { COLLECTION_KEYS, SETTINGS_KEYS } from './constants.js';
import { ROLES } from './access-policy.js';

const validUsername=value=>/^[a-z0-9][a-z0-9._-]{2,63}$/.test(String(value||'').trim().toLowerCase());
const validHash=value=>/^[0-9a-f]{8}$/.test(String(value||'')) || /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(String(value||''));

function rows(value){
  if(Array.isArray(value)) return value.filter(x=>x&&typeof x==='object');
  if(value&&typeof value==='object') return Object.values(value).filter(x=>x&&typeof x==='object');
  return [];
}
function docIdFor(key,item,index){
  const raw=item?.id ?? item?.key ?? item?.code ?? item?.username ?? `${key}_${index}`;
  return String(raw).replaceAll('/','_');
}

export async function migrateBrowserState(state,actor){
  if(!actor || actor.role!=='director') throw Object.assign(new Error('Chỉ Giám đốc được nhập dữ liệu cũ.'),{status:403});
  if(!state || typeof state!=='object' || Array.isArray(state)) throw Object.assign(new Error('Dữ liệu trình duyệt không hợp lệ.'),{status:400});
  const summary={created:0,skipped:0,users:0,collections:{},settings:0};

  for(const [key,collectionName] of Object.entries(COLLECTION_KEYS)){
    const input=rows(state[key]);
    if(!input.length) continue;
    summary.collections[key]={created:0,skipped:0};

    if(key==='htx_users_v6'){
      const existingSnap=await db.collection('users').get();
      const existingUsers=existingSnap.docs.map(d=>({...d.data(),_docId:d.id}));
      const usernames=new Set(existingUsers.map(u=>String(u.username||'').toLowerCase()));
      const batch=db.batch();
      let writes=0;
      for(const item of input){
        const username=String(item.username||'').trim().toLowerCase();
        if(!validUsername(username) || !ROLES.includes(item.role) || !validHash(item.passwordHash) || usernames.has(username)){
          summary.skipped++; summary.collections[key].skipped++; continue;
        }
        const id=String(item.id ?? Date.now()*1000+writes);
        const clean={
          id:Number(item.id)||item.id||id,
          name:String(item.name||username).slice(0,120),
          username, passwordHash:String(item.passwordHash),
          role:item.role, active:item.active!==false,
          accessApproved:true, provisionedByDirectorId:String(actor.id),
          provisionedAt:item.provisionedAt||new Date().toISOString(),
          createdAt:item.createdAt||new Date().toISOString(),
          updatedAt:new Date().toISOString(),
          updatedBy:actor.username,
          authVersion:Number(item.authVersion||0),
          mustChangePassword:false,
          migratedFrom:'browser-local-storage'
        };
        batch.set(db.collection('users').doc(id),clean);
        usernames.add(username); writes++; summary.created++; summary.users++; summary.collections[key].created++;
      }
      if(writes) await batch.commit();
      continue;
    }

    const batch=db.batch(); let writes=0;
    for(let i=0;i<input.length;i++){
      const item=input[i],id=docIdFor(key,item,i);
      const ref=db.collection(collectionName).doc(id);
      const existing=await ref.get();
      if(existing.exists){summary.skipped++;summary.collections[key].skipped++;continue;}
      batch.set(ref,item);writes++;summary.created++;summary.collections[key].created++;
    }
    if(writes) await batch.commit();
  }

  for(const key of SETTINGS_KEYS){
    if(!(key in state)) continue;
    const value=state[key];
    if(value===undefined) continue;
    const ref=db.collection('settings').doc(key);
    const existing=await ref.get();
    if(existing.exists){summary.skipped++;continue;}
    await ref.set({value,version:1,updatedAt:new Date().toISOString(),updatedBy:actor.username,migratedFrom:'browser-local-storage'});
    summary.created++; summary.settings++;
  }

  await db.collection('auditLogs').add({
    action:'browser_state_migration',created:summary.created,skipped:summary.skipped,
    userId:actor.id,username:actor.username,role:actor.role,at:new Date().toISOString()
  });
  return summary;
}
