import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import accessRoutes from './src/access-routes.js';
import routesV30 from './src/routes-v30.js';
import { ensureBackendReady } from './src/backend-ready.js';
import { verifyFirebaseConnection, getFirebaseDiagnostics } from './src/firebase-admin.js';
import { readAllState, writeStateKey, upsertEntity, deleteEntity, getDatabaseSummary } from './src/state-store.js';
import { settingDigests } from './src/data-safety.js';
import { publicDatabaseFailure } from './src/database-errors.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(),port=Number(process.env.PORT||3000);
app.set('trust proxy',1);app.disable('x-powered-by');
app.use((req,res,next)=>{req.requestId=String(req.get('x-request-id')||randomUUID());res.setHeader('X-Request-ID',req.requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');if(/%2e/i.test(req.originalUrl||''))return res.status(404).send('Không tìm thấy trang.');next();});
app.use(express.json({limit:'12mb'}));app.use(cookieParser());

app.get('/api/health',async(req,res)=>{
  try{
    await ensureBackendReady();
    const db=await verifyFirebaseConnection();
    res.status(db.connected?200:503).json({ok:!!db.connected,version:'32.0.0',authentication:'internal-password',storage:'server-firestore',database:db.connected?'connected':'unavailable',code:db.code});
  }catch(err){
    const failure=publicDatabaseFailure(err)||{code:'DB_UNAVAILABLE',error:'Cơ sở dữ liệu chưa sẵn sàng.'};
    res.status(503).json({ok:false,version:'32.0.0',authentication:'internal-password',storage:'server-firestore',...failure,requestId:req.requestId});
  }
});

app.use(accessRoutes);

app.get('/api/state',async(req,res,next)=>{
  try{const state=await readAllState(req.user);res.json({state,settingDigests:await settingDigests(req.user,state)});}catch(err){next(err);}
});
app.put('/api/state/:key',async(req,res,next)=>{
  try{res.json({ok:true,...await writeStateKey(req.params.key,req.body?.value,req.user,req.body?.expectedDigest)});}catch(err){next(err);}
});
app.put('/api/entity/:key/:id',async(req,res,next)=>{
  try{res.json({ok:true,item:await upsertEntity(req.params.key,req.params.id,req.body?.item,Number(req.body?.expectedVersion||0),req.user,req.body?.mutationId||'')});}catch(err){next(err);}
});
app.delete('/api/entity/:key/:id',async(req,res,next)=>{
  try{res.json({ok:true,...await deleteEntity(req.params.key,req.params.id,Number(req.body?.expectedVersion||0),req.user)});}catch(err){next(err);}
});
app.get('/api/database-status',async(req,res,next)=>{
  try{res.json({database:{...getFirebaseDiagnostics(),...await verifyFirebaseConnection()}});}catch(err){next(err);}
});
app.get('/api/admin/database-summary',async(req,res,next)=>{try{res.json({summary:await getDatabaseSummary()});}catch(err){next(err);}});
app.use(routesV30);

app.use(express.static(path.join(__dirname,'public'),{maxAge:0,etag:true,lastModified:true,index:false}));
app.use((req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'API không tồn tại.'});res.status(404).send('Không tìm thấy trang.');});
app.use((err,req,res,next)=>{
  const failure=publicDatabaseFailure(err);
  if(failure)return res.status(err.status||503).json({...failure,requestId:req.requestId});
  const status=Number(err.status||500);
  if(status>=500)console.error(JSON.stringify({event:'HTX_SERVER_ERROR',requestId:req.requestId,status,code:err.code||'SERVER_ERROR'}));
  res.status(status).json({error:status>=500?'Máy chủ gặp lỗi khi xử lý yêu cầu.':String(err.message||'Yêu cầu không hợp lệ.'),...(err.code?{code:err.code}:{}),requestId:req.requestId});
});
if(!process.env.VERCEL)app.listen(port,'0.0.0.0',()=>console.log('Hành Tinh Xanh V32: http://0.0.0.0:'+port));
export default app;
