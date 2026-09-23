import { db } from './firebase-admin.js';
import { approved, fail } from './access-policy.js';
import { historyWrite, readRows } from './data-safety.js';
import '../public/business-v30.js';
const B=globalThis.HTXBusinessV30;
const PAYROLL='htx_payroll_v17';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const payrollAllowed=user=>['director','accounting'].includes(user.role);
function monthValue(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))throw fail('Tháng KPI không hợp lệ.');return String(month);}
function validId(id){if(!/^\d{1,16}$/.test(String(id)))throw fail('Mã nhân viên/đơn không hợp lệ.');return String(id);}
export async function completeDesign(orderId,input,actor){
  orderId=validId(orderId);
  const date=String(input?.date||today());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today())throw fail('Ngày hoàn thành phải hợp lệ và không ở tương lai.');
  if(date!==today()&&!payrollAllowed(actor))throw fail('Chỉ Giám đốc/Kế toán được xác nhận ngày hoàn thành trong quá khứ.',403);
  const ref=db.collection('orders').doc(orderId),ledgerRef=db.collection('designCompletions').doc(orderId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref),ledger=await tx.get(ledgerRef);
    if(!snap.exists)throw fail('Không tìm thấy đơn.',404);
    const order=snap.data();
    if(!payrollAllowed(actor)&&!(actor.role==='designer'&&String(actor.id)===String(order.designerId)))throw fail('Chỉ người thiết kế được phân công hoặc Giám đốc/Kế toán xác nhận hoàn thành.',403);
    if(ledger.exists)return {ok:true,item:order,completion:ledger.data(),alreadyCompleted:true};
    if(Number(input.expectedVersion)!==Number(order.version||0))throw fail('Đơn vừa thay đổi; tải lại trước khi xác nhận.',409);
    if(!order.designerId)throw fail('Chọn nhân viên thiết kế phụ trách trước.');
    const employee=await tx.get(db.collection('users').doc(String(order.designerId)));
    if(!employee.exists||employee.data().role!=='designer'||!approved(employee.data()))throw fail('Nhân viên thiết kế chưa được cấp quyền hoặc bị khóa.');
    let count=order.designProductCount;
    if(count==null&&payrollAllowed(actor))count=Number(input.count);
    if(!Number.isSafeInteger(count)||count<=0||count>1000000)throw fail('Cần xác nhận số sản phẩm thiết kế (không phải số bản in).');
    if(Number(order.designFee??order.totals?.designFee??0)!==count*40000)throw fail('Phí thiết kế chưa khớp 40.000đ/sản phẩm; điều chỉnh/xác nhận trước khi tính KPI.');
    const completion={orderId,employeeId:order.designerId,employeeName:employee.data().name||employee.data().username,count,fee:count*40000,date,month:date.slice(0,7),confirmedBy:actor.username,confirmedAt:new Date().toISOString()};
    const after={...order,designProductCount:count,designWork:completion,version:Number(order.version||0)+1,updatedAt:completion.confirmedAt,updatedBy:actor.username};
    historyWrite(tx,'orders',orderId,order,after,actor,'design_complete');historyWrite(tx,'designCompletions',orderId,null,completion,actor,'design_complete');
    tx.set(ref,after);tx.set(ledgerRef,completion);return {ok:true,item:after,completion};
  });
}
function calculateSummary(ledger,month,employeeId,rule){
  const entries=ledger.filter(e=>e.month===month&&String(e.employeeId)===String(employeeId));
  const count=entries.reduce((n,e)=>n+Number(e.count||0),0);
  return {...B.designKpi(count,rule),month,employeeId,orderIds:entries.map(e=>e.orderId),entries,capturedAt:new Date().toISOString()};
}
export async function designSummary(month,employeeId,actor){
  if(!payrollAllowed(actor))throw fail('Không có quyền xem KPI lương.',403);
  month=monthValue(month);employeeId=validId(employeeId);
  return db.runTransaction(async tx=>{
    const ledger=readRows(await tx.get(db.collection('designCompletions').where('month','==',month)));
    const policy=await tx.get(db.collection('config').doc('designKpiPolicy'));
    const rule=policy.exists?policy.data().rule:'milestones';
    return calculateSummary(ledger,month,employeeId,rule);
  });
}
export async function setKpiPolicy(rule,actor){
  if(actor.role!=='director')throw fail('Chỉ Giám đốc được chọn cách tính KPI.',403);
  B.designKpi(100,rule);const ref=db.collection('config').doc('designKpiPolicy');
  return db.runTransaction(async tx=>{const snap=await tx.get(ref);const after={rule,updatedAt:new Date().toISOString(),updatedBy:actor.username};historyWrite(tx,'config','designKpiPolicy',snap.exists?snap.data():null,after,actor,'kpi_policy');tx.set(ref,after);return after;});
}
export async function savePayroll(month,employeeId,input,actor){
  if(!payrollAllowed(actor))throw fail('Không có quyền lưu lương.',403);
  month=monthValue(month);employeeId=validId(employeeId);
  const ref=db.collection('settings').doc(PAYROLL);
  return db.runTransaction(async tx=>{
    const payroll=await tx.get(ref),employee=await tx.get(db.collection('users').doc(employeeId));
    if(!employee.exists)throw fail('Không tìm thấy nhân viên.');
    const before=payroll.exists?payroll.data():null,all=structuredClone(before?.value||{}),records=Array.isArray(all[month])?all[month]:[];
    const index=records.findIndex(r=>String(r.employeeId)===employeeId),old=index<0?null:records[index];
    if(Number(input.expectedVersion??0)!==Number(old?.version||0))throw fail('Bảng lương nhân viên vừa thay đổi; không ghi đè bản cũ.',409);
    const user=employee.data(),raw=input.record||{};
    const scalar=['baseSalary','standardDays','workedDays','overtimeHours','kpiPercent','completionAllowance','cleaningAllowance','printingAllowance','constructionAllowance','kpiBonus','baseAdjustValue','advance','otherBonus','otherDeduction','penalty','insuranceBase'];
    const record={...(old||{})};
    for(const key of scalar){const value=Number(raw[key]??0);if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw fail('Giá trị lương không hợp lệ: '+key);record[key]=value;}
    if(record.standardDays<=0)throw fail('Ngày công chuẩn phải lớn hơn 0.');
    for(const key of ['customAllowances','salaryAdjustments']){
      const rows=raw[key]||[];if(!Array.isArray(rows)||rows.length>100)throw fail('Phụ cấp không hợp lệ.');
      record[key]=rows.map(r=>{if(!Number.isFinite(Number(r.amount))||Number(r.amount)<0)throw fail('Số tiền phụ cấp không hợp lệ.');return {name:String(r.name||'').slice(0,250),amount:Number(r.amount),...(key==='salaryAdjustments'?{type:r.type==='minus'?'minus':'plus'}:{})};});
    }
    record.baseAdjustMode=['none','plus_amount','minus_amount','plus_percent','minus_percent'].includes(raw.baseAdjustMode)?raw.baseAdjustMode:'none';
    record.insuranceEnabled=raw.insuranceEnabled!==false;record.note=String(raw.note||'').slice(0,2000);
    record.employeeId=user.id??Number(employeeId);record.employeeName=user.name||user.username;record.username=user.username;record.role=user.role;
    if(user.role==='designer'){
      if(old&&input.refreshDesignKpi!==true){record.designKpi=old.designKpi||null;record.kpiBonus=Number(old.kpiBonus||0);record.kpiPercent=Number(old.kpiPercent||0);}
      else{
        const ledger=readRows(await tx.get(db.collection('designCompletions').where('month','==',month)));
        const policy=await tx.get(db.collection('config').doc('designKpiPolicy'));
        record.designKpi=calculateSummary(ledger,month,employeeId,policy.exists?policy.data().rule:'milestones');
        delete record.designKpi.entries;
      }
      if(record.designKpi){record.kpiBonus=record.designKpi.amount;record.kpiPercent=record.designKpi.percent;}
    }
    record.id=old?.id||`${month}_${employeeId}`;record.month=month;record.version=Number(old?.version||0)+1;
    record.createdAt=old?.createdAt||new Date().toISOString();record.updatedAt=new Date().toISOString();record.updatedBy=actor.username;
    if(index<0)records.push(record);else records[index]=record;all[month]=records;
    const after={...(before||{}),value:all,version:Number(before?.version||0)+1,updatedAt:record.updatedAt,updatedBy:actor.username};
    historyWrite(tx,'settings',PAYROLL,before,after,actor,'payroll_save');tx.set(ref,after);return record;
  });
}
export async function deletePayroll(month,employeeId,expectedVersion,actor){
  if(!payrollAllowed(actor))throw fail('Không có quyền xóa lương.',403);
  month=monthValue(month);employeeId=validId(employeeId);const ref=db.collection('settings').doc(PAYROLL);
  return db.runTransaction(async tx=>{const snap=await tx.get(ref),before=snap.exists?snap.data():null,all=structuredClone(before?.value||{});
    const rows=all[month]||[],target=rows.find(r=>String(r.employeeId)===employeeId);if(!target)return {ok:true};
    if(Number(target.version||0)!==Number(expectedVersion))throw fail('Phiếu lương vừa thay đổi.',409);
    all[month]=rows.filter(r=>String(r.employeeId)!==employeeId);const after={...before,value:all,version:Number(before?.version||0)+1,updatedAt:new Date().toISOString(),updatedBy:actor.username};
    historyWrite(tx,'settings',PAYROLL,before,after,actor,'payroll_delete');tx.set(ref,after);return {ok:true};});
}
