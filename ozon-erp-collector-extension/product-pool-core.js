(function (scope) {
  "use strict";
  const scanner = scope.OzonStoreScannerCore;
  const statuses = Object.freeze({ new: "待找品", sourcing: "找品中", review: "待复核", approved: "人工已复核", rejected: "淘汰" });
  const normalizeImageUrl = (value) => {
    if (scanner?.normalizeImageUrl) return scanner.normalizeImageUrl(value);
    const input = String(value ?? "").trim();
    if (!input || input.length > 1024 || /^(?:data|blob|javascript):/i.test(input)) return "";
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
      if (!/(?:^|\.)(?:ozone\.ru|ozon\.ru)$/i.test(parsed.hostname) || /\.svg(?:$|\?)/i.test(parsed.pathname)) return "";
      return parsed.href;
    } catch {
      return "";
    }
  };
  function matchesStatus(product, filter) {
    if (filter === "pending") return !["approved", "rejected"].includes(product.status);
    return !filter || product.status === filter;
  }
  function normalizePageQuery(raw = {}) {
    const integer = (value, fallback) => value == null || value === "" || !Number.isSafeInteger(Number(value)) ? fallback : Number(value);
    const filter = raw.filter === "all" ? "" : raw.filter == null ? "pending" : String(raw.filter);
    const source = raw.source === "category" || raw.source === "store" ? raw.source : "";
    const batchId = String(raw.batchId ?? "").trim().slice(0, 120);
    const deviceId = String(raw.deviceId ?? "").trim().slice(0, 120);
    return {
      query: String(raw.query ?? "").trim().toLowerCase().slice(0, 200),
      filter: filter === "" || filter === "pending" || Object.hasOwn(statuses, filter) ? filter : "pending",
      source,
      batchId,
      deviceId,
      sort: ["recent", "oldest", "savedRecent", "savedOldest"].includes(raw.sort) ? raw.sort : "recent",
      offset: Math.max(0, integer(raw.offset, 0)),
      limit: Math.max(1, Math.min(50, integer(raw.limit, 50))),
    };
  }
  function matchesPageQuery(item, options) {
    const mode = item.sourceMode === "category" ? "category" : "store";
    const batchOk = !options.batchId || (Array.isArray(item.batchIds) && item.batchIds.includes(options.batchId));
    return matchesStatus(item, options.filter) && (!options.source || mode === options.source) && batchOk && [item.sku,item.title,item.category,item.storeName].some(s => String(s ?? "").toLowerCase().includes(options.query));
  }
  function comparePoolItems(a, b, sort) {
    const cmp = (x,y) => String(x ?? "") < String(y ?? "") ? -1 : String(x ?? "") > String(y ?? "") ? 1 : 0;
    const sku = cmp(a.sku,b.sku);
    if (sort === "savedRecent" || sort === "savedOldest") {
      const sa = String(a.manualSavedAt ?? "");
      const sb = String(b.manualSavedAt ?? "");
      if (Boolean(sa) !== Boolean(sb)) return sa ? -1 : 1;
      const result = cmp(sa, sb) || cmp(a.lastSeenAt, b.lastSeenAt) || sku;
      return sort === "savedOldest" ? result : -result;
    }
    const result = cmp(a.lastSeenAt,b.lastSeenAt) || sku;
    return sort === "oldest" ? result : -result;
  }
  const normalizeSku = (value) => /^\d+$/.test(String(value ?? "").trim()) ? String(value).trim() : "";
  const emptyPool = () => ({ schemaVersion: 1, products: {}, history: {} });

  function copyPool(state) {
    return { schemaVersion: 1, products: { ...(state?.products || {}) }, history: { ...(state?.history || {}) } };
  }

  function importHistory(state, text) {
    const next = copyPool(state);
    let added = 0;
    let invalid = 0;
    for (const line of String(text ?? "").split(/[\r\n,，;；]+/)) {
      if (!line.trim()) continue;
      const sku = normalizeSku(line);
      if (!sku) { invalid++; continue; }
      if (!Object.hasOwn(next.history, sku)) {
        next.history[sku] = true;
        added++;
      }
    }
    return { state: next, added, invalid };
  }

  function addBatch(state, { batch, stores }, now = new Date().toISOString()) {
    const next = copyPool(state);
    const result = { state: next, added: 0, duplicates: 0, historySkipped: 0, riskSkipped: 0 };
    const seen = new Set();
    const rows = scanner.batchCapturedRows(batch, stores);
    const observedAt = Number.isFinite(Date.parse(batch?.updatedAt)) ? new Date(batch.updatedAt).toISOString() : now;
    const blocked = new Set(rows.filter(({ product }) => !scanner.productAllowedForTaskQueue(product)).map(({ product }) => normalizeSku(product.sku)));
    for (const { product, task, saved } of rows) {
      const sku = normalizeSku(product.sku);
      if (!sku) continue;
      const previous = next.products[sku];
      const eligible = !blocked.has(sku);
      if (!eligible) {
        if (previous && observedAt >= previous.lastSeenAt) next.products[sku] = { ...previous, blocked: true, shippingRisk: "本批运输待复核或已排除", lastSeenAt: observedAt };
        result.riskSkipped++;
        continue;
      }
      if (seen.has(sku)) continue;
      seen.add(sku);
      if (!previous && Object.hasOwn(next.history, sku)) { result.historySkipped++; continue; }
      if (previous) result.duplicates++;
      else result.added++;
      const batchIds = [...new Set([...(previous?.batchIds || []), batch.id])];
      const incomingImageUrl = normalizeImageUrl(product.imageUrl);
      const existingImageUrl = normalizeImageUrl(previous?.imageUrl);
      if (previous && previous.lastSeenAt > observedAt) {
        next.products[sku] = { ...previous, batchIds, ...(!existingImageUrl && incomingImageUrl ? { imageUrl: incomingImageUrl } : {}) };
        continue;
      }
      next.products[sku] = {
        sku, title: String(product.name || ""), category: String(product.category || ""),
        link: scanner.canonicalProductLink(product.link), imageUrl: incomingImageUrl || existingImageUrl,
        price: String(product.price || ""),
        commissions: (product.commissions || []).join(" / "), monthlySales: String(product.monthlySales || ""),
        dimensions: String(product.dimensions || ""), weight: String(product.weight || ""),
        fulfillment: String(product.fulfillment || ""), competitor: String(product.competitor || ""),
        shippingRisk: scanner.shippingReviewLabel(product), blocked: false,
        storeName: String(saved.storeName || task.sellerKey),
        sourceMode: batch.sourceMode === "category" ? "category" : "store",
        sourceUrl: String(task.url || ""),
        batchIds,
        firstSeenAt: previous?.firstSeenAt || now, lastSeenAt: observedAt,
        status: previous?.status || "new", notes: previous?.notes || "",
        ...(previous?.manualSavedAt ? { manualSavedAt: previous.manualSavedAt } : {}),
      };
    }
    return result;
  }

  function updateProduct(state, sku, patch, now = new Date().toISOString()) {
    const next = copyPool(state);
    if (!Object.hasOwn(next.products, sku)) throw new Error("商品不存在");
    if (!Object.hasOwn(statuses, patch.status)) throw new Error("无效的处理状态");
    next.products[sku] = { ...next.products[sku], status: patch.status, notes: String(patch.notes ?? "").slice(0, 4000), manualSavedAt: now };
    return next;
  }

  function productExpectation(product) {
    return {status:product.status, notes:product.notes, blocked:product.blocked, manualSavedAt:product.manualSavedAt || ""};
  }

  // A batch is all-or-nothing. Never promote an item to reviewed through bulk editing.
  function updateProducts(state, changes, now = new Date().toISOString()) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 50) throw Error("请选择 1–50 件商品");
    const seen = new Set();
    for (const change of changes) {
      const {sku, patch, expected} = change || {};
      if (typeof sku !== "string" || !normalizeSku(sku) || !Object.hasOwn(state.products, sku)) throw Error("商品不存在");
      if (seen.has(sku)) throw Error("商品重复");
      seen.add(sku);
      const current = state.products[sku];
      if (!expected || Object.entries(productExpectation(current)).some(([k,v])=>expected[k] !== v)) throw Error("商品状态已变化，请刷新核对后重试");
      if (!patch || typeof patch.status !== "string" || !Object.hasOwn(statuses, patch.status)) throw Error("无效的处理状态");
      if (typeof patch.notes !== "string" || patch.notes.length > 4000) throw Error("备注无效或过长");
      if (patch.status === "approved" && current.status !== "approved") throw Error("请逐件核价并人工复核，不能批量标记已复核");
    }
    const next = copyPool(state);
    for (const {sku,patch} of changes) next.products[sku] = {...next.products[sku],status:patch.status,notes:patch.notes,manualSavedAt:now};
    return next;
  }

  function exportPoolCsv(state) {
    const header = ["SKU", "商品名称", "类目", "Ozon链接", "图片链接", "采集价格", "佣金", "月销量", "发货模式", "尺寸", "重量", "跟卖价", "运输复核", "处理状态", "来源店铺", "来源批次", "首次入池", "最近发现", "备注", "人工保存时间"];
    const rows = Object.values(state.products || {}).map(p => [
      p.sku, p.title, p.category, p.link, normalizeImageUrl(p.imageUrl), p.price, p.commissions, p.monthlySales, p.fulfillment,
      p.dimensions, p.weight, p.competitor, p.shippingRisk, p.blocked ? "运输待复核" : statuses[p.status],
      p.storeName, p.batchIds.join(" / "), p.firstSeenAt, p.lastSeenAt, p.notes, p.manualSavedAt || "",
    ]);
    return [header, ...rows].map(row => row.map(scanner.csvCell).join(",")).join("\r\n");
  }

  scope.OzonProductPoolCore = Object.freeze({ emptyPool, statuses, normalizeImageUrl, matchesStatus, normalizePageQuery, matchesPageQuery, comparePoolItems, importHistory, addBatch, updateProduct, updateProducts, productExpectation, exportPoolCsv });
})(globalThis);
