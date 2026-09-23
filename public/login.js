import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, deleteUser } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const EXPECTED_PROJECT_ID='in-hanh-tinh-xanh-ea08e';
const ROLES=new Set(['director','accounting','sales','designer','printing']);
const $=id=>document.getElementById(id);
let auth,db,config;

function usernameOf(v){
  const x=String(v||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(x)) throw new Error('Tên đăng nhập phải có 3–64 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  return x;
}
function setMessage(text,type=''){ $('authMsg').textContent=text||''; $('authMsg').className='msg'+(type?' '+type:''); }
function authMessage(err){
  const c=String(err?.code||'');
  if(c==='auth/operation-not-allowed') return 'Đăng nhập bằng mật khẩu đang bị tắt trong Firebase. Hãy bật Authentication → Sign-in method → Email/Password.';
  if(c==='auth/invalid-credential'||c==='auth/invalid-login-credentials'||c==='auth/wrong-password'||c==='auth/user-not-found') return 'Tên đăng nhập hoặc mật khẩu không đúng.';
  if(c==='auth/too-many-requests') return 'Đăng nhập sai quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.';
  if(c==='auth/network-request-failed') return 'Không kết nối được Firebase. Kiểm tra mạng rồi thử lại.';
  if(c==='auth/email-already-in-use') return 'Tài khoản cũ đã được chuyển sang Firebase nhưng chỉ mục đăng nhập chưa hoàn tất. Hãy liên hệ Giám đốc.';
  return String(err?.message||'Không đăng nhập được.');
}
async function loadConfig(){
  const r=await fetch('/firebase-applet-config.json',{cache:'no-store'});
  if(!r.ok) throw new Error('Không tải được cấu hình Firebase.');
  const c=await r.json();
  if(c.projectId!==EXPECTED_PROJECT_ID) throw new Error('Website đang trỏ sai Firebase project.');
  return c;
}
async function profileFor(uid){
  const s=await getDoc(doc(db,'users',uid));
  if(!s.exists()) return null;
  const u=s.data();
  if(u.active===false||!ROLES.has(u.role)) return null;
  return u;
}
async function resolveIndex(username){
  const s=await getDoc(doc(db,'loginIndex',username));
  return s.exists()?s.data():null;
}
function makeAuthEmail(){
  return 'u-'+crypto.randomUUID().replaceAll('-','')+'@auth.inhanhtinhxanh.invalid';
}
async function legacyBootstrap(username,password){
  const r=await fetch('/api/legacy-auth/verify',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password}),cache:'no-store'
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.ok) throw new Error(data.error||'Tên đăng nhập hoặc mật khẩu không đúng.');
  if(data.user?.role!=='director'||username!=='giamdoc') throw new Error('Tài khoản cũ này cần Giám đốc chuyển đổi trước.');

  const authEmail=makeAuthEmail();
  let cred=null;
  try{
    cred=await createUserWithEmailAndPassword(auth,authEmail,password);
    const uid=cred.user.uid, now=new Date().toISOString();
    const user={
      id:data.user.id,uid,username:'giamdoc',name:data.user.name||'Giám đốc',role:'director',
      active:true,accessApproved:true,authEmail,createdAt:data.user.createdAt||now,updatedAt:now,
      provisionedByDirectorId:String(data.user.id),provisionedAt:now,authMode:'password'
    };
    const batch=writeBatch(db);
    batch.set(doc(db,'users',uid),user);
    batch.set(doc(db,'loginIndex','giamdoc'),{username:'giamdoc',uid,userId:data.user.id,authEmail,active:true,createdAt:now,updatedAt:now});
    batch.set(doc(db,'config','directorOwner'),{uid,username:'giamdoc',userId:data.user.id,createdAt:now});
    await batch.commit();
    return user;
  }catch(err){
    if(cred?.user){ try{await deleteUser(cred.user);}catch{} }
    try{await signOut(auth);}catch{}
    throw err;
  }
}
async function login(username,password){
  const idx=await resolveIndex(username);
  if(idx){
    if(idx.active===false) throw new Error('Tài khoản đang bị khóa.');
    const cred=await signInWithEmailAndPassword(auth,idx.authEmail,password);
    const profile=await profileFor(cred.user.uid);
    if(!profile||profile.username!==username){
      await signOut(auth);
      throw new Error('Tài khoản chưa được Giám đốc cấp quyền hoặc đang bị khóa.');
    }
    return profile;
  }
  return await legacyBootstrap(username,password);
}
async function init(){
  try{
    config=await loadConfig();
    const app=initializeApp(config,'htx-internal-login-v313');
    auth=getAuth(app); db=getFirestore(app);
    await setPersistence(auth,browserLocalPersistence);
    try{await signOut(auth);}catch{}
    setMessage('');
    $('loginForm').addEventListener('submit',async e=>{
      e.preventDefault();
      $('loginBtn').disabled=true; setMessage('Đang xác thực…');
      try{
        const username=usernameOf($('loginUsername').value);
        const password=$('loginPassword').value;
        if(password.length<6) throw new Error('Mật khẩu không đúng.');
        const user=await login(username,password);
        setMessage('Đăng nhập thành công: '+(user.name||user.username)+'.','ok');
        location.replace('/app.html#orders');
      }catch(err){
        setMessage(authMessage(err));
        try{await signOut(auth);}catch{}
      }finally{$('loginBtn').disabled=false;}
    });
  }catch(err){
    setMessage(authMessage(err));
    $('loginBtn').disabled=true;
  }
}
init();