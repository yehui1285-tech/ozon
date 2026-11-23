import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const data = {};
let created = [], reloads=0, sentMessages=[], nextTabId=71;
const storage = { async get(k) { return k ? { ...(data[k] ? { [k]: data[k] } : {}) } : { ...data }; }, async set(v) { Object.assign(data, v); }, async remove(k) { for (const key of Array.isArray(k) ? k : [k]) delete data[key]; } };
const chrome = {
  storage: { local: storage },
  tabs: {
    async create(o) { const t = { id: nextTabId++, ...o }; created.push(t); return t; },
    async get(id) { return { id, url: created.find(x => x.id === id)?.url || "" }; },
    async update(id, o) { Object.assign(created.find(x => x.id === id), o); return { id, ...o }; },
    async remove(id) { created = created.filter(x => x.id !== id); },
    async reload() { reloads++; },
    async sendMessage(id,message) { sentMessages.push({id,message});return { ok: true }; },
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
const done = await runner.handle({ type: "categorySample", batchId: batch.id, attemptId, categoryUrl: batch.stores[0].url, observedSkus: ["11", "12", "13"], products: [
  { sku: "11", name: "A", link: "https://www.ozon.ru/product/a-11", price: "20", qualified: true, shippingRisk: { type: "clear" } },
  { sku: "12", name: "B", link: "https://www.ozon.ru/product/b-12", price: "30", qualified: true, shippingRisk: { type: "clear" } },
  { sku: "13", name: "blocked", link: "https://www.ozon.ru/product/c-13", price: "30", qualified: true, shippingRisk: { type: "suspected_prohibited" } },
 ] }, { tab: { id: batch.tabId, url: batch.stores[0].url } });
assert.equal(done.stop, false);
batch = (await runner.handle({ type: "categoryGet" })).batch;
assert.equal(batch.stores[0].qualifiedCount, 2);
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
console.log("category background runner tests passed");
