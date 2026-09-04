import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { aiJudgementReadiness, applySelectedCandidate, candidateInspectionOrder, detectPinduoduoRiskPage, extractPinduoduoCandidates, extractPinduoduoDetail, extractPinduoduoSkuSheet, findUiNode, isTrustedOzonImageUrl, normalizeAiJudgement, normalizeSkuSelection, parseMumuInfo, parsePinduoduoRoute, parseUiNodes, pinduoduoFavoriteState, pinduoduoProductGoodsId, queueStats, reconcilePinduoduoDisplayedPrice, resolveAiRecommendedCandidate, safeTaskFileName, taskReadiness } from "../pinduoduo-agent/core.mjs";
import { applyFinalOzonPricing, createFinalPricingRequestGuard, MAX_OZON_PREVIEW_MONEY, preliminaryPricingDecision, previewFinalOzonPricing } from "../pinduoduo-agent/public/pricing-flow.js";
import * as sourcingFlow from "../pinduoduo-agent/public/sourcing-flow.js";
import { buildFinalConfirmation, confirmRecommendation, rejectRecommendation } from "../pinduoduo-agent/sourcing-core.mjs";
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

function createAppHarness({ apiHandler = null, extensionHandler = null, finalPricingResponse = null, storedValues = {}, sourcingFlowDeps = sourcingFlow } = {}) {
  const listeners = new Set();
  const requests = [];
  const extensionRequests = [];
  const apiRequests = [];
  const elements = new Map();
  const element = () => ({
    style: {}, children: [], value: "", textContent: "", className: "", innerHTML: "", disabled: false,
    addEventListener() {}, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
  });
  const emitMessage = (data) => {
    for (const listener of listeners) listener({ source: fakeWindow, origin: fakeWindow.location.origin, data });
  };
  const fakeWindow = {
    location: { origin: "http://127.0.0.1:17628" },
    confirm() { return true; },
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
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
    __sourcingFlowDeps: sourcingFlowDeps,
    // The VM owns app-created object literals while the imported safety module
    // is evaluated in this test realm. Keep the task reference intact for
    // Task 5's capability check, while copying only untrusted serial facts
    // across that artificial realm boundary.
    __sourcingCoreDeps: {
      buildFinalConfirmation(input) {
        return buildFinalConfirmation({
          task: input.task,
          candidate: JSON.parse(JSON.stringify(input.candidate)),
          judgement: JSON.parse(JSON.stringify(input.judgement)),
          quote: JSON.parse(JSON.stringify(input.quote)),
          finalPricing: JSON.parse(JSON.stringify(input.finalPricing)),
        });
      },
      confirmRecommendation(task, pending, current, confirmedAt) {
        return confirmRecommendation(task, pending, {
          task: current.task,
          candidate: JSON.parse(JSON.stringify(current.candidate)),
          judgement: JSON.parse(JSON.stringify(current.judgement)),
          quote: JSON.parse(JSON.stringify(current.quote)),
          finalPricing: JSON.parse(JSON.stringify(current.finalPricing)),
        }, confirmedAt);
      },
      rejectRecommendation,
    },
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
    URL, Blob, console, setTimeout, clearTimeout, AbortController,
  };
  const appForVm = appSource
    .replace(/^import .* from "\.\/pricing-flow\.js";\r?$/m,
      "const { applyFinalOzonPricing, createFinalPricingRequestGuard, preliminaryPricingDecision, previewFinalOzonPricing } = globalThis.__pricingDeps;")
    .replace(/^import \* as sourcingFlow from "\.\/sourcing-flow\.js";\r?$/m, "const sourcingFlow = globalThis.__sourcingFlowDeps;")
    .replace(/^import \* as sourcingCore from "\/sourcing-core\.mjs";\r?$/m, "const sourcingCore = globalThis.__sourcingCoreDeps;")
    + "\nglobalThis.__appTest = { commitPurchaseCostWithFinalPricing, runAutomatic1688Task, runAutomatic1688Batch, confirmFinalCandidate, rejectFinalCandidate, saveSingleUnitException, startSinglePinduoduoDeepSearch, setQueue: (value) => { queue = value; }, getQueue: () => queue };";
  vm.runInNewContext(appForVm, context, { filename: "app.js" });
  return {
    commit: context.__appTest.commitPurchaseCostWithFinalPricing,
    runAutomatic: context.__appTest.runAutomatic1688Task,
    runAutomaticBatch: context.__appTest.runAutomatic1688Batch,
    confirmFinal: context.__appTest.confirmFinalCandidate,
    rejectFinal: context.__appTest.rejectFinalCandidate,
    saveException: context.__appTest.saveSingleUnitException,
    startSinglePinduoduo: context.__appTest.startSinglePinduoduoDeepSearch,
    setQueue: context.__appTest.setQueue,
    getQueue: context.__appTest.getQueue,
    apiRequests,
    extensionRequests,
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

async function waitForFinalPricingRequest(harness, previousRequest = null) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const request = harness.nextRequest();
    if (request && request !== previousRequest) return request;
    await Promise.resolve();
  }
  assert.fail("expected the app to send a final Ozon pricing request");
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
  candidateId: "1688-verify-timeout",
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
        verdict: "same_product", confidence: 92, bestCandidateId: "1688-verify-timeout", needsHumanReview: false,
        candidateAssessments: [{ candidateId: "1688-verify-timeout", verdict: "same_product", confidence: 92, differences: [] }],
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
assert.equal(extensionManifest.version, "0.6.30");
assert.ok(extensionManifest.content_scripts.some((entry) => entry.matches?.includes("http://127.0.0.1:17628/*") && entry.js?.includes("pinduoduo-bridge.js")));
assert.doesNotMatch(qwenSource, /sk-[A-Za-z0-9]{12,}/);
console.log("Pinduoduo agent core tests passed.");
