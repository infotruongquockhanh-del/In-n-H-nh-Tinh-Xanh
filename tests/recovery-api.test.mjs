import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'htx-recovery-'));
process.env.HTX_LOCAL_DB_PATH=path.join(dir,'MUST_NOT_CREATE.json');
process.env.NODE_ENV='test';process.env.VERCEL='1';process.env.DATA_BACKEND='invalid-backend';
process.env.SESSION_SECRET='test-session-only-recovery-not-production-2026';
const {default:app}=await import('../server.js');
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try {
  await test('Database configuration failure leaves login available but all private routes closed',async()=>{
    const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/id="loginForm"/);
    const health=await fetch(base+'/api/health');const data=await health.json();assert.equal(health.status,503);assert.equal(data.ok,false);assert.equal(data.code,'DB_UNSAFE_STORAGE');
    assert.ok(!JSON.stringify(data).includes('MUST_NOT_CREATE'));assert.equal(data.version,'30.1.0');
    const denied=await fetch(base+'/api/state');assert.equal(denied.status,401);
    const direct=await fetch(base+'/app.html',{redirect:'manual'});assert.equal(direct.status,303);
    assert.ok(!fs.existsSync(process.env.HTX_LOCAL_DB_PATH));
  });
  await test('Database failures are not misreported as bad passwords or consume attempt quota',async()=>{
    for(let i=0;i<23;i++){
      const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'giamdoc',password:'some-password'})});
      assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);const data=await response.json();assert.equal(data.code,'DB_UNSAFE_STORAGE');assert.ok(data.requestId);
    }
  });
} finally {server.close();server.closeAllConnections?.();fs.rmSync(dir,{recursive:true,force:true});}
