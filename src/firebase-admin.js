import { cert, applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function parseServiceAccount(){
  const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if(!raw)return null;
  const obj=JSON.parse(raw);
  if(obj.private_key)obj.private_key=obj.private_key.replace(/\\n/g,"\n");
  return obj;
}

if(!getApps().length){
  const serviceAccount=parseServiceAccount();
  const projectId=
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;

  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    ...(projectId?{projectId}:{})
  });
}

export const db=getFirestore();
db.settings({ignoreUndefinedProperties:true});

export const adminAuth=getAuth();
