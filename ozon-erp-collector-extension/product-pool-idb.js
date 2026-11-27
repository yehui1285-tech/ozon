(function (scope) {
  "use strict";
  const core = scope.OzonProductPoolCore;
  const legacyKey = "ozonProductPoolV1";
  const dataStores = ["products", "history", "listing", "search"];
  let opening;

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function transact(db, stores, mode, run) {
    const tx = db.transaction(stores, mode);
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error("商品池事务已撤销"));
    });
    // An automatic abort can arrive before the last request rejects.
    finished.catch(() => {});
    try {
      const value = await run(tx);
      await finished;
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* Already finished or aborted. */ }
      await finished.catch(() => {});
      throw error;
    }
  }

  function putProduct(tx, sku, item, searchChanges) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("商品池记录损坏，迁移已中止");
    tx.objectStore("products").put(item, sku);
    tx.objectStore("listing").put({
      sku, status: String(item.status ?? ""), lastSeenAt: String(item.lastSeenAt ?? ""),
      pending: Number(core.matchesStatus(item, "pending")), isNew: Number(item.status === "new" && !item.blocked),
    });
    // A bounded number of compact blocks avoids one IndexedDB record decode
    // per product when an arbitrary substring must be checked across the pool.
    let hash = 0;
    for (let i = 0; i < sku.length; i++) hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
    const bucket = hash % 256;
    if (!searchChanges.has(bucket)) searchChanges.set(bucket, new Map());
    searchChanges.get(bucket).set(sku, {
      sku, status: String(item.status ?? ""), lastSeenAt: String(item.lastSeenAt ?? ""),
      manualSavedAt: String(item.manualSavedAt ?? ""),
      batchIds: Array.isArray(item.batchIds) ? item.batchIds.map(String) : [],
      sourceMode: item.sourceMode === "category" ? "category" : "store",
      title: String(item.title ?? ""), category: String(item.category ?? ""), storeName: String(item.storeName ?? ""),
    });
  }

  async function writeSearchChanges(tx, changes, initializing = false) {
    const store = tx.objectStore("search");
    await Promise.all([...changes].map(async ([id, rows]) => {
      const prior = initializing ? {} : (await request(store.get(id)))?.rows || {};
      store.put({ id, rows: { ...prior, ...Object.fromEntries(rows) } });
    }));
  }

  async function openReady() {
    if (!scope.indexedDB) throw Error("IndexedDB 不可用，无法读取或保存商品池");
    const req = scope.indexedDB.open("ozonProductPool", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("meta");
      db.createObjectStore("products");
      db.createObjectStore("history");
      db.createObjectStore("search", { keyPath: "id" });
      const listing = db.createObjectStore("listing", { keyPath: "sku" });
      listing.createIndex("recent", ["lastSeenAt", "sku"]);
      listing.createIndex("newCount", "isNew");
      for (const bucket of ["status", "pending"]) {
        listing.createIndex(bucket + "Sku", [bucket, "sku"]);
        listing.createIndex(bucket + "Recent", [bucket, "lastSeenAt", "sku"]);
      }
    };
    const db = await request(req);
    db.onversionchange = () => { db.close(); opening = undefined; };
    try {
      const marker = tx => request(tx.objectStore("meta").get("ready"));
      if (await transact(db, ["meta"], "readonly", marker) !== 1) {
        const legacy = (await scope.chrome.storage.local.get(legacyKey))[legacyKey];
        await transact(db, [...dataStores, "meta"], "readwrite", async tx => {
          if (await marker(tx) === 1) return; // Another context completed the migration.
          if (legacy !== undefined) {
            if (!legacy || (legacy.schemaVersion !== undefined && legacy.schemaVersion !== 1) ||
                !legacy.products || typeof legacy.products !== "object" || Array.isArray(legacy.products) ||
                !legacy.history || typeof legacy.history !== "object" || Array.isArray(legacy.history)) {
              throw Error("原商品池格式异常，迁移已中止");
            }
            const searchChanges = new Map();
            for (const [sku, item] of Object.entries(legacy.products)) putProduct(tx, sku, item, searchChanges);
            for (const [sku, value] of Object.entries(legacy.history)) tx.objectStore("history").put(value, sku);
            await writeSearchChanges(tx, searchChanges, true);
          }
          tx.objectStore("meta").put(1, "ready");
          tx.objectStore("meta").put(4, "searchVersion");
        });
      } else if ((await transact(db, ["meta"], "readonly", tx => request(tx.objectStore("meta").get("searchVersion")))) !== 4) {
        await transact(db, ["products", "listing", "search", "meta"], "readwrite", async tx => {
          if (await request(tx.objectStore("meta").get("searchVersion")) === 4) return;
          const products = tx.objectStore("products");
          const [keys, values] = await Promise.all([request(products.getAllKeys()), request(products.getAll())]);
          tx.objectStore("search").clear();
          const searchChanges = new Map();
          for (let i = 0; i < keys.length; i++) putProduct(tx, String(keys[i]), values[i], searchChanges);
          await writeSearchChanges(tx, searchChanges, true);
          tx.objectStore("meta").put(4, "searchVersion");
        });
      }
      return db;
    } catch (error) { db.close(); throw error; }
  }

  function ready() {
    return opening ||= openReady().catch(error => { opening = undefined; throw error; });
  }

  async function selected(tx, keys, stores) {
    const state = core.emptyPool();
    await Promise.all(stores.map(async name => {
      const store = tx.objectStore(name);
      const pairs = await Promise.all(keys.map(async sku => [sku, await request(store.get(sku))]));
      state[name] = Object.fromEntries(pairs.filter(([, value]) => value !== undefined));
    }));
    return state;
  }

  function uniqueSkus(skus) {
    return [...new Set(skus.map(value => String(value ?? "").trim()).filter(sku => /^\d+$/.test(sku)))];
  }

  async function lookup(skus) {
    const keys = uniqueSkus(skus);
    if (!keys.length) return core.emptyPool();
    return transact(await ready(), ["products", "history"], "readonly", tx => selected(tx, keys, ["products", "history"]));
  }

  async function change(skus, stores, apply) {
    const keys = uniqueSkus(skus);
    const writes = stores.includes("products") ? [...stores, "listing", "search"] : stores;
    return transact(await ready(), writes, "readwrite", async tx => {
      const before = await selected(tx, keys, stores);
      const result = apply(before);
      const state = core.emptyPool();
      const searchChanges = new Map();
      for (const name of stores) {
        for (const [sku, value] of Object.entries(result.state[name])) {
          if (Object.hasOwn(before[name], sku) && before[name][sku] === value) continue;
          if (name === "products") putProduct(tx, sku, value, searchChanges);
          else tx.objectStore("history").put(value, sku);
          state[name][sku] = value;
        }
      }
      if (searchChanges.size) await writeSearchChanges(tx, searchChanges);
      return { ...result, state };
    });
  }

  async function exportAll() {
    return transact(await ready(), ["products", "history"], "readonly", async tx => {
      const state = core.emptyPool();
      await Promise.all(["products", "history"].map(async name => {
        const store = tx.objectStore(name);
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        state[name] = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
      }));
      return state;
    });
  }

  function pageSource(listing, opts) {
    const direction = opts.sort === "oldest" ? "next" : "prev";
    if (!opts.filter) return { source: listing.index("recent"), direction };
    const pending = opts.filter === "pending";
    const index = (pending ? "pending" : "status") + "Recent";
    const value = pending ? 1 : opts.filter;
    return { source: listing.index(index), range: IDBKeyRange.bound([value], [value, []]), direction };
  }

  function pageOffset(offset, matched, limit) {
    return offset < matched ? offset : Math.max(0, Math.floor((matched - 1) / limit) * limit);
  }

  function walk(source, range, direction, visit, keysOnly = false) {
    return new Promise((resolve, reject) => {
      const req = keysOnly ? source.openKeyCursor(range, direction) : source.openCursor(range, direction);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        try {
          if (!cursor || visit(cursor) === false) resolve();
        } catch (error) { reject(error); }
      };
    });
  }

  async function collectBatches(search) {
    const map = new Map();
    let nextRange;
    for (;;) {
      const blocks = await request(search.getAll(nextRange, 16));
      for (const block of blocks) {
        for (const row of Object.values(block.rows)) {
          for (const rawId of (row.batchIds || [])) {
            const id = String(rawId || "");
            if (!id) continue;
            const cur = map.get(id) || { id, count: 0, updatedAt: "" };
            cur.count += 1;
            const seen = String(row.lastSeenAt || "");
            if (seen > cur.updatedAt) cur.updatedAt = seen;
            map.set(id, cur);
          }
        }
      }
      if (blocks.length < 16) break;
      nextRange = IDBKeyRange.lowerBound(blocks[blocks.length - 1].id, true);
    }
    return [...map.values()].sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
  }

  async function matchingPage(listing, search, opts) {
    const { source, range, direction } = pageSource(listing, opts);
    const keys = [];
    if (!opts.query && !opts.source && !opts.batchId && !["savedRecent", "savedOldest"].includes(opts.sort)) {
      const matched = await request(source.count(range));
      const offset = pageOffset(opts.offset, matched, opts.limit);
      let skip = offset;
      if (matched) await walk(source, range, direction, cursor => {
        if (skip) { cursor.advance(skip); skip = 0; return; }
        keys.push(cursor.primaryKey);
        if (keys.length === opts.limit) return false;
        cursor.continue();
      }, true);
      return { matched, offset, keys };
    }

    // Exact substring counts need the search fields. Sequential projection reads
    // avoid a random disk lookup per index entry; only matching sort keys survive
    // each chunk. Full product payloads remain bounded to the requested page.
    const matches = [];
    let nextRange;
    for (;;) {
      const blocks = await request(search.getAll(nextRange, 8));
      for (const block of blocks) {
        for (const row of Object.values(block.rows)) if (core.matchesPageQuery(row, opts)) {
          matches.push({ sku: row.sku, lastSeenAt: row.lastSeenAt, manualSavedAt: row.manualSavedAt });
        }
      }
      if (blocks.length < 8) break;
      nextRange = IDBKeyRange.lowerBound(blocks[blocks.length - 1].id, true);
    }
    matches.sort((a, b) => core.comparePoolItems(a, b, opts.sort));
    const matched = matches.length;
    const offset = pageOffset(opts.offset, matched, opts.limit);
    return { matched, offset, keys: matches.slice(offset, offset + opts.limit).map(row => row.sku) };
  }

  async function page(raw) {
    const opts = core.normalizePageQuery(raw);
    return transact(await ready(), dataStores, "readonly", async tx => {
      const products = tx.objectStore("products"), listing = tx.objectStore("listing"), search = tx.objectStore("search");
      const [total, newCount, historyCount, found, batches] = await Promise.all([
        request(products.count()), request(listing.index("newCount").count(1)), request(tx.objectStore("history").count()),
        matchingPage(listing, search, opts), collectBatches(search),
      ]);
      const items = await Promise.all(found.keys.map(sku => request(products.get(sku))));
      return { items, total, matched: found.matched, newCount, historyCount, offset: found.offset, limit: opts.limit, batches };
    });
  }

  scope.OzonProductPoolDB = Object.freeze({ lookup, change, exportAll, page });
})(globalThis);
