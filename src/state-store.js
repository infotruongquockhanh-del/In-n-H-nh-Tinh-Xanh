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

async function readCollection(key,collection,user){
  const snap=await db.collection(collection).get();
  let rows=snap.docs.map(d=>({...d.data(),__docId:d.id}));

  if(key==="htx_auto_quotes_v5"){
    rows.sort((a,b)=>Number(b.id||0)-Number(a.id||0));
  }else if(key==="htx_users_v6"){
    rows.sort((a,b)=>Number(a.id||0)-Number(b.id||0));
    if(user.role!=="director"){
      rows=rows.map(row=>{
        const clean=cleanDocData(row);
        delete clean.passwordHash;
        return clean;
      });
      return rows;
    }
  }
  return rows.map(cleanDocData);
}

async function writeCollection(key,collection,value,user){
  if(!Array.isArray(value)){
    throw Object.assign(new Error(`Dữ liệu ${key} phải là mảng.`),{status:400});
  }
  if(!canWriteKey(user.role,key)){
    throw Object.assign(new Error("Bạn không có quyền cập nhật dữ liệu này."),{status:403});
  }
  if(key==="htx_users_v6" && user.role!=="director"){
    throw Object.assign(new Error("Chỉ Giám đốc được quản lý tài khoản."),{status:403});
  }

  const ref=db.collection(collection);
  const current=await ref.get();
  const existingMap=new Map(current.docs.map(d=>[d.id,cleanDocData(d.data())]));
  const incomingMap=new Map(
    value.map((item,index)=>[docIdFor(key,item,index),item])
  );

  const removed=[...existingMap.keys()].filter(id=>!incomingMap.has(id));
  if(
    removed.length &&
    ["htx_auto_quotes_v5","htx_customer_profiles_v10","htx_users_v6"].includes(key) &&
    user.role!=="director"
  ){
    throw Object.assign(new Error("Chỉ Giám đốc được xóa đơn hàng, khách hàng hoặc tài khoản."),{status:403});
  }

  if(key==="htx_auto_quotes_v5"){
    validateRestrictedOrderChanges(user.role,existingMap,value);
  }

  const ops=[];
  for(const [id,item] of incomingMap.entries()){
    const old=existingMap.get(id);
    if(!old || !same(old,item)){
      ops.push({type:"set",ref:ref.doc(id),data:item});
    }
  }
  for(const id of removed){
    ops.push({type:"delete",ref:ref.doc(id)});
  }
  await commitOps(ops);
  return {writes:ops.length,removed:removed.length};
}

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
  const collection=COLLECTION_KEYS[key];
  if(collection)return readCollection(key,collection,user);
  if(SETTINGS_KEYS.includes(key))return readSetting(key);
  return null;
}

export async function readAllState(user){
  const state={};
  await Promise.all(SYNC_KEYS.map(async key=>{
    const collection=COLLECTION_KEYS[key];
    if(collection)state[key]=await readCollection(key,collection,user);
    else if(SETTINGS_KEYS.includes(key))state[key]=await readSetting(key);
  }));
  return state;
}

export async function writeStateKey(key,value,user){
  if(!SYNC_KEYS.includes(key)){
    throw Object.assign(new Error("Key dữ liệu không được hỗ trợ."),{status:400});
  }

  let result;
  if(COLLECTION_KEYS[key]){
    result=await writeCollection(key,COLLECTION_KEYS[key],value,user);
  }else{
    result=await writeSetting(key,value,user);
  }

  await db.collection("auditLogs").add({
    action:"sync",
    key,
    writes:result.writes,
    removed:result.removed,
    userId:user.id,
    username:user.username,
    role:user.role,
    at:new Date().toISOString()
  });

  return result;
}

export async function ensureBootstrap(){
  const bootstrapRef=db.collection("config").doc("bootstrap");
  const bootstrap=await bootstrapRef.get();
  if(bootstrap.exists && bootstrap.data()?.initialized===true)return {created:false};

  const userId="202609190001";
  const director={
    id:202609190001,
    name:"Giám đốc",
    username:"giamdoc",
    passwordHash:passwordHash("giamdoc","123456"),
    role:"director",
    active:true,
    createdAt:"Tài khoản mặc định Full-stack V22"
  };

  await db.collection("users").doc(userId).set(director,{merge:true});
  await db.collection("config").doc("company").set(COMPANY,{merge:true});
  await db.collection("config").doc("priceBook").set({
    version:22,
    products:Object.keys(priceBook),
    priceBook,
    updatedAt:new Date().toISOString()
  },{merge:true});
  await db.collection("settings").doc("htx_work_month_v7").set({
    value:"2026-09",
    updatedAt:new Date().toISOString(),
    updatedBy:"bootstrap"
  },{merge:true});
  await bootstrapRef.set({
    initialized:true,
    version:22,
    initializedAt:new Date().toISOString()
  },{merge:true});

  return {created:true};
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

export async function upsertEntity(key,id,item,expectedVersion,user){
  if(!COLLECTION_KEYS[key]){
    throw Object.assign(new Error("Nhóm dữ liệu này không hỗ trợ cập nhật theo từng bản ghi."),{status:400});
  }
  if(!canWriteKey(user.role,key)){
    throw Object.assign(new Error("Bạn không có quyền cập nhật dữ liệu này."),{status:403});
  }
  if(key==="htx_users_v6"){
    throw Object.assign(new Error("Tài khoản phải được quản lý qua chức năng tài khoản."),{status:400});
  }

  const collection=COLLECTION_KEYS[key];
  const ref=db.collection(collection).doc(String(id).replaceAll("/","_"));

  const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const current=snap.exists?publicEntityData(snap.data()):null;
    const currentVersion=Number(current?.version||0);
    const expected=Number(expectedVersion||0);

    if(snap.exists && expected>0 && currentVersion>expected && current?.updatedBy && current?.updatedBy!==user.username){
      throw Object.assign(new Error("Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu."),{
        status:409,
        currentVersion
      });
    }

    if(key==="htx_auto_quotes_v5" && ["designer","printing"].includes(user.role) && current){
      validateRestrictedOrderChanges(user.role,new Map([[String(id),current]]),[item]);
    }

    const next={
      ...item,
      version:currentVersion+1,
      updatedAt:new Date().toISOString(),
      updatedBy:user.username
    };
    tx.set(ref,next,{merge:false});
    return next;
  });

  await db.collection("auditLogs").add({
    action:"entity_upsert",
    key,
    entityId:String(id),
    userId:user.id,
    username:user.username,
    role:user.role,
    at:new Date().toISOString()
  });

  return result;
}

export async function deleteEntity(key,id,expectedVersion,user){
  if(!COLLECTION_KEYS[key]){
    throw Object.assign(new Error("Nhóm dữ liệu này không hỗ trợ xóa theo từng bản ghi."),{status:400});
  }
  if(!canWriteKey(user.role,key)){
    throw Object.assign(new Error("Bạn không có quyền cập nhật dữ liệu này."),{status:403});
  }
  if(["htx_auto_quotes_v5","htx_customer_profiles_v10","htx_users_v6"].includes(key) && user.role!=="director"){
    throw Object.assign(new Error("Chỉ Giám đốc được xóa đơn hàng, khách hàng hoặc tài khoản."),{status:403});
  }
  if(key==="htx_users_v6"){
    throw Object.assign(new Error("Tài khoản phải được quản lý qua chức năng tài khoản."),{status:400});
  }

  const collection=COLLECTION_KEYS[key];
  const ref=db.collection(collection).doc(String(id).replaceAll("/","_"));

  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists)return;
    const current=snap.data();
    const currentVersion=Number(current?.version||0);
    const expected=Number(expectedVersion||0);
    if(currentVersion!==expected){
      throw Object.assign(new Error("Dữ liệu đã được người khác cập nhật. Không thể xóa phiên bản cũ."),{
        status:409,
        currentVersion
      });
    }
    tx.delete(ref);
  });

  await db.collection("auditLogs").add({
    action:"entity_delete",
    key,
    entityId:String(id),
    userId:user.id,
    username:user.username,
    role:user.role,
    at:new Date().toISOString()
  });

  return {ok:true};
}
