const AUTOMATIC_ACTION_TYPES = new Set([
  "start_image_search",
  "generate_keywords",
  "start_keyword_search",
  "start_similar_supplier_search",
  "judge_candidates",
  "select_target_sku",
  "preview_final_pricing",
  "queue_final_confirmation",
  "queue_no_source_confirmation",
  "pause_platform_verification",
  "complete",
]);

export const AUTOMATIC_1688_LIMITS = Object.freeze({
  maxLightweightCandidates: 12,
  maxDetailCandidates: 5,
  searchPageMs: 45_000,
  detailSkuMs: 15_000,
  qwenMs: 75_000,
  totalActiveMs: 150_000,
});

function attemptsFrom(task) {
  return Array.isArray(task?.searchAttempts) ? task.searchAttempts : [];
}

function completedAttempt(attempts, strategy) {
  const matches = attempts.filter((attempt) => attempt?.strategy === strategy
    && attempt?.status !== "running" && attempt?.status !== "paused_platform_verification");
  return matches.at(-1) || null;
}

function usableCount(attempt) {
  return Number.isFinite(Number(attempt?.usableCount)) ? Number(attempt.usableCount) : 0;
}

/**
 * Selects the next safe 1688-only transition from durable task state.
 * It deliberately returns action data rather than causing browser activity.
 */
export function nextAutomaticAction(task = {}) {
  if (task?.status === "paused_platform_verification") return { type: "pause_platform_verification" };
  if (task?.status === "confirmed_purchase_source" || task?.status === "final_confirmation_rejected" || task?.finalConfirmation) return { type: "complete" };

  const attempts = attemptsFrom(task);
  const image = completedAttempt(attempts, "image");
  if (!image) return { type: "start_image_search" };
  if (usableCount(image) > 0) return { type: "judge_candidates" };

  const keyword = completedAttempt(attempts, "keyword");
  if (!keyword) {
    const keywords = Array.isArray(task?.keywords) ? task.keywords.filter((value) => typeof value === "string" && value.trim()) : [];
    return keywords.length ? { type: "start_keyword_search" } : { type: "generate_keywords" };
  }
  if (usableCount(keyword) > 0) return { type: "judge_candidates" };

  const similarSupplier = completedAttempt(attempts, "similar_supplier");
  if (!similarSupplier) return { type: "start_similar_supplier_search" };
  if (usableCount(similarSupplier) > 0) return { type: "judge_candidates" };
  return { type: "queue_no_source_confirmation" };
}

/** Returns the first non-rejected candidate in its original deterministic order. */
export function promoteNextCandidate(candidates = [], rejectedCandidateIds = []) {
  const rejected = new Set(Array.isArray(rejectedCandidateIds) ? rejectedCandidateIds.map(String) : []);
  return (Array.isArray(candidates) ? candidates : []).find((candidate) => {
    const candidateId = typeof candidate?.candidateId === "string" ? candidate.candidateId : "";
    return candidateId && !rejected.has(candidateId);
  }) || null;
}

/** Returns one stable canonical identity for an allowed 1688 detail page. */
export function canonical1688OfferUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > 1200) return "";
  try {
    const url = new URL(rawUrl.trim());
    const match = /^\/offer\/(\d+)\.html$/.exec(url.pathname);
    return url.protocol === "https:"
      && url.hostname === "detail.1688.com"
      && !url.port
      && !url.username
      && !url.password
      && match
      ? `https://detail.1688.com/offer/${match[1]}.html`
      : "";
  } catch {
    return "";
  }
}

function offerIdFromCanonicalUrl(sourceUrl) {
  return /^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html$/.exec(sourceUrl)?.[1] || "";
}

function safeTaskId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.trim())
    ? value.trim()
    : "";
}

function ordinaryObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function taskIdentity(task) {
  if (!ordinaryObject(task)) return "";
  const taskId = Object.hasOwn(task, "taskId") ? safeTaskId(task.taskId) : "";
  const id = Object.hasOwn(task, "id") ? safeTaskId(task.id) : "";
  if ((Object.hasOwn(task, "taskId") && !taskId) || (Object.hasOwn(task, "id") && !id)) return "";
  if (taskId && id && taskId !== id) return "";
  return taskId || id;
}

function candidateIdentity(rawCandidate) {
  if (!ordinaryObject(rawCandidate)) return null;
  const sourceUrl = canonical1688OfferUrl(rawCandidate.sourceUrl);
  const offerId = offerIdFromCanonicalUrl(sourceUrl);
  const candidateId = typeof rawCandidate.candidateId === "string" ? rawCandidate.candidateId.trim() : "";
  if (!sourceUrl || !offerId || candidateId !== `1688-${offerId}`) return null;
  if (Object.hasOwn(rawCandidate, "productId") && String(rawCandidate.productId).trim() !== offerId) return null;
  return { sourceUrl, offerId, candidateId };
}

function boundedText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function boundedNumber(value, { minimum = -1_000_000_000, maximum = 1_000_000_000 } = {}) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function boundedEvidence(value) {
  if (!ordinaryObject(value)) return null;
  const evidence = {};
  const localRef = boundedText(value.localRef, 100);
  if (/^\/api\/evidence\/1688\/[a-f0-9]{32}$/i.test(localRef)) evidence.localRef = localRef;
  const text = boundedText(value.text, 2_000);
  const capturedAt = boundedText(value.capturedAt, 80);
  const imageUrl = boundedText(value.imageUrl, 1_200);
  const sourceUrl = canonical1688OfferUrl(value.sourceUrl);
  const screenshotStatus = boundedText(value.screenshotStatus, 40);
  if (text) evidence.text = text;
  if (capturedAt) evidence.capturedAt = capturedAt;
  if (imageUrl) evidence.imageUrl = imageUrl;
  if (sourceUrl) evidence.sourceUrl = sourceUrl;
  if (screenshotStatus) evidence.screenshotStatus = screenshotStatus;
  if (typeof value.rank === "number" && Number.isFinite(value.rank) && value.rank >= 0 && value.rank <= 1_000) evidence.rank = value.rank;
  return Object.keys(evidence).length ? evidence : null;
}

function boundedCandidate(rawCandidate, identity) {
  const pricing = ordinaryObject(rawCandidate.pricing) ? rawCandidate.pricing : {};
  const rawShipping = ordinaryObject(rawCandidate.shipping) ? rawCandidate.shipping : {};
  const rawSku = ordinaryObject(rawCandidate.sku) ? rawCandidate.sku : {};
  const skuOptions = Array.isArray(rawSku.options) ? rawSku.options.slice(0, 40).map((option) => ({
    id: boundedText(option?.id ?? option?.optionId, 100),
    label: boundedText(option?.label, 200),
  })).filter((option) => option.id && option.label) : [];
  const shippingStatus = boundedText(rawShipping.status, 20).toLowerCase();
  const shipping = shippingStatus === "free"
    ? { status: "free", fee: 0 }
    : shippingStatus === "known" && boundedNumber(rawShipping.fee, { minimum: 0 }) !== null
      ? { status: "known", fee: boundedNumber(rawShipping.fee, { minimum: 0 }) }
      : { status: "unknown", fee: null };
  const priceSources = new Set(["unknown", "displayed", "tier", "selected_sku", "one_piece", "sample", "manual_exact_product_exception"]);
  const priceSource = boundedText(pricing.priceSource, 40);
  const detailStatus = boundedText(rawCandidate.detailStatus, 30);
  const optionCount = Number.isInteger(rawSku.optionCount) && rawSku.optionCount > 0 && rawSku.optionCount <= 40 ? rawSku.optionCount : null;
  return {
    provider: "1688",
    candidateId: identity.candidateId,
    productId: identity.offerId,
    sourceUrl: identity.sourceUrl,
    identityValid: rawCandidate.identityValid !== false,
    title: boundedText(rawCandidate.title, 500),
    imageUrl: boundedText(rawCandidate.imageUrl, 1_200),
    supplierName: boundedText(rawCandidate.supplierName, 500),
    minimumOrderQuantity: Number.isInteger(rawCandidate.minimumOrderQuantity) && rawCandidate.minimumOrderQuantity > 0 && rawCandidate.minimumOrderQuantity <= 1_000_000 ? rawCandidate.minimumOrderQuantity : null,
    supportsOnePiece: rawCandidate.supportsOnePiece === true,
    supportsSample: rawCandidate.supportsSample === true,
    pricing: {
      displayedPrice: boundedNumber(pricing.displayedPrice, { minimum: 0 }),
      onePiecePrice: boundedNumber(pricing.onePiecePrice, { minimum: 0 }),
      samplePrice: boundedNumber(pricing.samplePrice, { minimum: 0 }),
      selectedSkuPrice: boundedNumber(pricing.selectedSkuPrice, { minimum: 0 }),
      priceSource: priceSources.has(priceSource) ? priceSource : "unknown",
      tiers: Array.isArray(pricing.tiers) ? pricing.tiers.slice(0, 12).map((tier) => ({
        min: boundedNumber(tier?.min, { minimum: 0 }),
        max: boundedNumber(tier?.max, { minimum: 0 }),
        price: boundedNumber(tier?.price, { minimum: 0 }),
      })).filter((tier) => tier.min !== null && tier.price !== null) : [],
    },
    shipping,
    sku: {
      dimensions: Array.isArray(rawSku.dimensions) ? rawSku.dimensions.slice(0, 8).map((value) => boundedText(value, 200)).filter(Boolean) : [],
      options: skuOptions,
      optionCount,
      optionsComplete: rawSku.optionsComplete === true,
      singleSpec: rawSku.singleSpec === true,
      requiresSelection: rawSku.requiresSelection === true,
      selectedOptionId: boundedText(rawSku.selectedOptionId, 100) || null,
      selectionVerified: rawSku.selectionVerified === true,
    },
    detailStatus: ["search_only", "partial", "complete", "failed"].includes(detailStatus) ? detailStatus : "search_only",
    evidence: boundedEvidence(rawCandidate.evidence),
  };
}

function knownShipping(candidate) {
  const shipping = ordinaryObject(candidate?.shipping) ? candidate.shipping : null;
  if (!shipping) return false;
  if (shipping.status === "free") return true;
  return shipping.status === "known" && typeof shipping.fee === "number" && Number.isFinite(shipping.fee) && shipping.fee >= 0;
}

function completeSkuBase(candidate) {
  const sku = ordinaryObject(candidate?.sku) ? candidate.sku : null;
  const options = Array.isArray(sku?.options) ? sku.options : [];
  if (!options.length) return false;
  const ids = new Set();
  return options.every((option) => {
    if (!ordinaryObject(option)) return false;
    const id = typeof (option.id ?? option.optionId) === "string" ? String(option.id ?? option.optionId).trim() : "";
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (!id || !label || ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}

/** A detail can influence strategy progress only when its identity and base commercial facts are complete. */
export function isUsableAutomaticCandidate(candidate) {
  return Boolean(candidateIdentity(candidate))
    && candidate?.identityValid !== false
    && candidate?.detailStatus === "complete"
    && typeof candidate.title === "string" && candidate.title.trim().length > 0
    && Number.isInteger(candidate.minimumOrderQuantity) && candidate.minimumOrderQuantity > 0
    && knownShipping(candidate)
    && completeSkuBase(candidate);
}

/** Merges strategy output by canonical offer URL and enforces the global light-candidate ceiling. */
export function mergeAutomaticCandidates(existing = [], incoming = []) {
  const result = [];
  const seenUrls = new Set();
  const seenIds = new Set();
  for (const candidate of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const identity = candidateIdentity(candidate);
    if (!identity || seenUrls.has(identity.sourceUrl) || seenIds.has(identity.candidateId)) continue;
    seenUrls.add(identity.sourceUrl);
    seenIds.add(identity.candidateId);
    result.push(boundedCandidate(candidate, identity));
    if (result.length === AUTOMATIC_1688_LIMITS.maxLightweightCandidates) break;
  }
  return result;
}

/** Keeps the extension's five-detail limit defensively true at the page boundary. */
export function detailCandidatesForInspection(candidates = []) {
  return mergeAutomaticCandidates([], candidates)
    .filter((candidate) => isUsableAutomaticCandidate(candidate))
    .slice(0, AUTOMATIC_1688_LIMITS.maxDetailCandidates);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStoredValue(raw) {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return plainObject(raw) ? raw : null;
}

function validSavedQueue(value) {
  return plainObject(value) && plainObject(value.queue) && Array.isArray(value.queue.tasks);
}

function jsonClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function safeSavedQueue(value) {
  if (!validSavedQueue(value)) return { saved: null, invalid: false };
  const copied = jsonClone(value);
  if (!copied || !ordinaryObject(copied.queue) || !Array.isArray(copied.queue.tasks)) return { saved: null, invalid: true };
  const identities = new Set();
  for (const task of copied.queue.tasks) {
    const identity = taskIdentity(task);
    if (!identity || identities.has(identity)) return { saved: null, invalid: true };
    identities.add(identity);
  }
  return { saved: copied, invalid: false };
}

/**
 * Creates the MVP 6 browser payload without deleting legacy storage or task
 * fields. The caller decides which localStorage key receives the returned copy.
 */
export function migrateMvp6StoredQueue(primaryValue, legacyValues = []) {
  let selected = parseStoredValue(primaryValue);
  let migratedFromLegacy = false;
  const primary = safeSavedQueue(selected);
  if (primary.invalid) return { saved: null, migratedFromLegacy: false };
  if (!primary.saved) {
    selected = null;
    for (const legacyValue of Array.isArray(legacyValues) ? legacyValues : []) {
      const candidate = parseStoredValue(legacyValue);
      const checked = safeSavedQueue(candidate);
      if (!checked.saved) continue;
      selected = checked.saved;
      migratedFromLegacy = true;
      break;
    }
  } else selected = primary.saved;
  if (!selected) return { saved: null, migratedFromLegacy: false };

  const saved = selected;
  const previousMeta = saved.queue.meta;
  const meta = plainObject(previousMeta) ? previousMeta : { legacyMeta: previousMeta };
  meta.sourcingSchema = "mvp6";
  if (!plainObject(meta.singleUnitExceptions)) meta.singleUnitExceptions = {};
  if (!plainObject(meta.automatic1688Batch)) {
    meta.automatic1688Batch = { cursor: 0, completed: 0, failed: 0, status: "idle", pauseReason: null };
  }
  saved.queue.meta = meta;
  return { saved, migratedFromLegacy };
}

function normalizedClock(value, fallback = Date.now()) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function savedElapsed(value) {
  return typeof value?.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0
    ? value.elapsedMs
    : 0;
}

/** Starts or resumes active sourcing time while retaining prior active time. */
export function resumeAutomaticTiming(timing = {}, nowMs = Date.now()) {
  const now = normalizedClock(nowMs);
  const activeStartedAtMs = normalizedClock(timing?.activeStartedAtMs, null);
  if (activeStartedAtMs !== null && activeStartedAtMs <= now) return { ...timing, elapsedMs: savedElapsed(timing), pausedAtMs: null };
  return { ...timing, elapsedMs: savedElapsed(timing), activeStartedAtMs: now, pausedAtMs: null };
}

/** Stops only the active clock; wall time during platform verification is excluded. */
export function pauseAutomaticTiming(timing = {}, nowMs = Date.now()) {
  const now = normalizedClock(nowMs);
  const activeStartedAtMs = typeof timing?.activeStartedAtMs === "number" && Number.isFinite(timing.activeStartedAtMs)
    ? timing.activeStartedAtMs
    : null;
  const elapsedMs = savedElapsed(timing) + (activeStartedAtMs !== null && activeStartedAtMs <= now ? now - activeStartedAtMs : 0);
  return { ...timing, elapsedMs, activeStartedAtMs: null, pausedAtMs: now };
}

/** Computes active sourcing time; paused wall-clock time never contributes. */
export function automaticElapsedMs(timing = {}, nowMs = Date.now()) {
  const now = normalizedClock(nowMs);
  const activeStartedAtMs = typeof timing?.activeStartedAtMs === "number" && Number.isFinite(timing.activeStartedAtMs)
    ? timing.activeStartedAtMs
    : null;
  return savedElapsed(timing) + (activeStartedAtMs !== null && activeStartedAtMs <= now ? now - activeStartedAtMs : 0);
}

export function automaticTimeBudgetExceeded(timing = {}, nowMs = Date.now()) {
  return automaticElapsedMs(timing, nowMs) >= AUTOMATIC_1688_LIMITS.totalActiveMs;
}

/**
 * Caps one in-flight operation to the active time left for its automatic
 * sequence. A paused timing record therefore has no wall-clock penalty.
 */
export function automaticRequestTimeoutMs(timing = {}, requestedMs, nowMs = Date.now()) {
  const requested = typeof requestedMs === "number" && Number.isFinite(requestedMs) && requestedMs > 0
    ? Math.floor(requestedMs)
    : 0;
  if (!requested) return 0;
  const remaining = AUTOMATIC_1688_LIMITS.totalActiveMs - automaticElapsedMs(timing, nowMs);
  return Math.max(0, Math.min(requested, remaining));
}

function finiteNonNegativeMoney(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : null;
}

function positiveMoney(value) {
  const money = finiteNonNegativeMoney(value);
  return money !== null && money > 0 ? money : null;
}

function strictIsoInstant(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number((match[7] || "").padEnd(3, "0"));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const nominal = new Date(0);
  nominal.setUTCFullYear(year, month - 1, day);
  nominal.setUTCHours(hour, minute, second, millisecond);
  if (nominal.getUTCFullYear() !== year || nominal.getUTCMonth() !== month - 1 || nominal.getUTCDate() !== day
    || nominal.getUTCHours() !== hour || nominal.getUTCMinutes() !== minute || nominal.getUTCSeconds() !== second
    || nominal.getUTCMilliseconds() !== millisecond) return false;
  let offsetMinutes = 0;
  if (match[8] !== "Z") {
    const offsetHours = Number(match[10]);
    const offsetRemainder = Number(match[11]);
    if (offsetHours > 23 || offsetRemainder > 59) return false;
    offsetMinutes = (offsetHours * 60 + offsetRemainder) * (match[9] === "+" ? 1 : -1);
  }
  const expected = nominal.getTime() - offsetMinutes * 60_000;
  return Number.isFinite(Date.parse(value)) && Date.parse(value) === expected;
}

/**
 * Builds the same fail-closed single-unit cost facts used by the final safety
 * gate. It never manufactures a commercial field from title or model text.
 */
export function quoteAutomaticSingleUnit(rawCandidate = {}, rawException = null) {
  const candidate = rawCandidate && typeof rawCandidate === "object" && !Array.isArray(rawCandidate) ? rawCandidate : {};
  const pricing = candidate.pricing && typeof candidate.pricing === "object" && !Array.isArray(candidate.pricing) ? candidate.pricing : {};
  const shipping = candidate.shipping && typeof candidate.shipping === "object" && !Array.isArray(candidate.shipping) ? candidate.shipping : {};
  const sku = candidate.sku && typeof candidate.sku === "object" && !Array.isArray(candidate.sku) ? candidate.sku : {};
  const sourceUrl = canonical1688OfferUrl(candidate.sourceUrl);
  const productId = offerIdFromCanonicalUrl(sourceUrl);
  const blockers = [];
  if (!sourceUrl || !productId || (candidate.productId !== undefined && String(candidate.productId) !== productId)) blockers.push("invalid_product_identity");
  if (!String(candidate.title || "").trim()) blockers.push("missing_title");
  const moq = Number.isInteger(candidate.minimumOrderQuantity) && candidate.minimumOrderQuantity > 0 ? candidate.minimumOrderQuantity : null;
  if (moq === null) blockers.push("minimum_order_quantity_unknown");
  if (moq !== null && moq > 2) blockers.push("minimum_order_quantity_gt_2");
  if (sku.selectionVerified !== true || !String(sku.selectedOptionId || "").trim()) blockers.push("sku_not_verified");

  const shippingStatus = String(shipping.status || "").trim().toLowerCase();
  const domesticShipping = shippingStatus === "free" ? 0 : shippingStatus === "known" ? finiteNonNegativeMoney(shipping.fee) : null;
  if (domesticShipping === null) blockers.push("shipping_unknown");

  const exception = rawException && typeof rawException === "object" && !Array.isArray(rawException) ? rawException : {};
  const exceptionUrl = canonical1688OfferUrl(exception.sourceUrl);
  const exactException = sourceUrl && exceptionUrl === sourceUrl
    && String(exception.productId || "") === productId
    && strictIsoInstant(exception.confirmedAt)
    ? positiveMoney(exception.onePiecePrice)
    : null;
  const onePiecePrice = candidate.supportsOnePiece === true ? positiveMoney(pricing.onePiecePrice) : null;
  const samplePrice = candidate.supportsSample === true ? positiveMoney(pricing.samplePrice) : null;
  const selectedSkuPrice = moq !== null && moq <= 1 ? positiveMoney(pricing.selectedSkuPrice) : null;
  const productPrice = exactException ?? onePiecePrice ?? samplePrice ?? selectedSkuPrice;
  if (productPrice === null) blockers.push(moq === 2 ? "single_unit_price_unverified" : "missing_single_unit_price");

  const priceSource = exactException !== null
    ? "manual_exact_product_exception"
    : onePiecePrice !== null
      ? "one_piece"
      : samplePrice !== null
        ? "sample"
        : selectedSkuPrice !== null
          ? "selected_sku"
          : "unknown";
  const uniqueBlockers = [...new Set(blockers)];
  return {
    confirmable: uniqueBlockers.length === 0,
    productPrice,
    domesticShipping,
    purchaseCost: uniqueBlockers.length === 0 ? Number((productPrice + domesticShipping).toFixed(2)) : null,
    priceSource,
    blockers: uniqueBlockers,
  };
}

export function isAutomaticActionType(value) {
  return AUTOMATIC_ACTION_TYPES.has(value);
}
