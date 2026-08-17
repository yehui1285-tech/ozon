import assert from "node:assert/strict";
import fs from "node:fs";

await import(`../ozon-erp-collector-extension/store-scanner-core.js?test=${Date.now()}`);
const core = globalThis.OzonStoreScannerCore;

assert.ok(core, "store scanner core must be installed");
const serial = core.createSerializedExecutor();
const serialOrder = [];
await Promise.all([
  serial(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); serialOrder.push("progress"); }),
  serial(async () => { serialOrder.push("delete"); }),
  serial(async () => { serialOrder.push("pause"); }),
]);
assert.deepEqual(serialOrder, ["progress", "delete", "pause"]);
assert.deepEqual(core.mergeAttemptObservedSkus(["3", "1"], ["2", "1", "3"]), ["3", "1", "2"]);
assert.equal(core.storeResultStorageKey("hj025"), "ozonStoreQualifiedProductsV2:hj025");
assert.notEqual(core.storeResultStorageKey("hj025"), core.storeResultStorageKey("other-store"));
const mergedStoreState = core.mergeStoreState(
  { observedSkus: ["1"], pendingLinks: ["https://www.ozon.ru/product/old-1/?at=x"], products: { "1": { sku: "1", competitor: "¥122.49", competitorReady: true } } },
  { observedSkus: ["2", "1"], pendingLinks: ["https://www.ozon.ru/product/new-2/?at=y"], products: { "1": { sku: "1", competitor: "", competitorReady: false }, "2": { sku: "2" } } },
);
assert.deepEqual(mergedStoreState.observedSkus, ["1", "2"]);
assert.deepEqual(mergedStoreState.pendingLinks, ["https://www.ozon.ru/product/new-2/"]);
assert.equal(mergedStoreState.products["1"].competitor, "¥122.49");
assert.equal(mergedStoreState.products["1"].competitorReady, true);
assert.equal(core.sellerKeyFromUrl("https://www.ozon.ru/seller/hj025/"), "hj025");
assert.equal(core.sellerKeyFromUrl("https://www.ozon.ru/product/example/"), "");
assert.equal(core.normalizeSellerUrl("ozon.ru/seller/hj025/?miniapp=seller_123"), "https://www.ozon.ru/seller/hj025/");
assert.equal(core.normalizeSellerUrl("https://example.com/seller/hj025/"), "");
const parsedStores = core.parseStoreUrlList(`
https://www.ozon.ru/seller/hj025/
ozon.ru/seller/second-store/
https://www.ozon.ru/seller/hj025/?duplicate=1
not-a-store
`, 50);
assert.deepEqual(parsedStores.urls, ["https://www.ozon.ru/seller/hj025/", "https://www.ozon.ru/seller/second-store/"]);
assert.equal(parsedStores.duplicateCount, 1);
assert.deepEqual(parsedStores.invalid, ["not-a-store"]);
assert.equal(core.shouldAutoSkipStore(999, 0), false);
assert.equal(core.shouldAutoSkipStore(1000, 2), true);
assert.equal(core.shouldAutoSkipStore(1000, 3), false);
assert.equal(core.shouldAutoSkipStore(1120, 1), true);
assert.equal(core.autoSkipDisposition(499, 0), null);
assert.deepEqual(core.autoSkipDisposition(500, 0), { code: "zero-match-500", observedThreshold: 500, qualifiedLimit: 1 });
assert.equal(core.autoSkipDisposition(500, 1), null);
assert.equal(core.autoSkipDisposition(999, 2), null);
assert.deepEqual(core.autoSkipDisposition(1000, 2), { code: "low-yield-1000", observedThreshold: 1000, qualifiedLimit: 3 });
assert.equal(core.autoSkipDisposition(1000, 3), null);
assert.deepEqual(core.classifyStoreFinish({ reviewing: true, forwardReachedBoundary: true, pendingCount: 0 }), { status: "completed", complete: true, note: "已完成（省略剩余反向复查）" });
assert.deepEqual(core.classifyStoreFinish({ reviewing: true, forwardReachedBoundary: true, pendingCount: 2 }), { status: "partial", complete: false, note: "部分完成：仍有2个商品待复查" });
assert.deepEqual(core.classifyStoreFinish({ reviewing: false, forwardReachedBoundary: false, pendingCount: 0 }), { status: "skipped", complete: false, note: "提前结束当前店（保留已找到商品）" });
const removalBatch = { currentIndex: 1, stores: [{ sellerKey: "a" }, { sellerKey: "b" }, { sellerKey: "c" }] };
assert.deepEqual(core.removeBatchStoreTask(removalBatch, "a"), { removed: { sellerKey: "a" }, index: 0, wasCurrent: false });
assert.equal(removalBatch.currentIndex, 0);
assert.deepEqual(removalBatch.stores.map((task) => task.sellerKey), ["b", "c"]);
assert.deepEqual(core.removeBatchStoreTask(removalBatch, "b"), { removed: { sellerKey: "b" }, index: 0, wasCurrent: true });
assert.equal(removalBatch.currentIndex, 0);
assert.deepEqual(removalBatch.stores.map((task) => task.sellerKey), ["c"]);
assert.equal(
  core.canonicalProductLink("https://www.ozon.ru/product/test-123/?at=abc&hs=1"),
  "https://www.ozon.ru/product/test-123/",
);

const parsed = core.parseCardText(`
大促销
327,28 ¥
汽车扰流板, 1 个
选品标签：
符合要求
rFBS佣金：
12%
14%
18%
SKU：3258064058
月销量：3
发货模式：FBS
长 宽 高：1300 x 280 x 100mm
重 量：3000g
上架时间：2026-08-14(1天)
跟卖最低价：¥201.65
`);

assert.equal(parsed.qualified, true);
assert.equal(parsed.sku, "3258064058");
assert.equal(parsed.price, "327,28");
assert.deepEqual(parsed.commissions, ["12%", "14%", "18%"]);
assert.equal(parsed.monthlySales, "3");
assert.equal(parsed.dimensions, "1300 x 280 x 100mm");
assert.equal(parsed.weight, "3000g");
assert.equal(parsed.competitor, "¥201.65");
assert.equal(parsed.competitorReady, true);

const asciiCompetitor = core.parseCardText(`符合要求\nrFBS佣金：\n12%\n17%\n17%\nSKU：4821128720\n跟卖最低价: ₽ 1 222,49`);
assert.equal(asciiCompetitor.competitor, "₽ 1 222,49");
assert.equal(asciiCompetitor.competitorReady, true);

const emptyCompetitor = core.parseCardText(`rFBS佣金：\n12%\n17%\n17%\nSKU：2\n跟卖最低价：暂无`);
assert.equal(emptyCompetitor.competitor, "暂无");
assert.equal(emptyCompetitor.competitorReady, true);

const pendingCompetitor = core.parseCardText(`rFBS佣金：\n12%\n17%\n17%\nSKU：3\n跟卖最低价：`);
assert.equal(pendingCompetitor.competitor, "");
assert.equal(pendingCompetitor.competitorReady, false);

const notQualified = core.parseCardText(`rFBS佣金：\n12%\n17%\n17%\nSKU：1\n月销量：1`);
assert.equal(notQualified.qualified, false);

const linkA = "https://www.ozon.ru/product/a-100/";
const linkB = "https://www.ozon.ru/product/b-200/";
const partialReadiness = core.assessViewportReadiness(
  [`${linkA}?at=1`, linkB, linkA],
  new Map([[linkA, { sku: "100", qualified: true }]]),
);
assert.equal(partialReadiness.visibleCount, 2);
assert.equal(partialReadiness.loadedCount, 1);
assert.deepEqual(partialReadiness.missingLinks, [linkB]);
assert.match(partialReadiness.signature, /pending/);

const fieldPendingReadiness = core.assessViewportReadiness(
  [linkA],
  new Map([[linkA, { sku: "100", ready: false }]]),
);
assert.equal(fieldPendingReadiness.loadedCount, 0);
assert.deepEqual(fieldPendingReadiness.missingLinks, [linkA]);

const completeReadiness = core.assessViewportReadiness(
  [linkA, linkB],
  new Map([
    [linkA, { sku: "100", qualified: true }],
    [linkB, { sku: "200", qualified: false }],
  ]),
);
assert.equal(completeReadiness.loadedCount, 2);
assert.deepEqual(completeReadiness.missingLinks, []);

const markdown = core.buildMarkdown({
  storeName: "HJ|025",
  storeUrl: "https://www.ozon.ru/seller/hj025/",
  exportedAt: "2026-08-14 16:00:00",
  observedCount: 104,
  scanComplete: true,
  products: [{
    name: "汽车|扰流板",
    sku: "3258064058",
    price: "327,28",
    commissions: ["12%", "14%", "18%"],
    monthlySales: "3",
    fulfillment: "FBS",
    dimensions: "1300 x 280 x 100mm",
    weight: "3000g",
    competitor: "¥201.65",
    link: "https://www.ozon.ru/product/test-3258064058/?at=abc",
  }],
});

assert.match(markdown, /已识别店铺商品：104 个/);
assert.match(markdown, /汽车\\\|扰流板/);
assert.match(markdown, /https:\/\/www\.ozon\.ru\/product\/test-3258064058\//);
assert.match(markdown, /已到达店铺商品末尾/);

const batch = {
  id: "batch-test",
  status: "completed",
  stores: [{ sellerKey: "hj025", url: "https://www.ozon.ru/seller/hj025/", status: "completed" }],
};
const batchStores = {
  hj025: { storeName: "=HJ|025", products: { "3258064058": { name: "汽车|扰流板", sku: "3258064058", price: "327,28", commissions: ["14%", "18%"], competitor: "¥201.65", link: "https://www.ozon.ru/product/test-3258064058/?at=abc" } } },
};
const batchMarkdown = core.buildBatchMarkdown({ batch, stores: batchStores, exportedAt: "2026-08-15 12:00:00" });
assert.match(batchMarkdown, /店铺数量：1 个/);
assert.match(batchMarkdown, /汽车\\\|扰流板/);
const batchCsv = core.buildBatchCsv({ batch, stores: batchStores });
assert.match(batchCsv, /"'=HJ\|025"/);
assert.match(batchCsv, /"327,28"/);

const scannerSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/store-scanner.js", import.meta.url), "utf8");
assert.match(scannerSource, /const SETTLE_DELAY_MS = 1500/);
assert.match(scannerSource, /const POLL_INTERVAL_MS = 500/);
assert.match(scannerSource, /const MAX_VIEWPORT_WAIT_MS = 10000/);
assert.match(scannerSource, /const STABLE_POLLS_REQUIRED = 2/);
assert.match(scannerSource, /const SCROLL_RATIO = 0\.45/);
assert.match(scannerSource, /scanDirection = -1/);
assert.match(scannerSource, /const BACKGROUND_SETTLE_DELAY_MS = 4000/);
assert.match(scannerSource, /const BACKGROUND_MAX_VIEWPORT_WAIT_MS = 20000/);
assert.match(scannerSource, /const BACKGROUND_BOUNDARY_CONFIRM_MS = 30000/);
assert.match(scannerSource, /const BACKGROUND_BOUNDARY_STABLE_REQUIRED = 5/);
assert.match(scannerSource, /storeScanWatchdogTick/);
assert.match(scannerSource, /document\.hidden \? "后台准确扫描"/);
assert.match(scannerSource, /ready: parsed\.competitorReady/);
assert.match(scannerSource, /if \(!product\.competitor && previous\?\.competitor\)/);
assert.match(scannerSource, /const productAnchors = new Set\(\)/);
assert.match(scannerSource, /const nearbyProductAnchors = new Set\(\)/);
assert.match(scannerSource, /const cardParseCache = new WeakMap\(\)/);
assert.match(scannerSource, /new IntersectionObserver/);
assert.match(scannerSource, /rootMargin: "90% 0px 90% 0px"/);
assert.match(scannerSource, /mutation\.removedNodes/);
assert.match(scannerSource, /mutation\.addedNodes/);
assert.match(scannerSource, /storeScanProgress/);
assert.match(scannerSource, /attemptObservedSkuDelta/);
assert.match(scannerSource, /acknowledgedAttemptSkus/);
assert.match(scannerSource, /storeScanFinished/);
assert.match(scannerSource, /batchCooldownElapsed/);
assert.match(scannerSource, /armBatchCooldown/);
assert.match(scannerSource, /if \(pendingLinks\.size === 0\)/);
assert.match(scannerSource, /已省略整页反向复查/);
assert.match(scannerSource, /id="ozon-store-skip"/);
assert.match(scannerSource, /结束当前店，扫描下一家/);
assert.match(scannerSource, /source: "store-panel"/);
assert.match(scannerSource, /reviewing: scanDirection < 0/);
assert.match(scannerSource, /forwardReachedBoundary/);
assert.match(scannerSource, /Вам может понравиться/);
assert.match(scannerSource, /You may also like/);
assert.match(scannerSource, /boundarySource: "page-bottom"/);
assert.match(scannerSource, /consecutiveNoNewSkuScreens >= BOTTOM_FALLBACK_NO_NEW_SCREENS/);
assert.match(scannerSource, /stalled: scanLooksStalled\(\)/);
assert.doesNotMatch(scannerSource, /document\.querySelectorAll\("div"\)/);
assert.doesNotMatch(scannerSource, /characterData:\s*true/);

const backgroundSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
assert.match(backgroundSource, /autoDiscardable: false/);
assert.match(backgroundSource, /periodInMinutes: 0\.5/);
assert.match(backgroundSource, /STORE_SCAN_ALARM_PREFIX/);
assert.match(backgroundSource, /const BATCH_MAX_STORES = 50/);
assert.match(backgroundSource, /const BATCH_RETRY_LIMIT = 2/);
assert.match(backgroundSource, /const BATCH_COOLDOWN_MS = 8000/);
assert.match(backgroundSource, /const BATCH_ALARM_FALLBACK_MS = 30000/);
assert.match(backgroundSource, /const AUTO_SKIP_OBSERVED_THRESHOLD = 1000/);
assert.match(backgroundSource, /const ZERO_MATCH_OBSERVED_THRESHOLD = 500/);
assert.match(backgroundSource, /const AUTO_SKIP_QUALIFIED_LIMIT = 3/);
assert.match(backgroundSource, /autoSkipDisposition\(task\.runObservedCount, task\.qualifiedCount, ZERO_MATCH_OBSERVED_THRESHOLD, AUTO_SKIP_OBSERVED_THRESHOLD, AUTO_SKIP_QUALIFIED_LIMIT\)/);
assert.match(backgroundSource, /已查看500个仍无符合要求商品/);
assert.match(backgroundSource, /const enqueueBatchOperation = storeScannerCore\.createSerializedExecutor\(\)/);
assert.match(backgroundSource, /task\.status = "recovering"/);
assert.match(backgroundSource, /task\.needsRecovery = true/);
assert.match(backgroundSource, /!task\.needsRecovery/);
assert.match(backgroundSource, /\["loading", "recovering"\]\.includes\(task\.status\)/);
assert.match(backgroundSource, /attemptId: latestTask\.attemptId/);
assert.match(backgroundSource, /attemptObservedSkus: latestTask\.attemptObservedSkus/);
assert.match(backgroundSource, /attemptObservedSkuDelta \|\| message\.attemptObservedSkus/);
assert.match(backgroundSource, /nextRunAt = Date\.now\(\) \+ BATCH_COOLDOWN_MS/);
assert.match(backgroundSource, /Math\.max\(dueAt, Date\.now\(\) \+ BATCH_ALARM_FALLBACK_MS\)/);
assert.match(backgroundSource, /continueBatchAfterCooldown/);
assert.match(backgroundSource, /batchCooldownElapsed/);
assert.match(backgroundSource, /STORE_RESULTS_LEGACY_KEY/);
assert.match(backgroundSource, /STORE_RESULTS_INDEX_KEY/);
assert.match(backgroundSource, /ensureStoreStorageMigrated/);
assert.match(backgroundSource, /storeResultStorageKey/);
assert.match(backgroundSource, /chrome\.storage\.local\.remove\(STORE_RESULTS_LEGACY_KEY\)/);
assert.match(backgroundSource, /自动提前跳过/);
assert.match(backgroundSource, /classifyStoreFinish/);
assert.match(backgroundSource, /complete: disposition\.complete/);
assert.match(backgroundSource, /removeStoreBatchTask/);
assert.match(backgroundSource, /async function clearStoreBatch\(message = \{\}\)/);
assert.match(backgroundSource, /chrome\.storage\.local\.remove\(BATCH_KEY\)/);
assert.match(backgroundSource, /message\?\.type === "clearStoreBatch"/);
assert.match(backgroundSource, /当前批次的店铺已全部删除/);
assert.match(backgroundSource, /startStoreBatch/);
assert.match(backgroundSource, /resumeInterruptedBatch/);

const batchSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/batch.js", import.meta.url), "utf8");
const batchHtmlSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/batch.html", import.meta.url), "utf8");
assert.match(batchSource, /buildBatchMarkdown/);
assert.match(batchSource, /buildBatchCsv/);
assert.match(batchSource, /parseStoreUrlList\(\$\("urls"\)\.value, 50\)/);
assert.match(batchSource, /source: "batch-manager"/);
assert.match(batchSource, /data-delete-store/);
assert.match(batchSource, /removeStoreBatchTask/);
assert.match(batchSource, /type: "clearStoreBatch"/);
assert.match(batchSource, /已下载到电脑的 Markdown\/CSV 文件以及各店铺历史采集记录都会保留/);
assert.match(batchSource, /\$\("urls"\)\.value = ""/);
assert.match(batchSource, /getBatchStoreResults/);
assert.match(batchSource, /function healthSummary\(task\)/);
assert.match(batchSource, /连续 \$\{task\.noNewSkuScreens\} 屏无新增/);
assert.doesNotMatch(batchSource, /ozonStoreQualifiedProductsV1/);
assert.match(batchHtmlSource, /<th>操作<\/th>/);
assert.match(batchHtmlSource, /<th>扫描动态<\/th>/);
assert.match(batchHtmlSource, /row-delete/);
assert.match(batchHtmlSource, /id="clearBatch">清空当前批次/);

const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));
assert.equal(manifest.version, "0.6.7");
assert.ok(manifest.permissions.includes("alarms"));

const detailSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/content.js", import.meta.url), "utf8");
assert.match(detailSource, /function enrichStoredStoreRecord\(product\)/);
assert.match(detailSource, /enrichStoreProductBySku/);
assert.doesNotMatch(detailSource, /ozonStoreQualifiedProductsV1/);

console.log("Store scanner tests passed.");
