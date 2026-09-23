import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'htx-browser-migration-'));
process.env.NODE_ENV='test';
process.env.HTX_LOCAL_DB_PATH=path.join(dir,'db.json');
process.env.DATA_BACKEND='local';

const { db }=await import('../src/firebase-admin.js');
const { migrateBrowserState }=await import('../src/browser-migration.js');

const actor={id:202609190001,username:'giamdoc',name:'Giám đốc',role:'director',active:true,accessApproved:true};

await test('browser migration only fills missing records',async()=>{
  await db.collection('orders').doc('100').set({id:100,orderCode:'KEEP-100',customer:'Existing',total:1000});
  const state={
    htx_auto_quotes_v5:[
      {id:100,orderCode:'OVERWRITE-BLOCKED',customer:'Bad',total:9999},
      {id:101,orderCode:'LEGACY-101',customer:'Legacy',total:2500}
    ],
    htx_customer_profiles_v10:[{id:201,name:'Legacy Customer',phone:'0900000000'}],
    htx_users_v6:[{id:301,name:'Old Sale',username:'oldsale',passwordHash:'01234567',role:'sales',active:true}],
    htx_work_month_v7:'2026-09'
  };

  const first=await migrateBrowserState(state,actor);
  assert.ok(first.created>=4);

  const kept=await db.collection('orders').doc('100').get();
  assert.equal(kept.data().orderCode,'KEEP-100');

  const added=await db.collection('orders').doc('101').get();
  assert.equal(added.data().orderCode,'LEGACY-101');

  const customer=await db.collection('customers').doc('201').get();
  assert.equal(customer.data().name,'Legacy Customer');

  const user=await db.collection('users').doc('301').get();
  assert.equal(user.data().username,'oldsale');
  assert.equal(user.data().accessApproved,true);
  assert.equal(user.data().provisionedByDirectorId,String(actor.id));

  const second=await migrateBrowserState(state,actor);
  assert.equal(second.created,0);
});

await test('non-director cannot import browser data',async()=>{
  await assert.rejects(
    migrateBrowserState({htx_auto_quotes_v5:[{id:999}]},{id:2,username:'sale',role:'sales'}),
    /Chỉ Giám đốc/
  );
});

fs.rmSync(dir,{recursive:true,force:true});
