import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const pricingSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/task-pricing-core.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
context.globalThis = context;
vm.runInContext(pricingSource, context, { filename: "task-pricing-core.js" });
const core = context.OzonTaskPricingCore;

assert.ok(core, "task pricing core must be installed");
assert.equal(core.chooseSource(350.9, 253.85), "competitor");
assert.equal(core.chooseSource(253.85, 280.74), "page");
assert.equal(core.selectedCommission(600, [12, 14, 18]), 14);
assert.equal(core.selectedCommission(600.01, [12, 14, 18]), 18);

const trustedFallbackTask = {
  qualification: { status: "qualified", source: "batch_store_scan" },
  ozon: {
    sku: "5245965643",
    commissions: [12, 12.5, 12.5],
    lengthMm: 50,
    widthMm: 220,
    heightMm: 150,
    weightG: 487,
  },
};
assert.deepEqual(JSON.parse(JSON.stringify(core.trustedBatchScanSnapshot(trustedFallbackTask))), {
  sku: "5245965643",
  commissionOptions: [12, 12.5, 12.5],
  lengthCm: 5,
  widthCm: 22,
  heightCm: 15,
  weightKg: 0.487,
});
assert.equal(core.trustedBatchScanSnapshot({ ...trustedFallbackTask, qualification: { status: "qualified", source: "legacy" } }), null);

const freight = core.calculateFreight({ greenPrice: 253.85, weightKg: 2.1, lengthCm: 80, widthCm: 12, heightCm: 12 });
assert.equal(freight.route, "CEL Economy Big");
assert.equal(freight.price, 80.61);

const task = {
  ozon: {
    productUrl: "https://www.ozon.ru/product/example-4984098622/",
    pagePrice: 999.99,
    competitorPrice: 888.88,
    commissions: [1, 2, 3],
    selectedCommission: 2,
    lengthMm: 1,
    widthMm: 1,
    heightMm: 1,
    weightG: 1,
  },
};
const result = core.buildTaskPricing(task, {
  source: "competitor",
  sourceUrl: "https://www.ozon.ru/product/source-5382620664/",
  pageGreenPrice: 350.9,
  minCompetitorPrice: 253.85,
  product: {
    erpLoaded: true,
    selectionQualified: true,
    competitorPriceResolved: true,
    commissionOptions: [12, 17, 17],
    lengthCm: 80,
    widthCm: 12,
    heightCm: 12,
    weightKg: 2.1,
  },
}, 266.36, "https://www.ozon.ru/product/source-5382620664/");
assert.equal(result.effectiveGreenPrice, 253.85);
assert.equal(result.originalBlackPrice, 266.36);
assert.equal(result.blackPriceSource, "competitor");
assert.equal(result.internationalFreight, 80.61);
assert.equal(result.freightRoute, "CEL Economy Big");
assert.ok(result.maxPurchaseCostAt18Pct > 0);
assert.equal(result.selectedCommission, 17);
assert.equal(result.lengthMm, 800);

const partialBase = core.buildTaskPricingBase(task, {
  source: "competitor",
  sourceUrl: "https://www.ozon.ru/product/source-5382620664/",
  pageGreenPrice: 350.9,
  minCompetitorPrice: 253.85,
  product: {
    erpLoaded: true,
    selectionQualified: true,
    competitorPriceResolved: true,
    commissionOptions: [12, 17, 17],
    lengthCm: 80,
    widthCm: 12,
    heightCm: 12,
    weightKg: 2.1,
  },
}, "https://www.ozon.ru/product/source-5382620664/");
assert.equal(partialBase.effectiveGreenPrice, 253.85);
assert.equal(partialBase.blackPriceSource, "competitor");
assert.equal(partialBase.internationalFreight, 80.61);
assert.equal(partialBase.originalBlackPrice, undefined);

const singlePriceResult = core.buildTaskPricing(task, {
  source: "competitor",
  sourceUrl: "https://www.ozon.ru/product/source-5594634396/",
  pageGreenPrice: 650,
  minCompetitorPrice: 582.93,
  product: {
    erpLoaded: true,
    selectionQualified: true,
    competitorPriceResolved: true,
    commissionOptions: [12, 17, 17],
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    weightKg: 1,
  },
}, 582.93, "https://www.ozon.ru/product/source-5594634396/");
assert.equal(singlePriceResult.effectiveGreenPrice, 582.93);
assert.equal(singlePriceResult.originalBlackPrice, 582.93);
assert.ok(singlePriceResult.maxPurchaseCostAt18Pct >= 0);

assert.throws(() => core.buildTaskPricing(task, {
  source: "competitor",
  sourceUrl: "https://www.ozon.ru/product/source-5382620664/",
  pageGreenPrice: 350.9,
  minCompetitorPrice: 253.85,
  product: {
    erpLoaded: true,
    selectionQualified: false,
    competitorPriceResolved: true,
    commissionOptions: [12, 17, 17],
    lengthCm: 80,
    widthCm: 12,
    heightCm: 12,
    weightKg: 2.1,
  },
}, 266.36, "https://www.ozon.ru/product/source-5382620664/"), /产品不合要求/);

const webContext = vm.createContext({});
webContext.globalThis = webContext;
const webPricingSource = fs.readFileSync(new URL("../web-src/pricing-core.js", import.meta.url), "utf8");
vm.runInContext(`${webPricingSource}\n;globalThis.__pricingCore = OzonPricingCore;`, webContext, { filename: "pricing-core.js" });
const webCore = webContext.__pricingCore;
const atLimit = webCore.calc({
  green: result.effectiveGreenPrice,
  black: result.originalBlackPrice,
  commission: result.selectedCommission,
  cost: result.maxPurchaseCostAt18Pct,
  freight: result.internationalFreight,
});
const aboveLimit = webCore.calc({
  green: result.effectiveGreenPrice,
  black: result.originalBlackPrice,
  commission: result.selectedCommission,
  cost: result.maxPurchaseCostAt18Pct + 0.01,
  freight: result.internationalFreight,
});
assert.ok(atLimit.margin >= 0.18, `floor limit must retain at least 18%, got ${atLimit.margin}`);
assert.ok(aboveLimit.margin < 0.18, `one cent above limit must fall below 18%, got ${aboveLimit.margin}`);

assert.throws(() => core.buildTaskPricing({ ozon: {} }, {}, 0, ""), /核价字段不完整/);
assert.throws(() => core.buildTaskPricing(task, {
  source: "competitor",
  pageGreenPrice: 0,
  minCompetitorPrice: 0,
  product: { erpLoaded: false, selectionQualified: false, competitorPriceResolved: false },
}, 266.36, ""), /产品不合要求|当前页面绿标价|当前毛子ERP数据/);
assert.throws(() => core.buildTaskPricing(task, {
  source: "competitor",
  sourceUrl: "https://www.ozon.ru/product/source-5382620664/",
  pageGreenPrice: 350.9,
  minCompetitorPrice: 253.85,
  product: {
    erpLoaded: true,
    selectionQualified: true,
    competitorPriceResolved: true,
    commissionOptions: [12, 17, 17],
    lengthCm: 80,
    widthCm: 12,
    heightCm: 12,
    weightKg: 2.1,
  },
}, 200, ""), /黑标价低于同源绿标价/);

const backgroundSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/content.js", import.meta.url), "utf8");
const enrichmentSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/sourcing-enrichment.js", import.meta.url), "utf8");
const enrichmentHtmlSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/sourcing-enrichment.html", import.meta.url), "utf8");
assert.match(backgroundSource, /readOzonTaskPricing/);
assert.match(backgroundSource, /task-pricing-core\.js/);
assert.match(backgroundSource, /await chrome\.tabs\.update\(tab\.id, \{ url: sourceUrl/);
assert.match(backgroundSource, /waitForOzonProductNavigation/);
assert.match(backgroundSource, /productSkuFromUrl/);
assert.match(backgroundSource, /document\.readyState/);
assert.doesNotMatch(backgroundSource, /tab\.status === "complete" && \(!targetSku/);
assert.match(backgroundSource, /任务商品页/);
assert.match(backgroundSource, /最低跟卖商品页/);
assert.match(backgroundSource, /snapshot\.disqualified/);
assert.match(backgroundSource, /partial:\s*true/);
assert.match(backgroundSource, /buildTaskPricingBase/);
assert.match(backgroundSource, /try\s*\{\s*await waitForOzonProductNavigation[\s\S]*?await injectTaskPricingCollector/);
assert.match(contentSource, /collectOzonTaskPricingSnapshot/);
assert.match(contentSource, /findLowestCompetitorProduct/);
assert.match(contentSource, /stableCount >= 3/);
assert.match(contentSource, /competitorPriceResolved/);
assert.match(contentSource, /collectProduct\(\{ enrichStoreRecord: false \}\)/);
assert.match(contentSource, /selectionQualificationState/);
assert.match(contentSource, /dataPending:\s*true/);
assert.match(contentSource, /Ozon官方价格组件/);
assert.doesNotMatch(contentSource, /product\.erpLoaded && !product\.selectionQualified/);
assert.match(contentSource, /selectionQualified/);
assert.match(contentSource, /trustedQualified/);
assert.match(contentSource, /qualificationSource = "batch_store_scan"/);
assert.match(contentSource, /产品不合要求：页面明确显示非符合要求的选品标签/);
assert.match(contentSource, /greenPrice:\s*product\.greenPrice/);
assert.doesNotMatch(contentSource, /collectCandidates\(document\.body\)/);
assert.match(contentSource, /parent\.closest\("#mz-black-price-tag"\)/);
assert.doesNotMatch(contentSource, /erpLoaded:\s*raw\.includes\("毛子ERP"\)/);
assert.doesNotMatch(contentSource, /num\(hints\.(?:pagePrice|competitorPrice)\)/);
assert.doesNotMatch(pricingSource, /task\?\.ozon\?\.(?:pagePrice|competitorPrice|commissions|selectedCommission|lengthMm|weightG)/);
assert.match(enrichmentSource, /pending_pinduoduo_search/);
assert.match(enrichmentSource, /maxPurchaseCostAt18Pct/);
assert.match(enrichmentSource, /ozonSourcingEnrichmentQueueV1/);
assert.match(enrichmentSource, /await persistQueue\(\)/);
assert.match(enrichmentSource, /mainImageState\(task\) === "completed" && pricingState\(task\) === "completed"/);
assert.match(enrichmentSource, /live-trusted-snapshot-fallback-v10/);
assert.match(enrichmentSource, /preserveBatchScanSnapshot/);
assert.match(backgroundSource, /trustedBatchScanSnapshot/);
assert.match(backgroundSource, /snapshotFallback/);
assert.match(backgroundSource, /未切换到任务商品\|未在\\d\+秒内进入任务SKU/);
assert.match(backgroundSource, /chrome\.tabs\.reload\(tabId\)/);
assert.match(contentSource, /snapshotFallbackFields/);
assert.match(backgroundSource, /snapshotResponse\.snapshot\?\.dataPending/);
assert.match(backgroundSource, /runWithForegroundTabWakeup\([\s\S]*?collectTaskPricingSnapshot\(tab\.id, task, 6000\)/);
assert.match(backgroundSource, /trustedQualified/);
assert.match(backgroundSource, /source === "batch_store_scan"/);
assert.match(backgroundSource, /readOriginalBlackPriceWithQuickWakeup\(tab\.id, 6000, 6000\)/);
assert.match(backgroundSource, /minCompetitorPrice:\s*Number\(sourcePricing\.sourceGreenPrice\)/);
assert.match(enrichmentSource, /response\.partial \? "failed" : "completed"/);
assert.match(enrichmentSource, /preserveLiveBase:\s*true/);
assert.match(enrichmentSource, /liveEnrichmentBase/);
assert.match(enrichmentSource, /rejected_not_qualified/);
assert.match(enrichmentSource, /pricingDisqualified/);
assert.match(enrichmentSource, /function clearTaskPricingValues\(task,/);
assert.match(enrichmentSource, /clearTaskPricingValues\(task\);\s*task\.enrichment\.ozonPricingStatus = "running"/);
assert.match(enrichmentSource, /旧版核价结果已作废/);
assert.match(enrichmentSource, /\["completed", "disqualified", "failed", "running"\]\.includes/);
assert.match(enrichmentSource, /task\.ozon\.selectionQualified = null/);
assert.match(enrichmentSource, /function discardLegacyQualificationMigration/);
assert.match(enrichmentSource, /migratedFromLegacyBatch !== true/);
assert.match(enrichmentSource, /旧JSON的推断资格与核价结果已撤销/);
assert.match(enrichmentSource, /ozonPricingMethodVersion:\s*null/);
assert.doesNotMatch(enrichmentSource, /function ensureQualificationProvenance/);
assert.match(enrichmentSource, /async function runCombinedEnrichment/);
assert.match(enrichmentSource, /await enrichMainImageTask\(task\);[\s\S]*?await enrichPricingTask\(task\);/);
assert.match(enrichmentSource, /allButton\.addEventListener\("click", runCombinedEnrichment\)/);
assert.match(enrichmentHtmlSource, /主图→核价→保存/);
assert.match(enrichmentHtmlSource, /id="startAll"/);

console.log("Ozon task pricing enrichment tests passed.");
