import { db } from "./firebase-admin.js";

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

let cachedConfig = null;
let lastConfigLoad = 0;

export async function getActiveGoogleSheetsConfig(){
  const now = Date.now();
  if (cachedConfig && now - lastConfigLoad < 30000) {
    return cachedConfig;
  }
  let url = String(process.env.GOOGLE_SHEETS_WEBAPP_URL || "").trim();
  let secret = String(process.env.GOOGLE_SHEETS_SYNC_SECRET || "").trim();
  let autoSync = true;

  try {
    const doc = await db.collection("settings").doc("google_sheets").get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (!url && data.url) url = String(data.url).trim();
      if (!secret && data.secret) secret = String(data.secret).trim();
      if (typeof data.autoSync === "boolean") autoSync = data.autoSync;
    }
  } catch (err) {
    console.warn("Lỗi đọc cấu hình Google Sheets từ Firestore:", err.message);
  }

  cachedConfig = {
    url,
    secret,
    autoSync,
    configured: Boolean(url && secret)
  };
  lastConfigLoad = now;
  return cachedConfig;
}

export async function saveGoogleSheetsConfig({ url, secret, autoSync = true }){
  const cleanUrl = String(url || "").trim();
  const cleanSecret = String(secret || "").trim();

  const update = {
    url: cleanUrl,
    autoSync: Boolean(autoSync),
    updatedAt: new Date().toISOString()
  };
  if (cleanSecret) {
    update.secret = cleanSecret;
  }

  await db.collection("settings").doc("google_sheets").set(update, { merge: true });
  cachedConfig = null;
  lastConfigLoad = 0;
  return getActiveGoogleSheetsConfig();
}

// Không đồng bộ htx_users_v6 sang Google Sheet để tránh đưa hash mật khẩu vào bảng tính.
export function isGoogleSheetsConfigured(){
  if (process.env.GOOGLE_SHEETS_WEBAPP_URL && process.env.GOOGLE_SHEETS_SYNC_SECRET) {
    return true;
  }
  return Boolean(cachedConfig?.configured);
}

async function config(){
  const cfg = await getActiveGoogleSheetsConfig();
  if (!cfg.configured) {
    const err = new Error("Google Sheets Sync chưa được cấu hình. Vui lòng nhập Web App URL và Secret.");
    err.code = "SHEETS_NOT_CONFIGURED";
    throw err;
  }
  return { url: cfg.url, secret: cfg.secret, autoSync: cfg.autoSync };
}

async function callAppsScript(action,payload={}){
  const {url,secret}=await config();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),25000);
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
  const cfg = await getActiveGoogleSheetsConfig();
  if(!cfg.configured)return {configured:false,ok:false};
  try{
    const data=await callAppsScript("ping");
    return {configured:true,ok:true,...data};
  }catch(error){
    return {configured:true,ok:false,error:String(error.message||error)};
  }
}

export async function syncKeyToGoogleSheets(key,value,meta={}){
  if(!SHEETS_SYNC_KEYS.includes(key))return {skipped:true,reason:"key_not_synced"};
  const cfg = await getActiveGoogleSheetsConfig();
  if(!cfg.configured)return {skipped:true,reason:"not_configured"};
  return callAppsScript("syncKey",{
    key,
    value,
    meta:{source:"hanh-tinh-xanh-v25",at:new Date().toISOString(),...meta}
  });
}

export async function syncAllToGoogleSheets(state,meta={}){
  const cfg = await getActiveGoogleSheetsConfig();
  if(!cfg.configured)return {skipped:true,reason:"not_configured"};
  const filtered={};
  for(const key of SHEETS_SYNC_KEYS){
    if(key in state)filtered[key]=state[key];
  }
  return callAppsScript("syncAll",{
    state:filtered,
    meta:{source:"hanh-tinh-xanh-v25",at:new Date().toISOString(),...meta}
  });
}

export async function pullAllFromGoogleSheets(){
  const cfg = await getActiveGoogleSheetsConfig();
  if(!cfg.configured)return {skipped:true,reason:"not_configured"};
  return callAppsScript("pullAll");
}

const pendingSheetsTimers = new Map();

/**
 * Tự động đẩy dữ liệu lên Google Sheet ngay khi có thao tác (lưu đơn, sửa đơn, đổi tiến độ, xóa đơn).
 * Áp dụng debounce nhẹ để gom các thao tác liên tiếp mà không gây nghẽn mạng.
 */
export function scheduleSheetsSync(key, readFn) {
  if (!SHEETS_SYNC_KEYS.includes(key)) return;
  if (pendingSheetsTimers.has(key)) {
    clearTimeout(pendingSheetsTimers.get(key));
  }
  pendingSheetsTimers.set(key, setTimeout(async () => {
    pendingSheetsTimers.delete(key);
    try {
      const cfg = await getActiveGoogleSheetsConfig();
      if (!cfg.configured || cfg.autoSync === false) return;
      const data = await readFn(key);
      const res = await syncKeyToGoogleSheets(key, data, { source: "auto_action_sync" });
      console.log(`[Google Sheets Auto-Sync] ${key}:`, res?.ok ? "Đã đồng bộ lên Sheet" : res);
    } catch (err) {
      console.warn(`[Google Sheets Auto-Sync Error] ${key}:`, err.message);
    }
  }, 400));
}

export { SHEETS_SYNC_KEYS };
