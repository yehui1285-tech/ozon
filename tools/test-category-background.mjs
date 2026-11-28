import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const data = {}, sessionData={}, alarms=new Map();
let created = [], reloads=0, sentMessages=[], debuggerCommands=[], debuggerAttached=new Set(), debuggerDetachListener=null, nextTabId=71, nextWindowId=9, windowFocused=false, tickMode='running', scriptFail=false;
const storage = { async get(k) { return k ? { ...(data[k] ? { [k]: data[k] } : {}) } : { ...data }; }, async set(v) { Object.assign(data, v); }, async remove(k) { for (const key of Array.isArray(k) ? k : [k]) delete data[key]; } };
let declaredDebugger=true;
const chrome = {
  runtime:{getManifest:()=>({version:'0.6.91',permissions:declaredDebugger?['debugger']:[]})},
  storage: { local: storage,session:{async get(k){return {[k]:sessionData[k]}},async set(v){Object.assign(sessionData,v)},async remove(k){delete sessionData[k]}} },
  alarms:{async get(n){return alarms.get(n)},async create(n,o){alarms.set(n,o)},async clear(n){alarms.delete(n)}},
  tabs: {
    async create(o) { const t = { id: nextTabId++, autoDiscardable:true,status:'complete', ...o }; created.push(t); return t; },
    async get(id) { const t=created.find(x=>x.id===id);if(!t)throw Error('missing tab');return {...t}; },
    async update(id, o) { Object.assign(created.find(x => x.id === id), o); return { id, ...o }; },
    async remove(id) { created = created.filter(x => x.id !== id); },
    async reload() { reloads++; },
    async sendMessage(id,message) { sentMessages.push({id,message});if(message.type==='categoryScanTick'){if(tickMode==='missing')throw Error('no receiving end');return {ok:true,running:tickMode==='running',pageHidden:true}}return { ok: true }; },
  },
  windows: {
    async create(o) { const windowId=nextWindowId++,t={id:nextTabId++,windowId,active:false,autoDiscardable:true,status:'complete',...o};created.push(t);return {id:windowId,focused:false,tabs:[{...t}]}; },
    async get(id) { return {id,focused:windowFocused}; },
  },
  debugger: {
    onDetach:{addListener(fn){debuggerDetachListener=fn;}},
    async attach(target){if(debuggerAttached.has(target.tabId))throw Error('already attached');debuggerAttached.add(target.tabId);},
    async sendCommand(target,method,args){debuggerCommands.push({tabId:target.tabId,method,args});},
    async detach(target){debuggerAttached.delete(target.tabId);},
  },
  scripting: { async executeScript() { if (scriptFail) throw Error('tab crashed'); } },
};
const context = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, crypto:globalThis.crypto });
context.globalThis = context;
let lastLookup = [];
const poolFixture = {products:{}, history:{}};
context.OzonProductPoolDB = {
  async lookup(skus) {
    lastLookup = [...skus];
    return Object.fromEntries(Object.entries(poolFixture).map(([store, rows]) => [
      store, Object.fromEntries(skus.filter(sku => Object.hasOwn(rows, sku)).map(sku => [sku, rows[sku]])),
    ]));
  },
};
for (const file of ["store-scanner-core.js", "category-core.js", "product-pool-core.js"]) {
  vm.runInContext(fs.readFileSync(new URL(`../ozon-erp-collector-extension/${file}`, import.meta.url), "utf8"), context, { filename: file });
}
vm.runInContext(fs.readFileSync(new URL("../ozon-erp-collector-extension/category-background.js", import.meta.url), "utf8"), context);
const runner = context.OzonCategoryBackground;

await runner.handle({ type: "categoryStart", urls: "https://www.ozon.ru/category/tools-101/\nhttps://www.ozon.ru/category/tools-202/", targetCount: 3, minPrice: 10, maxPrice: 500 });
let batch = (await runner.handle({ type: "categoryGet" })).batch;
assert.equal(batch.stores.length, 2);
assert.equal(batch.currentIndex, 0);
await assert.rejects(() => runner.handle({ type: "categoryStart", urls: "https://www.ozon.ru/category/tools-303/", targetCount: 1 }));
const attemptId = batch.attemptId;
assert.equal(batch.tabId, 71);
assert.equal(created.find(t=>t.id===batch.tabId).autoDiscardable,false,'only the tasked tab is protected from automatic discard');
assert.equal(alarms.get('ozon-category-runner').periodInMinutes,0.5);
const done = await runner.handle({ type: "categorySample", batchId: batch.id, attemptId, categoryUrl: batch.stores[0].url, observedSkus: ["11", "12", "13"], products: [
  { sku: "11", name: "A", link: "https://www.ozon.ru/product/a-11", price: "20", qualified: true, shippingRisk: { type: "clear" } },
  { sku: "12", name: "B", link: "https://www.ozon.ru/product/b-12", price: "30", qualified: true, shippingRisk: { type: "clear" } },
  { sku: "13", name: "blocked", link: "https://www.ozon.ru/product/c-13", price: "30", qualified: true, shippingRisk: { type: "suspected_prohibited" } },
 ] }, { tab: { id: batch.tabId, url: batch.stores[0].url } });
assert.equal(done.stop, false);
batch = (await runner.handle({ type: "categoryGet" })).batch;
assert.equal(batch.stores[0].qualifiedCount, 2);
const taskTab=created.find(t=>t.id===batch.tabId),oldAttempt=batch.attemptId;
data.ozonCategoryBatchV1.lastProgressAt=new Date(Date.now()-181000).toISOString();
data.ozonCategoryBatchV1.watchdogSince=data.ozonCategoryBatchV1.lastProgressAt;
const staleAt=data.ozonCategoryBatchV1.lastProgressAt;taskTab.frozen=true;
const beforeFrozen=sentMessages.length;await runner.onAlarm({name:'ozon-category-runner'});
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.status,'running','a frozen but matching background tab must not cause a false manual pause');assert.equal(batch.pageMode,'waiting');assert.equal(batch.lastProgressAt,staleAt,'watchdog checks are not actual progress');assert.equal(batch.stores[0].observedCount,3);assert.equal(sentMessages.length,beforeFrozen,'frozen reader is not repeatedly contacted');
taskTab.frozen=false;await runner.onAlarm({name:'ozon-category-runner'});assert.ok(sentMessages.some(x=>x.message.type==='categoryScanTick'&&x.message.attemptId===oldAttempt));
batch=(await runner.handle({type:'categoryGet'})).batch;assert.equal(batch.attemptId,oldAttempt,'a live reader is nudged without starting over');
tickMode='missing';await runner.onAlarm({name:'ozon-category-runner'});tickMode='running';
batch=(await runner.handle({type:'categoryGet'})).batch;assert.equal(batch.status,'running');assert.notEqual(batch.attemptId,oldAttempt);assert.equal(batch.pageMode,'recovering');assert.equal(batch.stores[0].observedCount,3);assert.equal(reloads,0,'recovery must not reload or navigate the site');
const previousProgress=batch.lastProgressAt;batch=(await runner.handle({type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:batch.stores[0].url,observedSkus:['14'],products:[],pageHidden:true},{tab:{id:batch.tabId,url:batch.stores[0].url}})).batch;
assert.equal(batch.pageMode,'background');assert.equal(batch.stores[0].observedCount,4);assert.ok(batch.lastProgressAt>previousProgress);assert.ok(batch.lastNewSkuAt);
await assert.rejects(() => runner.handle({ type: "categorySample", batchId: batch.id, attemptId: "stale", categoryUrl: batch.stores[0].url, products: [] }, { tab: { id: batch.tabId, url: batch.stores[0].url } }));
await runner.handle({ type: "categoryPageDone", batchId: batch.id, attemptId: batch.attemptId, categoryUrl: batch.stores[0].url, complete: true, reason: "visible_catalog_end" }, { tab: { id: batch.tabId, url: batch.stores[0].url } });
batch = (await runner.handle({ type: "categoryGet" })).batch;
assert.equal(batch.currentIndex, 1);
const secondTabId = batch.tabId;
const second = await runner.handle({ type: "categorySample", batchId: batch.id, attemptId: batch.attemptId, categoryUrl: batch.stores[1].url, observedSkus: ["11", "21"], products: [
  { sku: "11", name: "duplicate across categories", link: "https://www.ozon.ru/product/a-11", price: "25", qualified: true, shippingRisk: { type: "clear" } },
  { sku: "21", name: "C", link: "https://www.ozon.ru/product/c-21", price: "25", qualified: true, shippingRisk: { type: "clear" } },
 ] }, { tab: { id: secondTabId, url: batch.stores[1].url } });
assert.equal(second.batch.stores[1].qualifiedCount, 1);
assert.equal(second.batch.status, "completed");
assert.equal(created.find(t=>t.id===secondTabId).autoDiscardable,true,'completed scan restores its tab setting');assert.equal(alarms.has('ozon-category-runner'),false);
await runner.handle({ type: "categoryStart", urls: "https://www.ozon.ru/category/tools-303/", targetCount: 1 });
await runner.handle({ type: "categoryStop" });
assert.equal((await runner.handle({ type: "categoryGet" })).batch.status, "stopped");
await runner.handle({ type: "categoryStart", urls: "https://www.ozon.ru/category/tools-404/", targetCount: 1 });
assert.equal((await runner.snapshotHistory()).length, 2);
await runner.onRestart();
assert.equal((await runner.handle({ type: "categoryGet" })).batch.status, "paused");
await runner.handle({ type: "categoryResume" });
assert.equal((await runner.handle({ type: "categoryGet" })).batch.status, "running");
assert.equal(reloads,0,'continue should keep the current page and scroll, not reload it');
assert.ok(sentMessages.some(x=>x.message.type==='categoryScanStart'),'continue starts the reader on the existing page');
batch = (await runner.handle({ type: "categoryGet" })).batch;
await runner.handle({type:'categoryWait',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:batch.stores[0].url,reason:'catalog_loading'},{tab:{id:batch.tabId,url:batch.stores[0].url}});
assert.equal((await runner.handle({type:'categoryGet'})).batch.status,'running','normal loading is not a manual pause');
await assert.rejects(()=>runner.handle({type:'categoryWait',batchId:batch.id,attemptId:'stale',categoryUrl:batch.stores[0].url,reason:'catalog_loading'},{tab:{id:batch.tabId,url:batch.stores[0].url}}));
await runner.handle({type:'categoryPause'});
await chrome.tabs.update(batch.tabId,{url:'https://www.ozon.ru/login/'});
const before=created.length;const blockedResume=await runner.handle({type:'categoryResume'});
assert.equal(blockedResume.batch.status,'paused');assert.equal(created.length,before,'do not navigate away from login/verification or create a replacement tab');
await chrome.tabs.update(batch.tabId,{url:batch.stores[0].url});
assert.equal((await runner.handle({type:'categoryResume'})).batch.status,'running');
batch = (await runner.handle({ type: "categoryGet" })).batch;
await runner.onRemoved(batch.tabId);
assert.equal((await runner.handle({ type: "categoryGet" })).batch.status, "paused");
await runner.handle({ type: "categoryResume" });
assert.equal((await runner.handle({ type: "categoryGet" })).batch.status, "running");
batch = (await runner.handle({type:'categoryGet'})).batch;
let pause=await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:batch.stores[0].url,complete:false,reason:'manual-verification',verificationDetail:'http_denied'},{tab:{id:batch.tabId,url:batch.stores[0].url}});
assert.equal(pause.batch.status,'paused');assert.match(pause.batch.message,/访问受限/);assert.match(pause.batch.stores[0].note,/访问受限/);
await runner.handle({type:'categoryStop'});
const regularUrl='https://www.ozon.ru/category/tools-8500/',chinaUrl='https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/?category=8500';
batch=(await runner.handle({type:'categoryStart',urls:[regularUrl,chinaUrl],categoryLabels:{[regularUrl]:'汽车用品',[chinaUrl]:'中国专区汽车用品'},targetCount:10})).batch;
assert.deepEqual(Array.from(batch.stores,s=>s.sellerKey),['category:8500','china-category:8500']);
assert.equal(batch.stores[0].sourceKind,'normal');assert.equal(batch.stores[1].sourceKind,'china');
await assert.rejects(()=>runner.handle({type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:chinaUrl,products:[]},{tab:{id:batch.tabId,url:chinaUrl}}));
batch=(await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:regularUrl,complete:true,reason:'visible_catalog_end'},{tab:{id:batch.tabId,url:regularUrl}})).batch;
assert.equal(batch.currentIndex,1);assert.equal(created.find(t=>t.id===batch.tabId).url,chinaUrl);
const chineseSku={sku:'850001',name:'配件',qualified:true,price:'90',link:'https://www.ozon.ru/product/part-850001/',shippingRisk:{type:'clear'}};
batch=(await runner.handle({type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:chinaUrl,categoryName:'全部商品',observedSkus:['850001'],products:[chineseSku]},{tab:{id:batch.tabId,url:chinaUrl}})).batch;
assert.match(batch.results['china-category:8500'].storeName,/中国专区/);assert.match(batch.results['china-category:8500'].storeName,/汽车用品/);
const exportResult=await runner.handle({type:'categoryExport',batchId:batch.id});assert.match(exportResult.csv,/highlight\/tovary-iz-kitaya-935133\/\?category=8500/);
batch=(await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:chinaUrl,complete:false,reason:'next_page_available',nextUrl:chinaUrl+'&page=2'},{tab:{id:batch.tabId,url:chinaUrl}})).batch;
assert.equal(batch.stores[1].pageUrl,chinaUrl+'&page=2');

// Finished history deletion is local to the category archive, and cleanup also clears a finished empty current batch.
const historyBatch=(id,status,count)=>({id,status,updatedAt:'2026-11-23T00:00:00.000Z',qualifiedSkuIds:Array.from({length:count},(_,i)=>`${id}-${i}`),stores:[],results:{}});
data.ozonCategoryBatchHistoryV1=[historyBatch('empty-completed','completed',0),historyBatch('keep-products','completed',1),historyBatch('empty-stopped','stopped',0)];
data.ozonProductPoolV1={products:{'sku-keep':{sku:'sku-keep'}},history:{'sku-history':{sku:'sku-history'}}};
data.ozonCategoryBatchV1=historyBatch('protected-paused','paused',0);
await assert.rejects(()=>runner.handle({type:'categoryDeleteBatch',batchId:'protected-paused'}),/运行|暂停/);
let cleaned=await runner.handle({type:'categoryCleanupEmpty'});
assert.equal(cleaned.deletedCount,2,'cleanup removes only finished zero-result history batches');
assert.equal(cleaned.batch.id,'protected-paused','cleanup preserves a paused current batch');
assert.deepEqual(Array.from((await runner.snapshotHistory()),x=>x.id),['keep-products']);
assert.ok(data.ozonProductPoolV1.products['sku-keep']);assert.ok(data.ozonProductPoolV1.history['sku-history']);
const currentEmpty=historyBatch('empty-current','completed',0);
data.ozonCategoryBatchV1=currentEmpty;
cleaned=await runner.handle({type:'categoryCleanupEmpty'});
assert.equal(cleaned.deletedCount,1,'cleanup includes a finished zero-result current batch');
assert.equal(cleaned.batch,null);
assert.equal(await runner.snapshot(),null);
assert.equal((await runner.snapshotHistory()).length,1,'nonempty history remains available');
const deleted=await runner.handle({type:'categoryDeleteBatch',batchId:'keep-products'});
assert.equal((await runner.snapshotHistory()).length,0,'selected finished history can be deleted');
// A live but stalled hidden page yields the tab without losing its checkpoint.
let clock = Date.now();
context.Date = class extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
batch = (await runner.handle({type:'categoryStart',urls:[regularUrl,chinaUrl],targetCount:20})).batch;
async function report(type, fields={}) {
  const url = batch.stores[batch.currentIndex].pageUrl;
  const response = await runner.handle({type,batchId:batch.id,attemptId:batch.attemptId,categoryUrl:url,pageHidden:true,...fields},
    {tab:{id:batch.tabId,url}});
  batch = (await runner.handle({type:'categoryGet'})).batch;
  return response;
}
const checkpointSku = {...chineseSku,sku:'760',link:'https://www.ozon.ru/product/item-760/'};
await report('categorySample',{observedSkus:['760'],products:[checkpointSku],pendingSkus:['761'],pendingCount:1});
await report('categoryWait',{reason:'hidden_bottom'});
clock += 70000;
await report('categoryWait',{reason:'hidden_bottom'});
assert.equal(batch.currentIndex,0);
await report('categorySample',{observedSkus:['762'],products:[],pendingSkus:['761'],pendingCount:1});
await report('categoryWait',{reason:'hidden_bottom'});
clock += 70000;
await report('categoryWait',{reason:'scroll_stalled'});
assert.equal(batch.currentIndex,0,'new SKU starts a fresh stall interval');
clock += 25000;
const abandonedAttempt=batch.attemptId;
await report('categoryWait',{reason:'scroll_stalled'});
assert.equal(batch.currentIndex,1,'a confirmed long stall yields to the unstarted category');
assert.equal(batch.stores[0].status,'deferred');
assert.deepEqual(Array.from(batch.stores[0].pendingSkus),['761']);
assert.deepEqual(Array.from(batch.stores[0].observedSkus),['760','762']);
assert.equal(batch.results['category:8500'].products['760'].sku,'760');
await assert.rejects(()=>runner.handle({type:'categoryWait',batchId:batch.id,attemptId:abandonedAttempt,
  categoryUrl:regularUrl,pageHidden:true,reason:'hidden_bottom'},{tab:{id:batch.tabId,url:regularUrl}}));
await report('categoryPageDone',{complete:true,reason:'visible_catalog_end'});
assert.equal(batch.currentIndex,0);
assert.equal(batch.stores[0].revisitCount,1);
await report('categoryWait',{reason:'review_pending'});
clock+=91000;
await report('categoryWait',{reason:'review_pending'});
assert.equal(batch.status,'paused','all work tried and unresolved after the return visit');
assert.equal(batch.stores[0].status,'partial');
assert.equal(batch.stores[0].observedCount,2);
assert.equal(batch.stores[0].pendingCount,1);
await runner.handle({type:'categoryStop'});
data.ozonCategoryBatchHistoryV1=[];
batch=(await runner.handle({type:'categoryStart',urls:[regularUrl,chinaUrl],targetCount:20})).batch;
const originalChecked=Array.from({length:760},(_,i)=>String(10000+i));
const originalPending=Array.from({length:56},(_,i)=>String(20000+i));
await report('categorySample',{observedSkus:originalChecked,pendingSkus:originalPending,pendingCount:56,products:[]});
await report('categoryWait',{reason:'catalog_loading'});
clock+=91000;
await report('categoryWait',{reason:'list_ambiguous'});
assert.equal(batch.currentIndex,0,'ambiguous scope must never trigger automatic navigation');
await report('categoryWait',{reason:'catalog_loading'});
clock+=45000;
await runner.onRestart();
batch=(await runner.handle({type:'categoryResume'})).batch;
assert.equal(batch.status,'running');
clock+=180000;
await report('categoryWait',{reason:'catalog_loading'});
assert.equal(batch.currentIndex,0,'time spent paused must not consume the next attempt');
clock+=91000;
const scanTab=created.find(t=>t.id===batch.tabId);
scanTab.pendingUrl='https://www.ozon.ru/login/';
await report('categoryWait',{reason:'catalog_loading'});
assert.equal(batch.status,'paused');
assert.equal(scanTab.url,regularUrl);
assert.equal(batch.stores[0].observedCount,760);
assert.equal(batch.stores[0].pendingCount,56);
delete scanTab.pendingUrl;
batch=(await runner.handle({type:'categoryResume'})).batch;
assert.equal(batch.currentIndex,1);
await report('categoryWait',{reason:'scroll_stalled'});
clock+=91000;
await report('categoryWait',{reason:'scroll_stalled'});
assert.equal(batch.currentIndex,0,'both first passes finish before a second pass');
assert.deepEqual(Array.from(batch.stores[0].observedSkus),originalChecked);
assert.deepEqual(Array.from(batch.stores[0].pendingSkus),originalPending);
await report('categoryWait',{reason:'hidden_bottom'});
clock+=91000;
await report('categoryWait',{reason:'hidden_bottom'});
assert.equal(batch.currentIndex,1,'an exhausted category must not block another deferred category');
assert.equal(batch.stores[0].status,'partial');
await report('categoryPageDone',{reason:'visible_catalog_end',complete:true});
assert.equal(batch.status,'paused','a remaining partial category precludes automatic completion');
batch=(await runner.handle({type:'categoryResume'})).batch;
assert.equal(batch.currentIndex,0,'manual resume returns to remaining incomplete work');
assert.equal(batch.stores[0].observedCount,760);
await report('categoryPageDone',{reason:'manual-verification',verificationDetail:'security_prompt'});
assert.equal(batch.status,'paused');
assert.match(batch.message,/安全验证/);
await runner.handle({type:'categoryStop'});
batch=(await runner.handle({type:'categoryStart',urls:regularUrl,targetCount:10,backgroundExperiment:true,confirmArchiveOverflow:true})).batch;
const experimentTab=created.find(t=>t.id===batch.tabId);
assert.equal(experimentTab.active,false,'the owned task opens inactive in a separate ordinary window');
assert.equal(experimentTab.focused,false,'opening the task never focuses its window');
assert.equal(debuggerAttached.has(batch.tabId),true,'the experiment attaches only to its owned task tab');
assert.ok(debuggerCommands.some(x=>x.tabId===batch.tabId&&x.method==='Emulation.setFocusEmulationEnabled'&&x.args.enabled===true));
const taskUrl=batch.stores[0].url;
batch=(await runner.handle({type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:taskUrl,pageHidden:false,
  discoverSkus:['900','901','900'],erpReadySkus:['900'],labelHitSkus:['900','900'],observedSkus:['900'],products:[]},{tab:{id:batch.tabId,url:taskUrl}})).batch;
assert.equal(batch.stores[0].discoveredCount,2);assert.equal(batch.stores[0].erpReadyCount,1);assert.equal(batch.stores[0].labelHitCount,1);
assert.equal(batch.pageMode,'background','inactive tab and unfocused window remain natively hidden despite focus emulation');
batch=(await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:taskUrl,pageHidden:false,complete:true,reason:'visible_catalog_end'},{tab:{id:batch.tabId,url:taskUrl}})).batch;
assert.equal(batch.status,'running','focus emulation cannot establish visible completion');
windowFocused=true;experimentTab.active=true;
batch=(await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:taskUrl,pageHidden:false,complete:true,reason:'visible_catalog_end'},{tab:{id:batch.tabId,url:taskUrl}})).batch;
assert.equal(batch.status,'completed','completion is accepted only after native tab and window focus are confirmed');
assert.equal(debuggerAttached.has(batch.tabId),false,'completion detaches the experiment debugger session');
assert.ok(debuggerCommands.some(x=>x.tabId===batch.tabId&&x.method==='Emulation.setFocusEmulationEnabled'&&x.args.enabled===false));
windowFocused=false;
batch=(await runner.handle({type:'categoryStart',urls:regularUrl,targetCount:10,backgroundExperiment:true,confirmArchiveOverflow:true})).batch;
assert.equal(debuggerAttached.has(batch.tabId),true);
batch=(await runner.handle({type:'categoryPause'})).batch;
assert.equal(batch.status,'paused');assert.equal(debuggerAttached.has(batch.tabId),false,'pause releases the owned debugger session');
batch=(await runner.handle({type:'categoryResume',backgroundExperiment:true})).batch;
assert.equal(batch.status,'running');assert.equal(debuggerAttached.has(batch.tabId),true,'resume can re-enable the experiment on its existing task tab');
await runner.handle({type:'categoryStop'});
assert.equal(debuggerAttached.size,0,'stop releases the experiment session');
batch=(await runner.handle({type:'categoryStart',urls:regularUrl,targetCount:10,backgroundExperiment:true,confirmArchiveOverflow:true})).batch;
const navigatingTab=created.find(t=>t.id===batch.tabId);
navigatingTab.url='https://www.ozon.ru/login/';
await runner.onUpdated(batch.tabId,{url:navigatingTab.url,status:'complete'},navigatingTab);
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.status,'paused','unexpected navigation pauses instead of redirecting the page');
assert.equal(debuggerAttached.has(batch.tabId),false,'navigation releases the debugger before handling the new page');
await runner.handle({type:'categoryStop'});
batch=(await runner.handle({type:'categoryStart',urls:regularUrl,targetCount:10,backgroundExperiment:true,confirmArchiveOverflow:true})).batch;
const removedTabId=batch.tabId;
assert.equal(debuggerAttached.has(removedTabId),true);
await runner.onRemoved(removedTabId);
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.status,'paused');assert.equal(debuggerAttached.has(removedTabId),false,'tab removal releases the experiment session');
await runner.handle({type:'categoryStop'});
await runner.handle({type:'categoryStart',urls:regularUrl,targetCount:10,backgroundExperiment:true,confirmArchiveOverflow:true});
batch=(await runner.handle({type:'categoryGet'})).batch;
const detachedTabId=batch.tabId;
debuggerDetachListener?.({tabId:detachedTabId},'canceled_by_user');
await new Promise(resolve=>setTimeout(resolve,0));
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.status,'paused','user detaching the experiment session pauses with the checkpoint preserved');
assert.equal(batch.backgroundExperiment,false);
// Explicit card operations are bound to the current batch and seller key.
await runner.handle({type:'categoryStop'});
batch=(await runner.handle({type:'categoryStart',urls:[regularUrl,chinaUrl],targetCount:20,confirmArchiveOverflow:true})).batch;
const cardId=batch.id, cardAttempt=batch.attemptId, cardTab=batch.tabId;
await runner.handle({type:'categorySample',batchId:cardId,attemptId:cardAttempt,categoryUrl:regularUrl,
  observedSkus:['9901'],pendingSkus:['9902'],pendingCount:1,products:[]},{tab:{id:cardTab,url:regularUrl}});
batch=(await runner.handle({type:'categoryStop'})).batch;
assert.equal(batch.stores[0].status,'partial','stop preserves an active checkpoint as a resumable partial card');
await assert.rejects(()=>runner.handle({type:'categoryTaskSkip',batchId:'stale-batch',sellerKey:batch.stores[1].sellerKey}),/变化/);
await assert.rejects(()=>runner.handle({type:'categoryTaskSkip',batchId:batch.id,sellerKey:'not-a-seller'}),/未找到/);
await assert.rejects(()=>runner.handle({type:'categorySample',batchId:cardId,attemptId:cardAttempt,categoryUrl:regularUrl,
  observedSkus:['9903'],products:[]},{tab:{id:cardTab,url:regularUrl}}),/暂停|活动/);
batch=(await runner.handle({type:'categoryTaskResume',batchId:batch.id,sellerKey:batch.stores[1].sellerKey})).batch;
assert.equal(batch.status,'running');assert.equal(batch.currentIndex,1,'explicit selection switches to the chosen pending card');
assert.equal(batch.stores[0].status,'partial','switching preserves the other incomplete checkpoint');
await runner.handle({type:'categoryPause'});
batch=(await runner.handle({type:'categoryTaskSkip',batchId:batch.id,sellerKey:batch.stores[1].sellerKey})).batch;
assert.equal(batch.stores[1].status,'skipped');
batch=(await runner.handle({type:'categoryTaskRemove',batchId:batch.id,sellerKey:batch.stores[0].sellerKey})).batch;
assert.equal(batch.stores[0].status,'skipped');assert.equal(batch.stores[0].removedFromQueue,true);
assert.deepEqual(Array.from(batch.stores[0].observedSkus),['9901']);assert.deepEqual(Array.from(batch.stores[0].pendingSkus),['9902']);
assert.equal(batch.status,'completed','all skipped or removed cards settle without restarting');
batch=(await runner.handle({type:'categoryStart',urls:[regularUrl,chinaUrl],targetCount:20,confirmArchiveOverflow:true})).batch;
await runner.handle({type:'categoryStop'});
batch=(await runner.handle({type:'categoryTaskRemove',batchId:batch.id,sellerKey:batch.stores[0].sellerKey})).batch;
assert.equal(batch.stores[0].removedFromQueue,true);
batch=(await runner.handle({type:'categoryTaskResume',batchId:batch.id,sellerKey:batch.stores[1].sellerKey}));
assert.equal(batch.ok,true);assert.equal(batch.batch.currentIndex,1,'a stopped pending card can be explicitly resumed');

// A skipped scheduled card must never make Continue restart an already completed card.
await runner.handle({type:'categoryStop'});
const thirdUrl='https://www.ozon.ru/category/tools-8501/';
batch=(await runner.handle({type:'categoryStart',urls:[regularUrl,chinaUrl,thirdUrl],targetCount:20,confirmArchiveOverflow:true})).batch;
await runner.handle({type:'categoryPause'});
const savedCardBatch=data.ozonCategoryBatchV1;
savedCardBatch.stores[0].status='completed';savedCardBatch.stores[1].status='partial';savedCardBatch.resumeIndex=1;
batch=(await runner.handle({type:'categoryTaskSkip',batchId:batch.id,sellerKey:batch.stores[1].sellerKey})).batch;
assert.equal(batch.resumeIndex,2,'a skipped scheduled task selects the remaining runnable card');
batch=(await runner.handle({type:'categoryResume'})).batch;
assert.equal(batch.currentIndex,2,'Continue must not restart the previously completed card');
assert.equal(batch.stores[1].status,'skipped');

// V1.49 diagnostic outcomes retain final candidate reasons and expose a bounded, safe export.
await runner.handle({type:'categoryStop'});
const diagUrl='https://www.ozon.ru/category/tools-8502/';
batch=(await runner.handle({type:'categoryStart',urls:[diagUrl],targetCount:2,confirmArchiveOverflow:true})).batch;
poolFixture.products['99010']={sku:'99010'};
poolFixture.history['99011']=true;
const diagAttempt=batch.attemptId,diagTab=batch.tabId;
batch=(await runner.handle({type:'categorySample',batchId:batch.id,attemptId:diagAttempt,categoryUrl:diagUrl,discoverSkus:['99100','99101','99010','99011','99102','99103'],erpReadySkus:['99100','99101','99010','99011','99102','99103'],labelHitSkus:['99100','99010','99011','99102','99103'],pageReportedHidden:true,skuDecisions:{'99100':'eligible','99101':'no_label','99010':'eligible','99011':'eligible','99102':'eligible','99103':'eligible'},products:[
 {sku:'99100',name:'A',link:'https://www.ozon.ru/product/a-99100',price:'20',qualified:true,shippingRisk:{type:'clear'}},
 {sku:'99010',name:'pool duplicate',link:'https://www.ozon.ru/product/a-99010',price:'20',qualified:true,shippingRisk:{type:'clear'}},
 {sku:'99011',name:'history duplicate',link:'https://www.ozon.ru/product/a-99011',price:'20',qualified:true,shippingRisk:{type:'clear'}},
 {sku:'99102',name:'B',link:'https://www.ozon.ru/product/a-99102',price:'20',qualified:true,shippingRisk:{type:'clear'}},
 {sku:'99103',name:'over target',link:'https://www.ozon.ru/product/a-99103',price:'20',qualified:true,shippingRisk:{type:'clear'}}
]},{tab:{id:diagTab,url:diagUrl}})).batch;
const diagnostic=(await runner.handle({type:'categoryDiagnostic',batchId:batch.id})).diagnostic;
assert.ok(diagnostic.tasks[0].examples.accepted.includes('99100'));
assert.ok(diagnostic.tasks[0].examples.pool_duplicate.includes('99010'));
assert.ok(lastLookup.includes('99010') && lastLookup.includes('99011'), 'category checks only the reported sample');
assert.ok(diagnostic.tasks[0].examples.history_duplicate.includes('99011'));
assert.ok(diagnostic.tasks[0].examples.target_limit.includes('99103'));
assert.equal(batch.stores[0].diagnosticCounts.no_label,1);
assert.deepEqual({...batch.stores[0].diagnosticCounts},{accepted:2,no_label:1,pool_duplicate:1,history_duplicate:1,target_limit:1});
assert.equal(diagnostic.browser.tabStatus,'complete');assert.equal(diagnostic.browser.tabActive,false);assert.equal(diagnostic.browser.windowFocused,false);
assert.equal(diagnostic.counters.unknownLegacyCount,0);
assert.ok(diagnostic.lastDiscoveryAt&&diagnostic.lastErpReadyAt&&diagnostic.lastLabelHitAt&&diagnostic.lastAcceptedAt,'batch timestamps reflect real count increases');
assert.ok((batch.diagnosticEvents||[]).some(e=>e.type==='start'));
assert.ok((await runner.handle({type:'categoryDiagnostic',batchId:batch.id})).diagnostic.tasks[0].examples.accepted.length<=5);
data.ozonCategoryBatchV1.diagnosticEvents=Array.from({length:130},(_,i)=>({at:new Date(i).toISOString(),type:'explicit_wait',detail:'wait'}));
assert.equal((await runner.handle({type:'categoryDiagnostic',batchId:batch.id})).diagnostic.events.length,120,'diagnostic export bounds event history');
await assert.rejects(()=>runner.handle({type:'categoryDiagnostic',batchId:'missing'}),/找不到/);

// Actual scanner payload, a second heartbeat with the same SKU, and browser freeze.
batch=(await runner.handle({type:'categoryStart',urls:[diagUrl],targetCount:20,confirmArchiveOverflow:true})).batch;
const phaseSample={type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:diagUrl,discoverSkus:['99200','99201','99202','99203','99204'],erpReadySkus:['99201','99202','99203','99204'],labelHitSkus:['99202','99203','99204'],observedSkus:['99201','99202','99203'],pendingCount:2,pendingSkus:['99200','99204'],pageReportedHidden:true,pageFocused:false,skuDecisions:{'99200':'erp_pending','99201':'no_label','99202':'price_outside','99203':'transport_blocked','99204':'data_pending'},products:[]};
const diagSender={tab:{id:batch.tabId,url:diagUrl}};
batch=(await runner.handle(phaseSample,diagSender)).batch;
const stageCounts=JSON.stringify(batch.stores[0].diagnosticCounts),progressAt=batch.lastProgressAt,discoveredAt=batch.lastDiscoveryAt;
assert.equal(batch.stores[0].diagnosticCounts.price_outside,1);assert.equal(batch.stores[0].diagnosticCounts.erp_pending,1);
batch=(await runner.handle(phaseSample,diagSender)).batch;
assert.equal(JSON.stringify(batch.stores[0].diagnosticCounts),stageCounts);assert.equal(batch.lastDiscoveryAt,discoveredAt);
created.find(t=>t.id===batch.tabId).frozen=true;
const lastReport=batch.lastProgressAt;
await runner.onAlarm({name:'ozon-category-runner'});await runner.onAlarm({name:'ozon-category-runner'});
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.diagnosticBrowser.frozen,true);assert.equal(batch.diagnosticBrowser.pageReportedHidden,true);assert.ok(batch.diagnosticBrowser.pageReportedAt);
assert.equal(batch.lastProgressAt,lastReport);assert.equal(batch.lastDiscoveryAt,discoveredAt);assert.equal(JSON.stringify(batch.stores[0].diagnosticCounts),stageCounts);
assert.equal(batch.diagnosticEvents.filter(e=>e.type==='watchdog_frozen').length,1);
const frozenDiagnostic=(await runner.handle({type:'categoryDiagnostic',batchId:batch.id})).diagnostic;
assert.equal(frozenDiagnostic.browser.frozen,true);assert.equal(frozenDiagnostic.counters.decisions.transport_blocked,1);
created.find(t=>t.id===batch.tabId).frozen=false;
await runner.handle({type:'categoryStop'});
data.ozonCategoryBatchV1.stores[0].discoveredCount=8;
assert.equal((await runner.handle({type:'categoryDiagnostic',batchId:batch.id})).diagnostic.counters.unknownLegacyCount,3);
// New V1.50 tasks carry the same native RUB price range across categories and pages.
const rch='https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/?category=8500', rn='https://www.ozon.ru/category/tools-333/';
await runner.handle({type:'categoryStart',urls:[rch,rn],targetCount:5,minPrice:20,maxPrice:100,pageMinRub:500,pageMaxRub:2500,confirmArchiveOverflow:true});
batch=(await runner.handle({type:'categoryGet'})).batch;
const filtered=rch+'&currency_price=500.000%3B2500.000',filteredNormal=rn+'?currency_price=500.000%3B2500.000';
assert.equal(batch.stores[0].pageUrl,filtered);assert.equal(batch.stores[1].pageUrl,filteredNormal);
assert.equal(created.find(t=>t.id===batch.tabId).url,filtered);
const sample={type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:filtered,observedSkus:['123'],products:[]};
await assert.rejects(()=>runner.handle(sample,{tab:{id:batch.tabId,url:filtered}}),/卢布/);
await runner.handle({...sample,pagePriceConfirmed:true},{tab:{id:batch.tabId,url:filtered}});
batch=(await runner.handle({type:'categoryGet'})).batch;assert.equal(batch.stores[0].pagePriceStatus,'confirmed');
const next=filtered+'&page=2';
await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:filtered,nextUrl:next,reason:'next_page_available',complete:false},{tab:{id:batch.tabId,url:filtered}});
batch=(await runner.handle({type:'categoryGet'})).batch;assert.equal(batch.stores[0].pageUrl,next);assert.equal(batch.stores[0].pagePriceStatus,'pending');
await runner.handle({type:'categoryPageDone',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:next,nextUrl:rch+'&page=3',reason:'next_page_available',complete:false},{tab:{id:batch.tabId,url:next}});
batch=(await runner.handle({type:'categoryGet'})).batch;assert.equal(batch.status,'paused');assert.equal(batch.stores[0].pageUrl,next,'unfiltered pagination must not navigate');
const priceDiag=(await runner.handle({type:'categoryDiagnostic',batchId:batch.id})).diagnostic;
assert.equal(priceDiag.options.pageMinRub,500);assert.equal(priceDiag.options.pageMaxRub,2500);
await runner.handle({type:'categoryStop'});
await runner.handle({type:'categoryStart',urls:[rch],targetCount:5,pageMinRub:500,pageMaxRub:2500,confirmArchiveOverflow:true});
batch=(await runner.handle({type:'categoryGet'})).batch;
await runner.handle({type:'categorySample',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:filtered,observedSkus:['456'],products:[],pagePriceConfirmed:true},{tab:{id:batch.tabId,url:filtered}});
created.find(t=>t.id===batch.tabId).url=rch;
await runner.onUpdated(batch.tabId,{status:'complete',url:rch},{url:rch});
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.status,'paused');assert.equal(batch.stores[0].pagePriceStatus,'unconfirmed');assert.match(batch.message,/价格/);
await runner.handle({type:'categoryStop'});
// Chrome's official manifest cannot grant debugger access optionally. Even a
// stale API object or previously enabled batch must not use experiment mode.
declaredDebugger=false;
const previousDebuggerCalls=debuggerCommands.length;
await runner.handle({type:'categoryStart',urls:[rn],targetCount:2,backgroundExperiment:true,confirmArchiveOverflow:true});
batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.status,'running','unavailable experiment does not interrupt scanning');
assert.equal(batch.activityStatus,'unavailable','the attempted experiment reports its unavailable status');
assert.equal(batch.backgroundExperiment,false,'unavailable mode must use ordinary scanner visibility semantics');
assert.equal(debuggerAttached.has(batch.tabId),false,'no debugger is attached to the downgraded task when Chrome provides no debugger permission');
assert.equal(debuggerCommands.length,previousDebuggerCalls,'a stale API object is not authorization');
assert.ok(sentMessages.some(x=>x.message.type==='categoryScanStart'),'ordinary scanner starts after experiment downgrade');
await runner.handle({type:'categoryPause'});data.ozonCategoryBatchV1.backgroundExperiment=true;
await runner.handle({type:'categoryResume'});batch=(await runner.handle({type:'categoryGet'})).batch;
assert.equal(batch.backgroundExperiment,false,'legacy persisted experiment setting downgrades on resume');
await runner.handle({type:'categoryStop'});

// V1.60: Proactive tab recycling on category switch & pagination, compactAck,
// OOM crash auto-recovery via fresh tab, limit guard, and safety boundaries.
scriptFail = false; tickMode = 'running';
batch = (await runner.handle({ type: 'categoryStart', urls: [rch, rn], targetCount: 10, pageMinRub: 500, pageMaxRub: 2500, confirmArchiveOverflow: true })).batch;
const firstPageTab = created.find(t => t.id === batch.tabId);
const firstPageTabId = firstPageTab.id, firstPageWindowId = firstPageTab.windowId;
const compactRes = await runner.handle({ type: 'categorySample', batchId: batch.id, attemptId: batch.attemptId, categoryUrl: filtered, observedSkus: ['5001'], products: [], pagePriceConfirmed: true, compactAck: true }, { tab: { id: firstPageTabId, url: filtered } });
assert.equal(compactRes.ok, true);
assert.equal('batch' in compactRes, false, 'compactAck must omit batch object');

// Pagination recycles into a fresh tab in the same window and removes the old tab safely.
const recycledPage2 = filtered + '&page=2';
await runner.handle({ type: 'categoryPageDone', batchId: batch.id, attemptId: batch.attemptId, categoryUrl: filtered, nextUrl: recycledPage2, reason: 'next_page_available', complete: false }, { tab: { id: firstPageTabId, url: filtered } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
const page2TabId = batch.tabId;
assert.notEqual(page2TabId, firstPageTabId, 'pagination creates a fresh tab to release memory');
assert.equal(created.some(t => t.id === firstPageTabId), false, 'old pagination tab is removed');
assert.equal(created.find(t => t.id === page2TabId).windowId, firstPageWindowId, 'recycled tab stays in the same task window');
assert.equal(created.find(t => t.id === page2TabId).autoDiscardable, false);
await runner.onRemoved(firstPageTabId);
assert.equal((await runner.handle({ type: 'categoryGet' })).batch.status, 'running', 'late close event of recycled tab must not pause batch');

// Switching categories also recycles into a fresh tab cleanly.
const activeTabBeforeSwitch = created.find(t => t.id === page2TabId);
activeTabBeforeSwitch.active = true; windowFocused = true;
await runner.handle({ type: 'categoryPageDone', batchId: batch.id, attemptId: batch.attemptId, categoryUrl: recycledPage2, pageHidden: false, complete: true, reason: 'visible_catalog_end' }, { tab: { id: page2TabId, url: recycledPage2 } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.currentIndex, 1);
assert.notEqual(batch.tabId, page2TabId, 'category switch creates a fresh tab');
assert.equal(created.some(t => t.id === page2TabId), false, 'previous category tab is closed');
windowFocused = false;

// OOM crash auto-recovery: twice-failed executeScript triggers fresh replacement tab and preserves progress.
const cat2TabId = batch.tabId;
const cat2Product = { sku: '88001', name: 'P', link: 'https://www.ozon.ru/product/p-88001/', price: '50', qualified: true, shippingRisk: { type: 'clear' } };
await runner.handle({ type: 'categorySample', batchId: batch.id, attemptId: batch.attemptId, categoryUrl: filteredNormal, observedSkus: ['88001'], products: [cat2Product], pagePriceConfirmed: true }, { tab: { id: cat2TabId, url: filteredNormal } });
tickMode = 'missing'; scriptFail = true;
const makeStale = () => {
  data.ozonCategoryBatchV1.lastProgressAt = new Date(clock - 181000).toISOString();
  data.ozonCategoryBatchV1.watchdogSince = data.ozonCategoryBatchV1.lastProgressAt;
};
makeStale();
await runner.onAlarm({ name: 'ozon-category-runner' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.tabId, cat2TabId, 'first injection failure keeps tab before replacement');
assert.equal(batch.recoveryAttempts, 1);
makeStale();
await runner.onAlarm({ name: 'ozon-category-runner' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'running');
assert.notEqual(batch.tabId, cat2TabId, 'second injection failure triggers crashed-tab replacement');
assert.equal(created.some(t => t.id === cat2TabId), false, 'crashed tab is removed');
assert.equal(batch.stores[1].crashRecoveryCount, 1);
assert.deepEqual(Array.from(batch.stores[1].observedSkus), ['88001']);
assert.equal(batch.results['category:333'].products['88001'].sku, '88001');

// New SKU progress resets crashRecoveryCount; frozen/login tabs are never replaced.
scriptFail = false; tickMode = 'running';
const recoveredTab = created.find(t => t.id === batch.tabId);
recoveredTab.frozen = true;
makeStale();
scriptFail = true;
await runner.onAlarm({ name: 'ozon-category-runner' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.tabId, recoveredTab.id, 'frozen tab must never be treated as crashed');
recoveredTab.frozen = false; scriptFail = false;
await runner.handle({ type: 'categorySample', batchId: batch.id, attemptId: batch.attemptId, categoryUrl: filteredNormal, observedSkus: ['88002'], products: [], pagePriceConfirmed: true }, { tab: { id: batch.tabId, url: filteredNormal } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[1].crashRecoveryCount, 0, 'new SKU progress resets crash recovery counter');

// Manual resume on a crashed tab immediately replaces it; hitting CRASH_RECOVER_LIMIT pauses cleanly.
await runner.handle({ type: 'categoryPause' });
const deadTabId = batch.tabId;
scriptFail = true;
batch = (await runner.handle({ type: 'categoryResume' })).batch;
assert.equal(batch.status, 'running');
assert.notEqual(batch.tabId, deadTabId, 'manual resume replaces crashed tab');
assert.equal(batch.stores[1].crashRecoveryCount, 1);

for (let round = 2; round <= 3; round++) {
  tickMode = 'missing';
  makeStale(); await runner.onAlarm({ name: 'ozon-category-runner' });
  makeStale(); await runner.onAlarm({ name: 'ozon-category-runner' });
  batch = (await runner.handle({ type: 'categoryGet' })).batch;
  assert.equal(batch.stores[1].crashRecoveryCount, round);
}
makeStale(); await runner.onAlarm({ name: 'ozon-category-runner' });
makeStale(); await runner.onAlarm({ name: 'ozon-category-runner' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'paused', 'exceeding crash recovery limit pauses safely');
assert.match(batch.message, /自动恢复上限/);
assert.ok(batch.diagnosticEvents.some(e => e.type === 'tab_crash_limit'));
assert.equal(batch.results['category:333'].products['88001'].sku, '88001');
scriptFail = false; tickMode = 'running';
await runner.handle({ type: 'categoryStop' });

// V1.64: perCategoryLimit rotates cleanly across categories before batch targetCount.
await runner.handle({
  type: 'categoryStart',
  urls: 'https://www.ozon.ru/category/c1-901/\nhttps://www.ozon.ru/category/c2-902/\nhttps://www.ozon.ru/category/c3-903/',
  targetCount: 4,
  perCategoryLimit: 2,
  minPrice: 10,
  maxPrice: 500,
  confirmArchiveOverflow: true
});
batch = (await runner.handle({ type: 'categoryGet' })).batch;
const perCatRes1 = await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].url,
  observedSkus: ['90101', '90102', '90103'],
  products: [
    { sku: '90101', name: 'P1', link: 'https://www.ozon.ru/product/p-90101', price: '50', qualified: true, shippingRisk: { type: 'clear' } },
    { sku: '90102', name: 'P2', link: 'https://www.ozon.ru/product/p-90102', price: '60', qualified: true, shippingRisk: { type: 'clear' } },
    { sku: '90103', name: 'P3', link: 'https://www.ozon.ru/product/p-90103', price: '70', qualified: true, shippingRisk: { type: 'clear' } }
  ]
}, { tab: { id: batch.tabId, url: batch.stores[0].url } });
assert.equal(perCatRes1.stop, true, 'hitting perCategoryLimit stops scanning current category');
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'running', 'batch remains running after perCategoryLimit advances to next category');
assert.equal(batch.currentIndex, 1, 'perCategoryLimit advances to category 2');
assert.equal(batch.stores[0].status, 'completed');
assert.equal(batch.stores[0].perCategoryLimitReached, true);
assert.equal(batch.stores[0].exhausted, undefined, 'perCategoryLimit does not mark category exhausted');
assert.equal(batch.stores[0].qualifiedCount, 2, 'perCategoryLimit caps single category candidates');

// Finish batch early on category 2 and test categoryContinueNextRound (remaining_only & resume_all).
await runner.handle({ type: 'categoryStop' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'stopped');

// remaining_only includes uncompleted c2 (partial checkpoint) & c3 (pending), skips completed c1.
await runner.handle({ type: 'categoryContinueNextRound', batchId: batch.id, mode: 'remaining_only', confirmArchiveOverflow: true });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.deepEqual(Array.from(batch.stores, s => s.sellerKey), ['category:902', 'category:903']);
assert.deepEqual(Array.from(batch.priorQualifiedSkuIds || []), ['90101', '90102']);

// Exhaust c2, then resume_all skips exhausted c2 and carries checkpoint of non-exhausted c3.
await runner.handle({
  type: 'categoryPageDone',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].url,
  complete: true,
  reason: 'visible_catalog_end'
}, { tab: { id: batch.tabId, url: batch.stores[0].url } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[0].exhausted, true);
const c3ResumeUrl = `${batch.stores[1].url}?page=2`;
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[1].url,
  observedSkus: ['90101', '90301'],
  products: [
    { sku: '90101', name: 'Prior SKU duplicate', link: 'https://www.ozon.ru/product/p-90101', price: '50', qualified: true, shippingRisk: { type: 'clear' } },
    { sku: '90301', name: 'P301', link: 'https://www.ozon.ru/product/p-90301', price: '80', qualified: true, shippingRisk: { type: 'clear' } }
  ]
}, { tab: { id: batch.tabId, url: batch.stores[1].url } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[1].qualifiedCount, 1, 'priorQualifiedSkuIds 90101 is filtered as prior duplicate');
assert.equal(batch.stores[1].diagnosticDecisions['90101'], 'history_duplicate');
await runner.handle({ type: 'categoryStop' });
const endedRound2 = (await runner.handle({ type: 'categoryGet' })).batch;
await runner.handle({ type: 'categoryContinueNextRound', batchId: endedRound2.id, mode: 'resume_all', confirmArchiveOverflow: true });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.deepEqual(Array.from(batch.stores, s => s.sellerKey), ['category:903'], 'resume_all omits exhausted category:902');
assert.ok(batch.stores[0].observedSkus.includes('90301'));
assert.ok(batch.priorQualifiedSkuIds.includes('90301'));
await runner.handle({ type: 'categoryStop' });

// V1.64: Saved reusable category task profiles lifecycle + checkpoint auto-sync.
const savedResp = await runner.handle({
  type: 'categoryTaskProfileSave',
  name: '日常三类目',
  urls: ['https://www.ozon.ru/category/c1-901/', 'https://www.ozon.ru/category/c2-902/'],
  targetCount: 10,
  perCategoryLimit: 5,
  minPrice: 20,
  maxPrice: 300,
  pageMinRub: 1200,
  pageMaxRub: 25000
});
assert.equal(savedResp.tasks.length, 1);
const taskId = savedResp.task.id;
await runner.handle({ type: 'categoryTaskProfileRun', taskId, confirmArchiveOverflow: true });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.taskProfileId, taskId);
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  observedSkus: ['91001'],
  pagePriceConfirmed: true,
  products: [{ sku: '91001', name: 'T1', link: 'https://www.ozon.ru/product/p-91001', price: '100', qualified: true, shippingRisk: { type: 'clear' } }]
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
await runner.handle({ type: 'categoryStop' });
let tasksAfterRun = (await runner.handle({ type: 'categoryGet' })).tasks;
assert.equal(tasksAfterRun[0].runCount, 1);
assert.equal(tasksAfterRun[0].totalQualifiedCount, 1);
assert.ok(tasksAfterRun[0].priorQualifiedSkuIds.includes('91001'));
assert.ok(tasksAfterRun[0].checkpoints['category:901'].observedSkus.includes('91001'));
await runner.handle({ type: 'categoryTaskProfileReset', taskId });
tasksAfterRun = (await runner.handle({ type: 'categoryGet' })).tasks;
assert.equal(tasksAfterRun[0].runCount, 0);
assert.equal(tasksAfterRun[0].totalQualifiedCount, 0);
assert.equal(tasksAfterRun[0].priorQualifiedSkuIds.length, 0);
await runner.handle({ type: 'categoryTaskProfileDelete', taskId });
assert.equal((await runner.handle({ type: 'categoryGet' })).tasks.length, 0);

// V1.65: Continuing next round with cleared RUB options drops currency_price and preserves observed/prior SKUs;
// price_currency_mismatch surfaces an explicit pause message.
await runner.handle({
  type: 'categoryStart',
  urls: 'https://www.ozon.ru/category/rub1-951/\nhttps://www.ozon.ru/category/rub2-952/',
  targetCount: 5,
  minPrice: 50,
  pageMinRub: 1200,
  pageMaxRub: 30000,
  confirmArchiveOverflow: true
});
batch = (await runner.handle({ type: 'categoryGet' })).batch;
await runner.handle({
  type: 'categoryPageDone',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  complete: false,
  reason: 'price_currency_mismatch'
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'paused');
assert.equal(batch.stores[0].pagePriceStatus, 'unconfirmed');
assert.match(batch.message, /不是卢布/);
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  observedSkus: ['95101'],
  pagePriceConfirmed: true,
  products: [{ sku: '95101', name: 'RubOK', link: 'https://www.ozon.ru/product/p-95101', price: '120', qualified: true, shippingRisk: { type: 'clear' } }]
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } }).catch(() => null);
await runner.handle({ type: 'categoryResume' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  observedSkus: ['95101'],
  pagePriceConfirmed: true,
  products: [{ sku: '95101', name: 'RubOK', link: 'https://www.ozon.ru/product/p-95101', price: '120', qualified: true, shippingRisk: { type: 'clear' } }]
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
await runner.handle({ type: 'categoryStop' });
const rubStoppedBatch = (await runner.handle({ type: 'categoryGet' })).batch;
await runner.handle({
  type: 'categoryContinueNextRound',
  batchId: rubStoppedBatch.id,
  mode: 'resume_all',
  targetCount: 50,
  perCategoryLimit: null,
  minPrice: 100,
  maxPrice: null,
  pageMinRub: null,
  pageMaxRub: null,
  confirmArchiveOverflow: true
});
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.options.targetCount, 50);
assert.equal(batch.options.minPrice, 100);
assert.equal(batch.options.pageMinRub, undefined, 'cleared RUB filter must not inherit from prior batch');
assert.equal(batch.options.pageMaxRub, undefined);
assert.equal(batch.stores[0].pageUrl, 'https://www.ozon.ru/category/rub1-951/', 'cleared RUB filter strips currency_price cleanly');
assert.ok(batch.stores[0].observedSkus.includes('95101'));
assert.ok(batch.priorQualifiedSkuIds.includes('95101'));
await runner.handle({ type: 'categoryStop' });

// V1.66: Cloud deduplication (OzonWorkbenchCloud) + task state export/import/tombstones.
let cloudRefreshes = 0, cloudSyncs = 0;
const mockCloudProducts = new Set(['96001']), mockCloudHistory = new Set(['96002']);
context.OzonWorkbenchCloud = {
  async refreshCloudSkus() { cloudRefreshes++; return { ok: true }; },
  async lookupCloudSkus(skus) {
    const products = {}, history = {};
    for (const s of skus) { if (mockCloudProducts.has(String(s))) products[String(s)] = true; if (mockCloudHistory.has(String(s))) history[String(s)] = true; }
    return { products, history };
  },
  async syncCategoryTasks() { cloudSyncs++; return { ok: true }; },
  async status() { return { connected: true, poolCount: mockCloudProducts.size, historyCount: mockCloudHistory.size, revision: 12 }; }
};
const initialGetWithCloud = await runner.handle({ type: 'categoryGet' });
assert.equal(initialGetWithCloud.cloudSync.connected, true);
assert.equal(initialGetWithCloud.cloudSync.poolCount, 1);
await runner.handle({ type: 'categoryStart', urls: 'https://www.ozon.ru/category/cloud-960/', targetCount: 5, minPrice: 10, confirmArchiveOverflow: true });
assert.equal(cloudRefreshes, 1, 'starting category batch refreshes cloud SKU cache');
batch = (await runner.handle({ type: 'categoryGet' })).batch;
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].url,
  observedSkus: ['96001', '96002', '96003'],
  products: [
    { sku: '96001', name: 'Cloud Pool Dup', link: 'https://www.ozon.ru/product/p-96001', price: '50', qualified: true, shippingRisk: { type: 'clear' } },
    { sku: '96002', name: 'Cloud History Dup', link: 'https://www.ozon.ru/product/p-96002', price: '50', qualified: true, shippingRisk: { type: 'clear' } },
    { sku: '96003', name: 'Cloud Fresh', link: 'https://www.ozon.ru/product/p-96003', price: '50', qualified: true, shippingRisk: { type: 'clear' } }
  ]
}, { tab: { id: batch.tabId, url: batch.stores[0].url } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[0].qualifiedCount, 1, 'cloud pool & history SKUs are excluded from qualified count');
assert.equal(batch.stores[0].diagnosticDecisions['96001'], 'pool_duplicate');
assert.equal(batch.stores[0].diagnosticDecisions['96002'], 'history_duplicate');
assert.equal(batch.stores[0].diagnosticDecisions['96003'], 'accepted');
await runner.handle({ type: 'categoryStop' });
const cloudSaved = await runner.handle({ type: 'categoryTaskProfileSave', name: '云同步任务', urls: ['https://www.ozon.ru/category/cloud-960/'], targetCount: 5, minPrice: 10 });
await runner.handle({ type: 'categoryTaskProfileDelete', taskId: cloudSaved.task.id });
const exportedTasks = await runner.exportTasksState();
assert.equal(exportedTasks.tasks.length, 0);
assert.ok(exportedTasks.deletedTasks[cloudSaved.task.id], 'deleting a task records tombstone');
assert.ok(cloudSyncs >= 2, 'task profile mutations notify cloud sync');
await runner.applyMergedTasksState({
  tasks: [{ id: 'task-merged-1', name: '远端同步任务', urls: ['https://www.ozon.ru/category/cloud-960/'], categoryLabels: {}, options: { targetCount: 5, minPrice: 10, maxPrice: null }, checkpoints: {}, priorQualifiedSkuIds: [], runCount: 1, totalQualifiedCount: 2, updatedAt: new Date().toISOString() }],
  deletedTasks: exportedTasks.deletedTasks
});
assert.equal((await runner.handle({ type: 'categoryGet' })).tasks[0].id, 'task-merged-1');
delete context.OzonWorkbenchCloud;

// V1.67: CNY page price prefiltering + memory_recycle tab replacement & limit protection
await runner.handle({
  type: 'categoryStart',
  urls: 'https://www.ozon.ru/category/cny-970/',
  targetCount: 3,
  minPrice: 100,
  pageMinCny: 100,
  pageMaxCny: 500,
  confirmArchiveOverflow: true
});
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[0].pageUrl, 'https://www.ozon.ru/category/cny-970/?currency_price=100.000%3B500.000');
assert.equal(batch.stores[0].pagePriceStatus, 'pending');
await runner.handle({
  type: 'categoryPageDone',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  complete: false,
  reason: 'price_currency_mismatch'
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'paused');
assert.match(batch.message, /人民币（¥）/);
await runner.handle({ type: 'categoryResume' });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
const tabBeforeRecycle = batch.tabId;
await runner.handle({
  type: 'categoryPageDone',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  complete: false,
  reason: 'memory_recycle'
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'running', 'memory_recycle rebuilds a fresh tab and keeps scanning');
assert.notEqual(batch.tabId, tabBeforeRecycle);
assert.equal(batch.stores[0].memoryRecycleCount, 1);
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  observedSkus: ['97001'],
  pagePriceConfirmed: true,
  products: []
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[0].memoryRecycleCount, 1, 'new observed SKU must not reset memoryRecycleCount');
for (let i = 0; i < 4; i++) {
  await runner.handle({
    type: 'categoryPageDone',
    batchId: batch.id,
    attemptId: batch.attemptId,
    categoryUrl: batch.stores[0].pageUrl,
    complete: false,
    reason: 'memory_recycle'
  }, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
  batch = (await runner.handle({ type: 'categoryGet' })).batch;
}
assert.equal(batch.stores[0].memoryRecycleCount, 5);
await runner.handle({
  type: 'categoryPageDone',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  complete: false,
  reason: 'memory_recycle'
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.status, 'paused', 'exceeding memory_recycle limit pauses safely');
assert.match(batch.message, /内存保护/);
await runner.handle({ type: 'categoryStop' });
// V1.68: Option A unified price filter (single-bound RUB post-review, two-bound RUB prefilter+review, and clearing on continuation)
await runner.handle({
  type: 'categoryStart',
  urls: 'https://www.ozon.ru/category/opt-a-980/',
  targetCount: 5,
  minPriceRub: 1300,
  maxPriceRub: null,
  fxRate: 12,
  confirmArchiveOverflow: true
});
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[0].pageUrl, 'https://www.ozon.ru/category/opt-a-980/', 'single-bound RUB does not add currency_price prefilter');
await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  observedSkus: ['98001', '98002'],
  products: [
    { sku: '98001', name: 'TooCheap', link: 'https://www.ozon.ru/product/p-98001', price: '900 ₽', qualified: true, shippingRisk: { type: 'clear' } },
    { sku: '98002', name: 'InRange', link: 'https://www.ozon.ru/product/p-98002', price: '1 500 ₽', qualified: true, shippingRisk: { type: 'clear' } }
  ]
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.stores[0].qualifiedCount, 1);
assert.equal(batch.stores[0].diagnosticDecisions['98001'], 'invalid_candidate');
assert.equal(batch.stores[0].diagnosticDecisions['98002'], 'accepted');
assert.equal(batch.results['category:980'].products['98001'], undefined);
assert.ok(batch.results['category:980'].products['98002']);
await runner.handle({ type: 'categoryStop' });
const optABatch = (await runner.handle({ type: 'categoryGet' })).batch;
await runner.handle({
  type: 'categoryContinueNextRound',
  batchId: optABatch.id,
  mode: 'resume_all',
  targetCount: 10,
  minPrice: 100,
  maxPrice: 500,
  minPriceRub: null,
  maxPriceRub: null,
  pageMinCny: 100,
  pageMaxCny: 500,
  pageMinRub: null,
  pageMaxRub: null,
  confirmArchiveOverflow: true
});
batch = (await runner.handle({ type: 'categoryGet' })).batch;
assert.equal(batch.options.minPriceRub, undefined, 'switching back to CNY clears minPriceRub');
assert.equal(batch.options.pageMinCny, 100);
assert.equal(batch.stores[0].pageUrl, 'https://www.ozon.ru/category/opt-a-980/?currency_price=100.000%3B500.000');
await runner.handle({ type: 'categoryStop' });

// V1.73: Category HUD summary & categorySkipCurrent while running.
const hudUrl1 = 'https://www.ozon.ru/category/hud-cat-1/';
const hudUrl2 = 'https://www.ozon.ru/category/hud-cat-2/';
batch = (await runner.handle({ type: 'categoryStart', urls: [hudUrl1, hudUrl2], targetCount: 15, confirmArchiveOverflow: true })).batch;
const hudSample = await runner.handle({
  type: 'categorySample',
  batchId: batch.id,
  attemptId: batch.attemptId,
  categoryUrl: batch.stores[0].pageUrl,
  observedSkus: ['77001'],
  products: [{ sku: '77001', name: 'HudItem', link: 'https://www.ozon.ru/product/p-77001', price: '120', qualified: true, shippingRisk: { type: 'clear' } }]
}, { tab: { id: batch.tabId, url: batch.stores[0].pageUrl } });
assert.equal(hudSample.ok, true);
assert.equal(hudSample.hud.version, '0.6.91');
assert.equal(hudSample.hud.categoryIndex, 1);
assert.equal(hudSample.hud.categoryTotal, 2);
assert.equal(hudSample.hud.qualified, 1);
assert.equal(hudSample.hud.targetCount, 15);
assert.equal(hudSample.hud.observed, 1);
const skipRes = await runner.handle({ type: 'categorySkipCurrent', batchId: batch.id });
assert.equal(skipRes.batch.stores[0].status, 'skipped');
assert.equal(skipRes.batch.currentIndex, 1);
assert.equal(skipRes.batch.status, 'running');
assert.equal(skipRes.hud.categoryIndex, 2);
const skipLast = await runner.handle({ type: 'categorySkipCurrent', batchId: batch.id });
assert.equal(skipLast.batch.status, 'completed');
assert.equal(skipLast.hud.status, 'completed');
console.log("category background runner tests passed");
