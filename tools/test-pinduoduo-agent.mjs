import assert from "node:assert/strict";
import fs from "node:fs";
import { aiJudgementReadiness, applySelectedCandidate, candidateInspectionOrder, detectPinduoduoRiskPage, extractPinduoduoCandidates, extractPinduoduoDetail, extractPinduoduoSkuSheet, findUiNode, isTrustedOzonImageUrl, normalizeAiJudgement, normalizeSkuSelection, parseMumuInfo, parsePinduoduoRoute, parseUiNodes, pinduoduoFavoriteState, pinduoduoProductGoodsId, queueStats, reconcilePinduoduoDisplayedPrice, resolveAiRecommendedCandidate, safeTaskFileName, taskReadiness } from "../pinduoduo-agent/core.mjs";
import { applyFinalOzonPricing, preliminaryPricingDecision } from "../pinduoduo-agent/public/pricing-flow.js";
import { isTrustedPinduoduoImageUrl } from "../pinduoduo-agent/qwen-client.mjs";

assert.equal(isTrustedOzonImageUrl("https://ir.ozone.ru/s3/multimedia-test/wc1000/1.jpg"), true);
assert.equal(isTrustedOzonImageUrl("http://ir.ozone.ru/s3/multimedia-test/1.jpg"), false);
assert.equal(isTrustedOzonImageUrl("https://example.com/s3/multimedia-test/1.jpg"), false);
assert.equal(isTrustedPinduoduoImageUrl("https://img.pddpic.com/a.jpeg"), true);
assert.equal(isTrustedPinduoduoImageUrl("https://t00img.yangkeduo.com/goods/a.jpg"), true);
assert.equal(isTrustedPinduoduoImageUrl("http://t00img.yangkeduo.com/goods/a.jpg"), false);
assert.equal(isTrustedPinduoduoImageUrl("https://yangkeduo.com.evil.example/a.jpg"), false);

assert.deepEqual(parseMumuInfo('{"index":"0","name":"工作室","android_version":"15.0","is_process_started":true,"is_android_started":true,"error_code":0}'), {
  index: "0", name: "工作室", androidVersion: "15.0", processStarted: true, androidStarted: true, errorCode: 0,
});
assert.equal(parseMumuInfo("not-json").errorCode, -1);
assert.equal(safeTaskFileName("ozon:123 / test"), "ozon_123_test");

const uiNodes = parseUiNodes('<?xml version="1.0"?><hierarchy><node text="" resource-id="" class="android.view.View" content-desc="拍照搜索" clickable="false" bounds="[0,0][900,1600]" /><node text="" resource-id="pdd" class="android.view.View" content-desc="拍照搜索" clickable="true" bounds="[831,57][900,90]" /></hierarchy>');
assert.equal(uiNodes.length, 2);
assert.deepEqual(findUiNode(uiNodes, ["拍照搜索"])?.bounds, [831, 57, 900, 90]);
assert.equal(detectPinduoduoRiskPage([{ text: "实名认证提示" }, { text: "检测到账户存在风险，为了账号安全，已限制部分操作" }]).type, "real_name_verification");
assert.equal(detectPinduoduoRiskPage([{ text: "请将正脸置于框内" }]).type, "face_verification");
assert.equal(detectPinduoduoRiskPage([{ text: "搜图片同款" }, { text: "全场包邮" }]).blocked, false);
assert.equal(pinduoduoProductGoodsId("https://mobile.yangkeduo.com/goods.html?goods_id=904359973664"), "904359973664");
assert.equal(pinduoduoProductGoodsId("http://mobile.yangkeduo.com/goods.html?goods_id=1"), "");
assert.equal(pinduoduoProductGoodsId("https://evil.example/goods.html?goods_id=1"), "");
assert.equal(pinduoduoFavoriteState([{ text: "收藏", clickable: false }, { description: "收藏", clickable: true, bounds: [128, 1519, 245, 1600] }]).status, "not_favorited");
assert.equal(pinduoduoFavoriteState([{ text: "已收藏", clickable: false }]).status, "favorited");
assert.deepEqual(extractPinduoduoCandidates([
  { text: "皇冠外压条", description: "皇冠外压条\n", resourceId: "com.xunmeng.pinduoduo:id/tv_title", bounds: [12, 759, 436, 783] },
  { text: "23.79", description: "", resourceId: "com.xunmeng.pinduoduo:id/pdd", bounds: [23, 823, 80, 853] },
  { text: "22.24", description: "", resourceId: "com.xunmeng.pinduoduo:id/pdd", bounds: [514, 823, 571, 853] },
])[0].displayedPrice, 23.79);

const route = parsePinduoduoRoute('"url": "goods.html?thumb_url=https%3A%2F%2Fimg.pddpic.com%2Fa.jpeg&goods_id=959747943297&page_from=23"');
assert.equal(route.goodsId, "959747943297");
assert.equal(route.sourceUrl, "https://mobile.yangkeduo.com/goods.html?goods_id=959747943297");
assert.equal(route.thumbnailUrl, "https://img.pddpic.com/a.jpeg");
assert.equal(parsePinduoduoRoute('"url": "https:\\/\\/mobile.yangkeduo.com\\/goods.html?source_app=com.android.shell&goods_id=338478848894&pr_force_native=1"').goodsId, "338478848894");
const skuSheet = extractPinduoduoSkuSheet([
  { text: "已选: 丝杠组合", clickable: false, bounds: [216, 355, 886, 388] },
  { text: "丝杠组合  ¥51", clickable: true, bounds: [18, 635, 200, 681] },
  { text: "挡片一套  ¥31", clickable: true, bounds: [210, 635, 390, 681] },
  { text: "使用多多支付余额¥5.05，更换支付方式", clickable: false, bounds: [237, 1468, 644, 1497] },
  { text: "提交订单 ¥45.95", clickable: false, bounds: [357, 1538, 542, 1573] },
]);
assert.equal(skuSheet.options.length, 2);
assert.equal(skuSheet.options[0].price, 51);
assert.equal(skuSheet.selectedOptionId, "sku-option-1");
assert.equal(skuSheet.accountSpecificDiscountVisible, true);
assert.equal(skuSheet.submitPrice, 45.95);
assert.equal(skuSheet.multiDimension, false);
assert.equal(extractPinduoduoSkuSheet([
  { text: "颜色", clickable: false },
  { text: "黑色  ¥20", clickable: true, bounds: [1, 1, 20, 20] },
  { text: "尺寸", clickable: false },
  { text: "大号  ¥30", clickable: true, bounds: [1, 30, 20, 50] },
]).multiDimension, true);
assert.equal(normalizeSkuSelection({ verdict: "exact_match", selectedOptionId: "sku-option-1", confidence: 93, reason: "套装一致", needsHumanReview: false }, skuSheet.options).needsHumanReview, false);
assert.equal(normalizeSkuSelection({ verdict: "exact_match", selectedOptionId: "missing", confidence: 99, needsHumanReview: false }, skuSheet.options).needsHumanReview, true);
const detail = extractPinduoduoDetail([
  { text: "", description: "¥70已拼44件最后6件", resourceId: "pdd", bounds: [0, 495, 900, 545] },
  { text: "", description: "Milwaukee美沃奇内六角扳手套装", resourceId: "com.xunmeng.pinduoduo:id/tv_title", bounds: [18, 563, 882, 589] },
  { text: "全场包邮", description: "", resourceId: "", bounds: [432, 886, 516, 915] },
], route);
assert.equal(detail.displayedPrice, 70);
assert.equal(detail.shippingFee, 0);
assert.equal(detail.detailStatus, "detail_captured");
assert.deepEqual(detail.missingFields, []);
assert.equal(detail.rawPriceText, "¥70已拼44件最后6件");
const partialDetail = extractPinduoduoDetail([
  { text: "慢加载商品", description: "", resourceId: "com.xunmeng.pinduoduo:id/tv_title", bounds: [18, 563, 882, 589] },
], { goodsId: "123456", sourceUrl: "", thumbnailUrl: "" });
assert.equal(partialDetail.detailStatus, "detail_partial");
assert.equal(partialDetail.sourceUrl, "https://mobile.yangkeduo.com/goods.html?goods_id=123456");
assert.deepEqual(partialDetail.missingFields, ["price"]);
const missingRouteDetail = extractPinduoduoDetail([
  { text: "", description: "¥51", resourceId: "pdd", bounds: [0, 495, 900, 545] },
  { text: "测试商品", description: "", resourceId: "com.xunmeng.pinduoduo:id/tv_title", bounds: [18, 563, 882, 589] },
], {});
assert.equal(missingRouteDetail.detailStatus, "detail_incomplete");
assert.deepEqual(missingRouteDetail.missingFields, ["goods_id"]);
assert.deepEqual(reconcilePinduoduoDisplayedPrice(416, 4162, "¥4162人付款"), {
  displayedPrice: 416,
  rawDisplayedPrice: 4162,
  priceSource: "search_result_reconciled",
  priceCorrectionReason: "详情无障碍文本把价格与销量/件数拼接，已使用同一候选的搜索页价格",
});
assert.equal(reconcilePinduoduoDisplayedPrice(221, 221110, "¥221110人付款").displayedPrice, 221);
assert.equal(reconcilePinduoduoDisplayedPrice(411.84, 411.84, "¥411.84").displayedPrice, 411.84);
assert.equal(reconcilePinduoduoDisplayedPrice(56, 560, "¥560").displayedPrice, 560);
assert.equal(extractPinduoduoDetail([
  { text: "", description: "¥70", resourceId: "pdd", bounds: [0, 495, 900, 545] },
  { text: "测试商品", description: "", resourceId: "com.xunmeng.pinduoduo:id/tv_title", bounds: [18, 563, 882, 589] },
  { text: "退货包运费", description: "", resourceId: "", bounds: [18, 886, 156, 915] },
], route).shippingIncluded, false);

const readyTask = {
  taskId: "ozon-123",
  status: "pending_pinduoduo_search",
  ozon: { sku: "123", name: "测试" },
  enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/wc1000/1.jpg", maxPurchaseCostAt18Pct: 88.88 },
  sourcing: { candidates: [] },
  pricing: {}, audit: {},
};
assert.equal(taskReadiness(readyTask).ready, true);
assert.equal(taskReadiness({ ...readyTask, status: "pending_ozon_enrichment" }).ready, false);
const result = applySelectedCandidate(readyTask, { purchaseCost: 80, sourceUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=1" }, { updatedAt: "2026-08-28T00:00:00.000Z" });
assert.equal(result.eligibleAt18Pct, true);
assert.equal(readyTask.pricing.purchaseCost, 80);
assert.equal(readyTask.pricing.eligibleAt18Pct, true);
assert.equal(readyTask.status, "pending_human_review");
assert.equal(applySelectedCandidate({ ...readyTask, status: "pending_pinduoduo_search", enrichment: { ...readyTask.enrichment, maxPurchaseCostAt18Pct: 70 }, sourcing: { candidates: [] }, pricing: {}, audit: {} }, { purchaseCost: 80 }).eligibleAt18Pct, false);
assert.deepEqual(queueStats({ tasks: [readyTask, { status: "pending_ozon_enrichment" }] }), { total: 2, ready: 1, blocked: 1, priced: 1, eligible: 1 });
const preliminaryTask = { enrichment: { maxPurchaseCostAt18Pct: 50.93 }, pricing: {} };
assert.deepEqual(preliminaryPricingDecision(preliminaryTask, 51, Date.parse("2026-08-29T00:00:00Z")), { status: "rejected_preliminary", needsRefresh: false, eligible: false, preliminaryLimit: 50.93 });
assert.equal(preliminaryPricingDecision(preliminaryTask, 50, Date.parse("2026-08-29T00:00:00Z")).needsRefresh, true);
const refreshedTask = { enrichment: { maxPurchaseCostAt18Pct: 50.93 }, pricing: { finalOzonPricing: { status: "completed", fetchedAt: "2026-08-29T00:00:00Z", maxPurchaseCostAt18Pct: 36.17 } } };
assert.equal(preliminaryPricingDecision(refreshedTask, 50, Date.parse("2026-08-29T00:10:00Z")).eligible, false);
assert.equal(preliminaryPricingDecision(refreshedTask, 20, Date.parse("2026-08-29T00:31:00Z")).needsRefresh, true);
const appliedTask = { ozon: {}, enrichment: { maxPurchaseCostAt18Pct: 50.93 }, pricing: {} };
assert.equal(applyFinalOzonPricing(appliedTask, { ok: true, effectiveGreenPrice: 121.18, originalBlackPrice: 128.95, internationalFreight: 52.52, selectedCommission: 20, maxPurchaseCostAt18Pct: 36.17, calculation: {} }, 51, "2026-08-29T00:00:00Z").eligibleAt18Pct, false);
assert.equal(appliedTask.pricing.preliminaryMaxPurchaseCostAt18Pct, 50.93);
const aiTask = { ...readyTask, sourcing: { searchCandidates: [{ detail: { detailStatus: "detail_captured" } }] } };
assert.equal(aiJudgementReadiness(aiTask).ready, true);
assert.equal(aiJudgementReadiness({ ...aiTask, sourcing: { searchCandidates: [] } }).ready, false);
assert.deepEqual(normalizeAiJudgement({ bestCandidateIndex: 1, verdict: "same_product", confidence: 91, specConflicts: [], reason: "型号与套装一致", needsHumanReview: false, candidateAssessments: [{ candidateIndex: 1, verdict: "same_product", confidence: 91, differences: [] }] }, 1), {
  bestCandidateIndex: 1, verdict: "same_product", confidence: 91, specConflicts: [], reason: "型号与套装一致", needsHumanReview: false,
  candidateAssessments: [{ candidateIndex: 1, verdict: "same_product", confidence: 91, differences: [] }],
});
assert.equal(normalizeAiJudgement({ bestCandidateIndex: 4, verdict: "same_product", confidence: 70, needsHumanReview: false }, 3).needsHumanReview, true);
const mappedCandidate = { candidateId: "visible-2", sourceUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=2", detail: { detailStatus: "detail_captured" } };
assert.equal(resolveAiRecommendedCandidate({ sourcing: { searchCandidates: [{ candidateId: "visible-1", detail: { detailStatus: "detail_failed" } }, mappedCandidate] } }, { bestCandidateIndex: 1, bestCandidateId: "visible-2" }), mappedCandidate);
assert.deepEqual(candidateInspectionOrder([{ displayedPrice: 160.36 }, { displayedPrice: 180 }, { displayedPrice: 139 }, { displayedPrice: 188 }]), [2, 0, 1, 3]);
assert.deepEqual(candidateInspectionOrder([{ displayedPrice: 67.2 }, { displayedPrice: 139 }, { displayedPrice: 71 }, { displayedPrice: 48 }]), [3, 0, 1, 2]);

const serverSource = fs.readFileSync(new URL("../pinduoduo-agent/server.mjs", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../pinduoduo-agent/public/app.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../pinduoduo-agent/public/index.html", import.meta.url), "utf8");
const qwenSource = fs.readFileSync(new URL("../pinduoduo-agent/qwen-client.mjs", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/pinduoduo-bridge.js", import.meta.url), "utf8");
const extensionManifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));
assert.match(serverSource, /127\.0\.0\.1/);
assert.match(serverSource, /MuMuManager\.exe/);
assert.match(serverSource, /PINDUODUO_PACKAGE/);
assert.match(serverSource, /MEDIA_SCANNER_SCAN_FILE/);
assert.match(serverSource, /x-ozon-agent/);
assert.match(serverSource, /PINDUODUO_RISK_CONTROL/);
assert.match(serverSource, /captureCandidateEvidence/);
assert.match(serverSource, /\/api\/ai\/judge/);
assert.match(serverSource, /\/api\/pinduoduo\/favorite/);
assert.match(serverSource, /\/api\/pinduoduo\/open/);
assert.match(serverSource, /\/api\/pinduoduo\/sku-options/);
assert.match(serverSource, /\/api\/pinduoduo\/select-sku/);
assert.match(serverSource, /\/api\/ai\/select-sku/);
assert.doesNotMatch(serverSource, /tapBounds\([^\n]*提交订单/);
assert.match(serverSource, /inspectCandidateDetail/);
assert.match(serverSource, /maxAttempts = 2/);
assert.match(serverSource, /completed >= successLimit/);
assert.match(serverSource, /detail_partial/);
assert.match(serverSource, /createTimingTrace/);
assert.match(serverSource, /timingSnapshot/);
assert.match(serverSource, /候选\$\{index \+ 1\}详情读取/);
assert.match(serverSource, /findUiNode\(ui\.nodes, \["搜图片同款"\]\)/);
assert.match(serverSource, /1200 \+ Math\.floor\(Math\.random\(\) \* 1401\)/);
assert.match(serverSource, /hasPurchaseOverlay/);
assert.match(appSource, /pending_pinduoduo_search/);
assert.match(appSource, /x-ozon-agent/);
assert.match(appSource, /eligibleAt18Pct/);
assert.match(appSource, /localStorage\.setItem/);
assert.match(appSource, /candidateSearchComplete/);
assert.match(appSource, /async function runBatch/);
assert.match(appSource, /batch\.paused/);
assert.match(appSource, /batch\.stopRequested/);
assert.match(appSource, /search_failed_retryable/);
assert.match(appSource, /AI判断失败/);
assert.match(qwenSource, /evidenceWarnings/);
assert.match(appSource, /const appVersion = "MVP 5\.1"/);
assert.doesNotMatch(appSource, /MVP 4\.1/);
assert.match(appSource, /batchDelayRangeMs/);
assert.match(appSource, /paused_risk_control/);
assert.match(appSource, /async function runAiBatch/);
assert.match(appSource, /async function favoriteRecommendedCandidate/);
assert.match(appSource, /async function openCandidateInApp/);
assert.match(appSource, /在App打开/);
assert.match(appSource, /已收藏/);
assert.match(appSource, /搜索页价/);
assert.match(appSource, /requestFinalOzonPricing/);
assert.match(appSource, /preliminaryPricingDecision/);
assert.match(appSource, /aiJudgement/);
assert.match(appSource, /detail_not_inspected/);
assert.match(appSource, /详情读取失败/);
assert.match(appSource, /链接已取得/);
assert.match(appSource, /searchTiming/);
assert.match(appSource, /renderTimingPanel/);
assert.match(indexSource, /id="timingSummary"/);
assert.match(indexSource, /id="timingRows"/);
assert.match(appSource, /详情缺/);
assert.doesNotMatch(appSource, /链接未取得/);
assert.match(qwenSource, /qwen3\.7-flash/);
assert.match(qwenSource, /enable_thinking: false/);
assert.match(qwenSource, /response_format/);
assert.match(qwenSource, /bestCandidateId/);
assert.match(qwenSource, /selectSkuOptionWithQwen/);
assert.match(bridgeSource, /OZON_FINAL_REPRICE_REQUEST_V1/);
assert.match(bridgeSource, /http:\/\/127\.0\.0\.1:17628/);
assert.match(bridgeSource, /validTask/);
assert.equal(extensionManifest.version, "0.6.29");
assert.ok(extensionManifest.content_scripts.some((entry) => entry.matches?.includes("http://127.0.0.1:17628/*") && entry.js?.includes("pinduoduo-bridge.js")));
assert.doesNotMatch(qwenSource, /sk-[A-Za-z0-9]{12,}/);
console.log("Pinduoduo agent core tests passed.");
