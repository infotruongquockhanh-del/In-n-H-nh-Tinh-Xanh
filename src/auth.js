import { SignJWT, jwtVerify } from "jose";
import { db, adminAuth } from "./firebase-admin.js";
import { SESSION_COOKIE } from "./constants.js";

const fallbackSecret="HTX_DEV_ONLY_CHANGE_THIS_SESSION_SECRET_2026";
const secretText=process.env.SESSION_SECRET || fallbackSecret;
const secret=new TextEncoder().encode(secretText);

if(process.env.NODE_ENV==="production" && !process.env.SESSION_SECRET){
  console.warn("[SECURITY] SESSION_SECRET chưa được cấu hình. Hãy thêm secret riêng trong Google AI Studio/Cloud Run.");
}

export function simpleHash(text){
  let h=2166136261;
  const str=String(text??"");
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return ("00000000"+(h>>>0).toString(16)).slice(-8);
}

export function passwordHash(username,password){
  return simpleHash(`${String(username).toLowerCase()}|HTX|${password}`);
}

export function sanitizeUser(user,{includePasswordHash=false}={}){
  if(!user)return null;
  const copy={...user};
  if(!includePasswordHash)delete copy.passwordHash;
  return copy;
}

export async function createRealtimeToken(user){
  const uid=String(user.id);
  return adminAuth.createCustomToken(uid,{
    username:String(user.username||""),
    role:String(user.role||""),
    name:String(user.name||"")
  });
}

export async function restoreUserFromFirebaseIdToken(idToken){
  const decoded=await adminAuth.verifyIdToken(String(idToken||""),true);
  const uid=String(decoded.uid||"");
  if(!uid)return null;
  const doc=await db.collection("users").doc(uid).get();
  if(!doc.exists)return null;
  const user=doc.data();
  if(user.active===false)return {disabled:true};
  return user;
}

async function signSession(user){
  return new SignJWT({
    uid:String(user.id),
    username:user.username,
    role:user.role
  })
    .setProtectedHeader({alg:"HS256"})
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export { signSession };

export async function loginUser(username,password){
  const uname=String(username||"").trim().toLowerCase();
  const snap=await db.collection("users").where("username","==",uname).limit(1).get();
  if(snap.empty)return null;
  const user=snap.docs[0].data();
  if(user.active===false)return {disabled:true};
  if(user.passwordHash!==passwordHash(uname,password))return null;
  return user;
}

export async function setSessionCookie(res,user,req=null){
  const token=await signSession(user);
  const isHttps = Boolean(
    process.env.NODE_ENV==="production" ||
    (req && (req.secure || req.headers?.["x-forwarded-proto"]==="https"))
  );
  res.cookie(SESSION_COOKIE,token,{
    httpOnly:true,
    sameSite:"lax",
    secure:isHttps,
    maxAge:30*24*60*60*1000,
    path:"/"
  });
  return token;
}

export function clearSessionCookie(res,req=null){
  const isHttps = Boolean(
    process.env.NODE_ENV==="production" ||
    (req && (req.secure || req.headers?.["x-forwarded-proto"]==="https"))
  );
  res.clearCookie(SESSION_COOKIE,{
    httpOnly:true,
    sameSite:"lax",
    secure:isHttps,
    path:"/"
  });
}

export async function getSessionUser(req){
  let token=req.cookies?.[SESSION_COOKIE];
  const authHeader=req.headers?.authorization;
  if(!token && authHeader && typeof authHeader==="string" && authHeader.startsWith("Bearer ")){
    token=authHeader.slice(7).trim();
  }
  if(!token)return null;
  try{
    const {payload}=await jwtVerify(token,secret);
    const uid=String(payload.uid||"");
    if(!uid)return null;
    const doc=await db.collection("users").doc(uid).get();
    if(!doc.exists)return null;
    const user=doc.data();
    if(user.active===false)return null;
    return user;
  }catch{
    return null;
  }
}

export async function requireSession(req,res,next){
  try{
    const user=await getSessionUser(req);
    if(!user)return res.status(401).json({error:"Phiên đăng nhập không hợp lệ hoặc đã hết hạn."});
    req.user=user;
    next();
  }catch(err){
    next(err);
  }
}

export function requireDirector(req,res,next){
  if(req.user?.role!=="director"){
    return res.status(403).json({error:"Chỉ Giám đốc có quyền thực hiện thao tác này."});
  }
  next();
}
