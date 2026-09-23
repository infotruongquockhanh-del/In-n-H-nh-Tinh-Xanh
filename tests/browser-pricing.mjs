// V30 compatible pricing regression
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'htx-pricing-test-'));
process.env.HTX_LOCAL_DB_PATH=path.join(directory,'database.json');
process.env.SESSION_SECRET='pricing-test-only-session-secret-v29-2026';
process.env.VERCEL='1';process.env.NODE_ENV='test';
for(const k of Object.keys(process.env))if(/^(FIREBASE_|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_SERVICE_ACCOUNT|GOOGLE_SHEETS_)/.test(k))delete process.env[k];
const {db}=await import('../src/firebase-admin.js');
const {hashPassword}=await import('../src/access-policy.js');
await db.collection('users').doc('202609190001').set({id:202609190001,username:'giamdoc',name:'Giám đốc kiểm thử',role:'director',active:true,passwordHash:hashPassword('PricingDirector-29')});
const {default:app}=await import('../server.js');
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',err=>errors.push(err.message));page.on('dialog',d=>d.dismiss());
await page.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('about:')?r.continue():r.abort());
const calc=()=>page.evaluate(()=>calcCurrent());
const product=key=>page.evaluate(k=>startProductQuote(k),key);
async function set(selector,value){
  const el=page.locator(selector);
  if(await el.evaluate(e=>e.tagName==='SELECT'))await el.selectOption(String(value));else await el.fill(String(value));
}
const vfield=(n,f)=>`#customVariantBody tr:nth-child(${n}) [data-vfield="${f}"]`;
const vside=(n,s)=>`#customVariantBody tr:nth-child(${n}) [data-vside="${s}"]`;
const cside=(i,s)=>`#catalogPriceBody [data-i="${i}"][data-side="${s}"]`;
try{
  await page.goto(base+'/');await set('#loginUsername','giamdoc');await set('#loginPassword','PricingDirector-29');await page.click('#loginBtn');
  await page.waitForURL('**/app.html#orders');await page.waitForSelector('#erpShell:not(.auth-locked)');
  for(const selector of ['#googleSheetsSyncCard','.permission-note','.cashflow-panel','#topDate','#globalWorkMonth'])assert.equal(await page.locator(selector).count(),0,selector);
  assert.equal(await page.locator('#workMonthPicker').count(),1);assert.equal(await page.locator('#newAccountName').count(),1);
  const baselines=await page.evaluate(()=>PRODUCTS.map(([key])=>{
    $('productType').value=key;renderConfigurator();const old=legacyV29.calcCurrent(),now=calcCurrent();return {key,old:old.total,now:now.total,oldOk:old.ok,nowOk:now.ok};
  }));
  for(const r of baselines){assert.equal(r.nowOk,r.oldOk,r.key);if(r.oldOk)assert.equal(r.now,r.old,r.key);}
  console.log('PASS UI removal and default-price regression for existing products');
  await product('other');
  for(const [id,val]of Object.entries({otherName:'Bảng mica kiểm thử',otherMaterial:'Mica 3mm',printSides:'2',otherWidthCm:'60',otherHeightCm:'90',otherUnit:'m²',otherFinishing:'Đục lỗ, bế demi',itemNote:'Ghi chú kiểm thử V29',qty:'5',manualUnitPrice:'12345'}))await set('#'+id,val);
  assert.equal((await calc()).total,33332);await set('#qty',4);assert.equal((await calc()).total,26665);
  await set('#manualTotal',100001);await set('#qty',3);assert.equal((await calc()).unitPrice,100001/1.62);
  await page.screenshot({path:'quote-v29-desktop.png',fullPage:true});await page.click('#addItem');
  let item=await page.evaluate(()=>state.quoteItems[0]);assert.equal(item.total,100001);assert.equal(item.pricingInput.mode,'total');assert.equal(item.printSides,'2');assert.equal(item.note,'Ghi chú kiểm thử V29');
  await page.evaluate(id=>editQuoteItem(id),item.id);assert.equal(await page.inputValue('#manualPriceMode'),'total');assert.equal(await page.inputValue('#otherFinishing'),'Đục lỗ, bế demi');
  await set('#qty',6);await page.click('#addItem');item=await page.evaluate(()=>state.quoteItems[0]);assert.equal(item.total,100001);assert.equal(item.unitPrice,100001/3.24);
  await set('#customer','Khách kiểm thử V29');await page.click('#saveOnly');await page.waitForURL('**/app.html#orders');
  const order=await page.evaluate(async()=>{const {state}=await(await fetch('/api/state')).json();return state.htx_auto_quotes_v5[0];});
  assert.equal(order.items[0].total,100001);assert.equal(order.items[0].qty,3.24);assert.equal(order.items[0].pricingInput.mode,'total');
  await page.reload();await page.waitForSelector('#erpShell:not(.auth-locked)');await page.evaluate(id=>editOrder(id),order.id);
  assert.equal(await page.evaluate(()=>state.quoteItems[0].total),100001);
  const output=await page.evaluate(()=>{const q=currentQuoteObject(),xml=buildSheetXml(q),bytes=Array.from(buildXlsx(q));printQuoteObject(q);const f=$('htxPrintFrame');f.contentWindow.print=()=>{};return {xml,bytes,printed:f.contentDocument.body.textContent};});
  assert.ok(output.xml.includes(String(100001/3.24)));
  for(const text of ['In 2 mặt','Mica 3mm','Ghi chú kiểm thử V29']){assert.ok(output.xml.includes(text));assert.ok(output.printed.includes(text));}
  fs.writeFileSync('pricing-v29-test.xlsx',Buffer.from(output.bytes));
  console.log('PASS manual prices, fractional quantity, edit, save/reload, print and XLSX');
  await product('menu2');await set('#material','Menu Foam 5mm');await set('#size','A4');await set('#qty',3);assert.equal((await calc()).total,180000);
  await set('#printSides','1');assert.equal((await calc()).ok,false);await page.click('#addItem');assert.equal(await page.evaluate(()=>state.quoteItems.length),0);
  await page.evaluate(()=>openCatalogDetail('menu2'));const idx=await page.evaluate(()=>catalogTempRows.findIndex(r=>r.key==='material:Menu Foam 5mm|size:A4'));
  await set(cside(idx,1),39000);await set(cside(idx,2),71000);await page.screenshot({path:'prices-v29-desktop.png',fullPage:true});await page.evaluate(()=>saveCatalogDetail());
  await product('menu2');await set('#material','Menu Foam 5mm');await set('#size','A4');await set('#qty',3);await set('#printSides',1);assert.equal((await calc()).total,117000);await set('#printSides',2);assert.equal((await calc()).total,213000);
  await page.evaluate(()=>openCatalogDetail('flyer'));await set('#bulkPrintSidesV29',2);await page.click('#applyBulkSidesV29');await page.evaluate(()=>saveCatalogDetail());
  await product('flyer');await set('#printSides',1);assert.equal((await calc()).ok,false);await set('#printSides',2);assert.equal((await calc()).ok,true);
  console.log('PASS fixed-table side pricing, missing-price block and bulk classification');
  await page.evaluate(()=>openCustomProductModal());await set('#customProductName','Mica V29');
  await set(vfield(1,'name'),'A4');await set(vfield(1,'material'),'Mica 3mm');await set(vfield(1,'basePrice'),10000);await set(vside(1,2),17500);await page.evaluate(()=>addCustomVariantRow());
  for(const [field,value]of Object.entries({name:'Theo diện tích',material:'Canvas',priceMode:'m2',unit:'Tấm',basePrice:80000,width:60,height:90}))await set(vfield(2,field),value);
  await set(vside(2,2),130000);await page.screenshot({path:'custom-v29-desktop.png',fullPage:true});await page.evaluate(()=>saveCustomProductFromModal());
  const cp=await page.evaluate(()=>getCustomProducts().find(x=>x.name==='Mica V29'));assert.ok(cp?.key);
  await product(cp.key);await set('#qty',4);assert.equal((await calc()).total,40000);await set('#printSides',2);assert.equal((await calc()).total,70000);
  await set('#customVariant',cp.variants[1].id);await set('#qty',2);assert.equal((await calc()).total,86400);await set('#printSides',2);assert.equal((await calc()).total,140400);
  await page.evaluate(k=>openCatalogDetail(k),cp.key);await set(cside(0,2),19500);await page.evaluate(()=>saveCatalogDetail());
  await page.evaluate(k=>openCustomProductModal(k),cp.key);assert.equal(await page.inputValue(vside(1,2)),'19500');await set(vside(1,2),21000);await page.evaluate(()=>saveCustomProductFromModal());
  await product(cp.key);await set('#printSides',2);assert.equal((await calc()).total,21000);
  await page.evaluate(k=>openCatalogDetail(k),cp.key);await set(cside(0,2),'');await page.evaluate(()=>saveCatalogDetail());await product(cp.key);await set('#printSides',2);assert.equal((await calc()).ok,false);
  await page.reload();await page.waitForSelector('#erpShell:not(.auth-locked)');assert.equal(await page.locator(`#productType option[value="${cp.key}"]`).count(),1);
  await product(cp.key);await set('#printSides',2);assert.equal((await calc()).ok,false);
  console.log('PASS custom unit/area pricing, switching variants, editor precedence and reload');
  await page.setViewportSize({width:390,height:844});await product('other');await set('#otherMaterial','Canvas');await set('#otherWidthCm',60);await set('#otherHeightCm',90);await set('#manualTotal',100001);await set('#qty',3);
  await page.screenshot({path:'quote-v29-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS mobile layout and no browser exceptions. ALL V29 PRICING TESTS PASSED.');
}finally{
  if(errors.length)console.error(errors);
  await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});
}
