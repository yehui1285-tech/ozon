// Run in a disposable Chromium context. The only Chrome API fixture is the legacy storage snapshot.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OZON_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.OZON_BROWSER_PATH ? { executablePath: process.env.OZON_BROWSER_PATH } : {}),
});
const scripts = ["store-scanner-core.js", "product-pool-core.js", "product-pool-idb.js"].map(name =>
  fileURLToPath(new URL("../ozon-erp-collector-extension/" + name, import.meta.url)));

async function fixture(size) {
  const context = await browser.newContext();
  await context.route("http://pool.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated storage test</title>" }));
  const page = await context.newPage();
  await page.goto("http://pool.test/");
  await page.evaluate(size => {
    const products = {}, history = {};
    for (let n = 0; n < size; n++) {
      const sku = String(100000 + n);
      products[sku] = {
        sku, title: n % 37 === 0 ? "合成 NeEdLe 工具" : "测试商品 " + sku,
        storeName: "测试店铺 " + (n % 23), category: "工具 " + (n % 7),
        firstSeenAt: "2026-01-01T00:00:00Z", lastSeenAt: new Date(Date.UTC(2026, 0, 1 + n % 28)).toISOString(),
        status: ["new", "sourcing", "approved", "rejected"][n % 4], blocked: n % 17 === 0,
        sourceMode: n % 9 === 0 ? "category" : "store",
        price: "123.45", notes: "原备注 " + sku, batchIds: ["first", "second"], weight: "600 g",
        link: "https://www.ozon.ru/product/test-" + sku + "/", customEvidence: { retained: true, rank: n },
      };
      if (n % 5 === 0) history[sku] = n % 10 ? true : { oldField: sku };
    }
    window.legacy = { schemaVersion: 1, products, history };
    window.reads = 0;
    Object.defineProperty(window, "chrome", { configurable: true, value: { storage: { local: {
      get: async key => {
        if (key !== "ozonProductPoolV1") throw Error("unexpected storage key");
        reads++;
        return { [key]: structuredClone(legacy) };
      },
      set: () => { throw Error("legacy writes are forbidden"); },
    } } } });
  }, size);
  for (const script of scripts) await page.addScriptTag({ path: script });
  return { context, page };
}

try {
  const blank = await fixture(0);
  await blank.page.evaluate(() => { legacy = undefined; });
  assert.deepEqual(await blank.page.evaluate(() => OzonProductPoolDB.page({})), {
    items: [], total: 0, matched: 0, newCount: 0, historyCount: 0, offset: 0, limit: 50,
  }, "first install starts with an empty local pool");
  await blank.context.close();

  const failed = await fixture(3);
  await failed.page.evaluate(() => { legacy.products["100003"] = null; });
  await assert.rejects(() => failed.page.evaluate(() => OzonProductPoolDB.page({})), /迁移已中止/);
  const counts = await failed.page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open("ozonProductPool"); req.onsuccess = () => resolve(req.result); });
    const names = ["meta", "products", "listing", "history", "search"];
    const tx = db.transaction(names);
    const counts = await Promise.all(names.map(name => new Promise(resolve => {
      const req = tx.objectStore(name).count(); req.onsuccess = () => resolve(req.result);
    })));
    db.close();
    delete legacy.products["100003"];
    return counts;
  });
  assert.deepEqual(counts, [0, 0, 0, 0, 0], "failed migration rolls back every store and the ready marker");
  assert.equal(await failed.page.evaluate(async () => (await OzonProductPoolDB.page({})).total), 3);
  await failed.context.close();

  console.log("Chromium", browser.version(), "synthetic pool measurements (milliseconds)");
  for (const size of [1000, 10000, 50000]) {
    const { context, page } = await fixture(size);
    const timings = await page.evaluate(async size => {
      const db = OzonProductPoolDB, core = OzonProductPoolCore;
      const check = (value, msg) => { if (!value) throw Error(msg); };
      const times = {};
      const time = async (name, run) => {
        const start = performance.now(), result = await run();
        times[name] = Math.round((performance.now() - start) * 10) / 10;
        return result;
      };
      // Guard the full-record stores through migration, reads, search and updates.
      let productReads = 0;
      const proto = IDBObjectStore.prototype, originals = {};
      for (const method of ["get", "openCursor", "getAll", "getAllKeys", "getAllRecords"]) {
        if (!proto[method]) continue;
        originals[method] = proto[method];
        proto[method] = function(...args) {
          if (this.name === "products" || this.name === "history") {
            if (method !== "get") throw Error("unbounded " + this.name + "." + method);
            if (this.name === "products") productReads++;
          }
          return originals[method].apply(this, args);
        };
      }
      const first = await time("migrationAndFirst", () => db.page({}));
      check(first.total === size && first.historyCount === Math.ceil(size / 5), "migration counts");
      check(reads === 1 && productReads === 50, "migration reads one snapshot and one page");
      const full = Object.values(legacy.products);
      const checkPage = async (name, raw) => {
        const before = productReads;
        const actual = await time(name, () => db.page(raw));
        const opts = core.normalizePageQuery(raw);
        const expected = full.filter(row => core.matchesPageQuery(row, opts)).sort((a, b) => core.comparePoolItems(a, b, opts.sort));
        const offset = opts.offset < expected.length ? opts.offset : Math.max(0, Math.floor((expected.length - 1) / opts.limit) * opts.limit);
        check(actual.total === size && actual.matched === expected.length && actual.offset === offset, name + " counts/offset");
        check(actual.newCount === full.filter(row => row.status === "new" && !row.blocked).length, name + " actionable new count");
        check(JSON.stringify(actual.items) === JSON.stringify(expected.slice(offset, offset + opts.limit)), name + " exact records/order");
        check(productReads - before === actual.items.length, name + " page-bounded item reads");
        return actual;
      };
      await checkPage("first", {});
      await checkPage("deep", { offset: size / 2 - 50, filter: "pending" });
      await checkPage("search", { query: " nEeDle ", filter: "", sort: "recent" });
      await checkPage("sorted", { sort: "skuDesc", filter: "", offset: size - 50 });
      await checkPage("filtered", { sort: "oldest", filter: "approved", limit: 13, offset: 13 });
      await checkPage("searchSku", { query: "100001", sort: "skuAsc", filter: "" });
      await checkPage("searchCategory", { query: "工具 2", sort: "oldest", filter: "new", offset: size, limit: 16 });
      await checkPage("searchStore", { query: "测试店铺 11", sort: "skuDesc", filter: "pending", offset: 10 });
      await checkPage("sourceCategory", { source: "category", filter: "", sort: "recent" });
      await checkPage("sourceStore", { source: "store", filter: "pending", query: "工具 1" });
      await checkPage("noMatches", { query: "NO MATCH", offset: size });

      const sku = "100001", other = "100002", expected = core.productExpectation(legacy.products[sku]);
      function patch(notes) {
        return db.change([sku], ["products"], state => ({
          state: core.updateProducts(state, [{ sku, expected, patch: { status: "review", notes } }]),
        }));
      }
      const result = await time("singleUpdate", () => patch("saved"));
      check(Object.keys(result.state.products).join() === sku && result.state.products[sku].notes === "saved", "touched rows");
      const conflict = await Promise.allSettled([patch("stale")]);
      check(conflict[0].status === "rejected", "stale update blocked");
      const prior = (await db.lookup([sku, other])).products;
      const bulk = await Promise.allSettled([db.change([sku, other], ["products"], state => ({
        state: core.updateProducts(state, [
          { sku: other, expected: core.productExpectation(prior[other]), patch: { status: "review", notes: "must roll back" } },
          { sku, expected, patch: { status: "new", notes: "conflict" } },
        ]),
      }))]);
      check(bulk[0].status === "rejected" && (await db.lookup([other])).products[other].notes === prior[other].notes, "bulk conflict rollback");
      const nextExpected = core.productExpectation(prior[sku]);
      const contender = notes => db.change([sku], ["products"], state => ({
        state: core.updateProducts(state, [{ sku, expected: nextExpected, patch: { status: "review", notes } }]),
      }));
      const race = await Promise.allSettled([contender("winner 1"), contender("winner 2")]);
      check(race.filter(r => r.status === "fulfilled").length === 1, "transactions serialize competing writers");
      const updatedList = await db.page({ filter: "review" });
      const updatedSearch = await db.page({ filter: "review", query: sku });
      const oldSearch = await db.page({ filter: "sourcing", query: sku });
      check(updatedList.matched === 1 && updatedSearch.items[0]?.sku === sku && !oldSearch.matched, "sort and search indexes stay in sync with updates");
      const imported = await db.change(["100000", "900001"], ["history"], state => core.importHistory(state, "100000,900001,900001,invalid"));
      check(imported.added === 1 && imported.invalid === 1 && Object.keys(imported.state.history).join() === "900001", "history duplicate/import");
      check(legacy.products[sku].notes === "原备注 " + sku && !legacy.history["900001"] && reads === 1, "immutable legacy snapshot");
      for (const [method, original] of Object.entries(originals)) proto[method] = original;
      const exported = await db.exportAll(), expectedPool = structuredClone(legacy);
      expectedPool.products[sku] = (await db.lookup([sku])).products[sku];
      expectedPool.history["900001"] = true;
      check(JSON.stringify(exported) === JSON.stringify(expectedPool), "exact full export of every legacy field plus committed writes");
      return times;
    }, size);
    await page.reload();
    await page.evaluate(() => {
      Object.defineProperty(window, "chrome", { configurable: true, value: {storage:{local:{get:()=>{throw Error("legacy read after reopen");}}}} });
    });
    for (const script of scripts) await page.addScriptTag({ path: script });
    assert.equal(await page.evaluate(async () => {
      const found = await OzonProductPoolDB.lookup(["100001", "900001"]);
      return /^winner [12]$/.test(found.products["100001"].notes) && found.history["900001"] === true;
    }), true, "a fresh connection sees committed data without touching the legacy snapshot");
    console.log(JSON.stringify({ size, ...timings }));
    await context.close();
  }
  console.log("IndexedDB migration, rollback, reopen, page equivalence, bounded reads and concurrent writes passed.");
} finally { await browser.close(); }
