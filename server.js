import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import { verifyPassword, approved, publicUser } from './src/access-policy.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const legacyDb=JSON.parse(fs.readFileSync(path.join(__dirname,'data','local-database.json'),'utf8'));
const legacyUsers=Array.isArray(legacyDb.htx_users_v6)?legacyDb.htx_users_v6:[];
const legacyAttempts=new Map();
app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(req.path==='/'||req.path==='/index.html'||req.path==='/app.html'||req.path==='/firebase-native-v31.js'){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  }
  next();
});
app.get('/api/health',(req,res)=>res.json({ok:true,version:'31.3.0',mode:'firebase-native',authentication:'firebase-password'}));
app.post('/api/legacy-auth/verify',(req,res)=>{
  const username=String(req.body?.username||'').trim().toLowerCase();
  const password=typeof req.body?.password==='string'?req.body.password:'';
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
  const key=ip+'|'+username, now=Date.now(), state=legacyAttempts.get(key)||{count:0,until:0};
  if(state.until>now) return res.status(429).json({ok:false,error:'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.'});
  const user=legacyUsers.find(x=>String(x.username||'').toLowerCase()===username);
  if(!user||!approved(user)||!verifyPassword(username,password,user.passwordHash)){
    const count=state.count+1;
    legacyAttempts.set(key,count>=5?{count:0,until:now+10*60*1000}:{count,until:0});
    return res.status(401).json({ok:false,error:'Tên đăng nhập hoặc mật khẩu không đúng.'});
  }
  legacyAttempts.delete(key);
  return res.json({ok:true,user:publicUser(user)});
});
app.get('/firebase-applet-config.json',(req,res)=>res.sendFile(path.join(__dirname,'firebase-applet-config.json')));
app.get(['/', '/index.html', '/login', '/login.html'],(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','login.html'));
});
app.get(['/app', '/app.html'],(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(__dirname,'public','app.html'));
});
app.use(express.static(path.join(__dirname,'public'),{maxAge:0,etag:true,lastModified:true}));
app.use('/api',(req,res)=>res.status(410).json({error:'API máy chủ cũ đã tắt. Ứng dụng V31 dùng Firebase Web SDK trực tiếp.',code:'FIREBASE_NATIVE_CLIENT'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Lỗi máy chủ tĩnh.',code:'STATIC_SERVER_ERROR'});});
if(!process.env.VERCEL) app.listen(port,'0.0.0.0',()=>console.log('Hành Tinh Xanh V31 Firebase Native: http://0.0.0.0:'+port));
export default app;
