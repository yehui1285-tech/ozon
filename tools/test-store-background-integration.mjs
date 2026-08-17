import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const storageData = {
  ozonStoreQualifiedProductsV1: {
    alpha: { observedSkus: ["1"], products: { "1": { sku: "1", competitor: "¥122.49", competitorReady: true } } },
    beta: { observedSkus: ["2"], products: { "2": { sku: "2" } } },
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
    async set(values) { Object.assign(data, values); },
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

const context = vm.createContext({ chrome, console, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, URL });
context.globalThis = context;
context.importScripts = (...files) => files.forEach((file) => {
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

console.log("Store background integration tests passed.");
