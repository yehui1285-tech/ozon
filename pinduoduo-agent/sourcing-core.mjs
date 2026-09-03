const PRICE_SOURCES = new Set([
  "selected_sku",
  "one_piece",
  "sample",
  "manual_exact_product_exception",
]);
const pendingRecords = new WeakMap();
let nextConfirmationId = 1;

function clean(value, limit = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeId(value) {
  const result = clean(value, 100);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(result) ? result : "";
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

function safeJudgement(judgement = {}) {
  const assessments = Array.isArray(judgement?.candidateAssessments) ? judgement.candidateAssessments : [];
  return {
    verdict: clean(judgement?.verdict, 40),
    confidence: Number.isInteger(judgement?.confidence) ? judgement.confidence : null,
    bestCandidateId: clean(judgement?.bestCandidateId, 100) || null,
    needsHumanReview: judgement?.needsHumanReview === false ? false : true,
    specConflicts: (Array.isArray(judgement?.specConflicts) ? judgement.specConflicts : []).map((value) => clean(value, 300)).filter(Boolean),
    candidateAssessments: assessments.map((entry) => ({
      candidateId: safeId(entry?.candidateId) || null,
      verdict: clean(entry?.verdict, 40),
      confidence: Number.isInteger(entry?.confidence) ? entry.confidence : null,
      differences: (Array.isArray(entry?.differences) ? entry.differences : []).map((value) => clean(value, 300)).filter(Boolean),
    })),
  };
}

function confirmationFingerprint(pending) {
  return JSON.stringify({
    confirmationId: pending?.confirmationId,
    status: pending?.status,
    candidate: pending?.candidate,
    judgement: pending?.judgement,
    purchaseCost: pending?.purchaseCost,
    productPrice: pending?.productPrice,
    domesticShipping: pending?.domesticShipping,
    priceSource: pending?.priceSource,
    sourceUrl: pending?.sourceUrl,
    eligibleAt18Pct: pending?.eligibleAt18Pct,
    blockers: pending?.blockers,
  });
}

/**
 * Removes fields which are not part of the canonical provider candidate.
 * It intentionally does not manufacture a price, MOQ, shipping amount, SKU,
 * brand, or model from free text.
 */
export function normalizeSourcingCandidate(raw = {}) {
  const pricing = raw?.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
  const shipping = raw?.shipping && typeof raw.shipping === "object" ? raw.shipping : {};
  const sku = raw?.sku && typeof raw.sku === "object" ? raw.sku : {};
  const minimumOrderQuantity = Number.isInteger(raw?.minimumOrderQuantity) && raw.minimumOrderQuantity > 0
    ? raw.minimumOrderQuantity
    : null;
  const shippingStatus = clean(shipping.status, 30).toLowerCase();
  const shippingFee = finiteMoney(shipping.fee);
  const safeShipping = shippingStatus === "free"
    ? { status: "free", fee: 0 }
    : shippingStatus === "known" && shippingFee !== null
      ? { status: "known", fee: shippingFee }
      : { status: "unknown", fee: null };
  const priceSource = PRICE_SOURCES.has(clean(pricing.priceSource, 50))
    ? clean(pricing.priceSource, 50)
    : "unknown";

  return {
    provider: clean(raw?.provider, 40),
    candidateId: safeId(raw?.candidateId),
    sourceUrl: safeHttpsUrl(raw?.sourceUrl),
    title: clean(raw?.title, 500),
    minimumOrderQuantity,
    pricing: {
      selectedSkuPrice: finiteMoney(pricing.selectedSkuPrice),
      onePiecePrice: finiteMoney(pricing.onePiecePrice),
      samplePrice: finiteMoney(pricing.samplePrice),
      priceSource,
    },
    shipping: safeShipping,
    sku: {
      selectedOptionId: safeId(sku.selectedOptionId) || null,
      selectionVerified: sku.selectionVerified === true,
    },
  };
}

function evidenceTokens(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => clean(item, 80)).filter(Boolean)
    : [];
}

function keywordHasUnverifiedBrandOrModel(keyword, { allowedBrand = "", allowedModel = "", brandTokens = [], modelTokens = [] } = {}) {
  const allowed = { brand: clean(allowedBrand, 80), model: clean(allowedModel, 80) };
  const observed = {
    brand: [...new Set([allowed.brand, ...evidenceTokens(brandTokens)].filter(Boolean))],
    model: [...new Set([allowed.model, ...evidenceTokens(modelTokens)].filter(Boolean))],
  };
  for (const kind of ["brand", "model"]) {
    for (const token of observed[kind]) {
      if (keyword.includes(token) && token !== allowed[kind]) return true;
    }
  }
  const declaredParts = keyword.match(/(?:品牌|型号)\s*[:：-]?\s*[^\s,，;；]+/gi) || [];
  return declaredParts.some((part) => {
    const kind = part.startsWith("品牌") ? "brand" : "model";
    return !allowed[kind] || !part.includes(allowed[kind]);
  });
}

function keywordHasUnsafeCommercialText(keyword) {
  return /[\x00-\x1f\x7f-\x9f]/.test(keyword)
    || /[¥￥$€£₽₹]/.test(keyword)
    || /(?:采购(?:价|成本)?|价格|单价|成本|运费|报价|起订|MOQ|\b(?:price|shipping)\b)/i.test(keyword)
    || /\d+(?:\.\d{1,2})?\s*(?:元|rmb|cny|人民币)/i.test(keyword);
}

/** Only preserve concise search phrases grounded in explicit Ozon brand/model evidence. */
export function normalizeKeywordResult(raw = {}, evidence = {}) {
  const keywords = Array.isArray(raw?.keywords) ? raw.keywords : [];
  const result = [];
  const seen = new Set();
  for (const rawKeyword of keywords) {
    if (typeof rawKeyword !== "string" || keywordHasUnsafeCommercialText(rawKeyword)) continue;
    const keyword = clean(rawKeyword, 41);
    if (!keyword || keyword.length > 40 || seen.has(keyword) || keywordHasUnsafeCommercialText(keyword) || keywordHasUnverifiedBrandOrModel(keyword, evidence)) continue;
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
  return null;
}

/**
 * Fail closed before a provider-neutral recommendation can enter the final
 * confirmation queue. It only evaluates evidence supplied by upstream
 * providers; no AI response may fill missing commercial facts.
 */
export function recommendationSafetyGate(rawCandidate = {}, judgement = {}, quote = {}) {
  const candidate = normalizeSourcingCandidate(rawCandidate);
  const blockers = [];
  const confidence = judgement?.confidence;
  const assessments = Array.isArray(judgement?.candidateAssessments) ? judgement.candidateAssessments : [];
  const candidateAssessment = assessments.filter((entry) => clean(entry?.candidateId, 100) === candidate.candidateId);

  if (!candidate.provider || !candidate.candidateId || !candidate.sourceUrl) blockers.push("candidate_not_whitelisted");
  if (clean(judgement?.verdict, 40) !== "same_product") blockers.push("judgement_not_same_product");
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) blockers.push("confidence_invalid");
  if (!Number.isInteger(confidence) || confidence < 85) blockers.push("confidence_below_85");
  if (clean(judgement?.bestCandidateId, 100) !== candidate.candidateId) blockers.push("candidate_not_whitelisted");
  if (judgement?.needsHumanReview !== false) blockers.push("needs_human_review");
  if (candidateAssessment.length !== 1) blockers.push("candidate_assessment_conflict");
  const assessment = candidateAssessment[0];
  if (assessment && (clean(assessment.verdict, 40) !== "same_product"
    || !Number.isInteger(assessment.confidence)
    || assessment.confidence < 85
    || assessment.confidence > 100)) blockers.push("candidate_assessment_conflict");
  const criticalDifferences = [
    ...(Array.isArray(judgement?.specConflicts) ? judgement.specConflicts : []),
    ...(Array.isArray(assessment?.differences) ? assessment.differences : []),
  ].map((value) => clean(value, 300)).filter(Boolean);
  if (criticalDifferences.length) blockers.push("critical_spec_difference");

  if (!candidate.sku.selectionVerified || !candidate.sku.selectedOptionId) blockers.push("sku_not_verified");
  if (candidate.shipping.status === "unknown" || candidate.shipping.fee === null) blockers.push("shipping_unknown");
  if (candidate.minimumOrderQuantity === null) blockers.push("minimum_order_quantity_unknown");
  if (candidate.minimumOrderQuantity > 2) blockers.push("minimum_order_quantity_gt_2");

  if (quote?.confirmable !== true) blockers.push("quote_not_confirmable");
  for (const code of Array.isArray(quote?.blockers) ? quote.blockers : []) {
    const safeCode = clean(code, 100);
    if (safeCode) blockers.push(safeCode);
  }
  const productPrice = finiteMoney(quote?.productPrice);
  const domesticShipping = finiteMoney(quote?.domesticShipping);
  const purchaseCost = finiteMoney(quote?.purchaseCost);
  if (productPrice === null || domesticShipping === null || purchaseCost === null) {
    blockers.push("quote_monetary_fields_invalid");
  } else {
    if (purchaseCost !== roundedTotal(productPrice, domesticShipping)) blockers.push("quote_total_mismatch");
    const recordedPrice = quoteCandidatePrice(candidate, quote);
    if (recordedPrice === null || recordedPrice !== productPrice) blockers.push("price_changed");
  }
  if (!PRICE_SOURCES.has(clean(quote?.priceSource, 50))) blockers.push("single_unit_price_unverified");
  if (candidate.minimumOrderQuantity === 2 && !["one_piece", "sample", "manual_exact_product_exception"].includes(clean(quote?.priceSource, 50))) {
    // Task 2 owns the one-piece/sample/manual-exception proof. This gate only
    // trusts its confirmable quote and never creates an exception from AI text.
    blockers.push("single_unit_price_unverified");
  }

  return {
    candidate,
    judgement: safeJudgement(judgement),
    quote: {
      confirmable: quote?.confirmable === true,
      productPrice,
      domesticShipping,
      purchaseCost,
      priceSource: PRICE_SOURCES.has(clean(quote?.priceSource, 50)) ? clean(quote.priceSource, 50) : "unknown",
    },
    blockers: unique(blockers),
  };
}

/** Build a review object; it never mutates a sourcing task or starts an order. */
export function buildFinalConfirmation({ candidate, judgement, quote, finalPricing } = {}) {
  const safety = recommendationSafetyGate(candidate, judgement, quote);
  const blockers = [...safety.blockers];
  if (finalPricing?.eligibleAt18Pct !== true) blockers.push("final_pricing_not_eligible_at_18pct");
  const finalBlockers = unique(blockers);
  const pending = {
    confirmationId: `sourcing-confirmation-${nextConfirmationId++}`,
    status: finalBlockers.length ? "final_confirmation_blocked" : "final_confirmation_pending",
    candidate: clone(safety.candidate),
    judgement: clone(safety.judgement),
    purchaseCost: safety.quote.purchaseCost,
    productPrice: safety.quote.productPrice,
    domesticShipping: safety.quote.domesticShipping,
    priceSource: safety.quote.priceSource,
    sourceUrl: safety.candidate.sourceUrl,
    eligibleAt18Pct: finalPricing?.eligibleAt18Pct === true,
    blockers: finalBlockers,
  };
  if (!finalBlockers.length) {
    pendingRecords.set(pending, {
      status: "pending",
      confirmationId: pending.confirmationId,
      fingerprint: confirmationFingerprint(pending),
    });
  }
  return pending;
}

function currentConfirmationSafety(current) {
  if (!current || typeof current !== "object" || !current.candidate || !current.judgement || !current.quote || !current.finalPricing) {
    throw new Error("确认必须提交最新可信确认数据。");
  }
  const safety = recommendationSafetyGate(current.candidate, current.judgement, current.quote);
  if (safety.blockers.length || current.finalPricing?.eligibleAt18Pct !== true) {
    throw new Error("最新可信确认数据未通过安全闸门。");
  }
  return safety;
}

function pendingMatchesCurrent(pending, safety) {
  return pending?.eligibleAt18Pct === true
    && JSON.stringify(pending.candidate) === JSON.stringify(safety.candidate)
    && JSON.stringify(pending.judgement) === JSON.stringify(safety.judgement)
    && pending.purchaseCost === safety.quote.purchaseCost
    && pending.productPrice === safety.quote.productPrice
    && pending.domesticShipping === safety.quote.domesticShipping
    && pending.priceSource === safety.quote.priceSource
    && pending.sourceUrl === safety.candidate.sourceUrl
    && Array.isArray(pending.blockers) && pending.blockers.length === 0;
}

function terminalAction(task, pending, action, current, confirmedAt) {
  const record = pendingRecords.get(pending);
  if (!record) throw new Error("确认对象不是本次流程生成的有效待确认记录。");
  if (!task || typeof task !== "object") throw new Error("缺少要更新的找品任务。");
  const existingPending = task?.sourcing?.pendingConfirmation;
  if (existingPending && existingPending !== pending) throw new Error("该任务当前等待另一条确认，拒绝跨确认写入。");
  if (record.fingerprint !== confirmationFingerprint(pending)) throw new Error("待确认记录已变化，拒绝写入。");
  const safety = action === "confirm" ? currentConfirmationSafety(current) : null;
  if (action === "confirm" && !pendingMatchesCurrent(pending, safety)) throw new Error("当前确认数据已变化，拒绝写入。");
  if (record.status !== "pending") return { task, pending, idempotent: true, status: record.status };
  if (pending.status !== "final_confirmation_pending") throw new Error("待确认记录状态无效，拒绝写入。");
  if (action === "confirm") {
    task.sourcing = task.sourcing && typeof task.sourcing === "object" ? task.sourcing : {};
    task.pricing = task.pricing && typeof task.pricing === "object" ? task.pricing : {};
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
    task.sourcing = task.sourcing && typeof task.sourcing === "object" ? task.sourcing : {};
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
