import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
app.set('trust proxy',1);
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(req.path==='/'||req.path==='/index.html'||req.path==='/app.html'||req.path==='/firebase-native-v31.js'){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  }
  next();
});
app.get('/api/health',(req,res)=>res.json({ok:true,version:'31.2.0',mode:'firebase-native',authentication:'firebase-google'}));
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
