import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { buildFinalConfirmation, confirmRecommendation, normalizeKeywordResult, normalizeSourcingCandidate, recommendationSafetyGate, rejectRecommendation } from "../pinduoduo-agent/sourcing-core.mjs";
import { parseQwenJsonResponse, readLimitedQwenResponse } from "../pinduoduo-agent/qwen-transport.mjs";
import { isTrusted1688ImageUrl, normalize1688Judgement, normalize1688Keywords, normalize1688SkuSelection } from "../pinduoduo-agent/sourcing-qwen.mjs";
import { previewFinalOzonPricing } from "../pinduoduo-agent/public/pricing-flow.js";
import * as automaticFlowModule from "../pinduoduo-agent/public/sourcing-flow.js";
import {
  AUTOMATIC_1688_LIMITS,
  automaticElapsedMs,
  automaticTimeBudgetExceeded,
  canonical1688OfferUrl,
  detailCandidatesForInspection,
  mergeAutomaticCandidates,
  migrateMvp6StoredQueue,
  nextAutomaticAction,
  pauseAutomaticTiming,
  promoteNextCandidate,
  quoteAutomaticSingleUnit,
  resumeAutomaticTiming,
} from "../pinduoduo-agent/public/sourcing-flow.js";

assert.equal(nextAutomaticAction({ searchAttempts: [] }).type, "start_image_search");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }] }).type, "generate_keywords");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }], keywords: ["测试关键词"] }).type, "start_keyword_search");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }, { strategy: "keyword", usableCount: 0 }] }).type, "start_similar_supplier_search");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }, { strategy: "keyword", usableCount: 0 }, { strategy: "similar_supplier", usableCount: 0 }] }).type, "queue_no_source_confirmation");
assert.equal(nextAutomaticAction({ finalConfirmation: { status: "final_confirmation_pending" } }).type, "complete",
  "a durable final-confirmation record is terminal and must not restart sourcing after refresh");
assert.equal(nextAutomaticAction({ status: "paused_platform_verification", searchAttempts: [] }).type, "pause_platform_verification",
  "platform verification pauses the whole persisted sequence before any new search is started");
assert.equal(promoteNextCandidate([{ candidateId: "a" }, { candidateId: "b" }], ["a"]).candidateId, "b");

const automaticCandidateFixture = (id) => ({
  candidateId: `1688-${id}`,
  sourceUrl: `https://detail.1688.com/offer/${id}.html?from=search`,
  title: `候选${id}`,
});
assert.equal(canonical1688OfferUrl("https://detail.1688.com/offer/42.html?trace=1"), "https://detail.1688.com/offer/42.html");
assert.equal(canonical1688OfferUrl("https://supplier.example/offer/42.html"), "");
const mergedAutomaticCandidates = mergeAutomaticCandidates(
  [automaticCandidateFixture(1)],
  [automaticCandidateFixture(1), ...Array.from({ length: 13 }, (_, index) => automaticCandidateFixture(index + 2))],
);
assert.equal(mergedAutomaticCandidates.length, AUTOMATIC_1688_LIMITS.maxLightweightCandidates,
  "all three strategies together must retain no more than 12 canonical 1688 offers");
assert.deepEqual(mergedAutomaticCandidates.map((entry) => entry.sourceUrl), [
  ...Array.from({ length: 12 }, (_, index) => `https://detail.1688.com/offer/${index + 1}.html`),
]);
assert.equal(detailCandidatesForInspection(mergedAutomaticCandidates).length, AUTOMATIC_1688_LIMITS.maxDetailCandidates,
  "one strategy must inspect no more than five complete details");

const legacyMvp53Task = {
  taskId: "ozon-legacy-1",
  status: "pending_human_review",
  history: [{ stage: "mvp5.3", result: "kept" }],
  sourcing: { searchCandidates: [{ candidateId: "legacy-candidate" }], legacyResult: { selected: true } },
  pricing: { purchaseCost: 12.34, sourceUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=1" },
};
const legacyMvp53Saved = { queue: { meta: { pinduoduoBatch: { cursor: 2 }, preservedFlag: "yes" }, tasks: [legacyMvp53Task] }, sourceName: "mvp53.json" };
const migratedMvp6Saved = migrateMvp6StoredQueue(null, [JSON.stringify(legacyMvp53Saved)]);
assert.equal(migratedMvp6Saved.migratedFromLegacy, true, "an absent mvp6 record must copy the first valid MVP 5.3 queue");
assert.equal(migratedMvp6Saved.saved.sourceName, "mvp53.json");
assert.equal(migratedMvp6Saved.saved.queue.meta.sourcingSchema, "mvp6");
assert.deepEqual(migratedMvp6Saved.saved.queue.meta.pinduoduoBatch, { cursor: 2 }, "migration must retain legacy batch recovery data");
assert.equal(migratedMvp6Saved.saved.queue.tasks[0].history[0].result, "kept", "migration must retain MVP 5.3 history");
assert.equal(migratedMvp6Saved.saved.queue.tasks[0].sourcing.legacyResult.selected, true, "migration must retain historical candidates and manual decisions");
assert.deepEqual(migratedMvp6Saved.saved.queue.meta.singleUnitExceptions, {});

let automaticTiming = resumeAutomaticTiming({}, 0);
automaticTiming = pauseAutomaticTiming(automaticTiming, 20_000);
assert.equal(automaticElapsedMs(automaticTiming, 2_000_000), 20_000,
  "time spent paused for a platform verification must not consume the active sourcing budget");
automaticTiming = resumeAutomaticTiming(automaticTiming, 2_000_000);
assert.equal(automaticTimeBudgetExceeded(automaticTiming, 2_129_999), false);
assert.equal(automaticTimeBudgetExceeded(automaticTiming, 2_130_000), true,
  "the automatic sequence must stop after 150 active seconds, excluding platform-verification pauses");
assert.equal(automaticFlowModule.automaticRequestTimeoutMs?.({ elapsedMs: 149_000 }, 75_000, 2_000_000), 1_000,
  "a Qwen or bridge request may consume only the remaining active 1688 budget");
assert.equal(automaticFlowModule.automaticRequestTimeoutMs?.({ elapsedMs: 150_000 }, 15_000, 2_000_000), 0,
  "an exhausted automatic task must not start another bridge request");

const candidate = {
  provider: "1688",
  candidateId: "1688-1",
  sourceUrl: "https://detail.1688.com/offer/1.html",
  title: "测试商品",
  minimumOrderQuantity: 1,
  pricing: { selectedSkuPrice: 20, priceSource: "selected_sku" },
  shipping: { status: "known", fee: 3 },
  sku: { selectedOptionId: "sku-1", selectionVerified: true },
};
const judgement = {
  verdict: "same_product",
  confidence: 92,
  bestCandidateId: "1688-1",
  needsHumanReview: false,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "same_product", confidence: 92, differences: [] }],
};
const quote = { confirmable: true, productPrice: 20, domesticShipping: 3, purchaseCost: 23, priceSource: "selected_sku", blockers: [] };

const manualExceptionCandidate = {
  ...candidate,
  minimumOrderQuantity: 2,
  pricing: { selectedSkuPrice: 20, onePiecePrice: null, samplePrice: null, priceSource: "selected_sku" },
};
const manualExceptionQuote = {
  confirmable: true,
  productPrice: 20.5,
  domesticShipping: 3,
  purchaseCost: 23.5,
  priceSource: "manual_exact_product_exception",
  blockers: [],
};
assert.deepEqual(recommendationSafetyGate(manualExceptionCandidate, judgement, manualExceptionQuote).blockers, [],
  "an exact-product Task 2 manual one-piece exception may pass only with a complete, internally consistent quote");

const twoUnitAutomaticCandidate = {
  ...candidate,
  productId: "1",
  minimumOrderQuantity: 2,
  supportsOnePiece: false,
  supportsSample: false,
  pricing: { selectedSkuPrice: 20, onePiecePrice: null, samplePrice: null, priceSource: "selected_sku" },
};
assert.ok(quoteAutomaticSingleUnit(twoUnitAutomaticCandidate).blockers.includes("single_unit_price_unverified"),
  "MOQ two must never borrow a tier price as a single-unit cost");
const exactAutomaticException = {
  productId: "1",
  sourceUrl: "https://detail.1688.com/offer/1.html?copy=1",
  onePiecePrice: 20.5,
  confirmedAt: "2026-08-31T00:00:00.000Z",
};
assert.deepEqual(quoteAutomaticSingleUnit(twoUnitAutomaticCandidate, exactAutomaticException), {
  confirmable: true,
  productPrice: 20.5,
  domesticShipping: 3,
  purchaseCost: 23.5,
  priceSource: "manual_exact_product_exception",
  blockers: [],
});
assert.ok(quoteAutomaticSingleUnit(twoUnitAutomaticCandidate, {
  ...exactAutomaticException,
  sourceUrl: "https://detail.1688.com/offer/999.html",
}).blockers.includes("single_unit_price_unverified"),
"a one-piece exception must not follow a supplier URL to another exact product");

assert.deepEqual(recommendationSafetyGate(candidate, judgement, quote).blockers, []);
const task = { taskId: "ozon-1001", ozon: { sku: "1001" }, sourcing: {}, pricing: {} };
const finalPricingResponse = {
  ok: true,
  maxPurchaseCostAt18Pct: 23,
  effectiveGreenPrice: 121.18,
  originalBlackPrice: 128.95,
  internationalFreight: 52.52,
  selectedCommission: 20,
  calculation: { route: "RU" },
};
const finalPricingTaskBefore = JSON.stringify(task);
const finalPricingResponseBefore = JSON.stringify(finalPricingResponse);
const finalPricingPreview = previewFinalOzonPricing(task, finalPricingResponse, quote.purchaseCost, "2026-08-31T00:00:00.000Z");
assert.equal(JSON.stringify(task), finalPricingTaskBefore, "1688 preview must not write pricing before confirmation");
assert.equal(JSON.stringify(finalPricingResponse), finalPricingResponseBefore, "1688 preview must not mutate the Ozon response");
const current = { task, candidate, judgement, quote, finalPricing: finalPricingPreview };
for (const unsafeTaskId of [" task-1", "task-1 ", "task\n1", "task\t1", "task\u00a01", "task\u200b1", "ｔａｓｋ-1"]) {
  assert.throws(() => buildFinalConfirmation({
    task: { taskId: unsafeTaskId, id: "safe-fallback-id" }, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true },
  }), /任务身份/,
  "task IDs must reject raw whitespace, controls, format characters, fullwidth text, and unsafe fallback");
  assert.throws(() => buildFinalConfirmation({
    task: { id: unsafeTaskId }, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true },
  }), /任务身份/,
  "fallback IDs must apply the same raw strict validation as taskId");
}
assert.throws(() => buildFinalConfirmation({
  task: { id: new String("stable-job-1") }, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true },
}), /任务身份/,
"task IDs must be primitive strings, not coercible objects");
assert.throws(() => buildFinalConfirmation({ candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } }), /任务身份/,
  "a final confirmation must bind to a stable, explicit task identity");
assert.throws(() => buildFinalConfirmation({ task: { ozon: { sku: "same-sku" } }, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } }), /任务身份/,
  "SKU-only task A must not receive a confirmation capability");
assert.throws(() => buildFinalConfirmation({ task: { ozon: { sku: "same-sku" } }, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } }), /任务身份/,
  "SKU-only task B must not receive a confirmation capability even with the same SKU");
assert.equal(buildFinalConfirmation({ task: { id: "stable-job-1" }, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } }).status, "final_confirmation_pending",
  "an explicit safe task id may establish the capability identity");
const pending = buildFinalConfirmation({ task, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } });
assert.equal(pending.status, "final_confirmation_pending");
assert.equal(pending.purchaseCost, 23);
assert.throws(() => confirmRecommendation(task, pending), /最新可信确认数据/,
  "the old two-argument confirmation must fail closed instead of using a stale WeakMap snapshot");
const sameIdOtherTask = { taskId: "ozon-1001", ozon: { sku: "1001" }, sourcing: {}, pricing: {} };
const clonedTask = JSON.parse(JSON.stringify(task));
assert.throws(() => confirmRecommendation(sameIdOtherTask, pending, { ...current, task: sameIdOtherTask }), /任务.*身份/,
  "a distinct task object must not confirm another task's pending record even with the same taskId");
assert.throws(() => rejectRecommendation(sameIdOtherTask, pending), /任务.*身份/,
  "a distinct task object must not reject another task's pending record even with the same taskId");
assert.throws(() => confirmRecommendation(clonedTask, pending, { ...current, task: clonedTask }), /任务.*身份/,
  "a deserialized task clone must not reuse an in-memory confirmation capability");
const otherTask = { taskId: "ozon-1002", ozon: { sku: "1001" }, sourcing: {}, pricing: {} };
assert.throws(() => confirmRecommendation(otherTask, pending, current), /任务身份/,
  "a pending confirmation for task A must not write task B");
assert.throws(() => confirmRecommendation(task, pending, { ...current, task: otherTask }), /任务身份/,
  "current evidence from task B must not confirm task A");
task.taskId = "ozon-identity-changed";
assert.throws(() => confirmRecommendation(task, pending, current), /任务身份/,
  "a task identity change after pending creation must invalidate confirmation");
task.taskId = "ozon-1001";
assert.throws(() => confirmRecommendation(task, pending, {
  ...current,
  candidate: { ...candidate, pricing: { selectedSkuPrice: 21, priceSource: "selected_sku" } },
  quote: { ...quote, productPrice: 21, purchaseCost: 24 },
}), /当前确认数据已变化/,
  "price changes between pending and confirmation must not write procurement cost");
confirmRecommendation(task, pending, current, "2026-08-31T00:00:00.000Z");
assert.equal(task.sourcing.status, "confirmed_purchase_source");
assert.equal(task.pricing.purchaseCost, 23);
assert.equal(task.pricing.sourceUrl, candidate.sourceUrl);
assert.equal(confirmRecommendation(task, pending, current, "2026-08-31T00:01:00.000Z").idempotent, true, "a terminal confirmation must be idempotent");
assert.equal(rejectRecommendation(task, pending, "2026-08-31T00:02:00.000Z").idempotent, true, "a terminal confirmation cannot be reversed");
assert.throws(() => confirmRecommendation(sameIdOtherTask, pending, { ...current, task: sameIdOtherTask }), /任务.*身份/,
  "terminal confirmation idempotency is limited to the task object that created the capability");
assert.throws(() => rejectRecommendation(sameIdOtherTask, pending), /任务.*身份/,
  "terminal rejection idempotency is limited to the task object that created the capability");
assert.throws(() => confirmRecommendation({}, { ...pending, status: "final_confirmation_pending" }), /有效待确认/,
  "a copied pending confirmation must not be accepted as an authority to write pricing");
assert.throws(() => confirmRecommendation(task, JSON.parse(JSON.stringify(pending)), current), /有效待确认/,
  "a serialized pending confirmation must lose its in-memory capability and require a rebuild");

const keywordContext = {
  allowedBrand: "",
  allowedModel: "",
  allowedGenericTerms: ["汽车", "螺丝刀", "丝杠", "组合", "更换设备", "滚珠丝杠", "维修套装", "合规关键词", "普通", "运动鞋", "鞋类"],
  categoryTerms: "运动鞋",
};
assert.deepEqual(normalizeKeywordResult({ keywords: ["汽车 螺丝刀", "汽车 螺丝刀", "品牌X 型号Y"] }, keywordContext), ["汽车 螺丝刀"]);
assert.deepEqual(normalizeKeywordResult({ keywords: ["丝杠 组合 更换设备", "滚珠丝杠 维修套装"] }, keywordContext), ["丝杠 组合 更换设备", "滚珠丝杠 维修套装"]);
assert.deepEqual(normalizeKeywordResult({ keywords: ["品牌X 型号Y", "合规关键词", "合规关键词", "x".repeat(41)] }, { allowedBrand: "品牌A", allowedModel: "型号B", allowedGenericTerms: "合规关键词" }), ["合规关键词"],
  "keywords must not invent unverified brand/model text, duplicates, or oversized values");
assert.deepEqual(normalizeKeywordResult({ keywords: ["耐克 跑步鞋", "阿迪达斯 跑步鞋", "普通 运动鞋", "¥20 跑步鞋", "采购价 20元", "普通\u0001关键词"] }, {
  allowedBrand: "耐克",
  allowedModel: "",
  allowedGenericTerms: ["跑步鞋", "普通", "运动鞋"],
}), ["耐克 跑步鞋", "普通 运动鞋"],
  "keywords must preserve ordinary categories but reject unproven brand, control, and price/procurement text");
assert.deepEqual(normalizeKeywordResult({ keywords: ["价格 运动鞋", "price running shoes", "普通 鞋类"] }, keywordContext), ["普通 鞋类"],
  "obvious commercial words must fail closed even when a model omits an amount");
assert.deepEqual(normalizeKeywordResult({ keywords: ["耐克 跑步鞋", "阿迪达斯 跑步鞋"] }, {
  allowedBrand: "耐克",
  allowedModel: "",
  allowedGenericTerms: "跑步鞋",
  trustedTitle: "耐克 阿迪达斯 跑步鞋",
}), ["耐克 跑步鞋"],
  "a free title must never authorize an unlisted brand token");
assert.deepEqual(normalizeKeywordResult({ keywords: ["普通 运动鞋"] }, { allowedBrand: "", allowedModel: "", categoryTerms: ["普通", "运动鞋"] }), ["普通 运动鞋"],
  "ordinary no-brand category keywords require explicit structured category terms");
assert.deepEqual(normalizeKeywordResult({ keywords: ["耐克 跑步鞋"] }, { allowedBrand: "耐克", allowedModel: "" }), [],
  "without safe generic terms, a brand plus an unlisted category term must fail closed");
assert.deepEqual(normalizeKeywordResult({ keywords: ["价\u200b格 运动鞋", "采\u200b购价 运动鞋", "\ufeff普通 鞋类"] }, keywordContext), [],
  "Unicode Cc/Cf characters and formatting-obfuscated commercial text must be rejected");
assert.deepEqual(normalizeKeywordResult({ keywords: ["价格 运动鞋"] }, { allowedBrand: "", allowedModel: "", allowedGenericTerms: ["价\u200b格", "运动鞋"] }), [],
  "unsafe structured generic terms must not grant commercial keyword permission");
assert.deepEqual(normalizeKeywordResult({ keywords: ["普通 鞋类", "阿迪达斯 鞋类", "普通\u200b鞋类"] }, {
  trustedGenericTerms: ["普通", "鞋类", "价\u200b格", "采购价", "x".repeat(41)],
}), ["普通 鞋类"],
"trusted generic terms must use the same safe per-token allowlist while rejecting competitors and format controls");
assert.deepEqual(normalizeKeywordResult({ keywords: ["普通 鞋类"] }, Object.create({ trustedGenericTerms: ["普通", "鞋类"] })), [],
  "trusted generic terms must be own fields of a plain evidence object");

assert.equal(normalizeSourcingCandidate({ ...candidate, ignored: "must-not-pass" }).ignored, undefined,
  "candidate normalization must use an allowlist rather than retain model-controlled fields");
assert.ok(recommendationSafetyGate(candidate, { ...judgement, confidence: 84 }, quote).blockers.includes("confidence_below_85"));
assert.ok(recommendationSafetyGate(candidate, {
  ...judgement,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "different_product", confidence: 95, differences: [] }],
}, quote).blockers.includes("candidate_assessment_conflict"));
assert.ok(recommendationSafetyGate(candidate, judgement, { ...quote, productPrice: 21, purchaseCost: 24 }).blockers.includes("price_changed"));
assert.ok(recommendationSafetyGate({ ...candidate, sku: { selectionVerified: false } }, judgement, quote).blockers.includes("sku_not_verified"));
assert.ok(recommendationSafetyGate({ ...candidate, minimumOrderQuantity: 3 }, judgement, quote).blockers.includes("minimum_order_quantity_gt_2"));
assert.ok(recommendationSafetyGate({ ...candidate, minimumOrderQuantity: 2 }, judgement, quote).blockers.includes("single_unit_price_unverified"),
  "MOQ=2 needs the already-confirmed Task 2 single-unit quote instead of an AI-made exception");
assert.ok(recommendationSafetyGate(candidate, { ...judgement, needsHumanReview: true }, quote).blockers.includes("needs_human_review"));
for (const unsafeNeedsReview of [undefined, null, "false", 0]) {
  assert.ok(recommendationSafetyGate(candidate, { ...judgement, needsHumanReview: unsafeNeedsReview }, quote).blockers.includes("needs_human_review"),
    "only the boolean false may pass the human-review gate");
}
assert.ok(recommendationSafetyGate(candidate, judgement, { ...quote, confirmable: false }).blockers.includes("quote_not_confirmable"));
assert.throws(() => confirmRecommendation(task, pending, Object.create(current)), /最新可信确认数据/,
  "current confirmation data must not be read from an inherited object");
const prototypePending = buildFinalConfirmation({ task, candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } });
Object.setPrototypeOf(prototypePending, { forged: true });
assert.throws(() => confirmRecommendation(task, prototypePending, current), /有效待确认/,
  "a pending capability with a non-plain prototype must be rejected");
Object.prototype.needsHumanReview = false;
try {
  const missingOwnReview = { ...judgement };
  delete missingOwnReview.needsHumanReview;
  assert.ok(recommendationSafetyGate(candidate, missingOwnReview, quote).blockers.includes("needs_human_review"),
    "inherited false must never clear human review");
  assert.ok(recommendationSafetyGate(Object.create(candidate), judgement, quote).blockers.includes("candidate_not_whitelisted"),
    "inherited candidate fields must not enter the safety gate");
  assert.ok(recommendationSafetyGate(candidate, judgement, Object.create(quote)).blockers.includes("quote_not_confirmable"),
    "inherited quote fields must not become a confirmable quote");
} finally {
  delete Object.prototype.needsHumanReview;
}

assert.deepEqual(parseQwenJsonResponse('{"keywords":["合规关键词"]}'), { keywords: ["合规关键词"] });
assert.throws(() => parseQwenJsonResponse('```json\n{"keywords":[]}\n```'), /JSON/,
  "Markdown fences must not be accepted as model JSON");
assert.throws(() => parseQwenJsonResponse('{"keywords":[]} trailing'), /JSON/,
  "extra model prose must fail closed instead of being sliced into JSON");
let streamCancelled = false;
const oversizedStream = new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); },
  cancel() { streamCancelled = true; },
});
await assert.rejects(readLimitedQwenResponse({ headers: new Headers(), body: oversizedStream }, 12), /超过安全大小限制/,
  "chunked responses without Content-Length must stop immediately once oversized");
assert.equal(streamCancelled, true, "oversized Qwen streams must be cancelled");
await assert.rejects(readLimitedQwenResponse({ headers: new Headers(), body: null, text: async () => "x".repeat(20) }, 12), /超过安全大小限制/,
  "the no-body compatibility fallback must still enforce a response limit");
await assert.rejects(readLimitedQwenResponse({ headers: new Headers(), body: { getReader: () => ({ read: async () => { const error = new Error("reader secret"); error.name = "AbortError"; throw error; }, cancel: async () => {}, releaseLock: () => {} }) } }),
  (error) => error.message === "千问调用超时，请稍后重试。" && !error.message.includes("reader secret"),
  "reader abort errors must map to a redacted timeout");
await assert.rejects(readLimitedQwenResponse({ headers: new Headers(), body: null, text: async () => { throw new Error("ordinary secret"); } }),
  (error) => error.message === "千问响应读取失败，请稍后重试。" && !error.message.includes("ordinary secret"),
  "reader failures must not expose error messages");
assert.equal(isTrusted1688ImageUrl("https://cbu01.alicdn.com/img/ibank/O1CN01.jpg"), true);
assert.equal(isTrusted1688ImageUrl("http://cbu01.alicdn.com/img/ibank/O1CN01.jpg"), false);
assert.equal(isTrusted1688ImageUrl("https://alicdn.com.evil.example/image.jpg"), false);
assert.equal(isTrusted1688ImageUrl("https://evil.example/image.jpg"), false);
assert.throws(() => normalize1688Keywords({ keywords: ["合规关键词"], ignored: true }, {}), /严格Schema/,
  "extra model fields must fail closed");
assert.throws(() => normalize1688Judgement({
  verdict: "same_product", confidence: 101, bestCandidateId: "1688-1", needsHumanReview: false,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "same_product", confidence: 101, differences: [] }],
}, [candidate]), /置信度/,
  "out-of-range confidence must be rejected instead of trusted");
assert.throws(() => normalize1688Judgement({
  verdict: "same_product", confidence: 95, bestCandidateId: "1688-1", needsHumanReview: "false",
  candidateAssessments: [{ candidateId: "1688-1", verdict: "same_product", confidence: 95, differences: [] }],
}, [candidate]), /白名单/,
  "a string false must never silently clear human review");
assert.throws(() => normalize1688Judgement({
  verdict: "same_product", confidence: 95, bestCandidateId: "not-in-input", needsHumanReview: false,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "same_product", confidence: 95, differences: [] }],
}, [candidate]), /白名单/,
  "a model may not nominate a nonexistent candidate");
assert.throws(() => normalize1688Judgement({
  verdict: "same_product", confidence: 95, bestCandidateId: "1688-1", needsHumanReview: false,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "same_product", confidence: 95, differences: [] }],
}, [{ ...candidate, sourceUrl: "https://untrusted.example/offer/1.html" }]), /输入白名单/,
  "1688 decisions require Task 2's canonical candidate URL, not an arbitrary HTTPS link");
const contradictoryJudgement = normalize1688Judgement({
  verdict: "same_product", confidence: 95, bestCandidateId: "1688-1", needsHumanReview: false,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "different_product", confidence: 95, differences: [] }],
}, [candidate]);
assert.ok(recommendationSafetyGate(candidate, contradictoryJudgement, quote).blockers.includes("candidate_assessment_conflict"),
  "a contradictory 95% answer must reach the provider-neutral blocker");
assert.throws(() => normalize1688SkuSelection({
  verdict: "exact_match", selectedOptionId: "sku-not-in-input", confidence: 95, reason: "同款", needsHumanReview: false,
}, [{ optionId: "sku-1", label: "红色" }]), /白名单/,
  "a model may not select a nonexistent SKU");
assert.equal(normalize1688SkuSelection({
  verdict: "no_match", selectedOptionId: null, confidence: 60, reason: "规格不一致", needsHumanReview: true,
}, [{ optionId: "sku-1", label: "红色" }]).selectedOptionId, null,
  "no-match responses may decline every whitelisted SKU without inventing one");
assert.throws(() => normalize1688SkuSelection({
  verdict: "exact_match", selectedOptionId: "sku-1", confidence: 95, reason: "同款", needsHumanReview: "false",
}, [{ optionId: "sku-1", label: "红色" }]), /白名单/,
  "a string false must never clear human review for SKU selection");

const serverSource = fs.readFileSync(new URL("../pinduoduo-agent/server.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const endpoint of ["/api/ai/1688-keywords", "/api/ai/1688-judge", "/api/ai/1688-select-sku", "/api/evidence/1688"]) {
  assert.ok(serverSource.includes(endpoint), `${endpoint} must be registered by the local agent`);
}
assert.match(serverSource, /image\/jpeg/);
assert.match(serverSource, /1024 \* 1024/);
assert.match(serverSource, /randomUUID/);
assert.equal(packageJson.scripts["test:sourcing-agent-1688"], "node tools/test-sourcing-agent-1688.mjs");
assert.match(packageJson.scripts.test, /test-sourcing-agent-1688/);

async function startLocalAgent() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["pinduoduo-agent/server.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { OZON_PDD_AGENT_PORT: String(port), OZON_AGENT_NO_BROWSER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("本地Agent启动超时。")), 10000);
    child.stdout.on("data", (chunk) => {
      output.push(String(chunk));
      if (output.join("").includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", (chunk) => output.push(String(chunk)));
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`本地Agent提前退出：${code} ${output.join("")}`)); });
  });
  await ready;
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function rawHttpStatus(baseUrl, requestPath) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: url.hostname, port: url.port, method: "GET", path: requestPath }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

const agent = await startLocalAgent();
try {
  const sourcingCoreModule = await fetch(`${agent.baseUrl}/sourcing-core.mjs`);
  assert.equal(sourcingCoreModule.status, 200, "the browser may import only the reviewed sourcing-core module");
  assert.match(sourcingCoreModule.headers.get("content-type") || "", /^text\/javascript;\s*charset=utf-8$/i);
  assert.equal(sourcingCoreModule.headers.get("cache-control"), "no-store");
  const sourcingCoreText = await sourcingCoreModule.text();
  assert.match(sourcingCoreText, /buildFinalConfirmation/);
  assert.doesNotMatch(sourcingCoreText, /DASHSCOPE_API_KEY|sk-[A-Za-z0-9]{12,}/,
    "the narrow browser module route must not disclose an agent secret");
  for (const invalidCoreRequest of [
    new Request(`${agent.baseUrl}/sourcing-core.mjs`, { method: "POST" }),
    new Request(`${agent.baseUrl}/sourcing-core.mjs/`),
    new Request(`${agent.baseUrl}/sourcing-core.mjs%2F..%2Fqwen-client.mjs`),
  ]) {
    const response = await fetch(invalidCoreRequest);
    assert.ok(response.status === 404 || response.status === 405,
      `only exact GET /sourcing-core.mjs may expose the reviewed browser module: ${invalidCoreRequest.method} ${new URL(invalidCoreRequest.url).pathname}`);
  }
  assert.equal(await rawHttpStatus(agent.baseUrl, "/sourcing-core.mjs?"), 404,
    "a raw trailing question mark is a query form, not the exact reviewed module route");

  const evidenceTaskId = `task-${Date.now()}`;
  const evidenceCandidateId = "1688-123";
  const evidencePath = `/api/evidence/1688?taskId=${evidenceTaskId}&candidateId=${evidenceCandidateId}`;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
  const denied = await fetch(`${agent.baseUrl}${evidencePath}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg });
  assert.equal(denied.status, 403, "all 1688 POST routes require the localhost UI header");
  for (const route of ["/api/ai/1688-keywords", "/api/ai/1688-judge", "/api/ai/1688-select-sku"]) {
    assert.equal((await fetch(`${agent.baseUrl}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403,
      `${route} requires the localhost UI header`);
  }
  const savedResponse = await fetch(`${agent.baseUrl}${evidencePath}`, {
    method: "POST", headers: { "content-type": "image/jpeg", "x-ozon-agent": "local-ui-v1" }, body: jpeg,
  });
  assert.equal(savedResponse.status, 200);
  assert.match(savedResponse.headers.get("content-type") || "", /^application\/json/);
  const saved = await savedResponse.json();
  assert.match(saved.localRef, /^\/api\/evidence\/1688\/[a-f0-9]{32}$/i, "evidence POST returns only an opaque local reference");
  const fetchedEvidence = await fetch(`${agent.baseUrl}${saved.localRef}`);
  assert.equal(fetchedEvidence.status, 200);
  assert.deepEqual(new Uint8Array(await fetchedEvidence.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${agent.baseUrl}/api/evidence/evidence/1688/${evidenceTaskId}/guessed.jpg`)).status, 404,
    "the generic evidence route must not expose the dedicated 1688 storage subtree");
  assert.equal((await fetch(`${agent.baseUrl}/api/evidence/evidence/${evidenceTaskId}/1688-${evidenceCandidateId}.jpg`)).status, 404,
    "guessed legacy 1688 task/candidate paths must not bypass the opaque localRef capability");
  const malformedJpeg = await fetch(`${agent.baseUrl}${evidencePath}`, {
    method: "POST", headers: { "content-type": "image/jpeg", "x-ozon-agent": "local-ui-v1" }, body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  });
  assert.equal(malformedJpeg.status, 500, "JPEG needs SOI, structure, and EOI evidence");
  const truncatedJpegSegment = await fetch(`${agent.baseUrl}${evidencePath}`, {
    method: "POST", headers: { "content-type": "image/jpeg", "x-ozon-agent": "local-ui-v1" }, body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00, 0xff, 0xd9]),
  });
  assert.equal(truncatedJpegSegment.status, 500, "JPEG marker segment lengths must be structurally plausible");
  const traversal = await fetch(`${agent.baseUrl}/api/evidence/1688?taskId=..%2Fescape&candidateId=1688-123`, {
    method: "POST", headers: { "content-type": "image/jpeg", "x-ozon-agent": "local-ui-v1" }, body: jpeg,
  });
  assert.equal(traversal.status, 500);
  const tooLargeEvidence = await fetch(`${agent.baseUrl}${evidencePath}`, {
    method: "POST", headers: { "content-type": "image/jpeg", "x-ozon-agent": "local-ui-v1" }, body: new Uint8Array(1024 * 1024 + 1),
  });
  assert.equal(tooLargeEvidence.status, 500);
  const badSchema = await fetch(`${agent.baseUrl}/api/ai/1688-judge`, {
    method: "POST", headers: { "content-type": "application/json", "x-ozon-agent": "local-ui-v1" }, body: "{}",
  });
  assert.equal(badSchema.status, 500, "1688 AI endpoints validate body fields before any Qwen request");
  const wrongJsonType = await fetch(`${agent.baseUrl}/api/ai/1688-keywords`, {
    method: "POST", headers: { "content-type": "text/plain", "x-ozon-agent": "local-ui-v1" }, body: "{}",
  });
  assert.equal(wrongJsonType.status, 500);
  assert.match((await wrongJsonType.json()).error, /application\/json/);
  const tooLargeJson = await fetch(`${agent.baseUrl}/api/ai/1688-keywords`, {
    method: "POST", headers: { "content-type": "application/json", "x-ozon-agent": "local-ui-v1" }, body: "{" + "x".repeat(1024 * 1024 + 1),
  });
  assert.equal(tooLargeJson.status, 500);
  assert.equal((await fetch(`${agent.baseUrl}/api/ai/1688-keywords`)).status, 404, "1688 AI routes are POST-only");
} finally {
  agent.child.kill();
  await once(agent.child, "exit");
}

console.log("1688 sourcing safety tests passed");
