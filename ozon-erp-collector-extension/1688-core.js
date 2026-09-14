(function install1688Core(root) {
  "use strict";

  const PRICE_SOURCES = new Set([
    "unknown", "displayed", "tier", "selected_sku", "one_piece", "sample",
    "manual_exact_product_exception",
  ]);
  const EVIDENCE_FIELDS = new Set([
    "rank", "text", "capturedAt", "localRef", "screenshotStatus", "imageUrl",
    "sourceUrl", "strategy", "field", "nodeIndex",
  ]);

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function toFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    let normalized = value.trim().replace(/[,，\s]/g, "");
    normalized = normalized.replace(/^[¥￥]/, "").replace(/元$/, "");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function positiveNumber(value) {
    const parsed = toFiniteNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
  }

  function canonicalOfferUrl(rawUrl) {
    try {
      const url = new URL(clean(rawUrl));
      const match = /^\/offer\/(\d+)\.html$/.exec(url.pathname);
      if (url.protocol === "https:" && url.hostname === "detail.1688.com" && match) {
        return `https://detail.1688.com/offer/${match[1]}.html`;
      }
      const mobileOfferId = url.searchParams.get("offerId") || "";
      if ((url.protocol === "http:" || url.protocol === "https:")
        && url.hostname === "detail.m.1688.com"
        && url.pathname === "/page/index.html"
        && /^\d+$/.test(mobileOfferId)) {
        return `https://detail.1688.com/offer/${mobileOfferId}.html`;
      }
      return "";
    } catch {
      return "";
    }
  }

  function offerIdFromUrl(rawUrl) {
    const canonical = canonicalOfferUrl(rawUrl);
    return (canonical.match(/\/offer\/(\d+)\.html$/) || [])[1] || "";
  }

  function sanitizeEvidence(rawEvidence) {
    if (!rawEvidence || typeof rawEvidence !== "object" || Array.isArray(rawEvidence)) return null;
    const safe = {};
    for (const key of EVIDENCE_FIELDS) {
      const value = rawEvidence[key];
      if (key === "localRef") {
        const localRef = clean(value);
        if (/^\/api\/evidence\/[A-Za-z0-9._/-]+$/.test(localRef) && !localRef.includes("..")) {
          safe[key] = localRef;
        }
        continue;
      }
      if (value === null && key === "rank") {
        safe[key] = null;
      } else if (typeof value === "string") {
        const sanitized = clean(value);
        if (sanitized) safe[key] = sanitized;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        safe[key] = value;
      } else if (typeof value === "boolean") {
        safe[key] = value;
      }
    }
    return Object.keys(safe).length ? safe : null;
  }

  function normalizeShipping(rawShipping) {
    const shipping = rawShipping && typeof rawShipping === "object" ? rawShipping : {};
    const status = clean(shipping.status).toLowerCase();
    if (status === "free") return { status: "free", fee: 0 };
    const fee = toFiniteNumber(shipping.fee);
    if (status === "known" && fee !== null && fee >= 0) return { status: "known", fee };
    return { status: "unknown", fee: null };
  }

  function normalizeSku(rawSku) {
    const sku = rawSku && typeof rawSku === "object" ? rawSku : {};
    const optionCountValue = toFiniteNumber(sku.optionCount);
    const optionCount = Number.isInteger(optionCountValue) && optionCountValue > 0 ? optionCountValue : null;
    const options = Array.isArray(sku.options)
      ? sku.options
        .map(option => ({ id: clean(option?.id), label: clean(option?.label) }))
        .filter(option => option.id || option.label)
      : [];
    return {
      dimensions: Array.isArray(sku.dimensions) ? sku.dimensions.map(clean).filter(Boolean) : [],
      options,
      optionCount,
      optionsComplete: sku.optionsComplete === true,
      singleSpec: sku.singleSpec === true,
      requiresSelection: sku.requiresSelection === true || optionCount > 1 || options.length > 1,
      selectedOptionId: clean(sku.selectedOptionId) || null,
      selectionVerified: sku.selectionVerified === true,
    };
  }

  function hasVerifiedSku(candidate) {
    const sku = candidate?.sku;
    if (!sku || typeof sku !== "object") return false;
    const optionCount = toFiniteNumber(sku.optionCount);
    if (sku.singleSpec === true && optionCount === 1) return true;
    if (!Number.isInteger(optionCount) || optionCount <= 1) return false;
    if (sku.optionsComplete !== true || !Array.isArray(sku.options)) return false;
    const uniqueIds = new Set(sku.options.map(option => clean(option?.id)).filter(Boolean));
    if (uniqueIds.size < optionCount) return false;
    const selectedOptionId = clean(sku.selectedOptionId);
    return Boolean(selectedOptionId)
      && uniqueIds.has(selectedOptionId)
      && sku.selectionVerified === true;
  }

  function inspectProductIdentity(candidate) {
    const sourceUrl = canonicalOfferUrl(candidate?.sourceUrl);
    const productId = offerIdFromUrl(sourceUrl);
    const providedProductId = clean(candidate?.productId);
    return {
      sourceUrl,
      productId,
      valid: Boolean(sourceUrl && productId)
        && (!providedProductId || providedProductId === productId)
        && candidate?.identityValid !== false,
    };
  }

  function isStrictIsoInstant(value) {
    if (typeof value !== "string") return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const millisecond = Number((match[7] || "").padEnd(3, "0"));
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;

    const nominal = new Date(0);
    nominal.setUTCFullYear(year, month - 1, day);
    nominal.setUTCHours(hour, minute, second, millisecond);
    if (nominal.getUTCFullYear() !== year
      || nominal.getUTCMonth() !== month - 1
      || nominal.getUTCDate() !== day
      || nominal.getUTCHours() !== hour
      || nominal.getUTCMinutes() !== minute
      || nominal.getUTCSeconds() !== second
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

  function emptyCandidate() {
    return {
      provider: "1688",
      candidateId: "",
      productId: "",
      sourceUrl: "",
      identityValid: false,
      title: "",
      imageUrl: "",
      supplierName: "",
      minimumOrderQuantity: null,
      supportsOnePiece: false,
      supportsSample: false,
      pricing: {
        displayedPrice: null,
        onePiecePrice: null,
        samplePrice: null,
        tiers: [],
        selectedSkuPrice: null,
        priceSource: "unknown",
      },
      shipping: { status: "unknown", fee: null },
      sku: {
        dimensions: [],
        options: [],
        optionCount: null,
        optionsComplete: false,
        singleSpec: false,
        requiresSelection: false,
        selectedOptionId: null,
        selectionVerified: false,
      },
      detailStatus: "search_only",
      evidence: null,
    };
  }

  function normalizeCandidate(raw = {}) {
    const out = emptyCandidate();
    const sourceUrl = canonicalOfferUrl(raw.sourceUrl || raw.href);
    const productId = offerIdFromUrl(sourceUrl);
    const suppliedProductId = clean(raw.productId || raw.offerId);
    out.sourceUrl = sourceUrl;
    out.productId = productId;
    out.candidateId = productId ? `1688-${productId}` : "";
    out.identityValid = Boolean(sourceUrl && productId && (!suppliedProductId || suppliedProductId === productId));
    out.title = clean(raw.title);
    out.imageUrl = clean(raw.imageUrl);
    out.supplierName = clean(raw.supplierName);
    out.supportsOnePiece = raw.supportsOnePiece === true;
    out.supportsSample = raw.supportsSample === true;
    out.detailStatus = clean(raw.detailStatus) || "search_only";
    out.evidence = sanitizeEvidence(raw.evidence);

    const moq = toFiniteNumber(raw.minimumOrderQuantity);
    out.minimumOrderQuantity = Number.isInteger(moq) && moq > 0 ? moq : null;

    const pricing = raw.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
    out.pricing = {
      displayedPrice: toFiniteNumber(pricing.displayedPrice),
      onePiecePrice: toFiniteNumber(pricing.onePiecePrice),
      samplePrice: toFiniteNumber(pricing.samplePrice),
      tiers: Array.isArray(pricing.tiers)
        ? pricing.tiers
          .map(tier => ({ min: toFiniteNumber(tier?.min), max: toFiniteNumber(tier?.max), price: toFiniteNumber(tier?.price) }))
          .filter(tier => tier.min !== null && tier.price !== null)
        : [],
      selectedSkuPrice: toFiniteNumber(pricing.selectedSkuPrice),
      priceSource: PRICE_SOURCES.has(pricing.priceSource) ? pricing.priceSource : "unknown",
    };
    out.shipping = normalizeShipping(raw.shipping);
    out.sku = normalizeSku(raw.sku);
    return out;
  }

  function parseSearchSnapshot(snapshot = {}) {
    const seen = new Set();
    const candidates = [];
    for (const node of Array.isArray(snapshot.nodes) ? snapshot.nodes : []) {
      if (!node || node.visible === false) continue;
      const data = node.data && typeof node.data === "object" ? node.data : {};
      const suppliedOfferId = clean(data.offerId);
      const dataOfferId = /^\d+$/.test(suppliedOfferId) ? suppliedOfferId : "";
      const canonicalHref = canonicalOfferUrl(node.href);
      const hrefOfferId = offerIdFromUrl(canonicalHref);
      if (hrefOfferId && dataOfferId && hrefOfferId !== dataOfferId) continue;
      const sourceUrl = canonicalHref || (dataOfferId ? `https://detail.1688.com/offer/${dataOfferId}.html` : "");
      if (!sourceUrl || seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);
      const text = clean(node.text);
      const title = clean(data.title || (text.split(/[¥￥]/)[0] || text));
      const shippingMatch = text.match(/运费\s*[¥￥]?\s*([\d.,]+)/);
      const isFreeShipping = data.shipping === "free" || /包邮/.test(text);
      const shippingFee = data.shipping !== undefined && data.shipping !== "free"
        ? toFiniteNumber(data.shipping)
        : toFiniteNumber(shippingMatch?.[1]);
      candidates.push(normalizeCandidate({
        href: sourceUrl,
        title,
        imageUrl: node.imageUrl,
        minimumOrderQuantity: data.moq ?? toFiniteNumber((text.match(/(\d+)\s*件起批/) || [])[1]),
        pricing: {
          displayedPrice: data.price ?? toFiniteNumber((text.match(/[¥￥]\s*([\d.,]+)/) || [])[1]),
          priceSource: "displayed",
        },
        shipping: isFreeShipping
          ? { status: "free", fee: 0 }
          : shippingFee !== null
            ? { status: "known", fee: shippingFee }
            : { status: "unknown", fee: null },
        detailStatus: "search_only",
        evidence: { rank: data.rank ?? null, text: title },
      }));
    }
    return candidates;
  }

  function parseDetailSnapshot(snapshot = {}) {
    const nodes = (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).filter(node => node && node.visible !== false);
    const field = name => nodes.find(node => node?.data?.field === name);
    const titleNode = field("title");
    const tierNode = field("priceTiers");
    const moqNode = field("moq");
    const skuNode = field("sku");
    const shippingNode = field("shipping");
    const dropshippingNode = field("dropshippingPrice");
    const firstTier = tierNode?.data?.tiers?.[0];
    const displayedPrice = firstTier?.price ?? toFiniteNumber((clean(tierNode?.text).match(/[¥￥]\s*([\d.,]+)/) || [])[1]);
    const selectedSkuPrice = skuNode?.data?.price ?? toFiniteNumber((clean(skuNode?.text).match(/[¥￥]\s*([\d.,]+)/) || [])[1]);

    let shipping = { status: "unknown", fee: null };
    if (shippingNode) {
      const shippingText = clean(shippingNode.text);
      if (/包邮/.test(shippingText)) {
        shipping = { status: "free", fee: 0 };
      } else {
        const shippingFee = shippingNode.data?.amount !== undefined
          ? toFiniteNumber(shippingNode.data.amount)
          : toFiniteNumber((shippingText.match(/运费\s*[¥￥]?\s*([\d.,]+)/) || [])[1]);
        if (shippingFee !== null && shippingFee >= 0) shipping = { status: "known", fee: shippingFee };
      }
    }

    const optionData = skuNode?.data && typeof skuNode.data === "object" ? skuNode.data : {};
    const options = Array.isArray(optionData.options)
      ? optionData.options.map(option => ({ id: clean(option?.id), label: clean(option?.label) }))
      : [];
    const optionCountValue = toFiniteNumber(optionData.optionCount);
    const optionCount = Number.isInteger(optionCountValue) && optionCountValue > 0 ? optionCountValue : null;
    const candidate = normalizeCandidate({
      sourceUrl: snapshot.pageUrl,
      title: snapshot.title || titleNode?.text,
      minimumOrderQuantity: moqNode?.data?.value ?? toFiniteNumber((clean(moqNode?.text).match(/(\d+)\s*件起批/) || [])[1]),
      supportsOnePiece: Boolean(dropshippingNode),
      supportsSample: nodes.some(node => /拿样|样品/.test(clean(node?.text))),
      pricing: {
        displayedPrice,
        onePiecePrice: dropshippingNode?.data?.quantity === 1 ? dropshippingNode.data.price : null,
        samplePrice: null,
        tiers: tierNode?.data?.tiers || [],
        selectedSkuPrice,
        priceSource: dropshippingNode ? "one_piece" : selectedSkuPrice !== null ? "selected_sku" : "tier",
      },
      shipping,
      sku: skuNode ? {
        dimensions: [clean(skuNode.text)],
        options,
        optionCount,
        optionsComplete: optionData.optionsComplete === true,
        singleSpec: optionData.singleSpec === true,
        requiresSelection: optionCount > 1 || options.length > 1,
        selectedOptionId: optionData.selectedOptionId,
        selectionVerified: optionData.selectionVerified === true,
      } : null,
      detailStatus: "complete",
      evidence: { capturedAt: snapshot.capturedAt || null },
    });

    const hasDisplayedPrice = positiveNumber(candidate.pricing.displayedPrice) !== null;
    const hasKnownShipping = candidate.shipping.status === "free"
      || (candidate.shipping.status === "known" && candidate.shipping.fee !== null && candidate.shipping.fee >= 0);
    if (!candidate.identityValid
      || !candidate.title
      || !Number.isInteger(candidate.minimumOrderQuantity)
      || !hasDisplayedPrice
      || !hasKnownShipping
      || !hasVerifiedSku(candidate)) {
      candidate.detailStatus = candidate.sourceUrl ? "partial" : "failed";
    }
    return candidate;
  }

  function candidateBlockers(candidate) {
    const blockers = [];
    const identity = inspectProductIdentity(candidate);
    const moq = toFiniteNumber(candidate?.minimumOrderQuantity);
    if (moq !== null && moq > 2) blockers.push("minimum_order_quantity_gt_2");
    if (!Number.isInteger(moq) || moq < 1) blockers.push("minimum_order_quantity_unknown");
    if (!identity.valid) blockers.push("invalid_product_identity");
    if (!candidate?.sourceUrl) blockers.push("missing_source_url");
    if (!clean(candidate?.title)) blockers.push("missing_title");
    if (!hasVerifiedSku(candidate)) blockers.push("sku_selection_unverified");
    return blockers;
  }

  function singleUnitQuote(candidate, exception = null) {
    const blockers = candidateBlockers(candidate);
    const moq = toFiniteNumber(candidate?.minimumOrderQuantity);
    const pricing = candidate?.pricing && typeof candidate.pricing === "object" ? candidate.pricing : {};
    const originalPriceSource = PRICE_SOURCES.has(pricing.priceSource) ? pricing.priceSource : "unknown";
    if (moq !== null && moq > 2) {
      return { confirmable: false, productPrice: null, domesticShipping: null, purchaseCost: null,
        priceSource: originalPriceSource, blockers: [...new Set(blockers)] };
    }

    const candidateIdentity = inspectProductIdentity(candidate);
    const priceEvidenceVerified = candidateIdentity.valid && hasVerifiedSku(candidate);
    const exceptionUrl = canonicalOfferUrl(exception?.sourceUrl);
    const exceptionId = offerIdFromUrl(exceptionUrl);
    const exceptionPrice = positiveNumber(exception?.onePiecePrice);
    const exactException = priceEvidenceVerified
      && exceptionUrl === candidateIdentity.sourceUrl
      && exceptionId === candidateIdentity.productId
      && clean(exception?.productId) === candidateIdentity.productId
      && exceptionPrice !== null
      && isStrictIsoInstant(exception?.confirmedAt)
      ? exceptionPrice
      : null;
    const onePiecePrice = priceEvidenceVerified && candidate?.supportsOnePiece === true
      ? positiveNumber(pricing.onePiecePrice)
      : null;
    const samplePrice = priceEvidenceVerified && candidate?.supportsSample === true
      ? positiveNumber(pricing.samplePrice)
      : null;
    const selectedSkuPrice = priceEvidenceVerified && moq !== null && moq <= 1
      ? positiveNumber(pricing.selectedSkuPrice)
      : null;
    const productPrice = exactException ?? onePiecePrice ?? samplePrice ?? selectedSkuPrice;
    if (productPrice === null) blockers.push(moq === 2 ? "single_unit_price_unverified" : "missing_single_unit_price");

    const shipping = normalizeShipping(candidate?.shipping);
    if (shipping.status === "unknown") blockers.push("shipping_unknown");
    const uniqueBlockers = [...new Set(blockers)];
    const priceSource = exactException !== null
      ? "manual_exact_product_exception"
      : onePiecePrice !== null
        ? (originalPriceSource === "unknown" ? "one_piece" : originalPriceSource)
        : samplePrice !== null
          ? (originalPriceSource === "unknown" ? "sample" : originalPriceSource)
          : selectedSkuPrice !== null
            ? (originalPriceSource === "unknown" ? "selected_sku" : originalPriceSource)
            : "unknown";
    const domesticShipping = shipping.status === "free" ? 0 : shipping.fee;
    return {
      confirmable: uniqueBlockers.length === 0,
      productPrice: productPrice === null ? null : Number(productPrice.toFixed(2)),
      domesticShipping: shipping.status === "unknown" ? null : Number(domesticShipping.toFixed(2)),
      purchaseCost: uniqueBlockers.length === 0 ? Number((productPrice + domesticShipping).toFixed(2)) : null,
      priceSource,
      blockers: uniqueBlockers,
    };
  }

  function nextSearchStrategy(attempts = []) {
    const completed = new Set(attempts);
    if (!completed.has("image")) return "image";
    if (!completed.has("keyword")) return "keyword";
    if (!completed.has("similar_supplier")) return "similar_supplier";
    return "complete";
  }

  root.Ozon1688Core = {
    parseSearchSnapshot,
    parseDetailSnapshot,
    normalizeCandidate,
    candidateBlockers,
    singleUnitQuote,
    nextSearchStrategy,
    canonicalOfferUrl,
  };
})(globalThis);
