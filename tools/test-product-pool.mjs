import assert from "node:assert/strict";
import "../ozon-erp-collector-extension/store-scanner-core.js";
import "../ozon-erp-collector-extension/product-pool-core.js";

const core = globalThis.OzonProductPoolCore;
const capture = (id, skus, products) => ({
  batch: { id, stores: [{ sellerKey: "shop", url: "https://www.ozon.ru/seller/shop/" }] },
  stores: { shop: { storeName: "Shop", batchCapture: { batchId: id, skus }, products } },
});
const product = (sku, price, name = "汽车脚垫") => ({ sku, name, price, link: "https://www.ozon.ru/product/test-" + sku + "/" });
let state = core.emptyPool();
state = core.importHistory(state, "300\n300\n不是SKU\n400").state;
const first = core.addBatch(state, capture("batch-a", ["100", "300", "500"], {
  "100": product("100", "1000"),
  "200": product("200", "2000"),
  "300": product("300", "3000"),
  "500": product("500", "4000", "电子烟"),
}), "2026-11-21T08:00:00Z");
assert.equal(first.added, 1);
assert.equal(first.historySkipped, 1);
assert.deepEqual(Object.keys(first.state.products), ["100"]);
state = core.updateProduct(first.state, "100", { status: "sourcing", notes: "待供应商确认" }, "2026-11-21T08:15:00Z");
assert.equal(state.products["100"].manualSavedAt, "2026-11-21T08:15:00Z", "save acknowledgment must persist the manual save timestamp");
assert.equal(core.matchesStatus(state.products["100"], "pending"), true);
const next = core.addBatch(state, capture("batch-b", ["100", "600"], {
  "100": product("100", "1200"),
  "600": product("600", "620"),
}), "2026-11-21T09:00:00Z");
assert.equal(next.added, 1);
assert.equal(next.duplicates, 1);
assert.equal(next.state.products["100"].status, "sourcing");
assert.equal(next.state.products["100"].notes, "待供应商确认");
assert.equal(next.state.products["100"].manualSavedAt, "2026-11-21T08:15:00Z", "rescan must not erase the manual save acknowledgment");
assert.equal(next.state.products["100"].price, "1200");
assert.deepEqual(next.state.products["100"].batchIds, ["batch-a", "batch-b"]);
const repeat = core.addBatch(next.state, capture("batch-b", ["100", "600"], {
  "100": product("100", "1200"), "600": product("600", "620"),
}), "2026-11-21T09:00:01Z");
assert.equal(repeat.added, 0);
assert.equal(repeat.state.products["100"].batchIds.length, 2);
assert.equal(Object.keys(repeat.state.products).length, 2);
const older = core.addBatch(repeat.state, capture("batch-old", ["100"], {"100":product("100","100")}), "2026-11-20T11:00:00Z");
assert.equal(older.state.products["100"].price, "1200");
assert.match(core.exportPoolCsv(repeat.state), /待供应商确认/);
assert.doesNotMatch(core.exportPoolCsv(repeat.state), /"200"|"300"|"500"/);
const risk = core.addBatch(repeat.state, capture("batch-c", ["100"], { "100": product("100", "1300", "电子烟") }), "2026-11-21T10:00:00Z");
assert.equal(risk.state.products["100"].blocked, true);
assert.equal(risk.state.products["100"].status, "sourcing");
assert.match(core.exportPoolCsv(risk.state), /运输待复核/);
const finished = core.updateProduct(next.state, "100", {status:"approved",notes:"人工确认"}, "2026-11-21T11:00:00Z");
assert.equal(core.matchesStatus(finished.products["100"], "pending"), false);
assert.equal(core.matchesStatus(finished.products["100"], ""), true);
assert.equal(core.matchesStatus({...finished.products["100"],status:"rejected"}, "pending"), false);
assert.equal(core.matchesStatus({...finished.products["100"],status:"review"}, "pending"), true);
assert.match(core.exportPoolCsv(finished), /2026-11-21T11:00:00Z/);
console.log("Product pool: batch provenance, global SKU deduplication, history, manual annotations passed.");
