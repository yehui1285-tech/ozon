import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));
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
      const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
      return Object.fromEntries(list.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    async set(values) { calls.push({ storageSet: values }); Object.assign(data, JSON.parse(JSON.stringify(values))); },
  };
}

function response({ ok = true, contentType = "image/jpeg", bytes = new Uint8Array([1, 2, 3]).buffer, json = {} } = {}) {
  return {
    ok,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null },
    async arrayBuffer() { return bytes; },
    async json() { return json; },
  };
}

function createDriver({ probe = searchFixture, search = searchFixture, detail = detailFixture, imageResponse, commandDelay = null, captureDataUrl = "data:image/jpeg;base64,AQID" } = {}) {
  const storageData = {};
  const calls = [];
  let nextTabId = 100;
  const listeners = { messages: [] };
  const chrome = {
    storage: { local: storageArea(storageData, calls) },
    runtime: { onMessage: { addListener: (listener) => listeners.messages.push(listener) } },
    tabs: {
      async query() { return []; },
      async create(args) { const tab = { id: nextTabId++, windowId: 1, ...args }; calls.push({ create: args }); return tab; },
      async update(tabId, args) { calls.push({ update: { tabId, args } }); return { id: tabId, windowId: 1, ...args }; },
      async get(tabId) { return { id: tabId, windowId: 1 }; },
      async remove(tabId) { calls.push({ remove: tabId }); },
      async captureVisibleTab(_windowId, options) { calls.push({ capture: options }); return captureDataUrl; },
      async sendMessage(tabId, message) {
        calls.push({ tabId, message });
        if (commandDelay === message.command) await new Promise((resolve) => setTimeout(resolve, 5));
        const result = message.command === "probe" ? probe
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
    if (String(url).startsWith("http://127.0.0.1:17628/api/evidence/1688?")) return response({ json: { localRef: "/api/evidence/1688/test.jpg" } });
    return imageResponse || response();
  };
  const context = vm.createContext({ chrome, console, URL, fetch, Uint8Array, atob, setTimeout });
  context.globalThis = context;
  vm.runInContext(coreSource, context, { filename: "1688-core.js" });
  vm.runInContext(driverSource, context, { filename: "1688-background.js" });
  return { api: context.Ozon1688Background, storageData, calls, fetchCalls };
}

const validImageRequest = { requestId: "lifecycle", sku: "1001", strategy: { type: "image", sourceUrl: "https://cdn.ozone.ru/images/1.jpg" } };
const waitForDriver = () => new Promise((resolve) => setTimeout(resolve, 35));

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

const captureFailedDriver = createDriver({ captureDataUrl: null });
const captureFailedQueued = await captureFailedDriver.api.startJob({ ...validImageRequest, requestId: "capture-failed" });
await waitForDriver();
const captureFailed = await captureFailedDriver.api.getJob(captureFailedQueued.jobId);
assert.equal(captureFailed.status, "completed");
assert.equal(captureFailed.detailCandidates[0].evidence.screenshotStatus, "capture_failed");
assert.ok(captureFailed.detailCandidates[0].evidence.text);

const skuDriver = createDriver();
const skuQueued = await skuDriver.api.startJob({ requestId: "sku", sku: "1002", strategy: { type: "verify_sku", optionId: "red", optionLabel: "红", expectedPrice: 10 } });
await waitForDriver();
assert.equal((await skuDriver.api.getJob(skuQueued.jobId)).status, "completed");
assert.deepEqual(JSON.parse(JSON.stringify(skuDriver.calls.find((call) => call.message?.command === "select_sku_option").message.payload)), { type: "verify_sku", query: "", sourceUrl: "", optionId: "red", optionLabel: "红", expectedPrice: 10 });

const cancelledDriver = createDriver({ commandDelay: "probe" });
const cancelQueued = await cancelledDriver.api.startJob({ ...validImageRequest, requestId: "cancel" });
assert.equal((await cancelledDriver.api.cancelJob(cancelQueued.jobId)).status, "cancelled");
await waitForDriver();
assert.equal((await cancelledDriver.api.getJob(cancelQueued.jobId)).status, "cancelled");

const verificationDriver = createDriver({ probe: { title: "请登录后完成滑块验证码", nodes: [] } });
const verificationQueued = await verificationDriver.api.startJob({ ...validImageRequest, requestId: "verification" });
await waitForDriver();
assert.equal((await verificationDriver.api.getJob(verificationQueued.jobId)).status, "paused_platform_verification");

const failedDriver = createDriver({ search: { pageUrl: "https://s.1688.com/", title: "空结果", nodes: [] } });
const failedQueued = await failedDriver.api.startJob({ ...validImageRequest, requestId: "parser" });
await waitForDriver();
const failed = await failedDriver.api.getJob(failedQueued.jobId);
assert.equal(failed.status, "failed");
assert.equal(failed.diagnostics.code, "search_parser_failed");

for (const [label, url, imageResponse] of [
  ["http", "http://cdn.ozone.ru/image.jpg", response()],
  ["host", "https://example.com/image.jpg", response()],
  ["non-image", "https://cdn.ozone.ru/image.jpg", response({ contentType: "text/html" })],
  ["empty", "https://cdn.ozone.ru/image.jpg", response({ bytes: new ArrayBuffer(0) })],
  ["large", "https://cdn.ozone.ru/image.jpg", response({ bytes: new ArrayBuffer(15 * 1024 * 1024 + 1) })],
]) {
  const driver = createDriver({ imageResponse });
  await assert.rejects(() => driver.api.__test.downloadTrustedImage(url), undefined, label);
}

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
  const context = vm.createContext({ chrome, document, location: { href: "https://detail.1688.com/offer/1.html" }, Event: class Event {}, DataTransfer: class DataTransfer {}, File: class File {}, console });
  context.globalThis = context;
  vm.runInContext(contentSource, context, { filename: "1688-content.js" });
  return new Promise((resolve) => {
    listeners[0]({ type: "OZON_1688_PAGE_COMMAND_V1", command: "select_sku_option", payload: { optionId: "red", optionLabel: text, expectedPrice: 10 } }, null, resolve);
  });
}

assert.deepEqual(JSON.parse(JSON.stringify(await runSkuCommand())), { ok: true, result: { optionId: "red", optionLabel: "红", selected: true, price: 10 } });
assert.equal((await runSkuCommand({ prices: [10, 11] })).ok, false);
assert.equal((await runSkuCommand({ text: "立即购买", prices: [10, 10] })).ok, false);

console.log("1688 extension tests passed");
