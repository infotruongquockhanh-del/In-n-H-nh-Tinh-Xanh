import fs from 'node:fs';
import { db } from './firebase-admin.js';

const snapshot=JSON.parse(fs.readFileSync(new URL('../data/local-database.json',import.meta.url),'utf8'));
const asEntries=value=>Array.isArray(value)?value.map((v,i)=>[String(v?.id??i),v]):Object.entries(value||{});

async function seedCollectionIfEmpty(name,source){
  const rows=asEntries(source);
  if(!rows.length)return 0;
  const existing=await db.collection(name).limit(1).get();
  if(!existing.empty)return 0;
  const batch=db.batch();
  for(const [id,value] of rows)batch.set(db.collection(name).doc(String(id).replaceAll('/','_')),value);
  await batch.commit();return rows.length;
}
async function seedSettingIfMissing(id,value){
  const ref=db.collection('settings').doc(id),snap=await ref.get();
  if(snap.exists)return 0;
  await ref.set(value);return 1;
}
export async function migrateLegacySnapshotIfNeeded(){
  const marker=db.collection('config').doc('v32Migration');
  const seen=await marker.get();
  if(seen.exists)return seen.data();
  const result={orders:0,auditLogs:0,settings:0,migratedAt:new Date().toISOString(),source:'data/local-database.json'};
  result.orders=await seedCollectionIfEmpty('orders',snapshot.orders);
  result.auditLogs=await seedCollectionIfEmpty('auditLogs',snapshot.auditLogs);
  for(const [id,value] of Object.entries(snapshot.settings||{}))result.settings+=await seedSettingIfMissing(id,value);
  await marker.set(result);
  return result;
}
