import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.version, "0.6.30");
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

const coreSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-core.js", import.meta.url), "utf8");
const driverSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-background.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-content.js", import.meta.url), "utf8");
const searchFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-search-snapshot.json", import.meta.url), "utf8"));
const detailFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-detail-snapshot.json", import.meta.url), "utf8"));

function storageArea(data, calls) {
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
      return Object.fromEntries(list.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    async set(values) { calls.push({ storageSet: values }); Object.assign(data, JSON.parse(JSON.stringify(values))); },
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

function createDriver({ probe = searchFixture, search = searchFixture, detail = detailFixture, imageResponse, commandDelay = null, captureDataUrl = "data:image/jpeg;base64,AQID", storageSeed = null, taskTabActive = true, fetchDelay = 0 } = {}) {
  const storageData = storageSeed || {};
  const calls = [];
  let nextTabId = 100;
  let tabUrl = "https://s.1688.com/";
  const listeners = { messages: [] };
  const chrome = {
    storage: { local: storageArea(storageData, calls) },
    runtime: { onMessage: { addListener: (listener) => listeners.messages.push(listener) } },
    tabs: {
      async query() { return []; },
      async create(args) { tabUrl = args.url; const tab = { id: nextTabId++, windowId: 1, status: "complete", ...args }; calls.push({ create: args }); return tab; },
      async update(tabId, args) { tabUrl = args.url || tabUrl; calls.push({ update: { tabId, args } }); return { id: tabId, windowId: 1, status: "complete", url: tabUrl, ...args }; },
      async get(tabId) { return { id: tabId, windowId: 1, active: taskTabActive, status: "complete", url: tabUrl }; },
      async remove(tabId) { calls.push({ remove: tabId }); },
      async captureVisibleTab(_windowId, options) { calls.push({ capture: options }); return captureDataUrl; },
      async sendMessage(tabId, message) {
        message = JSON.parse(JSON.stringify(message));
        calls.push({ tabId, message });
        if (commandDelay === message.command) await new Promise((resolve) => setTimeout(resolve, 5));
        const result = message.command === "probe" ? (tabUrl.startsWith("https://detail.1688.com/") ? { ...detailFixture, pageUrl: tabUrl } : probe)
          : message.command === "read_search_results" ? search
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
    if (String(url).startsWith("http://127.0.0.1:17628/api/evidence/1688?")) return response({ json: { localRef: "/api/evidence/1688/test.jpg" } });
    return imageResponse || response();
  };
  const context = vm.createContext({ chrome, console, URL, fetch, Uint8Array, atob, btoa, setTimeout, AbortController });
  context.globalThis = context;
  vm.runInContext(coreSource, context, { filename: "1688-core.js" });
  vm.runInContext(driverSource, context, { filename: "1688-background.js" });
  return { api: context.Ozon1688Background, storageData, calls, fetchCalls };
}

const validImageRequest = { requestId: "lifecycle", sku: "1001", strategy: { type: "image", sourceUrl: "https://cdn.ozone.ru/images/1.jpg" } };
const waitForDriver = () => new Promise((resolve) => setTimeout(resolve, 300));

const successful = createDriver();
const queued = await successful.api.startJob(validImageRequest);
assert.equal(queued.status, "queued");
await waitForDriver();
const completed = await successful.api.getJob(queued.jobId);
assert.equal(completed.status, "completed");
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
    status: "queued", phase: "queued", revision: 1, cancellationToken: 0, tabId: null, ownedTabId: null,
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
const verificationDriver = createDriver({ probe: verificationProbe });
const verificationQueued = await verificationDriver.api.startJob({ ...validImageRequest, requestId: "verification" });
await waitForDriver();
assert.equal((await verificationDriver.api.getJob(verificationQueued.jobId)).status, "paused_platform_verification");
const paused = await verificationDriver.api.getJob(verificationQueued.jobId);
assert.ok(Number.isInteger(paused.ownedTabId));
assert.equal(verificationDriver.calls.some((call) => call.remove === paused.ownedTabId), false);
verificationProbe.title = "1688 搜索结果";
await verificationDriver.api.resumeJob(verificationQueued.jobId);
await waitForDriver();
assert.equal((await verificationDriver.api.getJob(verificationQueued.jobId)).status, "completed");

const failedDriver = createDriver({ search: { pageUrl: "https://s.1688.com/", title: "空结果", nodes: [] } });
const failedQueued = await failedDriver.api.startJob({ ...validImageRequest, requestId: "parser" });
await waitForDriver();
const failed = await failedDriver.api.getJob(failedQueued.jobId);
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
assert.match(driverSource, /resumeJob/);
assert.match(driverSource, /active!==id/);
assert.match(driverSource, /ownerToken/);
assert.match(driverSource, /jobId\.localeCompare/);

console.log("1688 extension tests passed");
