'use strict';
const $=id=>document.getElementById(id);
function message(text,type=''){const el=$('authMsg');el.textContent=text||'';el.className='msg'+(type?' '+type:'');}
async function request(url,body){
  const res=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(25000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Không thể xử lý yêu cầu.');
  return data;
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('loginBtn').disabled=true;message('Đang xác thực…');
  try{
    const data=await request('/api/auth/login',{username:$('loginUsername').value.trim(),password:$('loginPassword').value});
    $('loginPassword').value='';
    message('Đăng nhập thành công.','ok');
    location.replace('/app.html#orders');
  }catch(err){message(err.message||'Không đăng nhập được.');}
  finally{$('loginBtn').disabled=false;}
});
fetch('/api/auth/me?light=1',{credentials:'same-origin',cache:'no-store'}).then(async res=>{
  if(res.ok){const data=await res.json();if(data.user?.loginAllowed)location.replace('/app.html#orders');}
}).catch(()=>{});
