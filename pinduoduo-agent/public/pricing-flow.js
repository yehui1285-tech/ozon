export const FINAL_OZON_PRICE_CACHE_MS = 30 * 60 * 1000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
