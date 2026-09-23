import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('../public/quote-math.js');
const math=globalThis.HTXQuoteMath;
test('manual unit input and fractional quantities',()=>{
  assert.equal(math.manual({mode:'unit',qty:4,unitPrice:12500}).total,50000);
  assert.equal(math.manual({mode:'unit',qty:2.5,unitPrice:12345}).total,30863);
  assert.equal(math.manual({mode:'unit',qty:1,unitPrice:0}).total,0);
});
test('manual total is authoritative, not rounded unit price × quantity',()=>{
  const r=math.manual({mode:'total',qty:3,total:100001});
  assert.equal(r.total,100001);assert.equal(r.unitPrice,100001/3);
  const changed=math.manual({mode:'total',qty:6,total:r.total});
  assert.equal(changed.total,100001);assert.equal(changed.unitPrice,100001/6);
});
test('invalid, empty, negative, zero-quantity and oversized inputs rejected',()=>{
  for(const qty of ['',0,-1,NaN,Infinity,'abc'])assert.equal(math.manual({mode:'unit',qty,unitPrice:1000}).ok,false,String(qty));
  for(const unitPrice of ['',null,-1,NaN,Infinity,'abc'])assert.equal(math.manual({mode:'unit',qty:1,unitPrice}).ok,false,String(unitPrice));
  assert.equal(math.manual({mode:'unit',qty:Number.MAX_SAFE_INTEGER,unitPrice:2}).ok,false);
});
test('side-specific prices are explicit and may be zero',()=>{
  const r={price:50000,printSides:'1',sidePrices:{'2':76000}};
  assert.equal(math.sidePrice(r,'1'),50000);assert.equal(math.sidePrice(r,'2'),76000);
  assert.equal(math.sidePrice({...r,sidePrices:{'2':0}},'2'),0);
});
test('missing side price is not doubled, halved or inferred',()=>{
  const r={price:50000,printSides:'1',sidePrices:{}};
  assert.equal(math.sidePrice(r,'2'),null);
  assert.equal(math.sidePrice({...r,printSides:''},'1'),null);
  assert.equal(math.sidePrice({...r,printSides:''},''),50000);
});
test('specific override wins over classified base, invalid overrides rejected',()=>{
  assert.equal(math.sidePrice({price:50000,printSides:'1',sidePrices:{'1':40000}},'1'),40000);
  for(const value of [-1,'',null,'bad'])assert.equal(math.sidePrice({price:5,printSides:'1',sidePrices:{'1':value}},'1'),null);
});
