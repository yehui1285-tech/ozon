import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.version, "0.6.30");
const popupHtml = fs.readFileSync(new URL("../ozon-erp-collector-extension/popup.html", import.meta.url), "utf8");
const enrichmentHtml = fs.readFileSync(new URL("../ozon-erp-collector-extension/sourcing-enrichment.html", import.meta.url), "utf8");
const popupVersion = popupHtml.match(/<span class="version">\s*v([0-9.]+)\s*<\/span>/i)?.[1];
const enrichmentVersion = enrichmentHtml.match(/class="version">[^<]*\bv([0-9.]+)/i)?.[1];
assert.equal(popupVersion, manifest.version, "toolbar popup must display the installed manifest version");
assert.equal(enrichmentVersion, manifest.version, "sourcing page must display the installed manifest version");
assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
assert.ok(manifest.host_permissions.includes("https://*.ozone.ru/*"));
assert.ok(manifest.host_permissions.includes("https://*.alicdn.com/*"));
const content = manifest.content_scripts.find((entry) => entry.matches.includes("https://*.1688.com/*"));
assert.deepEqual(content.js, ["1688-core.js", "1688-content.js"]);

const background = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
assert.match(background, /importScripts\("1688-core\.js", "1688-background\.js"\)/);
assert.match(background, /start1688SourcingJob/);
assert.match(background, /get1688SourcingJob/);
assert.match(background, /cancel1688SourcingJob/);

const bridgeSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/pinduoduo-bridge.js", import.meta.url), "utf8");
assert.match(bridgeSource, /OZON_SOURCING_EXTENSION_REQUEST_V1/);
assert.match(bridgeSource, /start_1688_job/);
assert.match(bridgeSource, /get_1688_job/);
assert.match(bridgeSource, /cancel_1688_job/);

function createBridge({ runtimeResult = { ok: true, status: "queued" }, runtimeError = null, deferRuntime = false, runtimeMode = "callback", runtimeThrow = null, runtimeImpl = null } = {}) {
  const listeners = [];
  const posts = [];
  const runtimeMessages = [];
  let timeoutCallback = null;
  let runtimeCallback = null;
  const fakeWindow = {
    addEventListener(type, listener) { if (type === "message") listeners.push(listener); },
    postMessage(data, targetOrigin) { posts.push({ data, targetOrigin }); },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "test" }),
      lastError: null,
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        if (runtimeThrow) throw new Error(runtimeThrow);
        if (runtimeImpl) return runtimeImpl(message, callback);
        if (runtimeMode === "promise") return runtimeError ? Promise.reject(runtimeError) : Promise.resolve(runtimeResult);
        if (!deferRuntime) {
          chrome.runtime.lastError = runtimeError;
          callback(runtimeError ? undefined : runtimeResult);
          chrome.runtime.lastError = null;
        } else {
          runtimeCallback = callback;
        }
      },
    },
  };
  const context = vm.createContext({ window: fakeWindow, chrome, console, URL, setTimeout: (callback) => { timeoutCallback = callback; return 1; }, clearTimeout: () => {} });
  context.globalThis = context;
  vm.runInContext(bridgeSource, context, { filename: "pinduoduo-bridge.js" });
  const windowMessageListener = listeners[0];
  const postBridgeMessage = (data, { source = fakeWindow, origin = "http://127.0.0.1:17628" } = {}) => windowMessageListener({ source, origin, data });
  return { fakeWindow, runtimeMessages, posts, postBridgeMessage, fireTimeout: () => timeoutCallback?.(), finishRuntime: (result = runtimeResult) => runtimeCallback?.(result) };
}

const validBridge = createBridge();
validBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "request-123", taskId: "ozon-1", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" });
assert.equal(validBridge.runtimeMessages.at(-1).type, "start1688SourcingJob");
assert.equal(validBridge.runtimeMessages.at(-1).request.requestId, "request-123");
assert.deepEqual(JSON.parse(JSON.stringify(validBridge.runtimeMessages.at(-1).request.strategy)), { type: "image", sourceUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" });
assert.equal(validBridge.posts.at(-1).data.requestId, "request-123");

const realBackgroundBridge = createBridge({ runtimeResult: { jobId: "1688-request-126", status: "queued", phase: "queued" } });
realBackgroundBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "request-126", taskId: "ozon-1", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" });
assert.equal(realBackgroundBridge.posts.at(-1).data.ok, true, "a successful background job record must cross the page bridge as an explicit success");
assert.equal(realBackgroundBridge.posts.at(-1).data.jobId, "1688-request-126");

const explicitFailureBridge = createBridge({ runtimeResult: { ok: false, error: "已有一个 1688 找品任务正在运行。" } });
explicitFailureBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "request-127", taskId: "ozon-1", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" });
assert.equal(explicitFailureBridge.posts.at(-1).data.ok, false, "an explicit background failure must not be converted to success");
assert.equal(explicitFailureBridge.posts.at(-1).data.error, "已有一个 1688 找品任务正在运行。");
const countAfterValid = validBridge.runtimeMessages.length;
validBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "request-124", taskId: "ozon-1", mainImageUrl: "https://evil.example/a.jpg", strategy: { type: "image" } });
validBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "launch_pinduoduo", requestId: "request-125" });
assert.equal(validBridge.runtimeMessages.length, countAfterValid);
assert.equal(validBridge.posts.at(-1).data.ok, false);
assert.equal(validBridge.posts.at(-1).data.requestId, "request-125");

for (const [strategy, expected] of [
  [{ type: "image", sourceUrl: "https://evil.example/a.jpg" }, { type: "image", sourceUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" }],
  [{ type: "keyword", query: "蓝色女装" }, { type: "keyword", query: "蓝色女装", sourceUrl: "" }],
  [{ type: "similar_supplier", query: "同款", sourceUrl: "https://img.alicdn.com/a.jpg" }, { type: "similar_supplier", query: "同款", sourceUrl: "https://img.alicdn.com/a.jpg" }],
  [{ type: "verify_sku", sourceUrl: "https://detail.1688.com/offer/123456.html", optionId: "red", expectedPrice: 10 }, { type: "verify_sku", query: "", sourceUrl: "https://detail.1688.com/offer/123456.html", optionId: "red", optionLabel: "", expectedPrice: 10 }],
]) {
  const bridge = createBridge();
  bridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "strategy-" + strategy.type.replaceAll("_", "-"), taskId: "ozon-2", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg", strategy });
  assert.ok(bridge.runtimeMessages.at(-1), strategy.type);
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.runtimeMessages.at(-1).request.strategy)), expected);
}
for (const strategy of [
  {}, [], "image", null, { type: "image", sourceUrl: "https://ir.ozone.ru/a.jpg", extra: 1 }, { type: "keyword", query: "" }, { type: "keyword", query: "x\u0000" }, { type: "similar_supplier", query: "x\u0000", sourceUrl: "https://img.alicdn.com/a.jpg" }, { type: "similar_supplier", query: "x".repeat(100000), sourceUrl: "https://img.alicdn.com/a.jpg" }, { type: "similar_supplier", sourceUrl: "https://user:pass@img.alicdn.com/a.jpg" }, { type: "verify_sku", query: "x\u0000", sourceUrl: "https://detail.1688.com/offer/abc.html", optionId: "red" }, { type: "verify_sku", sourceUrl: "https://detail.1688.com/offer/abc.html", optionId: "red" }, { type: "verify_sku", sourceUrl: "https://detail.1688.com/offer/123.html", optionId: "" }, { type: "verify_sku", sourceUrl: "https://detail.1688.com/offer/123.html", optionId: "red", expectedPrice: -1 },
]) {
  const bridge = createBridge();
  bridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "bad-strategy", taskId: "ozon-2", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg", strategy });
  assert.equal(bridge.runtimeMessages.length, 0, JSON.stringify(strategy));
  assert.equal(bridge.posts.at(-1).data.type, "OZON_SOURCING_EXTENSION_RESPONSE_V1");
  assert.equal(bridge.posts.at(-1).data.ok, false);
}
for (const mainImageUrl of ["https://ozone.ru:443/a.jpg", "https://user:pass@ir.ozone.ru/a.jpg", "https://ir.ozone.ru:443/a.jpg", "https://ir.ozone.ru/" + "a".repeat(2050)]) {
  const bridge = createBridge();
  bridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "bad-image", taskId: "ozon-2", mainImageUrl, strategy: { type: "image" } });
  assert.equal(bridge.runtimeMessages.length, 0);
}

const rejectedBridge = createBridge();
rejectedBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-126" });
rejectedBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "cancel_1688_job", requestId: "request-127", jobId: "bad id" });
rejectedBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-128", jobId: "1688-job" }, { origin: "http://localhost:17628" });
rejectedBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-129", jobId: "1688-job" }, { source: {} });
assert.equal(rejectedBridge.runtimeMessages.length, 0);

const runtimeFailure = createBridge({ runtimeError: { message: "后台不可用" } });
runtimeFailure.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-130", jobId: "1688-job" });
assert.deepEqual(JSON.parse(JSON.stringify(runtimeFailure.posts.at(-1).data)), { type: "OZON_SOURCING_EXTENSION_RESPONSE_V1", requestId: "request-130", ok: false, error: "后台不可用" });

const promiseSuccess = createBridge({ runtimeMode: "promise", runtimeResult: { ok: true, jobId: "1688-job", type: "evil", requestId: "evil" } });
promiseSuccess.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-132", jobId: "1688-job" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(promiseSuccess.posts.at(-1).data.type, "OZON_SOURCING_EXTENSION_RESPONSE_V1");
assert.equal(promiseSuccess.posts.at(-1).data.requestId, "request-132");
const promiseFailure = createBridge({ runtimeMode: "promise", runtimeError: { message: "promise failed" } });
promiseFailure.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-133", jobId: "1688-job" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(JSON.parse(JSON.stringify(promiseFailure.posts.at(-1).data)), { type: "OZON_SOURCING_EXTENSION_RESPONSE_V1", requestId: "request-133", ok: false, error: "promise failed" });
const syncThrowBridge = createBridge({ runtimeThrow: "sync failed" });
syncThrowBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "get_1688_job", requestId: "request-134", jobId: "1688-job" });
assert.equal(syncThrowBridge.posts.at(-1).data.error, "sync failed");

const timeoutBridge = createBridge({ deferRuntime: true });
timeoutBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "cancel_1688_job", requestId: "request-131", jobId: "1688-job" });
assert.equal(timeoutBridge.runtimeMessages.at(-1).type, "cancel1688SourcingJob");
timeoutBridge.fireTimeout();
assert.deepEqual(JSON.parse(JSON.stringify(timeoutBridge.posts.at(-1).data)), { type: "OZON_SOURCING_EXTENSION_RESPONSE_V1", requestId: "request-131", ok: false, error: "扩展后台响应超时" });
timeoutBridge.finishRuntime({ ok: true, requestId: "spoofed" });
assert.equal(timeoutBridge.posts.length, 1);

const coreSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-core.js", import.meta.url), "utf8");
const driverSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-background.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-content.js", import.meta.url), "utf8");
const searchFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-search-snapshot.json", import.meta.url), "utf8"));
const detailFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-detail-snapshot.json", import.meta.url), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));

function storageArea(data, calls) {
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
      return Object.fromEntries(list.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    async set(values) { calls.push({ storageSet: values }); Object.assign(data, JSON.parse(JSON.stringify(values))); },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      calls.push({ storageRemove: list });
      for (const key of list) delete data[key];
    },
  };
}

function response({ ok = true, contentType = "image/jpeg", bytes = new Uint8Array([1, 2, 3]).buffer, json = {}, url = "" } = {}) {
  return {
    ok,
    url,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null },
    async arrayBuffer() { return bytes; },
    async json() { return json; },
  };
}

function createDriver({ probe = searchFixture, search = searchFixture, detail = detailFixture, imageResponse, commandDelay = null, commandDelayMs = 5, captureDataUrl = "data:image/jpeg;base64,AQID", storageSeed = null, sessionSeed = null, browserState = null, existingTabs = null, taskTabActive = true, fetchDelay = 0, createDelay = 0, removeDelay = 0 } = {}) {
  const storageData = storageSeed || {};
  const calls = [];
  const browser = browserState || { nextTabId: 100, tabs: new Map() };
  if (!browser.tabs) browser.tabs = new Map();
  if (!Number.isInteger(browser.nextTabId)) browser.nextTabId = 100;
  for (const [rawTabId, tab] of Object.entries(existingTabs || {})) {
    const tabId = Number(rawTabId);
    browser.tabs.set(tabId, { id: tabId, windowId: 1, status: "complete", ...tab });
  }
  const listeners = { messages: [] };
  let searchReadCount = 0;
  const chrome = {
    storage: {
      local: storageArea(storageData, calls),
      ...(sessionSeed ? { session: storageArea(sessionSeed, calls) } : {}),
    },
    runtime: { onMessage: { addListener: (listener) => listeners.messages.push(listener) } },
    tabs: {
      async query() { return []; },
      async create(args) {
        const tab = { id: browser.nextTabId++, windowId: 1, status: "complete", ...args };
        browser.tabs.set(tab.id, tab);
        calls.push({ create: args });
        if (createDelay) await new Promise((resolve) => setTimeout(resolve, createDelay));
        return { ...tab };
      },
      async update(tabId, args) {
        const previous = browser.tabs.get(tabId);
        if (!previous) throw new Error(`Tab ${tabId} does not exist`);
        const tab = { ...previous, ...args, url: args.url || previous.url };
        browser.tabs.set(tabId, tab);
        calls.push({ update: { tabId, args } });
        return { ...tab };
      },
      async get(tabId) {
        const tab = browser.tabs.get(tabId);
        if (!tab) throw new Error(`Tab ${tabId} does not exist`);
        return { ...tab, active: taskTabActive };
      },
      async remove(tabId) {
        calls.push({ remove: tabId });
        if (removeDelay) await new Promise((resolve) => setTimeout(resolve, removeDelay));
        browser.tabs.delete(tabId);
      },
      async captureVisibleTab(_windowId, options) { calls.push({ capture: options }); return captureDataUrl; },
      async sendMessage(tabId, message) {
        const tab = browser.tabs.get(tabId);
        if (!tab) throw new Error(`Tab ${tabId} does not exist`);
        message = JSON.parse(JSON.stringify(message));
        calls.push({ tabId, message });
        const delay = typeof commandDelay === "function" ? commandDelay(message.command, tabId) : commandDelay === message.command ? commandDelayMs : 0;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const result = message.command === "probe" ? (tab.url.startsWith("https://detail.1688.com/") ? { ...detailFixture, pageUrl: tab.url } : probe)
          : message.command === "read_search_results" ? (typeof search === "function" ? search(++searchReadCount) : search)
            : message.command === "read_product_detail" ? detail
              : message.command === "select_sku_option" ? { selected: true }
                : { accepted: true };
        return { ok: true, result };
      },
    },
  };
  const fetchCalls = [];
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (fetchDelay) await new Promise((resolve) => setTimeout(resolve, fetchDelay));
    if (String(url).startsWith("http://127.0.0.1:17628/api/evidence/1688?")) return response({ json: { localRef: "/api/evidence/1688/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
    return imageResponse || response();
  };
  const context = vm.createContext({ chrome, console, URL, fetch, Uint8Array, atob, btoa, setTimeout, AbortController, crypto: webcrypto });
  context.globalThis = context;
  vm.runInContext(coreSource, context, { filename: "1688-core.js" });
  vm.runInContext(driverSource, context, { filename: "1688-background.js" });
  return { api: context.Ozon1688Background, storageData, sessionData: sessionSeed, browserState: browser, calls, fetchCalls };
}

const validImageRequest = { requestId: "lifecycle", sku: "1001", strategy: { type: "image", sourceUrl: "https://cdn.ozone.ru/images/1.jpg" } };
const waitForDriver = () => new Promise((resolve) => setTimeout(resolve, 300));
async function waitForJobStatus(api, jobId, status) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = await api.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${jobId} to reach ${status}`);
}

async function waitForJobPhase(api, jobId, phase) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await api.getJob(jobId);
    if (job?.phase === phase) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${jobId} to reach phase ${phase}`);
}

function persistedJob({ requestId, status = "paused_platform_verification", ownerToken, tabId = null, revision = 7 } = {}) {
  const job = {
    jobId: `1688-${requestId}`,
    taskId: "ozon-1999",
    strategy: { type: "image", query: "", sourceUrl: "https://cdn.ozone.ru/images/1.jpg" },
    selection: {}, status, phase: status, revision, cancellationToken: 0,
    tabId, ownedTabId: tabId, candidates: [], detailCandidates: [], error: "", diagnostics: null,
    startedAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", completedAt: status === "completed" ? "2026-09-02T00:01:00.000Z" : "",
  };
  if (ownerToken !== undefined) job.ownerToken = ownerToken;
  return job;
}

const handoffDriver = createDriver();
const handoffBridge = createBridge({ runtimeImpl: (message) => {
  if (message.type === "start1688SourcingJob") return handoffDriver.api.startJob(message.request);
  if (message.type === "get1688SourcingJob") return handoffDriver.api.getJob(message.jobId);
  return handoffDriver.api.cancelJob(message.jobId);
} });
handoffBridge.postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "handoff-123", taskId: "ozon-1001", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" });
await new Promise((resolve) => setTimeout(resolve, 0));
const handoffJob = await handoffDriver.api.getJob("1688-handoff-123");
assert.equal(handoffJob.strategy.type, "image");
assert.equal(handoffJob.strategy.sourceUrl, "https://ir.ozone.ru/s3/multimedia-x/a.jpg");
assert.equal(handoffBridge.posts.at(-1).data.type, "OZON_SOURCING_EXTENSION_RESPONSE_V1");
assert.equal(handoffBridge.posts.at(-1).data.requestId, "handoff-123");

const successful = createDriver();
const queued = await successful.api.startJob(validImageRequest);
assert.equal(queued.status, "queued");
await waitForDriver();
const completed = await successful.api.getJob(queued.jobId);
assert.equal(completed.status, "completed");
assert.equal(successful.calls.find((call) => call.create)?.create.url,
  "https://air.1688.com/kapp/1688-search/pc-image-search/",
  "image sourcing must open the verified 1688 image-search page that exposes the upload control");
assert.ok(completed.candidates.length <= 12);
assert.ok(completed.detailCandidates.length <= 5);
assert.equal(successful.calls.some((call) => /pinduoduo|yangkeduo|mumu/i.test(JSON.stringify(call))), false);
assert.ok(successful.calls.some((call) => call.capture?.format === "jpeg" && call.capture?.quality === 60));
const evidencePost = successful.fetchCalls.find((call) => String(call.url).startsWith("http://127.0.0.1:17628/api/evidence/1688?taskId=ozon-1001&candidateId="));
assert.equal(evidencePost.options.headers["x-ozon-agent"], "local-ui-v1");
assert.ok(evidencePost.options.body.byteLength <= 1024 * 1024);
assert.match(completed.detailCandidates[0].evidence.localRef, /^\/api\/evidence\//);
assert.doesNotMatch(JSON.stringify(successful.storageData), /data:image\/jpeg;base64/i);
assert.equal((await successful.api.cancelJob(queued.jobId)).status, "completed");

const similarRouteDriver = createDriver();
const similarRouteQueued = await similarRouteDriver.api.startJob({
  requestId: "similar-route",
  sku: "1001",
  strategy: { type: "similar_supplier", query: "同款", sourceUrl: "https://img.alicdn.com/imgextra/i1/example.jpg" },
});
await waitForDriver();
assert.equal((await similarRouteDriver.api.getJob(similarRouteQueued.jobId)).status, "completed");
assert.equal(similarRouteDriver.calls.find((call) => call.create)?.create.url,
  "https://air.1688.com/kapp/1688-search/pc-image-search/",
  "similar-supplier sourcing must use the same verified image-search entry");

const keywordRouteDriver = createDriver();
const keywordRouteQueued = await keywordRouteDriver.api.startJob({
  requestId: "keyword-route",
  sku: "1001",
  strategy: { type: "keyword", query: "蓝色女装" },
});
await waitForDriver();
assert.equal((await keywordRouteDriver.api.getJob(keywordRouteQueued.jobId)).status, "completed");
assert.equal(keywordRouteDriver.calls.find((call) => call.create)?.create.url,
  "https://s.1688.com/selloffer/offer_search.html",
  "keyword sourcing must open the final 1688 search URL without losing tab ownership during an entry redirect");

const loadingSearchSnapshot = { pageUrl: "https://air.1688.com/kapp/1688-search/pc-image-search/", title: "正在识图", nodes: [] };
const delayedSearchDriver = createDriver({
  search: (readCount) => readCount < 4 ? loadingSearchSnapshot : searchFixture,
});
const delayedSearchQueued = await delayedSearchDriver.api.startJob({ ...validImageRequest, requestId: "delayed-search-results" });
await waitForDriver();
const delayedSearchCompleted = await delayedSearchDriver.api.getJob(delayedSearchQueued.jobId);
assert.equal(delayedSearchCompleted.status, "completed",
  "image sourcing must not fail while the result page is still loading");
assert.ok(delayedSearchCompleted.candidates.length > 0,
  "image sourcing must wait for real candidates instead of treating an unchanged loading page as an empty result");

const explicitEmptySearch = {
  pageUrl: "https://air.1688.com/kapp/1688-search/pc-image-search/",
  title: "批发_供应_阿里巴巴",
  nodes: [{ text: "哎呦喂，这里空空如也～", href: "", imageUrl: "", visible: true }],
};
const explicitEmptyDriver = createDriver({ search: explicitEmptySearch });
const explicitEmptyQueued = await explicitEmptyDriver.api.startJob({ ...validImageRequest, requestId: "explicit-empty-search" });
await waitForDriver();
const explicitEmptyCompleted = await explicitEmptyDriver.api.getJob(explicitEmptyQueued.jobId);
assert.equal(explicitEmptyCompleted.status, "failed",
  "an explicit 1688 empty-result state must finish promptly instead of waiting until the result deadline");
assert.equal(explicitEmptyCompleted.diagnostics?.code, "search_parser_failed");

const postUploadVerificationDriver = createDriver({
  probe: searchFixture,
  search: { pageUrl: "https://air.1688.com/kapp/1688-search/pc-image-search/", title: "请完成滑块验证码", nodes: [] },
});
const postUploadVerificationQueued = await postUploadVerificationDriver.api.startJob({
  ...validImageRequest,
  requestId: "post-upload-verification",
});
const postUploadPaused = await waitForJobStatus(postUploadVerificationDriver.api, postUploadVerificationQueued.jobId, "paused_platform_verification");
assert.ok(Number.isInteger(postUploadPaused.ownedTabId),
  "platform verification that appears after image upload must pause and preserve the dedicated tab");
assert.equal(postUploadVerificationDriver.calls.some((call) => call.remove === postUploadPaused.ownedTabId), false);
assert.equal(postUploadVerificationDriver.calls.some((call) => call.update), false,
  "a post-upload verification page must not continue into candidate detail navigation");

const detailClockDriver = createDriver({ commandDelay: (command) => command === "read_product_detail" ? 120 : 0 });
const detailClockQueued = await detailClockDriver.api.startJob({ ...validImageRequest, requestId: "detail-phase-clock" });
const inspectingDetail = await waitForJobPhase(detailClockDriver.api, detailClockQueued.jobId, "inspect_details");
assert.match(inspectingDetail.phaseStartedAt, /^\d{4}-\d{2}-\d{2}T/, "each detail phase exposes a durable wall-clock start");
assert.equal(inspectingDetail.currentDetailIndex, 0, "the first inspected detail has a durable zero-based index");
const detailClockCompleted = await waitForJobStatus(detailClockDriver.api, detailClockQueued.jobId, "completed");
assert.match(detailClockCompleted.phaseStartedAt, /^\d{4}-\d{2}-\d{2}T/, "terminal job state retains its latest detail phase start for a page refresh");
assert.ok(Number.isInteger(detailClockCompleted.currentDetailIndex) && detailClockCompleted.currentDetailIndex >= 0,
  "terminal job state retains the last inspected detail index");

const captureFailedDriver = createDriver({ captureDataUrl: null });
const captureFailedQueued = await captureFailedDriver.api.startJob({ ...validImageRequest, requestId: "capture-failed" });
await waitForDriver();
const captureFailed = await captureFailedDriver.api.getJob(captureFailedQueued.jobId);
assert.equal(captureFailed.status, "completed");
assert.equal(captureFailed.detailCandidates[0].evidence.screenshotStatus, "capture_failed");
assert.ok(captureFailed.detailCandidates[0].evidence.text);

const skuDriver = createDriver();
const skuQueued = await skuDriver.api.startJob({ requestId: "sku", sku: "1002", strategy: { type: "verify_sku", sourceUrl: "https://detail.1688.com/offer/1030432861479.html", optionId: "red", optionLabel: "红", expectedPrice: 10 } });
await waitForDriver();
assert.equal((await skuDriver.api.getJob(skuQueued.jobId)).status, "completed");
assert.deepEqual(JSON.parse(JSON.stringify(skuDriver.calls.find((call) => call.message?.command === "select_sku_option").message.payload)), { type: "verify_sku", query: "", sourceUrl: "https://detail.1688.com/offer/1030432861479.html", optionId: "red", optionLabel: "红", expectedPrice: 10 });

const cancelledDriver = createDriver({ commandDelay: "probe" });
const cancelQueued = await cancelledDriver.api.startJob({ ...validImageRequest, requestId: "cancel" });
assert.equal((await cancelledDriver.api.cancelJob(cancelQueued.jobId)).status, "cancelled");
await waitForDriver();
assert.equal((await cancelledDriver.api.getJob(cancelQueued.jobId)).status, "cancelled");

const createCancellationDriver = createDriver({ createDelay: 120 });
const createCancellationQueued = await createCancellationDriver.api.startJob({ ...validImageRequest, requestId: "cancel-while-creating-tab" });
await new Promise((resolve) => setTimeout(resolve, 20));
await createCancellationDriver.api.cancelJob(createCancellationQueued.jobId);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal((await createCancellationDriver.api.getJob(createCancellationQueued.jobId)).status, "cancelled");
assert.equal(createCancellationDriver.calls.some((call) => call.remove === 100), true, "a cancellation during dedicated-tab creation must close only that freshly created tab");

const abortDownloadDriver = createDriver({ fetchDelay: 120 });
const abortDownloadQueued = await abortDownloadDriver.api.startJob({ ...validImageRequest, requestId: "abort-download" });
await new Promise((resolve) => setTimeout(resolve, 20));
await abortDownloadDriver.api.cancelJob(abortDownloadQueued.jobId);
await waitForDriver();
assert.equal((await abortDownloadDriver.api.getJob(abortDownloadQueued.jobId)).status, "cancelled");
assert.equal(abortDownloadDriver.calls.some((call) => call.message?.command === "submit_image_search"), false);

const inactiveEvidenceDriver = createDriver({ taskTabActive: false });
const inactiveEvidenceQueued = await inactiveEvidenceDriver.api.startJob({ ...validImageRequest, requestId: "inactive-evidence" });
await waitForDriver();
const inactiveEvidence = await inactiveEvidenceDriver.api.getJob(inactiveEvidenceQueued.jobId);
assert.equal(inactiveEvidence.status, "completed");
assert.equal(inactiveEvidenceDriver.calls.some((call) => call.capture), false);
assert.equal(inactiveEvidence.detailCandidates[0].evidence.screenshotStatus, "capture_failed");

const concurrentDriver = createDriver({ commandDelay: "probe" });
const concurrent = await Promise.allSettled([
  concurrentDriver.api.startJob({ ...validImageRequest, requestId: "concurrent-a" }),
  concurrentDriver.api.startJob({ ...validImageRequest, requestId: "concurrent-b" }),
]);
assert.equal(concurrent.filter((entry) => entry.status === "fulfilled").length, 1);

const restartSeed = {
  "ozon1688Job:1688-restart": {
    jobId: "1688-restart", taskId: "ozon-1003", strategy: { type: "keyword", query: "测试", sourceUrl: "" }, selection: {},
    ownerToken: "c".repeat(48), status: "queued", phase: "queued", revision: 1, cancellationToken: 0, tabId: null, ownedTabId: null,
    candidates: [], detailCandidates: [], error: "", diagnostics: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: "",
  }, ozon1688ActiveJobV1: "1688-restart",
};
const restartedDriver = createDriver({ storageSeed: restartSeed });
await waitForDriver();
assert.equal((await restartedDriver.api.getJob("1688-restart")).status, "completed");
const duplicateRestartSeed = JSON.parse(JSON.stringify(restartSeed));
duplicateRestartSeed["ozon1688Job:1688-restart"].status = "queued";
duplicateRestartSeed["ozon1688Job:1688-restart"].completedAt = "";
duplicateRestartSeed["ozon1688Job:1688-restart-2"] = { ...duplicateRestartSeed["ozon1688Job:1688-restart"], jobId: "1688-restart-2", taskId: "ozon-1004", startedAt: "2030-01-01T00:00:00.000Z" };
delete duplicateRestartSeed.ozon1688ActiveJobV1;
const duplicateRestartDriver = createDriver({ storageSeed: duplicateRestartSeed });
await duplicateRestartDriver.api.__test.restoreJobs();
await new Promise((resolve) => setTimeout(resolve, 700));
assert.ok(duplicateRestartDriver.calls.filter((call) => call.create).length <= 1);
assert.equal((await duplicateRestartDriver.api.getJob("1688-restart-2")).status, "paused_platform_verification");

const verificationProbe = { title: "请登录后完成滑块验证码", nodes: [] };
const verificationSession = {};
const verificationDriver = createDriver({ probe: verificationProbe, sessionSeed: verificationSession });
const verificationQueued = await verificationDriver.api.startJob({ ...validImageRequest, requestId: "verification" });
await waitForDriver();
assert.equal((await verificationDriver.api.getJob(verificationQueued.jobId)).status, "paused_platform_verification");
const paused = await verificationDriver.api.getJob(verificationQueued.jobId);
assert.ok(Number.isInteger(paused.ownedTabId));
assert.equal(verificationDriver.calls.some((call) => call.remove === paused.ownedTabId), false);
const createsBeforeSameVmResume = verificationDriver.calls.filter((call) => call.create).length;
verificationProbe.title = "1688 搜索结果";
await verificationDriver.api.resumeJob(verificationQueued.jobId);
await waitForDriver();
assert.equal((await verificationDriver.api.getJob(verificationQueued.jobId)).status, "completed");
assert.equal(verificationDriver.calls.filter((call) => call.create).length, createsBeforeSameVmResume, "same service worker session must reuse the paused verification tab");

// Regression: a service-worker restart may reuse a paused verification tab
// only when chrome.storage.session still proves the exact job/tab/token claim.
const restartVerificationProbe = { title: "请登录后完成滑块验证码", nodes: [] };
const restartVerificationStorage = {};
const restartVerificationSession = {};
const restartVerificationBrowser = { nextTabId: 100, tabs: new Map() };
const beforeRestartDriver = createDriver({
  probe: restartVerificationProbe,
  storageSeed: restartVerificationStorage,
  sessionSeed: restartVerificationSession,
  browserState: restartVerificationBrowser,
});
const beforeRestartJob = await beforeRestartDriver.api.startJob({ ...validImageRequest, requestId: "restart-paused-verification" });
const restartPaused = await waitForJobStatus(beforeRestartDriver.api, beforeRestartJob.jobId, "paused_platform_verification");
assert.ok(Number.isInteger(restartPaused.ownedTabId));
restartVerificationProbe.title = "1688 搜索结果";
const afterRestartDriver = createDriver({
  probe: restartVerificationProbe,
  storageSeed: restartVerificationStorage,
  sessionSeed: restartVerificationSession,
  browserState: restartVerificationBrowser,
});
await afterRestartDriver.api.resumeJob(beforeRestartJob.jobId);
await waitForJobStatus(afterRestartDriver.api, beforeRestartJob.jobId, "completed");
assert.equal(afterRestartDriver.calls.filter((call) => call.create).length, 0, "shared chrome.storage.session must permit exact paused-tab reuse after a VM rebuild");
assert.equal(afterRestartDriver.calls.some((call) => call.tabId === restartPaused.ownedTabId), true, "reused paused tab must receive the resumed page commands");

// Regression: no owner token or no session proof means a persisted tab ID is
// untrusted. It must never become a navigation, command, or close target.
const untrustedTabId = 77;
const ownerlessCancelled = persistedJob({ requestId: "ownerless-cancel", ownerToken: undefined, tabId: untrustedTabId });
const ownerlessCancelDriver = createDriver({
  storageSeed: { [`ozon1688Job:${ownerlessCancelled.jobId}`]: ownerlessCancelled, ozon1688ActiveJobV1: ownerlessCancelled.jobId },
  existingTabs: { [untrustedTabId]: { url: "https://s.1688.com/user-search" } },
});
await ownerlessCancelDriver.api.cancelJob(ownerlessCancelled.jobId);
assert.equal(ownerlessCancelDriver.calls.some((call) => call.remove === untrustedTabId), false, "missing owner token must not authorize closing a persisted tab ID");

const untrustedResume = persistedJob({ requestId: "ownerless-resume", ownerToken: "", tabId: untrustedTabId });
const ownerlessResumeDriver = createDriver({
  storageSeed: { [`ozon1688Job:${untrustedResume.jobId}`]: untrustedResume, ozon1688ActiveJobV1: untrustedResume.jobId },
  existingTabs: { [untrustedTabId]: { url: "https://s.1688.com/user-search" } },
});
await ownerlessResumeDriver.api.resumeJob(untrustedResume.jobId);
const renewedOwnerless = await waitForJobStatus(ownerlessResumeDriver.api, untrustedResume.jobId, "completed");
assert.match(renewedOwnerless.ownerToken, /^[a-f0-9]{32,}$/i, "an empty owner token must be replaced before creating a dedicated tab");
assert.equal(ownerlessResumeDriver.calls.some((call) => call.update?.tabId === untrustedTabId || call.tabId === untrustedTabId || call.remove === untrustedTabId), false, "untrusted persisted tab ID must not be navigated, messaged, or closed");

// Diagnostics must distinguish a service-worker memory loss from a missing
// chrome.storage.session proof without exposing the random owner token.
const missingProofToken = "d".repeat(48);
const missingProofJob = persistedJob({ requestId: "missing-session-proof", status: "running", ownerToken: missingProofToken, tabId: untrustedTabId });
const missingProofDriver = createDriver({
  sessionSeed: {},
  existingTabs: { [untrustedTabId]: { url: "https://s.1688.com/selloffer/offer_search.html" } },
});
assert.equal(typeof missingProofDriver.api.__test.diagnoseOwnership, "function", "driver must expose safe ownership diagnostics for live acceptance");
const missingProofClaim = await missingProofDriver.api.__test.diagnoseOwnership(missingProofJob);
assert.equal(missingProofClaim.reason, "missing_memory_and_session_proof");
assert.doesNotMatch(JSON.stringify(missingProofClaim), new RegExp(missingProofToken), "ownership diagnostics must not expose the owner token");

// Chrome may expose a newly-created navigation as about:blank while the
// requested 1688 URL is still present in pendingUrl. Exact memory/session
// ownership plus a verified 1688 pendingUrl must keep the tab usable.
const pendingNavigationToken = "e".repeat(48);
const pendingNavigationTabId = 88;
const pendingNavigationJob = persistedJob({
  requestId: "pending-1688-navigation",
  status: "running",
  ownerToken: pendingNavigationToken,
  tabId: pendingNavigationTabId,
});
const pendingNavigationDriver = createDriver({
  sessionSeed: {
    [`ozon1688SessionOwnerV1:${pendingNavigationJob.jobId}`]: {
      jobId: pendingNavigationJob.jobId,
      tabId: pendingNavigationTabId,
      ownerToken: pendingNavigationToken,
    },
  },
  existingTabs: {
    [pendingNavigationTabId]: {
      url: "about:blank",
      pendingUrl: "https://s.1688.com/selloffer/offer_search.html",
      status: "loading",
    },
  },
});
assert.equal((await pendingNavigationDriver.api.__test.diagnoseOwnership(pendingNavigationJob)).reason, "owned",
  "a verified 1688 pendingUrl must survive the initial about:blank navigation state");

const untrustedPendingNavigationDriver = createDriver({
  sessionSeed: {
    [`ozon1688SessionOwnerV1:${pendingNavigationJob.jobId}`]: {
      jobId: pendingNavigationJob.jobId,
      tabId: pendingNavigationTabId,
      ownerToken: pendingNavigationToken,
    },
  },
  existingTabs: {
    [pendingNavigationTabId]: {
      url: "about:blank",
      pendingUrl: "https://evil.example/redirect",
      status: "loading",
    },
  },
});
assert.equal((await untrustedPendingNavigationDriver.api.__test.diagnoseOwnership(pendingNavigationJob)).reason, "owned_tab_invalid_url",
  "an untrusted pendingUrl must remain fail-closed");

// Regression: requestId is an idempotency key for every persisted lifecycle
// state. A duplicate must return that exact record before the active-job check.
const duplicateRequest = { ...validImageRequest, requestId: "idempotent" };
const duplicateDriver = createDriver({ commandDelay: "probe", commandDelayMs: 500 });
const firstDuplicateStart = await duplicateDriver.api.startJob(duplicateRequest);
const duplicateWhileRunning = await duplicateDriver.api.startJob(duplicateRequest);
assert.equal(duplicateWhileRunning.jobId, firstDuplicateStart.jobId);
assert.equal(duplicateWhileRunning.ownerToken, firstDuplicateStart.ownerToken);
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(duplicateDriver.calls.filter((call) => call.create).length, 1, "duplicate running request must not create another dedicated tab");

const pausedDuplicate = persistedJob({ requestId: "idempotent-paused", ownerToken: "a".repeat(48), tabId: null });
const pausedDuplicateDriver = createDriver({ storageSeed: { [`ozon1688Job:${pausedDuplicate.jobId}`]: pausedDuplicate, ozon1688ActiveJobV1: pausedDuplicate.jobId } });
assert.deepEqual(plain(await pausedDuplicateDriver.api.startJob({ ...validImageRequest, requestId: "idempotent-paused" })), pausedDuplicate, "duplicate paused request must return its persisted record");

const terminalDuplicate = persistedJob({ requestId: "idempotent-terminal", status: "completed", ownerToken: "b".repeat(48) });
const terminalDuplicateDriver = createDriver({ storageSeed: { [`ozon1688Job:${terminalDuplicate.jobId}`]: terminalDuplicate, ozon1688ActiveJobV1: null } });
assert.deepEqual(plain(await terminalDuplicateDriver.api.startJob({ ...validImageRequest, requestId: "idempotent-terminal" })), terminalDuplicate, "duplicate terminal request must not be re-queued or overwritten");

// Keep a terminal runner in its delayed cleanup, then create a successor. A
// duplicate of the old request must not overwrite either record or clear the
// successor's ACTIVE pointer when the old finally finishes.
const delayedFinallyDriver = createDriver({
  removeDelay: 500,
  commandDelay: (command, tabId) => command === "probe" && tabId === 101 ? 1000 : 0,
});
const delayedOriginal = await delayedFinallyDriver.api.startJob({ ...validImageRequest, requestId: "delayed-finally-original" });
const delayedTerminal = await waitForJobStatus(delayedFinallyDriver.api, delayedOriginal.jobId, "completed");
const delayedSuccessor = await delayedFinallyDriver.api.startJob({ ...validImageRequest, requestId: "delayed-finally-successor" });
assert.deepEqual(plain(await delayedFinallyDriver.api.startJob({ ...validImageRequest, requestId: "delayed-finally-original" })), plain(delayedTerminal), "duplicate during an old finally must return the terminal generation");
await new Promise((resolve) => setTimeout(resolve, 600));
assert.equal(delayedFinallyDriver.storageData.ozon1688ActiveJobV1?.jobId, delayedSuccessor.jobId, "an old finally must not clear the successor ACTIVE pointer");
assert.deepEqual(plain(await delayedFinallyDriver.api.getJob(delayedOriginal.jobId)), plain(delayedTerminal), "an old finally must not overwrite the duplicate generation");

const failedDriver = createDriver({
  search: {
    pageUrl: "https://s.1688.com/",
    title: "不安全候选",
    nodes: [{
      ...searchFixture.nodes[0],
      href: "https://detail.1688.com/offer/900000000001.html",
      text: "安全候选 ¥10 1件起批",
      data: { ...searchFixture.nodes[0].data, title: "立即购买" },
    }],
  },
});
const failedQueued = await failedDriver.api.startJob({ ...validImageRequest, requestId: "parser" });
const failed = await waitForJobStatus(failedDriver.api, failedQueued.jobId, "failed");
assert.equal(failed.status, "failed");
assert.equal(failed.diagnostics.code, "search_parser_failed");

for (const [label, url, imageResponse] of [
  ["http", "http://cdn.ozone.ru/image.jpg", response()],
  ["host", "https://example.com/image.jpg", response()],
  ["redirect-host", "https://cdn.ozone.ru/image.jpg", response({ url: "https://example.com/image.jpg" })],
  ["non-image", "https://cdn.ozone.ru/image.jpg", response({ contentType: "text/html" })],
  ["empty", "https://cdn.ozone.ru/image.jpg", response({ bytes: new ArrayBuffer(0) })],
  ["large", "https://cdn.ozone.ru/image.jpg", response({ bytes: new ArrayBuffer(15 * 1024 * 1024 + 1) })],
]) {
  const driver = createDriver({ imageResponse });
  await assert.rejects(() => driver.api.__test.downloadTrustedImage(url), undefined, label);
}
const streamTooLarge = {
  ok: true, url: "https://cdn.ozone.ru/image.jpg", headers: { get: (name) => name === "content-type" ? "image/jpeg" : null },
  body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(15 * 1024 * 1024 + 1) }), cancel: async () => {} }) },
};
await assert.rejects(() => createDriver({ imageResponse: streamTooLarge }).api.__test.downloadTrustedImage("https://cdn.ozone.ru/image.jpg"));
await assert.doesNotReject(() => createDriver({ imageResponse: response({ bytes: new Uint8Array([1, 2, 3]).buffer }) }).api.__test.downloadTrustedImage("https://cdn.ozone.ru/image.jpg"));

const oversizedSearch = {
  ...searchFixture,
  nodes: Array.from({ length: 14 }, (_, index) => ({
    ...searchFixture.nodes[index % searchFixture.nodes.length],
    href: `https://detail.1688.com/offer/${900000000000 + index}.html`,
    text: `安全候选 ${index + 1} ¥10 1件起批 包邮`,
  })),
};
const capDriver = createDriver({ search: oversizedSearch });
const capQueued = await capDriver.api.startJob({ ...validImageRequest, requestId: "caps" });
await waitForDriver();
const capped = await capDriver.api.getJob(capQueued.jobId);
assert.equal(capped.status, "completed");
assert.equal(capped.candidates.length, 12);
assert.equal(capped.detailCandidates.length, 5);
assert.equal(capDriver.calls.filter((call) => call.update).length, 5);

async function runObservedAirUploadCommand() {
  const events = [];
  let selectedFiles = null;
  const input = {
    id: "img-search-upload",
    parentElement: null,
    getClientRects: () => [{}],
    getAttribute: (name) => name === "id" ? "img-search-upload"
      : name === "type" ? "file"
        : name === "accept" ? ".jpg,.jpeg,.png,.bmp,.webp"
          : "",
    set files(value) { selectedFiles = value; },
    dispatchEvent: (event) => { events.push(event.type); return true; },
  };
  const document = {
    documentElement: {},
    body: { innerText: "搜索 找到以下货源 哎呦喂，这里空空如也～" },
    querySelectorAll: (selector) => selector.includes("#img-search-upload") ? [input] : [],
  };
  const listeners = [];
  const chrome = { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } };
  class TestDataTransfer {
    constructor() {
      this.files = [];
      this.items = { add: (file) => this.files.push(file) };
    }
  }
  class TestFile {
    constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; }
  }
  class TestEvent {
    constructor(type, options) { this.type = type; this.bubbles = options.bubbles; }
  }
  const context = vm.createContext({ chrome, document, location: { href: "https://air.1688.com/kapp/1688-search/pc-image-search/" }, Event: TestEvent, DataTransfer: TestDataTransfer, File: TestFile, Uint8Array, atob, console, setTimeout });
  context.globalThis = context;
  vm.runInContext(contentSource, context, { filename: "1688-content.js" });
  const response = await new Promise((resolve) => {
    listeners[0]({ type: "OZON_1688_PAGE_COMMAND_V1", command: "submit_image_search", payload: { imageBase64: "AQID", mimeType: "image/jpeg" } }, null, resolve);
  });
  const searchResponse = await new Promise((resolve) => {
    listeners[0]({ type: "OZON_1688_PAGE_COMMAND_V1", command: "read_search_results", payload: {} }, null, resolve);
  });
  return { response, searchResponse, events, selectedFiles };
}

const observedAirUpload = await runObservedAirUploadCommand();
assert.equal(observedAirUpload.response.ok, true,
  "the observed air.1688.com #img-search-upload control must accept an image-search command");
assert.deepEqual(observedAirUpload.events, ["input", "change"]);
assert.equal(observedAirUpload.selectedFiles.length, 1);
assert.ok(observedAirUpload.searchResponse.result.nodes.some((node) => /空空如也/.test(node.text)),
  "the observed 1688 empty-result message must be preserved in the search snapshot");

assert.match(contentSource, /const ALLOWED_COMMANDS = new Set\([\s\S]*"select_sku_option"/);
assert.match(contentSource, /new DataTransfer\(\)/);
assert.match(contentSource, /aria-selected/);
assert.match(contentSource, /firstPrice !== secondPrice/);
assert.match(contentSource, /下单\|订单\|支付/);
assert.doesNotMatch(contentSource, /clipboard|showOpenFilePicker|purchase/i);

function runSkuCommand({ text = "红", prices = [10, 10] } = {}) {
  let selected = false;
  let priceRead = 0;
  const option = {
    innerText: text,
    className: "",
    getClientRects: () => [{}],
    getAttribute: (name) => name === "data-sku-option-id" ? "red" : name === "aria-selected" ? String(selected) : "",
    click: () => { selected = true; },
  };
  const document = {
    querySelectorAll: () => [option],
    querySelector: () => ({ getAttribute: () => String(prices[Math.min(priceRead++, prices.length - 1)]), innerText: "" }),
  };
  const listeners = [];
  const chrome = { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } };
  const context = vm.createContext({ chrome, document, location: { href: "https://detail.1688.com/offer/1.html" }, Event: class Event {}, DataTransfer: class DataTransfer {}, File: class File {}, console, setTimeout });
  context.globalThis = context;
  vm.runInContext(contentSource, context, { filename: "1688-content.js" });
  return new Promise((resolve) => {
    listeners[0]({ type: "OZON_1688_PAGE_COMMAND_V1", command: "select_sku_option", payload: { optionId: "red", optionLabel: text, expectedPrice: 10 } }, null, resolve);
  });
}

assert.deepEqual(JSON.parse(JSON.stringify(await runSkuCommand())), { ok: true, result: { optionId: "red", optionLabel: "红", selected: true, price: 10 } });
assert.equal((await runSkuCommand({ prices: [10, 11] })).ok, false);
assert.equal((await runSkuCommand({ text: "立即购买", prices: [10, 10] })).ok, false);

// Review round 1 regressions: Chrome message payloads are JSON-cloned and the
// persisted state must carry cancellation/restart ownership information.
assert.match(driverSource, /imageBase64/);
assert.match(contentSource, /imageBase64/);
assert.match(driverSource, /AbortController/);
assert.match(driverSource, /revision/);
assert.match(driverSource, /ownedTabId/);
assert.match(driverSource, /waitForTabComplete/);
assert.match(driverSource, /chrome\.runtime\.onStartup/);
assert.match(packageJson.scripts.test, /test-1688-extension/);

console.log("1688 extension tests passed");
