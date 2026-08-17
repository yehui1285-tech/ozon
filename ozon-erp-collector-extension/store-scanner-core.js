(function installOzonStoreScannerCore(globalScope) {
  function cleanText(value) {
    return String(value ?? "").replace(/\r/g, "").trim();
  }

  function createSerializedExecutor() {
    let queue = Promise.resolve();
    return (operation) => {
      const result = queue.then(operation, operation);
      queue = result.catch(() => null);
      return result;
    };
  }

  function firstMatch(text, pattern) {
    return cleanText(text).match(pattern)?.[1]?.trim() || "";
  }

  function competitorState(rawText) {
    const text = cleanText(rawText);
    const hasLabel = /跟卖最低价\s*[:：]?/.test(text);
    if (!hasLabel) return { value: "", ready: false };
    const numeric = text.match(/跟卖最低价\s*[:：]?\s*([¥￥₽]?[ \t]*[0-9][0-9 \t\u00a0\u202f.,]*)/);
    if (numeric?.[1]) return { value: numeric[1].trim(), ready: true };
    const empty = text.match(/跟卖最低价\s*[:：]?\s*(无|暂无|没有跟卖|--|—|-)(?=\s|$)/);
    if (empty?.[1]) return { value: empty[1], ready: true };
    return { value: "", ready: false };
  }

  function sellerKeyFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname.match(/^\/seller\/([^/]+)/i)?.[1] || "";
    } catch {
      return "";
    }
  }

  function normalizeSellerUrl(value) {
    const input = cleanText(value).replace(/^<|>$/g, "");
    if (!input) return "";
    try {
      const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      if (!/(^|\.)ozon\.ru$/i.test(parsed.hostname)) return "";
      const sellerKey = sellerKeyFromUrl(parsed.href);
      return sellerKey ? `https://www.ozon.ru/seller/${sellerKey}/` : "";
    } catch {
      return "";
    }
  }

  function parseStoreUrlList(rawText, maxStores = 50) {
    const urls = [];
    const invalid = [];
    const seen = new Set();
    let duplicateCount = 0;
    let overflowCount = 0;
    const limit = Math.max(1, Number(maxStores) || 50);
    cleanText(rawText).split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const url = normalizeSellerUrl(line);
      if (!url) {
        invalid.push(line);
        return;
      }
      const key = sellerKeyFromUrl(url);
      if (seen.has(key)) {
        duplicateCount += 1;
        return;
      }
      seen.add(key);
      if (urls.length >= limit) {
        overflowCount += 1;
        return;
      }
      urls.push(url);
    });
    return { urls, invalid, duplicateCount, overflowCount };
  }

  function canonicalProductLink(link) {
    try {
      const parsed = new URL(link);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return cleanText(link).split("?")[0];
    }
  }

  function parseCardText(rawText) {
    const text = cleanText(rawText);
    const commissionSection = text.match(/rFBS佣金：([\s\S]*?)SKU：/)?.[1] || "";
    const competitor = competitorState(text);
    return {
      qualified: /(?:^|\n)[ \t]*符合要求[ \t]*(?:\n|$)/.test(text),
      sku: firstMatch(text, /SKU：\s*(\d+)/),
      price: firstMatch(text, /(\d[\d\s\u00a0\u202f]*[,.]\d{2})\s*¥/),
      commissions: [...commissionSection.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((match) => `${match[1]}%`).slice(0, 3),
      monthlySales: firstMatch(text, /月销量：\s*([^\n]+)/),
      fulfillment: firstMatch(text, /发货模式：\s*([^\n]+)/),
      dimensions: firstMatch(text, /长\s*宽\s*高：\s*([^\n]+)/),
      weight: firstMatch(text, /重\s*量：\s*([^\n]+)/),
      listedAt: firstMatch(text, /上架时间：\s*([^\n]+)/),
      competitor: competitor.value,
      competitorReady: competitor.ready,
    };
  }

  function markdownCell(value) {
    const text = cleanText(value).replace(/\n+/g, " ").replace(/\|/g, "\\|");
    return text || "-";
  }

  function safeFilePart(value) {
    return cleanText(value).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60) || "Ozon店铺";
  }

  function csvCell(value) {
    let text = cleanText(value).replace(/\n+/g, " ");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function batchStoreState(stores, sellerKey) {
    return stores?.[sellerKey] || { products: {} };
  }

  function storeResultStorageKey(sellerKey) {
    const key = cleanText(sellerKey);
    return key ? `ozonStoreQualifiedProductsV2:${encodeURIComponent(key)}` : "";
  }

  function mergeStoreState(existing = {}, incoming = {}) {
    const previousProducts = existing?.products || {};
    const incomingProducts = incoming?.products || {};
    const products = { ...previousProducts };
    Object.entries(incomingProducts).forEach(([sku, product]) => {
      const previous = previousProducts[sku] || {};
      const next = { ...previous, ...product };
      if (!product?.competitor && previous.competitor) {
        next.competitor = previous.competitor;
        next.competitorReady = previous.competitorReady;
      }
      products[sku] = next;
    });
    const observedSkus = [...new Set([...(existing?.observedSkus || []), ...(incoming?.observedSkus || [])].map(String).filter(Boolean))];
    return {
      ...existing,
      ...incoming,
      observedCount: observedSkus.length || Math.max(Number(existing?.observedCount) || 0, Number(incoming?.observedCount) || 0),
      observedSkus,
      pendingLinks: [...new Set((incoming?.pendingLinks || []).map(canonicalProductLink).filter(Boolean))],
      products,
    };
  }

  function mergeAttemptObservedSkus(existing = [], incoming = []) {
    return [...new Set([...existing, ...incoming].map(String).filter(Boolean))];
  }

  function batchProductRows(batch, stores) {
    const rows = [];
    (batch?.stores || []).forEach((task, storeIndex) => {
      const saved = batchStoreState(stores, task.sellerKey);
      const products = Object.values(saved.products || {}).sort((a, b) => String(a.sku || "").localeCompare(String(b.sku || ""), "zh-CN", { numeric: true }));
      if (!products.length) {
        rows.push({ task, saved, storeIndex, productIndex: -1, product: null });
        return;
      }
      products.forEach((product, productIndex) => rows.push({ task, saved, storeIndex, productIndex, product }));
    });
    return rows;
  }

  function batchStatusLabel(status) {
    return ({ pending: "等待中", loading: "正在打开", recovering: "刷新后恢复中", scanning: "扫描中", retrying: "等待重试", completed: "已完成", partial: "部分完成", failed: "失败", skipped: "已跳过", running: "运行中", paused: "已暂停", stopped: "已停止" })[status] || cleanText(status) || "等待中";
  }

  function buildBatchMarkdown({ batch, stores = {}, exportedAt }) {
    const tasks = batch?.stores || [];
    const productCount = tasks.reduce((sum, task) => sum + Object.keys(batchStoreState(stores, task.sellerKey).products || {}).length, 0);
    const lines = [
      "# Ozon 批量店铺“符合要求”商品清单", "",
      `- 批次编号：${markdownCell(batch?.id)}`,
      `- 导出时间：${cleanText(exportedAt)}`,
      `- 店铺数量：${tasks.length} 个`,
      `- 符合要求商品：${productCount} 个`,
      `- 批次状态：${batchStatusLabel(batch?.status)}`, "",
      "| 店铺序号 | 店铺 | 状态 | 商品序号 | 商品名称 | SKU | 价格 | rFBS 佣金 | 月销量 | 发货模式 | 长宽高 | 重量 | 跟卖最低价 | 商品链接 |",
      "| ---: | --- | --- | ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | ---: | --- |",
    ];
    batchProductRows(batch, stores).forEach(({ task, saved, storeIndex, productIndex, product }) => {
      const storeLink = `[${markdownCell(saved.storeName || task.sellerKey)}](${task.url})`;
      if (!product) {
        lines.push(`| ${storeIndex + 1} | ${storeLink} | ${batchStatusLabel(task.status)} | - | 暂无符合要求的商品 | - | - | - | - | - | - | - | - | - |`);
        return;
      }
      lines.push(`| ${storeIndex + 1} | ${storeLink} | ${batchStatusLabel(task.status)} | ${productIndex + 1} | ${markdownCell(product.name)} | ${markdownCell(product.sku)} | ${markdownCell(product.price)} | ${markdownCell((product.commissions || []).join(" / "))} | ${markdownCell(product.monthlySales)} | ${markdownCell(product.fulfillment)} | ${markdownCell(product.dimensions)} | ${markdownCell(product.weight)} | ${markdownCell(product.competitor)} | [打开商品](${canonicalProductLink(product.link)}) |`);
    });
    lines.push("", "> 按批量任务中的店铺顺序汇总；只收录毛子 ERP 明确显示“符合要求”的商品。", "");
    return lines.join("\n");
  }

  function buildBatchCsv({ batch, stores = {} }) {
    const header = ["店铺序号", "店铺名称", "店铺地址", "扫描状态", "商品序号", "商品名称", "SKU", "价格", "rFBS佣金", "月销量", "发货模式", "长宽高", "重量", "跟卖最低价", "商品链接"];
    const lines = [header.map(csvCell).join(",")];
    batchProductRows(batch, stores).forEach(({ task, saved, storeIndex, productIndex, product }) => {
      const row = [storeIndex + 1, saved.storeName || task.sellerKey, task.url, batchStatusLabel(task.status), product ? productIndex + 1 : "", product?.name || "", product?.sku || "", product?.price || "", (product?.commissions || []).join(" / "), product?.monthlySales || "", product?.fulfillment || "", product?.dimensions || "", product?.weight || "", product?.competitor || "", product ? canonicalProductLink(product.link) : ""];
      lines.push(row.map(csvCell).join(","));
    });
    return lines.join("\r\n");
  }

  function assessViewportReadiness(visibleLinks = [], loadedByLink = new Map()) {
    const loaded = loadedByLink instanceof Map ? loadedByLink : new Map(Object.entries(loadedByLink || {}));
    const links = [...new Set(visibleLinks.map(canonicalProductLink).filter(Boolean))].sort();
    const missingLinks = links.filter((link) => !loaded.has(link) || loaded.get(link)?.ready === false);
    const signature = links.map((link) => `${link}=${loaded.has(link) ? JSON.stringify(loaded.get(link)) : "pending"}`).join("|");
    return {
      visibleCount: links.length,
      loadedCount: links.length - missingLinks.length,
      missingLinks,
      signature,
    };
  }

  function shouldAutoSkipStore(observedCount, qualifiedCount, observedThreshold = 1000, qualifiedLimit = 3) {
    return Number(observedCount) >= Number(observedThreshold) && Number(qualifiedCount) < Number(qualifiedLimit);
  }

  function autoSkipDisposition(observedCount, qualifiedCount, zeroMatchThreshold = 500, lowYieldThreshold = 1000, lowYieldLimit = 3) {
    const observed = Math.max(0, Number(observedCount) || 0);
    const qualified = Math.max(0, Number(qualifiedCount) || 0);
    if (observed >= Number(zeroMatchThreshold) && qualified === 0) {
      return { code: "zero-match-500", observedThreshold: Number(zeroMatchThreshold), qualifiedLimit: 1 };
    }
    if (observed >= Number(lowYieldThreshold) && qualified < Number(lowYieldLimit)) {
      return { code: "low-yield-1000", observedThreshold: Number(lowYieldThreshold), qualifiedLimit: Number(lowYieldLimit) };
    }
    return null;
  }

  function classifyStoreFinish({ reviewing = false, forwardReachedBoundary = false, pendingCount = 0 } = {}) {
    const pending = Math.max(0, Number(pendingCount) || 0);
    if (reviewing && forwardReachedBoundary && pending === 0) {
      return { status: "completed", complete: true, note: "已完成（省略剩余反向复查）" };
    }
    if (pending > 0) {
      return { status: "partial", complete: false, note: `部分完成：仍有${pending}个商品待复查` };
    }
    return { status: "skipped", complete: false, note: "提前结束当前店（保留已找到商品）" };
  }

  function removeBatchStoreTask(batch, sellerKey) {
    if (!batch || !Array.isArray(batch.stores)) return { removed: null, index: -1, wasCurrent: false };
    const index = batch.stores.findIndex((task) => task.sellerKey === sellerKey);
    if (index < 0) return { removed: null, index: -1, wasCurrent: false };
    const wasCurrent = index === batch.currentIndex;
    const [removed] = batch.stores.splice(index, 1);
    if (index < batch.currentIndex) batch.currentIndex -= 1;
    else if (wasCurrent) batch.currentIndex = Math.min(index, batch.stores.length);
    return { removed, index, wasCurrent };
  }

  function buildMarkdown({ storeName, storeUrl, exportedAt, products = [], observedCount = 0, scanComplete = false }) {
    const sorted = [...products].sort((a, b) => String(a.sku || "").localeCompare(String(b.sku || ""), "zh-CN", { numeric: true }));
    const lines = [
      `# ${cleanText(storeName) || "Ozon 店铺"}“符合要求”商品清单`,
      "",
      `- 店铺地址：<${cleanText(storeUrl)}>`,
      `- 导出时间：${cleanText(exportedAt)}`,
      `- 已识别店铺商品：${Number(observedCount) || 0} 个`,
      `- 符合要求：${sorted.length} 个`,
      `- 扫描状态：${scanComplete ? "已到达店铺商品末尾" : "阶段性结果，扫描尚未确认完成"}`,
      "",
      "| 序号 | 商品名称 | SKU | 价格 | rFBS 佣金 | 月销量 | 发货模式 | 长宽高 | 重量 | 跟卖最低价 | 商品链接 |",
      "| ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | ---: | --- |",
    ];
    if (!sorted.length) {
      lines.push("| - | 暂无符合要求的商品 | - | - | - | - | - | - | - | - | - |");
    } else {
      sorted.forEach((product, index) => {
        lines.push(`| ${index + 1} | ${markdownCell(product.name)} | ${markdownCell(product.sku)} | ${markdownCell(product.price)} | ${markdownCell((product.commissions || []).join(" / "))} | ${markdownCell(product.monthlySales)} | ${markdownCell(product.fulfillment)} | ${markdownCell(product.dimensions)} | ${markdownCell(product.weight)} | ${markdownCell(product.competitor)} | [打开商品](${canonicalProductLink(product.link)}) |`);
      });
    }
    lines.push("", "> 只收录毛子 ERP 商品卡片中明确显示“符合要求”标签的商品；“您可能喜欢”区域不计入店铺结果。", "");
    return lines.join("\n");
  }

  globalScope.OzonStoreScannerCore = Object.freeze({
    assessViewportReadiness,
    autoSkipDisposition,
    buildBatchCsv,
    buildBatchMarkdown,
    buildMarkdown,
    canonicalProductLink,
    classifyStoreFinish,
    cleanText,
    competitorState,
    createSerializedExecutor,
    csvCell,
    markdownCell,
    parseCardText,
    parseStoreUrlList,
    removeBatchStoreTask,
    safeFilePart,
    sellerKeyFromUrl,
    storeResultStorageKey,
    mergeAttemptObservedSkus,
    mergeStoreState,
    shouldAutoSkipStore,
    normalizeSellerUrl,
  });
})(globalThis);
