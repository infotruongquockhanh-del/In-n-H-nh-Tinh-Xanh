import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'htx-auth-test-'));
process.env.HTX_LOCAL_DB_PATH = path.join(directory, 'database.json');
process.env.SESSION_SECRET = 'test-only-session-secret-not-for-production-2026';
process.env.VERCEL = '1';
process.env.NODE_ENV = 'test';
for (const key of Object.keys(process.env)) if (/^(FIREBASE_|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_SERVICE_ACCOUNT|GOOGLE_SHEETS_)/.test(key)) delete process.env[key];
const { db } = await import('../src/firebase-admin.js');
const { legacyHash, hashPassword, verifyPassword, approved } = await import('../src/access-policy.js');
await db.collection('users').doc('202609190001').set({ id:202609190001, username:'giamdoc', name:'Giám đốc', role:'director', active:true, passwordHash:legacyHash('giamdoc','123456') });
await db.collection('users').doc('99').set({ id:99, username:'demo-staff', name:'Demo', role:'sales', active:true, passwordHash:legacyHash('demo-staff','DemoPass-28') });
const { default: app } = await import('../server.js');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(url, { method='GET', body, cookie, headers={} } = {}) {
  const response = await fetch(base+url, { method, redirect:'manual', headers:{ ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {}), ...headers }, ...(body !== undefined ? {body:JSON.stringify(body)} : {}) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return { status:response.status, data, text, location:response.headers.get('location'), cookie:response.headers.get('set-cookie')?.split(';')[0] };
}
let directorCookie;
const employees = {};
await test('Authentication and authorization integration', async t => {
  await t.test('Passwords use salted scrypt; legacy verification is migration-only', () => {
    const a = hashPassword('SecurePass-28'), b = hashPassword('SecurePass-28');
    assert.notEqual(a,b); assert.ok(verifyPassword('someone','SecurePass-28',a));
    assert.equal(verifyPassword('someone','bad',a),false);
    assert.equal(approved({role:'sales',active:true}),false);
    assert.throws(()=>hashPassword('123456'));
  });
  await t.test('Anonymous users see only the login screen; protected APIs and direct HTML are blocked', async () => {
    const root = await call('/'); assert.equal(root.status,200); assert.match(root.text,/id="loginForm"/);
    assert.doesNotMatch(root.text,/123456|showCreateFirstBtn|Đăng nhập nhanh|id="erpShell"/);
    for (const url of ['/api/state','/api/admin/users','/api/firebase-config','/api/database-status']) assert.equal((await call(url)).status,401,url);
    assert.equal((await call('/app.html')).location,'/');
    assert.equal((await call('/app%2ehtml')).status,404);
    assert.equal((await call('/api/auth/temporary',{method:'POST',body:{}})).status,410);
    assert.equal((await call('/api/auth/restore',{method:'POST',body:{}})).status,410);
    assert.equal((await call('/api/admin/users',{method:'POST',body:{role:'director'}})).status,401);
  });
  await t.test('Wrong password and unprovisioned demo accounts cannot sign in', async () => {
    const wrong = await call('/api/auth/login',{method:'POST',body:{username:'giamdoc',password:'bad-password'}});
    assert.equal(wrong.status,401); assert.equal(wrong.cookie,undefined);
    assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'demo-staff',password:'DemoPass-28'}})).status,401);
    const cross = await call('/api/auth/login',{method:'POST',body:{username:'giamdoc',password:'123456'},headers:{Origin:'https://untrusted.example'}});
    assert.equal(cross.status,403);
  });
  await t.test('Existing V27 director password is preserved and opens the app directly', async () => {
    const signed = await call('/api/auth/login',{method:'POST',body:{username:'giamdoc',password:'123456'}});
    assert.equal(signed.status,200); assert.equal(signed.data.user.mustChangePassword,false);
    assert.equal(signed.data.token,undefined); assert.equal(signed.data.user.passwordHash,undefined);
    directorCookie=signed.cookie;
    assert.equal((await call('/api/state',{cookie:directorCookie})).status,200);
    const application=await call('/app.html',{cookie:directorCookie});
    assert.equal(application.status,200);
    assert.doesNotMatch(application.text,/__HTX_NO_LOGIN__|backendTemporarySession|localLoginFallback|createFirstAccount|fallbackUser|firebase-native-v31/);
    assert.match(application.text,/erp-shell auth-locked/);
    assert.match((await call('/',{cookie:directorCookie})).text,/id="loginForm"/);
  });
  await t.test('Director creates each role on the server; duplicates and invalid roles are rejected', async () => {
    for (const role of ['accounting','sales','designer','printing']) {
      const created = await call('/api/admin/users',{method:'POST',cookie:directorCookie,body:{username:'employee-'+role,name:role,role,password:'EmployeePass-28'}});
      assert.equal(created.status,201,created.text); assert.equal(created.data.user.loginAllowed,true); assert.equal(created.data.user.passwordHash,undefined);
      const signed=await call('/api/auth/login',{method:'POST',body:{username:'employee-'+role,password:'EmployeePass-28'}});
      assert.equal(signed.status,200); employees[role]={id:created.data.user.id,cookie:signed.cookie};
    }
    assert.equal((await call('/api/admin/users',{method:'POST',cookie:directorCookie,body:{username:'employee-sales',name:'Duplicate',role:'sales',password:'EmployeePass-28'}})).status,409);
    assert.equal((await call('/api/admin/users',{method:'POST',cookie:directorCookie,body:{username:'invalid-role',name:'Invalid',role:'superadmin',password:'EmployeePass-28'}})).status,400);
    const concurrent=await Promise.all([1,2].map(()=>call('/api/admin/users',{method:'POST',cookie:directorCookie,body:{username:'concurrent-user',name:'Concurrent',role:'sales',password:'EmployeePass-28'}})));
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
  });
  await t.test('Read/write ACL applies at the server, not only navigation buttons', async () => {
    await db.collection('settings').doc('htx_payroll_v17').set({value:{confidential:'payroll-test'}});
    for (const role of ['accounting','sales','designer','printing']) {
      const cookie=employees[role].cookie;
      const state=await call('/api/state',{cookie}); assert.equal(state.status,200);
      assert.equal(state.text.includes('passwordHash'),false);
      if(role==='accounting') assert.deepEqual(state.data.state.htx_payroll_v17,{confidential:'payroll-test'});
      else assert.equal(state.data.state.htx_payroll_v17,null);
      assert.equal((await call('/api/admin/users',{cookie})).status,403);
      assert.equal((await call('/api/admin/users',{method:'POST',cookie,body:{name:'Forged',username:'forged',role:'director',password:'ForgedPass-28'}})).status,403);
      assert.equal((await call('/api/state/htx_users_v6',{method:'PUT',cookie,body:{value:[]}})).status,403);
    }
    assert.equal((await call('/api/state/htx_users_v6',{method:'PUT',cookie:directorCookie,body:{value:[]}})).status,403);
    const all=await call('/api/state',{cookie:directorCookie}); assert.equal(all.text.includes('passwordHash'),false);
    for(const role of ['designer','printing']) {
      assert.equal((await call('/api/entity/htx_auto_quotes_v5/456',{method:'PUT',cookie:employees[role].cookie,body:{item:{id:456,status:'Đang in'},expectedVersion:0}})).status,403);
    }
    await db.collection('orders').doc('10001').set({id:10001,status:'Tiếp nhận file',total:1000,version:1});
    const updated=await call('/api/entity/htx_auto_quotes_v5/10001',{method:'PUT',cookie:employees.printing.cookie,body:{item:{id:10001,status:'Đang in',total:1000,version:1},expectedVersion:1}});
    assert.equal(updated.status,200,updated.text);
    assert.equal((await call('/api/entity/htx_auto_quotes_v5/10001',{method:'DELETE',cookie:employees.sales.cookie,body:{expectedVersion:2}})).status,403);
  });
  await t.test('Locking, role changes, deletion and logout revoke previous sessions', async () => {
    const sales=employees.sales;
    assert.equal((await call('/api/admin/users/'+sales.id,{method:'PATCH',cookie:directorCookie,body:{active:false}})).status,200);
    assert.equal((await call('/api/auth/me',{cookie:sales.cookie})).status,401);
    assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'employee-sales',password:'EmployeePass-28'}})).status,401);
    await call('/api/admin/users/'+sales.id,{method:'PATCH',cookie:directorCookie,body:{active:true,password:'NewEmployeePass-28'}});
    const newLogin=await call('/api/auth/login',{method:'POST',body:{username:'employee-sales',password:'NewEmployeePass-28'}});
    assert.equal(newLogin.status,200);
    await call('/api/admin/users/'+sales.id,{method:'PATCH',cookie:directorCookie,body:{role:'designer'}});
    assert.equal((await call('/api/auth/me',{cookie:newLogin.cookie})).status,401);
    await call('/api/admin/users/'+employees.designer.id,{method:'DELETE',cookie:directorCookie,body:{}});
    assert.equal((await call('/api/auth/me',{cookie:employees.designer.cookie})).status,401);
    assert.equal((await call('/api/admin/users/202609190001',{method:'DELETE',cookie:directorCookie,body:{}})).status,403);
    assert.equal((await call('/api/admin/users/202609190001',{method:'PATCH',cookie:directorCookie,body:{active:false}})).status,403);
    assert.equal((await call('/api/auth/logout',{method:'POST',cookie:directorCookie,body:{}})).status,200);
    assert.equal((await call('/api/auth/me',{cookie:directorCookie})).status,401);
    assert.equal((await call('/app.html',{cookie:directorCookie})).location,'/');
  });
});
await new Promise(resolve=>server.close(resolve));
fs.rmSync(directory,{recursive:true,force:true});
