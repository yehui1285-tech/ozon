import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-core.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: "1688-core.js" });
const core = context.Ozon1688Core;
assert.ok(core, "1688 core is installed");
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-search-snapshot.json", import.meta.url), "utf8"));
const detailFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-detail-snapshot.json", import.meta.url), "utf8"));
const singleSkuEvidence = { singleSpec: true, optionCount: 1 };

const candidates = JSON.parse(JSON.stringify(core.parseSearchSnapshot(fixture)));
assert.equal(candidates[0].provider, "1688");
assert.match(candidates[0].sourceUrl, /^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/);
assert.equal(candidates[0].minimumOrderQuantity, 1);
assert.equal(candidates[0].pricing.displayedPrice, 16);
assert.equal(candidates[0].shipping.fee, 10);
const dataOfferIdOnly = JSON.parse(JSON.stringify(core.parseSearchSnapshot({ nodes: [{
  text: "扳手套装 ¥29.90 1件起批",
  href: "",
  imageUrl: "https://cbu01.alicdn.com/example.jpg",
  visible: true,
  data: { offerId: "1234567890123" },
}] })));
assert.equal(dataOfferIdOnly.length, 1,
  "a current 1688 result card with a numeric data-offer-id must remain discoverable when it has no canonical anchor href");
assert.equal(dataOfferIdOnly[0].productId, "1234567890123");
assert.equal(dataOfferIdOnly[0].sourceUrl, "https://detail.1688.com/offer/1234567890123.html");
const observedMobileOffer = JSON.parse(JSON.stringify(core.parseSearchSnapshot({ nodes: [{
  text: "绿林内六角扳手套装 ¥29.90 1件起批",
  href: "http://detail.m.1688.com/page/index.html?offerId=705455488262&trace_log=normal",
  imageUrl: "https://cbu01.alicdn.com/observed-card.jpg",
  visible: true,
  data: { offerId: "705455488262" },
}] })));
assert.equal(observedMobileOffer.length, 1,
  "the observed detail.m.1688.com result-card URL must produce a candidate");
assert.equal(observedMobileOffer[0].productId, "705455488262");
assert.equal(observedMobileOffer[0].sourceUrl, "https://detail.1688.com/offer/705455488262.html");
assert.equal(observedMobileOffer[0].imageUrl, "https://cbu01.alicdn.com/observed-card.jpg");
assert.equal(core.parseSearchSnapshot({ nodes: [{
  text: "冲突商品",
  href: "https://detail.1688.com/offer/1111111111111.html",
  visible: true,
  data: { offerId: "2222222222222" },
}] }).length, 0, "conflicting href and data-offer-id identities must be rejected");
assert.equal(core.parseSearchSnapshot({ nodes: [{
  text: "伪造商品",
  href: "",
  visible: true,
  data: { offerId: "123-not-numeric" },
}] }).length, 0, "only a purely numeric data-offer-id may construct a canonical 1688 detail URL");
const cardWithTransactionActions = core.parseSearchSnapshot({ nodes: [{
  text: "扳手套装 ¥29.90 1件起批 联系客服 立即购买",
  href: "https://detail.1688.com/offer/3333333333333.html",
  visible: true,
}] });
assert.equal(cardWithTransactionActions.length, 1);
assert.equal(cardWithTransactionActions[0].title, "扳手套装");
assert.equal(cardWithTransactionActions[0].evidence.text, "扳手套装",
  "persisted candidate evidence must omit transaction-action text from a mixed product card");
assert.equal(core.nextSearchStrategy([]), "image");
assert.equal(core.nextSearchStrategy(["image"]), "keyword");
assert.equal(core.nextSearchStrategy(["image", "keyword"]), "similar_supplier");
assert.equal(core.nextSearchStrategy(["image", "keyword", "similar_supplier"]), "complete");
assert.equal(core.nextSearchStrategy(["keyword"]), "image");

const detail = JSON.parse(JSON.stringify(core.parseDetailSnapshot(detailFixture)));
assert.equal(detail.provider, "1688");
assert.equal(detail.minimumOrderQuantity, 1);
assert.equal(detail.detailStatus, "complete");
assert.ok(detail.pricing.selectedSkuPrice > 0);
assert.equal(detail.shipping.status, "known");
assert.equal(detail.sku.singleSpec, true);
assert.equal(detail.sku.optionCount, 1);
assert.equal(core.singleUnitQuote(detail).confirmable, true);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/1.html", title: "测试商品", minimumOrderQuantity: 3, sku: singleSkuEvidence,
  pricing: { selectedSkuPrice: 10 }, shipping: { status: "free", fee: 0 },
}))).blockers, ["minimum_order_quantity_gt_2"]);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/2.html", title: "测试商品", minimumOrderQuantity: 2, sku: singleSkuEvidence,
  pricing: { selectedSkuPrice: 10, priceSource: "tier" }, shipping: { status: "free", fee: 0 },
}))).blockers, ["single_unit_price_unverified"]);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/3.html", title: "测试商品", minimumOrderQuantity: 2, sku: singleSkuEvidence,
  supportsSample: true, pricing: { samplePrice: 12.5, priceSource: "sample" },
  shipping: { status: "known", fee: 3 },
}))), { confirmable: true, productPrice: 12.5, domesticShipping: 3, purchaseCost: 15.5, priceSource: "sample", blockers: [] });

const twoUnitCandidate = { productId: "4", sourceUrl: "https://detail.1688.com/offer/4.html", title: "测试商品", minimumOrderQuantity: 2, sku: singleSkuEvidence, pricing: { selectedSkuPrice: 10, priceSource: "tier" }, shipping: { status: "free", fee: 0 } };
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: "2026-08-31T00:00:00.000Z" }).purchaseCost, 11);
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "different", sourceUrl: "https://detail.1688.com/offer/5.html", onePiecePrice: 9 }).confirmable, false);
assert.equal(core.candidateBlockers({ sourceUrl: "https://detail.1688.com/offer/6.html", title: "x", minimumOrderQuantity: 2, sku: singleSkuEvidence }).length, 0);
assert.equal(core.canonicalOfferUrl("http://detail.1688.com/offer/1.html"), "");
assert.equal(core.canonicalOfferUrl("https://detail.1688.com/offer/1.html?x=1"), "https://detail.1688.com/offer/1.html");
assert.equal(core.canonicalOfferUrl("http://detail.m.1688.com/page/index.html?offerId=705455488262&trace_log=normal"),
  "https://detail.1688.com/offer/705455488262.html");
assert.equal(core.canonicalOfferUrl("https://evil.example/page/index.html?offerId=705455488262"), "");
assert.equal(core.normalizeCandidate({ minimumOrderQuantity: null }).minimumOrderQuantity, null);
assert.ok(core.candidateBlockers({ sourceUrl: "https://detail.1688.com/offer/7.html", title: "x", minimumOrderQuantity: null }).includes("minimum_order_quantity_unknown"));
assert.ok(core.candidateBlockers({ sourceUrl: "https://detail.1688.com/offer/7.html", title: "x", minimumOrderQuantity: "" }).includes("minimum_order_quantity_unknown"));
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/7.html", title: "x", minimumOrderQuantity: 1, sku: singleSkuEvidence, pricing: { onePiecePrice: 1 }, shipping: { status: "known", fee: null } }).blockers.includes("shipping_unknown"));
assert.equal(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/8.html", title: "x", minimumOrderQuantity: 1, sku: singleSkuEvidence, pricing: { selectedSkuPrice: 1 }, shipping: { status: "free", fee: null } }).confirmable, true);
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/9.html", title: "x", minimumOrderQuantity: 1, sku: singleSkuEvidence, pricing: { onePiecePrice: 1 }, shipping: { status: "known", fee: Infinity } }).blockers.includes("shipping_unknown"));
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/10.html", title: "x", minimumOrderQuantity: 1, pricing: { onePiecePrice: 1 }, shipping: { status: "free", fee: 0 }, sku: { options: [{ id: "a" }], requiresSelection: true, selectionVerified: false } }).blockers.includes("sku_selection_unverified"));
const hidden = { ...fixture, nodes: [{ text: "hidden", href: "https://detail.1688.com/offer/999.html", visible: false, data: { moq: 1 } }, ...fixture.nodes] };
assert.equal(core.parseSearchSnapshot(hidden).some(c => c.productId === "999"), false);
const duplicateUrl = { ...fixture, nodes: [...fixture.nodes, { ...fixture.nodes[0], href: `${fixture.nodes[0].href}?spm=tracking` }] };
assert.equal(core.parseSearchSnapshot(duplicateUrl).length, candidates.length);
const malformed = { ...detailFixture, title: "", nodes: [{ data: { field: "shipping" }, text: "预计3天送达", visible: true }, { data: { field: "moq" }, text: "", visible: true }] };
assert.notEqual(core.parseDetailSnapshot(malformed).detailStatus, "complete");
assert.equal(core.parseDetailSnapshot({ ...detailFixture, nodes: detailFixture.nodes.map(n => n.data.field === "shipping" ? { ...n, visible: false } : n) }).shipping.status, "unknown");
const multiDetail = { ...detailFixture, nodes: detailFixture.nodes.map(n => n.data?.field === "sku" ? { ...n, data: { ...n.data, optionCount: 2, options: [{ id: "red", label: "红" }] }, text: "颜色/型号" } : n) };
const multiCandidate = core.parseDetailSnapshot(multiDetail);
assert.equal(multiCandidate.sku.requiresSelection, true);
assert.ok(core.candidateBlockers(multiCandidate).includes("sku_selection_unverified"));
const singleCandidate = core.parseDetailSnapshot(detailFixture);
assert.equal(singleCandidate.sku.requiresSelection, false);
assert.equal(core.candidateBlockers(singleCandidate).includes("sku_selection_unverified"), false);
const safe = core.normalizeCandidate({ href: "https://detail.1688.com/offer/1.html", offerId: "1", rawPayload: "secret", title: "x", minimumOrderQuantity: 1 });
assert.deepEqual(Object.keys(safe).sort(), ["candidateId", "detailStatus", "evidence", "identityValid", "imageUrl", "minimumOrderQuantity", "pricing", "productId", "provider", "shipping", "sku", "sourceUrl", "supplierName", "supportsOnePiece", "supportsSample", "title"].sort());
assert.equal(core.parseSearchSnapshot({ nodes: [null, {}, { text: null, href: "bad" }, ...fixture.nodes] }).length, candidates.length);
assert.notEqual(core.parseDetailSnapshot({ ...detailFixture, nodes: detailFixture.nodes.filter(n => !["priceTiers", "shipping"].includes(n.data?.field)) }).detailStatus, "complete");
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11 }).confirmable, false);
const fakeVerified = { ...multiDetail, nodes: multiDetail.nodes.map(n => n.data?.field === "sku" ? { ...n, data: { ...n.data, options: undefined, selectedOptionId: "red", selectionVerified: true } } : n) };
assert.ok(core.candidateBlockers(core.parseDetailSnapshot(fakeVerified)).includes("sku_selection_unverified"));
const noSelected = { ...multiDetail, nodes: multiDetail.nodes.map(n => n.data?.field === "sku" ? { ...n, data: { ...n.data, selectedOptionId: "", selectionVerified: true } } : n) };
assert.ok(core.candidateBlockers(core.parseDetailSnapshot(noSelected)).includes("sku_selection_unverified"));
assert.equal(core.singleUnitQuote({ ...twoUnitCandidate, minimumOrderQuantity: 1, supportsOnePiece: true, pricing: { onePiecePrice: 11 }, sku: singleSkuEvidence }, null).confirmable, true);
assert.ok(core.singleUnitQuote({ ...twoUnitCandidate, minimumOrderQuantity: 1, supportsOnePiece: true, pricing: { onePiecePrice: 11 }, shipping: { status: "estimated", fee: 0 } }).blockers.includes("shipping_unknown"));
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: true }).confirmable, false);
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: "not-a-date" }).confirmable, false);
const nested = core.normalizeCandidate({ pricing: { tiers: [{ min: 1, price: 2, rawPayload: "x" }], rawPayload: "x" }, shipping: { status: "free", rawPayload: "x" }, sku: { options: [{ id: "a", label: "A", rawPayload: "x" }], rawPayload: "x" }, evidence: { text: "x", rawPayload: "x" } });
assert.deepEqual(Object.keys(nested.pricing).sort(), ["displayedPrice", "onePiecePrice", "priceSource", "samplePrice", "selectedSkuPrice", "tiers"].sort());
assert.deepEqual(Object.keys(nested.shipping).sort(), ["fee", "status"].sort());
assert.deepEqual(Object.keys(nested.sku).sort(), ["dimensions", "optionCount", "options", "optionsComplete", "requiresSelection", "selectedOptionId", "selectionVerified", "singleSpec"].sort());

// SKU proof is deny-by-default. Only an explicit single-spec marker or a fully
// enumerated and verified multi-option selection can produce a quote.
const quoteBase = {
  productId: "20", sourceUrl: "https://detail.1688.com/offer/20.html", title: "测试商品",
  minimumOrderQuantity: 1, supportsOnePiece: true,
  pricing: { onePiecePrice: 10, selectedSkuPrice: 10, priceSource: "selected_sku" },
  shipping: { status: "free", fee: 0 },
};
assert.ok(core.candidateBlockers(quoteBase).includes("sku_selection_unverified"));
assert.equal(core.singleUnitQuote(quoteBase).confirmable, false);
assert.equal(core.singleUnitQuote(quoteBase).productPrice, null);

const noSkuDetail = { ...detailFixture, nodes: detailFixture.nodes.filter(node => node.data?.field !== "sku") };
assert.notEqual(core.parseDetailSnapshot(noSkuDetail).detailStatus, "complete");
assert.ok(core.singleUnitQuote(core.parseDetailSnapshot(noSkuDetail)).blockers.includes("sku_selection_unverified"));

function detailWithSku(data) {
  return {
    ...detailFixture,
    nodes: detailFixture.nodes.map(node => node.data?.field === "sku"
      ? { ...node, data: { field: "sku", price: 8.5, ...data }, text: "颜色/型号 ¥8.5" }
      : node),
  };
}

const explicitlyIncomplete = core.parseDetailSnapshot(detailWithSku({
  optionCount: 2,
  optionsComplete: false,
  options: [{ id: "red", label: "红" }, { id: "blue", label: "蓝" }],
  selectedOptionId: "red",
  selectionVerified: true,
}));
assert.equal(explicitlyIncomplete.sku.optionsComplete, false);
assert.ok(core.candidateBlockers(explicitlyIncomplete).includes("sku_selection_unverified"));

for (const skuData of [
  { optionCount: 2, optionsComplete: true, options: [{ id: "red" }], selectedOptionId: "red", selectionVerified: true },
  { optionCount: 3, optionsComplete: true, options: [{ id: "red" }, { id: "blue" }], selectedOptionId: "red", selectionVerified: true },
  { optionsComplete: true, options: [{ id: "red" }, { id: "blue" }], selectedOptionId: "red", selectionVerified: true },
  { optionCount: 2, optionsComplete: true, options: [{ id: "red" }, { id: "blue" }], selectedOptionId: "green", selectionVerified: true },
  { optionCount: 2, optionsComplete: true, options: [{ id: "red" }, { id: "red" }], selectedOptionId: "red", selectionVerified: true },
]) {
  const unsafe = core.parseDetailSnapshot(detailWithSku(skuData));
  assert.ok(core.candidateBlockers(unsafe).includes("sku_selection_unverified"));
  assert.equal(core.singleUnitQuote(unsafe).confirmable, false);
}

const verifiedMulti = core.parseDetailSnapshot(detailWithSku({
  optionCount: 2,
  optionsComplete: true,
  options: [{ id: "red", label: "红" }, { id: "blue", label: "蓝" }],
  selectedOptionId: "blue",
  selectionVerified: true,
}));
assert.equal(verifiedMulti.detailStatus, "complete");
assert.equal(core.candidateBlockers(verifiedMulti).includes("sku_selection_unverified"), false);
assert.equal(core.singleUnitQuote(verifiedMulti).confirmable, true);

// Shipping must carry a finite non-negative fee unless the page explicitly says free.
const estimatedShipping = core.parseDetailSnapshot({
  ...detailFixture,
  nodes: detailFixture.nodes.map(node => node.data?.field === "shipping"
    ? { ...node, data: { field: "shipping", amount: "estimated" }, text: "运费待估算" }
    : node),
});
assert.equal(estimatedShipping.shipping.status, "unknown");
assert.equal(estimatedShipping.shipping.fee, null);
assert.ok(core.singleUnitQuote(estimatedShipping).blockers.includes("shipping_unknown"));
assert.deepEqual(JSON.parse(JSON.stringify(core.normalizeCandidate({ shipping: { status: "known", fee: "estimated" } }).shipping)), { status: "unknown", fee: null });
assert.equal(core.normalizeCandidate({ pricing: { displayedPrice: "NaN", selectedSkuPrice: Infinity } }).pricing.displayedPrice, null);
assert.equal(core.normalizeCandidate({ pricing: { displayedPrice: "NaN", selectedSkuPrice: Infinity } }).pricing.selectedSkuPrice, null);

// Product identity is derived from one canonical 1688 detail URL and cannot conflict.
const conflictedIdentity = core.normalizeCandidate({
  productId: "999",
  sourceUrl: "https://detail.1688.com/offer/21.html",
  title: "测试商品",
  minimumOrderQuantity: 1,
  sku: singleSkuEvidence,
  pricing: { selectedSkuPrice: 10, priceSource: "selected_sku" },
  shipping: { status: "free", fee: 0 },
});
assert.equal(conflictedIdentity.productId, "21");
assert.ok(core.candidateBlockers(conflictedIdentity).includes("invalid_product_identity"));
assert.equal(core.singleUnitQuote(conflictedIdentity).confirmable, false);
assert.equal(core.singleUnitQuote(conflictedIdentity).productPrice, null);
assert.ok(core.singleUnitQuote({ ...quoteBase, sourceUrl: "https://example.com/offer/20.html", sku: singleSkuEvidence }).blockers.includes("invalid_product_identity"));
assert.ok(core.singleUnitQuote(twoUnitCandidate, {
  productId: "4",
  sourceUrl: "https://example.com/offer/4.html",
  onePiecePrice: 11,
  confirmedAt: "2026-08-31T00:00:00.000Z",
}).blockers.includes("single_unit_price_unverified"));

// Evidence is a strict diagnostic/reference whitelist and never preserves nested input.
const safeEvidence = core.normalizeCandidate({
  sourceUrl: "https://detail.1688.com/offer/22.html",
  evidence: {
    rank: 2,
    text: "公开节点文本",
    capturedAt: "2026-08-31T00:00:00.000Z",
    localRef: "/api/evidence/1688-safe.jpg",
    rawPayload: { token: "secret-token" },
    diagnostics: { cookie: "secret-cookie" },
    nested: [{ authorization: "secret-authorization" }],
  },
});
assert.deepEqual(JSON.parse(JSON.stringify(safeEvidence.evidence)), {
  rank: 2,
  text: "公开节点文本",
  capturedAt: "2026-08-31T00:00:00.000Z",
  localRef: "/api/evidence/1688-safe.jpg",
});
assert.doesNotMatch(JSON.stringify(safeEvidence), /secret|rawPayload|cookie|token|authorization/i);
assert.equal(core.normalizeCandidate({
  sourceUrl: "https://detail.1688.com/offer/23.html",
  evidence: { localRef: "secret-token", rawPayload: { cookie: "secret-cookie" } },
}).evidence, null);

// Manual exceptions require a real timezone-bearing instant, not Date.parse rollover.
for (const confirmedAt of ["2026-02-31T00:00:00.000Z", "2026-08-31T00:00:00", "2026-13-01T00:00:00Z"]) {
  assert.equal(core.singleUnitQuote(twoUnitCandidate, {
    productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt,
  }).confirmable, false);
}
assert.equal(core.singleUnitQuote(twoUnitCandidate, {
  productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11,
  confirmedAt: "2026-08-31T08:00:00+08:00",
}).confirmable, true);

const twoUnitOnePiece = core.singleUnitQuote({
  ...twoUnitCandidate,
  supportsOnePiece: true,
  pricing: { onePiecePrice: 10.25, priceSource: "one_piece" },
});
assert.equal(twoUnitOnePiece.confirmable, true);
assert.equal(twoUnitOnePiece.purchaseCost, 10.25);

// Canonical price sources remain stable through normalization and quoting.
for (const priceSource of ["one_piece", "sample", "tier", "displayed", "selected_sku"]) {
  assert.equal(core.normalizeCandidate({ pricing: { priceSource } }).pricing.priceSource, priceSource);
}
const selectedSkuQuote = core.singleUnitQuote({ ...quoteBase, sku: singleSkuEvidence });
assert.equal(selectedSkuQuote.confirmable, true);
assert.equal(selectedSkuQuote.priceSource, "selected_sku");

console.log("1688 core tests passed");
