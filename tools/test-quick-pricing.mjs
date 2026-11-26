import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({});
vm.runInContext(fs.readFileSync('web-src/pricing-core.js','utf8')+'\nglobalThis.math=OzonPricingCore;',context);
const source='ozon-erp-collector-extension/quick-pricing-core.js';
assert.ok(fs.existsSync(source),'商品池快速核价共享逻辑尚缺失');
vm.runInContext(fs.readFileSync(source,'utf8'),context);
const {rowsForSku,evaluate,patchRow}=context.OzonQuickPricingCore;
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
Object.assign(context,{document:{createElement:tag=>new Element(tag),addEventListener(){},removeEventListener(){},visibilityState:'visible'},window:{addEventListener(){},removeEventListener(){}},setInterval:()=>0,clearInterval(){},URL,confirm:()=>true});
vm.runInContext(fs.readFileSync('ozon-erp-collector-extension/quick-pricing-panel.js','utf8'),context);
const fixture=new Element(),sample={...original,sku:'6078237717',green:'88.71',black:'92.05',commission:'10',freight:'54.55',cost:'10'};
const panel=context.OzonQuickPricingPanel.create(fixture,{math:context.math,load:async()=>[sample]});
panel.select({sku:sample.sku,title:'还剩8件',link:'https://www.ozon.ru/product/test-6078237717/'});await new Promise(resolve=>setImmediate(resolve));
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
const styles=fs.readFileSync('ozon-erp-collector-extension/quick-pricing-panel.css','utf8');
for(const selector of ['qp-price-label','qp-price-badge','qp-price-detail'])assert.match(styles,new RegExp(`\\.${selector}\\{[^}]*color:#000000(?:;|})`));
assert.match(styles,/\.qp-price-amount\{[^}]*color:#a92323/);
assert.match(styles,/\.qp-panel input\[data-field="green"\]\{[^}]*background:#e4f4e8/);
console.log('Quick pricing: exact SKU and row identity, original formula, target cost, incomplete inputs, conflict-safe patch passed.');
