"""V30 source-only migration. Never open, replace, seed or delete live business data."""
from pathlib import Path
import re,json

def func(s,name,new):
    pattern=r'(?:export )?(?:async )?function '+re.escape(name)+r'\([^\n]*?\)\s*\{'
    m=re.search(pattern,s)
    if not m: raise RuntimeError('Missing function '+name)
    end=s.index('\n}',m.end())+2
    return s[:m.start()]+new+s[end:]

p=Path('public/app.html');s=p.read_text()
if '<!-- HTX BUSINESS V30 -->' not in s:
    s=s.replace("for(const key of Object.keys(localStorage)){if(key.startsWith('htx_'))localStorage.removeItem(key)}", "// V30: no unconditional cache wipe at page load. Authentication remains server-side.")
    s=s.replace('JSON.stringify(list.slice(0,300))','JSON.stringify(list)')
    s=s.replace('old.revisions.slice(0,29)','old.revisions.slice()')
    s=s.replace('if(q.length>300)q=q.slice(-300);','// Do not silently discard pending writes.')
    s=func(s,'upsertCustomerProfileFromOrder',"function upsertCustomerProfileFromOrder(order){ return HTXBusinessV30.resolveCustomer(order,getCustomerProfiles()); }")
    s=func(s,'syncProfilesFromOrders',"function syncProfilesFromOrders(){ /* Read/render never creates customers. Server links on order save. */ }")
    s=func(s,'orderBelongsToCustomerProfile',"function orderBelongsToCustomerProfile(order,p){ const linked=HTXBusinessV30.resolveCustomer(order,getCustomerProfiles()); return !!linked&&String(linked.id)===String(p.id); }")
    s=s.replace('const debt=related.filter(o=>!o.paid).reduce((sum,o)=>sum+Number(o.total||o.totals?.grand||0),0);','const debt=related.reduce((sum,o)=>sum+HTXBusinessV30.balance(o).remaining,0);')
    s=s.replace('return `<div class="order-card ${x.urgent?"urgent-order":""}">','return `<div class="order-card ${x.urgent?"urgent-order":""}" data-order-id="${x.id}">')
    s=s.replace('<div class="order-total">${money(x.total||x.totals?.grand||0)}</div>', '<div class="order-total"><small>Tổng đơn: ${money(HTXBusinessV30.balance(x).total)}</small><strong class="order-receivable ${HTXBusinessV30.balance(x).remaining===0?\'settled\':\'\'}">CÒN PHẢI THU: ${money(HTXBusinessV30.balance(x).remaining)}</strong><small>Đã thu / cọc: ${money(HTXBusinessV30.balance(x).received)}</small></div>')
    s=s.replace('<strong>${money(depositInfoFromQuote(x).remaining)}</strong>', '<strong>${money(HTXBusinessV30.balance(x).remaining)}</strong>')
    s=s.replace('${Number(r.kpiPercent||0)}%</span><br>${money(r.kpiBonus||0)}','${esc(kpiLabelV30(r))}</span><br>${money(r.kpiBonus||0)}')
    s=s.replace('["Thưởng KPI",Number(r.kpiBonus||0)]','[r.designKpi ? `Thiết kế: ${r.designKpi.count} sản phẩm — ${r.designKpi.status}` : "Thưởng KPI",Number(r.kpiBonus||0)]')
    s=s.replace('<div><b>KPI:</b> ${Number(r.kpiPercent||0)}%</div>','<div><b>KPI:</b> ${esc(kpiLabelV30(r))}</div>')
    s=s.replace('designFee:t.designFee,\n      shipFee:', 'designFee:t.designFee,\n      designProductCount:designCountForSaveV30(),\n      customerId:selectedCustomerIdV30||old.customerId||null,\n      shipFee:')
    s=s.replace('designFee:t.designFee,\n    shipFee:', 'designFee:t.designFee,\n    designProductCount:designCountForSaveV30(),\n    shipFee:')
    s=s.replace('    id:q.id,\n    orderCode:q.orderCode,','    id:q.id,\n    customerId:selectedCustomerIdV30||null,\n    designProductCount:q.designProductCount,\n    orderCode:q.orderCode,')
    s=s.replace('<script>init();</script>', '''<!-- HTX BUSINESS V30 -->
<script src="/business-v30.js?v=30.0.0"></script>
<script src="/sync-v30.js?v=30.0.0"></script>
<script src="/app-v30.js?v=30.0.0"></script>
<script>init();</script>''')
    s=s.replace('V29.0','V30.0')
    p.write_text(s)

p=Path('src/state-store.js');s=p.read_text()
if '// HTX_DATA_V30' not in s:
    s="// HTX_DATA_V30\nimport { safeUpsert, safeDelete, safeWriteState } from './data-safety.js';\n"+s
    s=func(s,'upsertEntity',"export async function upsertEntity(key,id,item,expectedVersion,user,mutationId){ return safeUpsert(key,id,item,expectedVersion,user,mutationId); }")
    s=func(s,'deleteEntity',"export async function deleteEntity(key,id,expectedVersion,user){ return safeDelete(key,id,expectedVersion,user); }")
    s=func(s,'writeStateKey',"export async function writeStateKey(key,value,user,expectedDigest){ return safeWriteState(key,value,user,expectedDigest); }")
    s=func(s,'writeCollection',"async function writeCollection(key,collection,value,user){ return safeWriteState(key,value,user); }")
    s=s.replace("if (key === 'htx_auto_quotes_v5') rows.sort", "if (key === 'htx_customer_profiles_v10') rows=rows.filter(row=>!row.mergedInto);\n  if (key === 'htx_auto_quotes_v5') rows.sort")
    s=func(s,'ensureBootstrap', '''export async function ensureBootstrap(){
  await ensureDirectorBootstrap();
  return db.runTransaction(async tx=>{
    const refs=[db.collection('config').doc('bootstrap'),db.collection('config').doc('company'),db.collection('config').doc('priceBook'),db.collection('settings').doc('htx_work_month_v7')];
    const snapshots=[];for(const ref of refs)snapshots.push(await tx.get(ref));
    if(!snapshots[1].exists)tx.set(refs[1],COMPANY);
    if(!snapshots[2].exists)tx.set(refs[2],{version:30,products:Object.keys(priceBook),priceBook,updatedAt:new Date().toISOString()});
    if(!snapshots[3].exists)tx.set(refs[3],{value:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7),updatedBy:'bootstrap'});
    if(!snapshots[0].exists)tx.set(refs[0],{initialized:true,version:30,initializedAt:new Date().toISOString()});
    return {created:!snapshots[0].exists};
  });
}''')
    p.write_text(s)

p=Path('server.js');s=p.read_text()
if '// HTX_SERVER_V30' not in s:
    s="// HTX_SERVER_V30\nimport routesV30 from './src/routes-v30.js';\nimport { settingDigests } from './src/data-safety.js';\n"+s
    s=s.replace('app.use(accessRoutes);','app.use(accessRoutes);\napp.use(routesV30);')
    s=s.replace('res.json({state});','res.json({state,settingDigests:await settingDigests(req.user,state)});')
    s=s.replace('writeStateKey(key,value,req.user)','writeStateKey(key,value,req.user,req.body.expectedDigest)')
    s=s.replace('upsertEntity(key,id,item,expectedVersion,req.user)','upsertEntity(key,id,item,expectedVersion,req.user,req.body.mutationId)')
    s=s.replace("version:'29.0.0'","version:'30.0.0'")
    s=s.replace('app.post("/api/admin/sheets/pull-all",requireSession,requireDirector,async(req,res,next)=>{', 'app.post("/api/admin/sheets/pull-all",requireSession,requireDirector,async(req,res,next)=>{\n  return res.status(409).json({error:"Nhập Sheet toàn bộ đã tắt để tránh ghi đè dữ liệu. Dùng sao lưu/khôi phục có đối chiếu."});')
    s=s.replace('app.post("/api/admin/sheets/sync-two-way",requireSession,requireDirector,async(req,res,next)=>{', 'app.post("/api/admin/sheets/sync-two-way",requireSession,requireDirector,async(req,res,next)=>{\n  return res.status(409).json({error:"Không đồng bộ kéo dữ liệu cũ ghi đè website. Dùng đối chiếu và khôi phục bản ghi thiếu."});')
    p.write_text(s)

p=Path('public/login.js');s=p.read_text().replace("if (key.startsWith('htx_')) store.removeItem(key);","if (key.startsWith('htx_') && !key.startsWith('htx_pending_v30_')) store.removeItem(key);")
p.write_text(s)
p=Path('src/local-store.js');s=p.read_text()
if '// V30 rolling local snapshot' not in s:
    s=s.replace("  const tmp = `${DB_FILE}.${randomUUID()}.tmp`;", """  // V30 rolling local snapshot on the SAME persistent disk (not disaster backup).
  if(fs.existsSync(DB_FILE))fs.copyFileSync(DB_FILE,DB_FILE+'.previous');
  const tmp = `${DB_FILE}.${randomUUID()}.tmp`;""")
    s=s.replace("fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(tmp, DB_FILE);", "const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(next,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,DB_FILE);")
    p.write_text(s)
for filename in ['scripts/upgrade-pricing-v29.py','scripts/upgrade-auth-v28.mjs']:
    p=Path(filename);s=p.read_text()
    if 'skip-v30' in s:continue
    if filename.endswith('.py'):s="import json,sys\nfrom pathlib import Path\nif int(json.loads(Path('package.json').read_text())['version'].split('.')[0])>=30: # skip-v30\n    print('V30: historical V29 migration skipped');sys.exit(0)\n"+s
    else:s="// skip-v30\nif(Number(JSON.parse((await import('node:fs')).readFileSync('package.json','utf8')).version.split('.')[0])>=30){console.log('V30: historical migration skipped');process.exit(0);}\n"+s
    p.write_text(s)
p=Path('package.json');pkg=json.loads(p.read_text());pkg['version']='30.0.0'
pkg['scripts']['test:business']='node --test tests/business-v30.test.mjs tests/data-v30.test.mjs'
p.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
print('V30 source applied. data/ unchanged; no live data was accessed.')

# Preserve V29 fixed/custom price regression with the new dimension controls.
p=Path('tests/browser-pricing.mjs');s=p.read_text()
if '// V30 compatible pricing regression' not in s:
    s='// V30 compatible pricing regression\n'+s
    s=s.replace("otherSize:'60 × 90 cm',otherUnit:'Mét'", "otherWidthCm:'60',otherHeightCm:'90',otherUnit:'m²'")
    s=s.replace("qty:'2.5',manualUnitPrice:'12345'", "qty:'5',manualUnitPrice:'12345'")
    s=s.replace("total,30863", "total,33332").replace("total,49380", "total,26665")
    s=s.replace("unitPrice,100001/3", "unitPrice,100001/1.62")
    s=s.replace("unitPrice,100001/6", "unitPrice,100001/3.24")
    s=s.replace("items[0].qty,6", "items[0].qty,3.24")
    s=s.replace("String(100001/6)", "String(100001/3.24)")
    s=s.replace("await set('#otherSize','60 × 90 cm');", "await set('#otherWidthCm',60);await set('#otherHeightCm',90);")
    p.write_text(s)
p=Path('src/data-safety.js');s=p.read_text().replace("if(!current||!same(editableOrder(current),editableOrder({...current,...item})))", "if(!current||(item.customerId!==undefined&&String(item.customerId??'')!==String(current.customerId??''))||!same(editableOrder(current),editableOrder({...current,...item})))")
p.write_text(s)
