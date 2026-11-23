import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const data = {};
let created = [], reloads=0, sentMessages=[], nextTabId=71;
const storage = { async get(k) { return k ? { ...(data[k] ? { [k]: data[k] } : {}) } : { ...data }; }, async set(v) { Object.assign(data, v); } };
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
console.log("category background runner tests passed");
