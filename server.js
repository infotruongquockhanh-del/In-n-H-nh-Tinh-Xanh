import "dotenv/config";
import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loginUser,
  setSessionCookie,
  clearSessionCookie,
  requireSession,
  requireDirector,
  sanitizeUser,
  createRealtimeToken,
  restoreUserFromFirebaseIdToken
} from "./src/auth.js";
import { getFirebaseDiagnostics, verifyFirebaseConnection } from "./src/firebase-admin.js";
import {
  ensureBootstrap,
  readAllState,
  readStateKey,
  writeStateKey,
  upsertEntity,
  deleteEntity,
  getAuditLogs,
  getDatabaseSummary
} from "./src/state-store.js";
import {
  isGoogleSheetsConfigured,
  getActiveGoogleSheetsConfig,
  saveGoogleSheetsConfig,
  scheduleSheetsSync,
  pingGoogleSheets,
  syncKeyToGoogleSheets,
  syncAllToGoogleSheets,
  pullAllFromGoogleSheets,
  SHEETS_SYNC_KEYS
} from "./src/google-sheets-sync.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);

app.disable("x-powered-by");
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","same-origin");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  if(
    req.path==="/" ||
    req.path==="/index.html" ||
    req.path==="/app.html" ||
    req.path==="/service-worker.js" ||
    req.path==="/realtime.js" ||
    req.path==="/manifest.webmanifest"
  ){
    res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma","no-cache");
    res.setHeader("Expires","0");
    if(req.path==="/" || req.path==="/index.html" || req.path==="/app.html"){
      res.setHeader("Clear-Site-Data","\"cache\"");
    }
  }
  next();
});
app.use(express.json({limit:"8mb"}));
app.use(cookieParser());

app.get("/api/health",async(req,res)=>{
  const database=await verifyFirebaseConnection();
  res.status(database.connected?200:503).json({
    ok:database.connected,
    app:"Hành Tinh Xanh Full-stack",
    version:"27.4",
    commit:process.env.VERCEL_GIT_COMMIT_SHA||null,
    deployment:process.env.VERCEL_URL||null,
    database,
    time:new Date().toISOString()
  });
});

app.get("/api/firebase-config",(req,res)=>{
  let fileConfig={};
  try{
    const configPath=path.join(__dirname,"firebase-applet-config.json");
    if(fs.existsSync(configPath)){
      fileConfig=JSON.parse(fs.readFileSync(configPath,"utf8"));
    }
  }catch(err){
    console.warn("Không đọc được firebase-applet-config.json:",err.message);
  }

  const config={
    apiKey:process.env.FIREBASE_WEB_API_KEY||fileConfig.apiKey||"",
    authDomain:process.env.FIREBASE_AUTH_DOMAIN||fileConfig.authDomain||"",
    projectId:process.env.FIREBASE_PROJECT_ID||fileConfig.projectId||process.env.GOOGLE_CLOUD_PROJECT||"",
    storageBucket:process.env.FIREBASE_STORAGE_BUCKET||fileConfig.storageBucket||"",
    messagingSenderId:process.env.FIREBASE_MESSAGING_SENDER_ID||fileConfig.messagingSenderId||"",
    appId:process.env.FIREBASE_APP_ID||fileConfig.appId||"",
    firestoreDatabaseId:process.env.FIRESTORE_DATABASE_ID||fileConfig.firestoreDatabaseId||""
  };
  console.log("[API /api/firebase-config] resolved config:", {
    hasApiKey: !!config.apiKey,
    hasProjectId: !!config.projectId,
    hasAppId: !!config.appId,
    projectId: config.projectId
  });
  if(!config.apiKey || !config.projectId || !config.appId){
    return res.json({
      configured: false,
      config: null,
      message: "Firebase Web Config chưa cấu hình. Ứng dụng chạy chế độ API backend."
    });
  }
  res.json({configured: true, config});
});

app.post("/api/auth/temporary",async(req,res,next)=>{
  try{
    const user={
      id:202609190001,
      name:"Giám đốc",
      username:"giamdoc",
      role:"director",
      active:true
    };
    const sessionToken=await setSessionCookie(res,user,req);
    let firebaseToken=null;
    try{firebaseToken=await createRealtimeToken(user)}catch(err){console.warn("Temporary realtime token unavailable:",err.message)}
    res.json({
      ok:true,
      temporaryNoLogin:true,
      user:sanitizeUser(user),
      token:sessionToken,
      firebaseToken
    });
  }catch(err){next(err)}
});

app.post("/api/auth/login",async(req,res,next)=>{
  try{
    const {username,password}=req.body||{};
    if(!username || !password){
      return res.status(400).json({error:"Vui lòng nhập tài khoản và mật khẩu."});
    }
    const user=await loginUser(username,password);
    if(user?.disabled){
      return res.status(403).json({error:"Tài khoản này đang bị khóa."});
    }
    if(!user){
      return res.status(401).json({error:"Tên đăng nhập hoặc mật khẩu không đúng."});
    }
    const sessionToken=await setSessionCookie(res,user,req);
    const firebaseToken=await createRealtimeToken(user);
    res.json({ok:true,user:sanitizeUser(user),token:sessionToken,firebaseToken});
  }catch(err){next(err)}
});

app.get("/api/auth/me",requireSession,async(req,res,next)=>{
  try{
    await setSessionCookie(res,req.user,req);
    const firebaseToken=await createRealtimeToken(req.user);
    res.json({ok:true,user:sanitizeUser(req.user),firebaseToken});
  }catch(err){next(err)}
});

app.post("/api/auth/restore",async(req,res,next)=>{
  try{
    const header=String(req.headers.authorization||"");
    const match=header.match(/^Bearer\s+(.+)$/i);
    if(!match)return res.status(401).json({error:"Thiếu Firebase ID token."});
    const user=await restoreUserFromFirebaseIdToken(match[1]);
    if(user?.disabled)return res.status(403).json({error:"Tài khoản này đang bị khóa."});
    if(!user)return res.status(401).json({error:"Không thể khôi phục phiên đăng nhập."});
    const sessionToken=await setSessionCookie(res,user,req);
    const firebaseToken=await createRealtimeToken(user);
    res.json({ok:true,user:sanitizeUser(user),token:sessionToken,firebaseToken});
  }catch(err){
    if(String(err?.code||"").startsWith("auth/"))return res.status(401).json({error:"Phiên Firebase không còn hợp lệ."});
    next(err);
  }
});

app.get("/api/database-status",async(req,res)=>{
  const database=await verifyFirebaseConnection();
  res.status(database.connected?200:503).json({database});
});

app.post("/api/auth/logout",(req,res)=>{
  clearSessionCookie(res,req);
  res.json({ok:true});
});

app.get("/api/state",requireSession,async(req,res,next)=>{
  try{
    const state=await readAllState(req.user);
    res.json({state});
  }catch(err){next(err)}
});

app.put("/api/state/:key",requireSession,async(req,res,next)=>{
  try{
    const key=decodeURIComponent(req.params.key);
    const value=req.body?.value;
    const result=await writeStateKey(key,value,req.user);

    // Tự động đẩy lên Google Sheet ngay khi lưu dữ liệu
    scheduleSheetsSync(key,()=>readStateKey(key));

    res.json({ok:true,...result});
  }catch(err){next(err)}
});

app.put("/api/entity/:key/:id",requireSession,async(req,res,next)=>{
  try{
    const key=decodeURIComponent(req.params.key);
    const id=decodeURIComponent(req.params.id);
    const item=req.body?.item;
    const expectedVersion=Number(req.body?.expectedVersion||0);
    if(!item || typeof item!=="object"){
      return res.status(400).json({error:"Thiếu dữ liệu bản ghi."});
    }
    const saved=await upsertEntity(key,id,item,expectedVersion,req.user);

    // Tự động đẩy lên Google Sheet ngay khi có thao tác lưu/cập nhật đơn hoặc bản ghi
    scheduleSheetsSync(key,()=>readStateKey(key));

    res.json({ok:true,item:saved});
  }catch(err){next(err)}
});

app.delete("/api/entity/:key/:id",requireSession,async(req,res,next)=>{
  try{
    const key=decodeURIComponent(req.params.key);
    const id=decodeURIComponent(req.params.id);
    const expectedVersion=Number(req.body?.expectedVersion||req.query.expectedVersion||0);
    const result=await deleteEntity(key,id,expectedVersion,req.user);

    // Tự động cập nhật Google Sheet ngay khi có thao tác xóa
    scheduleSheetsSync(key,()=>readStateKey(key));

    res.json(result);
  }catch(err){next(err)}
});

app.get("/api/admin/audit",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const logs=await getAuditLogs(Number(req.query.limit||100));
    res.json({logs});
  }catch(err){next(err)}
});

app.get("/api/admin/database-summary",requireSession,requireDirector,async(req,res,next)=>{
  try{
    res.json({summary:await getDatabaseSummary()});
  }catch(err){next(err)}
});

app.get("/api/admin/sheets/config",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const cfg=await getActiveGoogleSheetsConfig();
    res.json({
      configured:cfg.configured,
      url:cfg.url,
      hasSecret:Boolean(cfg.secret),
      autoSync:cfg.autoSync
    });
  }catch(err){next(err)}
});

app.post("/api/admin/sheets/config",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const {url,secret,autoSync}=req.body||{};
    const updated=await saveGoogleSheetsConfig({url,secret,autoSync});
    res.json({
      ok:true,
      configured:updated.configured,
      url:updated.url,
      hasSecret:Boolean(updated.secret),
      autoSync:updated.autoSync
    });
  }catch(err){next(err)}
});

app.get("/api/admin/sheets/status",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const cfg=await getActiveGoogleSheetsConfig();
    res.json({
      configured:cfg.configured,
      autoSync:cfg.autoSync,
      status:await pingGoogleSheets()
    });
  }catch(err){next(err)}
});

app.post("/api/admin/sheets/push-all",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const state=await readAllState(req.user);
    const result=await syncAllToGoogleSheets(state,{
      username:req.user.username,
      role:req.user.role,
      mode:"manual_push_all"
    });
    res.json({ok:true,result});
  }catch(err){next(err)}
});

app.post("/api/admin/sheets/pull-all",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const pulled=await pullAllFromGoogleSheets();
    if(pulled?.skipped){
      return res.status(400).json({error:"Google Sheets Sync chưa được cấu hình."});
    }

    const state=pulled.state||{};
    const results={};
    for(const key of SHEETS_SYNC_KEYS){
      if(!(key in state))continue;
      results[key]=await writeStateKey(key,state[key],req.user);
    }

    res.json({ok:true,imported:Object.keys(results),results});
  }catch(err){next(err)}
});

app.post("/api/admin/sheets/sync-two-way",requireSession,requireDirector,async(req,res,next)=>{
  try{
    const pulled=await pullAllFromGoogleSheets();
    if(pulled?.skipped){
      return res.status(400).json({error:"Google Sheets Sync chưa được cấu hình. Vui lòng thiết lập URL và Secret."});
    }

    const state=pulled.state||{};
    const results={};
    for(const key of SHEETS_SYNC_KEYS){
      if(!(key in state))continue;
      results[key]=await writeStateKey(key,state[key],req.user);
    }

    // Đẩy lại toàn bộ để Google Sheet cập nhật các trường được chuẩn hóa
    const freshState=await readAllState(req.user);
    await syncAllToGoogleSheets(freshState,{
      username:req.user.username,
      role:req.user.role,
      mode:"sync_two_way"
    });

    res.json({ok:true,imported:Object.keys(results),results,message:"Đã hoàn tất đồng bộ hai chiều với Google Sheet."});
  }catch(err){next(err)}
});

app.use(express.static(path.join(__dirname,"public"),{
  maxAge:0,
  etag:true,
  lastModified:true,
  setHeaders(res,filePath){
    if(/(?:app\.html|service-worker\.js|realtime\.js|manifest\.webmanifest)$/.test(filePath)){
      res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  }
}));

app.get(["/", "/index.html"],(req,res)=>{
  res.sendFile(path.join(__dirname,"public","app.html"));
});

app.use((err,req,res,next)=>{
  console.error(err);
  const status=Number(err.status||500);
  res.status(status).json({
    error:status>=500
      ?"Lỗi máy chủ. Kiểm tra cấu hình hệ thống và nhật ký máy chủ."
      :String(err.message||"Yêu cầu không hợp lệ."),
    ...(err.currentVersion!==undefined?{currentVersion:err.currentVersion}:{})
  });
});

async function bootstrap(){
  try{
    const bootstrap=await ensureBootstrap();
    if(bootstrap.created){
      console.log("Đã khởi tạo dữ liệu mặc định và tài khoản giamdoc.");
    }
  }catch(err){
    console.error("Không khởi tạo được bootstrap:",err);
  }
}

await bootstrap();

if(!process.env.VERCEL){
  app.listen(port,"0.0.0.0",()=>{
    console.log(`Hành Tinh Xanh V27 Online: http://0.0.0.0:${port}`);
  });
}

export default app;
