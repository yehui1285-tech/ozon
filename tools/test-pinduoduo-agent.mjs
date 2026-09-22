import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { aiJudgementReadiness, applySelectedCandidate, candidateInspectionOrder, detectPinduoduoRiskPage, extractPinduoduoCandidates, extractPinduoduoDetail, extractPinduoduoSkuSheet, findUiNode, isTrustedOzonImageUrl, normalizeAiJudgement, normalizeSkuSelection, parseMumuInfo, parsePinduoduoRoute, parseUiNodes, pinduoduoFavoriteState, pinduoduoProductGoodsId, queueStats, reconcilePinduoduoDisplayedPrice, resolveAiRecommendedCandidate, safeTaskFileName, taskReadiness } from "../pinduoduo-agent/core.mjs";
import { applyFinalOzonPricing, createFinalPricingRequestGuard, MAX_OZON_PREVIEW_MONEY, preliminaryPricingDecision, previewFinalOzonPricing } from "../pinduoduo-agent/public/pricing-flow.js";
import * as sourcingFlow from "../pinduoduo-agent/public/sourcing-flow.js";
import { buildFinalConfirmation, confirmRecommendation, rejectRecommendation } from "../pinduoduo-agent/sourcing-core.mjs";
import { isTrustedPinduoduoImageUrl } from "../pinduoduo-agent/qwen-client.mjs";

const refreshSessionCoreA = await import(new URL("../pinduoduo-agent/sourcing-core.mjs?task7-round2-session-a", import.meta.url));
const refreshSessionCoreB = await import(new URL("../pinduoduo-agent/sourcing-core.mjs?task7-round2-session-b", import.meta.url));
const refreshFallbackCoreA = await import(new URL("../pinduoduo-agent/sourcing-core.mjs?task7-round3-fallback-a", import.meta.url));
const refreshFallbackCoreB = await import(new URL("../pinduoduo-agent/sourcing-core.mjs?task7-round3-fallback-b", import.meta.url));

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

const uiNodes = parseUiNodes('<?xml version="1.0"?><hierarchy><node text="" resource-id="" class="android.view.View" content-desc="拍照搜索" clickable="false" bounds="[0,0][900,1600]" /><node text="" resource-id="pdd" class="android.view.View" content-desc="拍照搜索" clickable="true" selected="true" enabled="true" bounds="[831,57][900,90]" /></hierarchy>');
assert.equal(uiNodes.length, 2);
assert.deepEqual(findUiNode(uiNodes, ["拍照搜索"])?.bounds, [831, 57, 900, 90]);
assert.equal(findUiNode(uiNodes, ["拍照搜索"])?.selected, true);
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
assert.equal(skuSheet.submitVisible, true);
assert.equal(skuSheet.submitPrice, 45.95);
assert.equal(skuSheet.multiDimension, false);
const separatedPriceSheet = extractPinduoduoSkuSheet([
  { text: "仅2件 ¥56 限1件", clickable: false, bounds: [20, 180, 400, 230] },
  { text: "颜色", clickable: false, bounds: [20, 300, 100, 340] },
  { text: "紫色", clickable: true, enabled: true, selected: true, bounds: [20, 350, 120, 400] },
  { text: "深灰色", clickable: true, enabled: true, selected: false, bounds: [140, 350, 260, 400] },
  { text: "已折叠2个售罄款式", clickable: false, bounds: [20, 430, 300, 470] },
  { text: "0元下单，确认收货后付款¥56", clickable: true, bounds: [0, 1500, 900, 1600] },
]);
assert.equal(separatedPriceSheet.options.length, 2);
assert.deepEqual(separatedPriceSheet.options.map((option) => option.label), ["紫色", "深灰色"]);
assert.deepEqual(separatedPriceSheet.options.map((option) => option.price), [null, null]);
assert.equal(separatedPriceSheet.headerPrice, 56);
assert.equal(separatedPriceSheet.selectedOptionId, "sku-option-1");
assert.equal(separatedPriceSheet.multiDimension, false);
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
const legacyResponse = { ok: true, maxPurchaseCostAt18Pct: 36.166, calculation: { legacy: true } };
const legacyTask = { ozon: {}, enrichment: { maxPurchaseCostAt18Pct: 50.93 }, pricing: {} };
const legacyFinal = applyFinalOzonPricing(legacyTask, legacyResponse, 36.174, "not-an-iso-time");
assert.deepEqual(legacyFinal, { finalLimit: 36.166, eligibleAt18Pct: false },
  "legacy pricing must compare the rounded purchase cost to the original final limit");
assert.equal(legacyTask.enrichment.maxPurchaseCostAt18Pct, 36.166, "legacy pricing must retain the source limit exactly");
assert.equal(legacyTask.pricing.purchaseCost, 36.17, "legacy purchase cost keeps its historical two-decimal write");
assert.equal(legacyTask.pricing.eligibleAt18Pct, false);
assert.equal(legacyTask.pricing.finalOzonPricing.fetchedAt, "not-an-iso-time", "legacy writes must not impose preview ISO rules");
assert.equal(legacyTask.pricing.finalOzonPricing.effectiveGreenPrice, null, "legacy missing optional values remain null");
assert.equal(legacyTask.pricing.finalOzonPricing.originalBlackPrice, null, "legacy missing optional values remain null");
assert.equal(legacyTask.pricing.finalOzonPricing.internationalFreight, null, "legacy missing optional values remain null");
assert.equal(legacyTask.pricing.finalOzonPricing.selectedCommission, null, "legacy missing optional values remain null");
assert.strictEqual(legacyTask.enrichment.pricingCalculation, legacyResponse.calculation, "legacy calculation write preserves its original reference behavior");
const previewTask = { enrichment: { maxPurchaseCostAt18Pct: 50 }, pricing: { preserved: true }, audit: { preserved: true } };
const previewResponse = {
  ok: true,
  maxPurchaseCostAt18Pct: 36.166,
  effectiveGreenPrice: 121.186,
  originalBlackPrice: 128.954,
  internationalFreight: 52.526,
  selectedCommission: 20,
  calculation: { margin: { value: 18 }, routes: ["RU"] },
};
const previewTaskBefore = JSON.stringify(previewTask);
const previewResponseBefore = JSON.stringify(previewResponse);
const preview = previewFinalOzonPricing(previewTask, previewResponse, 36.174, "2026-08-31T00:00:00.000Z");
assert.deepEqual(preview, {
  status: "completed",
  fetchedAt: "2026-08-31T00:00:00.000Z",
  purchaseCost: 36.17,
  maxPurchaseCostAt18Pct: 36.17,
  eligibleAt18Pct: true,
  effectiveGreenPrice: 121.19,
  originalBlackPrice: 128.95,
  internationalFreight: 52.53,
  selectedCommission: 20,
  calculation: { margin: { value: 18 }, routes: ["RU"] },
});
assert.equal(JSON.stringify(previewTask), previewTaskBefore, "preview must not mutate a task on success");
assert.equal(JSON.stringify(previewResponse), previewResponseBefore, "preview must not mutate a response on success");
assert.notStrictEqual(preview.calculation, previewResponse.calculation, "preview calculation must not share the response reference");
assert.notStrictEqual(preview.calculation.margin, previewResponse.calculation.margin, "preview calculation must be deeply cloned");
assert.equal(Object.isFrozen(preview.calculation), true, "preview calculation must be read-only");
assert.throws(() => { preview.calculation.margin.value = 19; }, TypeError, "preview calculation must not be mutable");
assert.equal(previewResponse.calculation.margin.value, 18, "preview calculation edits must not reach the response");
const zeroPreview = previewFinalOzonPricing({}, {
  ok: true,
  maxPurchaseCostAt18Pct: 0,
  effectiveGreenPrice: 0,
  originalBlackPrice: 0,
  internationalFreight: 0,
  selectedCommission: 0,
  calculation: null,
}, 0, "2026-08-31T00:00:00.000Z");
assert.equal(zeroPreview.purchaseCost, 0, "zero purchase cost must not be discarded");
assert.equal(zeroPreview.maxPurchaseCostAt18Pct, 0, "zero limit must not be discarded");
assert.equal(zeroPreview.effectiveGreenPrice, 0, "zero pricing fields must not become null");
assert.equal(zeroPreview.eligibleAt18Pct, true, "rounded equal zero values must be eligible");
assert.equal(previewFinalOzonPricing({}, previewResponse, 23, "2026-08-31T08:00:00+08:00").fetchedAt, "2026-08-31T08:00:00+08:00",
  "a calendar-valid ISO timestamp with an explicit offset must remain valid");
const boundaryPreview = previewFinalOzonPricing({}, {
  ok: true,
  maxPurchaseCostAt18Pct: MAX_OZON_PREVIEW_MONEY,
  effectiveGreenPrice: MAX_OZON_PREVIEW_MONEY,
  originalBlackPrice: MAX_OZON_PREVIEW_MONEY,
  internationalFreight: MAX_OZON_PREVIEW_MONEY,
  selectedCommission: MAX_OZON_PREVIEW_MONEY,
  calculation: {},
}, MAX_OZON_PREVIEW_MONEY, "2026-08-31T00:00:00.000Z");
assert.equal(boundaryPreview.purchaseCost, MAX_OZON_PREVIEW_MONEY, "preview accepts the documented money ceiling");
const previewMoneyFields = ["maxPurchaseCostAt18Pct", "effectiveGreenPrice", "originalBlackPrice", "internationalFreight", "selectedCommission"];
for (const unsafeMoney of [-0, -0.01, null, "", NaN, Infinity, -Infinity, "23", MAX_OZON_PREVIEW_MONEY + 0.01, Number.MAX_VALUE]) {
  assert.throws(() => previewFinalOzonPricing({}, previewResponse, unsafeMoney, "2026-08-31T00:00:00.000Z"), /Ozon最终复价响应不完整/,
    "preview purchase cost rejects every invalid money representation");
  for (const field of previewMoneyFields) {
    assert.throws(() => previewFinalOzonPricing({}, { ...previewResponse, [field]: unsafeMoney }, 23, "2026-08-31T00:00:00.000Z"), /Ozon最终复价响应不完整/,
      `preview ${field} rejects every invalid money representation`);
  }
}
for (const invalidMoney of [null, "", NaN, Infinity, "23", -1]) {
  const invalidTask = { pricing: { untouched: true } };
  const invalidResponse = { ...previewResponse, effectiveGreenPrice: invalidMoney };
  const beforeTask = JSON.stringify(invalidTask);
  const beforeResponse = JSON.stringify(invalidResponse);
  assert.throws(() => previewFinalOzonPricing(invalidTask, invalidResponse, 23, "2026-08-31T00:00:00.000Z"), /Ozon最终复价响应不完整/,
    "invalid response money must fail closed");
  assert.equal(JSON.stringify(invalidTask), beforeTask, "failed preview must not mutate a task");
  assert.equal(JSON.stringify(invalidResponse), beforeResponse, "failed preview must not mutate a response");
  assert.throws(() => previewFinalOzonPricing({}, previewResponse, invalidMoney, "2026-08-31T00:00:00.000Z"), /Ozon最终复价响应不完整/,
    "invalid purchase cost must fail closed");
}
assert.throws(() => previewFinalOzonPricing({}, { ...previewResponse, maxPurchaseCostAt18Pct: -0.01 }, 23, "2026-08-31T00:00:00.000Z"), /Ozon最终复价响应不完整/,
  "negative final limits must fail closed");
for (const invalidFetchedAt of [null, "", "not-an-iso-time", "2026-02-30T00:00:00.000Z"]) {
  assert.throws(() => previewFinalOzonPricing({}, previewResponse, 23, invalidFetchedAt), /Ozon最终复价响应不完整/,
    "invalid fetchedAt must fail closed");
}
const requestGuard = createFinalPricingRequestGuard();
const requestTask = { taskId: "ozon-request-1" };
const firstRequest = requestGuard.start(requestTask, "taskId:ozon-request-1");
const laterRequest = requestGuard.start(requestTask, "taskId:ozon-request-1");
assert.equal(requestGuard.isActive(requestTask, firstRequest, requestTask, "taskId:ozon-request-1"), false,
  "an earlier response must become stale when a later request starts");
assert.equal(requestGuard.isActive(requestTask, laterRequest, requestTask, "taskId:ozon-request-1"), true,
  "the latest request may apply only to its original task");
assert.equal(requestGuard.isActive(requestTask, laterRequest, { taskId: "ozon-request-1" }, "taskId:ozon-request-1"), false,
  "a response must not apply after the queue replaces the task object");
assert.equal(requestGuard.isActive(requestTask, laterRequest, requestTask, "taskId:changed"), false,
  "a response must not apply after its task identity changes");
requestGuard.finish(requestTask, laterRequest);
assert.equal(requestGuard.isActive(requestTask, laterRequest, requestTask, "taskId:ozon-request-1"), false,
  "a timed-out or completed request must not apply again");
const aiTask = { ...readyTask, sourcing: { searchCandidates: [{ detail: { detailStatus: "detail_captured" } }] } };
assert.equal(aiJudgementReadiness(aiTask).ready, true);
assert.equal(aiJudgementReadiness({ ...aiTask, sourcing: { searchCandidates: [] } }).ready, false);
assert.deepEqual(normalizeAiJudgement({ bestCandidateIndex: 1, verdict: "same_product", confidence: 91, specConflicts: [], reason: "型号与套装一致", needsHumanReview: false, candidateAssessments: [{ candidateIndex: 1, verdict: "same_product", confidence: 91, differences: [] }] }, 1), {
  bestCandidateIndex: 1, verdict: "same_product", confidence: 91, specConflicts: [], reason: "型号与套装一致", needsHumanReview: false,
  candidateAssessments: [{ candidateIndex: 1, verdict: "same_product", confidence: 91, differences: [] }],
});
assert.equal(normalizeAiJudgement({ bestCandidateIndex: 4, verdict: "same_product", confidence: 70, needsHumanReview: false }, 3).needsHumanReview, true);
const contradictoryJudgement = normalizeAiJudgement({
  bestCandidateIndex: 1,
  verdict: "same_product",
  confidence: 95,
  specConflicts: [],
  reason: "候选为公制内六角，与目标商品的TORX规格冲突，因此是最佳匹配品",
  needsHumanReview: false,
  candidateAssessments: [{ candidateIndex: 1, verdict: "same_product", confidence: 95, differences: ["规格类型为梅花与内六角，不匹配"] }],
}, 1);
assert.equal(contradictoryJudgement.verdict, "possible_match");
assert.equal(contradictoryJudgement.confidence, 84);
assert.equal(contradictoryJudgement.needsHumanReview, true);
assert.ok(contradictoryJudgement.specConflicts.some((entry) => entry.includes("关键差异")));
assert.ok(contradictoryJudgement.reason.includes("已降级为人工复核"));
assert.equal(normalizeAiJudgement({ bestCandidateIndex: 1, verdict: "same_product", confidence: 95, specConflicts: [], reason: "型号、数量和套装内容均无冲突", needsHumanReview: false, candidateAssessments: [{ candidateIndex: 1, verdict: "same_product", confidence: 95, differences: [] }] }, 1).needsHumanReview, false);
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

function createSourcingCoreBridge(coreModule) {
  return {
    buildFinalConfirmation(input) {
      return coreModule.buildFinalConfirmation({
        task: input.task,
        candidate: JSON.parse(JSON.stringify(input.candidate)),
        judgement: JSON.parse(JSON.stringify(input.judgement)),
        quote: JSON.parse(JSON.stringify(input.quote)),
        finalPricing: JSON.parse(JSON.stringify(input.finalPricing)),
      });
    },
    confirmRecommendation(task, pending, current, confirmedAt) {
      return coreModule.confirmRecommendation(task, pending, {
        task: current.task,
        candidate: JSON.parse(JSON.stringify(current.candidate)),
        judgement: JSON.parse(JSON.stringify(current.judgement)),
        quote: JSON.parse(JSON.stringify(current.quote)),
        finalPricing: JSON.parse(JSON.stringify(current.finalPricing)),
      }, confirmedAt);
    },
    rejectRecommendation: coreModule.rejectRecommendation,
  };
}

function createAppHarness({ apiHandler = null, extensionHandler = null, finalPricingResponse = null, storedValues = {}, sourcingFlowDeps = sourcingFlow, sourcingCoreModule = { buildFinalConfirmation, confirmRecommendation, rejectRecommendation }, clock = null, timers = null } = {}) {
  const listeners = new Set();
  const unloadListeners = new Set();
  const requests = [];
  const extensionRequests = [];
  const apiRequests = [];
  const elements = new Map();
  const element = () => ({
    style: {}, children: [], value: "", textContent: "", className: "", innerHTML: "", disabled: false, listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    removeEventListener(type) { this.listeners.delete(type); },
    click() { return this.listeners.get("click")?.({ target: this }); },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
  });
  const emitMessage = (data) => {
    for (const listener of listeners) listener({ source: fakeWindow, origin: fakeWindow.location.origin, data });
  };
  const fakeWindow = {
    location: { origin: "http://127.0.0.1:17628" },
    confirm() { return true; },
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); if (type === "beforeunload") unloadListeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); if (type === "beforeunload") unloadListeners.delete(listener); },
    postMessage(data) {
      if (data?.type === "OZON_FINAL_REPRICE_PING_V1") {
        Promise.resolve().then(() => emitMessage({ type: "OZON_FINAL_REPRICE_READY_V1", requestId: data.requestId }));
      } else if (data?.type === "OZON_FINAL_REPRICE_REQUEST_V1") {
        requests.push(data);
        if (finalPricingResponse) Promise.resolve().then(() => emitMessage({ type: "OZON_FINAL_REPRICE_RESPONSE_V1", requestId: data.requestId, ...finalPricingResponse }));
      } else if (data?.type === "OZON_SOURCING_EXTENSION_REQUEST_V1") {
        extensionRequests.push(data);
        Promise.resolve().then(async () => extensionHandler ? extensionHandler(data) : { ok: false, error: "test bridge missing" })
          .then((response) => emitMessage({ type: "OZON_SOURCING_EXTENSION_RESPONSE_V1", requestId: data.requestId, ...response }));
      }
    },
  };
  const savedQueue = JSON.stringify({ queue: { tasks: [], meta: { pinduoduoBatch: {} } }, sourceName: "test.json" });
  const context = {
    __pricingDeps: { applyFinalOzonPricing, createFinalPricingRequestGuard, preliminaryPricingDecision, previewFinalOzonPricing },
    __sourcingFlowDeps: {
      ...sourcingFlowDeps,
      // Copy VM-created diagnostic records into the module's realm. In the
      // browser both modules share one realm; the VM is only a test boundary.
      automaticCandidatePools: (value) => sourcingFlowDeps.automaticCandidatePools(JSON.parse(JSON.stringify(value || {}))),
    },
    // The VM owns app-created object literals while the imported safety module
    // is evaluated in this test realm. Keep the task reference intact for
    // Task 5's capability check, while copying only untrusted serial facts
    // across that artificial realm boundary.
    __sourcingCoreDeps: createSourcingCoreBridge(sourcingCoreModule),
    window: fakeWindow,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element,
      createTextNode(value) { return String(value); },
    },
    localStorage: {
      getItem(key) {
        if (Object.hasOwn(storedValues, key)) return storedValues[key];
        return Object.keys(storedValues).length ? null : savedQueue;
      },
      setItem(key, value) { storedValues[key] = value; },
    },
    fetch: async (path, options = {}) => {
      apiRequests.push({ path: String(path), options });
      const payload = apiHandler ? await apiHandler(String(path), options) : { ok: true, status: { configured: false, model: "test" } };
      return { ok: payload?.httpOk !== false, async json() { return payload; } };
    },
    URL, Blob, console, setTimeout: timers?.setTimeout || setTimeout, clearTimeout: timers?.clearTimeout || clearTimeout, AbortController, Date: clock?.Date || Date,
  };
  const appForVm = appSource
    .replace(/^import .* from "\.\/pricing-flow\.js";\r?$/m,
      "const { applyFinalOzonPricing, createFinalPricingRequestGuard, preliminaryPricingDecision, previewFinalOzonPricing } = globalThis.__pricingDeps;")
    .replace(/^import \* as sourcingFlow from "\.\/sourcing-flow\.js";\r?$/m, "const sourcingFlow = globalThis.__sourcingFlowDeps;")
    .replace(/^import \* as sourcingCore from "\/sourcing-core\.mjs";\r?$/m, "const sourcingCore = globalThis.__sourcingCoreDeps;")
    + "\nglobalThis.__appTest = { mergeJobCandidates, similarSupplierImage, recordSearchAttempt, commitPurchaseCostWithFinalPricing, runAutomatic1688Task, runAutomatic1688Batch, pauseAutomatic1688Batch, cancelAutomatic1688Batch, confirmFinalCandidate, rejectFinalCandidate, continueRejectedCandidate, saveSingleUnitException, startSinglePinduoduoDeepSearch, renderConfirmationQueue, beginAutomaticRun, finishAutomaticRun, invalidateAutomaticRun, poll1688Job, setQueue: (value) => { queue = value; }, getQueue: () => queue };";
  vm.runInNewContext(appForVm, context, { filename: "app.js" });
  return {
    mergeJob: context.__appTest.mergeJobCandidates,
    similarImage: context.__appTest.similarSupplierImage,
    recordAttempt: context.__appTest.recordSearchAttempt,
    commit: context.__appTest.commitPurchaseCostWithFinalPricing,
    runAutomatic: context.__appTest.runAutomatic1688Task,
    runAutomaticBatch: context.__appTest.runAutomatic1688Batch,
    pauseBatch: context.__appTest.pauseAutomatic1688Batch,
    cancelBatch: context.__appTest.cancelAutomatic1688Batch,
    confirmFinal: context.__appTest.confirmFinalCandidate,
    rejectFinal: context.__appTest.rejectFinalCandidate,
    continueRejected: context.__appTest.continueRejectedCandidate,
    saveException: context.__appTest.saveSingleUnitException,
    startSinglePinduoduo: context.__appTest.startSinglePinduoduoDeepSearch,
    beginAutomatic: context.__appTest.beginAutomaticRun,
    finishAutomatic: context.__appTest.finishAutomaticRun,
    invalidateAutomatic: context.__appTest.invalidateAutomaticRun,
    pollJob: context.__appTest.poll1688Job,
    setQueue: context.__appTest.setQueue,
    getQueue: context.__appTest.getQueue,
    renderConfirmation: context.__appTest.renderConfirmationQueue,
    elements,
    unload() { for (const listener of [...unloadListeners]) listener(); },
    apiRequests,
    extensionRequests,
    finalPricingRequests: requests,
    storedValues,
    nextRequest() { return requests.at(-1); },
    reply(request, response) {
      emitMessage({ type: "OZON_FINAL_REPRICE_RESPONSE_V1", requestId: request.requestId, ...response });
    },
    replyAfter(request, response, delayMs) {
      return new Promise((resolve) => setTimeout(() => {
        this.reply(request, response);
        resolve();
      }, delayMs));
    },
  };
}

function createControlledClock(initialMs = 0) {
  let currentMs = initialMs;
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [currentMs])); }
    static now() { return currentMs; }
  }
  return {
    Date: ControlledDate,
    now() { return currentMs; },
    set(value) { currentMs = value; },
  };
}

function createManualTimers() {
  const timers = [];
  return {
    setTimeout(callback, delayMs) {
      const timer = { callback, delayMs, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.active = false; },
    fire(delayMs) {
      const timer = timers.find((entry) => entry.active && entry.delayMs === delayMs);
      assert.ok(timer, `expected active ${delayMs}ms timer`);
      timer.active = false;
      timer.callback();
    },
  };
}

function sourcingFlowWithClock(clock) {
  const elapsed = (timing = {}) => {
    const saved = Number.isFinite(timing.elapsedMs) && timing.elapsedMs >= 0 ? timing.elapsedMs : 0;
    const activeStarted = Number.isFinite(timing.activeStartedAtMs) && timing.activeStartedAtMs <= clock.now()
      ? timing.activeStartedAtMs
      : null;
    return saved + (activeStarted === null ? 0 : clock.now() - activeStarted);
  };
  return {
    ...sourcingFlow,
    resumeAutomaticTiming(timing) { return sourcingFlow.resumeAutomaticTiming(timing, clock.now()); },
    pauseAutomaticTiming(timing) { return sourcingFlow.pauseAutomaticTiming(timing, clock.now()); },
    automaticElapsedMs: elapsed,
    automaticTimeBudgetExceeded(timing) { return elapsed(timing) >= sourcingFlow.AUTOMATIC_1688_LIMITS.totalActiveMs; },
    automaticRequestTimeoutMs(timing, requestedMs) {
      const requested = Number.isFinite(requestedMs) && requestedMs > 0 ? Math.floor(requestedMs) : 0;
      return Math.max(0, Math.min(requested, sourcingFlow.AUTOMATIC_1688_LIMITS.totalActiveMs - elapsed(timing)));
    },
  };
}

async function waitForFinalPricingRequest(harness, previousRequest = null) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const request = harness.nextRequest();
    if (request && request !== previousRequest) return request;
    await Promise.resolve();
  }
  assert.fail("expected the app to send a final Ozon pricing request");
}

async function waitForCondition(predicate, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function walkElements(value, result = []) {
  if (!value || typeof value !== "object") return result;
  result.push(value);
  for (const child of Array.isArray(value.children) ? value.children : []) walkElements(child, result);
  return result;
}

function renderedText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return `${value.textContent || ""}${(Array.isArray(value.children) ? value.children : []).map(renderedText).join("")}`;
}

const migrationValues = {
  "ozon-pinduoduo-agent-mvp3": JSON.stringify({
    sourceName: "mvp53-history.json",
    queue: {
      meta: { pinduoduoBatch: { cursor: 4 }, legacyMarker: "keep" },
      tasks: [{
        taskId: "ozon-mvp53-history", history: [{ result: "kept" }],
        sourcing: { searchCandidates: [{ candidateId: "legacy-candidate" }], manualResult: { outcome: "keep" } },
        pricing: { purchaseCost: 18.8, sourceUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=1" },
      }],
    },
  }),
};
const migrationHarness = createAppHarness({ storedValues: migrationValues });
const migratedBrowserRecord = JSON.parse(migrationValues["ozon-sourcing-agent-mvp6"]);
assert.equal(migratedBrowserRecord.sourceName, "mvp53-history.json");
assert.equal(migratedBrowserRecord.queue.meta.sourcingSchema, "mvp6");
assert.deepEqual(migratedBrowserRecord.queue.meta.pinduoduoBatch, { cursor: 4 });
assert.equal(migratedBrowserRecord.queue.tasks[0].history[0].result, "kept");
assert.equal(migratedBrowserRecord.queue.tasks[0].sourcing.manualResult.outcome, "keep");
assert.equal(migrationHarness.getQueue().tasks[0].pricing.purchaseCost, 18.8,
  "MVP 5.3 historical candidates, manual outcomes, and pricing are copied without mutation");

const appHarness = createAppHarness();
const appPreviewTask = {
  taskId: "ozon-preview-1",
  status: "pending_human_review",
  ozon: { sku: "preview-1", name: "unchanged" },
  enrichment: { maxPurchaseCostAt18Pct: 50, originalBlackPrice: 90 },
  pricing: { purchaseCost: 19, sourceUrl: "https://existing.example/item", finalOzonPricing: { status: "old" } },
  audit: { updatedAt: "2026-08-30T00:00:00.000Z" },
  sourcing: { provider: "1688", marker: "unchanged" },
};
appHarness.setQueue({ tasks: [appPreviewTask] });
const appBefore = JSON.stringify(appPreviewTask);
const bridgeRejected = appHarness.commit(appPreviewTask, 23, "https://detail.1688.com/offer/1.html");
const rejectedRequest = await waitForFinalPricingRequest(appHarness);
appHarness.reply(rejectedRequest, { ok: false, error: "bridge rejected" });
await assert.rejects(bridgeRejected, /bridge rejected/, "a bridge rejection must reach the caller");
assert.equal(JSON.stringify(appPreviewTask), appBefore, "a bridge rejection must not mutate any 1688 task field");
const invalidPreview = appHarness.commit(appPreviewTask, 23, "https://detail.1688.com/offer/1.html");
const invalidPreviewRequest = await waitForFinalPricingRequest(appHarness, rejectedRequest);
appHarness.reply(invalidPreviewRequest, { ok: true, maxPurchaseCostAt18Pct: 23 });
await assert.rejects(invalidPreview, /Ozon最终复价响应不完整/, "a rejected 1688 preview must reach the caller");
assert.equal(JSON.stringify(appPreviewTask), appBefore, "a failed 1688 preview must not mutate pricing, Ozon, enrichment, or audit");
const delayedFirst = appHarness.commit(appPreviewTask, 23, "https://detail.1688.com/offer/1.html");
const delayedFirstRequest = await waitForFinalPricingRequest(appHarness, invalidPreviewRequest);
const delayedSecond = appHarness.commit(appPreviewTask, 23, "https://detail.1688.com/offer/1.html");
const delayedSecondRequest = await waitForFinalPricingRequest(appHarness, delayedFirstRequest);
const delayedOldReply = appHarness.replyAfter(delayedFirstRequest, { ...previewResponse }, 10);
appHarness.reply(delayedSecondRequest, { ...previewResponse });
const appPreview = await delayedSecond;
assert.equal(appPreview.status, "completed", "the current 1688 response returns a preview");
assert.equal(appPreview.purchaseCost, 23, "the current 1688 response preserves its preview cost");
assert.equal(JSON.stringify(appPreviewTask), appBefore, "a successful 1688 preview must not prewrite the task before confirmation");
await delayedOldReply;
assert.equal((await delayedFirst).stale, true, "a delayed old bridge response must be ignored after the newer preview completes");
assert.equal(JSON.stringify(appPreviewTask), appBefore, "an ignored old response must not mutate any 1688 task field");

const automaticCandidate = {
  provider: "1688",
  candidateId: "1688-77",
  productId: "77",
  sourceUrl: "https://detail.1688.com/offer/77.html",
  title: "自动测试候选",
  imageUrl: "https://cbu01.alicdn.com/img/ibank/test.jpg",
  supplierName: "测试供应商",
  minimumOrderQuantity: 1,
  supportsOnePiece: false,
  supportsSample: false,
  pricing: { selectedSkuPrice: 20, onePiecePrice: null, samplePrice: null, priceSource: "selected_sku" },
  shipping: { status: "known", fee: 3 },
  sku: { options: [{ id: "sku-77", label: "标准款" }], selectedOptionId: null, selectionVerified: false },
  detailStatus: "complete",
  evidence: { localRef: "/api/evidence/test/77.jpg" },
};

// A running job may persist diagnostic candidates, but only a completed search
// may supply candidates to another strategy or the AI/pricing pipeline.
const candidateIsolationHarness = createAppHarness();
const candidateIsolationTask = { sourcing: {} };
const isolationStrategy = { type: "keyword", query: "扳手套装" };
candidateIsolationHarness.mergeJob(candidateIsolationTask, isolationStrategy, {
  jobId: "1688-isolation-1", status: "running", candidates: [automaticCandidate], detailCandidates: [automaticCandidate],
  extensionVersion: "0.6.37", uploadDiagnostics: { stage: "preview_submitted", searchSubmitted: true },
});
assert.equal(candidateIsolationTask.sourcing.lightweightCandidates.length, 0,
  "nonterminal candidates must stay outside the shared fallback pool");
assert.equal(candidateIsolationTask.sourcing.strategyCandidates.keyword.lightweightCandidates.length, 1,
  "the running snapshot must remain available as diagnostic evidence");
candidateIsolationHarness.mergeJob(candidateIsolationTask, isolationStrategy, {
  jobId: "1688-isolation-1", status: "stage_timeout", candidates: [], detailCandidates: [],
});
assert.equal(candidateIsolationTask.sourcing.strategyCandidates.keyword.status, "stage_timeout");
assert.equal(candidateIsolationTask.sourcing.strategyCandidates.keyword.extensionVersion, "0.6.37");
assert.equal(candidateIsolationTask.sourcing.strategyCandidates.keyword.uploadDiagnostics.searchSubmitted, true,
  "a synthetic timeout must preserve the same job's last known upload diagnostics");
assert.equal(candidateIsolationTask.sourcing.detailCandidates.length, 0,
  "a timeout must quarantine even complete details collected before failure");
assert.equal(candidateIsolationHarness.similarImage(candidateIsolationTask), null,
  "a timed-out candidate must never seed similar-supplier search");
candidateIsolationHarness.mergeJob(candidateIsolationTask, isolationStrategy, {
  jobId: "1688-isolation-2", status: "completed", candidates: [automaticCandidate], detailCandidates: [automaticCandidate],
});
assert.equal(candidateIsolationTask.sourcing.detailCandidates.length, 1,
  "a completed replacement search must still supply usable details");
assert.equal(candidateIsolationHarness.similarImage(candidateIsolationTask).candidate.candidateId, "1688-77");
candidateIsolationHarness.mergeJob(candidateIsolationTask, { type: "image" }, {
  jobId: "1688-isolation-3", status: "failed", candidates: [], detailCandidates: [],
});
assert.equal(candidateIsolationTask.sourcing.detailCandidates.length, 1,
  "failure of another strategy must not remove a successful search");
const restoredFailedPool = {
  sourcing: {
    lightweightCandidates: [automaticCandidate], detailCandidates: [automaticCandidate],
    strategyCandidates: { keyword: { jobId: "1688-old-failed", lightweightCandidates: [automaticCandidate], detailCandidates: [automaticCandidate] } },
    searchAttempts: [{ strategy: "keyword", jobId: "1688-old-failed", status: "stage_timeout" }],
  },
};
assert.equal(candidateIsolationHarness.similarImage(restoredFailedPool), null,
  "legacy JSON containing a failed candidate pool must fail closed after restore");

function automaticConfirmationHarness(sourcingCoreModule, { clock = null, timers = null, resumedJob = null, beforePoll = null } = {}) {
  const jobs = new Map(resumedJob ? [[resumedJob.jobId, resumedJob]] : []);
  let sequence = 0;
  return createAppHarness({
    sourcingCoreModule,
    clock,
    timers,
    sourcingFlowDeps: clock ? sourcingFlowWithClock(clock) : sourcingFlow,
    finalPricingResponse: previewResponse,
    apiHandler: async (path) => {
      if (path === "/api/ai/1688-judge") return {
        ok: true,
        judgement: {
          verdict: "same_product", confidence: 92, bestCandidateId: "1688-77", needsHumanReview: false,
          candidateAssessments: [{ candidateId: "1688-77", verdict: "same_product", confidence: 92, differences: [] }],
        },
      };
      if (path === "/api/ai/1688-select-sku") return {
        ok: true,
        selection: { verdict: "exact_match", selectedOptionId: "sku-77", confidence: 92, reason: "规格一致", needsHumanReview: false },
      };
      return { ok: false, error: `unexpected API ${path}` };
    },
    extensionHandler: async (request) => {
      if (request.action === "start_1688_job") {
        const jobId = `1688-refresh-${++sequence}`;
        jobs.set(jobId, { jobId, strategy: request.strategy });
        return { ok: true, jobId, status: "queued", phase: "queued" };
      }
      if (request.action === "get_1688_job") {
        const job = jobs.get(request.jobId);
        if (beforePoll) await beforePoll(job);
        return {
          ok: true, ...job, status: "completed", phase: "completed",
          diagnostics: job.strategy.type === "verify_sku" ? { code: "sku_verified" } : null,
          candidates: job.strategy.type === "verify_sku" ? [] : [automaticCandidate],
          detailCandidates: job.strategy.type === "verify_sku" ? [] : [automaticCandidate],
        };
      }
      if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
      return { ok: false, error: "unexpected bridge action" };
    },
  });
}
const automaticJobs = new Map();
let automaticJobSequence = 0;
const automaticHarness = createAppHarness({
  finalPricingResponse: previewResponse,
  apiHandler: async (path) => {
    if (path === "/api/ai/status") return { ok: true, status: { configured: true, model: "test" } };
    if (path === "/api/ai/1688-judge") {
      return {
        ok: true,
        judgement: {
          verdict: "same_product", confidence: 92, bestCandidateId: "1688-77", needsHumanReview: false,
          candidateAssessments: [{ candidateId: "1688-77", verdict: "same_product", confidence: 92, differences: [] }],
        },
        provider: "test", model: "test", usage: {}, judgedAt: "2026-08-31T00:00:00.000Z",
      };
    }
    if (path === "/api/ai/1688-select-sku") {
      return {
        ok: true,
        selection: { verdict: "exact_match", selectedOptionId: "sku-77", confidence: 92, reason: "规格一致", needsHumanReview: false },
        provider: "test", model: "test", usage: {}, judgedAt: "2026-08-31T00:00:00.000Z",
      };
    }
    return { ok: false, error: `unexpected API ${path}` };
  },
  extensionHandler: async (request) => {
    if (request.action === "start_1688_job") {
      const jobId = `1688-test-${++automaticJobSequence}`;
      automaticJobs.set(jobId, { jobId, strategy: request.strategy });
      return { ok: true, jobId, status: "queued", phase: "queued", strategy: request.strategy };
    }
    if (request.action === "get_1688_job") {
      const job = automaticJobs.get(request.jobId);
      assert.ok(job, "the automatic flow may poll only a job it started");
      return {
        ok: true,
        ...job,
        status: "completed",
        phase: "completed",
        candidates: job.strategy.type === "verify_sku" ? [] : [automaticCandidate],
        detailCandidates: job.strategy.type === "verify_sku" ? [] : [automaticCandidate],
        diagnostics: job.strategy.type === "verify_sku" ? { code: "sku_verified" } : null,
      };
    }
    if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const automaticTask = {
  taskId: "ozon-auto-1",
  status: "pending_human_review",
  ozon: { sku: "auto-1", name: "自动测试商品", allowedGenericTerms: ["自动", "测试", "商品"] },
  enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/auto.jpg", maxPurchaseCostAt18Pct: 50 },
  sourcing: {},
  pricing: {},
};
automaticHarness.setQueue({ tasks: [automaticTask], meta: {} });
await automaticHarness.runAutomatic(automaticTask);
assert.equal(automaticTask.sourcing.provider, "1688");
assert.deepEqual(Array.from(automaticTask.sourcing.searchAttempts, (attempt) => attempt.strategy), ["image"]);
assert.equal(automaticTask.sourcing.finalConfirmation.status, "final_confirmation_pending", JSON.stringify(automaticTask.sourcing.finalConfirmation));
assert.equal(automaticTask.pricing.purchaseCost, undefined, "automatic final preview must not write a purchase price");
assert.deepEqual(automaticHarness.extensionRequests.filter((request) => request.action === "start_1688_job").map((request) => request.strategy.type), ["image", "verify_sku"]);
assert.equal(automaticHarness.apiRequests.some((request) => /\/api\/(?:pinduoduo|task\/search)/.test(request.path)), false,
  "automatic 1688 sourcing must never call a Pinduoduo or MuMu endpoint");
await automaticHarness.confirmFinal("ozon-auto-1");
assert.equal(automaticTask.sourcing.status, "confirmed_purchase_source");
assert.equal(automaticTask.sourcing.confirmedCandidate.candidateId, "1688-77");
assert.equal(automaticTask.pricing.purchaseCost, 23, "only final task-bound confirmation may write the purchase cost");

function automaticLifecycleTask(taskId) {
  return {
    taskId,
    status: "pending_human_review",
    ozon: { sku: taskId, name: "生命周期测试商品", allowedGenericTerms: ["生命周期", "测试", "商品"] },
    enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/lifecycle.jpg", maxPurchaseCostAt18Pct: 50 },
    sourcing: {},
    pricing: {},
  };
}

const refreshSessionATask = automaticLifecycleTask("ozon-confirmation-refresh");
const refreshSessionAHarness = automaticConfirmationHarness(refreshSessionCoreA);
refreshSessionAHarness.setQueue({ tasks: [refreshSessionATask], meta: {} });
await refreshSessionAHarness.runAutomatic(refreshSessionATask);
const previousConfirmationId = refreshSessionATask.sourcing.finalConfirmation.confirmationId;
await refreshSessionAHarness.confirmFinal("ozon-confirmation-refresh");
const persistedTerminalActions = JSON.parse(JSON.stringify(refreshSessionATask.sourcing.finalActionTerminals));
assert.equal(persistedTerminalActions[previousConfirmationId].action, "confirm",
  "the first module session must persist its terminal action under the original confirmation capability");

const refreshSessionBTask = {
  ...automaticLifecycleTask("ozon-confirmation-refresh"),
  sourcing: { finalActionTerminals: persistedTerminalActions },
};
const refreshSessionBHarness = automaticConfirmationHarness(refreshSessionCoreB);
refreshSessionBHarness.setQueue({ tasks: [refreshSessionBTask], meta: {} });
await refreshSessionBHarness.runAutomatic(refreshSessionBTask);
assert.notEqual(refreshSessionBTask.sourcing.finalConfirmation.confirmationId, previousConfirmationId,
  "a fresh module session must not reuse a persisted terminal confirmationId for a new card");
await refreshSessionBHarness.confirmFinal("ozon-confirmation-refresh");
assert.equal(refreshSessionBTask.sourcing.status, "confirmed_purchase_source",
  "the fresh confirmation capability must execute instead of being mistaken for the old terminal action");
assert.equal(refreshSessionBTask.pricing.purchaseCost, 23,
  "the new post-refresh confirmation must still be allowed to write its independently revalidated purchase cost");

const preservedFallbackTerminal = {
  confirmationId: "sourcing-confirmation-1",
  action: "confirm",
  status: "confirmed",
  finalStatus: "final_confirmation_confirmed",
  completedAt: "2026-09-07T00:00:00.000Z",
};
const fallbackSourceTask = {
  ...automaticLifecycleTask("ozon-confirmation-fallback"),
  sourcing: { finalActionTerminals: { "sourcing-confirmation-1": preservedFallbackTerminal } },
};
const fallbackSourceHarness = automaticConfirmationHarness(refreshFallbackCoreA);
fallbackSourceHarness.setQueue({ tasks: [fallbackSourceTask], meta: {} });
await fallbackSourceHarness.runAutomatic(fallbackSourceTask);
const fallbackCardId = fallbackSourceTask.sourcing.finalConfirmation.confirmationId;
assert.equal(fallbackCardId, "sourcing-confirmation-2",
  "a new card must already avoid the persisted terminal key before the simulated refresh");
const fallbackRefreshTask = JSON.parse(JSON.stringify(fallbackSourceTask));
const fallbackOldTerminalBefore = JSON.stringify(fallbackRefreshTask.sourcing.finalActionTerminals["sourcing-confirmation-1"]);
const fallbackRefreshHarness = automaticConfirmationHarness(refreshFallbackCoreB);
fallbackRefreshHarness.setQueue({ tasks: [fallbackRefreshTask], meta: {} });
const fallbackFirstConfirm = await fallbackRefreshHarness.confirmFinal("ozon-confirmation-fallback");
assert.equal(fallbackRefreshTask.sourcing.finalConfirmation.confirmationId, fallbackCardId,
  "fallback rebuilding after refresh must preserve the currently rendered confirmation capability");
assert.equal(JSON.stringify(fallbackRefreshTask.sourcing.finalActionTerminals["sourcing-confirmation-1"]), fallbackOldTerminalBefore,
  "fallback rebuilding must never overwrite an old terminal record with a colliding module-local confirmation ID");
assert.equal(fallbackRefreshTask.sourcing.finalActionTerminals[fallbackCardId]?.action, "confirm",
  "the refreshed card must write its own terminal action under its preserved capability");
const fallbackSecondConfirm = await fallbackRefreshHarness.confirmFinal("ozon-confirmation-fallback");
assert.equal(fallbackFirstConfirm.idempotent, false,
  "the refreshed card's first confirmation must execute normally");
assert.equal(fallbackSecondConfirm.idempotent, true,
  "the refreshed card's repeated confirmation must be idempotent rather than execute twice");
assert.equal(fallbackRefreshTask.sourcing.confirmationAudit.filter((entry) => entry.action === "confirmed_purchase_source").length, 1,
  "fallback rebuilding after refresh must produce exactly one confirmation write");

function delayedJudgeLifecycleHarness(gate) {
  const jobs = new Map();
  let sequence = 0;
  return createAppHarness({
    finalPricingResponse: previewResponse,
    apiHandler: async (path) => {
      if (path === "/api/ai/1688-judge") return gate;
      if (path === "/api/ai/1688-select-sku") return {
        ok: true,
        selection: { verdict: "requires_human_review", selectedOptionId: "sku-77", confidence: 10, reason: "must not run", needsHumanReview: true },
      };
      return { ok: false, error: `unexpected API ${path}` };
    },
    extensionHandler: async (request) => {
      if (request.action === "start_1688_job") {
        const jobId = `1688-delayed-${++sequence}`;
        jobs.set(jobId, { jobId, strategy: request.strategy });
        return { ok: true, jobId, status: "queued", phase: "queued" };
      }
      if (request.action === "get_1688_job") {
        const job = jobs.get(request.jobId);
        return {
          ok: true, ...job, status: "completed", phase: "completed", diagnostics: null,
          candidates: job.strategy?.type === "verify_sku" ? [] : [automaticCandidate],
          detailCandidates: job.strategy?.type === "verify_sku" ? [] : [automaticCandidate],
        };
      }
      if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
      return { ok: false, error: "unexpected bridge action" };
    },
  });
}

let releaseCancelledJudge;
const cancelledJudge = new Promise((resolve) => { releaseCancelledJudge = resolve; });
const cancelledLifecycleHarness = delayedJudgeLifecycleHarness(cancelledJudge);
const cancelledLifecycleTask = automaticLifecycleTask("ozon-lifecycle-cancel");
cancelledLifecycleHarness.setQueue({ tasks: [cancelledLifecycleTask], meta: {} });
const cancelledBatchRun = cancelledLifecycleHarness.runAutomaticBatch();
await waitForCondition(() => cancelledLifecycleHarness.apiRequests.some((request) => request.path === "/api/ai/1688-judge"), "cancelled task judgement");
await cancelledLifecycleHarness.cancelBatch();
releaseCancelledJudge({
  ok: true,
  judgement: {
    verdict: "same_product", confidence: 92, bestCandidateId: "1688-77", needsHumanReview: false,
    candidateAssessments: [{ candidateId: "1688-77", verdict: "same_product", confidence: 92, differences: [] }],
  },
});
await cancelledBatchRun;
assert.equal(cancelledLifecycleTask.sourcing.status, "automatic_cancelled",
  "a delayed judgement released after cancellation must not overwrite the cancelled terminal state");
assert.equal(cancelledLifecycleHarness.apiRequests.filter((request) => request.path === "/api/ai/1688-select-sku").length, 0,
  "a cancelled automatic run must not start SKU selection after its delayed judgement returns");
assert.equal(cancelledLifecycleHarness.extensionRequests.filter((request) => request.action === "start_1688_job" && request.strategy?.type === "verify_sku").length, 0,
  "a cancelled automatic run must not start a SKU verification bridge job");
assert.equal(cancelledLifecycleHarness.finalPricingRequests.length, 0,
  "a cancelled automatic run must not ask Ozon for a final repricing preview");

let releasePausedJudge;
const pausedJudge = new Promise((resolve) => { releasePausedJudge = resolve; });
const pausedLifecycleHarness = delayedJudgeLifecycleHarness(pausedJudge);
const pausedLifecycleTask = automaticLifecycleTask("ozon-lifecycle-pause");
pausedLifecycleHarness.setQueue({ tasks: [pausedLifecycleTask], meta: {} });
const pausedBatchRun = pausedLifecycleHarness.runAutomaticBatch();
await waitForCondition(() => pausedLifecycleHarness.apiRequests.some((request) => request.path === "/api/ai/1688-judge"), "paused task judgement");
await pausedLifecycleHarness.pauseBatch();
releasePausedJudge({
  ok: true,
  judgement: {
    verdict: "same_product", confidence: 92, bestCandidateId: "1688-77", needsHumanReview: false,
    candidateAssessments: [{ candidateId: "1688-77", verdict: "same_product", confidence: 92, differences: [] }],
  },
});
await pausedBatchRun;
assert.equal(pausedLifecycleTask.sourcing.status, "paused_manual",
  "a delayed judgement released after pause must not overwrite the paused state");
assert.equal(pausedLifecycleHarness.apiRequests.filter((request) => request.path === "/api/ai/1688-select-sku").length, 0,
  "a paused automatic run must not start SKU selection after its delayed judgement returns");
assert.equal(pausedLifecycleHarness.extensionRequests.filter((request) => request.action === "start_1688_job" && request.strategy?.type === "verify_sku").length, 0,
  "a paused automatic run must not start a SKU verification bridge job");
assert.equal(pausedLifecycleHarness.finalPricingRequests.length, 0,
  "a paused automatic run must not ask Ozon for a final repricing preview");

function delayedStartStopHarness(startGate, harnessOptions = {}) {
  const jobs = new Map();
  return createAppHarness({
    ...harnessOptions,
    extensionHandler: async (request) => {
      if (request.action === "start_1688_job") {
        const started = await startGate;
        jobs.set(started.jobId, { ...started, strategy: request.strategy });
        return { ok: true, ...started };
      }
      if (request.action === "cancel_1688_job") {
        const job = jobs.get(request.jobId);
        if (job) job.status = "cancelled";
        return { ok: true, jobId: request.jobId, status: "cancelled" };
      }
      if (request.action === "get_1688_job") {
        const job = jobs.get(request.jobId);
        return { ok: true, ...job, status: job?.status || "completed", phase: job?.phase || "completed", candidates: [], detailCandidates: [] };
      }
      return { ok: false, error: "unexpected bridge action" };
    },
  });
}

let releaseCancelledStart;
const cancelledStartGate = new Promise((resolve) => { releaseCancelledStart = resolve; });
const cancelledStartHarness = delayedStartStopHarness(cancelledStartGate);
const cancelledStartTask = automaticLifecycleTask("ozon-start-inflight-cancel");
cancelledStartHarness.setQueue({ tasks: [cancelledStartTask], meta: {} });
const cancelledStartBatch = cancelledStartHarness.runAutomaticBatch();
await waitForCondition(() => cancelledStartHarness.extensionRequests.some((request) => request.action === "start_1688_job"), "in-flight start request before cancellation");
await cancelledStartHarness.cancelBatch();
releaseCancelledStart({ jobId: "1688-late-cancel", status: "queued", phase: "queued" });
await waitForCondition(() => cancelledStartHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-late-cancel").length === 1,
  "late-start cancellation cleanup");
await cancelledStartBatch;
assert.equal(cancelledStartTask.sourcing.status, "automatic_cancelled",
  "a late start response must not overwrite the cancelled task state");
assert.equal(cancelledStartHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-late-cancel").length, 1,
  "a late-created job must receive exactly one idempotent cancellation cleanup");

let releasePausedStart;
const pausedStartGate = new Promise((resolve) => { releasePausedStart = resolve; });
const pausedStartHarness = delayedStartStopHarness(pausedStartGate);
const pausedStartTask = automaticLifecycleTask("ozon-start-inflight-pause");
pausedStartHarness.setQueue({ tasks: [pausedStartTask], meta: {} });
const pausedStartBatch = pausedStartHarness.runAutomaticBatch();
await waitForCondition(() => pausedStartHarness.extensionRequests.some((request) => request.action === "start_1688_job"), "in-flight start request before pause");
await pausedStartHarness.pauseBatch();
releasePausedStart({ jobId: "1688-late-pause", status: "queued", phase: "queued" });
await waitForCondition(() => pausedStartHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-late-pause").length === 1,
  "late-start pause cleanup");
await pausedStartBatch;
assert.equal(pausedStartTask.sourcing.status, "paused_manual",
  "a late start response must not overwrite the manually paused task state");
assert.equal(pausedStartHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-late-pause").length, 1,
  "a paused in-flight start must receive exactly one idempotent cancellation cleanup");

let releaseSameTaskReentryStart;
const sameTaskReentryGate = new Promise((resolve) => { releaseSameTaskReentryStart = resolve; });
let sameTaskReentryStarts = 0;
const sameTaskReentryHarness = createAppHarness({
  extensionHandler: async (request) => {
    if (request.action === "start_1688_job") {
      sameTaskReentryStarts += 1;
      if (sameTaskReentryStarts === 1) return { ok: true, ...(await sameTaskReentryGate) };
      return { ok: false, error: "a new generation must not start before the old one cleans up" };
    }
    if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const sameTaskReentryTask = automaticLifecycleTask("ozon-same-task-reentry");
sameTaskReentryHarness.setQueue({ tasks: [sameTaskReentryTask], meta: {} });
const oldGenerationRun = sameTaskReentryHarness.runAutomatic(sameTaskReentryTask);
await waitForCondition(() => sameTaskReentryStarts === 1, "first same-task generation start");
sameTaskReentryHarness.invalidateAutomatic(sameTaskReentryTask, "test_reentry");
const sameTaskReentryResult = await sameTaskReentryHarness.runAutomatic(sameTaskReentryTask);
assert.equal(sameTaskReentryResult.status, "provider_busy",
  "an invalidated generation must retain the provider lock until its late-start cleanup finishes");
assert.equal(sameTaskReentryStarts, 1,
  "a same-task re-entry must not start a second production job before old-generation cleanup");
releaseSameTaskReentryStart({ jobId: "1688-same-task-reentry", status: "queued", phase: "queued" });
await oldGenerationRun;

const lateStartTimers = createManualTimers();
let releaseTimedOutStart;
const timedOutStartGate = new Promise((resolve) => { releaseTimedOutStart = resolve; });
const timedOutStartHarness = delayedStartStopHarness(timedOutStartGate, { timers: lateStartTimers });
const timedOutStartTask = automaticLifecycleTask("ozon-start-timeout");
timedOutStartHarness.setQueue({ tasks: [timedOutStartTask], meta: {} });
const timedOutStartBatch = timedOutStartHarness.runAutomaticBatch();
await waitForCondition(() => timedOutStartHarness.extensionRequests.some((request) => request.action === "start_1688_job"), "in-flight start request before bridge timeout");
lateStartTimers.fire(15_000);
await waitForCondition(() => timedOutStartTask.sourcing.finalConfirmation?.blockers?.includes("bridge_start_response_pending_cancel"), "blocked state while awaiting a late start response");
assert.equal(timedOutStartHarness.extensionRequests.filter((request) => request.action === "start_1688_job").length, 1,
  "a timed-out start must not advance to a second search strategy while its first response is still unknown");
assert.equal(timedOutStartHarness.extensionRequests.some((request) => request.action === "get_1688_job"), false,
  "a timed-out start must not poll or progress a job before its delayed response is safely cancelled");
assert.equal(timedOutStartHarness.apiRequests.length, 0,
  "a timed-out start must not call Qwen while its background job identity is unresolved");
assert.equal(timedOutStartHarness.finalPricingRequests.length, 0,
  "a timed-out start must not request final repricing while its background job identity is unresolved");
releaseTimedOutStart({ jobId: "1688-late-timeout", status: "queued", phase: "queued" });
await waitForCondition(() => timedOutStartHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-late-timeout").length === 1,
  "late-start timeout cancellation cleanup");
await timedOutStartBatch;
assert.equal(timedOutStartHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-late-timeout").length, 1,
  "a late response after request timeout must still receive exactly one cancellation cleanup");

let releaseProviderStart;
const providerStartGate = new Promise((resolve) => { releaseProviderStart = resolve; });
const providerBusyHarness = delayedStartStopHarness(providerStartGate);
const providerOwnerTask = automaticLifecycleTask("ozon-provider-owner");
const providerBusyFinal = {
  confirmationId: "sourcing-confirmation-provider-busy",
  status: "final_confirmation_rejected",
  candidateSnapshot: automaticCandidate,
};
const providerBusyCardTask = {
  ...automaticLifecycleTask("ozon-provider-card"),
  sourcing: {
    detailCandidates: [automaticCandidate],
    finalConfirmation: providerBusyFinal,
    finalActionTerminals: {
      "sourcing-confirmation-provider-busy": {
        confirmationId: "sourcing-confirmation-provider-busy",
        action: "reject",
        status: "rejected",
        completedAt: "2026-09-07T00:00:00.000Z",
      },
    },
  },
};
providerBusyHarness.setQueue({ tasks: [providerOwnerTask, providerBusyCardTask], meta: {} });
const providerBusyBatch = providerBusyHarness.runAutomaticBatch();
await waitForCondition(() => providerBusyHarness.extensionRequests.some((request) => request.action === "start_1688_job"), "provider owner start request");
const providerBusyTarget = {
  task: providerBusyCardTask,
  taskId: "ozon-provider-card",
  final: providerBusyFinal,
  confirmationId: "sourcing-confirmation-provider-busy",
};
const providerBusyResult = await providerBusyHarness.continueRejected(providerBusyTarget);
assert.equal(providerBusyResult.status, "provider_busy_batch",
  "a final-card continuation must report provider occupancy before mutating its task");
assert.strictEqual(providerBusyCardTask.sourcing.finalConfirmation, providerBusyFinal,
  "a provider-busy return must not delete the final-confirmation card");
assert.equal(providerBusyCardTask.sourcing.status, undefined,
  "a provider-busy return must not leave the untouched card task in automatic_running");
assert.equal(providerBusyCardTask.sourcing.detailCandidates[0].candidateId, "1688-77",
  "a provider-busy return must retain the card's persisted candidate evidence");
await providerBusyHarness.cancelBatch();
releaseProviderStart({ jobId: "1688-provider-owner", status: "queued", phase: "queued" });
await providerBusyBatch;

const finalRaceHarness = createAppHarness({
  finalPricingResponse: previewResponse,
  apiHandler: async (path) => {
    if (path === "/api/ai/1688-judge") return {
      ok: true,
      judgement: {
        verdict: "same_product", confidence: 92, bestCandidateId: "1688-77", needsHumanReview: false,
        candidateAssessments: [{ candidateId: "1688-77", verdict: "same_product", confidence: 92, differences: [] }],
      },
    };
    if (path === "/api/ai/1688-select-sku") return {
      ok: true,
      selection: { verdict: "exact_match", selectedOptionId: "sku-77", confidence: 92, reason: "规格一致", needsHumanReview: false },
    };
    return { ok: false, error: `unexpected API ${path}` };
  },
  extensionHandler: async (request) => {
    if (request.action === "start_1688_job") return { ok: true, jobId: `1688-race-${request.strategy.type}`, status: "queued", phase: "queued" };
    if (request.action === "get_1688_job") return {
      ok: true, jobId: request.jobId, status: "completed", phase: "completed",
      diagnostics: request.jobId.endsWith("verify_sku") ? { code: "sku_verified" } : null,
      candidates: request.jobId.endsWith("verify_sku") ? [] : [automaticCandidate],
      detailCandidates: request.jobId.endsWith("verify_sku") ? [] : [automaticCandidate],
    };
    if (request.action === "cancel_1688_job") return { ok: true, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const finalRaceTask = automaticLifecycleTask("ozon-final-race");
finalRaceHarness.setQueue({ tasks: [finalRaceTask], meta: {} });
await finalRaceHarness.runAutomatic(finalRaceTask);
assert.equal(finalRaceTask.sourcing.finalConfirmation.status, "final_confirmation_pending");
await Promise.all([finalRaceHarness.confirmFinal("ozon-final-race"), finalRaceHarness.rejectFinal("ozon-final-race")]);
assert.equal(finalRaceTask.sourcing.status, "confirmed_purchase_source",
  "confirm and reject racing on one card must share one terminal final-action result");
assert.equal(finalRaceTask.pricing.purchaseCost, 23,
  "the losing final action must not clear or alter the purchase price written by the winner");
assert.equal(Array.from(finalRaceTask.sourcing.rejectedCandidateIds || []).includes("1688-77"), false,
  "the losing reject action must not mark the confirmed candidate as rejected");

const moqExceptionCandidate = {
  ...automaticCandidate,
  candidateId: "1688-78",
  productId: "78",
  sourceUrl: "https://detail.1688.com/offer/78.html",
  minimumOrderQuantity: 2,
  supportsOnePiece: false,
  supportsSample: false,
  pricing: { selectedSkuPrice: 20, onePiecePrice: null, samplePrice: null, priceSource: "selected_sku" },
  sku: { options: [{ id: "sku-78", label: "标准款" }], selectedOptionId: null, selectionVerified: false },
};
const moqExceptionJobs = new Map();
let moqExceptionSequence = 0;
const moqExceptionHarness = createAppHarness({
  finalPricingResponse: previewResponse,
  apiHandler: async (path) => {
    if (path === "/api/ai/1688-judge") return {
      ok: true,
      judgement: {
        verdict: "same_product", confidence: 92, bestCandidateId: "1688-78", needsHumanReview: false,
        candidateAssessments: [{ candidateId: "1688-78", verdict: "same_product", confidence: 92, differences: [] }],
      },
    };
    if (path === "/api/ai/1688-select-sku") return {
      ok: true,
      selection: { verdict: "exact_match", selectedOptionId: "sku-78", confidence: 92, reason: "规格一致", needsHumanReview: false },
    };
    return { ok: false, error: `unexpected API ${path}` };
  },
  extensionHandler: async (request) => {
    if (request.action === "start_1688_job") {
      const jobId = `1688-moq-${++moqExceptionSequence}`;
      moqExceptionJobs.set(jobId, { jobId, strategy: request.strategy });
      return { ok: true, jobId, status: "queued", phase: "queued" };
    }
    if (request.action === "get_1688_job") {
      const job = moqExceptionJobs.get(request.jobId);
      return {
        ok: true, ...job, status: "completed", phase: "completed",
        diagnostics: job.strategy.type === "verify_sku" ? { code: "sku_verified" } : null,
        candidates: job.strategy.type === "verify_sku" ? [] : [moqExceptionCandidate],
        detailCandidates: job.strategy.type === "verify_sku" ? [] : [moqExceptionCandidate],
      };
    }
    if (request.action === "cancel_1688_job") return { ok: true, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const moqExceptionTask = automaticLifecycleTask("ozon-moq-exception");
moqExceptionHarness.setQueue({ tasks: [moqExceptionTask], meta: {} });
await moqExceptionHarness.runAutomatic(moqExceptionTask);
assert.equal(moqExceptionTask.sourcing.finalConfirmation.status, "final_confirmation_blocked",
  "MOQ two without a page-proven one-piece price stays in the manual exception queue");
const moqExceptionTarget = {
  task: moqExceptionTask,
  taskId: "ozon-moq-exception",
  final: moqExceptionTask.sourcing.finalConfirmation,
  confirmationId: moqExceptionTask.sourcing.finalConfirmation.confirmationId,
};
await moqExceptionHarness.saveException(moqExceptionTarget, "20.50");
assert.equal(moqExceptionTask.meta, undefined, "the exception belongs to queue metadata, never a task-local surrogate");
assert.equal(moqExceptionHarness.getQueue().meta.singleUnitExceptions["78"].onePiecePrice, 20.5,
  "the exact MOQ-two task may save its customer-confirmed one-piece price");
assert.equal(moqExceptionTask.sourcing.finalConfirmation.status, "final_confirmation_pending",
  "saving a valid exception rebuilds a fresh final-confirmation capability instead of writing a purchase price");
assert.equal(moqExceptionTask.pricing.purchaseCost, undefined,
  "an exception alone may never confirm a purchase price");
await assert.rejects(() => moqExceptionHarness.saveException(moqExceptionTarget, "20.50"), /确认能力已变更|任务已变更/,
  "an action bound to the old confirmation card must not operate on its replacement");

const partialPollJobs = new Map();
let partialPollSequence = 0;
const partialPollHarness = createAppHarness({
  extensionHandler: async (request) => {
    if (request.action === "start_1688_job") {
      const jobId = `1688-partial-${++partialPollSequence}`;
      partialPollJobs.set(jobId, { jobId, strategy: request.strategy });
      return { ok: true, jobId, status: "queued", phase: "queued" };
    }
    if (request.action === "get_1688_job") {
      const job = partialPollJobs.get(request.jobId);
      return {
        ok: true, ...job, status: "running", phase: "inspect_details",
        phaseStartedAt: new Date().toISOString(), currentDetailIndex: 0,
        candidates: [automaticCandidate], detailCandidates: [automaticCandidate], diagnostics: null,
      };
    }
    if (request.action === "cancel_1688_job") return { ok: true, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const partialPollTask = automaticLifecycleTask("ozon-partial-poll");
partialPollHarness.setQueue({ tasks: [partialPollTask], meta: {} });
const partialPollBatch = partialPollHarness.runAutomaticBatch();
await waitForCondition(() => partialPollTask.sourcing.activeJob?.status === "running", "running detail poll");
assert.equal(partialPollTask.sourcing.strategyCandidates.image.detailCandidates?.[0]?.candidateId, "1688-77",
  "each nonterminal poll must persist complete details as per-job diagnostic progress before refresh");
assert.equal(partialPollTask.sourcing.detailCandidates.length, 0,
  "nonterminal diagnostic details must not enter the active pipeline before completion");
await partialPollHarness.cancelBatch();
await partialPollBatch;

const perDetailClock = createControlledClock(0);
let perDetailPollCount = 0;
const perDetailClockHarness = createAppHarness({
  clock: perDetailClock,
  sourcingFlowDeps: sourcingFlowWithClock(perDetailClock),
  extensionHandler: async (request) => {
    if (request.action === "get_1688_job") {
      perDetailPollCount += 1;
      if (perDetailPollCount === 1) {
        perDetailClock.set(46_000);
        return {
          ok: true, jobId: request.jobId, status: "running", phase: "inspect_details",
          phaseStartedAt: new Date(perDetailClock.now() - 500).toISOString(), currentDetailIndex: 0,
          candidates: [], detailCandidates: [], diagnostics: null,
        };
      }
      if (perDetailPollCount === 2) {
        perDetailClock.set(60_000);
        return {
          ok: true, jobId: request.jobId, status: "running", phase: "inspect_details",
          phaseStartedAt: new Date(59_500).toISOString(), currentDetailIndex: 1,
          candidates: [], detailCandidates: [], diagnostics: null,
        };
      }
      perDetailClock.set(70_000);
      return { ok: true, jobId: request.jobId, status: "completed", phase: "completed", candidates: [], detailCandidates: [], diagnostics: null };
    }
    if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const perDetailClockTask = automaticLifecycleTask("ozon-per-detail-clock");
perDetailClockTask.sourcing = { status: "automatic_running", timing: { elapsedMs: 0, activeStartedAtMs: 0 } };
perDetailClockHarness.setQueue({ tasks: [perDetailClockTask], meta: {} });
const perDetailContext = perDetailClockHarness.beginAutomatic(perDetailClockTask, "single");
const perDetailResult = await perDetailClockHarness.pollJob(perDetailContext, "1688-per-detail-clock", { type: "image", sourceUrl: perDetailClockTask.enrichment.mainImageUrl });
await perDetailClockHarness.finishAutomatic(perDetailContext);
assert.equal(perDetailResult.status, "completed",
  "a job older than 45 seconds may keep polling when its persisted current detail is still within its own 15-second budget");
assert.equal(perDetailClockHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job").length, 0,
  "a fresh persisted detail phase must not be cancelled by the removed whole-job 45-second cutoff");
assert.equal(perDetailPollCount, 3,
  "advancing the detail index within its deadline must give the next detail its own 15-second budget");

const nearDetailDeadlineClock = createControlledClock(14_900);
const nearDetailDeadlineTimers = createManualTimers();
let releaseNearDetailPoll;
const nearDetailPollGate = new Promise((resolve) => { releaseNearDetailPoll = resolve; });
const nearDetailDeadlineHarness = createAppHarness({
  clock: nearDetailDeadlineClock,
  timers: nearDetailDeadlineTimers,
  sourcingFlowDeps: sourcingFlowWithClock(nearDetailDeadlineClock),
  extensionHandler: async (request) => {
    if (request.action === "get_1688_job") {
      await nearDetailPollGate;
      return { ok: true, jobId: request.jobId, status: "running", phase: "inspect_details", candidates: [], detailCandidates: [] };
    }
    if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const nearDetailDeadlineTask = automaticLifecycleTask("ozon-near-detail-deadline");
nearDetailDeadlineTask.sourcing = {
  status: "automatic_running",
  timing: { elapsedMs: 0, activeStartedAtMs: 0 },
  activeJob: {
    jobId: "1688-near-detail-deadline",
    strategy: { type: "image", sourceUrl: nearDetailDeadlineTask.enrichment.mainImageUrl },
    status: "running",
    phase: "inspect_details",
    phaseStartedAt: new Date(0).toISOString(),
    currentDetailIndex: 0,
  },
};
nearDetailDeadlineHarness.setQueue({ tasks: [nearDetailDeadlineTask], meta: {} });
const nearDetailDeadlineContext = nearDetailDeadlineHarness.beginAutomatic(nearDetailDeadlineTask, "single");
const nearDetailDeadlinePoll = nearDetailDeadlineHarness.pollJob(nearDetailDeadlineContext, "1688-near-detail-deadline", { type: "image", sourceUrl: nearDetailDeadlineTask.enrichment.mainImageUrl });
await waitForCondition(() => nearDetailDeadlineHarness.extensionRequests.some((request) => request.action === "get_1688_job"), "near-deadline detail poll request");
nearDetailDeadlineClock.set(15_000);
nearDetailDeadlineTimers.fire(100);
const nearDetailDeadlineResult = await nearDetailDeadlinePoll;
releaseNearDetailPoll();
await nearDetailDeadlineHarness.finishAutomatic(nearDetailDeadlineContext);
assert.equal(nearDetailDeadlineResult.status, "stage_timeout",
  "a poll that crosses a persisted detail deadline must stop at that detail boundary");
assert.equal(nearDetailDeadlineHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-near-detail-deadline").length, 1,
  "a near-deadline detail poll must issue exactly one cancellation cleanup");
assert.equal(nearDetailDeadlineHarness.extensionRequests.filter((request) => request.action === "get_1688_job").length, 1,
  "a detail timeout must not issue another poll after cancellation");
assert.equal(nearDetailDeadlineHarness.apiRequests.length, 0,
  "a detail timeout must not continue to Qwen");
assert.equal(nearDetailDeadlineHarness.finalPricingRequests.length, 0,
  "a detail timeout must not continue to final repricing");

for (const responseAt of [14_999, 15_001, 15_000]) {
  const responseFirstClock = createControlledClock(14_900);
  const responseFirstTimers = createManualTimers();
  let queuedDeadlineCallback;
  let releaseCompletedPoll;
  const completedPollGate = new Promise((resolve) => { releaseCompletedPoll = resolve; });
  const jobId = `1688-response-first-${responseAt}`;
  const strategy = { type: "similar_supplier", sourceUrl: automaticCandidate.imageUrl };
  const responseFirstHarness = automaticConfirmationHarness(undefined, {
    clock: responseFirstClock,
    timers: {
      ...responseFirstTimers,
      setTimeout(callback, delayMs) {
        if (delayMs === 100) queuedDeadlineCallback = callback;
        return responseFirstTimers.setTimeout(callback, delayMs);
      },
    },
    // The returned terminal snapshot may describe a newer detail. It cannot
    // replace the deadline captured from the persistent state before this poll.
    resumedJob: { jobId, strategy, phaseStartedAt: new Date(14_990).toISOString(), currentDetailIndex: 1 },
    beforePoll: async (job) => { if (job.jobId === jobId) await completedPollGate; },
  });
  const responseFirstTask = automaticLifecycleTask(`ozon-response-first-${responseAt}`);
  responseFirstTask.sourcing = {
    status: "automatic_running",
    timing: { elapsedMs: 0, activeStartedAtMs: 0 },
    // Resume the last strategy so a timeout has no remaining search fallback.
    searchAttempts: [
      { strategy: "image", status: "completed", usableCount: 0 },
      { strategy: "keyword", status: "completed", usableCount: 0 },
    ],
    activeJob: {
      jobId, strategy, status: "running", phase: "inspect_details",
      phaseStartedAt: new Date(0).toISOString(), currentDetailIndex: 0,
    },
  };
  responseFirstHarness.setQueue({ tasks: [responseFirstTask], meta: {} });
  const responseFirstRun = responseFirstHarness.runAutomatic(responseFirstTask);
  await waitForCondition(() => responseFirstHarness.extensionRequests.some((request) => request.action === "get_1688_job"), "response-first detail poll");
  assert.equal(typeof queuedDeadlineCallback, "function", "the persisted detail deadline must arm a 100ms timer");
  responseFirstClock.set(responseAt);
  // For an expired response, both handlers are ready but the response runs
  // first. Dispatch the queued deadline callback only after that response.
  releaseCompletedPoll();
  const responseFirstResult = await responseFirstRun;
  const searchAttempt = responseFirstTask.sourcing.searchAttempts.at(-1);
  const expired = responseAt >= 15_000;
  responseFirstClock.set(Math.max(responseAt, 15_000));
  queuedDeadlineCallback();
  await Promise.resolve();
  assert.deepEqual({
    attemptStatus: searchAttempt.status,
    finalStatus: responseFirstResult.status,
    cancelCalls: responseFirstHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === jobId).length,
    detailPolls: responseFirstHarness.extensionRequests.filter((request) => request.action === "get_1688_job" && request.jobId === jobId).length,
    persistedCandidates: responseFirstTask.sourcing.detailCandidates.length,
    qwenCalls: responseFirstHarness.apiRequests.length,
    nextJobs: responseFirstHarness.extensionRequests.filter((request) => request.action === "start_1688_job").length,
    repricingCalls: responseFirstHarness.finalPricingRequests.length,
  }, expired ? {
    attemptStatus: "stage_timeout", finalStatus: "final_confirmation_blocked", cancelCalls: 1,
    detailPolls: 1, persistedCandidates: 0, qwenCalls: 0, nextJobs: 0, repricingCalls: 0,
  } : {
    attemptStatus: "completed", finalStatus: "final_confirmation_pending", cancelCalls: 0,
    detailPolls: 1, persistedCandidates: 1, qwenCalls: 2, nextJobs: 1, repricingCalls: 1,
  }, `a completed response processed at ${responseAt}ms must honor the captured 15000ms detail deadline even when it wins the timer`);
  if (expired) assert.equal(searchAttempt.diagnostics.currentDetailIndex, 0,
    "timeout diagnostics must identify the captured detail, not the newer terminal snapshot's detail");
}

const activeBudgetClock = createControlledClock(0);
const activeBudgetHarness = createAppHarness({
  clock: activeBudgetClock,
  sourcingFlowDeps: sourcingFlowWithClock(activeBudgetClock),
  extensionHandler: async (request) => {
    if (request.action === "get_1688_job") {
      activeBudgetClock.set(150_000);
      return { ok: true, jobId: request.jobId, status: "running", phase: "queued", candidates: [], detailCandidates: [], diagnostics: null };
    }
    if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const activeBudgetTask = automaticLifecycleTask("ozon-active-budget-cleanup");
activeBudgetTask.sourcing = { status: "automatic_running", timing: { elapsedMs: 0, activeStartedAtMs: 0 } };
activeBudgetHarness.setQueue({ tasks: [activeBudgetTask], meta: {} });
const activeBudgetContext = activeBudgetHarness.beginAutomatic(activeBudgetTask, "single");
const activeBudgetResult = await activeBudgetHarness.pollJob(activeBudgetContext, "1688-active-budget-cleanup", { type: "image", sourceUrl: activeBudgetTask.enrichment.mainImageUrl });
await activeBudgetHarness.finishAutomatic(activeBudgetContext);
assert.equal(activeBudgetResult.status, "automatic_timeout",
  "a known running job that crosses the total active budget must stop with the explicit timeout result");
assert.equal(activeBudgetResult.jobId, "1688-active-budget-cleanup",
  "the actual total-budget timeout must retain its known extension job identity");
assert.equal(activeBudgetHarness.extensionRequests.filter((request) => request.action === "cancel_1688_job" && request.jobId === "1688-active-budget-cleanup").length, 1,
  "a known running job at the 150-second boundary must receive exactly one cancel cleanup");

const uiHarness = createAppHarness();
const uiCandidate = {
  ...moqExceptionCandidate,
  sku: { options: [{ id: "sku-78", label: "标准款" }], selectedOptionId: "sku-78", selectionVerified: true },
  evidence: { localRef: "https://evil.example/api/evidence/1688/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
};
const uiTask = {
  taskId: "ozon-ui-review",
  ozon: { sku: "ui-review", name: "确认卡片测试" },
  enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/ui.jpg", maxPurchaseCostAt18Pct: 50 },
  sourcing: {
    activeCandidate: uiCandidate,
    aiJudgement: { confidence: 92, candidateAssessments: [{ candidateId: "1688-78", differences: [] }] },
    quote: { productPrice: null, domesticShipping: null, purchaseCost: null, priceSource: "unknown" },
    finalPricingPreview: null,
    searchAttempts: [{ strategy: "image", durationMs: 1200 }, { strategy: "keyword", durationMs: 2300 }],
    finalConfirmation: {
      confirmationId: "sourcing-confirmation-ui",
      status: "final_confirmation_blocked",
      blockers: ["single_unit_price_unverified", "shipping_unknown"],
      candidateSnapshot: uiCandidate,
    },
  },
  pricing: {},
};
uiHarness.setQueue({ tasks: [uiTask], meta: {} });
uiHarness.renderConfirmation();
const renderedUi = uiHarness.elements.get("confirmationRows");
const renderedUiText = renderedText(renderedUi);
assert.match(renderedUiText, /待确认/, "null monetary facts must be shown as pending confirmation, never as a fabricated amount");
assert.match(renderedUiText, /一件采购价待人工确认/, "blocker codes must be rendered as Chinese operator guidance");
assert.match(renderedUiText, /平台.*MOQ.*价格来源.*分段耗时/s,
  "a confirmation card must expose platform, MOQ, price source, and segmented duration evidence");
assert.equal(walkElements(renderedUi).some((node) => node.textContent === "查看本地证据"), false,
  "a cross-origin evidence URL must never become a clickable local evidence link");
assert.equal(walkElements(renderedUi).some((node) => node.textContent === "确认采用"), false,
  "a blocked card must not offer a confirmation action");
assert.equal(walkElements(renderedUi).some((node) => node.textContent === "否决并尝试下一候选"), false,
  "a blocked card must not offer a stale rejection action");
assert.equal(walkElements(renderedUi).some((node) => node.textContent === "确认客服可一件采购"), true,
  "an unresolved MOQ-two card must retain only its applicable manual exception action");
uiTask.sourcing.finalConfirmation = { ...uiTask.sourcing.finalConfirmation, status: "final_confirmation_confirmed" };
uiHarness.renderConfirmation();
assert.equal(walkElements(uiHarness.elements.get("confirmationRows")).some((node) => /确认采用|否决并尝试下一候选|确认客服可一件采购/.test(node.textContent)), false,
  "a terminal confirmation card must not expose conflicting final actions");

const duplicateTaskHarness = createAppHarness();
const duplicateFirst = { taskId: "duplicate-ui-task", sourcing: {}, pricing: {} };
const duplicateSecond = { taskId: "duplicate-ui-task", sourcing: {}, pricing: {} };
duplicateTaskHarness.setQueue({ tasks: [duplicateFirst, duplicateSecond], meta: {} });
const duplicateBefore = JSON.stringify(duplicateTaskHarness.getQueue());
await assert.rejects(() => duplicateTaskHarness.confirmFinal("duplicate-ui-task"), /唯一|变更|不存在/,
  "an ambiguous task ID must not resolve to the first queue record");
assert.equal(JSON.stringify(duplicateTaskHarness.getQueue()), duplicateBefore,
  "an ambiguous task action must not mutate either duplicate task record");

for (const unsafeInMemoryId of [" leading", "trailing ", "tab\tinside", "control\u0001inside"]) {
  const unsafeIdHarness = createAppHarness();
  const unsafeIdTask = automaticLifecycleTask(unsafeInMemoryId);
  unsafeIdHarness.setQueue({ tasks: [unsafeIdTask], meta: {} });
  const beforeUnsafeIdRun = JSON.stringify(unsafeIdTask);
  await assert.rejects(() => unsafeIdHarness.runAutomatic(unsafeIdTask), /任务ID无效|重复|变更/,
    "an in-memory task must reject its original unsafe ID before starting an automatic bridge job");
  assert.equal(unsafeIdHarness.extensionRequests.length, 0,
    "an unsafe raw task ID must not reach the 1688 bridge");
  assert.equal(JSON.stringify(unsafeIdTask), beforeUnsafeIdRun,
    "rejecting an unsafe raw task ID must not manufacture automatic state on the task");
}

const nullTaskHarness = createAppHarness();
nullTaskHarness.setQueue({ tasks: [null], meta: {} });
await assert.doesNotReject(() => nullTaskHarness.runAutomaticBatch(),
  "a corrupted null queue entry must be contained by the batch catch path instead of throwing again while handling the error");

const exhaustedBudgetHarness = createAppHarness({
  sourcingFlowDeps: { ...sourcingFlow, automaticRequestTimeoutMs: () => 0 },
  extensionHandler: async () => ({ ok: false, error: "a request must not start after the automatic budget is exhausted" }),
});
const exhaustedBudgetTask = {
  taskId: "ozon-auto-budget-1",
  status: "pending_human_review",
  ozon: { sku: "auto-budget-1", name: "预算耗尽商品", allowedGenericTerms: ["预算", "耗尽", "商品"] },
  enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/auto-budget.jpg", maxPurchaseCostAt18Pct: 50 },
  sourcing: {},
  pricing: {},
};
exhaustedBudgetHarness.setQueue({ tasks: [exhaustedBudgetTask], meta: {} });
await exhaustedBudgetHarness.runAutomatic(exhaustedBudgetTask);
assert.ok(exhaustedBudgetTask.sourcing.finalConfirmation.blockers.includes("automatic_timeout"),
  "an exhausted automatic budget must enter the explicit timeout confirmation queue");
assert.equal(exhaustedBudgetHarness.extensionRequests.length, 0,
  "an exhausted automatic budget must not send another 1688 bridge request");

const verificationDiagnosticCandidate = {
  ...automaticCandidate,
  candidateId: "1688-88",
  productId: "88",
  sourceUrl: "https://detail.1688.com/offer/88.html",
  sku: { options: [{ id: "sku-88", label: "标准款" }], selectedOptionId: null, selectionVerified: false },
};
const verificationDiagnosticJobs = new Map();
let verificationDiagnosticSequence = 0;
const verificationDiagnosticHarness = createAppHarness({
  apiHandler: async (path) => {
    if (path === "/api/ai/1688-judge") return {
      ok: true,
      judgement: {
        verdict: "same_product", confidence: 92, bestCandidateId: "1688-88", needsHumanReview: false,
        candidateAssessments: [{ candidateId: "1688-88", verdict: "same_product", confidence: 92, differences: [] }],
      },
      provider: "test", model: "test", usage: {}, judgedAt: "2026-08-31T00:00:00.000Z",
    };
    if (path === "/api/ai/1688-select-sku") return {
      ok: true,
      selection: { verdict: "exact_match", selectedOptionId: "sku-88", confidence: 92, reason: "规格一致", needsHumanReview: false },
      provider: "test", model: "test", usage: {}, judgedAt: "2026-08-31T00:00:00.000Z",
    };
    return { ok: false, error: `unexpected API ${path}` };
  },
  extensionHandler: async (request) => {
    if (request.action === "start_1688_job") {
      const jobId = `1688-diagnostic-${++verificationDiagnosticSequence}`;
      verificationDiagnosticJobs.set(jobId, { jobId, strategy: request.strategy });
      return { ok: true, jobId, status: "queued", phase: "queued" };
    }
    if (request.action === "get_1688_job") {
      const job = verificationDiagnosticJobs.get(request.jobId);
      assert.ok(job, "a verification diagnostic belongs to the job that produced it");
      if (job.strategy.type === "verify_sku") return {
        ok: true, ...job, status: "failed", phase: "failed",
        diagnostics: { code: "stage_timeout", stage: "detail_or_sku" }, candidates: [], detailCandidates: [],
      };
      return { ok: true, ...job, status: "completed", phase: "completed", diagnostics: null, candidates: [verificationDiagnosticCandidate], detailCandidates: [verificationDiagnosticCandidate] };
    }
    if (request.action === "cancel_1688_job") return { ok: true, jobId: request.jobId, status: "cancelled" };
    return { ok: false, error: "unexpected bridge action" };
  },
});
const verificationDiagnosticTask = {
  taskId: "ozon-verify-diagnostic-1",
  status: "pending_human_review",
  ozon: { sku: "verify-diagnostic-1", name: "核验诊断商品", allowedGenericTerms: ["核验", "诊断", "商品"] },
  enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/verify-diagnostic.jpg", maxPurchaseCostAt18Pct: 50 },
  sourcing: {},
  pricing: {},
};
verificationDiagnosticHarness.setQueue({ tasks: [verificationDiagnosticTask], meta: {} });
await verificationDiagnosticHarness.runAutomatic(verificationDiagnosticTask);
assert.equal(verificationDiagnosticTask.sourcing.skuVerification?.diagnostics?.code, "stage_timeout",
  "a SKU-stage timeout diagnostic code must survive in the persisted task state");
assert.equal(verificationDiagnosticTask.sourcing.skuVerification?.diagnostics?.stage, "detail_or_sku",
  "a SKU-stage timeout diagnostic stage must survive in the persisted task state");
assert.ok(verificationDiagnosticTask.sourcing.finalConfirmation.blockers.includes("sku_verification_failed"));

assert.match(serverSource, /127\.0\.0\.1/);
assert.match(serverSource, /MuMuManager\.exe/);
assert.match(serverSource, /adb\(\["shell", "getprop", "sys\.boot_completed"\]/);
assert.match(serverSource, /adb\(\["shell", "pm", "path", PINDUODUO_PACKAGE\]/);
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
assert.match(serverSource, /isTransientUiCaptureError/);
assert.match(serverSource, /attempt <= 3/);
assert.match(serverSource, /saveSkuDiagnostic/);
assert.match(serverSource, /hydrateSeparatedSkuPrices/);
assert.match(serverSource, /selected_header_per_option/);
assert.match(serverSource, /optionPrice/);
assert.match(appSource, /const storageKey = "ozon-sourcing-agent-mvp6"/);
assert.match(appSource, /const legacyStorageKeys = \["ozon-pinduoduo-agent-mvp3"\]/);
assert.match(appSource, /migrateMvp6StoredQueue/);
assert.match(appSource, /x-ozon-agent/);
assert.match(appSource, /eligibleAt18Pct/);
assert.match(appSource, /localStorage\.setItem/);
assert.match(appSource, /async function sourcingExtensionRequest/);
assert.match(appSource, /OZON_SOURCING_EXTENSION_REQUEST_V1/);
assert.match(appSource, /paused_platform_verification/);
assert.match(appSource, /automatic_timeout/);
assert.match(appSource, /async function runAutomatic1688Task/);
assert.match(appSource, /async function runAutomatic1688Batch/);
assert.match(appSource, /async function confirmFinalCandidate/);
assert.match(appSource, /async function rejectFinalCandidate/);
assert.match(appSource, /async function saveSingleUnitException/);
assert.match(appSource, /import \* as sourcingCore from "\/sourcing-core\.mjs"/);
assert.match(qwenSource, /evidenceWarnings/);
assert.match(appSource, /const appVersion = "MVP 6\.0"/);
assert.doesNotMatch(appSource, /MVP 5\.2/);
assert.match(appSource, /requestFinalOzonPricing/);
assert.match(appSource, /preliminaryPricingDecision/);
assert.match(appSource, /createFinalPricingRequestGuard/);
assert.match(appSource, /previewFinalOzonPricing/);
assert.match(appSource, /task\?\.sourcing\?\.provider === "1688"/);
assert.match(appSource, /aiJudgement/);
assert.match(appSource, /renderTimingPanel/);
assert.match(indexSource, /id="timingSummary"/);
assert.match(indexSource, /id="timingRows"/);
assert.match(indexSource, /<title>采购找品 Agent<\/title>/);
assert.match(indexSource, /批量自动找货源/);
assert.match(indexSource, /id="confirmationSummary"/);
assert.match(indexSource, /id="confirmationRows"/);
assert.match(indexSource, /最终商品确认/);
assert.doesNotMatch(indexSource, /id="openPdd"|批量AI判断同款|批量核验规格价/);
const automaticBatchBody = appSource.slice(appSource.indexOf("async function runAutomatic1688Batch"), appSource.indexOf("async function startSinglePinduoduoDeepSearch"));
assert.doesNotMatch(automaticBatchBody, /\/api\/pinduoduo\//, "automatic batch must never call a Pinduoduo endpoint");
assert.doesNotMatch(automaticBatchBody, /\/api\/task\/search/, "automatic batch must never start MuMu deep search");
assert.match(appSource, /startSinglePinduoduoDeepSearch[\s\S]*\/api\/task\/search/, "only the explicit final-card action may use the legacy deep-search endpoint");
assert.match(qwenSource, /qwen3\.7-flash/);
assert.match(qwenSource, /enable_thinking: false/);
assert.match(qwenSource, /response_format/);
assert.match(qwenSource, /bestCandidateId/);
assert.match(qwenSource, /selectSkuOptionWithQwen/);
assert.match(bridgeSource, /OZON_FINAL_REPRICE_REQUEST_V1/);
assert.match(bridgeSource, /http:\/\/127\.0\.0\.1:17628/);
assert.match(bridgeSource, /validTask/);
assert.equal(extensionManifest.version, "0.6.41");
assert.ok(extensionManifest.content_scripts.some((entry) => entry.matches?.includes("http://127.0.0.1:17628/*") && entry.js?.includes("pinduoduo-bridge.js")));
assert.doesNotMatch(qwenSource, /sk-[A-Za-z0-9]{12,}/);
console.log("Pinduoduo agent core tests passed.");
