import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDatabaseError, publicDatabaseFailure, databaseError, createDatabaseProbe, within } from '../src/database-errors.js';
import { resolveFirebaseOptions, parseObject, readServiceCredential } from '../src/firebase-options.js';
import fs from 'node:fs';
const source={projectId:'old-project',firestoreDatabaseId:'original-database'};
test('Failures are classified without publishing secret SDK messages',()=>{
  const cases=[[7,'permission denied','DB_PERMISSION_DENIED'],[16,'bad auth','DB_CREDENTIALS_UNAVAILABLE'],[7,'SERVICE_DISABLED','DB_API_DISABLED'],[5,'not found','DB_NOT_FOUND'],[8,'quota','DB_QUOTA_EXCEEDED'],[14,'down','DB_UNAVAILABLE'],[4,'timeout','DB_DEADLINE_EXCEEDED'],[9,'index','DB_PRECONDITION_FAILED']];
  for(const [code,message,expected] of cases){ const failure=publicDatabaseFailure({code,message:message+' SUPER_SECRET_ACCOUNT_PASSWORD'});assert.equal(failure.code,expected);assert.ok(!JSON.stringify(failure).includes('SUPER_SECRET')); }
  assert.equal(classifyDatabaseError(new Error('ordinary coding bug')),null);
});
test('Original database is kept; conflicting sources must not silently choose an empty DB',()=>{
  assert.deepEqual(resolveFirebaseOptions({GOOGLE_CLOUD_PROJECT:'runtime-other'},source),{projectId:'old-project',databaseId:'original-database'});
  assert.throws(()=>resolveFirebaseOptions({FIREBASE_CONFIG:'{"projectId":"new-project"}'},source),e=>e.code==='DB_TARGET_MISMATCH');
  assert.throws(()=>resolveFirebaseOptions({FIREBASE_CONFIG:'{"firestoreDatabaseId":"new-database"}'},source),e=>e.code==='DB_TARGET_MISMATCH');
  assert.deepEqual(resolveFirebaseOptions({FIREBASE_PROJECT_ID:'explicit-project',FIRESTORE_DATABASE_ID:'explicit-database',FIREBASE_CONFIG:'{"projectId":"new-project"}'},source),{projectId:'explicit-project',databaseId:'explicit-database'});
  assert.deepEqual(resolveFirebaseOptions({FIREBASE_CONFIG:'{"projectId":"new-project","firestoreDatabaseId":"new-database"}'},{}),{projectId:'new-project',databaseId:'new-database'});
  assert.equal(resolveFirebaseOptions({FIREBASE_CONFIG:'/settings.json'}, {},()=>'{"projectId":"test-project"}').databaseId,'(default)');
});
test('Malformed credentials never turn on local storage',()=>{
  assert.throws(()=>readServiceCredential({FIREBASE_SERVICE_ACCOUNT_JSON:'{BROKEN SECRET'}),e=>e.code==='DB_CREDENTIALS_UNAVAILABLE'&&!e.message.includes('SECRET'));
  assert.throws(()=>readServiceCredential({FIREBASE_CLIENT_EMAIL:'test@example.com'}));
  assert.equal(readServiceCredential({}),null);
  assert.throws(()=>parseObject('[]',()=> '[]'),e=>e.code==='DB_CONFIG_INVALID');
});
test('Probe caches, coalesces and recovers after an intermittent failure',async()=>{
  let count=0,clock=0,fail=true;
  const probe=createDatabaseProbe(async()=>{count++;if(fail)throw {code:7,message:'secret error'};},{ttlMs:20,now:()=>clock});
  const results=await Promise.all([probe(),probe(),probe()]);assert.equal(count,1);assert.equal(results[0].connected,false);
  fail=false;assert.equal((await probe()).connected,false);clock=21;
  assert.equal((await probe()).connected,true);assert.equal(count,2);
});
test('A slow probe cannot spawn an unbounded number of reads',async()=>{
  let calls=0,finish;const probe=createDatabaseProbe(()=>{calls++;return new Promise(r=>{finish=r;});},{timeoutMs:5,ttlMs:0});
  assert.equal((await probe()).code,'DB_DEADLINE_EXCEEDED');assert.equal((await probe()).connected,false);assert.equal(calls,1);finish();await new Promise(r=>setTimeout(r,0));
});
test('Login keeps business data and does not rely on cached identity',()=>{
  const js=fs.readFileSync(new URL('../public/login.js',import.meta.url),'utf8');
  assert.ok(!js.includes("key.startsWith('htx_')"));assert.ok(js.includes("'/api/auth/login'"));assert.ok(!js.includes('backendTemporarySession'));assert.ok(js.includes('data.requestId'));
});
