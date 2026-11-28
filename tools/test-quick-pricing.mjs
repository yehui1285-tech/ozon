import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({});
vm.runInContext(fs.readFileSync('web-src/pricing-core.js','utf8')+'\nglobalThis.math=OzonPricingCore;',context);
const source='ozon-erp-collector-extension/quick-pricing-core.js';
assert.ok(fs.existsSync(source),'商品池快速核价共享逻辑尚缺失');
vm.runInContext(fs.readFileSync(source,'utf8'),context);
const {rowsForSku,evaluate,patchRow,createRow,prefillFromPoolItem,buildTaskPricingPayload}=context.OzonQuickPricingCore;
const original={id:'id-a',sku:'0012',green:'100',black:'120',commission:'10',freight:'20',cost:'50',factorOverride:'',quoteOverride:'',link:'https://www.ozon.ru/product/item-0012/',source:'',note:''};
const rows=[original,{...original,id:'id-b',sku:'12'},{...original,id:'id-c',sku:'0012'}];
assert.equal(JSON.stringify(rowsForSku(rows,'0012').map(r=>r.id)),JSON.stringify(['id-a','id-c']));
assert.equal(rowsForSku(rows,'').length,0);
const value=evaluate(original,context.math);
assert.equal(value.complete,true);assert.equal(value.meetsTarget,true);
assert.ok(Math.abs(value.result.profit-63.8088)<1e-7);
assert.ok(Math.abs(value.result.margin-0.9115542857142857)<1e-7);
assert.equal(value.maxCost,93.39);
const incomplete=evaluate({...original,cost:''},context.math);
assert.equal(incomplete.complete,false);assert.equal(incomplete.result,null);assert.equal(incomplete.maxCost,93.39);
// Pricing must be available independently from freight, commission and procurement cost.
const priceOnly=evaluate({...original,green:'111.52',black:'117.38',commission:'',freight:'',cost:''},context.math);
assert.equal(priceOnly.result,null);
assert.equal(priceOnly.price.quote.toFixed(2),'126.36');
assert.equal(priceOnly.price.trueSale.toFixed(2),'130.27');
assert.equal(priceOnly.price.relation,'below');
assert.equal(evaluate({...original,quoteOverride:'164'},context.math).price.relation,'equal');
assert.equal(evaluate({...original,quoteOverride:'165'},context.math).price.relation,'above');
assert.equal(evaluate({...original,factorOverride:'0.90'},context.math).price.quote.toFixed(2),'147.60');
assert.equal(evaluate({...original,green:''},context.math).price,null);
assert.equal(evaluate({...original,quoteOverride:'invalid'},context.math).price,null);
assert.equal(evaluate({...original,freight:''},context.math).maxCost,null);
assert.equal(evaluate({...original,commission:'120'},context.math).complete,false);
assert.equal(evaluate({...original,cost:'not a price'},context.math).complete,false);
assert.equal(evaluate({...original,cost:'1.2.3'},context.math).complete,false);
assert.equal(evaluate({...original,commission:'1,2,3'},context.math).complete,false);
assert.equal(evaluate({...original,cost:'0'},context.math).complete,true);
assert.equal(evaluate({...original,quoteOverride:'20'},context.math).meetsTarget,false);
assert.equal(evaluate({...original,quoteOverride:'20'},context.math).maxCost,0);
const changed=patchRow(rows,{sku:'0012',id:'id-a',base:original,patch:{cost:'58',source:'货源'}});
assert.equal(changed[0].cost,'58');assert.equal(changed[0].source,'货源');assert.equal(changed[1],rows[1]);assert.equal(changed[2],rows[2]);assert.equal(rows[0].cost,'50');
assert.throws(()=>patchRow(rows,{sku:'12',id:'id-a',base:original,patch:{cost:'58'}}),/SKU/);
assert.throws(()=>patchRow(rows,{sku:'0012',id:'id-a',base:{...original,cost:'49'},patch:{cost:'58'}}),/冲突|变化/);
assert.throws(()=>patchRow(rows,{sku:'0012',id:'id-a',base:original,patch:{sku:'12'}}),/字段/);
assert.throws(()=>patchRow(rows,{sku:'0012',id:'id-a',base:{},patch:{cost:'58'}}),/冲突|变化/);
const navigate=context.OzonQuickPricingCore.selectBeforeOpen;
let selected=0,prevented=0;
assert.equal(navigate({button:0,preventDefault:()=>prevented++},()=>{selected++;return true}),true);
assert.equal(selected,1);assert.equal(prevented,0);
assert.equal(navigate({button:1,preventDefault:()=>prevented++},()=>false),false);
assert.equal(prevented,1);
assert.equal(navigate({button:2,preventDefault:()=>prevented++},()=>{selected++;return true}),true);
assert.equal(selected,1,'right click must not select a different SKU');
// Render the real panel into a small DOM fixture and exercise the displayed pricing and margin states.
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.value='';this.textContent='';this.className='';this.events={};this.classList={add:()=>{},toggle:()=>{}};}
  set innerHTML(html){this.children=[];for(const match of html.matchAll(/data-qp="([^"]+)"/g)){const el=new Element();el.dataset.qp=match[1];this.append(el)}const fields=new Element();fields.className='qp-fields';this.append(fields)}
  append(...els){this.children.push(...els)}replaceChildren(...els){this.children=els}setAttribute(){}removeAttribute(){}addEventListener(name,fn){this.events[name]=fn}
  querySelector(selector){const qp=selector.match(/^\[data-qp="([^"]+)"\]$/)?.[1],field=selector.match(/^\[data-field="([^"]+)"\]$/)?.[1];for(const c of this.children){if(qp&&c.dataset.qp===qp||field&&c.dataset.field===field||selector==='.'+c.className)return c;const found=c.querySelector(selector);if(found)return found}return null}
  text(){return this.textContent+' '+this.children.map(c=>c.text()).join(' ')}
}
const docListeners={},winListeners={};
let nextTimerId=1;const activeTimers=[];
Object.assign(context,{
  document:{createElement:tag=>new Element(tag),addEventListener(type,fn){(docListeners[type] ||= []).push(fn)},removeEventListener(type,fn){docListeners[type]=(docListeners[type]||[]).filter(f=>f!==fn)},visibilityState:'visible'},
  window:{addEventListener(type,fn){(winListeners[type] ||= []).push(fn)},removeEventListener(type,fn){winListeners[type]=(winListeners[type]||[]).filter(f=>f!==fn)}},
  setInterval:()=>0,clearInterval(){},
  setTimeout:(fn,delay)=>{const entry={id:nextTimerId++,fn,delay};activeTimers.push(entry);return entry.id},
  clearTimeout:(id)=>{const idx=activeTimers.findIndex(x=>x.id===id);if(idx>=0)activeTimers.splice(idx,1)},
  URL,confirm:()=>true
});
vm.runInContext(fs.readFileSync('ozon-erp-collector-extension/quick-pricing-panel.js','utf8'),context);
const fixture=new Element(),sample={...original,sku:'6078237717',green:'88.71',black:'92.05',commission:'10',freight:'54.55',cost:'10'};
let loadedRows=[sample],loadCalls=[];
const panel=context.OzonQuickPricingPanel.create(fixture,{math:context.math,load:async sku=>{loadCalls.push(sku);return loadedRows}});
panel.select({sku:sample.sku,title:'还剩8件',link:'https://www.ozon.ru/product/test-6078237717/'});await new Promise(resolve=>setImmediate(resolve));
assert.equal(activeTimers.at(-1)?.delay,15000,'loaded pricing must poll at 15s');
const margin=fixture.querySelector('[data-qp="margin"]'),resultBox=fixture.querySelector('[data-qp="result"]');
assert.ok(margin,'利润率必须具有独立卡片');
assert.match(margin.text(),/23\.81%/);assert.match(margin.text(),/达标/);assert.equal(margin.dataset.tone,'pass');
assert.doesNotMatch(resultBox.text(),/利润率/);assert.match(resultBox.text(),/利润 ¥15\.37/);
const costInput=fixture.querySelector('[data-field="cost"]');costInput.value='80';costInput.events.input();assert.equal(margin.dataset.tone,'under');assert.match(margin.text(),/未达标/);
assert.ok(fixture.querySelector('[data-field="source"]'),'必须保留货源链接 / 备注字段');
assert.equal(fixture.querySelector('[data-field="note"]'),null,'已精简掉独立核价备注输入框');
assert.match(fixture.text(),/货源链接 \/ 备注/);
assert.doesNotMatch(fixture.text(),/核价备注/);
costInput.value='';costInput.events.input();assert.equal(margin.dataset.tone,'pending');assert.match(margin.text(),/待计算/);panel.dispose();

// Test focus dedup, 2s unpriced polling, and background ozon-pricing-pushed signal.
let deferredLoad=null,pushLoads=0;
const pushPanel=context.OzonQuickPricingPanel.create(new Element(),{
  math:context.math,
  load:async sku=>{pushLoads++;return new Promise(resolve=>{deferredLoad=()=>resolve(sku==='999001'?[{...sample,sku:'999001'}]:[])})}
});
pushPanel.select({sku:'999002',title:'等待核价',link:'https://www.ozon.ru/product/test-999002/'});
assert.equal(pushLoads,1);deferredLoad();await new Promise(resolve=>setImmediate(resolve));
assert.equal(activeTimers.at(-1)?.delay,2000,'unpriced waiting state must poll every 2s');
loadCalls.length=0;pushLoads=0;
for(const fn of (docListeners.visibilitychange||[]))fn();
for(const fn of (winListeners.focus||[]))fn();
assert.equal(pushLoads,1,'back-to-back visibilitychange + focus must deduplicate while in-flight');
deferredLoad();await new Promise(resolve=>setImmediate(resolve));
pushLoads=0;context.document.visibilityState='hidden';
for(const fn of (winListeners['ozon-pricing-pushed']||[]))fn({detail:{sku:'other'}});
assert.equal(pushLoads,0,'non-matching SKU push event must not trigger refresh');
pushPanel.select({sku:'999001',title:'后台推送',link:'https://www.ozon.ru/product/test-999001/'});
await new Promise(resolve=>setImmediate(resolve));if(deferredLoad)deferredLoad();await new Promise(resolve=>setImmediate(resolve));
pushLoads=0;context.document.visibilityState='hidden';
for(const fn of (winListeners['ozon-pricing-pushed']||[]))fn({detail:{sku:'999001'}});
assert.equal(pushLoads,1,'matching ozon-pricing-pushed must refresh immediately even when tab is hidden');
deferredLoad();await new Promise(resolve=>setImmediate(resolve));
pushPanel.dispose();
assert.equal(activeTimers.length,0,'dispose must clear pending poll timer');
const styles=fs.readFileSync('ozon-erp-collector-extension/quick-pricing-panel.css','utf8');
for(const selector of ['qp-price-label','qp-price-badge','qp-price-detail'])assert.match(styles,new RegExp(`\\.${selector}\\{[^}]*color:#000000(?:;|})`));
assert.match(styles,/\.qp-price-amount\{[^}]*color:#a92323/);
assert.match(styles,/\.qp-panel input\[data-field="green"\]\{[^}]*background:#e4f4e8/);

// Verify highResImageUrl image upgrade helper.
vm.runInContext(fs.readFileSync('ozon-erp-collector-extension/store-scanner-core.js','utf8'),context);
vm.runInContext(fs.readFileSync('ozon-erp-collector-extension/product-pool-core.js','utf8'),context);
vm.runInContext(fs.readFileSync('ozon-erp-collector-extension/task-pricing-core.js','utf8'),context);
const poolCore=context.OzonProductPoolCore;
assert.equal(poolCore.highResImageUrl('https://ir.ozone.ru/s3/multimedia-1-a/wc250/699123.jpg'),'https://ir.ozone.ru/s3/multimedia-1-a/wc1000/699123.jpg');
assert.equal(poolCore.highResImageUrl('https://cdn1.ozone.ru/s3/multimedia-a/c500/123.jpg'),'https://cdn1.ozone.ru/s3/multimedia-a/wc1000/123.jpg');
assert.equal(poolCore.highResImageUrl('https://ir.ozone.ru/s3/multimedia-a/123.jpg'),'https://ir.ozone.ru/s3/multimedia-a/123.jpg');
assert.equal(poolCore.highResImageUrl('https://evil.example/wc250/123.jpg'),'');

// Verify prefillFromPoolItem with CNY competitor, CNY page-only, and RUB currency block.
const dollItem={
  sku:'5418079062',title:'娃娃',link:'https://www.ozon.ru/product/doll-5418079062/',
  price:'119,74',commissions:'12% / 14% / 17.5%',dimensions:'300 x 150 x 50mm',weight:'250g',competitor:'¥94.10'
};
const dollPrefill=prefillFromPoolItem(dollItem,context.OzonTaskPricingCore);
assert.equal(dollPrefill.available,true);
assert.equal(dollPrefill.currencyBlocked,false);
assert.equal(dollPrefill.source,'competitor');
assert.equal(dollPrefill.green,'94.10');
assert.equal(dollPrefill.commission,'14');
assert.equal(dollPrefill.freight,'10.43');
assert.equal(dollPrefill.freightRoute,'CEL Economy Extra Small');
assert.equal(dollPrefill.floorMaxCost,50.45);

const rubPrefill=prefillFromPoolItem({...dollItem,price:'1 990 ₽',competitor:''},context.OzonTaskPricingCore);
assert.equal(rubPrefill.available,false);
assert.equal(rubPrefill.currencyBlocked,true);
assert.equal(rubPrefill.green,'');

// Verify createRow & buildTaskPricingPayload.
const taskPayload=buildTaskPricingPayload(dollItem,context.OzonTaskPricingCore);
assert.equal(taskPayload.qualification.source,'batch_store_scan');
assert.equal(taskPayload.ozon.sku,'5418079062');
assert.equal(taskPayload.ozon.batchScanSnapshot.weightG,250);
assert.equal(taskPayload.fastMode,true);
assert.equal(taskPayload.poolFastLane,false,'competitor item must not bypass competitor popup');
const pageOnlyPayload=buildTaskPricingPayload({...dollItem,competitor:''},context.OzonTaskPricingCore);
assert.equal(pageOnlyPayload.fastMode,true);
assert.equal(pageOnlyPayload.poolFastLane,true,'page-only pool item with complete specs uses fast lane');
const created=createRow([],{sku:'5418079062',link:dollItem.link,values:{green:'94.10',black:'118.00',commission:'14',freight:'10.43',cost:'40',factorOverride:'',quoteOverride:'',source:'1688'}},2);
assert.equal(created.rows.length,1);
assert.equal(created.row.sku,'5418079062');
assert.equal(created.row.black,'118.00');
assert.throws(()=>createRow(created.rows,{sku:'5418079062',id:created.row.id,values:{green:'94.10',black:'118.00'}}),/已存在|无效/);
assert.throws(()=>createRow([created.row,created.row],{sku:'5418079062',values:{green:'94.10',black:'118.00'}},2),/上限/);
assert.throws(()=>createRow([],{sku:'5418079062',values:{green:'94.10',black:''}}),/黑标价格/);

// Verify draft prefill + test black-price fetch + create flow inside QuickPricingPanel.
let currentRows=[];
let createCalls=[];
const draftFixture=new Element();
const draftPanel=context.OzonQuickPricingPanel.create(draftFixture,{
  math:context.math,
  taskPricing:context.OzonTaskPricingCore,
  normalizeImageUrl:poolCore.normalizeImageUrl,
  load:async sku=>rowsForSku(currentRows,sku),
  create:async req=>{createCalls.push(req);const res=createRow(currentRows,{sku:req.sku,link:req.link,values:req.values});currentRows=res.rows;return res.row},
  fetchBlackPrice:async item=>({
    ok:true,sku:item.sku,blackPriceSource:'competitor',sourceProductUrl:'https://www.ozon.ru/product/comp-999/',
    effectiveGreenPrice:94.10,selectedCommission:14,internationalFreight:10.43,freightRoute:'CEL Economy Extra Small',originalBlackPrice:118.00
  }),
  save:async()=>{throw Error('should use create on draft')},
  status:async()=>{},advance:()=>{}
});
draftPanel.select({...dollItem,imageUrl:'https://ir.ozone.ru/s3/multimedia-1-a/wc250/699123.jpg'});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(draftFixture.querySelector('[data-field="green"]').value,'94.10');
assert.equal(draftFixture.querySelector('[data-field="commission"]').value,'14');
assert.equal(draftFixture.querySelector('[data-field="freight"]').value,'10.43');
assert.equal(draftFixture.querySelector('[data-field="black"]').value,'');
assert.equal(draftFixture.querySelector('[data-qp="approve"]').disabled,true,'approve stays disabled without black and cost');
assert.match(draftFixture.querySelector('[data-qp="result"]').text(),/保底参考.*50\.45/);
await draftFixture.querySelector('[data-qp="fetchBlack"]').events.click();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(draftFixture.querySelector('[data-field="black"]').value,'118.00');
draftFixture.querySelector('[data-field="cost"]').value='45';
draftFixture.querySelector('[data-field="cost"]').events.input();
assert.equal(draftFixture.querySelector('[data-qp="save"]').disabled,false);
await draftFixture.querySelector('[data-qp="save"]').events.click();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(createCalls.length,1);
assert.equal(currentRows.length,1);
assert.equal(currentRows[0].black,'118.00');
draftPanel.dispose();
console.log('Quick pricing: exact SKU and row identity, original formula, target cost, incomplete inputs, conflict-safe patch, prefill, black-price fetch and create passed.');
