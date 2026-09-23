/* V30 shared calculations and identity rules. No I/O and no data mutation. */
(function(root){
  'use strict';
  const norm = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi-VN');
  const phone = value => {const p=String(value??'').replace(/\D/g,'');return /^84\d{9}$/.test(p)?'0'+p.slice(2):p;};
  const num = value => value === '' || value == null || typeof value === 'boolean' ? NaN : Number(String(value).replace(',','.'));
  const finite = n => Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER;
  const unit = value => ({'cái':'Cái','tấm':'Tấm','tờ':'Tờ','m2':'m²','m²':'m²'})[norm(value)] || '';
  function areaQuote(input){
    const u=unit(input.unit), width=num(input.widthCm), height=num(input.heightCm), copies=num(input.copies??input.qty);
    if(!u)return {ok:false,reason:'Chọn đơn vị Cái, Tấm, Tờ hoặc m².'};
    if(!finite(width)||width<=0||!finite(height)||height<=0)return {ok:false,reason:'Nhập chiều ngang và chiều cao bằng cm, lớn hơn 0.'};
    if(!Number.isSafeInteger(copies)||copies<=0)return {ok:false,reason:'Số lượng bản/tấm phải là số nguyên lớn hơn 0.'};
    const areaPerPiece=width*height/10000;
    const totalArea=areaPerPiece*copies;
    if(!finite(areaPerPiece)||!finite(totalArea)||areaPerPiece<=0||totalArea<=0)return {ok:false,reason:'Diện tích vượt giới hạn tính toán.'};
    const billedQty=u==='m²'?totalArea:copies;
    const entered=num(input.mode==='total'?input.total:input.unitPrice);
    if(!['unit','total'].includes(input.mode)||!finite(entered)||entered<0)return {ok:false,reason:'Vui lòng nhập đơn giá hoặc tổng tiền hợp lệ.'};
    const rawTotal=input.mode==='total'?entered:entered*billedQty;
    if(!finite(rawTotal))return {ok:false,reason:'Thành tiền vượt giới hạn tính toán.'};
    const total=Math.round(rawTotal),unitPrice=input.mode==='total'?total/billedQty:entered;
    return {ok:true,widthCm:width,heightCm:height,copies,areaPerPiece,totalArea,billedQty,qty:billedQty,unit:u,unitPrice,total,mode:input.mode};
  }
  function balance(order){
    const total=Math.max(0,Number(order?.total??order?.totals?.grand??0)||0);
    const rawDeposit=order?.deposit?.amount??order?.totals?.depositAmount??0;
    const deposit=Math.max(0,Math.min(total,Number(rawDeposit)||0));
    const received=order?.paid?total:Math.max(deposit,Math.min(total,Number(order?.receivedAmount??deposit)||0));
    return {total,deposit,received,remaining:Math.max(0,total-received)};
  }
  function designKpi(count, rule='milestones'){
    const n=Number(count);
    if(!Number.isSafeInteger(n)||n<0||n>1000000)throw new Error('Số sản phẩm thiết kế không hợp lệ.');
    if(!['milestones','per-product'].includes(rule))throw new Error('Quy tắc KPI không hợp lệ.');
    const achieved=n>=100;
    const tier=n>=200?200:n>=150?150:n>=100?100:0;
    const amount=!achieved?n*5000:rule==='per-product'?n*10000:tier*10000;
    return {version:30,count:n,rule,tier,achieved,status:achieved?'Đạt KPI':'Không đạt KPI',percent:n,amount,
      piecePay:achieved?0:amount,bonus:achieved?amount:0};
  }
  function customerMatch(a,b,{allowName=false}={}){
    const fields=[['taxCode',norm],['phone',phone],['email',norm],['cccd',norm]];
    let matched=false;
    for(const [key,normalize] of fields){const x=normalize(a?.[key]),y=normalize(b?.[key]);if(x&&y){if(x!==y)return false;matched=true;}}
    if(matched)return true;
    if(!allowName)return false;
    const name=norm(a?.name),other=norm(b?.name);
    if(!name||name!==other||['quý khách hàng','khách vãng lai','khách hàng'].includes(name))return false;
    return norm(a?.company)===norm(b?.company)&&norm(a?.address)===norm(b?.address);
  }
  function resolveCustomer(order,profiles){
    if(!order||order.crmSuppressed)return null;
    const explicit=String(order.customerId??order.customerInfo?.id??'');
    if(explicit){
      const visited=new Set();let p=profiles.find(p=>String(p.id)===explicit);
      while(p?.mergedInto&&!visited.has(String(p.id))){visited.add(String(p.id));p=profiles.find(x=>String(x.id)===String(p.mergedInto));}
      return p&&!p.mergedInto?p:null;
    }
    const ci={...order.customerInfo,name:order.customerInfo?.name||order.customer};
    const available=profiles.filter(p=>!p.mergedInto);
    const strong=available.filter(p=>customerMatch(ci,p));
    if(strong.length===1)return strong[0];
    if(strong.length>1)return null;
    const weak=available.filter(p=>customerMatch(ci,p,{allowName:true}));
    return weak.length===1?weak[0]:null;
  }
  const api=Object.freeze({norm,phone,num,unit,areaQuote,balance,designKpi,customerMatch,resolveCustomer});
  root.HTXBusinessV30=api;
})(globalThis);
