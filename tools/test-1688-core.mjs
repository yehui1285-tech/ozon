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

const candidates = JSON.parse(JSON.stringify(core.parseSearchSnapshot(fixture)));
assert.equal(candidates[0].provider, "1688");
assert.match(candidates[0].sourceUrl, /^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/);
assert.equal(candidates[0].minimumOrderQuantity, 1);
assert.equal(candidates[0].pricing.displayedPrice, 16);
assert.equal(candidates[0].shipping.fee, 10);
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

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/1.html", title: "测试商品", minimumOrderQuantity: 3,
  pricing: { selectedSkuPrice: 10 }, shipping: { status: "free", fee: 0 },
}))).blockers, ["minimum_order_quantity_gt_2"]);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/2.html", title: "测试商品", minimumOrderQuantity: 2,
  pricing: { selectedSkuPrice: 10, priceSource: "tier" }, shipping: { status: "free", fee: 0 },
}))).blockers, ["single_unit_price_unverified"]);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/3.html", title: "测试商品", minimumOrderQuantity: 2,
  supportsSample: true, pricing: { samplePrice: 12.5, priceSource: "sample" },
  shipping: { status: "known", fee: 3 },
}))), { confirmable: true, productPrice: 12.5, domesticShipping: 3, purchaseCost: 15.5, priceSource: "sample", blockers: [] });

const twoUnitCandidate = { productId: "4", sourceUrl: "https://detail.1688.com/offer/4.html", title: "测试商品", minimumOrderQuantity: 2, pricing: { selectedSkuPrice: 10, priceSource: "tier" }, shipping: { status: "free", fee: 0 } };
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: "2026-08-31T00:00:00.000Z" }).purchaseCost, 11);
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "different", sourceUrl: "https://detail.1688.com/offer/5.html", onePiecePrice: 9 }).confirmable, false);
assert.equal(core.candidateBlockers({ sourceUrl: "https://detail.1688.com/offer/6.html", title: "x", minimumOrderQuantity: 2 }).length, 0);
assert.equal(core.canonicalOfferUrl("http://detail.1688.com/offer/1.html"), "");
assert.equal(core.canonicalOfferUrl("https://detail.1688.com/offer/1.html?x=1"), "https://detail.1688.com/offer/1.html");
assert.equal(core.normalizeCandidate({ minimumOrderQuantity: null }).minimumOrderQuantity, null);
assert.ok(core.candidateBlockers({ sourceUrl: "https://detail.1688.com/offer/7.html", title: "x", minimumOrderQuantity: null }).includes("minimum_order_quantity_unknown"));
assert.ok(core.candidateBlockers({ sourceUrl: "https://detail.1688.com/offer/7.html", title: "x", minimumOrderQuantity: "" }).includes("minimum_order_quantity_unknown"));
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/7.html", title: "x", minimumOrderQuantity: 1, pricing: { onePiecePrice: 1 }, shipping: { status: "known", fee: null } }).blockers.includes("shipping_unknown"));
assert.equal(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/8.html", title: "x", minimumOrderQuantity: 1, pricing: { selectedSkuPrice: 1 }, shipping: { status: "free", fee: null } }).confirmable, true);
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/9.html", title: "x", minimumOrderQuantity: 1, pricing: { onePiecePrice: 1 }, shipping: { status: "known", fee: Infinity } }).blockers.includes("shipping_unknown"));
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/10.html", title: "x", minimumOrderQuantity: 1, pricing: { onePiecePrice: 1 }, shipping: { status: "free", fee: 0 }, sku: { options: [{ id: "a" }], requiresSelection: true, selectionVerified: false } }).blockers.includes("sku_selection_unverified"));
const hidden = { ...fixture, nodes: [{ text: "hidden", href: "https://detail.1688.com/offer/999.html", visible: false, data: { moq: 1 } }, ...fixture.nodes] };
assert.equal(core.parseSearchSnapshot(hidden).some(c => c.productId === "999"), false);
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
assert.deepEqual(Object.keys(safe).sort(), ["candidateId", "detailStatus", "evidence", "imageUrl", "minimumOrderQuantity", "pricing", "productId", "provider", "shipping", "sku", "sourceUrl", "supplierName", "supportsOnePiece", "supportsSample", "title"].sort());
assert.equal(core.parseSearchSnapshot({ nodes: [null, {}, { text: null, href: "bad" }, ...fixture.nodes] }).length, candidates.length);
assert.notEqual(core.parseDetailSnapshot({ ...detailFixture, nodes: detailFixture.nodes.filter(n => !["priceTiers", "shipping"].includes(n.data?.field)) }).detailStatus, "complete");
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11 }).confirmable, false);
const fakeVerified = { ...multiDetail, nodes: multiDetail.nodes.map(n => n.data?.field === "sku" ? { ...n, data: { ...n.data, options: undefined, selectedOptionId: "red", selectionVerified: true } } : n) };
assert.ok(core.candidateBlockers(core.parseDetailSnapshot(fakeVerified)).includes("sku_selection_unverified"));
const noSelected = { ...multiDetail, nodes: multiDetail.nodes.map(n => n.data?.field === "sku" ? { ...n, data: { ...n.data, selectedOptionId: "", selectionVerified: true } } : n) };
assert.ok(core.candidateBlockers(core.parseDetailSnapshot(noSelected)).includes("sku_selection_unverified"));
assert.equal(core.singleUnitQuote({ ...twoUnitCandidate, minimumOrderQuantity: 1, supportsOnePiece: true, pricing: { onePiecePrice: 11 }, sku: { options: [{ id: "a" }], requiresSelection: false } }, null).confirmable, true);
assert.ok(core.singleUnitQuote({ ...twoUnitCandidate, minimumOrderQuantity: 1, supportsOnePiece: true, pricing: { onePiecePrice: 11 }, shipping: { status: "estimated", fee: 0 } }).blockers.includes("shipping_unknown"));
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: true }).confirmable, false);
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: "not-a-date" }).confirmable, false);
const nested = core.normalizeCandidate({ pricing: { tiers: [{ min: 1, price: 2, rawPayload: "x" }], rawPayload: "x" }, shipping: { status: "free", rawPayload: "x" }, sku: { options: [{ id: "a", label: "A", rawPayload: "x" }], rawPayload: "x" }, evidence: { text: "x", rawPayload: "x" } });
assert.deepEqual(Object.keys(nested.pricing).sort(), ["displayedPrice", "onePiecePrice", "priceSource", "samplePrice", "selectedSkuPrice", "tiers"].sort());
assert.deepEqual(Object.keys(nested.shipping).sort(), ["fee", "status"].sort());
assert.deepEqual(Object.keys(nested.sku).sort(), ["dimensions", "options", "optionsComplete", "requiresSelection", "selectedOptionId", "selectionVerified"].sort());

console.log("1688 core tests passed");
