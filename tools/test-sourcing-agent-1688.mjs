import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFinalConfirmation, confirmRecommendation, normalizeKeywordResult, normalizeSourcingCandidate, recommendationSafetyGate, rejectRecommendation } from "../pinduoduo-agent/sourcing-core.mjs";
import { parseQwenJsonResponse } from "../pinduoduo-agent/qwen-transport.mjs";
import { isTrusted1688ImageUrl, normalize1688Judgement, normalize1688Keywords, normalize1688SkuSelection } from "../pinduoduo-agent/sourcing-qwen.mjs";

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

assert.deepEqual(recommendationSafetyGate(candidate, judgement, quote).blockers, []);
const pending = buildFinalConfirmation({ candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } });
assert.equal(pending.status, "final_confirmation_pending");
assert.equal(pending.purchaseCost, 23);
const task = { sourcing: {}, pricing: {} };
confirmRecommendation(task, pending, "2026-08-31T00:00:00.000Z");
assert.equal(task.sourcing.status, "confirmed_purchase_source");
assert.equal(task.pricing.purchaseCost, 23);
assert.equal(task.pricing.sourceUrl, candidate.sourceUrl);
assert.equal(confirmRecommendation(task, pending, "2026-08-31T00:01:00.000Z").idempotent, true, "a terminal confirmation must be idempotent");
assert.equal(rejectRecommendation(task, pending, "2026-08-31T00:02:00.000Z").idempotent, true, "a terminal confirmation cannot be reversed");
assert.throws(() => confirmRecommendation({}, { ...pending, status: "final_confirmation_pending" }), /有效待确认/,
  "a copied pending confirmation must not be accepted as an authority to write pricing");

assert.deepEqual(normalizeKeywordResult({ keywords: ["汽车 螺丝刀", "汽车 螺丝刀", "品牌X 型号Y"] }, { allowedBrand: "", allowedModel: "" }), ["汽车 螺丝刀"]);
assert.deepEqual(normalizeKeywordResult({ keywords: ["丝杠 组合 更换设备", "滚珠丝杠 维修套装"] }, {}), ["丝杠 组合 更换设备", "滚珠丝杠 维修套装"]);
assert.deepEqual(normalizeKeywordResult({ keywords: ["品牌X 型号Y", "合规关键词", "合规关键词", "x".repeat(41)] }, { allowedBrand: "品牌A", allowedModel: "型号B" }), ["合规关键词"],
  "keywords must not invent unverified brand/model text, duplicates, or oversized values");

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
assert.ok(recommendationSafetyGate(candidate, judgement, { ...quote, confirmable: false }).blockers.includes("quote_not_confirmable"));

assert.deepEqual(parseQwenJsonResponse('{"keywords":["合规关键词"]}'), { keywords: ["合规关键词"] });
assert.throws(() => parseQwenJsonResponse('```json\n{"keywords":[]}\n```'), /JSON/,
  "Markdown fences must not be accepted as model JSON");
assert.throws(() => parseQwenJsonResponse('{"keywords":[]} trailing'), /JSON/,
  "extra model prose must fail closed instead of being sliced into JSON");
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

const serverSource = fs.readFileSync(new URL("../pinduoduo-agent/server.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const endpoint of ["/api/ai/1688-keywords", "/api/ai/1688-judge", "/api/ai/1688-select-sku", "/api/evidence/1688"]) {
  assert.ok(serverSource.includes(endpoint), `${endpoint} must be registered by the local agent`);
}
assert.match(serverSource, /image\/jpeg/);
assert.match(serverSource, /1024 \* 1024/);
assert.match(serverSource, /randomUUID/);
assert.equal(packageJson.scripts["test:sourcing-agent-1688"], "node tools/test-sourcing-agent-1688.mjs");

console.log("1688 sourcing safety tests passed");
