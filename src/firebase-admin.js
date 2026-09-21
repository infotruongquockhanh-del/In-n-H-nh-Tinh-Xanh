import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { localDb } from "./local-store.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
function readAppletConfig(){
  try{const p=path.join(__dirname,"..","firebase-applet-config.json");if(fs.existsSync(p))return JSON.parse(fs.readFileSync(p,"utf8"));}catch(err){console.warn("[Firebase] applet config:",err.message)}
  return {};
}
function normalizePrivateKey(v){return String(v||"").replace(/\\n/g,"\n").trim()}
function parseJsonCredential(raw){
  if(!raw)return null;
  let parsed=JSON.parse(String(raw).trim());
  if(typeof parsed==="string")parsed=JSON.parse(parsed);
  if(parsed.private_key)parsed.private_key=normalizePrivateKey(parsed.private_key);
  return parsed;
}
function parseBase64Credential(raw){if(!raw)return null;return parseJsonCredential(Buffer.from(String(raw).trim(),"base64").toString("utf8"))}

const appletConfig=readAppletConfig();
export const firebaseProjectId=String(process.env.FIREBASE_PROJECT_ID||appletConfig.projectId||process.env.GOOGLE_CLOUD_PROJECT||"").trim();
export const firestoreDatabaseId=String(process.env.FIRESTORE_DATABASE_ID||appletConfig.firestoreDatabaseId||"(default)").trim();
let firestoreInstance=null;
let authInstance=null;
let firebaseInitError=null;
let credentialSource="none";

function resolveCredential(){
  const json=parseJsonCredential(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if(json){credentialSource="service_account_json";return cert(json)}
  const b64=parseBase64Credential(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
  if(b64){credentialSource="service_account_base64";return cert(b64)}
  const email=String(process.env.FIREBASE_CLIENT_EMAIL||"").trim();
  const key=normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if(email&&key&&firebaseProjectId){credentialSource="service_account_fields";return cert({projectId:firebaseProjectId,clientEmail:email,privateKey:key})}
  if(!process.env.VERCEL){credentialSource="application_default";return applicationDefault()}
  throw new Error("Thiếu Firebase Admin credentials trên Vercel. Cấu hình FIREBASE_SERVICE_ACCOUNT_JSON hoặc FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.");
}
try{
  if(!firebaseProjectId)throw new Error("Thiếu FIREBASE_PROJECT_ID.");
  const credential=resolveCredential();
  const adminApp=getApps().length?getApps()[0]:initializeApp({credential,projectId:firebaseProjectId});
  firestoreInstance=firestoreDatabaseId&&firestoreDatabaseId!=="(default)"?getFirestore(adminApp,firestoreDatabaseId):getFirestore(adminApp);
  firestoreInstance.settings({ignoreUndefinedProperties:true});
  authInstance=getAuth(adminApp);
  console.log("[Firebase] Admin configured",{projectId:firebaseProjectId,databaseId:firestoreDatabaseId,credentialSource});
}catch(err){firebaseInitError=err;console.error("[Firebase] Admin init failed:",err.message)}

const allowLocalStore=process.env.ALLOW_LOCAL_STORE==="true"&&!process.env.VERCEL;
function unavailableError(){const e=new Error("Cloud Firestore chưa kết nối: "+(firebaseInitError?.message||"Firebase Admin chưa sẵn sàng."));e.status=503;e.code="FIREBASE_NOT_CONFIGURED";return e}
const unavailableDb=new Proxy({}, {get(_t,p){if(p==="settings")return()=>{};return()=>{throw unavailableError()}}});
const unavailableAuth={async createCustomToken(){throw unavailableError()},async verifyIdToken(){throw unavailableError()}};
export const db=firestoreInstance||(allowLocalStore?localDb:unavailableDb);
export const adminAuth=authInstance||unavailableAuth;
export function getFirebaseDiagnostics(){
  const missing=[];
  if(!firebaseProjectId)missing.push("FIREBASE_PROJECT_ID");
  if(process.env.VERCEL&&credentialSource==="none")missing.push("FIREBASE_SERVICE_ACCOUNT_JSON hoặc FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY");
  return {initialized:Boolean(firestoreInstance),projectId:firebaseProjectId||null,databaseId:firestoreDatabaseId||"(default)",credentialSource,localStoreEnabled:allowLocalStore,missing,error:firebaseInitError?.message||null};
}
export async function verifyFirebaseConnection(){
  const d=getFirebaseDiagnostics();
  if(!firestoreInstance)return {...d,connected:false};
  try{await firestoreInstance.collection("config").doc("bootstrap").get();return {...d,connected:true,error:null}}
  catch(err){return {...d,connected:false,error:err.message}}
}
