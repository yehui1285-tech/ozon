(function (scope) {
  "use strict";
  const scanner = scope.OzonStoreScannerCore;
  const statuses = Object.freeze({ new: "待找品", sourcing: "找品中", review: "待复核", approved: "人工已复核", rejected: "淘汰" });
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
      if (previous && previous.lastSeenAt > observedAt) {
        next.products[sku] = { ...previous, batchIds };
        continue;
      }
      next.products[sku] = {
        sku, title: String(product.name || ""), category: String(product.category || ""),
        link: scanner.canonicalProductLink(product.link), price: String(product.price || ""),
        commissions: (product.commissions || []).join(" / "), monthlySales: String(product.monthlySales || ""),
        dimensions: String(product.dimensions || ""), weight: String(product.weight || ""),
        fulfillment: String(product.fulfillment || ""), competitor: String(product.competitor || ""),
        shippingRisk: scanner.shippingReviewLabel(product), blocked: false,
        storeName: String(saved.storeName || task.sellerKey),
        batchIds,
        firstSeenAt: previous?.firstSeenAt || now, lastSeenAt: observedAt,
        status: previous?.status || "new", notes: previous?.notes || "",
      };
    }
    return result;
  }

  function updateProduct(state, sku, patch) {
    const next = copyPool(state);
    if (!Object.hasOwn(next.products, sku)) throw new Error("商品不存在");
    if (!Object.hasOwn(statuses, patch.status)) throw new Error("无效的处理状态");
    next.products[sku] = { ...next.products[sku], status: patch.status, notes: String(patch.notes ?? "").slice(0, 4000) };
    return next;
  }

  function exportPoolCsv(state) {
    const header = ["SKU", "商品名称", "类目", "Ozon链接", "采集价格", "佣金", "月销量", "发货模式", "尺寸", "重量", "跟卖价", "运输复核", "处理状态", "来源店铺", "来源批次", "首次入池", "最近发现", "备注"];
    const rows = Object.values(state.products || {}).map(p => [
      p.sku, p.title, p.category, p.link, p.price, p.commissions, p.monthlySales, p.fulfillment,
      p.dimensions, p.weight, p.competitor, p.shippingRisk, p.blocked ? "运输待复核" : statuses[p.status],
      p.storeName, p.batchIds.join(" / "), p.firstSeenAt, p.lastSeenAt, p.notes,
    ]);
    return [header, ...rows].map(row => row.map(scanner.csvCell).join(",")).join("\r\n");
  }

  scope.OzonProductPoolCore = Object.freeze({ emptyPool, statuses, importHistory, addBatch, updateProduct, exportPoolCsv });
})(globalThis);
