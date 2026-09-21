import "dotenv/config";
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
import {
  ensureBootstrap,
  readAllState,
  writeStateKey,
  upsertEntity,
  deleteEntity,
  getAuditLogs,
  getDatabaseSummary
} from "./src/state-store.js";
import {
  isGoogleSheetsConfigured,
  pingGoogleSheets,
  syncKeyToGoogleSheets,
  syncAllToGoogleSheets,
  pullAllFromGoogleSheets,
  SHEETS_SYNC_KEYS
} from "./src/google-sheets-sync.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||8080);

app.disable("x-powered-by");
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","same-origin");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({limit:"8mb"}));
app.use(cookieParser());

app.get("/api/health",(req,res)=>{
  res.json({
    ok:true,
    app:"Hành Tinh Xanh Full-stack",
    version:26,
    time:new Date().toISOString()
  });
});


app.get("/api/firebase-config",(req,res)=>{
  const config={
    apiKey:process.env.FIREBASE_WEB_API_KEY||"",
    authDomain:process.env.FIREBASE_AUTH_DOMAIN||"",
    projectId:process.env.FIREBASE_PROJECT_ID||process.env.GOOGLE_CLOUD_PROJECT||"",
    storageBucket:process.env.FIREBASE_STORAGE_BUCKET||"",
    messagingSenderId:process.env.FIREBASE_MESSAGING_SENDER_ID||"",
    appId:process.env.FIREBASE_APP_ID||""
  };
  if(!config.apiKey || !config.projectId || !config.appId){
    return res.status(503).json({
      error:"Thiếu Firebase Web Config. Hãy cấu hình FIREBASE_WEB_API_KEY, FIREBASE_PROJECT_ID và FIREBASE_APP_ID trên Vercel."
    });
  }
  res.json({config});
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
    await setSessionCookie(res,user);
    const firebaseToken=await createRealtimeToken(user);
    res.json({user:sanitizeUser(user),firebaseToken});
  }catch(err){next(err)}
});

app.get("/api/auth/me",requireSession,async(req,res,next)=>{
  try{
    // Rolling session: mỗi lần F5/khôi phục phiên sẽ gia hạn cookie.
    await setSessionCookie(res,req.user);
    const firebaseToken=await createRealtimeToken(req.user);
    res.json({user:sanitizeUser(req.user),firebaseToken});
  }catch(err){next(err)}
});

app.post("/api/auth/restore",async(req,res,next)=>{
  try{
    const header=String(req.headers.authorization||"");
    const match=header.match(/^Bearer\s+(.+)$/i);
    if(!match){
      return res.status(401).json({error:"Thiếu Firebase ID token để khôi phục phiên."});
    }

    const user=await restoreUserFromFirebaseIdToken(match[1]);
    if(user?.disabled){
      return res.status(403).json({error:"Tài khoản này đang bị khóa."});
    }
    if(!user){
      return res.status(401).json({error:"Không thể khôi phục phiên đăng nhập."});
    }

    await setSessionCookie(res,user);
    const firebaseToken=await createRealtimeToken(user);
    res.json({user:sanitizeUser(user),firebaseToken});
  }catch(err){
    if(String(err?.code||"").startsWith("auth/")){
      return res.status(401).json({error:"Phiên Firebase không còn hợp lệ. Vui lòng đăng nhập lại."});
    }
    next(err);
  }
});

app.post("/api/auth/logout",(req,res)=>{
  clearSessionCookie(res);
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

    let sheets={skipped:true};
    try{
      sheets=await syncKeyToGoogleSheets(key,value,{
        username:req.user.username,
        role:req.user.role
      });
    }catch(error){
      console.warn("Google Sheets mirror failed:",error.message);
      sheets={ok:false,error:error.message};
    }

    res.json({ok:true,...result,sheets});
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

    // Google Sheet được mirror theo batch state ở các lần Push All;
    // entity realtime ưu tiên Firestore để tránh làm chậm thao tác.
    res.json({ok:true,item:saved});
  }catch(err){next(err)}
});

app.delete("/api/entity/:key/:id",requireSession,async(req,res,next)=>{
  try{
    const key=decodeURIComponent(req.params.key);
    const id=decodeURIComponent(req.params.id);
    const expectedVersion=Number(req.body?.expectedVersion||req.query.expectedVersion||0);
    const result=await deleteEntity(key,id,expectedVersion,req.user);
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

app.get("/api/admin/sheets/status",requireSession,requireDirector,async(req,res,next)=>{
  try{
    res.json({
      configured:isGoogleSheetsConfigured(),
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

app.use(express.static(path.join(__dirname,"public"),{
  maxAge:process.env.NODE_ENV==="production"?"1h":0
}));

app.get("/",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","app.html"));
});

app.use((err,req,res,next)=>{
  console.error(err);
  const status=Number(err.status||500);
  res.status(status).json({
    error:status>=500
      ?"Lỗi máy chủ. Kiểm tra cấu hình Firebase/Firestore và nhật ký Vercel."
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
    console.error("Không khởi tạo được Firestore:",err);
  }
}

await bootstrap();

export default app;

// Chỉ listen khi chạy local bằng `npm start`.
// Trên Vercel, Express app được export trực tiếp thành Function.
if(!process.env.VERCEL){
  app.listen(port,"0.0.0.0",()=>{
    console.log(`Hành Tinh Xanh V25 Online Realtime: http://localhost:${port}`);
  });
}
