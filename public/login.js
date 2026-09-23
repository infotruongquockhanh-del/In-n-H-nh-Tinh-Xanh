import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const EXPECTED_PROJECT_ID='in-hanh-tinh-xanh-ea08e';
const OWNER_EMAILS=new Set(['info.truongquockhanh@gmail.com','inhanhtinhxanh@gmail.com']);
const ROLE_LABELS={director:'Giám đốc',accounting:'Kế toán',sales:'Nhân viên bán hàng',designer:'Nhân viên thiết kế',printing:'Nhân viên in ấn'};
const $=id=>document.getElementById(id);
let auth=null,db=null,currentFirebaseUser=null;

function cleanEmail(v){return String(v||'').trim().toLowerCase()}
function setMessage(text,type=''){
  $('authMsg').textContent=text||'';
  $('authMsg').className='msg'+(type?' '+type:'');
}
function authErrorText(err){
  const code=String(err?.code||'');
  if(code==='auth/unauthorized-domain') return 'Tên miền '+location.hostname+' chưa được thêm vào Firebase Authentication → Settings → Authorized domains.';
  if(code==='auth/operation-not-allowed') return 'Google Sign-in chưa được bật trong Firebase Authentication.';
  if(code==='auth/configuration-not-found') return 'Firebase Authentication chưa được khởi tạo cho project '+EXPECTED_PROJECT_ID+'.';
  if(code==='auth/popup-blocked') return 'Trình duyệt đang chặn cửa sổ Google. Hãy cho phép popup cho website này.';
  if(code==='auth/popup-closed-by-user') return 'Bạn đã đóng cửa sổ Google trước khi đăng nhập xong.';
  if(code==='auth/network-request-failed') return 'Không kết nối được tới Firebase/Google. Kiểm tra mạng rồi thử lại.';
  return String(err?.message||'Không đăng nhập được bằng Google.');
}
async function loadConfig(){
  const res=await fetch('/firebase-applet-config.json',{cache:'no-store'});
  if(!res.ok) throw new Error('Không tải được cấu hình Firebase.');
  const cfg=await res.json();
  if(cfg.projectId!==EXPECTED_PROJECT_ID) throw new Error('Website đang trỏ sai Firebase project: '+String(cfg.projectId||'không xác định')+'.');
  return cfg;
}
async function roleFor(user){
  const email=cleanEmail(user?.email);
  if(OWNER_EMAILS.has(email)) return {role:'director',active:true,name:user.displayName||'Giám đốc'};
  try{
    const own=await getDoc(doc(db,'users',user.uid));
    if(own.exists()){
      const data=own.data();
      return {role:data.role||'',active:data.active!==false,name:data.name||user.displayName||email};
    }
    const invite=await getDoc(doc(db,'accessByEmail',email));
    if(invite.exists()){
      const data=invite.data();
      return {role:data.role||'',active:data.active!==false,name:data.name||user.displayName||email};
    }
  }catch(err){
    console.warn('[HTX login role]',err.code||err.message);
  }
  return {role:'',active:false,name:user.displayName||email};
}
async function showSignedIn(user){
  currentFirebaseUser=user;
  const access=await roleFor(user);
  $('accountBox').classList.add('show');
  $('accountName').textContent=access.name||user.displayName||'Tài khoản Google';
  $('accountEmail').textContent=user.email||'';
  $('accountRole').textContent=access.role?'Vai trò: '+(ROLE_LABELS[access.role]||access.role):'Chưa được phân quyền';
  $('switchBtn').hidden=false;

  if(!access.active||!access.role){
    $('loginBtn').textContent='TÀI KHOẢN CHƯA ĐƯỢC CẤP QUYỀN';
    $('loginBtn').disabled=true;
    setMessage('Email này chưa được Giám đốc cấp quyền truy cập. Hãy đổi tài khoản hoặc liên hệ Giám đốc.','warn');
    return;
  }
  $('loginBtn').disabled=false;
  $('loginBtn').textContent='TIẾP TỤC VÀO PHẦN MỀM';
  setMessage('Đã xác thực Google. Quyền truy cập sẽ áp dụng theo vai trò '+(ROLE_LABELS[access.role]||access.role)+'.','ok');
}
async function startGoogleLogin(){
  $('loginBtn').disabled=true;
  setMessage('Đang mở cửa sổ Google…');
  try{
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    const result=await signInWithPopup(auth,provider);
    await showSignedIn(result.user);
  }catch(err){
    setMessage(authErrorText(err));
    $('loginBtn').disabled=false;
    $('loginBtn').textContent='ĐĂNG NHẬP BẰNG GOOGLE';
  }
}
async function checkAuthorizedDomain(cfg){
  try{
    const res=await fetch('https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key='+encodeURIComponent(cfg.apiKey),{cache:'no-store'});
    if(!res.ok)return;
    const data=await res.json();
    if(Array.isArray(data.authorizedDomains)&&!data.authorizedDomains.includes(location.hostname)){
      setMessage('Cần thêm đúng tên miền '+location.hostname+' vào Firebase Authentication → Settings → Authorized domains.','warn');
    }
  }catch{}
}
async function init(){
  try{
    const cfg=await loadConfig();
    const app=initializeApp(cfg,'htx-login-v312');
    auth=getAuth(app);
    db=getFirestore(app);
    await setPersistence(auth,browserLocalPersistence);
    $('loginBtn').onclick=async()=>{
      if(currentFirebaseUser) location.replace('/app.html#orders');
      else await startGoogleLogin();
    };
    $('switchBtn').onclick=async()=>{
      try{await signOut(auth);}catch{}
      currentFirebaseUser=null;
      $('accountBox').classList.remove('show');
      $('switchBtn').hidden=true;
      $('loginBtn').disabled=false;
      $('loginBtn').textContent='ĐĂNG NHẬP BẰNG GOOGLE';
      setMessage('Chọn tài khoản Google khác để đăng nhập.');
      await startGoogleLogin();
    };
    let handled=false;
    onAuthStateChanged(auth,async user=>{
      if(handled)return;
      handled=true;
      if(user) await showSignedIn(user);
      else{
        setMessage('Sẵn sàng đăng nhập.','ok');
        await checkAuthorizedDomain(cfg);
      }
    },err=>setMessage(authErrorText(err)));
  }catch(err){
    setMessage(String(err?.message||err));
    $('loginBtn').disabled=true;
  }
}
init();
