import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'htx-v30-data-'));
process.env.NODE_ENV='test';process.env.DATA_BACKEND='local';process.env.HTX_LOCAL_DB_PATH=path.join(dir,'db.json');
process.env.SESSION_SECRET='v30-isolated-test-session-secret-at-least-32';
const {storagePlan}=await import('../src/storage-config.js');
const {db}=await import('../src/firebase-admin.js');
const {safeUpsert,safeDelete,safeWriteState,backupBusiness,restoreMissing,customerDuplicates,mergeCustomers,digest,ORDER_KEY,CUSTOMER_KEY}=await import('../src/data-safety.js');
const {completeDesign,designSummary,savePayroll}=await import('../src/design-payroll.js');
const director={id:1,username:'director',role:'director'},staff={id:2,username:'designer',role:'designer'},sales={id:3,username:'sales',role:'sales'};
await db.collection('users').doc('2').set({...staff,name:'Designer A',active:true,accessApproved:true,provisionedByDirectorId:'1'});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=today.slice(0,7);
const initial={id:10001,customer:'Công ty A',customerInfo:{name:'Công ty A',phone:'0912000000'},total:2500000,deposit:{amount:500000},designFee:2400000,designProductCount:60,designerId:2,designerName:'Designer A',status:'Đang thiết kế'};
let order;
await test('V30 database invariants',async t=>{
 await t.test('Hosted deployments refuse ephemeral local storage and never silently fall back',()=>{
  assert.equal(storagePlan({NODE_ENV:'production'}).backend,'firestore');
  assert.throws(()=>storagePlan({K_SERVICE:'test',DATA_BACKEND:'local',HTX_LOCAL_DURABLE:'true',HTX_LOCAL_DB_PATH:'/data/db'}));
  assert.throws(()=>storagePlan({NODE_ENV:'production',DATA_BACKEND:'local'}));
  assert.equal(storagePlan({NODE_ENV:'production',DATA_BACKEND:'local',HTX_LOCAL_DB_PATH:'/data/db',HTX_LOCAL_DURABLE:'true'}).backend,'local');
 });
 await t.test('New order creates exactly one permanent customer; progress never duplicates',async()=>{
  order=await safeUpsert(ORDER_KEY,'10001',initial,0,director,'create-1');assert.ok(order.customerId);
  assert.equal((await db.collection('customers').get()).size,1);
  for(let i=0;i<5;i++){order=await safeUpsert(ORDER_KEY,'10001',{id:10001,status:'Đang in ấn'},order.version,staff,'progress-'+i);assert.equal((await db.collection('customers').get()).size,1);}
  const second=await safeUpsert(ORDER_KEY,'10002',{id:10002,customer:'Công ty A',customerInfo:{name:'Công ty A',phone:'+84 912 000 000'},total:100000},0,director);
  assert.equal(second.customerId,order.customerId);assert.equal((await db.collection('customers').get()).size,1);
 });
 await t.test('No old/same-user stale save, deleted-row resurrection, or destructive empty list',async()=>{
  await assert.rejects(()=>safeUpsert(ORDER_KEY,'10001',{id:10001,total:1},0,director),e=>e.status===409);
  await assert.rejects(()=>safeUpsert(ORDER_KEY,'10001',{id:10001,total:1},order.version,staff),e=>e.status===403);
  await assert.rejects(()=>safeUpsert(ORDER_KEY,'10001',{id:10001,customerId:123},order.version,staff),e=>e.status===403);
  const count=(await db.collection('orders').get()).size;
  await safeWriteState(ORDER_KEY,[],director);assert.equal((await db.collection('orders').get()).size,count);
  await assert.rejects(()=>safeWriteState('htx_catalog_overrides_v7',{x:1},director,'wrong'),e=>e.status===409);
  await safeWriteState('htx_catalog_overrides_v7',{x:1},director,digest(null));
  await assert.rejects(()=>safeWriteState('htx_catalog_overrides_v7',{x:2},director,digest(null)),e=>e.status===409);
  const x=await safeUpsert(ORDER_KEY,'10003',{id:10003,customer:'B',total:10},0,director);
  await safeDelete(ORDER_KEY,'10003',x.version,director);
  await assert.rejects(()=>safeUpsert(ORDER_KEY,'10003',{id:10003,total:1},1,director),e=>e.status===409);
 });
 await t.test('Design completion is idempotent, counts models not print copies, and payroll gets single 300k payout',async()=>{
  const first=await completeDesign('10001',{expectedVersion:order.version,date:today},staff);
  const again=await completeDesign('10001',{expectedVersion:order.version,date:today},staff);assert.equal(again.alreadyCompleted,true);
  assert.equal((await db.collection('designCompletions').get()).size,1);
  const summary=await designSummary(month,'2',director);assert.equal(summary.count,60);assert.equal(summary.amount,300000);assert.equal(summary.status,'Không đạt KPI');
  await assert.rejects(()=>designSummary(month,'2',sales),e=>e.status===403);
  const payroll=await savePayroll(month,'2',{record:{baseSalary:5000000,standardDays:26,workedDays:26,insuranceEnabled:false,kpiBonus:999999},expectedVersion:0,refreshDesignKpi:true},director);
  assert.equal(payroll.kpiBonus,300000);assert.equal(payroll.designKpi.count,60);
  const more=await safeUpsert(ORDER_KEY,'10004',{id:10004,customer:'New',total:1600000,designFee:1600000,designProductCount:40,designerId:2},0,director);
  await completeDesign('10004',{expectedVersion:more.version,date:today},director);assert.equal((await designSummary(month,'2',director)).amount,1000000);
  const frozen=await savePayroll(month,'2',{record:payroll,expectedVersion:1},director);assert.equal(frozen.kpiBonus,300000);
  const recalculated=await savePayroll(month,'2',{record:frozen,expectedVersion:2,refreshDesignKpi:true},director);assert.equal(recalculated.kpiBonus,1000000);
  await assert.rejects(()=>safeUpsert(ORDER_KEY,'10001',{id:10001,designProductCount:2,designFee:80000},first.item.version,director),e=>e.status===409);
 });
 await t.test('Encrypted-draft retries are idempotent, including retry after a response was lost',async()=>{
  const before=(await db.collection('orders').doc('10002').get()).data();
  const one=await safeUpsert(ORDER_KEY,'10002',{id:10002,status:'Đã giao'},before.version,director,'same-operation');
  const two=await safeUpsert(ORDER_KEY,'10002',{id:10002,status:'Đã giao'},before.version,director,'same-operation');assert.equal(one.version,two.version);
 });
 await t.test('Business backup has checksums/history; restore inserts only missing records without changing existing ones',async()=>{
  const backup=await backupBusiness(director);assert.ok(backup.counts.dataHistory>5);assert.equal(backup.counts.designCompletions,2);assert.equal(backup.collections.users,undefined);
  await assert.rejects(()=>backupBusiness(staff),e=>e.status===403);
  await assert.rejects(()=>restoreMissing({...backup,sha256:'bad'},director),e=>e.status===400);
  const x=(await db.collection('orders').doc('10002').get()).data();await safeDelete(ORDER_KEY,'10002',x.version,director);
  const report=await restoreMissing(backup,director,false);assert.ok(report.created>=1);
  await restoreMissing(backup,director,true);assert.equal((await db.collection('orders').doc('10002').get()).exists,true);
  const restored=(await db.collection('orders').doc('10002').get()).data();await safeUpsert(ORDER_KEY,'10002',{id:10002,total:99999},restored.version,director);
  const conflict=await restoreMissing(backup,director,true);assert.ok(conflict.conflicts>=1);assert.equal((await db.collection('orders').doc('10002').get()).data().total,99999);
 });
 await t.test('Customer reconciliation archives duplicates, preserves both profiles and links each order once',async()=>{
  const original=(await db.collection('customers').doc(String(order.customerId)).get()).data();
  await db.collection('customers').doc('123456789').set({...original,id:123456789,code:'DUPLICATE'});
  const groups=await customerDuplicates();const group=groups.find(g=>g.some(p=>p.id===123456789));assert.ok(group);
  const before=(await db.collection('customers').get()).size;
  const result=await mergeCustomers(group.map(p=>p.id),original.id,director);assert.equal(result.archived,1);
  assert.equal((await db.collection('customers').get()).size,before);assert.equal((await db.collection('customers').doc('123456789').get()).data().mergedInto,original.id);
 });
 await t.test('Read/render has no 300-order truncation; all data survives storage reload',async()=>{
  const html=fs.readFileSync(new URL('../public/app.html',import.meta.url),'utf8');assert.ok(!html.includes('JSON.stringify(list.slice(0,300))'));
  const stored=JSON.parse(fs.readFileSync(process.env.HTX_LOCAL_DB_PATH,'utf8'));assert.ok(Object.keys(stored.orders).length>=3);assert.ok(stored.dataHistory);assert.ok(fs.existsSync(process.env.HTX_LOCAL_DB_PATH+'.previous'));
 });
});
fs.rmSync(dir,{recursive:true,force:true});
