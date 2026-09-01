(function install1688Core(root) {
  "use strict";

  function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
  function number(value) {
    const n = Number(String(value ?? "").replace(/[^\d.+-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  function canonicalOfferUrl(rawUrl) {
    try {
      const url = new URL(clean(rawUrl));
      const match = /^\/offer\/(\d+)\.html$/.exec(url.pathname);
      return url.protocol === "https:" && url.hostname === "detail.1688.com" && match
        ? `https://detail.1688.com/offer/${match[1]}.html` : "";
    } catch { return ""; }
  }
  function emptyCandidate() {
    return { provider: "1688", candidateId: "", productId: "", sourceUrl: "", title: "", imageUrl: "", supplierName: "",
      minimumOrderQuantity: null, supportsOnePiece: false, supportsSample: false,
      pricing: { displayedPrice: null, onePiecePrice: null, samplePrice: null, tiers: [], selectedSkuPrice: null, priceSource: "unknown" },
      shipping: { status: "unknown", fee: null },
      sku: { dimensions: [], options: [], selectedOptionId: null, selectionVerified: false }, detailStatus: "search_only", evidence: null };
  }
  function normalizeCandidate(raw = {}) {
    const out = emptyCandidate();
    Object.assign(out, raw);
    out.sourceUrl = canonicalOfferUrl(raw.sourceUrl || raw.href);
    const id = clean(raw.productId || raw.offerId || (out.sourceUrl.match(/offer\/(\d+)/) || [])[1]);
    out.productId = id; out.candidateId = id ? `1688-${id}` : clean(raw.candidateId);
    out.provider = "1688"; out.title = clean(raw.title); out.imageUrl = clean(raw.imageUrl); out.supplierName = clean(raw.supplierName);
    out.minimumOrderQuantity = number(raw.minimumOrderQuantity);
    out.pricing = Object.assign(emptyCandidate().pricing, raw.pricing || {});
    out.shipping = Object.assign(emptyCandidate().shipping, raw.shipping || {});
    out.sku = Object.assign(emptyCandidate().sku, raw.sku || {});
    return out;
  }
  function parseSearchSnapshot(snapshot = {}) {
    return (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).filter(n => n && n.visible !== false && canonicalOfferUrl(n.href))
      .map(node => normalizeCandidate({ href: node.href, title: clean(node.text).replace(/\s+¥?\d[\d.]*.*$/, ""), imageUrl: node.imageUrl,
        minimumOrderQuantity: node.data?.moq ?? number((node.text.match(/(\d+)\s*件起批/) || [])[1]),
        pricing: { displayedPrice: node.data?.price ?? number((node.text.match(/[¥￥]\s*([\d.]+)/) || [])[1]), priceSource: "displayed" },
        shipping: node.data?.shipping === "free" ? { status: "free", fee: 0 } : { status: "known", fee: node.data?.shipping ?? number((node.text.match(/运费\s*([\d.]+)/) || [])[1]) },
        detailStatus: "search_only", evidence: { rank: node.data?.rank ?? null, text: clean(node.text) } }));
  }
  function parseDetailSnapshot(snapshot = {}) {
    const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const field = name => nodes.find(n => n?.data?.field === name);
    const titleNode = field("title"); const tierNode = field("priceTiers"); const moqNode = field("moq"); const skuNode = field("sku"); const shipNode = field("shipping"); const dropNode = field("dropshippingPrice");
    const candidate = normalizeCandidate({ sourceUrl: snapshot.pageUrl, title: snapshot.title || titleNode?.text,
      minimumOrderQuantity: moqNode?.data?.value ?? number((moqNode?.text?.match(/(\d+)\s*件起批/) || [])[1]),
      supportsOnePiece: Boolean(dropNode), supportsSample: nodes.some(n => /拿样|样品/.test(n?.text || "")),
      pricing: { displayedPrice: tierNode?.data?.tiers?.[0]?.price ?? number((tierNode?.text?.match(/[¥￥]\s*([\d.]+)/) || [])[1]), onePiecePrice: dropNode?.data?.quantity === 1 ? dropNode.data.price : null,
        samplePrice: null, tiers: tierNode?.data?.tiers || [], selectedSkuPrice: skuNode?.data?.price ?? number((skuNode?.text?.match(/[¥￥]\s*([\d.]+)/) || [])[1]), priceSource: dropNode ? "one_piece" : "tier" },
      shipping: shipNode ? { status: "known", fee: shipNode.data?.amount ?? number((shipNode.text.match(/[¥￥]?\s*([\d.]+)/) || [])[1]) } : undefined,
      sku: { dimensions: skuNode ? [clean(skuNode.text)] : [], options: [], selectedOptionId: null, selectionVerified: false }, detailStatus: "complete", evidence: { capturedAt: snapshot.capturedAt || null } });
    return candidate;
  }
  function candidateBlockers(candidate) {
    const blockers = [];
    if (Number(candidate?.minimumOrderQuantity) > 2) blockers.push("minimum_order_quantity_gt_2");
    if (!candidate?.sourceUrl) blockers.push("missing_source_url");
    if (!candidate?.title) blockers.push("missing_title");
    return blockers;
  }
  function singleUnitQuote(candidate, exception = null) {
    const blockers = candidateBlockers(candidate); const moq = Number(candidate?.minimumOrderQuantity); const pricing = candidate?.pricing || {};
    if (moq > 2) return { confirmable: false, productPrice: null, domesticShipping: null, purchaseCost: null, priceSource: String(pricing.priceSource || "unknown"), blockers: [...new Set(blockers)] };
    const exact = exception?.productId === candidate?.productId && exception?.sourceUrl === candidate?.sourceUrl && Number(exception?.onePiecePrice) > 0 ? Number(exception.onePiecePrice) : null;
    const price = exact || (Number(pricing.onePiecePrice) > 0 ? Number(pricing.onePiecePrice) : Number(pricing.samplePrice) > 0 ? Number(pricing.samplePrice) : moq <= 1 && Number(pricing.selectedSkuPrice) > 0 ? Number(pricing.selectedSkuPrice) : null);
    if (!(price > 0)) blockers.push(moq === 2 ? "single_unit_price_unverified" : "missing_single_unit_price");
    if (!candidate?.shipping || candidate.shipping.status === "unknown") blockers.push("shipping_unknown");
    const shipping = candidate?.shipping?.status === "free" ? 0 : Number(candidate?.shipping?.fee);
    if (!Number.isFinite(shipping) || shipping < 0) blockers.push("shipping_unknown");
    const unique = [...new Set(blockers)];
    return { confirmable: unique.length === 0, productPrice: price ? Number(price.toFixed(2)) : null, domesticShipping: Number.isFinite(shipping) ? Number(shipping.toFixed(2)) : null,
      purchaseCost: unique.length === 0 ? Number((price + shipping).toFixed(2)) : null, priceSource: exact ? "manual_exact_product_exception" : String(pricing.priceSource || "unknown"), blockers: unique };
  }
  function nextSearchStrategy(attempts = []) { const done = new Set(attempts); return !done.has("image") ? "image" : !done.has("keyword") ? "keyword" : !done.has("similar_supplier") ? "similar_supplier" : "complete"; }
  root.Ozon1688Core = { parseSearchSnapshot, parseDetailSnapshot, normalizeCandidate, candidateBlockers, singleUnitQuote, nextSearchStrategy, canonicalOfferUrl };
})(globalThis);
