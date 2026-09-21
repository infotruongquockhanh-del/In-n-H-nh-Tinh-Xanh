const SHEETS_SYNC_KEYS = [
  "htx_auto_quotes_v5",
  "htx_customer_profiles_v10",
  "htx_inventory_v7",
  "htx_custom_products_v7",
  "htx_payroll_v17",
  "htx_work_month_v7",
  "htx_price_adjustments_v6",
  "htx_catalog_overrides_v7"
];

// Không đồng bộ htx_users_v6 sang Google Sheet để tránh đưa hash mật khẩu vào bảng tính.
export function isGoogleSheetsConfigured(){
  return !!(
    process.env.GOOGLE_SHEETS_WEBAPP_URL &&
    process.env.GOOGLE_SHEETS_SYNC_SECRET
  );
}

function config(){
  const url=String(process.env.GOOGLE_SHEETS_WEBAPP_URL||"").trim();
  const secret=String(process.env.GOOGLE_SHEETS_SYNC_SECRET||"").trim();
  if(!url || !secret){
    const err=new Error("Google Sheets Sync chưa được cấu hình.");
    err.code="SHEETS_NOT_CONFIGURED";
    throw err;
  }
  return {url,secret};
}

async function callAppsScript(action,payload={}){
  const {url,secret}=config();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const res=await fetch(url,{
      method:"POST",
      redirect:"follow",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({secret,action,...payload}),
      signal:controller.signal
    });

    const text=await res.text();
    let data;
    try{data=JSON.parse(text)}catch{
      throw new Error(`Apps Script trả về dữ liệu không hợp lệ: ${text.slice(0,180)}`);
    }
    if(!res.ok || data.ok===false){
      throw new Error(data.error||`Google Sheets Sync lỗi HTTP ${res.status}`);
    }
    return data;
  }finally{
    clearTimeout(timeout);
  }
}

export async function pingGoogleSheets(){
  if(!isGoogleSheetsConfigured())return {configured:false,ok:false};
  try{
    const data=await callAppsScript("ping");
    return {configured:true,ok:true,...data};
  }catch(error){
    return {configured:true,ok:false,error:String(error.message||error)};
  }
}

export async function syncKeyToGoogleSheets(key,value,meta={}){
  if(!SHEETS_SYNC_KEYS.includes(key))return {skipped:true,reason:"key_not_synced"};
  if(!isGoogleSheetsConfigured())return {skipped:true,reason:"not_configured"};
  return callAppsScript("syncKey",{
    key,
    value,
    meta:{source:"hanh-tinh-xanh-v23",at:new Date().toISOString(),...meta}
  });
}

export async function syncAllToGoogleSheets(state,meta={}){
  if(!isGoogleSheetsConfigured())return {skipped:true,reason:"not_configured"};
  const filtered={};
  for(const key of SHEETS_SYNC_KEYS){
    if(key in state)filtered[key]=state[key];
  }
  return callAppsScript("syncAll",{
    state:filtered,
    meta:{source:"hanh-tinh-xanh-v23",at:new Date().toISOString(),...meta}
  });
}

export async function pullAllFromGoogleSheets(){
  if(!isGoogleSheetsConfigured())return {skipped:true,reason:"not_configured"};
  return callAppsScript("pullAll");
}

export { SHEETS_SYNC_KEYS };
