const PRICE_SOURCES = new Set([
  "selected_sku",
  "one_piece",
  "sample",
  "manual_exact_product_exception",
]);
const pendingRecords = new WeakMap();
const pendingTaskObjects = new WeakMap();
let nextConfirmationId = 1;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function plainObject(value) {
  return isPlainObject(value) ? value : null;
}

function ownValue(value, key) {
  if (!isPlainObject(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function hasOwnKey(value, key) {
  if (!isPlainObject(value)) return false;
  try {
    return Object.hasOwn(value, key);
  } catch {
    return false;
  }
}

function ownPlainObject(value, key) {
  return plainObject(ownValue(value, key)) || {};
}

function ownArrayValues(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const length = Math.min(Number.isSafeInteger(value.length) ? value.length : 0, limit);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor && Object.hasOwn(descriptor, "value")) result.push(descriptor.value);
  }
  return result;
}

function clean(value, limit = 400) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function safeId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return "";
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) ? value : "";
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(clean(value, 1200));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function finiteMoney(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Number(value.toFixed(2))
    : null;
}

function roundedTotal(productPrice, domesticShipping) {
  return Number((productPrice + domesticShipping).toFixed(2));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeJudgement(judgement) {
  const source = plainObject(judgement) || {};
  const assessments = ownArrayValues(ownValue(source, "candidateAssessments"), 24).filter(isPlainObject);
  return {
    verdict: clean(ownValue(source, "verdict"), 40),
    confidence: Number.isInteger(ownValue(source, "confidence")) ? ownValue(source, "confidence") : null,
    bestCandidateId: clean(ownValue(source, "bestCandidateId"), 100) || null,
    needsHumanReview: ownValue(source, "needsHumanReview") === false ? false : true,
    specConflicts: ownArrayValues(ownValue(source, "specConflicts"), 24).map((value) => clean(value, 300)).filter(Boolean),
    candidateAssessments: assessments.map((entry) => ({
      candidateId: safeId(ownValue(entry, "candidateId")) || null,
      verdict: clean(ownValue(entry, "verdict"), 40),
      confidence: Number.isInteger(ownValue(entry, "confidence")) ? ownValue(entry, "confidence") : null,
      differences: ownArrayValues(ownValue(entry, "differences"), 24).map((value) => clean(value, 300)).filter(Boolean),
    })),
  };
}

function normalizeQuote(quote) {
  const source = plainObject(quote) || {};
  const priceSource = clean(ownValue(source, "priceSource"), 50);
  return {
    confirmable: ownValue(source, "confirmable") === true,
    productPrice: finiteMoney(ownValue(source, "productPrice")),
    domesticShipping: finiteMoney(ownValue(source, "domesticShipping")),
    purchaseCost: finiteMoney(ownValue(source, "purchaseCost")),
    priceSource: PRICE_SOURCES.has(priceSource) ? priceSource : "unknown",
    blockers: ownArrayValues(ownValue(source, "blockers"), 24).map((value) => clean(value, 100)).filter(Boolean),
  };
}

function confirmationFingerprint(pending) {
  const source = plainObject(pending) || {};
  return JSON.stringify({
    confirmationId: ownValue(source, "confirmationId"),
    taskIdentity: ownValue(source, "taskIdentity"),
    status: ownValue(source, "status"),
    candidate: ownValue(source, "candidate"),
    judgement: ownValue(source, "judgement"),
    purchaseCost: ownValue(source, "purchaseCost"),
    productPrice: ownValue(source, "productPrice"),
    domesticShipping: ownValue(source, "domesticShipping"),
    priceSource: ownValue(source, "priceSource"),
    sourceUrl: ownValue(source, "sourceUrl"),
    eligibleAt18Pct: ownValue(source, "eligibleAt18Pct"),
    blockers: ownValue(source, "blockers"),
  });
}

/**
 * Removes fields which are not part of the canonical provider candidate.
 * It intentionally does not manufacture a price, MOQ, shipping amount, SKU,
 * brand, or model from free text.
 */
export function normalizeSourcingCandidate(raw = {}) {
  const source = plainObject(raw) || {};
  const pricing = ownPlainObject(source, "pricing");
  const shipping = ownPlainObject(source, "shipping");
  const sku = ownPlainObject(source, "sku");
  const minimumOrderQuantity = Number.isInteger(ownValue(source, "minimumOrderQuantity")) && ownValue(source, "minimumOrderQuantity") > 0
    ? ownValue(source, "minimumOrderQuantity")
    : null;
  const shippingStatus = clean(ownValue(shipping, "status"), 30).toLowerCase();
  const shippingFee = finiteMoney(ownValue(shipping, "fee"));
  const safeShipping = shippingStatus === "free"
    ? { status: "free", fee: 0 }
    : shippingStatus === "known" && shippingFee !== null
      ? { status: "known", fee: shippingFee }
      : { status: "unknown", fee: null };
  const priceSource = PRICE_SOURCES.has(clean(ownValue(pricing, "priceSource"), 50))
    ? clean(ownValue(pricing, "priceSource"), 50)
    : "unknown";

  return {
    provider: clean(ownValue(source, "provider"), 40),
    candidateId: safeId(ownValue(source, "candidateId")),
    sourceUrl: safeHttpsUrl(ownValue(source, "sourceUrl")),
    title: clean(ownValue(source, "title"), 500),
    minimumOrderQuantity,
    pricing: {
      selectedSkuPrice: finiteMoney(ownValue(pricing, "selectedSkuPrice")),
      onePiecePrice: finiteMoney(ownValue(pricing, "onePiecePrice")),
      samplePrice: finiteMoney(ownValue(pricing, "samplePrice")),
      priceSource,
    },
    shipping: safeShipping,
    sku: {
      selectedOptionId: safeId(ownValue(sku, "selectedOptionId")) || null,
      selectionVerified: ownValue(sku, "selectionVerified") === true,
    },
  };
}

function normalizeKeywordText(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 41);
}

function keywordHasUnsafeCommercialText(keyword) {
  return /[\p{Cc}\p{Cf}]/u.test(keyword)
    || /[¥￥$€£₽₹]/.test(keyword)
    || /(?:采购(?:价|成本)?|价格|单价|成本|运费|报价|起订|MOQ|\b(?:price|shipping)\b)/i.test(keyword)
    || /\d+(?:\.\d{1,2})?\s*(?:元|rmb|cny|人民币)/i.test(keyword);
}

function safeAllowedTerm(value) {
  const term = normalizeKeywordText(value);
  return term && term.length <= 40 && !keywordHasUnsafeCommercialText(term) ? term : "";
}

function allowedTerms(value, limit = 24) {
  const rawValues = typeof value === "string" ? [value] : ownArrayValues(value, limit);
  return rawValues.map((item) => safeAllowedTerm(item)).filter(Boolean);
}

function keywordContext(raw) {
  const source = plainObject(raw);
  if (!source) return null;
  const allowedBrand = safeAllowedTerm(ownValue(source, "allowedBrand"));
  const allowedModel = safeAllowedTerm(ownValue(source, "allowedModel"));
  const genericTerms = [
    ...allowedTerms(ownValue(source, "allowedGenericTerms")),
    ...allowedTerms(ownValue(source, "trustedGenericTerms")),
    ...allowedTerms(ownValue(source, "categoryTerms")),
  ];
  const terms = [...new Set([allowedBrand, allowedModel, ...genericTerms].filter(Boolean))];
  if (!terms.length) return null;
  return { allowedBrand, allowedModel, genericTerms: new Set(genericTerms), terms: terms.sort((left, right) => right.length - left.length) };
}

function splitAllowedKeyword(keyword, context) {
  const parts = keyword.split(/[\s,，、/|+]+/u).filter(Boolean);
  if (!parts.length) return [];
  const tokens = [];
  for (const part of parts) {
    let offset = 0;
    while (offset < part.length) {
      const term = context.terms.find((allowed) => part.startsWith(allowed, offset));
      if (!term) return [];
      tokens.push(term);
      offset += term.length;
    }
  }
  return tokens;
}

/** Only preserve concise search phrases grounded in explicit Ozon brand/model evidence. */
export function normalizeKeywordResult(raw = {}, evidence = {}) {
  const source = plainObject(raw) || {};
  const context = keywordContext(evidence);
  const keywords = ownArrayValues(ownValue(source, "keywords"), 24);
  const result = [];
  const seen = new Set();
  if (!context) return result;
  for (const rawKeyword of keywords) {
    if (typeof rawKeyword !== "string" || keywordHasUnsafeCommercialText(rawKeyword)) continue;
    const keyword = normalizeKeywordText(rawKeyword);
    const tokens = keyword && !keywordHasUnsafeCommercialText(keyword) ? splitAllowedKeyword(keyword, context) : [];
    if (!keyword || keyword.length > 40 || seen.has(keyword) || !tokens.length) continue;
    seen.add(keyword);
    result.push(keyword);
    if (result.length === 3) break;
  }
  return result;
}

function quoteCandidatePrice(candidate, quote) {
  const source = clean(quote?.priceSource, 50);
  if (source === "selected_sku") return candidate.pricing.selectedSkuPrice;
  if (source === "one_piece") return candidate.pricing.onePiecePrice;
  if (source === "sample") return candidate.pricing.samplePrice;
  // Task 2 validates this exceptional price against the exact canonical
  // product before Task 7 constructs the quote. Its price is therefore not
  // expected to be present in page-derived candidate pricing, but all three
  // normalized quote amounts and their rounded total are still rechecked
  // below before any confirmation capability can be created.
  if (source === "manual_exact_product_exception" && candidate.minimumOrderQuantity === 2) return quote.productPrice;
  return null;
}

/**
 * Fail closed before a provider-neutral recommendation can enter the final
 * confirmation queue. It only evaluates evidence supplied by upstream
 * providers; no AI response may fill missing commercial facts.
 */
export function recommendationSafetyGate(rawCandidate = {}, judgement = {}, quote = {}) {
  const candidate = normalizeSourcingCandidate(rawCandidate);
  const safeJudgement = normalizeJudgement(judgement);
  const safeQuote = normalizeQuote(quote);
  const blockers = [];
  const confidence = safeJudgement.confidence;
  const assessments = safeJudgement.candidateAssessments;
  const candidateAssessment = assessments.filter((entry) => clean(entry?.candidateId, 100) === candidate.candidateId);

  if (!candidate.provider || !candidate.candidateId || !candidate.sourceUrl) blockers.push("candidate_not_whitelisted");
  if (clean(safeJudgement.verdict, 40) !== "same_product") blockers.push("judgement_not_same_product");
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) blockers.push("confidence_invalid");
  if (!Number.isInteger(confidence) || confidence < 85) blockers.push("confidence_below_85");
  if (clean(safeJudgement.bestCandidateId, 100) !== candidate.candidateId) blockers.push("candidate_not_whitelisted");
  if (safeJudgement.needsHumanReview !== false) blockers.push("needs_human_review");
  if (candidateAssessment.length !== 1) blockers.push("candidate_assessment_conflict");
  const assessment = candidateAssessment[0];
  if (assessment && (clean(assessment.verdict, 40) !== "same_product"
    || !Number.isInteger(assessment.confidence)
    || assessment.confidence < 85
    || assessment.confidence > 100)) blockers.push("candidate_assessment_conflict");
  const criticalDifferences = [
    ...safeJudgement.specConflicts,
    ...(assessment?.differences || []),
  ].map((value) => clean(value, 300)).filter(Boolean);
  if (criticalDifferences.length) blockers.push("critical_spec_difference");

  if (!candidate.sku.selectionVerified || !candidate.sku.selectedOptionId) blockers.push("sku_not_verified");
  if (candidate.shipping.status === "unknown" || candidate.shipping.fee === null) blockers.push("shipping_unknown");
  if (candidate.minimumOrderQuantity === null) blockers.push("minimum_order_quantity_unknown");
  if (candidate.minimumOrderQuantity > 2) blockers.push("minimum_order_quantity_gt_2");

  if (safeQuote.confirmable !== true) blockers.push("quote_not_confirmable");
  blockers.push(...safeQuote.blockers);
  const { productPrice, domesticShipping, purchaseCost } = safeQuote;
  if (productPrice === null || domesticShipping === null || purchaseCost === null) {
    blockers.push("quote_monetary_fields_invalid");
  } else {
    if (purchaseCost !== roundedTotal(productPrice, domesticShipping)) blockers.push("quote_total_mismatch");
    const recordedPrice = quoteCandidatePrice(candidate, safeQuote);
    if (recordedPrice === null || recordedPrice !== productPrice) blockers.push("price_changed");
  }
  if (!PRICE_SOURCES.has(safeQuote.priceSource)) blockers.push("single_unit_price_unverified");
  if (candidate.minimumOrderQuantity === 2 && !["one_piece", "sample", "manual_exact_product_exception"].includes(safeQuote.priceSource)) {
    // Task 2 owns the one-piece/sample/manual-exception proof. This gate only
    // trusts its confirmable quote and never creates an exception from AI text.
    blockers.push("single_unit_price_unverified");
  }

  return {
    candidate,
    judgement: safeJudgement,
    quote: { ...safeQuote, productPrice, domesticShipping, purchaseCost },
    blockers: unique(blockers),
  };
}

function stableTaskIdentity(task) {
  const source = plainObject(task);
  if (!source) return "";
  if (hasOwnKey(source, "taskId")) {
    const taskId = safeId(ownValue(source, "taskId"));
    return taskId ? `taskId:${taskId}` : "";
  }
  if (hasOwnKey(source, "id")) {
    const id = safeId(ownValue(source, "id"));
    return id ? `id:${id}` : "";
  }
  return "";
}

function trustedFinalPricing(value) {
  const finalPricing = plainObject(value) || {};
  return ownValue(finalPricing, "eligibleAt18Pct") === true;
}

/** Build a review object; it never mutates a sourcing task or starts an order. */
export function buildFinalConfirmation(input = {}) {
  const request = plainObject(input) || {};
  const task = ownValue(request, "task");
  const taskIdentity = stableTaskIdentity(task);
  if (!taskIdentity) throw new Error("缺少稳定任务身份，拒绝创建待确认记录。");
  const candidate = ownValue(request, "candidate");
  const judgement = ownValue(request, "judgement");
  const quote = ownValue(request, "quote");
  const finalPricingEligible = trustedFinalPricing(ownValue(request, "finalPricing"));
  const safety = recommendationSafetyGate(candidate, judgement, quote);
  const blockers = [...safety.blockers];
  if (!finalPricingEligible) blockers.push("final_pricing_not_eligible_at_18pct");
  const finalBlockers = unique(blockers);
  const pending = {
    confirmationId: `sourcing-confirmation-${nextConfirmationId++}`,
    taskIdentity,
    status: finalBlockers.length ? "final_confirmation_blocked" : "final_confirmation_pending",
    candidate: clone(safety.candidate),
    judgement: clone(safety.judgement),
    purchaseCost: safety.quote.purchaseCost,
    productPrice: safety.quote.productPrice,
    domesticShipping: safety.quote.domesticShipping,
    priceSource: safety.quote.priceSource,
    sourceUrl: safety.candidate.sourceUrl,
    eligibleAt18Pct: finalPricingEligible,
    blockers: finalBlockers,
  };
  if (!finalBlockers.length) {
    pendingRecords.set(pending, {
      status: "pending",
      confirmationId: pending.confirmationId,
      taskIdentity,
      fingerprint: confirmationFingerprint(pending),
    });
    pendingTaskObjects.set(pending, task);
  }
  return pending;
}

function currentConfirmationSafety(current, expectedTask, expectedTaskIdentity) {
  const source = plainObject(current);
  if (!source || !plainObject(ownValue(source, "candidate")) || !plainObject(ownValue(source, "judgement"))
    || !plainObject(ownValue(source, "quote")) || !plainObject(ownValue(source, "finalPricing"))) {
    throw new Error("确认必须提交最新可信确认数据。");
  }
  const currentTask = ownValue(source, "task");
  if (currentTask !== expectedTask || stableTaskIdentity(currentTask) !== expectedTaskIdentity) {
    throw new Error("当前确认数据任务身份或对象不匹配，拒绝写入。");
  }
  const safety = recommendationSafetyGate(ownValue(source, "candidate"), ownValue(source, "judgement"), ownValue(source, "quote"));
  if (safety.blockers.length || !trustedFinalPricing(ownValue(source, "finalPricing"))) {
    throw new Error("最新可信确认数据未通过安全闸门。");
  }
  return safety;
}

function pendingMatchesCurrent(pending, safety) {
  const source = plainObject(pending);
  return Boolean(source)
    && ownValue(source, "eligibleAt18Pct") === true
    && JSON.stringify(ownValue(source, "candidate")) === JSON.stringify(safety.candidate)
    && JSON.stringify(ownValue(source, "judgement")) === JSON.stringify(safety.judgement)
    && ownValue(source, "purchaseCost") === safety.quote.purchaseCost
    && ownValue(source, "productPrice") === safety.quote.productPrice
    && ownValue(source, "domesticShipping") === safety.quote.domesticShipping
    && ownValue(source, "priceSource") === safety.quote.priceSource
    && ownValue(source, "sourceUrl") === safety.candidate.sourceUrl
    && ownArrayValues(ownValue(source, "blockers"), 24).length === 0;
}

function terminalAction(task, pending, action, current, confirmedAt) {
  if (!isPlainObject(pending)) throw new Error("确认对象不是本次流程生成的有效待确认记录。");
  const record = pendingRecords.get(pending);
  if (!record) throw new Error("确认对象不是本次流程生成的有效待确认记录。");
  if (!isPlainObject(task)) throw new Error("缺少要更新的找品任务。");
  const taskIdentity = stableTaskIdentity(task);
  if (pendingTaskObjects.get(pending) !== task || !taskIdentity || taskIdentity !== record.taskIdentity || ownValue(pending, "taskIdentity") !== record.taskIdentity) {
    throw new Error("待确认记录任务身份或对象不匹配，拒绝写入。");
  }
  const existingSourcing = ownPlainObject(task, "sourcing");
  const existingPending = ownValue(existingSourcing, "pendingConfirmation");
  if (existingPending && existingPending !== pending) throw new Error("该任务当前等待另一条确认，拒绝跨确认写入。");
  if (record.fingerprint !== confirmationFingerprint(pending)) throw new Error("待确认记录已变化，拒绝写入。");
  const safety = action === "confirm" ? currentConfirmationSafety(current, task, taskIdentity) : null;
  if (action === "confirm" && !pendingMatchesCurrent(pending, safety)) throw new Error("当前确认数据已变化，拒绝写入。");
  if (record.status !== "pending") return { task, pending, idempotent: true, status: record.status };
  if (ownValue(pending, "status") !== "final_confirmation_pending") throw new Error("待确认记录状态无效，拒绝写入。");
  if (action === "confirm") {
    task.sourcing = plainObject(ownValue(task, "sourcing")) || {};
    task.pricing = plainObject(ownValue(task, "pricing")) || {};
    task.sourcing.pendingConfirmation = pending;
    task.sourcing.status = "confirmed_purchase_source";
    task.sourcing.selectedCandidate = clone(safety.candidate);
    task.sourcing.aiJudgement = clone(safety.judgement);
    task.sourcing.confirmedAt = clean(confirmedAt, 80) || new Date().toISOString();
    task.pricing.purchaseCost = safety.quote.purchaseCost;
    task.pricing.sourceUrl = safety.candidate.sourceUrl;
    task.pricing.eligibleAt18Pct = true;
    task.status = "confirmed_purchase_source";
    record.status = "confirmed";
    pending.status = "final_confirmation_confirmed";
    record.fingerprint = confirmationFingerprint(pending);
  } else {
    task.sourcing = plainObject(ownValue(task, "sourcing")) || {};
    task.sourcing.pendingConfirmation = pending;
    task.sourcing.status = "final_confirmation_rejected";
    task.sourcing.rejectedAt = clean(confirmedAt, 80) || new Date().toISOString();
    task.status = "pending_human_review";
    record.status = "rejected";
    pending.status = "final_confirmation_rejected";
    record.fingerprint = confirmationFingerprint(pending);
  }
  return { task, pending, idempotent: false, status: record.status };
}

/** The only new helper that may write task.pricing.purchaseCost/sourceUrl. */
export function confirmRecommendation(task, pending, current, confirmedAt) {
  return terminalAction(task, pending, "confirm", current, confirmedAt);
}

/** Rejecting never writes a purchase price or creates an order. */
export function rejectRecommendation(task, pending, rejectedAt) {
  return terminalAction(task, pending, "reject", null, rejectedAt);
}
