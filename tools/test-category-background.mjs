import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const data = {}, sessionData={}, alarms=new Map();
let created = [], reloads=0, sentMessages=[], debuggerCommands=[], debuggerAttached=new Set(), debuggerDetachListener=null, nextTabId=71, nextWindowId=9, windowFocused=false, tickMode='running';
const storage = { async get(k) { return k ? { ...(data[k] ? { [k]: data[k] } : {}) } : { ...data }; }, async set(v) { Object.assign(data, v); }, async remove(k) { for (const key of Array.isArray(k) ? k : [k]) delete data[key]; } };
const chrome = {
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
  scripting: { async executeScript() {} },
};
const context = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, crypto:globalThis.crypto });
context.globalThis = context;
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
console.log("category background runner tests passed");
