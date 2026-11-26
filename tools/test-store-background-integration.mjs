import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const storageData = {
  ozonStoreQualifiedProductsV1: {
    alpha: { observedSkus: ["1"], products: { "1": { sku: "1", competitor: "¥122.49", competitorReady: true } } },
    beta: { observedSkus: ["2"], products: { "2": { sku: "2" } } },
  },
};
let productPoolCommits = 0;
const poolFixture = {schemaVersion: 1, products: {}, history: {}};
function selectedPool(skus, stores = ["products", "history"]) {
  const selected = { schemaVersion: 1, products: {}, history: {} };
  for (const name of stores) {
    selected[name] = Object.fromEntries(skus.filter(sku => Object.hasOwn(poolFixture[name], sku)).map(sku => [sku, poolFixture[name][sku]]));
  }
  return selected;
}
const poolDBFixture = {
  async exportAll() { return structuredClone(poolFixture); },
  async lookup(skus) { return selectedPool(skus); },
  async change(skus, stores, apply) {
    const result = apply(selectedPool(skus, stores));
    for (const name of stores) Object.assign(poolFixture[name], result.state[name]);
    productPoolCommits++;
    return result;
  },
};
const scheduledTimers = new Map();
const alarmCreates = [];
const tabMessages = [];
let nextTimerId = 1;
const fakeSetTimeout = (callback, delay) => {
  const id = nextTimerId++;
  scheduledTimers.set(id, { callback, delay });
  return id;
};
const fakeClearTimeout = (id) => scheduledTimers.delete(id);

function storageArea(data) {
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
      return Object.fromEntries(list.filter((key) => Object.prototype.hasOwnProperty.call(data, key)).map((key) => [key, data[key]]));
    },
    async set(values) { assert.ok(!Object.hasOwn(values,"ozonProductPoolV1"), "legacy pool is read-only"); Object.assign(data, values); },
    async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]); },
  };
}

const listeners = { messages: [], updated: [], removed: [], alarms: [], startup: [], installed: [] };
const chrome = {
  storage: {
    local: storageArea(storageData),
    session: storageArea({}),
  },
  runtime: {
    getManifest: () => ({ version: "0.6.7" }),
    onMessage: { addListener: (listener) => listeners.messages.push(listener) },
    onStartup: { addListener: (listener) => listeners.startup.push(listener) },
    onInstalled: { addListener: (listener) => listeners.installed.push(listener) },
    getURL: (path) => `chrome-extension://test/${path}`,
  },
  tabs: {
    async get(id) { return { id, url: "https://www.ozon.ru/seller/alpha/", status: "complete", autoDiscardable: true }; },
    async update(id, update) { return { id, ...update }; },
    async create(create) { return { id: 9, ...create }; },
    async query() { return []; },
    async sendMessage(tabId, message) { tabMessages.push({ tabId, message }); return { ok: true }; },
    onUpdated: { addListener: (listener) => listeners.updated.push(listener), removeListener() {} },
    onRemoved: { addListener: (listener) => listeners.removed.push(listener), removeListener() {} },
  },
  alarms: {
    async create(name, info) { alarmCreates.push({ name, info }); },
    async clear() { return true; },
    onAlarm: { addListener: (listener) => listeners.alarms.push(listener) },
  },
  scripting: { async executeScript() {} },
};

const context = vm.createContext({ chrome, console, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, URL, crypto:globalThis.crypto });
context.globalThis = context;
context.importScripts = (...files) => files.forEach((file) => {
  if (file === "product-pool-idb.js") { context.OzonProductPoolDB = poolDBFixture; return; }
  const source = fs.readFileSync(new URL(`../ozon-erp-collector-extension/${file}`, import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: file });
});
const backgroundSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
vm.runInContext(backgroundSource, context, { filename: "background.js" });

const migratedKeys = await context.ensureStoreStorageMigrated();
assert.deepEqual([...migratedKeys], ["alpha", "beta"]);
assert.equal(storageData.ozonStoreQualifiedProductsV1, undefined);
assert.ok(storageData["ozonStoreQualifiedProductsV2:alpha"]);
assert.ok(storageData["ozonStoreQualifiedProductsV2:beta"]);

await context.writeStoreResult("alpha", {
  observedSkus: ["1", "3"],
  pendingLinks: [],
  products: { "1": { sku: "1", competitor: "", competitorReady: false }, "3": { sku: "3" } },
});
assert.equal(storageData["ozonStoreQualifiedProductsV2:alpha"].products["1"].competitor, "¥122.49");
assert.equal(storageData["ozonStoreQualifiedProductsV2:beta"].products["3"], undefined);

const attemptId = "batch-test:alpha:1";
storageData.ozonStoreBatchV1 = {
  id: "batch-test",
  revision: 0,
  status: "running",
  currentIndex: 0,
  tabId: 7,
  stores: [{ sellerKey: "alpha", status: "scanning", attemptId, attemptObservedSkus: [], observedCount: 1152, qualifiedCount: 1, pendingCount: 0 }],
};
await context.markBatchTabReloading(7);
assert.equal(storageData.ozonStoreBatchV1.stores[0].status, "recovering");
assert.equal(storageData.ozonStoreBatchV1.stores[0].needsRecovery, true);
assert.equal(storageData.ozonStoreBatchV1.stores[0].reloadCount, 1);
const batchTestAfterFirstReload = JSON.parse(JSON.stringify(storageData.ozonStoreBatchV1));

storageData.ozonStoreBatchV1 = {
  id: "batch-reload-loop",
  revision: 0,
  status: "running",
  currentIndex: 0,
  tabId: 7,
  stores: [
    { sellerKey: "alpha", url: "https://www.ozon.ru/seller/alpha/", status: "scanning", phase: "scanning", attemptId: "attempt-reload", attemptObservedSkus: [], observedCount: 12, qualifiedCount: 1, pendingCount: 0, reloadCount: 1 },
    { sellerKey: "beta", url: "https://www.ozon.ru/seller/beta/", status: "pending", phase: "pending", attemptId: "", attemptObservedSkus: [], observedCount: 0, qualifiedCount: 0, pendingCount: 0, reloadCount: 0 },
  ],
};
await context.markBatchTabReloading(7);
assert.equal(storageData.ozonStoreBatchV1.stores[0].status, "skipped");
assert.equal(storageData.ozonStoreBatchV1.stores[0].phase, "skipped");
assert.equal(storageData.ozonStoreBatchV1.stores[0].reloadCount, 2);
assert.match(storageData.ozonStoreBatchV1.stores[0].note, /页面连续刷新2次/);
assert.equal(storageData.ozonStoreBatchV1.currentIndex, 1);
assert.ok(storageData.ozonStoreBatchV1.nextRunAt >= Date.now() + 7900);

storageData.ozonStoreBatchV1 = batchTestAfterFirstReload;
storageData.ozonStoreBatchV1.stores[0].status = "scanning";
const firstRunSkus = Array.from({ length: 500 }, (_, index) => String(index + 1));
await context.updateBatchProgress({
  batchId: "batch-test",
  attemptId,
  sellerKey: "alpha",
  observedCount: 1152,
  attemptObservedSkuDelta: firstRunSkus,
  qualifiedCount: 1,
  pendingCount: 0,
}, { tab: { id: 7 } });
assert.equal(storageData.ozonStoreBatchV1.stores[0].status, "scanning");
assert.equal(storageData.ozonStoreBatchV1.stores[0].runObservedCount, 500);

const fullRunSkus = Array.from({ length: 1000 }, (_, index) => String(index + 1));
await context.updateBatchProgress({
  batchId: "batch-test",
  attemptId,
  sellerKey: "alpha",
  observedCount: 1152,
  attemptObservedSkuDelta: fullRunSkus.slice(500),
  qualifiedCount: 1,
  pendingCount: 0,
}, { tab: { id: 7 } });
assert.equal(storageData.ozonStoreBatchV1.status, "completed");
assert.match(storageData.ozonStoreBatchV1.stores[0].note, /本轮已查看1000个/);

storageData.ozonStoreBatchV1 = {
  id: "batch-zero-match",
  revision: 0,
  status: "running",
  currentIndex: 0,
  tabId: 7,
  stores: [
    { sellerKey: "alpha", url: "https://www.ozon.ru/seller/alpha/", status: "scanning", phase: "scanning", attempts: 1, attemptId: "attempt-zero", attemptObservedSkus: [], observedCount: 0, qualifiedCount: 0, pendingCount: 0 },
    { sellerKey: "beta", url: "https://www.ozon.ru/seller/beta/", status: "pending", phase: "pending", attempts: 0, attemptId: "", attemptObservedSkus: [], observedCount: 0, qualifiedCount: 0, pendingCount: 0 },
  ],
};
const zeroMatchSkus = Array.from({ length: 500 }, (_, index) => `zero-${index + 1}`);
const zeroMatchResult = await context.updateBatchProgress({
  batchId: "batch-zero-match",
  attemptId: "attempt-zero",
  sellerKey: "alpha",
  observedCount: 500,
  attemptObservedSkuDelta: zeroMatchSkus,
  qualifiedCount: 0,
  pendingCount: 0,
}, { tab: { id: 7 } });
assert.equal(zeroMatchResult.autoSkipped, true);
assert.equal(storageData.ozonStoreBatchV1.currentIndex, 1);
assert.equal(storageData.ozonStoreBatchV1.stores[0].status, "skipped");
assert.equal(storageData.ozonStoreBatchV1.stores[0].phase, "skipped");
assert.match(storageData.ozonStoreBatchV1.stores[0].note, /本轮已查看500个，符合要求0个/);
assert.ok(storageData.ozonStoreBatchV1.nextRunAt >= Date.now() + 7900);

storageData.ozonStoreBatchV1 = {
  id: "batch-race",
  revision: 0,
  status: "running",
  currentIndex: 0,
  tabId: 7,
  stores: [
    { sellerKey: "alpha", url: "https://www.ozon.ru/seller/alpha/", status: "scanning", attempts: 1, attemptId: "attempt-alpha", attemptObservedSkus: [], observedCount: 10, qualifiedCount: 1, pendingCount: 0 },
    { sellerKey: "beta", url: "https://www.ozon.ru/seller/beta/", status: "pending", attempts: 0, attemptId: "", attemptObservedSkus: [], observedCount: 0, qualifiedCount: 0, pendingCount: 0 },
  ],
};
const removedFirst = context.batchOperation(() => context.removeStoreBatchTask({ batchId: "batch-race", sellerKey: "alpha" }));
const staleProgressSecond = context.batchOperation(() => context.updateBatchProgress({
  batchId: "batch-race",
  attemptId: "attempt-alpha",
  sellerKey: "alpha",
  observedCount: 11,
  attemptObservedSkuDelta: ["11"],
  qualifiedCount: 1,
  pendingCount: 0,
}, { tab: { id: 7 } }));
await Promise.all([removedFirst, staleProgressSecond]);
assert.deepEqual(storageData.ozonStoreBatchV1.stores.map((task) => task.sellerKey), ["beta"]);
assert.equal(storageData.ozonStoreBatchV1.currentIndex, 0);
assert.ok(storageData.ozonStoreBatchV1.nextRunAt >= Date.now() + 7900);
assert.ok(tabMessages.some(({ message }) => message.type === "armBatchCooldown" && message.batchId === "batch-race"));
assert.ok(alarmCreates.some(({ name, info }) => name === "ozonStoreBatchNext" && info.when >= Date.now() + 29000));

const earlyWake = await context.continueBatchAfterCooldown({ batchId: "batch-race", dueAt: storageData.ozonStoreBatchV1.nextRunAt, source: "early-test" });
assert.equal(earlyWake.early, true);
assert.equal(storageData.ozonStoreBatchV1.stores[0].status, "pending");
storageData.ozonStoreBatchV1.nextRunAt = Date.now() - 1;
await context.continueBatchAfterCooldown({ batchId: "batch-race", dueAt: storageData.ozonStoreBatchV1.nextRunAt, source: "test" });
assert.equal(storageData.ozonStoreBatchV1.nextRunAt, 0);
assert.equal(storageData.ozonStoreBatchV1.stores[0].status, "loading");
assert.equal(storageData.ozonStoreBatchV1.stores[0].attempts, 1);
await context.continueBatchAfterCooldown({ batchId: "batch-race", source: "duplicate-test" });
assert.equal(storageData.ozonStoreBatchV1.stores[0].attempts, 1);

const alphaStoreBeforeClear = JSON.stringify(storageData["ozonStoreQualifiedProductsV2:alpha"]);
const betaStoreBeforeClear = JSON.stringify(storageData["ozonStoreQualifiedProductsV2:beta"]);
const clearResult = await context.batchOperation(() => context.clearStoreBatch({ batchId: "batch-race" }));
assert.equal(clearResult.cleared, true);
assert.equal(clearResult.batch, null);
assert.equal(storageData.ozonStoreBatchV1, undefined);
assert.equal(JSON.stringify(storageData["ozonStoreQualifiedProductsV2:alpha"]), alphaStoreBeforeClear);
assert.equal(JSON.stringify(storageData["ozonStoreQualifiedProductsV2:beta"]), betaStoreBeforeClear);
assert.ok(tabMessages.some(({ tabId, message }) => tabId === 7 && message.type === "stopStoreScan" && message.silent === true));
const lateProgressAfterClear = await context.updateBatchProgress({
  batchId: "batch-race",
  attemptId: "attempt-alpha",
  sellerKey: "alpha",
  observedCount: 12,
  attemptObservedSkuDelta: ["12"],
  qualifiedCount: 1,
  pendingCount: 0,
}, { tab: { id: 7 } });
assert.equal(lateProgressAfterClear.ok, false);
const clearEmptyResult = await context.clearStoreBatch({});
assert.equal(clearEmptyResult.cleared, false);

// Two stores: historical records must not be attributed to a new batch.
for (const sellerKey of ["alpha", "beta"]) {
  await context.writeStoreResult(sellerKey, { products: { [sellerKey + "-old"]: { sku: sellerKey + "-old" } } }, "replace");
}
const urls = ["https://www.ozon.ru/seller/alpha/", "https://www.ozon.ru/seller/beta/"];
await context.startStoreBatch({ urls, clearExisting: true });
const batchId = (await context.getBatch()).id;
async function handoff() {
  const batch = await context.getBatch();
  const { stores } = await context.getBatchStoreResults({ sellerKeys: ["alpha", "beta"] });
  return context.OzonStoreScannerCore.buildManualSourcingCsv({ batch, stores });
}
async function capture(sellerKey, sku) {
  const state = (await context.getStoreScanState({ sellerKey })).state || {};
  await context.saveStoreScanState({ sellerKey, state: {
    ...state, products: { ...state.products, [sku]: { sku, name: "无人机" } },
    batchCapture: { batchId, skus: [sku] },
  } });
}
await capture("alpha", "alpha-new");
const staleAlphaSnapshot = (await context.getStoreScanState({ sellerKey: "alpha" })).state;
await context.setStoreProductShippingDecision({ sellerKey: "alpha", sku: "alpha-new", decision: "allowed" });
await context.saveStoreScanState({ sellerKey: "alpha", state: staleAlphaSnapshot });
await context.pauseStoreBatch();
await context.resumeStoreBatch();
assert.equal((await context.getStoreScanState({ sellerKey: "alpha" })).state?.products?.["alpha-new"]?.shippingReviewDecision, "allowed", "first-attempt pause/resume must preserve the saved product and review");
assert.match(await handoff(), /"alpha-new"/);
assert.doesNotMatch(await handoff(), /"beta-old"/, "waiting store's historical capture must not enter the current batch");
const beforeRetry = await context.getBatch();
beforeRetry.stores[0].status = "partial";
beforeRetry.status = "paused";
await context.saveBatch(beforeRetry);
await context.retryFailedBatchStores();
assert.match(await handoff(), /"alpha-new"/, "explicit retry must retain saved product and batch membership");
const finishing = await context.getBatch();
await context.finishBatchStore({ batchId, attemptId: finishing.stores[0].attemptId, sellerKey: "alpha", complete: true, observedCount: 1, qualifiedCount: 1 }, { tab: { id: finishing.tabId } });
storageData.ozonStoreBatchV1.nextRunAt = Date.now() - 1;
await context.continueBatchAfterCooldown({ batchId, dueAt: storageData.ozonStoreBatchV1.nextRunAt });
await capture("beta", "beta-new");
await context.setStoreProductShippingDecision({ sellerKey: "beta", sku: "beta-new", decision: "allowed" });
const finalHandoff = await handoff();
assert.match(finalHandoff, /"alpha-new"/);
assert.match(finalHandoff, /"beta-new"/);
assert.doesNotMatch(finalHandoff, /"alpha-old"|"beta-old"/);
assert.equal(finalHandoff.split("\r\n").length, 3);

// A preserved historical SKU is eligible only once actually found in the new batch.
await context.clearStoreBatch({ batchId });
const preservedBatch = await context.startStoreBatch({ urls, clearExisting: false });
const preservedId = preservedBatch.batch.id;
assert.equal((await handoff()).split("\r\n").length, 1);
const priorAlpha = (await context.getStoreScanState({ sellerKey: "alpha" })).state;
assert.ok(priorAlpha.products["alpha-new"]);
await context.saveStoreScanState({ sellerKey: "alpha", state: {
  ...priorAlpha, batchCapture: { batchId: preservedId, skus: ["alpha-new"] },
} });
assert.match(await handoff(), /"alpha-new"/);
assert.doesNotMatch(await handoff(), /"beta-new"/);
await context.saveStoreScanState({ sellerKey: "alpha", state: priorAlpha });
assert.match(await handoff(), /"alpha-new"/, "late snapshots from a preceding batch must not replace current membership");

// Local pool survives clearing a batch and excludes the waiting store's historical rows.
const poolBatch = await context.getBatch();
await context.saveStoreScanState({ sellerKey: "alpha", state: {
  products: { "111": { sku: "111", name: "工具", price: "120", link: "https://www.ozon.ru/product/test-111/" } },
  batchCapture: { batchId: poolBatch.id, skus: ["111"] },
} });
const pooled = await context.addBatchToProductPool({ batchId: poolBatch.id });
assert.equal(pooled.added, 1);
await context.clearStoreBatch({ batchId: poolBatch.id });
assert.deepEqual(Object.keys((await context.getProductPool()).pool.products), ["111"]);
const initial=(await context.getProductPool()).pool.products['111'];
poolFixture.products['222']={...initial,sku:'222',status:'new',notes:'第二件'};
const poolMessage=message=>new Promise(resolve=>{for(const listener of listeners.messages){if(listener(message,{},resolve)===true)return}resolve({ok:false,error:'no listener'})});
const expected={status:initial.status,notes:initial.notes,blocked:initial.blocked};
const confirmed=await poolMessage({type:'updateProductPoolItem',sku:'111',patch:{status:'review',notes:'人工记录'},expected});
assert.equal(confirmed.ok,true);
const conflicting=await poolMessage({type:'updateProductPoolItem',sku:'111',patch:{status:'approved',notes:initial.notes},expected});
assert.equal(conflicting.ok,false);
assert.equal((await context.getProductPool()).pool.products['111'].notes,'人工记录');
const batchPool=(await context.getProductPool()).pool;
const batchExpected=context.OzonProductPoolCore.productExpectation(batchPool.products['111']);
const secondExpected=context.OzonProductPoolCore.productExpectation(batchPool.products['222']);
const commitsBeforeBulk=productPoolCommits;
const bulk=await poolMessage({type:'updateProductPoolItems',changes:[{sku:'111',patch:{status:'rejected',notes:'淘汰备注保留'},expected:batchExpected},{sku:'222',patch:{status:'sourcing',notes:'第二件已保存'},expected:secondExpected}]});
assert.equal(bulk.ok,true);
assert.equal(productPoolCommits-commitsBeforeBulk,1,'a batch must use a single pool transaction');
assert.equal(bulk.state.products['111'].status,'rejected');
assert.equal(bulk.state.products['111'].notes,'淘汰备注保留');
assert.equal(bulk.state.products['222'].status,'sourcing');
assert.equal(bulk.state.products['222'].notes,'第二件已保存');
const bulkBefore=JSON.stringify((await context.getProductPool()).pool);
const afterBulk=(await context.getProductPool()).pool;
const bulkConflict=await poolMessage({type:'updateProductPoolItems',changes:[{sku:'111',patch:{status:'review',notes:'覆盖'},expected:context.OzonProductPoolCore.productExpectation(afterBulk.products['111'])},{sku:'222',patch:{status:'review',notes:'覆盖第二件'},expected:secondExpected}]});
assert.equal(bulkConflict.ok,false);
assert.equal(JSON.stringify((await context.getProductPool()).pool),bulkBefore,'a rejected batch must not partially write');

// Category and shop batches remain independent through the actual background message dispatcher.
const categoryUi={url:'chrome-extension://test/category.html'};
const categoryRequest=(message,sender=categoryUi)=>new Promise(resolve=>{for(const listener of listeners.messages)if(listener(message,sender,resolve)===true)return;resolve({ok:false,error:'no listener'})});
const categoryUrl='https://www.ozon.ru/category/tools-1234/';
const started=await categoryRequest({type:'categoryStart',urls:[categoryUrl],targetCount:1});
assert.equal(started.ok,true);assert.match(started.batch.id,/^category-[a-f0-9-]{36}$/);
assert.equal((await categoryRequest({type:'categoryPause'},{url:'https://www.ozon.ru/category/tools-1234/'})).ok,false);
await assert.rejects(()=>context.startStoreBatch({urls:['https://www.ozon.ru/seller/alpha/']}),/类目选品/);
const sample={type:'categorySample',batchId:started.batch.id,attemptId:started.batch.attemptId,categoryUrl,categoryName:'工具',observedSkus:['555'],products:[{sku:'555',name:'工具',qualified:true,price:'90,00',link:'https://www.ozon.ru/product/tool-555/',shippingRisk:{type:'clear'}}]};
assert.equal((await categoryRequest(sample,{tab:{id:999,url:categoryUrl}})).ok,false);
const scanned=await categoryRequest(sample,{tab:{id:started.batch.tabId,url:categoryUrl}});assert.equal(scanned.stop,true);assert.equal(scanned.batch.status,'completed');
const diagnosisDenied=await categoryRequest({type:'categoryDiagnostic',batchId:started.batch.id},{url:categoryUrl});assert.equal(diagnosisDenied.ok,false);
const diagnosis=await categoryRequest({type:'categoryDiagnostic',batchId:started.batch.id});assert.equal(diagnosis.ok,true);assert.equal(diagnosis.diagnostic.batchId,started.batch.id);assert.equal(diagnosis.diagnostic.counters.acceptedCount,1);assert.equal(diagnosis.diagnostic.tasks[0].counts.accepted,1);assert.equal(Object.hasOwn(diagnosis.diagnostic,'results'),false);
const addedCategory=await categoryRequest({type:'categoryAddPool',batchId:started.batch.id});assert.equal(addedCategory.ok,true);assert.equal(addedCategory.added,1);
const categoryItem=(await context.getProductPool()).pool.products['555'];assert.equal(categoryItem.sourceMode,'category');assert.equal(categoryItem.storeName,'类目 · 工具');
assert.equal((await categoryRequest({type:'categoryExport',batchId:started.batch.id})).csv.includes(categoryUrl),true);
const uploads=[];context.wbRequest=async(_token,body)=>{uploads.push(body);return {ok:true,count:1}};
storageData.ozonWorkbenchSettingsV1={token:'a'.repeat(64),auto:true};
const sync=await context.wbSyncCategory(true);assert.equal(sync.ok,true);assert.equal(sync.count,1);assert.equal(uploads.length,1);assert.equal(uploads[0].action,'batch');assert.equal(uploads[0].batch.id,started.batch.id);assert.equal(uploads[0].batch.status,'completed');assert.match(uploads[0].batch.csv,/类目 · 工具/);
await context.wbSyncCategory(false);assert.equal(uploads.length,1,'unchanged category batch must not be repeatedly uploaded');
delete storageData.ozonWorkbenchSettingsV1;

// Resuming an individual card in a stopped category batch must use the same
// mutual exclusion and trusted management-page checks as the normal resume.
const cardStart=await categoryRequest({type:'categoryStart',urls:[categoryUrl,'https://www.ozon.ru/category/tools-1235/'],targetCount:2});
assert.equal(cardStart.ok,true);
const cardSample={...sample,batchId:cardStart.batch.id,attemptId:cardStart.batch.attemptId,observedSkus:['559'],products:[{...sample.products[0],sku:'559',link:'https://www.ozon.ru/product/tool-559/'}]};
assert.equal((await categoryRequest(cardSample,{tab:{id:cardStart.batch.tabId,url:categoryUrl}})).batch.stores[0].qualifiedCount,1);
await categoryRequest({type:'categoryStop',batchId:cardStart.batch.id});
const removedCard=await categoryRequest({type:'categoryTaskRemove',batchId:cardStart.batch.id,sellerKey:cardStart.batch.stores[0].sellerKey});
assert.equal(removedCard.ok,true);
assert.equal(removedCard.batch.stores[0].removedFromQueue,true);
assert.equal(removedCard.batch.stores[0].qualifiedCount,1);
assert.match((await categoryRequest({type:'categoryExport',batchId:cardStart.batch.id})).csv,/559/);
const resumeCard={type:'categoryTaskResume',batchId:cardStart.batch.id,sellerKey:cardStart.batch.stores[1].sellerKey};
assert.equal((await categoryRequest(resumeCard,{url:categoryUrl})).ok,false);
await context.startStoreBatch({urls:['https://www.ozon.ru/seller/alpha/']});
const blockedCard=await categoryRequest(resumeCard);
assert.equal(blockedCard.ok,false);
assert.match(blockedCard.error,/已有店铺扫描任务/);
await context.stopStoreBatch();
const resumedCard=await categoryRequest(resumeCard);
assert.equal(resumedCard.ok,true);
assert.equal(resumedCard.batch.currentIndex,1);
assert.equal(resumedCard.batch.status,'running');
await categoryRequest({type:'categoryStop',batchId:cardStart.batch.id});
console.log("Store and category background integration tests passed.");
