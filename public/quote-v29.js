/* V29: manual quote items, explicit print-side pricing, and compact UI.
   Loaded after the legacy functions and before init(). Authentication is untouched. */
'use strict';
const Q29 = HTXQuoteMath;
const OTHER_PRODUCT_KEY = 'other';
let pricingContextV29 = null;
const legacyV29 = {
  allProducts, catalogPrice, buildCatalogRows, renderConfigurator, calcCurrent,
  applyMarketAdjustment, prefillConfiguratorFromItem, openCustomProductModal,
  defaultCustomVariant, enterApp, renderPricebook
};
function formatQuantityV29(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(Number(value) || 0);
}
function formatUnitPriceV29(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(Number(value) || 0) + ' đ';
}
function priceEntryV29(value) { return value === '' || value == null ? '' : String(value); }
function sideOptionsV29(value, allowLegacy = true) {
  return (allowLegacy ? [['','Chưa phân loại số mặt']] : []).concat([['1','In 1 mặt'],['2','In 2 mặt']])
    .map(([v,label])=>`<option value="${v}"${String(value ?? '')===v?' selected':''}>${label}</option>`).join('');
}
function textFieldV29(id, label, placeholder='', value='') {
  return `<div class="field"><label class="label" for="${id}">${esc(label)}</label><input class="control auto-field" id="${id}" maxlength="500" placeholder="${esc(placeholder)}" value="${esc(value)}"></div>`;
}
function knownBaseSideV29(product, key) {
  if (['invoice1','invoiceMulti'].includes(product)) return '1';
  if (['menu2','standeeU'].includes(product)) return '2';
  const match = String(key).match(/^type:([12]) Mặt /i);
  if (product === 'standeeA' && match) return match[1];
  if (product === 'standeeIndoor' && key.startsWith('type:Khung Cửa Lò Xo|')) return '1';
  return '';
}
function rowPricingV29(product, key, rawPrice) {
  const catalog = getProductCatalog(product);
  const cp = getCustomProduct(product);
  const variantId = String(key).split('|variant:')[1];
  const variant = cp && variantId ? getCustomVariants(cp).find(v=>String(v.id || 'default')===variantId) : null;
  const preferVariant = variant && Number(variant.pricingUpdatedAt || 0) > Number(catalog.pricingUpdatedAt?.[key] || 0);
  const printSides = preferVariant ? Q29.side(variant.printSides) :
    Q29.has(catalog.printSides,key) ? Q29.side(catalog.printSides[key]) :
    variant ? Q29.side(variant.printSides) : knownBaseSideV29(product,key);
  const sidePrices = { ...(!preferVariant && Q29.has(catalog.sidePrices,key) ? catalog.sidePrices[key] : variant?.sidePrices || {}) };
  let price = preferVariant ? Number(variant.basePrice) : legacyV29.catalogPrice(product,key,rawPrice);
  // Retain the pre-existing spring-frame second-side surcharge for these two exact sizes.
  if (product==='standeeIndoor' && !Q29.has(catalog.printSides,key) && !Q29.has(catalog.sidePrices,key) &&
      key.startsWith('type:Khung Cửa Lò Xo|')) {
    const size=key.split('|size:')[1];
    const extra={'60x160cm':95000,'80x180cm':130000}[size];
    if (extra !== undefined && !Q29.has(sidePrices,'2')) sidePrices['2']=price+extra;
  }
  return {price,printSides,sidePrices};
}
allProducts = function () {
  return [...legacyV29.allProducts().filter(([key])=>key!==OTHER_PRODUCT_KEY), [OTHER_PRODUCT_KEY,'Hạng mục khác']];
};
function renderProductSelect() {
  const select=$('productType'); if(!select)return;
  const old=select.value;
  select.innerHTML=allProducts().map(([k,name])=>`<option value="${esc(k)}">${esc(name)}</option>`).join('');
  if([...select.options].some(option=>option.value===old))select.value=old;
}
enterApp = function () { renderProductSelect(); return legacyV29.enterApp(); };
catalogPrice = function (product,key,rawPrice) {
  const record=rowPricingV29(product,key,rawPrice);
  if (!pricingContextV29 || pricingContextV29.product!==product) return record.price;
  pricingContextV29.rows.push({key,...record});
  const value=Q29.sidePrice(record,pricingContextV29.sides);
  if (value===null) pricingContextV29.missing=true;
  return value;
};
buildCatalogRows = function (product) {
  return legacyV29.buildCatalogRows(product).map(row=>{
    const pricing=rowPricingV29(product,row.key,row.base);
    return {...row,price:pricing.price,printSides:pricing.printSides,sidePrices:{...pricing.sidePrices}};
  });
};
function addPrintSideControlV29(product) {
  const config=$('configurator'); if(!config)return;
  config.querySelector('#sides')?.closest('.field')?.remove();
  const rows=buildCatalogRows(product).filter(r=>!r.custom);
  const sides=[...new Set(rows.map(r=>r.printSides))];
  const initial=sides.length===1?sides[0]:'';
  const label = '<div class="field print-side-field"><label class="label" for="printSides">Số mặt in</label>'+
    `<select id="printSides" class="control auto-field">${sideOptionsV29(initial)}</select>`+
    '<div class="help">Giá 1 mặt và 2 mặt được khai báo riêng. Chưa có giá sẽ không được thêm vào báo giá.</div></div>';
  const grid=config.querySelector('.form-grid');if(grid)grid.insertAdjacentHTML('beforeend',label);
  $('printSides')?.addEventListener('change',previewCurrent);
  [...($('staticSpecs')?.children||[])].forEach(el=>{if(/^(In )?[12] mặt$/i.test(el.textContent.trim()))el.remove();});
  const select=$('customVariant');
  if(select)select.addEventListener('change',()=>{
    const cp=getCustomProduct(product), variant=getCustomVariant(cp,select.value);
    if(variant){const row=rowPricingV29(product,`custom:${product}|variant:${variant.id||'default'}`,variant.basePrice);$('printSides').value=row.printSides;}
    previewCurrent();
  });
}
function renderManualV29() {
  setStaticSpecs(['Nhập quy cách và giá thủ công','Đơn giá × số lượng = thành tiền']);
  $('itemNote').value='';
  $('configurator').innerHTML=`<div class="manual-v29">
    <div class="form-grid">
      ${textFieldV29('otherName','Tên hạng mục (không bắt buộc)','Ví dụ: Bảng mica theo yêu cầu')}
      ${textFieldV29('otherMaterial','1. Chất liệu','Decal, Bạt 3M, Mica, Canvas…')}
      <div class="field"><label class="label" for="printSides">2. Số mặt in</label><select id="printSides" class="control auto-field">${sideOptionsV29('1',false)}</select></div>
      ${textFieldV29('otherSize','3. Kích thước','Ví dụ: 60 × 90 cm hoặc theo file thiết kế')}
      ${numberField('qty','4. Số lượng',1,0.000001,'any')}
      <div class="field"><label class="label" for="otherUnit">Đơn vị tính</label><input id="otherUnit" class="control auto-field" list="otherUnitsV29" maxlength="40" value="Cái"><datalist id="otherUnitsV29">${['Cái','Tấm','Tờ','Bộ','Mét','m²','Cuốn','Hộp','Cuộn'].map(u=>`<option value="${u}">`).join('')}</datalist></div>
      ${textFieldV29('otherFinishing','5. Loại gia công','Cán màng, bế demi, đục lỗ, xỏ que…')}
    </div>
    <div class="manual-pricing-v29">
      <div class="field"><label class="label" for="manualPriceMode">Cách nhập giá</label><select id="manualPriceMode" class="control"><option value="unit">Nhập đơn giá → tính tổng tiền</option><option value="total">Nhập tổng tiền → tính đơn giá</option></select></div>
      <div class="field"><label class="label" for="manualUnitPrice">Đơn giá (đ)</label><input id="manualUnitPrice" class="control" type="number" step="any" min="0" inputmode="decimal" placeholder="Nhập đơn giá"></div>
      <div class="field"><label class="label" for="manualTotal">Tổng tiền (đ)</label><input id="manualTotal" class="control" type="number" step="1" min="0" inputmode="decimal" placeholder="Nhập tổng tiền"></div>
    </div>
    <p class="help">Có thể nhập vào một trong hai ô giá. Ô vừa nhập là giá gốc để tính ô còn lại; số mặt in không tự nhân đôi giá. Tổng tiền được làm tròn đến 1 đồng.</p>
  </div>`;
  $('itemNote').placeholder='6. Ghi chú: yêu cầu kỹ thuật hoặc yêu cầu riêng của hạng mục';
  document.querySelectorAll('#configurator .auto-field').forEach(el=>{
    el.addEventListener('input',syncManualV29);el.addEventListener('change',syncManualV29);
  });
  $('manualUnitPrice').addEventListener('input',()=>{$('manualPriceMode').value='unit';syncManualV29();});
  $('manualTotal').addEventListener('input',()=>{$('manualPriceMode').value='total';syncManualV29();});
  $('manualPriceMode').addEventListener('change',syncManualV29);
  syncManualV29();
}
function manualInputV29() {
  return {name:fieldVal('otherName').trim(),material:fieldVal('otherMaterial').trim(),printSides:fieldVal('printSides'),size:fieldVal('otherSize').trim(),qty:fieldVal('qty'),unit:fieldVal('otherUnit').trim(),finishing:fieldVal('otherFinishing').trim(),mode:fieldVal('manualPriceMode'),unitPrice:fieldVal('manualUnitPrice'),total:fieldVal('manualTotal')};
}
function syncManualV29() {
  const input=manualInputV29(), result=Q29.manual(input);
  const derived=input.mode==='total'?$('manualUnitPrice'):$('manualTotal');
  if(derived)derived.value=result.ok ? String(input.mode==='total'?result.unitPrice:result.total) : '';
  $('manualUnitPrice')?.classList.toggle('derived-price',input.mode==='total');
  $('manualTotal')?.classList.toggle('derived-price',input.mode==='unit');
  previewCurrent();
}
function calcManualV29() {
  const input=manualInputV29(), result=Q29.manual(input);
  if(!result.ok)return {...result,details:[],breakdown:[]};
  if(!input.material)return {ok:false,reason:'Vui lòng nhập chất liệu.'};
  if(!input.size)return {ok:false,reason:'Vui lòng nhập kích thước.'};
  if(!input.unit)return {ok:false,reason:'Vui lòng nhập đơn vị tính.'};
  if(!Q29.side(input.printSides))return {ok:false,reason:'Vui lòng chọn In 1 mặt hoặc In 2 mặt.'};
  return {...result,name:input.name||'Hạng mục khác',unit:input.unit,printSides:input.printSides,pricingInput:{...input,qty:result.qty,unitPrice:result.unitPrice,total:result.total},
    details:[{label:'Chất liệu',value:input.material},{label:'Số mặt in',value:`In ${input.printSides} mặt`},{label:'Kích thước',value:input.size},{label:'Loại gia công',value:input.finishing||'Không'},{label:'Cách tính giá',value:input.mode==='total'?'Nhập tổng tiền':'Nhập đơn giá'}],
    breakdown:[['Đơn giá',formatUnitPriceV29(result.unitPrice)],['Số lượng',`${formatQuantityV29(result.qty)} ${input.unit}`],['Tổng',result.total]]};
}
renderConfigurator = function () {
  if(fieldVal('productType')===OTHER_PRODUCT_KEY){renderManualV29();return;}
  $('itemNote').placeholder='Ghi chú kỹ thuật hoặc yêu cầu riêng của hạng mục';
  legacyV29.renderConfigurator();
  addPrintSideControlV29(fieldVal('productType'));
  previewCurrent();
};
calcCurrent = function () {
  const product=fieldVal('productType');
  if(product===OTHER_PRODUCT_KEY)return calcManualV29();
  const sides=Q29.side(fieldVal('printSides'));
  const context={product,sides,rows:[],missing:false};
  pricingContextV29=context;
  let result;
  try{result=legacyV29.calcCurrent();}finally{pricingContextV29=null;}
  if(context.missing)return {ok:false,reason:`Chưa khai báo giá in ${sides} mặt cho đúng quy cách/số lượng đang chọn. Hãy cập nhật tại Bảng giá & hạng mục → Chi tiết & giá.`,details:[],breakdown:[]};
  if(!result.ok)return result;
  if(!Number.isFinite(result.qty)||result.qty<=0||!Number.isFinite(result.total)||result.total<0||result.total>Number.MAX_SAFE_INTEGER)
    return {ok:false,reason:'Số lượng hoặc giá không hợp lệ.'};
  const known=[...new Set(context.rows.map(r=>r.printSides))];
  const actual=sides||(known.length===1?known[0]:'');
  const details=(result.details||[]).filter(d=>!['Số mặt','Số mặt in'].includes(d.label));
  details.push({label:'Số mặt in',value:actual?`In ${actual} mặt`:'Theo bảng giá hiện tại (chưa phân loại)'});
  return {...result,printSides:actual,details};
};
applyMarketAdjustment = function (result) {
  return fieldVal('productType')===OTHER_PRODUCT_KEY ? result : legacyV29.applyMarketAdjustment(result);
};
prefillConfiguratorFromItem = function (item) {
  if(item.productKey!==OTHER_PRODUCT_KEY){
    legacyV29.prefillConfiguratorFromItem(item);
    const side=item.printSides||String(findDetail(item,'Số mặt in')).match(/[12]/)?.[0]||String(findDetail(item,'Số mặt')).match(/[12]/)?.[0]||'';
    if($('printSides'))$('printSides').value=Q29.side(side);
    previewCurrent();return;
  }
  const data=item.pricingInput||{};
  const fields={otherName:data.name??(item.name==='Hạng mục khác'?'':item.name),otherMaterial:data.material??findDetail(item,'Chất liệu'),printSides:data.printSides||item.printSides||'1',otherSize:data.size??findDetail(item,'Kích thước'),qty:item.qty,otherUnit:item.unit,otherFinishing:data.finishing??findDetail(item,'Loại gia công'),manualPriceMode:data.mode||'total',manualUnitPrice:data.unitPrice??item.unitPrice,manualTotal:data.total??item.total};
  for(const [id,value]of Object.entries(fields))if($(id))$(id).value=value??'';
  syncManualV29();
};
renderCatalogRows = function () {
  const body=$('catalogPriceBody');if(!body)return;
  body.closest('table').querySelector('thead tr').innerHTML='<th>Nhóm / Chất liệu</th><th>Quy cách / Kích thước</th><th>Số lượng / Bậc giá</th><th>ĐVT giá</th><th>Giá gốc</th><th>Giá hiện tại</th><th>Giá hiện tại áp dụng cho</th><th>Giá in 1 mặt (đ)</th><th>Giá in 2 mặt (đ)</th><th>Tồn kho</th><th>Nhà cung cấp</th>';
  if(!$('sidePriceHelpV29')){
    const head=body.closest('.catalog-prices').querySelector('h4');
    head.insertAdjacentHTML('afterend','<p id="sidePriceHelpV29" class="help">Chọn số mặt cho giá hiện tại hoặc nhập hai mức giá riêng. Ô trống: dùng giá hiện tại nếu đúng số mặt; nếu không khớp thì chưa có giá. Không tự nhân đôi/chia đôi giá.</p><div class="bulk-side-v29"><label for="bulkPrintSidesV29">Phân loại toàn bộ giá hiện tại của bảng này:</label><select id="bulkPrintSidesV29" class="control">'+sideOptionsV29('')+'</select><button class="ghost-btn" type="button" id="applyBulkSidesV29">Áp dụng cho các dòng</button></div>');
    $('applyBulkSidesV29').onclick=()=>{catalogTempRows.forEach(r=>{r.printSides=$('bulkPrintSidesV29').value;});renderCatalogRows();};
  }
  body.innerHTML=catalogTempRows.map((row,i)=>`<tr>
    <td>${esc(catalogTempLabels[row.group]||row.group)}</td><td>${esc(catalogTempLabels[row.spec]||row.spec)}</td><td>${esc(row.tier)}</td>
    <td>${esc(row.unit)}</td><td>${money(row.base)}</td>
    <td><input type="number" min="0" step="any" data-i="${i}" data-f="price" value="${esc(priceEntryV29(row.price))}" aria-label="Giá hiện tại dòng ${i+1}"></td>
    <td><select data-i="${i}" data-f="printSides" aria-label="Số mặt giá hiện tại dòng ${i+1}">${sideOptionsV29(row.printSides)}</select></td>
    ${['1','2'].map(s=>`<td><input type="number" min="0" step="any" data-i="${i}" data-side="${s}" value="${esc(priceEntryV29(row.sidePrices?.[s]))}" placeholder="${row.printSides===s?'Dùng giá hiện tại':'Chưa có giá'}" aria-label="Giá in ${s} mặt dòng ${i+1}"></td>`).join('')}
    <td>${row.stock===''?'—':formatQuantityV29(row.stock)}</td><td>${esc(row.supplier||'—')}</td></tr>`).join('');
  body.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{
    const row=catalogTempRows[Number(el.dataset.i)];
    if(el.dataset.side){row.sidePrices={...(row.sidePrices||{})};if(el.value==='')delete row.sidePrices[el.dataset.side];else row.sidePrices[el.dataset.side]=el.value;}
    else row[el.dataset.f]=el.value;
    if(el.dataset.f==='printSides')el.closest('tr').querySelectorAll('[data-side]').forEach(p=>p.placeholder=el.value===p.dataset.side?'Dùng giá hiện tại':'Chưa có giá');
  }));
};
async function saveStateV29(key,value) {
  if(!currentUser||!cloudSyncReady)throw new Error('Chưa kết nối máy chủ. Vui lòng đăng nhập lại trước khi lưu.');
  const response=await fetch('/api/state/'+encodeURIComponent(key),{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Không lưu được dữ liệu.');
  __nativeSetItem.call(localStorage,key,JSON.stringify(value));return result;
}
saveCatalogDetail = async function () {
  if(!catalogEditingKey||!hasPermission('priceAdjust'))return;
  if(saveCatalogDetail.busy)return;
  const key=catalogEditingKey, all=getCatalogOverrides(), old=all[key]||{};
  const next={...old,prices:{...(old.prices||{})},printSides:{...(old.printSides||{})},sidePrices:{...(old.sidePrices||{})},pricingUpdatedAt:{...(old.pricingUpdatedAt||{})},labels:{...catalogTempLabels}};
  for(const row of catalogTempRows){
    if(!Q29.validPrice(row.price)||Object.values(row.sidePrices||{}).some(v=>!Q29.validPrice(v))){showToast('Giá phải là số không âm. Không để trống giá hiện tại.');return;}
    if(row.custom)continue;
    next.prices[row.key]=Number(row.price);
    next.printSides[row.key]=Q29.side(row.printSides);
    next.sidePrices[row.key]=Object.fromEntries(Object.entries(row.sidePrices||{}).filter(([s])=>Q29.side(s)).map(([s,v])=>[s,Number(v)]));
    next.pricingUpdatedAt[row.key]=Date.now();
  }
  next.updatedAt=new Date().toISOString();next.updatedBy=currentUser.username;all[key]=next;
  saveCatalogDetail.busy=true;
  try{await saveStateV29(CATALOG_OVERRIDES_KEY,all);closeCatalogDetail();renderPricebook();renderConfigurator();showToast('Đã lưu giá in 1 mặt / 2 mặt trên máy chủ.');}
  catch(err){alert(err.message);}finally{saveCatalogDetail.busy=false;}
};
defaultCustomVariant = function (n=1) {
  return {...legacyV29.defaultCustomVariant(n),basePrice:'',printSides:'1',sidePrices:{}};
};
openCustomProductModal = function (key=null) {
  legacyV29.openCustomProductModal(key);
  if(!$('customProductModal')?.classList.contains('show'))return;
  if(key)customVariantDraft=customVariantDraft.map(v=>{
    const row=rowPricingV29(key,`custom:${key}|variant:${v.id||'default'}`,v.basePrice);
    return {...v,basePrice:row.price,printSides:row.printSides,sidePrices:{...row.sidePrices}};
  });
  renderCustomVariantDraft();
};
renderCustomVariantDraft = function () {
  const body=$('customVariantBody');if(!body)return;
  body.closest('table').querySelector('thead tr').innerHTML='<th>Tên quy cách</th><th>Chất liệu</th><th>Cách tính</th><th>Đơn vị</th><th>Giá cơ bản (đ)</th><th>Số mặt của giá cơ bản</th><th>Giá in 1 mặt (đ)</th><th>Giá in 2 mặt (đ)</th><th>Ngang cm</th><th>Cao cm</th><th></th>';
  body.innerHTML=customVariantDraft.map((v,i)=>`<tr>
    <td><input data-vfield="name" value="${esc(v.name||'')}" placeholder="A4 / 60 × 90 cm"></td>
    <td><input data-vfield="material" value="${esc(v.material||'')}" placeholder="Mica / Decal / Canvas"></td>
    <td><select data-vfield="priceMode">${[['unit','Theo đơn vị'],['sheet','Theo tấm'],['m2','Theo m²']].map(([k,l])=>`<option value="${k}"${v.priceMode===k?' selected':''}>${l}</option>`).join('')}</select></td>
    <td><input data-vfield="unit" value="${esc(v.unit||'Cái')}" placeholder="Cái, Tấm, Bộ…" maxlength="40"></td>
    <td><input data-vfield="basePrice" type="number" min="0" step="any" value="${esc(priceEntryV29(v.basePrice))}" placeholder="Nhập giá"></td>
    <td><select data-vfield="printSides">${sideOptionsV29(v.printSides)}</select></td>
    ${['1','2'].map(s=>`<td><input data-vside="${s}" type="number" min="0" step="any" value="${esc(priceEntryV29(v.sidePrices?.[s]))}" placeholder="${v.printSides===s?'Dùng giá cơ bản':'Chưa có giá'}"></td>`).join('')}
    <td><input data-vfield="width" type="number" min="0" step="any" value="${Number(v.width)||0}"></td>
    <td><input data-vfield="height" type="number" min="0" step="any" value="${Number(v.height)||0}"></td>
    <td><button type="button" class="ghost-btn danger-text" onclick="removeCustomVariantRow(${i})">Xóa</button></td></tr>`).join('');
  body.querySelectorAll('[data-vfield="printSides"]').forEach(el=>el.addEventListener('change',()=>el.closest('tr').querySelectorAll('[data-vside]').forEach(p=>p.placeholder=el.value===p.dataset.vside?'Dùng giá cơ bản':'Chưa có giá')));
};
syncCustomVariantDraftFromDom = function () {
  document.querySelectorAll('#customVariantBody tr').forEach((tr,i)=>{
    const v=customVariantDraft[i];if(!v)return;
    tr.querySelectorAll('[data-vfield]').forEach(el=>v[el.dataset.vfield]=el.value);
    v.sidePrices={};tr.querySelectorAll('[data-vside]').forEach(el=>{if(el.value!=='')v.sidePrices[el.dataset.vside]=el.value;});
  });
};
saveCustomProductFromModal = async function () {
  if(!hasPermission('priceAdjust')||saveCustomProductFromModal.busy)return;
  syncCustomVariantDraftFromDom();
  const name=$('customProductName').value.trim();if(!name){showToast('Vui lòng nhập tên hạng mục.');return;}
  for(const v of customVariantDraft){
    if(!Q29.validPrice(v.basePrice)||Object.values(v.sidePrices||{}).some(n=>!Q29.validPrice(n))){showToast('Vui lòng nhập giá cơ bản hợp lệ, không âm. Giá mặt chưa có có thể để trống.');return;}
    if(!String(v.unit||'').trim()||!Number.isFinite(Number(v.width))||Number(v.width)<0||!Number.isFinite(Number(v.height))||Number(v.height)<0){showToast('Đơn vị tính hoặc kích thước không hợp lệ.');return;}
  }
  if(!customVariantDraft.length)return;
  const now=Date.now(), key=editingCustomProductKey||`custom_${now}`;
  const list=getCustomProducts(), old=list.find(x=>x.key===key);
  const variants=customVariantDraft.map((v,i)=>({...v,id:v.id||`v_${now}_${i}`,name:String(v.name).trim()||`Quy cách ${i+1}`,material:String(v.material).trim()||name,unit:String(v.unit).trim(),basePrice:Number(v.basePrice),printSides:Q29.side(v.printSides),sidePrices:Object.fromEntries(Object.entries(v.sidePrices||{}).map(([s,n])=>[s,Number(n)])),width:Number(v.width),height:Number(v.height),pricingUpdatedAt:now}));
  const item={...(old||{}),key,name,variants,note:$('customProductNote').value.trim(),updatedAt:new Date().toISOString(),updatedBy:currentUser.username};
  if(!old){item.createdAt=item.updatedAt;item.createdBy=currentUser.username;}
  saveCustomProductFromModal.busy=true;
  try{
    const response=await fetch(`/api/entity/${CUSTOM_PRODUCTS_KEY}/${encodeURIComponent(key)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({item,expectedVersion:Number(old?.version||0)})});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Không lưu được hạng mục.');
    const saved=result.item||item, index=list.findIndex(x=>x.key===key);if(index<0)list.push(saved);else list[index]=saved;
    __nativeSetItem.call(localStorage,CUSTOM_PRODUCTS_KEY,JSON.stringify(list));
    renderProductSelect();closeCustomProductModal();renderPricebook();renderConfigurator();showToast('Đã lưu hạng mục và giá theo số mặt trên máy chủ.');
  }catch(err){alert(err.message);}finally{saveCustomProductFromModal.busy=false;}
};
renderPricebook = function () {
  legacyV29.renderPricebook();
  const search=fieldVal('priceSearch').trim().toLowerCase();
  if(!search||'hạng mục khác nhập thủ công'.includes(search)){
    $('pricebookGrid')?.insertAdjacentHTML('beforeend',`<article class="pricebook-card manual-product-card"><div class="pricebook-index">NHẬP THỦ CÔNG</div><h3>Hạng mục khác</h3><p>Chất liệu, số mặt in, kích thước, số lượng, gia công và ghi chú theo yêu cầu. Nhập đơn giá hoặc tổng tiền.</p>${hasPermission('quote')?'<div class="pricebook-actions"><button onclick="startProductQuote(\'other\')">Tạo báo giá</button></div>':''}</article>`);
  }
};
const styleV29=document.createElement('style');
styleV29.textContent=`
.manual-v29 .form-grid{gap:14px}.manual-v29 .control{font-size:14px!important;min-height:42px}
.manual-pricing-v29{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:12px;padding:16px;margin-top:16px;background:var(--greenSoft);border:1px solid var(--greenLine);border-radius:12px}
.manual-pricing-v29 .derived-price{background:#f8faf9}.print-side-field{grid-column:1/-1;max-width:100%}
.manual-v29 .label,.print-side-field .label{font-size:13px!important}.manual-v29 .help,.print-side-field .help{font-size:12px!important;line-height:1.5}
.bulk-side-v29{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}.bulk-side-v29 .control{width:auto}
#catalogPriceBody input,#catalogPriceBody select,#customVariantBody input,#customVariantBody select{font-size:12px!important;min-height:38px;min-width:110px;width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:8px}
#catalogPriceBody td:nth-child(7),#customVariantBody td:nth-child(6){min-width:165px}
#catalogPriceBody td,#customVariantBody td{padding:8px!important}.catalog-modal{width:min(1500px,100%)!important}
.catalog-table-wrap,.custom-variants-table-wrap{max-width:100%;overflow-x:auto}.manual-product-card{border-color:var(--greenLine)}
@media(max-width:680px){.manual-pricing-v29{grid-template-columns:1fr}.manual-v29 .form-grid{grid-template-columns:1fr}.bulk-side-v29{align-items:stretch;flex-direction:column}.bulk-side-v29 .control{width:100%}}
`;
document.head.appendChild(styleV29);
