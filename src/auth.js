import { createHash, randomBytes } from 'node:crypto';
import { db } from './firebase-admin.js';
import { SESSION_COOKIE } from './constants.js';
import { ACCESS_POLICY_VERSION, publicUser, hashPassword, verifyPassword, validSessionClaims, fail, approved } from './access-policy.js';

const SESSION_MS=12*60*60*1000;
const tokenHash=token=>createHash('sha256').update(String(token||'')).digest('hex');

export const passwordHash=(username,password)=>hashPassword(password);
export const sanitizeUser=publicUser;
export function simpleHash(text){let h=2166136261;for(const ch of String(text??'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}

export async function loginUser(username,password){
  const uname=String(username||'').trim().toLowerCase();
  if(!uname||uname.length>64||typeof password!=='string'||!password.length||password.length>128)return null;
  const query=db.collection('users').where('username','==',uname).limit(2);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(query);
    if(snap.size!==1)return null;
    const doc=snap.docs[0];
    const user={...doc.data(),id:doc.data().id??doc.id};
    if(!approved(user)||!verifyPassword(uname,password,user.passwordHash))return null;
    const changes={lastLoginAt:new Date().toISOString(),mustChangePassword:false};
    if(!String(user.passwordHash||'').startsWith('scrypt$')&&password.length>=8)changes.passwordHash=hashPassword(password);
    tx.set(db.collection('users').doc(doc.id),changes,{merge:true});
    return {...user,...changes};
  });
}

function cookieOptions(req){
  return {httpOnly:true,sameSite:'lax',path:'/',secure:process.env.NODE_ENV==='production'||!!req?.secure||req?.headers?.['x-forwarded-proto']==='https'};
}
export async function setSessionCookie(res,user,req=null){
  if(!approved(user))throw fail('Tài khoản chưa được cấp quyền truy cập.',403);
  const token=randomBytes(32).toString('base64url');
  const id=tokenHash(token),now=Date.now();
  await db.collection('sessions').doc(id).set({
    userId:String(user.id),authVersion:Number(user.authVersion||0),policy:ACCESS_POLICY_VERSION,
    createdAt:new Date(now).toISOString(),expiresAt:new Date(now+SESSION_MS).toISOString()
  });
  res.cookie(SESSION_COOKIE,token,{...cookieOptions(req),maxAge:SESSION_MS});
}
export function clearSessionCookie(res,req=null){res.clearCookie(SESSION_COOKIE,cookieOptions(req));}

export async function getSessionUser(req){
  const token=req.cookies?.[SESSION_COOKIE];
  if(!token)return null;
  const sid=tokenHash(token);
  const sessionDoc=await db.collection('sessions').doc(sid).get();
  if(!sessionDoc.exists)return null;
  const session=sessionDoc.data();
  if(!session?.expiresAt||Date.parse(session.expiresAt)<=Date.now()){await db.collection('sessions').doc(sid).delete().catch(()=>{});return null;}
  const uid=String(session.userId||'');
  if(!uid||uid.includes('/'))return null;
  const doc=await db.collection('users').doc(uid).get();
  if(!doc.exists)return null;
  const user={...doc.data(),id:doc.data().id??doc.id};
  const payload={uid,sv:Number(session.authVersion||0),policy:Number(session.policy||0)};
  return validSessionClaims(payload,user)?user:null;
}
export async function requireSession(req,res,next){
  try{
    const user=await getSessionUser(req);
    if(!user)return res.status(401).json({error:'Vui lòng đăng nhập để tiếp tục.',code:'LOGIN_REQUIRED'});
    req.user=user;next();
  }catch(err){next(err);}
}
export function requireDirector(req,res,next){
  if(req.user?.role!=='director')return res.status(403).json({error:'Chỉ Giám đốc có quyền thực hiện thao tác này.'});
  next();
}
export async function revokeSessions(user){
  if(!user)return;
  const ref=db.collection('users').doc(String(user.id));
  await db.runTransaction(async tx=>{
    const doc=await tx.get(ref);
    if(doc.exists)tx.set(ref,{authVersion:Number(doc.data().authVersion||0)+1},{merge:true});
  });
}
export async function changeOwnPassword(user,currentPassword,newPassword){
  const passwordHash=hashPassword(newPassword);
  const ref=db.collection('users').doc(String(user.id));
  return db.runTransaction(async tx=>{
    const doc=await tx.get(ref);
    if(!doc.exists||!approved(doc.data())||Number(doc.data().authVersion||0)!==Number(user.authVersion||0))throw fail('Vui lòng đăng nhập lại.',401);
    const old=doc.data();
    if(!verifyPassword(old.username,currentPassword,old.passwordHash))throw fail('Mật khẩu hiện tại không đúng.',400);
    if(newPassword===currentPassword)throw fail('Mật khẩu mới phải khác mật khẩu hiện tại.');
    const next={...old,passwordHash,mustChangePassword:false,authVersion:Number(old.authVersion||0)+1,updatedAt:new Date().toISOString()};
    tx.set(ref,next);return next;
  });
}
export async function createRealtimeToken(){return null;}
export async function restoreUserFromFirebaseIdToken(){return null;}
