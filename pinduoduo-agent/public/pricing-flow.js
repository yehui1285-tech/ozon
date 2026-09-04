export const FINAL_OZON_PRICE_CACHE_MS = 30 * 60 * 1000;
export const MAX_OZON_PREVIEW_MONEY = 1_000_000_000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function strictMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < 0 || value > MAX_OZON_PREVIEW_MONEY) return null;
  const rounded = Number(value.toFixed(2));
  return Number.isFinite(rounded) ? rounded : null;
}

function validFetchedAt(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
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
  const offsetHours = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinutes = match[8] === "Z" ? 0 : Number(match[11]);
  if (offsetHours > 23 || offsetMinutes > 59) return false;
  const offset = (offsetHours * 60 + offsetMinutes) * (match[9] === "+" ? 1 : -1);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed === nominal.getTime() - offset * 60_000;
}

function cloneReadonly(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ozon最终复价响应不完整。");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Ozon最终复价响应不完整。");
    seen.add(value);
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Ozon最终复价响应不完整。");
      copy.push(cloneReadonly(descriptor.value, seen));
    }
    return Object.freeze(copy);
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || seen.has(value)) {
    throw new Error("Ozon最终复价响应不完整。");
  }
  seen.add(value);
  const copy = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Ozon最终复价响应不完整。");
    copy[key] = cloneReadonly(descriptor.value, seen);
  }
  return Object.freeze(copy);
}

/** Tracks the one pricing response still allowed to write a live task. */
export function createFinalPricingRequestGuard() {
  const activeRequests = new WeakMap();
  return {
    start(task, taskIdentity) {
      const token = Object.freeze({ taskIdentity });
      activeRequests.set(task, token);
      return token;
    },
    isActive(task, token, currentTask, currentIdentity) {
      return task === currentTask
        && token?.taskIdentity === currentIdentity
        && activeRequests.get(task) === token;
    },
    finish(task, token) {
      if (activeRequests.get(task) === token) activeRequests.delete(task);
    },
  };
}

export function preliminaryPricingDecision(task, purchaseCost, nowMs = Date.now()) {
  const cost = finite(purchaseCost);
  const preliminaryLimit = finite(task?.pricing?.preliminaryMaxPurchaseCostAt18Pct ?? task?.enrichment?.maxPurchaseCostAt18Pct);
  if (!(cost > 0)) return { status: "invalid_cost", needsRefresh: false, eligible: null, preliminaryLimit };
  if (preliminaryLimit === null || preliminaryLimit < 0) return { status: "missing_preliminary_limit", needsRefresh: false, eligible: null, preliminaryLimit };
  if (cost > preliminaryLimit) return { status: "rejected_preliminary", needsRefresh: false, eligible: false, preliminaryLimit };

  const finalPricing = task?.pricing?.finalOzonPricing;
  const fetchedAtMs = Date.parse(finalPricing?.fetchedAt || "");
  const finalLimit = finite(finalPricing?.maxPurchaseCostAt18Pct);
  const cacheFresh = finalPricing?.status === "completed"
    && finalLimit !== null
    && finalLimit >= 0
    && Number.isFinite(fetchedAtMs)
    && nowMs - fetchedAtMs >= 0
    && nowMs - fetchedAtMs <= FINAL_OZON_PRICE_CACHE_MS;
  if (!cacheFresh) return { status: "requires_final_reprice", needsRefresh: true, eligible: null, preliminaryLimit };
  const eligible = cost <= finalLimit;
  return { status: eligible ? "eligible_final" : "rejected_final", needsRefresh: false, eligible, preliminaryLimit, finalLimit, cacheFresh: true };
}

/**
 * Computes a final Ozon pricing result without changing the task or bridge
 * response. 1688 sourcing keeps this preview until Task 5 confirms it.
 */
export function previewFinalOzonPricing(task, response, purchaseCost, fetchedAt = new Date().toISOString()) {
  // `task` deliberately remains unused: the preview is a no-write boundary.
  void task;
  if (!response || typeof response !== "object" || response.ok !== true || response.partial || response.disqualified || !validFetchedAt(fetchedAt)) {
    throw new Error("Ozon最终复价响应不完整。");
  }
  const cost = strictMoney(purchaseCost);
  const finalLimit = strictMoney(response.maxPurchaseCostAt18Pct);
  const effectiveGreenPrice = strictMoney(response.effectiveGreenPrice);
  const originalBlackPrice = strictMoney(response.originalBlackPrice);
  const internationalFreight = strictMoney(response.internationalFreight);
  const selectedCommission = strictMoney(response.selectedCommission);
  if (cost === null || finalLimit === null || finalLimit < 0 || effectiveGreenPrice === null
    || originalBlackPrice === null || internationalFreight === null || selectedCommission === null) {
    throw new Error("Ozon最终复价响应不完整。");
  }
  return {
    status: "completed",
    fetchedAt,
    purchaseCost: cost,
    maxPurchaseCostAt18Pct: finalLimit,
    eligibleAt18Pct: cost <= finalLimit,
    effectiveGreenPrice,
    originalBlackPrice,
    internationalFreight,
    selectedCommission,
    calculation: cloneReadonly(response.calculation ?? null),
  };
}

export function applyFinalOzonPricing(task, response, purchaseCost, fetchedAt = new Date().toISOString()) {
  if (!response?.ok || response?.partial || response?.disqualified) throw new Error(response?.partialError || response?.disqualificationReason || response?.error || "Ozon最终复价未返回完整结果");
  const finalLimit = finite(response.maxPurchaseCostAt18Pct);
  if (finalLimit === null || finalLimit < 0) throw new Error("Ozon最终复价缺少18%最高采购成本");
  task.ozon = task.ozon && typeof task.ozon === "object" ? task.ozon : {};
  task.enrichment = task.enrichment && typeof task.enrichment === "object" ? task.enrichment : {};
  task.pricing = task.pricing && typeof task.pricing === "object" ? task.pricing : {};
  const preliminaryLimit = finite(task.pricing.preliminaryMaxPurchaseCostAt18Pct ?? task.enrichment.maxPurchaseCostAt18Pct);
  if (finite(task.pricing.preliminaryMaxPurchaseCostAt18Pct) === null) task.pricing.preliminaryMaxPurchaseCostAt18Pct = preliminaryLimit;
  Object.assign(task.ozon, {
    pagePrice: response.pagePrice,
    competitorPrice: response.competitorPrice,
    effectiveGreenPrice: response.effectiveGreenPrice,
    commissions: response.commissions,
    selectedCommission: response.selectedCommission,
    lengthMm: response.lengthMm,
    widthMm: response.widthMm,
    heightMm: response.heightMm,
    weightG: response.weightG,
  });
  Object.assign(task.enrichment, {
    ozonPricingStatus: "completed",
    originalBlackPrice: response.originalBlackPrice,
    blackPriceSource: response.blackPriceSource,
    blackPriceSourceUrl: response.blackPriceSourceUrl,
    internationalFreight: response.internationalFreight,
    freightRoute: response.freightRoute,
    maxPurchaseCostAt18Pct: finalLimit,
    pricingCalculation: response.calculation,
    ozonPricingElapsedMs: Number(response.elapsedMs || 0),
    ozonPricingFetchedAt: fetchedAt,
  });
  task.pricing.finalOzonPricing = {
    status: "completed",
    fetchedAt,
    maxPurchaseCostAt18Pct: finalLimit,
    effectiveGreenPrice: finite(response.effectiveGreenPrice),
    originalBlackPrice: finite(response.originalBlackPrice),
    internationalFreight: finite(response.internationalFreight),
    selectedCommission: finite(response.selectedCommission),
    sourceProductUrl: response.sourceProductUrl || response.blackPriceSourceUrl || null,
  };
  task.pricing.purchaseCost = Number(Number(purchaseCost).toFixed(2));
  task.pricing.eligibleAt18Pct = task.pricing.purchaseCost <= finalLimit;
  return { finalLimit, eligibleAt18Pct: task.pricing.eligibleAt18Pct };
}
