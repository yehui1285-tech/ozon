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
assert.ok(core.singleUnitQuote({ sourceUrl: "https://detail.1688.com/offer/10.html", title: "x", minimumOrderQuantity: 1, pricing: { onePiecePrice: 1 }, shipping: { status: "free", fee: 0 }, sku: { options: [{ id: "a" }], selectionVerified: false } }).blockers.includes("sku_selection_unverified"));
const hidden = { ...fixture, nodes: [{ text: "hidden", href: "https://detail.1688.com/offer/999.html", visible: false, data: { moq: 1 } }, ...fixture.nodes] };
assert.equal(core.parseSearchSnapshot(hidden).some(c => c.productId === "999"), false);
const malformed = { ...detailFixture, title: "", nodes: [{ data: { field: "shipping" }, text: "预计3天送达", visible: true }, { data: { field: "moq" }, text: "", visible: true }] };
assert.notEqual(core.parseDetailSnapshot(malformed).detailStatus, "complete");
assert.equal(core.parseDetailSnapshot({ ...detailFixture, nodes: detailFixture.nodes.map(n => n.data.field === "shipping" ? { ...n, visible: false } : n) }).shipping.status, "unknown");

console.log("1688 core tests passed");
