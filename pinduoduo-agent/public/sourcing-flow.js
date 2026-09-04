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

/** Merges strategy output by canonical offer URL and enforces the global light-candidate ceiling. */
export function mergeAutomaticCandidates(existing = [], incoming = []) {
  const result = [];
  const seen = new Set();
  for (const candidate of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const sourceUrl = canonical1688OfferUrl(candidate.sourceUrl);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    result.push({ ...candidate, sourceUrl });
    if (result.length === AUTOMATIC_1688_LIMITS.maxLightweightCandidates) break;
  }
  return result;
}

/** Keeps the extension's five-detail limit defensively true at the page boundary. */
export function detailCandidatesForInspection(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).slice(0, AUTOMATIC_1688_LIMITS.maxDetailCandidates);
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
  return JSON.parse(JSON.stringify(value));
}

/**
 * Creates the MVP 6 browser payload without deleting legacy storage or task
 * fields. The caller decides which localStorage key receives the returned copy.
 */
export function migrateMvp6StoredQueue(primaryValue, legacyValues = []) {
  let selected = parseStoredValue(primaryValue);
  let migratedFromLegacy = false;
  if (!validSavedQueue(selected)) {
    selected = null;
    for (const legacyValue of Array.isArray(legacyValues) ? legacyValues : []) {
      const candidate = parseStoredValue(legacyValue);
      if (!validSavedQueue(candidate)) continue;
      selected = candidate;
      migratedFromLegacy = true;
      break;
    }
  }
  if (!selected) return { saved: null, migratedFromLegacy: false };

  const saved = jsonClone(selected);
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

function offerIdFromCanonicalUrl(sourceUrl) {
  return /^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html$/.exec(sourceUrl)?.[1] || "";
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
