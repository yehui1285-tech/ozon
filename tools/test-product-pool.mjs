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
const change = (p, status, notes = p.notes) => ({sku:p.sku,patch:{status,notes},expected:{status:p.status,notes:p.notes,blocked:p.blocked,manualSavedAt:p.manualSavedAt||""}});
const changes=[change(next.state.products["100"],"rejected"),change(next.state.products["600"],"review","第二件")];
const bulk=core.updateProducts(next.state,changes,"2026-11-21T12:00:00Z");
assert.equal(bulk.products["100"].status,"rejected");
assert.equal(bulk.products["100"].notes,"待供应商确认");
assert.equal(bulk.products["600"].status,"review");
assert.equal(bulk.products["600"].manualSavedAt,"2026-11-21T12:00:00Z");
assert.equal(next.state.products["100"].status,"sourcing");
const categoryCapture=capture("category-test",["700"],{"700":product("700","100")});
categoryCapture.batch.sourceMode="category";
categoryCapture.batch.stores[0].url="https://www.ozon.ru/category/tools-1234/";
categoryCapture.stores.shop.storeName="类目 · 工具";
const categoryPool=core.addBatch(next.state,categoryCapture).state;
assert.equal(categoryPool.products["700"].sourceMode,"category");
assert.equal(categoryPool.products["700"].sourceUrl,"https://www.ozon.ru/category/tools-1234/");
assert.equal(categoryPool.products["700"].storeName,"类目 · 工具");
assert.throws(()=>core.updateProducts(next.state,[changes[0],change(next.state.products["600"],"approved")]),/复核/);
assert.throws(()=>core.updateProducts(next.state,[changes[0],changes[0]]),/重复/);
assert.throws(()=>core.updateProducts(bulk,changes),/变化/);
assert.throws(()=>core.updateProducts(next.state,[changes[0],{...changes[1],sku:"999"}]),/不存在/);
assert.throws(()=>core.updateProducts(next.state,[{...changes[0],patch:{status:"review",notes:"x".repeat(4001)}}]),/备注/);
assert.throws(()=>core.updateProducts(next.state,[]),/1–50/);
assert.throws(()=>core.updateProducts(next.state,Array(51).fill(changes[0])),/1–50/);
assert.throws(()=>core.updateProducts(risk.state,[changes[0]]),/变化/);
const amendApproved=core.updateProducts(finished,[change(finished.products["100"],"approved","补充说明")]);
assert.equal(amendApproved.products["100"].status,"approved");
assert.equal(amendApproved.products["100"].notes,"补充说明");
assert.equal(next.state.products["100"].status,"sourcing");
const pageOptions = core.normalizePageQuery({ query: "  МОТОР ", filter: "pending", sort: "oldest", offset: "50", limit: 99 });
assert.equal(pageOptions.query, "мотор");
assert.equal(pageOptions.offset, 50);
assert.equal(pageOptions.limit, 50);
assert.equal(pageOptions.sort, "oldest");
assert.equal(core.normalizePageQuery({offset:-5,limit:0,sort:"invalid"}).offset,0);
assert.equal(core.normalizePageQuery({sort:"savedRecent"}).sort,"savedRecent");
assert.equal(core.normalizePageQuery({sort:"savedOldest"}).sort,"savedOldest");
assert.equal(core.normalizePageQuery({sort:"skuAsc"}).sort,"recent");
assert.equal(core.normalizePageQuery({sort:"skuDesc"}).sort,"recent");
assert.equal(core.normalizePageQuery({sort:"invalid"}).sort,"recent");
const a={sku:"100",title:"Мотор",status:"review",lastSeenAt:"2026-11-21T00:00:00Z"};
const b={...a,sku:"200",status:"approved"};
assert.equal(core.matchesPageQuery(a,pageOptions),true);
assert.equal(core.matchesPageQuery(b,pageOptions),false);
assert.ok(core.comparePoolItems(a,b,"recent")>0);
assert.ok(core.comparePoolItems(a,b,"oldest")<0);
const savedOld={sku:"300",lastSeenAt:"2026-11-22T00:00:00Z",manualSavedAt:"2026-11-25T10:00:00Z"};
const savedNew={sku:"400",lastSeenAt:"2026-11-20T00:00:00Z",manualSavedAt:"2026-11-25T15:00:00Z"};
const savedTieEarly={sku:"350",lastSeenAt:"2026-11-19T00:00:00Z",manualSavedAt:"2026-11-25T15:00:00Z"};
assert.ok(core.comparePoolItems(savedNew,savedOld,"savedRecent")<0);
assert.ok(core.comparePoolItems(savedNew,savedOld,"savedOldest")>0);
assert.ok(core.comparePoolItems(savedOld,a,"savedRecent")<0,"saved items must precede unsaved in savedRecent");
assert.ok(core.comparePoolItems(savedOld,a,"savedOldest")<0,"saved items must precede unsaved in savedOldest");
assert.ok(core.comparePoolItems(a,b,"savedRecent")>0,"unsaved ties fall back to recent order");
assert.ok(core.comparePoolItems(a,b,"savedOldest")<0,"unsaved ties fall back to oldest order");
assert.ok(core.comparePoolItems(savedNew,savedTieEarly,"savedRecent")<0,"equal manualSavedAt falls back to lastSeenAt desc");
assert.ok(core.comparePoolItems(savedTieEarly,savedNew,"savedOldest")<0,"equal manualSavedAt falls back to lastSeenAt asc");
assert.equal(core.normalizeImageUrl("https://cdn1.ozone.ru/s3/multimedia-a/wc250/1.jpg"), "https://cdn1.ozone.ru/s3/multimedia-a/wc250/1.jpg");
assert.equal(core.normalizeImageUrl("https://evil.example/1.jpg"), "");
assert.equal(core.normalizeImageUrl("https://ir.ozone.ru/icon.svg"), "");
assert.equal(core.normalizePageQuery({ source: "category" }).source, "category");
assert.equal(core.normalizePageQuery({ source: "invalid" }).source, "");
assert.equal(core.normalizePageQuery({ batchId: "  batch-b  ", deviceId: " dev-1 " }).batchId, "batch-b");
assert.equal(core.normalizePageQuery({ batchId: "batch-b", deviceId: " dev-1 " }).deviceId, "dev-1");
assert.equal(core.matchesPageQuery(categoryPool.products["100"], core.normalizePageQuery({ filter: "all", batchId: "batch-b" })), true);
assert.equal(core.matchesPageQuery(categoryPool.products["700"], core.normalizePageQuery({ filter: "all", batchId: "batch-b" })), false);
const imgPool = core.addBatch(core.emptyPool(), capture("batch-img-1", ["801"], {
  "801": { ...product("801", "500"), monthlySales: "120", imageUrl: "https://ir.ozone.ru/s3/m/wc250/801.jpg" },
}), "2026-11-26T08:00:00Z").state;
assert.equal(imgPool.products["801"].imageUrl, "https://ir.ozone.ru/s3/m/wc250/801.jpg");
const backfillPool = core.addBatch(core.addBatch(core.emptyPool(), capture("batch-noimg", ["802"], { "802": product("802", "500") }), "2026-11-26T09:00:00Z").state,
  capture("batch-backfill", ["802"], { "802": { ...product("802", "400"), imageUrl: "https://ir.ozone.ru/s3/m/wc250/802.jpg" } }), "2026-11-26T08:00:00Z").state;
assert.equal(backfillPool.products["802"].price, "500");
assert.equal(backfillPool.products["802"].imageUrl, "https://ir.ozone.ru/s3/m/wc250/802.jpg");
assert.match(core.exportPoolCsv(imgPool), /"图片链接"/);
assert.match(core.exportPoolCsv(imgPool), /https:\/\/ir\.ozone\.ru\/s3\/m\/wc250\/801\.jpg/);
assert.equal(core.matchesPageQuery(categoryPool.products["700"], core.normalizePageQuery({ source: "category" })), true);
assert.equal(core.matchesPageQuery(categoryPool.products["700"], core.normalizePageQuery({ source: "store" })), false);
assert.equal(core.matchesPageQuery(categoryPool.products["100"], core.normalizePageQuery({ source: "store" })), true);
console.log("Product pool: batch provenance, global SKU deduplication, history, manual annotations and page query passed.");
