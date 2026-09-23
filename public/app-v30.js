/* V30: area billing, receivables, design KPI, explicit backup and customer reconciliation. */
'use strict';
const B30=HTXBusinessV30;
const legacyV30={prefill:prefillConfiguratorFromItem,editOrder,resetQuoteForm,quoteForCustomerId,saveQuote,enterApp,renderHistory,openPayrollModal,collectPayrollForm,updatePayrollPreview,renderAccounts};
let selectedCustomerIdV30=null,designKpiDraftV30=null,refreshDesignKpiV30=false,kpiLoadV30=0;
function kpiLabelV30(r){return r.designKpi?`${r.designKpi.count} sản phẩm — ${r.designKpi.status}`:`${Number(r.kpiPercent||0)}% (KPI đã lưu)`;}
renderManualV29=function(){
 setStaticSpecs(['Kích thước nhập bằng cm','m² = ngang × cao ÷ 10.000 × số lượng']);
 $('configurator').innerHTML=`<div class="manual-v29"><div class="form-grid">
 ${textFieldV29('otherName','Tên hạng mục','Ví dụ: In decal')}
 ${textFieldV29('otherMaterial','1. Chất liệu','Decal, PP, Bạt…')}
 <div class="field"><label class="label" for="printSides">2. Số mặt in</label><select id="printSides" class="control auto-field">${sideOptionsV29('1',false)}</select></div>
 <div class="field"><label class="label" for="otherUnit">Đơn vị tính</label><select id="otherUnit" class="control auto-field"><option>Cái</option><option>Tấm</option><option>Tờ</option><option value="m²">m²</option></select></div>
 ${numberField('otherWidthCm','3. Chiều ngang (cm)','',0.01,'any')}
 ${numberField('otherHeightCm','Chiều cao (cm)','',0.01,'any')}
 ${numberField('qty','4. Số lượng bản / tấm',1,1,1)}
 ${textFieldV29('otherFinishing','5. Loại gia công','Cán màng, bế demi, đục lỗ…')}
 </div><div id="areaSummaryV30" class="area-summary-v30" aria-live="polite">Nhập kích thước để quy đổi diện tích.</div>
 <div class="manual-pricing-v29"><div class="field"><label class="label" for="manualPriceMode">Cách nhập giá</label><select id="manualPriceMode" class="control"><option value="unit">Nhập đơn giá → tính tổng</option><option value="total">Nhập tổng → tính đơn giá</option></select></div>
 <div class="field"><label id="unitPriceLabelV30" class="label" for="manualUnitPrice">Đơn giá (đ/cái)</label><input class="control" id="manualUnitPrice" type="number" min="0" step="any" inputmode="decimal"></div>
 <div class="field"><label class="label" for="manualTotal">Tổng tiền (đ)</label><input class="control" id="manualTotal" type="number" min="0" step="1" inputmode="numeric"></div></div>
 <p class="help">Giá m² nhân tổng diện tích; giá Cái/Tấm/Tờ nhân số lượng. Không nhân thêm số mặt in. Giá 1 mặt/2 mặt do bạn nhập riêng.</p></div>`;
 $('itemNote').value='';$('itemNote').placeholder='6. Ghi chú kỹ thuật hoặc yêu cầu riêng';
 for(const el of document.querySelectorAll('#configurator .auto-field')){el.addEventListener('input',syncManualV29);el.addEventListener('change',syncManualV29);}
 $('manualUnitPrice').oninput=()=>{$('manualPriceMode').value='unit';syncManualV29();};
 $('manualTotal').oninput=()=>{$('manualPriceMode').value='total';syncManualV29();};$('manualPriceMode').onchange=syncManualV29;syncManualV29();
};
manualInputV29=function(){return {version:30,name:fieldVal('otherName').trim(),material:fieldVal('otherMaterial').trim(),printSides:fieldVal('printSides'),widthCm:fieldVal('otherWidthCm'),heightCm:fieldVal('otherHeightCm'),copies:fieldVal('qty'),unit:fieldVal('otherUnit'),finishing:fieldVal('otherFinishing').trim(),mode:fieldVal('manualPriceMode'),unitPrice:fieldVal('manualUnitPrice'),total:fieldVal('manualTotal')};};
syncManualV29=function(){
 const input=manualInputV29(),result=B30.areaQuote(input);
 const target=input.mode==='total'?$('manualUnitPrice'):$('manualTotal');if(target)target.value=result.ok?String(input.mode==='total'?result.unitPrice:result.total):'';
 const width=Number(input.widthCm),height=Number(input.heightCm),copies=Number(input.copies),area=width*height/10000;
 $('unitPriceLabelV30').textContent=`Đơn giá (đ/${input.unit==='m²'?'m²':input.unit.toLowerCase()})`;
 $('areaSummaryV30').textContent=width>0&&height>0&&copies>0?`${formatQuantityV29(width)} × ${formatQuantityV29(height)} cm = ${formatQuantityV29(area)} m²/bản • ${copies} bản = ${formatQuantityV29(area*copies)} m². ${input.unit==='m²'?'Tính tiền theo tổng m².':'Tính tiền theo số lượng, không nhân thêm diện tích.'}`:'Nhập chiều ngang, chiều cao bằng cm và số lượng.';
 previewCurrent();
};
calcManualV29=function(){
 const input=manualInputV29(),result=B30.areaQuote(input);if(!result.ok)return {...result,details:[],breakdown:[]};
 if(!input.material)return {ok:false,reason:'Vui lòng nhập chất liệu.'};
 const sides=Q29.side(input.printSides);if(!sides)return {ok:false,reason:'Vui lòng chọn số mặt in.'};
 return {...result,name:input.name||'Hạng mục khác',printSides:sides,
  pricingInput:{...input,widthCm:result.widthCm,heightCm:result.heightCm,copies:result.copies,qty:result.copies,billedQty:result.billedQty,areaPerPiece:result.areaPerPiece,totalArea:result.totalArea,unitPrice:result.unitPrice,total:result.total},
  details:[{label:'Chất liệu',value:input.material},{label:'Số mặt in',value:`In ${sides} mặt`},{label:'Kích thước',value:`${formatQuantityV29(result.widthCm)} × ${formatQuantityV29(result.heightCm)} cm`},{label:'Số bản / tấm',value:result.copies},{label:'Diện tích mỗi bản',value:`${formatQuantityV29(result.areaPerPiece)} m²`},{label:'Tổng diện tích',value:`${formatQuantityV29(result.totalArea)} m²`},{label:'Loại gia công',value:input.finishing||'Không'},{label:'Cách tính giá',value:input.unit==='m²'?'Diện tích × đơn giá m²':'Số lượng × đơn giá'}],
  breakdown:[['Đơn giá',formatUnitPriceV29(result.unitPrice)+'/'+result.unit],['Khối lượng tính tiền',`${formatQuantityV29(result.qty)} ${result.unit}`],['Tổng',result.total]]};
};
prefillConfiguratorFromItem=function(item){
 if(item.productKey!=='other')return legacyV30.prefill(item);
 const p=item.pricingInput||{},isNew=Number(p.version)>=30;
 const oldSize=String(p.size||findDetail(item,'Kích thước')||'').match(/([\d.,]+)\s*[x×*]\s*([\d.,]+)\s*(cm)?/i);
 const values={otherName:p.name||item.name,otherMaterial:p.material||findDetail(item,'Chất liệu'),printSides:p.printSides||item.printSides||'1',otherUnit:B30.unit(p.unit||item.unit)||'Cái',otherWidthCm:p.widthCm??oldSize?.[1]??'',otherHeightCm:p.heightCm??oldSize?.[2]??'',qty:isNew?p.copies:item.qty,otherFinishing:p.finishing||findDetail(item,'Loại gia công'),manualPriceMode:isNew?p.mode:'total',manualUnitPrice:p.unitPrice??item.unitPrice,manualTotal:item.total};
 for(const [id,v]of Object.entries(values))if($(id))$(id).value=v??'';
 if(!isNew&&item.unit==='m²'){$('qty').value='1';showToast('Dòng m² cũ: tổng tiền được giữ lại. Hãy xác nhận kích thước và số bản trước khi cập nhật.');}
 syncManualV29();
};
function setupDesignCountV30(){
 if($('designProductCount'))return;
 const input=$('designFee');if(!input)return;input.readOnly=true;
 input.insertAdjacentHTML('beforebegin','<label class="label" for="designProductCount">Số sản phẩm thiết kế</label><input class="control" id="designProductCount" type="number" min="0" step="1" value="0"><div class="help" id="designCountHelpV30">40.000đ / sản phẩm thiết kế. Một mẫu in nhiều bản vẫn là một sản phẩm thiết kế.</div>');
 $('designProductCount').addEventListener('input',()=>{const n=Number($('designProductCount').value);if(Number.isSafeInteger(n)&&n>=0){input.value=n*40000;renderQuote();}});
}
function designCountForSaveV30(){const raw=$('designProductCount')?.value??'';return raw===''?null:Number(raw);}
resetQuoteForm=function(...args){const r=legacyV30.resetQuoteForm(...args);selectedCustomerIdV30=null;if($('designProductCount'))$('designProductCount').value='0';return r;};
editOrder=function(id){legacyV30.editOrder(id);const order=getHistory().find(o=>Number(o.id)===Number(id));selectedCustomerIdV30=order?.customerId||null;
 $('designProductCount').value=order?.designProductCount??'';
 $('designCountHelpV30').textContent=order?.designProductCount==null?'Đơn cũ: giữ nguyên phí đã lưu. Nhập số sản phẩm khi cần xác nhận lại theo mức 40.000đ/sản phẩm.':'40.000đ / sản phẩm thiết kế; không nhân theo số bản in.';
};
quoteForCustomerId=function(id){legacyV30.quoteForCustomerId(id);selectedCustomerIdV30=id;};
saveQuote=function(){
 const n=designCountForSaveV30();if(n!==null&&(!Number.isSafeInteger(n)||n<0)){showToast('Số sản phẩm thiết kế phải là số nguyên không âm.');return null;}
 return legacyV30.saveQuote();
};
async function updateOrderV30(id,change,message){
 const list=getHistory(),order=list.find(o=>String(o.id)===String(id));if(!order)return;
 change(order);if(await writeHistory(list)){renderHistory();renderCustomers();renderDashboard();renderWorkMonth();showToast(message);}
}
setOrderStatus=async function(id,status){return updateOrderV30(id,o=>{o.status=status;},'Đã lưu tiến độ trên máy chủ.');};
setOrderDesigner=async function(id,value){if(!hasPermission('assignDesigner'))return;return updateOrderV30(id,o=>{o.designerId=Number(value)||null;o.designerName=designerNameById(o.designerId);},'Đã lưu phân công thiết kế.');};
setOrderPaymentMethod=async function(id,value){if(!hasPermission('payment'))return;return updateOrderV30(id,o=>{o.paymentMethod=value;},'Đã lưu cách thu tiền.');};
toggleOrderPaid=async function(id){
 if(!hasPermission('payment'))return;
 const x=getHistory().find(o=>String(o.id)===String(id));if(!x)return;
 if(!x.paid&&!x.paymentMethod){showToast('Vui lòng chọn cách thu tiền.');return;}
 if(x.paid&&!confirm('Hủy xác nhận đã thu đủ? Tiền đã thu sẽ trở về mức đặt cọc đã nhập.'))return;
 return updateOrderV30(id,o=>{o.paid=!o.paid;o.receivedAmount=o.paid?B30.balance(o).total:Number(o.deposit?.amount||0);},'Đã lưu thanh toán.');
};
renderHistory=function(){legacyV30.renderHistory();
 for(const card of document.querySelectorAll('#history [data-order-id]')){
  const order=getHistory().find(o=>String(o.id)===card.dataset.orderId);if(!order)continue;
  const count=order.designProductCount;
  if(order.designWork)card.insertAdjacentHTML('beforeend',`<div class="design-work-v30">Thiết kế đã hoàn thành: <b>${order.designWork.count} sản phẩm</b> • ${esc(order.designWork.employeeName||'')} • ${esc(order.designWork.date||'')} (đã ghi nhận KPI một lần)</div>`);
  else if(Number(order.designFee||0)>0&&(['director','accounting'].includes(currentUser?.role)||(currentUser?.role==='designer'&&String(currentUser.id)===String(order.designerId))))card.insertAdjacentHTML('beforeend',`<div class="design-work-v30">${count==null?'Chưa xác nhận số sản phẩm thiết kế':`${count} sản phẩm thiết kế × 40.000đ`} <button class="ghost-btn" onclick="completeDesignV30('${order.id}')">Xác nhận thiết kế hoàn thành</button></div>`);
 }
};
async function completeDesignV30(id){
 const order=getHistory().find(o=>String(o.id)===String(id));if(!order)return;
 let count=order.designProductCount;
 if(count==null){const raw=prompt('Xác nhận số sản phẩm thiết kế của đơn cũ (không phải số bản in). Phí đã lưu: '+money(order.designFee||0));if(raw===null)return;count=Number(raw);}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let date=today;if(['director','accounting'].includes(currentUser.role)){date=prompt('Ngày hoàn thành thiết kế (YYYY-MM-DD), dùng để ghi nhận đúng tháng KPI:',today);if(date===null)return;}
 if(!confirm(`Ghi nhận ${count} sản phẩm thiết kế cho ${order.designerName||'nhân viên được phân công'}, ngày ${date}? Việc đổi tiến độ sau đó không cộng thêm KPI.`))return;
 try{await requestV30('/api/orders/'+id+'/design-complete',{method:'POST',body:JSON.stringify({count,date,expectedVersion:order.version||0})});await hydrateFromBackend();renderHistory();showToast('Đã ghi nhận hoàn thành thiết kế.');}catch(err){alert(err.message);}
}
function showKpiDraftV30(value){
 designKpiDraftV30=value;
 if(value){$('payKpiBonus').value=value.amount;$('payKpiPercent').value=value.percent;}
 $('designKpiInfoV30').textContent=value?`${value.count} sản phẩm — ${value.status} — ${money(value.amount)}. ${value.rule==='milestones'?'Theo mốc: 100–149 = 1 triệu; 150–199 = 1,5 triệu; từ 200 = 2 triệu.':'Từ 100: 10.000đ/sản phẩm.'} Dưới 100: 5.000đ/sản phẩm, không thưởng thêm.`:'Phiếu cũ được giữ nguyên. Bấm Cập nhật KPI để áp dụng các đơn đã xác nhận hoàn thành.';
 legacyV30.updatePayrollPreview();
}
async function loadDesignKpiV30(){
 const token=++kpiLoadV30,id=fieldVal('payrollEmployeeId'),month=fieldVal('payrollMonth')||getWorkMonth();
 const user=getUsers().find(u=>String(u.id)===id);const isDesigner=user?.role==='designer';
 $('designKpiBoxV30').hidden=!isDesigner;$('payKpiBonus').readOnly=isDesigner;$('payKpiPercent').readOnly=isDesigner;
 if(!isDesigner){designKpiDraftV30=null;return;}
 try{const summary=await requestV30(`/api/payroll/design-summary?month=${encodeURIComponent(month)}&employeeId=${encodeURIComponent(id)}`);if(token!==kpiLoadV30)return;
  refreshDesignKpiV30=true;$('kpiRuleV30').value=summary.rule;showKpiDraftV30(summary);
 }catch(err){$('designKpiInfoV30').textContent=err.message;}
}
function setupKpiV30(){
 if($('designKpiBoxV30'))return;
 $('payKpiBonus').closest('.payroll-section').insertAdjacentHTML('afterend',`<div class="field" id="designKpiBoxV30" style="grid-column:1/-1" hidden><strong>KPI thiết kế từ đơn đã xác nhận</strong><p class="help" id="designKpiInfoV30"></p><button class="ghost-btn" type="button" id="refreshKpiV30">Cập nhật KPI theo đơn hoàn thành</button><label class="label" for="kpiRuleV30">Quy tắc cho phiếu mới / lần cập nhật KPI tiếp theo (chỉ Giám đốc thay đổi)</label><select class="control" id="kpiRuleV30"><option value="milestones">Theo các mốc 100 / 150 / 200 sản phẩm</option><option value="per-product">Từ 100: tính 10.000đ cho mỗi sản phẩm</option></select></div>`);
 $('refreshKpiV30').onclick=loadDesignKpiV30;$('payrollEmployeeId').addEventListener('change',loadDesignKpiV30);
 $('kpiRuleV30').onchange=async()=>{if(!confirm('Áp dụng quy tắc này cho các lần tính KPI mới? Phiếu lương đã lưu không bị đổi tự động.'))return;
  try{await requestV30('/api/admin/design-kpi-policy',{method:'PUT',body:JSON.stringify({rule:$('kpiRuleV30').value})});await loadDesignKpiV30();}catch(err){alert(err.message);}};
}
openPayrollModal=function(id=null){
 designKpiDraftV30=null;refreshDesignKpiV30=false;legacyV30.openPayrollModal(id);
 const month=fieldVal('payrollMonth')||getWorkMonth(),old=getPayrollMonthRecords(month).find(r=>String(r.id)===String(id));
 const user=getUsers().find(u=>String(u.id)===fieldVal('payrollEmployeeId')),isDesigner=(old?.role||user?.role)==='designer';
 $('designKpiBoxV30').hidden=!isDesigner;$('payKpiBonus').readOnly=isDesigner;$('payKpiPercent').readOnly=isDesigner;$('kpiRuleV30').disabled=currentUser?.role!=='director';
 if(isDesigner){if(old){showKpiDraftV30(old.designKpi||null);if(old.designKpi)$('kpiRuleV30').value=old.designKpi.rule;}else void loadDesignKpiV30();}
};
collectPayrollForm=function(){const r=legacyV30.collectPayrollForm();if(r.role==='designer'&&designKpiDraftV30){r.designKpi=designKpiDraftV30;r.kpiBonus=designKpiDraftV30.amount;r.kpiPercent=designKpiDraftV30.percent;}return r;};
savePayrollRecord=async function(){
 if(!hasPermission('payroll')||savePayrollRecord.busy)return;const r=collectPayrollForm(),month=fieldVal('payrollMonth')||getWorkMonth();
 const old=getPayrollMonthRecords(month).find(x=>String(x.employeeId)===String(r.employeeId));
 try{savePayrollRecord.busy=true;await requestV30(`/api/payroll/${month}/${r.employeeId}`,{method:'PUT',body:JSON.stringify({record:r,refreshDesignKpi:refreshDesignKpiV30,expectedVersion:old?.version||0})});await hydrateFromBackend();closePayrollModal();renderPayroll();showToast('Đã lưu phiếu lương và KPI trên máy chủ.');}
 catch(err){alert(err.message);}finally{savePayrollRecord.busy=false;}
};
deletePayrollRecord=async function(id){const month=fieldVal('payrollMonth')||getWorkMonth(),r=getPayrollMonthRecords(month).find(x=>String(x.id)===String(id));if(!r||!confirm('Xóa phiếu lương này? Bản trước được lưu trong lịch sử thay đổi.'))return;
 try{await requestV30(`/api/payroll/${month}/${r.employeeId}`,{method:'DELETE',body:JSON.stringify({expectedVersion:r.version||0})});await hydrateFromBackend();renderPayroll();}catch(err){alert(err.message);}
};
function setupBackupV30(){
 if($('businessBackupV30'))return;
 $('page-accounts').insertAdjacentHTML('beforeend','<div class="backup-v30" id="businessBackupV30"><h3>Sao lưu dữ liệu kinh doanh</h3><p class="help">Tải bản sao đơn, khách hàng, bảng giá, kho, lương và lịch sử thay đổi. File này không chứa mật khẩu/khóa dịch vụ. Bản sao mã nguồn không thay thế bản sao dữ liệu.</p><button class="btn btn-green" onclick="backupBusinessV30()">TẢI BẢN SAO DỮ LIỆU</button> <button class="ghost-btn" onclick="restoreBusinessV30()">Đối chiếu / khôi phục bản ghi thiếu</button><input type="file" id="restoreBusinessFileV30" accept="application/json,.json" hidden><p id="backupStatusV30" class="help"></p></div>');
 const host=$('page-customers').querySelector('.page-title-row')||$('page-customers');host.insertAdjacentHTML('beforeend','<button class="ghost-btn" id="duplicatesBtnV30" onclick="checkDuplicatesV30()">Kiểm tra hồ sơ trùng</button>');
 $('businessBackupV30').hidden=currentUser?.role!=='director';$('duplicatesBtnV30').hidden=currentUser?.role!=='director';
}
async function backupBusinessV30(){
 try{$('backupStatusV30').textContent='Đang đọc dữ liệu máy chủ…';const result=await requestV30('/api/admin/backup');downloadJSONV30(result,'HTX-du-lieu-'+new Date().toISOString().slice(0,10)+'.json');$('backupStatusV30').textContent='Đã tạo file sao lưu lúc '+new Date(result.exportedAt).toLocaleString('vi-VN')+'. Đơn: '+result.counts.orders+'; khách hàng: '+result.counts.customers+'. Lưu file ở nơi riêng an toàn.';}
 catch(err){$('backupStatusV30').textContent='Chưa sao lưu: '+err.message;}
}
function restoreBusinessV30(){const input=$('restoreBusinessFileV30');input.value='';input.onchange=async()=>{
 try{const backup=JSON.parse(await input.files[0].text());const report=await requestV30('/api/admin/backup/preview',{method:'POST',body:JSON.stringify({backup})});
 if(!confirm(`Đối chiếu: ${report.created} bản ghi thiếu; ${report.existing} bản ghi giống; ${report.conflicts} bản ghi khác. Chỉ bổ sung bản ghi thiếu; KHÔNG ghi đè/xóa bản đang có. Tiếp tục?`))return;
 const result=await requestV30('/api/admin/backup/restore-missing',{method:'POST',body:JSON.stringify({backup,confirm:'RESTORE_MISSING_ONLY'})});await hydrateFromBackend();enterApp();alert(`Đã bổ sung ${result.created} bản ghi thiếu. ${result.conflicts} bản ghi khác được giữ nguyên để đối chiếu.`);
 }catch(err){alert(err.message);}
 };input.click();}
async function checkDuplicatesV30(){
 try{const {groups}=await requestV30('/api/admin/customers/duplicates');if(!groups.length){alert('Không thấy nhóm trùng chắc chắn theo thông tin liên hệ và tên/đơn vị. Không tự gộp các khách chỉ trùng tên.');return;}
 for(const group of groups){const target=group.slice().sort((a,b)=>Number(a.id)-Number(b.id))[0];const text=group.map(p=>`${p.code||p.id} • ${p.name} • ${p.phone||p.email||p.taxCode}`).join('\n');
 if(!confirm(text+`\n\nGộp vào ${target.code||target.id}? Hồ sơ phụ được lưu trữ (không xóa vĩnh viễn); đơn được liên kết về một khách. Hãy tải sao lưu trước.`))continue;
 await requestV30('/api/admin/customers/merge',{method:'POST',body:JSON.stringify({ids:group.map(p=>p.id),targetId:target.id,confirm:true})});}
 await hydrateFromBackend();renderCustomers();renderHistory();
 }catch(err){alert(err.message);}
}
saveCustomerProfileFromModal=async function(){
 if(!['director','accounting','sales'].includes(currentUser?.role))return;
 const name=fieldVal('crmName').trim();if(!name){showToast('Nhập tên khách hàng.');return;}
 const id=fieldVal('crmCustomerId'),old=getCustomerProfiles().find(x=>String(x.id)===id),nid=id||String(Date.now()*1000+Math.floor(Math.random()*1000));
 const item={...(old||{}),id:Number(nid),name,code:old?.code||makeCustomerCode(nid)};
 for(const [key,field]of Object.entries({company:'crmCompany',address:'crmAddress',phone:'crmPhone',email:'crmEmail',cccd:'crmCCCD',taxCode:'crmTaxCode',tier:'crmTier',owner:'crmOwner',note:'crmNote'}))item[key]=fieldVal(field).trim();
 const before=getCustomerProfiles(),after=old?before.map(x=>String(x.id)===id?item:x):[...before,item];
 __nativeSetItem.call(localStorage,CUSTOMER_PROFILE_KEY,JSON.stringify(after));
 if(await pushCollectionDelta(CUSTOMER_PROFILE_KEY,JSON.stringify(before),JSON.stringify(after))){closeCustomerProfileModal();renderCustomers();showToast('Đã lưu hồ sơ khách hàng.');}
};
const oldGetCustomerProfilesV30=getCustomerProfiles;
getCustomerProfiles=function(){return oldGetCustomerProfilesV30().filter(p=>!p.mergedInto);};
enterApp=function(){legacyV30.enterApp();setupBackupV30();$('businessBackupV30').hidden=currentUser?.role!=='director';$('duplicatesBtnV30').hidden=currentUser?.role!=='director';void startRealtime();};
setupDesignCountV30();setupKpiV30();
const cssV30=document.createElement('style');cssV30.textContent=`
.area-summary-v30,.design-work-v30,.backup-v30{background:#eff7f3;border:1px solid #c8dfd2;border-radius:10px;padding:12px;margin:12px 0;font-size:13px;line-height:1.6}
.order-total{text-align:right;display:grid;gap:5px}.order-total small{font-size:12px;font-weight:400;color:#55605a}.order-receivable{font-size:18px;color:#b03827}.order-receivable.settled{color:#087444}
.pending-v30{position:sticky;top:0;z-index:12000;background:#fff2d5;color:#754806;padding:12px;font-size:13px;border-bottom:1px solid #e2bf77}.pending-v30[hidden]{display:none}
#erpShell.auth-locked~.pending-v30{display:none}#designKpiBoxV30{padding:12px;background:#eef7f1;border-radius:10px}#designKpiBoxV30[hidden]{display:none}
@media(max-width:600px){.order-head{flex-direction:column;gap:12px}.order-total{text-align:left}.order-receivable{font-size:17px}.backup-v30 .btn{width:100%;margin-bottom:10px}}
`;document.head.appendChild(cssV30);
deleteOrder=async function(id){
 if(!hasPermission('deleteOrder'))return;const row=getHistory().find(o=>String(o.id)===String(id));if(!row||!confirm('Xóa riêng đơn '+(row.orderCode||id)+'? Bản trước được giữ trong lịch sử thay đổi.'))return;
 if(await writeHistory(getHistory().filter(o=>String(o.id)!==String(id)))){closeOrderModal();renderHistory();renderCustomers();renderDashboard();showToast('Đã xóa đơn trên máy chủ.');}
};
deleteCustomerOnly=async function(id){
 if(!hasPermission('deleteCustomer'))return;const row=getCustomerProfiles().find(p=>String(p.id)===String(id));if(!row)return;
 if(getHistory().some(o=>orderBelongsToCustomerProfile(o,row))){alert('Khách hàng đang có đơn liên kết. Không xóa làm mất liên kết. Dùng Kiểm tra hồ sơ trùng để gộp hồ sơ trùng có đối chiếu.');return;}
 if(!confirm('Xóa hồ sơ khách hàng không có đơn liên kết này?'))return;
 const before=getCustomerProfiles(),after=before.filter(p=>String(p.id)!==String(id));
 if(await pushCollectionDelta(CUSTOMER_PROFILE_KEY,JSON.stringify(before),JSON.stringify(after))){closeCustomerProfileModal();renderCustomers();showToast('Đã xóa hồ sơ.');}
};
