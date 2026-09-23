// HTX_DATA_V30
import { safeUpsert, safeDelete, safeWriteState } from './data-safety.js';
// HTX_AUTH_V28
import { publicUser, approved, canRead, fail } from './access-policy.js';
import { ensureDirectorBootstrap } from './bootstrap-auth.js';
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./firebase-admin.js";
import {
  COLLECTION_KEYS,
  SETTINGS_KEYS,
  SYNC_KEYS,
  ROLE_PERMISSIONS,
  COMPANY
} from "./constants.js";
import { passwordHash } from "./auth.js";

const priceBook=JSON.parse(
  fs.readFileSync(new URL("../data/price-book.json",import.meta.url),"utf8")
);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value && typeof value==="object"){
    return Object.fromEntries(
      Object.keys(value).sort().map(k=>[k,stable(value[k])])
    );
  }
  return value;
}
function same(a,b){
  return JSON.stringify(stable(a))===JSON.stringify(stable(b));
}
function cleanDocData(data){
  if(!data || typeof data!=="object")return data;
  const copy={...data};
  delete copy.__docId;
  return copy;
}
function docIdFor(key,item,index){
  const raw=
    item?.id ??
    item?.key ??
    item?.code ??
    item?.username ??
    `${key}_${index}`;
  return String(raw).replaceAll("/","_");
}
function canWriteKey(role,key){
  const permissions=ROLE_PERMISSIONS[role]||[];
  return permissions.includes("*") || permissions.includes(key);
}
function stripOrderOperationalFields(order){
  const copy=structuredClone(order||{});
  delete copy.status;
  delete copy.updatedAt;
  delete copy.updatedBy;
  delete copy.version;
  return copy;
}
function validateRestrictedOrderChanges(role,existingMap,incoming){
  if(!["designer","printing"].includes(role))return;
  for(const item of incoming){
    const id=docIdFor("htx_auto_quotes_v5",item,0);
    const old=existingMap.get(id);
    if(!old)throw Object.assign(new Error("Nhân viên sản xuất/thiết kế không được tạo đơn mới."),{status:403});
    if(!same(stripOrderOperationalFields(old),stripOrderOperationalFields(item))){
      throw Object.assign(new Error("Vai trò này chỉ được cập nhật tiến độ đơn sản xuất."),{status:403});
    }
  }
}

async function commitOps(ops){
  const chunks=[];
  for(let i=0;i<ops.length;i+=400)chunks.push(ops.slice(i,i+400));
  for(const chunk of chunks){
    const batch=db.batch();
    for(const op of chunk){
      if(op.type==="set")batch.set(op.ref,op.data,{merge:false});
      if(op.type==="delete")batch.delete(op.ref);
    }
    await batch.commit();
  }
}

async function readCollection(key, collection, user) {
  const snap = await db.collection(collection).get();
  let rows = snap.docs.map(doc => ({...doc.data(), id:doc.data().id ?? doc.id}));
  if (key === 'htx_users_v6') {
    if (user.role !== 'director') rows = rows.filter(approved);
    return rows.map(publicUser);
  }
  if (!canRead(user.role, key)) return null;
  if (key === 'htx_customer_profiles_v10') rows=rows.filter(row=>!row.mergedInto);
  if (key === 'htx_auto_quotes_v5') rows.sort((a,b)=>Number(b.id||0)-Number(a.id||0));
  return rows.map(cleanDocData);
}

async function writeCollection(key,collection,value,user){ return safeWriteState(key,value,user); }

async function readSetting(key){
  const doc=await db.collection("settings").doc(key).get();
  return doc.exists?doc.data()?.value:null;
}
async function writeSetting(key,value,user){
  if(!canWriteKey(user.role,key)){
    throw Object.assign(new Error("Bạn không có quyền cập nhật dữ liệu này."),{status:403});
  }
  if(key==="htx_payroll_v17" && !["director","accounting"].includes(user.role)){
    throw Object.assign(new Error("Chỉ Giám đốc và Kế toán được cập nhật lương."),{status:403});
  }
  await db.collection("settings").doc(key).set({
    value,
    updatedAt:new Date().toISOString(),
    updatedBy:user.username
  },{merge:true});
  return {writes:1,removed:0};
}

export async function readStateKey(key,user={role:"director"}){
  if (key !== 'htx_users_v6' && !canRead(user.role,key)) return null;
  const collection=COLLECTION_KEYS[key];
  if(collection)return readCollection(key,collection,user);
  if(SETTINGS_KEYS.includes(key))return readSetting(key);
  return null;
}

export async function readAllState(user){
  const state={};
  await Promise.all(SYNC_KEYS.map(async key=>{
    if (key !== 'htx_users_v6' && !canRead(user.role,key)) { state[key]=null; return; }
    const collection=COLLECTION_KEYS[key];
    if(collection)state[key]=await readCollection(key,collection,user);
    else if(SETTINGS_KEYS.includes(key))state[key]=await readSetting(key);
  }));
  return state;
}

export async function writeStateKey(key,value,user,expectedDigest){ return safeWriteState(key,value,user,expectedDigest); }

export async function ensureBootstrap(){
  await ensureDirectorBootstrap();
  return db.runTransaction(async tx=>{
    const refs=[db.collection('config').doc('bootstrap'),db.collection('config').doc('company'),db.collection('config').doc('priceBook'),db.collection('settings').doc('htx_work_month_v7')];
    const snapshots=[];for(const ref of refs)snapshots.push(await tx.get(ref));
    if(!snapshots[1].exists)tx.set(refs[1],COMPANY);
    if(!snapshots[2].exists)tx.set(refs[2],{version:30,products:Object.keys(priceBook),priceBook,updatedAt:new Date().toISOString()});
    if(!snapshots[3].exists)tx.set(refs[3],{value:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7),updatedBy:'bootstrap'});
    if(!snapshots[0].exists)tx.set(refs[0],{initialized:true,version:30,initializedAt:new Date().toISOString()});
    return {created:!snapshots[0].exists};
  });
}

export async function getAuditLogs(limit=100){
  const snap=await db.collection("auditLogs").orderBy("at","desc").limit(Math.min(200,Math.max(1,limit))).get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

export async function getDatabaseSummary(){
  const names=["users","orders","customers","inventory","customProducts","auditLogs"];
  const result={};
  for(const name of names){
    const snap=await db.collection(name).get();
    result[name]=snap.size;
  }
  return result;
}


function publicEntityData(data){
  const clean=cleanDocData(data);
  return clean;
}

export async function upsertEntity(key,id,item,expectedVersion,user,mutationId){ return safeUpsert(key,id,item,expectedVersion,user,mutationId); }

export async function deleteEntity(key,id,expectedVersion,user){ return safeDelete(key,id,expectedVersion,user); }
