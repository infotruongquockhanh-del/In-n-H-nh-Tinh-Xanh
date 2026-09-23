import { verifyFirebaseConnection } from './firebase-admin.js';
import { databaseError } from './database-errors.js';
import { ensureDirectorBootstrap } from './bootstrap-auth.js';
import { migrateLegacySnapshotIfNeeded } from './bootstrap-data.js';
import { ensureBootstrap } from './state-store.js';

let pending=null,lastOk=0;
export async function ensureBackendReady(){
  if(Date.now()-lastOk<5000)return true;
  if(!pending){
    pending=(async()=>{
      const health=await verifyFirebaseConnection();
      if(!health.connected)throw databaseError(health.code||'DB_UNAVAILABLE');
      await ensureDirectorBootstrap();
      await migrateLegacySnapshotIfNeeded();
      await ensureBootstrap();
      lastOk=Date.now();return true;
    })().finally(()=>{pending=null;});
  }
  return pending;
}
