import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let firebaseApp=null;
let auth=null;
let db=null;
let unsubscribers=[];
let currentRole="";

const mappings=[
  {collection:"orders",key:"htx_auto_quotes_v5",sort:(a,b)=>Number(b.id||0)-Number(a.id||0)},
  {collection:"customers",key:"htx_customer_profiles_v10"},
  {collection:"inventory",key:"htx_inventory_v7"},
  {collection:"customProducts",key:"htx_custom_products_v7"}
];

const settingKeys=[
  "htx_work_month_v7",
  "htx_price_adjustments_v6",
  "htx_catalog_overrides_v7",
  "htx_payroll_v17"
];

function emitRealtime(key){
  window.dispatchEvent(new CustomEvent("htx:realtime",{detail:{key,at:Date.now()}}));
}

function writeCache(key,value){
  window.__HTXRealtimeHydrating=true;
  try{
    localStorage.setItem(key,JSON.stringify(value));
  }finally{
    window.__HTXRealtimeHydrating=false;
  }
  emitRealtime(key);
}

async function initFirebase(){
  if(firebaseApp)return;
  const res=await fetch("/api/firebase-config",{credentials:"same-origin"});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||"Không tải được Firebase config.");
  firebaseApp=initializeApp(data.config);
  auth=getAuth(firebaseApp);
  db=getFirestore(firebaseApp);
}

function stopListeners(){
  unsubscribers.forEach(fn=>{
    try{fn()}catch{}
  });
  unsubscribers=[];
}

function subscribeCollections(){
  stopListeners();

  for(const map of mappings){
    const unsub=onSnapshot(collection(db,map.collection),snap=>{
      const rows=snap.docs.map(d=>d.data());
      if(map.sort)rows.sort(map.sort);
      writeCache(map.key,rows);
    },err=>{
      console.error("Realtime",map.collection,err);
      window.dispatchEvent(new CustomEvent("htx:realtime-error",{detail:{message:err.message}}));
    });
    unsubscribers.push(unsub);
  }

  for(const key of settingKeys){
    if(key==="htx_payroll_v17" && !["director","accounting"].includes(currentRole))continue;
    const unsub=onSnapshot(doc(db,"settings",key),snap=>{
      if(!snap.exists())return;
      writeCache(key,snap.data()?.value ?? null);
    },err=>{
      console.error("Realtime setting",key,err);
    });
    unsubscribers.push(unsub);
  }
}

async function start(customToken,user){
  await initFirebase();
  currentRole=String(user?.role||"");
  await signInWithCustomToken(auth,customToken);
  subscribeCollections();
  return true;
}

async function stop(){
  stopListeners();
  if(auth){
    try{await signOut(auth)}catch{}
  }
}

window.HTXRealtime={start,stop,stopListeners};
window.HTXRealtimeReady=Promise.resolve(window.HTXRealtime);
