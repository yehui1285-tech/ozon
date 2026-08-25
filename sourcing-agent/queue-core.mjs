function clean(value) {
  return String(value ?? "").replace(/\u00a0|\u202f/g, " ").replace(/\s+/g, " ").trim();
}

function number(value) {
  let text = clean(value).replace(/[¥￥₽%]/g, "");
  const match = text.match(/-?[\d\s.,]+/);
  if (!match) return null;
  text = match[0].replace(/\s+/g, "");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    text = text.replace(new RegExp(`\\${decimal === "," ? "." : ","}`, "g"), "").replace(decimal, ".");
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitMarkdownRow(line) {
  const value = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      current += character;
      escaped = true;
    } else if (character === "|") {
      cells.push(clean(current.replace(/\\\|/g, "|")));
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(clean(current.replace(/\\\|/g, "|")));
  return cells;
}

function markdownLink(value) {
  const text = clean(value);
  const match = text.match(/^\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/i);
  return match ? { label: clean(match[1]), url: match[2] } : { label: text, url: "" };
}

function dimensions(value) {
  const values = [...clean(value).matchAll(/(\d+(?:[.,]\d+)?)/g)].map((match) => number(match[1])).filter((entry) => entry !== null);
  return values.length >= 3 ? { lengthMm: values[0], widthMm: values[1], heightMm: values[2] } : { lengthMm: null, widthMm: null, heightMm: null };
}

function weightGrams(value) {
  const amount = number(value);
  if (amount === null) return null;
  return /kg|кг/i.test(clean(value)) ? amount * 1000 : amount;
}

function canonicalProductUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "www.ozon.ru" || !url.pathname.startsWith("/product/")) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function metadataValue(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clean(String(markdown || "").match(new RegExp(`^-\\s*${escaped}：(.+)$`, "m"))?.[1]);
}

function selectedCommission(effectiveGreenPrice, commissions) {
  const price = Number(effectiveGreenPrice);
  if (!(price > 0)) return null;
  const tierIndex = price <= 600 ? 1 : 2;
  return Number.isFinite(commissions[tierIndex]) ? commissions[tierIndex] : null;
}

function taskFromCells(headers, cells, batch, createdAt) {
  const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  const sku = clean(row.SKU);
  const productLink = markdownLink(row["商品链接"]);
  const productUrl = canonicalProductUrl(productLink.url);
  if (!/^\d+$/.test(sku) || !productUrl) return null;
  const storeLink = markdownLink(row["店铺"]);
  const pagePrice = number(row["价格"]);
  const competitorPrice = /无|^-$/i.test(clean(row["跟卖最低价"])) ? null : number(row["跟卖最低价"]);
  const effectiveGreenPrice = [pagePrice, competitorPrice].filter((entry) => Number(entry) > 0).sort((a, b) => a - b)[0] ?? null;
  const commissions = [...clean(row["rFBS 佣金"]).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((match) => number(match[1])).filter((entry) => entry !== null);
  const size = dimensions(row["长宽高"]);
  return {
    taskId: `ozon-${sku}`,
    status: "pending_ozon_enrichment",
    source: {
      batchId: batch.batchId,
      exportedAt: batch.exportedAt,
      batchStatus: batch.status,
      storeIndex: number(row["店铺序号"]),
      storeName: storeLink.label,
      storeUrl: storeLink.url,
      storeStatus: clean(row["状态"]),
      productIndex: number(row["商品序号"]),
    },
    ozon: {
      sku,
      name: clean(row["商品名称"]),
      productUrl,
      pagePrice,
      competitorPrice,
      effectiveGreenPrice,
      commissions,
      selectedCommission: selectedCommission(effectiveGreenPrice, commissions),
      monthlySales: number(row["月销量"]),
      fulfillment: clean(row["发货模式"]),
      ...size,
      weightG: weightGrams(row["重量"]),
    },
    enrichment: {
      status: "pending",
      mainImageUrl: null,
      originalBlackPrice: null,
      blackPriceSourceUrl: null,
      internationalFreight: null,
      freightRoute: null,
      maxPurchaseCostAt18Pct: null,
    },
    sourcing: {
      platform: "pinduoduo",
      status: "pending",
      candidates: [],
      selectedCandidate: null,
      judgeProvider: null,
      judgeResult: null,
    },
    pricing: {
      purchaseCost: null,
      sourceUrl: null,
      profit: null,
      profitMargin: null,
      eligibleAt18Pct: null,
    },
    audit: {
      createdAt,
      updatedAt: createdAt,
    },
  };
}

export function parseBatchMarkdown(markdown, { createdAt = new Date().toISOString() } = {}) {
  const text = String(markdown || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|\s*店铺序号\s*\|/.test(line));
  if (headerIndex < 0) throw new Error("没有找到批量扫描商品表格。");
  const headers = splitMarkdownRow(lines[headerIndex]);
  const required = ["店铺序号", "店铺", "状态", "商品序号", "商品名称", "SKU", "价格", "rFBS 佣金", "月销量", "发货模式", "长宽高", "重量", "跟卖最低价", "商品链接"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`批量扫描表格缺少字段：${missing.join("、")}`);
  const batch = {
    batchId: metadataValue(text, "批次编号"),
    exportedAt: metadataValue(text, "导出时间"),
    status: metadataValue(text, "批次状态"),
    declaredStoreCount: number(metadataValue(text, "店铺数量")),
    declaredProductCount: number(metadataValue(text, "符合要求商品")),
  };
  const tasks = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("|")) break;
    const task = taskFromCells(headers, splitMarkdownRow(line), batch, createdAt);
    if (task) tasks.push(task);
  }
  return {
    schemaVersion: 1,
    generatedAt: createdAt,
    batch,
    summary: {
      parsedProductCount: tasks.length,
      storeCount: new Set(tasks.map((task) => task.source.storeUrl || task.source.storeName)).size,
      pendingEnrichmentCount: tasks.length,
    },
    tasks,
  };
}

export function selectRepresentativeTasks(tasks, limit = 10) {
  const remaining = [...(Array.isArray(tasks) ? tasks : [])];
  const selected = [];
  const usedNames = new Set();
  const usedStores = new Map();
  while (remaining.length && selected.length < Math.max(0, Number(limit) || 0)) {
    remaining.sort((a, b) => {
      const aNamePenalty = usedNames.has(a.ozon.name) ? 1 : 0;
      const bNamePenalty = usedNames.has(b.ozon.name) ? 1 : 0;
      if (aNamePenalty !== bNamePenalty) return aNamePenalty - bNamePenalty;
      const aStoreCount = usedStores.get(a.source.storeName) || 0;
      const bStoreCount = usedStores.get(b.source.storeName) || 0;
      if (aStoreCount !== bStoreCount) return aStoreCount - bStoreCount;
      return Number(a.source.storeIndex || 0) - Number(b.source.storeIndex || 0) || Number(a.source.productIndex || 0) - Number(b.source.productIndex || 0);
    });
    const task = remaining.shift();
    selected.push(task);
    usedNames.add(task.ozon.name);
    usedStores.set(task.source.storeName, (usedStores.get(task.source.storeName) || 0) + 1);
  }
  return selected;
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildQueueCsv(tasks) {
  const header = ["任务ID", "状态", "店铺", "SKU", "商品名称", "页面价格", "跟卖最低价", "最终绿标价", "采用佣金", "月销量", "发货模式", "长mm", "宽mm", "高mm", "重量g", "商品链接", "详情补全状态", "拼多多找品状态", "采购成本", "利润率", "是否达到18%"];
  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => [
    task.taskId, task.status, task.source.storeName, task.ozon.sku, task.ozon.name, task.ozon.pagePrice, task.ozon.competitorPrice,
    task.ozon.effectiveGreenPrice, task.ozon.selectedCommission, task.ozon.monthlySales, task.ozon.fulfillment,
    task.ozon.lengthMm, task.ozon.widthMm, task.ozon.heightMm, task.ozon.weightG, task.ozon.productUrl,
    task.enrichment.status, task.sourcing.status, task.pricing.purchaseCost, task.pricing.profitMargin, task.pricing.eligibleAt18Pct,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
