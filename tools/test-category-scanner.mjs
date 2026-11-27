import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const [scannerCore, categoryCore, categoryScanner] = await Promise.all([
  read('../ozon-erp-collector-extension/store-scanner-core.js'),
  read('../ozon-erp-collector-extension/category-core.js'),
  read('../ozon-erp-collector-extension/category-scanner.js'),
]);
const makeEl = ({ text = '', href = '', cls = '', widget = '', children = [], tag = 'DIV', attrs = {}, src = '', naturalWidth = 0, naturalHeight = 0 } = {}) => {
  const el = { innerText: text, textContent: text, href, className: cls, tagName: tag, parentElement: null, children, hidden: false, currentSrc: src, naturalWidth, naturalHeight, width: naturalWidth, height: naturalHeight,
    getAttribute(name) { return attrs[name] ?? (name === 'data-widget' ? widget : name === 'src' ? src : null); },
    getBoundingClientRect() { return { width: 200, height: 100, top: 0, bottom: 100 }; },
    contains(other) { return other === this || this.children.some((child) => child.contains(other)); },
    querySelectorAll(selector) { return this.children.flatMap((c) => [...((selector.includes('a[href') && c.tagName === 'A') || (selector === 'img' && c.tagName === 'IMG') ? [c] : []), ...c.querySelectorAll(selector)]); },
    querySelector() { return null; }, closest(sel) { if (sel?.includes('a[href') && this.parentElement?.tagName === 'A') return this.parentElement; return null; } };
  children.forEach((child) => { child.parentElement = el; }); return el;
};
const card = (sku, name, label = '符合要求', category = '家居') => makeEl({
  text: `${label}\n399.00 ¥\n类目：${category}\nrFBS佣金：10%\nSKU：${sku}\nSKU：${sku}\n月销量：20\n发货模式：FBS\n长宽高：10×10×10\n重量：500g\n跟卖最低价：300`,
  children: [makeEl({ tag: 'A', href: `https://www.ozon.ru/product/${name}-${sku}/`, text: name, children: sku === '10001' ? [makeEl({ tag: 'IMG', src: 'https://ir.ozone.ru/s3/m/wc250/10001.jpg', naturalWidth: 250, naturalHeight: 250 })] : [] }), makeEl({ text: label })],
});
const incomplete = card('10005', 'incomplete-item');
incomplete.innerText = incomplete.textContent = incomplete.innerText.replace(/\n跟卖最低价：300/, '');
const screenshotCard = (sku, name, tag = '选品标签： 符合要求', extra = '') => makeEl({
  text: `${tag}\n648,71 ¥\n毛子ERP\nrFBS佣金 12% 14.5% 14.5%\n月销量 24\n发货模式 FBO,FBS\n长 宽 高 250 x 180 x 100mm\n重 量 650g\n跟卖列表 33个卖家${extra}`,
  children: [makeEl({ tag: 'A', href: `https://www.ozon.ru/product/${name}-${sku}/`, text: name }), makeEl({ text: `毛子ERP\n${tag}`, children: [makeEl({ text: tag })] })],
});
const screenshotPositive = screenshotCard('20001', 'screenshot-positive');
const screenshotNegative = screenshotCard('20002', 'screenshot-negative', '选品标签： 不符合要求');
const pendingPanel = makeEl({ text: '毛子ERP\n选品标签： 符合要求\nrFBS佣金 12%\n月销量 24\n发货模式： 加载中', children: [makeEl({ tag: 'A', href: 'https://www.ozon.ru/product/pending-panel-20003/', text: 'pending-panel' }), makeEl({ text: '毛子ERP\n选品标签： 符合要求', children: [makeEl({ text: '选品标签： 符合要求' })] })] });
const missingRequired = makeEl({ text: '毛子ERP\n选品标签： 符合要求\n月销量：24\n发货模式：FBO\n长 宽 高：250 x 180 x 100mm\n重 量：650g', children: [makeEl({ tag: 'A', href: 'https://www.ozon.ru/product/missing-required-20005/', text: 'missing-required' }), makeEl({ text: '毛子ERP\n选品标签： 符合要求', children: [makeEl({ text: '选品标签： 符合要求' })] })] });
const staleSkuCard = makeEl({ text: '毛子ERP\n选品标签： 符合要求\nrFBS佣金 12%\nSKU：29999\n月销量 24\n发货模式 FBO', children: [makeEl({ tag: 'A', href: 'https://www.ozon.ru/product/stale-sku-20004/', text: 'stale-sku' })] });
const mainList = makeEl({ widget: 'tileGridDesktop', children: [card('10001', 'valid-item'), card('10002', 'bad-item', '无标签'), card('10003', 'danger-item', '符合要求', '枪支用品'), card('10004', 'wrong-sku'), incomplete, screenshotPositive, screenshotNegative, pendingPanel, staleSkuCard, missingRequired ] });
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
assert.deepEqual(Array.from(result.products, (p) => p.sku).sort(), ['10001', '10005', '20001']);
assert.equal(result.products.find(p => p.sku === '10001')?.imageUrl, 'https://ir.ozone.ru/s3/m/wc250/10001.jpg');
assert.equal(result.products.find(p => p.sku === '20001')?.imageUrl, '');
assert.deepEqual(Array.from(result.observedSkus).sort(), ['10001', '10002', '10003', '10005', '20001', '20002']);
assert.deepEqual(Array.from(result.discoverSkus).sort(), ['10001', '10002', '10003', '10005', '20001', '20002', '20003', '20004', '20005', '99999']);
assert.deepEqual(Array.from(result.erpReadySkus).sort(), ['10001', '10002', '10003', '10005', '20001', '20002', '20005']);
assert.deepEqual(Array.from(result.labelHitSkus).sort(), ['10001', '10003', '10005', '20001', '20003', '20005']);
assert.equal(result.skuDecisions['10001'], 'eligible');
assert.equal(result.skuDecisions['10002'], 'no_label');
assert.equal(result.skuDecisions['10003'], 'transport_blocked');
assert.equal(result.skuDecisions['20003'], 'erp_pending');
assert.equal(result.skuDecisions['20005'], 'data_pending');
assert.equal(reader.read(context.location.href, { minPrice: 500 }).skuDecisions['10001'], 'price_outside');
assert.equal(result.products.find((p) => p.sku === '20001')?.competitor, '', 'missing competitor price remains blank');
assert.equal(result.products.find((p) => p.sku === '20001')?.competitorReady, false, 'missing competitor price is not marked ready');
assert.ok(result.pendingSkus.includes('20003'), 'incomplete ERP panel remains pending');
assert.ok(result.pendingSkus.includes('20004'), 'panel with conflicting stale SKU is rejected');
assert.ok(result.pendingSkus.includes('20005'), 'ERP panel missing required commission stays pending');
assert.ok(!result.observedSkus.includes('20005'), 'incomplete required fields do not count as observed');
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
assert.equal(reported.filter(m=>m.type==='categorySample').length,1);assert.equal(reported[0].pageHidden,true);assert.equal(reported[0].pageReportedHidden,true);assert.ok(reported[0].skuDecisions&&typeof reported[0].skuDecisions==='object');assert.deepEqual([...timers.values()].map(t=>t.ms),[4000]);
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
// Real Ozon filter labels and controls in the same price group; currency is
// explicit, never inferred from a product or a different sidebar field.
const lo=makeEl({tag:'INPUT'}),hi=makeEl({tag:'INPUT'}),radio=makeEl({tag:'INPUT'});
lo.value='500';hi.value='2\u202f500';
const priceGroup=makeEl({text:'价格\n到250 ₽\n500–2 500 ₽\n不重要',children:[lo,hi,radio]});
priceGroup.querySelectorAll=selector=>selector.includes('input[type="radio"]')?[radio]:selector.includes('input[type="text"]')?[lo,hi]:[];
const priceDocument={querySelectorAll:selector=>selector.includes('input[type="text"]')?[lo,hi]:[]};
const range={pageMinRub:500,pageMaxRub:2500};
assert.equal(context.OzonCategoryScanner.confirmRubPrice(priceDocument,range),true);
hi.value='3 000';assert.equal(context.OzonCategoryScanner.confirmRubPrice(priceDocument,range),false);
hi.value='2500';priceGroup.innerText='价格\n500–2500 ¥';assert.equal(context.OzonCategoryScanner.confirmRubPrice(priceDocument,range),false);
priceGroup.innerText='Цена\n500–2 500 ₽';assert.equal(context.OzonCategoryScanner.confirmRubPrice(priceDocument,range),true);
reported.length=0;bg.location.href='https://www.ozon.ru/category/demo-123/?currency_price=500.000%3B2500.000';
bg.document.querySelectorAll=s=>s.includes('tileGridDesktop')?[mainList]:[];
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'price-unconfirmed',categoryUrl:bg.location.href,options:range},{},()=>{});
await new Promise(setImmediate);assert.equal(reported[0].reason,'price_filter_loading');assert.ok(!reported.some(m=>m.type==='categorySample'));
for(let i=0;i<35&&!reported.some(m=>m.type==='categoryPageDone');i++){fakeNow+=12000;wake('price-unconfirmed');await new Promise(setImmediate)}
assert.equal(reported.at(-1).reason,'price_filter_unconfirmed');assert.ok(!reported.some(m=>m.type==='categorySample'));
reported.length=0;
bg.document.querySelectorAll=s=>s.includes('input[type="text"]')?[lo,hi]:s.includes('tileGridDesktop')?[mainList]:[];
bg.chrome.runtime.sendMessage=(m,cb)=>{reported.push(m);cb({ok:true,stop:m.type==='categorySample'})};
backgroundListener({type:'categoryScanStart',batchId:'hidden-b',attemptId:'price-confirmed',categoryUrl:bg.location.href,options:range},{},()=>{});
await new Promise(setImmediate);assert.equal(reported[0].type,'categorySample');assert.equal(reported[0].pagePriceConfirmed,true);

// V1.60: skipSkus skips already-observed cards, delta reporting avoids duplicate payloads,
// and long pages proactively paginate once scrolls reach PROACTIVE_NEXT_PAGE_SCROLLS.
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList] : [];
const skippedResult = reader.read(context.location.href, {}, undefined, new Set(['10001', '10002']));
assert.equal(skippedResult.available, true, 'skipped page still marks catalog available');
assert.ok(!skippedResult.products.some(p => p.sku === '10001'), 'skipped observed SKU must not be re-parsed into products');
assert.ok(skippedResult.observedSkus.includes('10001') && skippedResult.observedSkus.includes('10002'), 'skipped SKUs stay observed');
assert.deepEqual(Array.from(skippedResult.products, p => p.sku).sort(), ['10005', '20001'], 'unskipped cards still parse normally');

reported.length = 0;
const cleanList = makeEl({ widget: 'tileGridDesktop', children: [card('30001', 'clean-a'), card('30002', 'clean-b')] });
const nextPage2 = makeEl({ tag: 'A', href: 'https://www.ozon.ru/category/demo-123/?page=2', text: '›', attrs: { 'aria-label': 'Next page' } });
bg.location.href = 'https://www.ozon.ru/category/demo-123/';
bg.document.hidden = false;
bg.document.documentElement.scrollHeight = 200000;
bg.scrollY = 0;
bg.scrollBy = function (_x, y) { this.scrollY += y; };
bg.document.querySelectorAll = (s) => s.includes('tileGridDesktop') ? [cleanList] : s.includes('rel="next"') ? [nextPage2] : [];
bg.chrome.runtime.sendMessage = (m, cb) => { reported.push(m); cb({ ok: true }); };
backgroundListener({ type: 'categoryScanStart', batchId: 'hidden-b', attemptId: 'delta-a', categoryUrl: bg.location.href }, {}, () => {});
await new Promise(setImmediate);
const firstSample = reported.find(m => m.type === 'categorySample');
assert.equal(firstSample.compactAck, true, 'scanner requests compact ack to avoid megabyte batch clones');
assert.deepEqual(Array.from(firstSample.observedSkus).sort(), ['30001', '30002']);
assert.equal(firstSample.skuDecisions['30001'], 'eligible');
fakeNow += 2000;
wake('delta-a');
await new Promise(setImmediate);
const samplesAfterTick2 = reported.filter(m => m.type === 'categorySample');
assert.equal(samplesAfterTick2.length, 2);
assert.deepEqual(Array.from(samplesAfterTick2[1].observedSkus), [], 'second tick must send delta-only observedSkus');
assert.deepEqual(Array.from(samplesAfterTick2[1].discoverSkus), [], 'second tick must send delta-only discoverSkus');
assert.deepEqual({ ...samplesAfterTick2[1].skuDecisions }, {}, 'second tick must send delta-only skuDecisions');
for (let i = 0; i < context.OzonCategoryScanner.PROACTIVE_NEXT_PAGE_SCROLLS + 5 && !reported.some(m => m.type === 'categoryPageDone'); i++) {
  fakeNow += 2000;
  wake('delta-a');
  await new Promise(setImmediate);
}
const proactiveDone = reported.find(m => m.type === 'categoryPageDone');
assert.equal(proactiveDone?.reason, 'next_page_available', 'proactive pagination triggers before exhausting 400 scrolls');
assert.equal(proactiveDone?.nextUrl, nextPage2.href);

// V1.62: Sidebar price filter with blank radio presets confirms via main RUB cards
// (ignoring competitor lines inside 毛子ERP), and RUB cards scan into products cleanly.
const loBlank = makeEl({ tag: 'INPUT' }), hiBlank = makeEl({ tag: 'INPUT' }), blankRadio = makeEl({ tag: 'INPUT' });
loBlank.value = '1 300'; hiBlank.value = '30 000';
const blankPriceGroup = makeEl({ text: '价格 ⓘ', children: [loBlank, hiBlank, blankRadio] });
blankPriceGroup.querySelectorAll = s => s.includes('input[type="radio"]') ? [blankRadio] : s.includes('input[type="text"]') ? [loBlank, hiBlank] : [];
const rubCard = makeEl({
  text: '1 480 ₽ 7 492 ₽ -80%\n毛子ERP\n选品标签： 符合要求\nrFBS佣金：10% 10% 10%\nSKU：1979786266\n月销量：258\n发货模式：FBO,FBS\n长 宽 高：600 x 350 x 200mm\n重 量：1985g\n跟卖最低价：₽1508.00 ≈ ¥122.30',
  children: [makeEl({ tag: 'A', href: 'https://www.ozon.ru/product/matras-1979786266/', text: 'bed-matras' }), makeEl({ text: '毛子ERP\n选品标签： 符合要求', children: [makeEl({ text: '选品标签： 符合要求' })] })],
});
const rubList = makeEl({ widget: 'tileGridDesktop', children: [rubCard] });
const blankDoc = { querySelectorAll: s => s.includes('input[type="text"]') ? [loBlank, hiBlank] : s.includes('tileGridDesktop') ? [rubList] : [] };
assert.equal(context.OzonCategoryScanner.confirmRubPrice(blankDoc, { pageMinRub: 1300, pageMaxRub: 30000 }), true, 'blank radio labels confirm via RUB list prices');
const cnyCardInList = makeEl({ widget: 'tileGridDesktop', children: [card('44444', 'cny-only')] });
const cnyMismatchDoc = { querySelectorAll: s => s.includes('input[type="text"]') ? [loBlank, hiBlank] : s.includes('tileGridDesktop') ? [cnyCardInList] : [] };
assert.equal(context.OzonCategoryScanner.confirmRubPrice(cnyMismatchDoc, { pageMinRub: 1300, pageMaxRub: 30000 }), false, 'CNY card prices must reject RUB confirmation');
assert.equal(context.OzonCategoryScanner.detectNonRubCurrency(cnyMismatchDoc), true, 'CNY list prices indicate non-RUB currency mismatch');
assert.equal(context.OzonCategoryScanner.detectNonRubCurrency(blankDoc), false, 'RUB list prices must not trigger non-RUB currency mismatch');
const cnySideLo = makeEl({ tag: 'INPUT' }), cnySideHi = makeEl({ tag: 'INPUT' });
cnySideLo.value = '100'; cnySideHi.value = '500';
const cnySidebarGroup = makeEl({ text: '价格 ⓘ\n¥ 100 - ¥ 500', children: [cnySideLo, cnySideHi] });
cnySidebarGroup.querySelectorAll = s => s.includes('input[type="text"]') ? [cnySideLo, cnySideHi] : [];
const cnySidebarDoc = { querySelectorAll: s => s.includes('input[type="text"]') ? [cnySideLo, cnySideHi] : [] };
assert.equal(context.OzonCategoryScanner.detectNonRubCurrency(cnySidebarDoc), true, 'sidebar CNY price group triggers non-RUB currency mismatch');
const rubReadResult = reader.read('https://www.ozon.ru/category/demo-123/', { minPrice: 100, fxRate: 12 }, rubList);
assert.equal(rubReadResult.products.length, 1);
assert.equal(rubReadResult.products[0].sku, '1979786266');
assert.equal(rubReadResult.products[0].price, '1 480 ₽');

console.log('category scanner real-core synthetic DOM tests passed');
