import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const [scannerCore, categoryCore, categoryScanner] = await Promise.all([
  read('../ozon-erp-collector-extension/store-scanner-core.js'),
  read('../ozon-erp-collector-extension/category-core.js'),
  read('../ozon-erp-collector-extension/category-scanner.js'),
]);
const makeEl = ({ text = '', href = '', cls = '', widget = '', children = [], tag = 'DIV', attrs = {} } = {}) => {
  const el = { innerText: text, textContent: text, href, className: cls, tagName: tag, parentElement: null, children, hidden: false,
    getAttribute(name) { return attrs[name] ?? (name === 'data-widget' ? widget : null); },
    getBoundingClientRect() { return { width: 200, height: 100, top: 0, bottom: 100 }; },
    contains(other) { return other === this || this.children.some((child) => child.contains(other)); },
    querySelectorAll(selector) { return this.children.flatMap((c) => [...(selector.includes('a[href') && c.tagName === 'A' ? [c] : []), ...c.querySelectorAll(selector)]); },
    querySelector() { return null; }, closest() { return null; } };
  children.forEach((child) => { child.parentElement = el; }); return el;
};
const card = (sku, name, label = '符合要求', category = '家居') => makeEl({
  text: `${label}\n399.00 ¥\n类目：${category}\nrFBS佣金：10%\nSKU：${sku}\nSKU：${sku}\n月销量：20\n发货模式：FBS\n长宽高：10×10×10\n重量：500g\n跟卖最低价：300`,
  children: [makeEl({ tag: 'A', href: `https://www.ozon.ru/product/${name}-${sku}/`, text: name })],
});
const mainList = makeEl({ widget: 'tileGridDesktop', children: [card('10001', 'valid-item'), card('10002', 'bad-item', '无标签'), card('10003', 'danger-item', '符合要求', '枪支用品'), card('10004', 'wrong-sku') ] });
// The final card deliberately has a SKU/link mismatch.
mainList.children[3].children[0].href = 'https://www.ozon.ru/product/wrong-item-99999/';
const recommendation = makeEl({ widget: 'tileGridDesktop', cls: 'recommendations', children: [card('99901', 'recommended')] });
const context = { URL, location: { href: 'https://www.ozon.ru/category/demo-123/?page=2' }, document: {},
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
context.globalThis = context;
let listener;
context.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } }, sendMessage(_msg, cb) { cb?.({ ok: true }); } } };
for (const src of [scannerCore, categoryCore, categoryScanner]) vm.runInNewContext(src, context);
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList] : [];
context.document.querySelector = () => null;
let ack;
assert.equal(listener({ type: 'categoryScanStart', batchId: 'b', attemptId: 'a', categoryUrl: 'https://www.ozon.ru/category/demo-123/' }, {}, (v) => { ack = v; }), false);
assert.equal(ack?.accepted, true, 'start must be acknowledged immediately');
const reader = context.OzonCategoryScanner.createReader(context.document, context.OzonCategoryCore);
const result = reader.read(context.location.href, {});
assert.deepEqual(Array.from(result.products, (p) => p.sku), ['10001']);
assert.deepEqual(Array.from(result.observedSkus).sort(), ['10001', '10002', '10003']);
assert.equal(result.products[0].link, 'https://www.ozon.ru/product/valid-item-10001/');
assert.equal(context.OzonCategoryCore.paginationUrl(context.location.href, 'https://www.ozon.ru/category/demo-123/'), 'https://www.ozon.ru/category/demo-123/?page=2');
const next = makeEl({ tag: 'A', href: 'https://www.ozon.ru/category/demo-123/?page=3', text: '›', attrs: { 'aria-label': 'Next page' } });
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList] : selector.includes('rel="next"') ? [next] : [];
assert.equal(reader.next(context.location.href), next.href, 'only an explicit same-category next URL is accepted');
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList, makeEl({ widget: 'searchResults' })] : [];
assert.equal(context.OzonCategoryScanner.pickList(context.document), null, 'ambiguous list scope must be rejected');
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [recommendation] : [];
assert.equal(context.OzonCategoryScanner.pickList(context.document), null, 'recommendation list must be rejected');
// Simulate an eligible hidden page whose scheduled timer has not been delivered.
// A task-scoped watchdog event may wake the due wait, without a duplicate run
// or bypassing the normal loading interval.
let fakeNow=1000,timerId=0,backgroundListener;const timers=new Map(),reported=[];
class ClockDate extends Date{static now(){return fakeNow}}
const bg={URL,Date:ClockDate,location:{href:'https://www.ozon.ru/category/demo-123/'},innerHeight:800,scrollY:0,
 document:{hidden:true,documentElement:{scrollHeight:100000},querySelectorAll:s=>s.includes('tileGridDesktop')?[mainList]:[],querySelector:()=>null},
 getComputedStyle:()=>({display:'block',visibility:'visible'}),scrollBy(_x,y){this.scrollY+=y},scrollTo(){},
 setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},
 chrome:{runtime:{onMessage:{addListener(fn){backgroundListener=fn}},sendMessage(msg,cb){reported.push(msg);cb({ok:true,stop:reported.filter(m=>m.type==='categorySample').length>=2})}}}};
bg.globalThis=bg;for(const src of [scannerCore,categoryCore,categoryScanner])vm.runInNewContext(src,bg);
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'hidden-a',categoryUrl:bg.location.href},{},()=>{});
await new Promise(setImmediate);
assert.equal(reported.filter(m=>m.type==='categorySample').length,1);assert.equal(reported[0].pageHidden,true);assert.deepEqual([...timers.values()].map(t=>t.ms),[4000]);
let tick;const wake=(attemptId)=>backgroundListener({type:'categoryScanTick',batchId:'hidden-b',attemptId},{},r=>tick=r);
wake('hidden-a');await new Promise(setImmediate);assert.equal(tick.running,true);assert.equal(reported.length,1,'early tick must preserve the settling interval');
fakeNow+=5000;wake('wrong-attempt');await new Promise(setImmediate);assert.equal(tick.running,false);assert.equal(reported.length,1,'stale attempt cannot wake scanner');
wake('hidden-a');await new Promise(setImmediate);assert.equal(reported.filter(m=>m.type==='categorySample').length,2);assert.equal(timers.size,0);
// Hidden bottom with no explicit end is not completion or a reason to scroll
// repeatedly against an unloaded lazy-list boundary. A real challenge still stops.
reported.length=0;bg.document.documentElement.scrollHeight=600;bg.scrollY=0;let hiddenScrolls=0;bg.scrollBy=()=>{hiddenScrolls++};bg.chrome.runtime.sendMessage=(m,cb)=>{reported.push(m);cb({ok:true})};
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'hidden-end',categoryUrl:bg.location.href},{},()=>{});await new Promise(setImmediate);
for(let i=0;i<10;i++){fakeNow+=12000;wake('hidden-end');await new Promise(setImmediate);}
assert.equal(hiddenScrolls,0);assert.ok(reported.some(m=>m.type==='categoryWait'&&m.reason==='hidden_bottom'));assert.ok(!reported.some(m=>m.type==='categoryPageDone'));
bg.document.title='captcha';fakeNow+=12000;wake('hidden-end');await new Promise(setImmediate);
assert.equal(reported.at(-1).reason,'manual-verification');assert.equal(timers.size,0);
// Repeated readable products while the hidden page scrolls forward are a
// separate scheduler signal from a scroll that cannot move.
reported.length=0;bg.document.title='Ozon';bg.document.documentElement.scrollHeight=100000;bg.scrollY=0;bg.scrollBy=function(_x,y){this.scrollY+=y};
bg.chrome.runtime.sendMessage=(m,cb)=>{reported.push(m);cb({ok:true})};
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'no-new-sku',categoryUrl:bg.location.href},{},()=>{});await new Promise(setImmediate);
for(let i=0;i<10&&!reported.some(m=>m.type==='categoryWait'&&m.reason==='no_new_sku');i++){fakeNow+=5000;wake('no-new-sku');await new Promise(setImmediate);}
assert.ok(reported.some(m=>m.type==='categoryWait'&&m.reason==='no_new_sku'));
assert.ok(!reported.some(m=>m.type==='categoryPageDone'),'repeated observed items must not imply catalog completion');
// Two plausible visible main lists produce an explicit ambiguity wait and
// never get scrolled or treated as a catalog end.
reported.length=0;bg.scrollY=0;let ambiguousScrolls=0;bg.scrollBy=()=>{ambiguousScrolls++};
bg.document.querySelectorAll=s=>s.includes('tileGridDesktop')?[mainList,makeEl({widget:'tileGridDesktop',children:[card('77777','other-list')]})]:[];
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'ambiguous',categoryUrl:bg.location.href},{},()=>{});await new Promise(setImmediate);
assert.ok(reported.some(m=>m.type==='categoryWait'&&m.reason==='list_ambiguous'));
assert.equal(ambiguousScrolls,0);
assert.ok(!reported.some(m=>m.type==='categoryPageDone'),'ambiguity waits before its independent retry bound');
backgroundListener({type:'categoryScanStop',batchId:'hidden-b',attemptId:'ambiguous'},{},()=>{});await new Promise(setImmediate);
reported.length=0;bg.chrome.runtime.sendMessage=(m,cb)=>{reported.push(m);cb(m.type==='categoryWait'?{ok:true,stop:true}:{ok:true})};
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'wait-stop',categoryUrl:bg.location.href},{},()=>{});await new Promise(setImmediate);
assert.ok(reported.some(m=>m.type==='categoryWait'&&m.reason==='list_ambiguous'));
assert.ok(!reported.some(m=>m.type==='categoryPageDone'),'categoryWait stop acknowledgement must terminate without a done event');
assert.equal(timers.size,0);
reported.length=0;bg.chrome.runtime.sendMessage=(m,cb)=>{reported.push(m);cb({ok:true})};
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'ambiguous-bound',categoryUrl:bg.location.href},{},()=>{});await new Promise(setImmediate);
for(let i=0;i<35&&!reported.some(m=>m.type==='categoryPageDone');i++){fakeNow+=12000;wake('ambiguous-bound');await new Promise(setImmediate);}
assert.equal(reported.find(m=>m.type==='categoryPageDone')?.reason,'catalog_list_unavailable','persistent ambiguity must pause after its own bounded retries');
assert.equal(ambiguousScrolls,0);
reported.length=0;
const loginDialog=makeEl();
loginDialog.querySelector=()=>makeEl({text:'登录'});
bg.document.querySelectorAll=selector=>selector.includes('role="dialog"')?[loginDialog]:[mainList];
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'login',categoryUrl:bg.location.href},{},()=>{});
await new Promise(setImmediate);
assert.equal(reported.at(-1).reason,'manual-verification');
assert.equal(reported.at(-1).verificationDetail,'login_required');
console.log('category scanner real-core synthetic DOM tests passed');
