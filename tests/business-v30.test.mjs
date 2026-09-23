import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/business-v30.js';
const B=globalThis.HTXBusinessV30;
test('cm to m² and explicit billing quantities',()=>{
 const input={unit:'m²',widthCm:100,heightCm:100,copies:1,mode:'unit',unitPrice:100000};
 const a=B.areaQuote(input);assert.equal(a.total,100000);assert.equal(a.qty,1);
 const b=B.areaQuote({...input,widthCm:60,heightCm:90,copies:3});assert.equal(b.total,162000);assert.equal(b.qty,1.62);
 for(const unit of ['Cái','Tấm','Tờ'])assert.equal(B.areaQuote({...input,widthCm:60,heightCm:90,copies:3,unit}).total,300000);
 const c=B.areaQuote({...input,widthCm:60,heightCm:90,copies:3,mode:'total',total:100001});assert.equal(c.total,100001);assert.equal(c.unitPrice,100001/1.62);
 for(const extra of [{widthCm:0},{heightCm:''},{copies:0},{copies:1.5},{copies:-1},{unit:'Bộ'},{unitPrice:-5},{mode:'bad'},{widthCm:'bad'},{total:NaN,mode:'total'}])assert.equal(B.areaQuote({...input,...extra}).ok,false);
});
test('remaining receivable includes deposit once and respects settled orders',()=>{
 assert.equal(B.balance({total:100000,deposit:{amount:30000}}).remaining,70000);
 assert.equal(B.balance({total:100000,deposit:{amount:30000},paid:true}).remaining,0);
 assert.equal(B.balance({total:100000,deposit:{amount:30000},receivedAmount:60000}).remaining,40000);
 assert.equal(B.balance({total:100000,deposit:{amount:200000}}).remaining,0);
});
test('design KPI is one payout, not a stacked bonus',()=>{
 const expected=[[0,0],[60,300000],[99,495000],[100,1000000],[149,1000000],[150,1500000],[199,1500000],[200,2000000]];
 for(const [n,amount]of expected){const r=B.designKpi(n);assert.equal(r.amount,amount);assert.equal(r.achieved,n>=100);assert.equal(r.piecePay+r.bonus,amount);}
 assert.equal(B.designKpi(125,'per-product').amount,1250000);assert.equal(B.designKpi(220,'per-product').amount,2200000);
 assert.throws(()=>B.designKpi(-1));assert.throws(()=>B.designKpi(1.2));
});
test('customer identity is stable and ambiguous name matches are not merged',()=>{
 const profiles=[{id:1,name:'A',phone:'0912000000'},{id:2,name:'A',phone:'0912111111'}];
 assert.equal(B.resolveCustomer({customer:'A',customerInfo:{name:'A',phone:'+84 912 000 000'}},profiles).id,1);
 assert.equal(B.resolveCustomer({customerId:2,customerInfo:{name:'A',phone:'0912000000'}},profiles).id,2);
 assert.equal(B.resolveCustomer({customer:'A'},profiles),null);
 assert.equal(B.customerMatch(profiles[0],profiles[1],{allowName:true}),false);
});
