const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const WORKER_VERSION = "2026.07.10-p0p2";
const MAX_REQUEST_BYTES = 1024 * 1024;
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const corsHeaders = (request, env) => {
  const origin = request?.headers?.get("Origin") || "";
  const allowedOrigin = String(env.ALLOWED_ORIGIN || "").trim();
  return {
    ...(origin && origin === allowedOrigin ? {
      "Access-Control-Allow-Origin": allowedOrigin,
      Vary: "Origin",
    } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ozon-Sync-Token",
  };
};

function json(data, status = 200, request, env = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || origin === String(env.ALLOWED_ORIGIN || "").trim();
}

function isAuthorized(request, env) {
  const supplied = request.headers.get("X-Ozon-Sync-Token") || "";
  const expected = String(env.SYNC_API_TOKEN || "");
  return Boolean(expected) && supplied.length === expected.length && supplied === expected;
}

async function checkRateLimit(request, env) {
  if (!env.RATE_LIMITER?.limit) return true;
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key });
  return Boolean(result?.success);
}

async function readJsonPayload(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("请求必须使用 application/json");
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new Error("请求内容过大");
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) throw new Error("请求内容过大");
  return JSON.parse(text);
}

function safeClientError(error) {
  const message = error?.message || String(error);
  if (/Feishu API failed|Cannot get Feishu token/i.test(message)) return "飞书服务调用失败，请查看 Worker 日志";
  return message;
}

function number(value) {
  let text = String(value ?? "")
    .replace(/[¥￥₽%]/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim();
  const match = text.match(/-?[\d\s.,]+/);
  if (!match) return 0;
  text = match[0].replace(/\s+/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalMark = lastComma > lastDot ? "," : ".";
    text = text
      .replace(new RegExp(`\\${decimalMark === "," ? "." : ","}`, "g"), "")
      .replace(decimalMark, ".");
  } else if (/^-?\d{1,3}(,\d{3})+$/.test(text)) {
    text = text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = text.replace(",", ".");
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function requiredEnv(env) {
  const keys = [
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_APP_TOKEN",
    "FEISHU_BATCH_TABLE_ID",
    "FEISHU_DETAIL_TABLE_ID",
    "ALLOWED_ORIGIN",
    "SYNC_API_TOKEN",
    "SYNC_CACHE",
  ];
  return keys.filter((key) => !env[key]);
}

async function feishuRequest(path, token, init = {}) {
  const response = await fetch(`${FEISHU_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(`Feishu API failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function getTenantToken(env) {
  const response = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Cannot get Feishu token: ${response.status} ${JSON.stringify(data)}`);
  }
  return data.tenant_access_token;
}

function makeBatchId(submitter) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  const cleanName = String(submitter || "unknown").trim().replace(/\s+/g, "_").slice(0, 24);
  return `${stamp}_${cleanName}_${suffix}`;
}

function normalizePayload(payload) {
  const submitter = String(payload.submitter || "").trim();
  if (!submitter) throw new Error("请先填写提交人");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const filledRows = rows.filter((row) => row && row.filled !== false);
  if (!filledRows.length) throw new Error("没有可同步的核价明细");
  return {
    submitter,
    note: String(payload.note || "").trim(),
    rows: filledRows,
    summary: payload.summary || {},
  };
}

function batchFields(batchId, syncTime, data) {
  return {
    "批次ID": batchId,
    "同步时间": syncTime,
    "提交人": data.submitter,
    "行数": number(data.summary.filledRows ?? data.rows.length),
    "达标行数": number(data.summary.okRows),
    "总利润": number(data.summary.totalProfit),
    "平均利润率": number(data.summary.avgMargin),
    "备注": data.note,
  };
}

function detailFields(batchId, syncTime, submitter, row) {
  const fields = {
    "批次ID": batchId,
    "提交人": submitter,
    "同步时间": syncTime,
    "序号": number(row.index),
    "绿标价格": number(row.green),
    "黑标价格": number(row.black),
    "佣金": number(row.commission),
    "真实售价": number(row.trueSale),
    "定价": number(row.quote),
    "采购成本": number(row.cost),
    "国际运费": number(row.freight),
    "贴单费": number(row.labelFee),
    "平台佣金": number(row.platform),
    "利润": number(row.profit),
    "利润率": number(row.margin),
    "SKU": String(row.sku || ""),
    "货源": String(row.source || ""),
    "备注": String(row.note || ""),
  };
  const link = String(row.link || "").trim();
  if (link) fields["跟卖链接"] = link;
  return fields;
}

async function createRecord(env, token, tableId, fields) {
  return feishuRequest(`/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${tableId}/records`, token, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

async function createDetailRecords(env, token, rows) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
  for (const chunk of chunks) {
    await feishuRequest(`/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_DETAIL_TABLE_ID}/records/batch_create`, token, {
      method: "POST",
      body: JSON.stringify({ records: chunk.map((fields) => ({ fields })) }),
    });
  }
}

function getTextField(fields, name) {
  const value = fields?.[name];
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => getTextField({ x: item }, "x")).join("").trim();
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.link === "string") return value.link;
    if (typeof value.url === "string") return value.url;
    if (typeof value.value === "string") return value.value;
  }
  return "";
}

function normalizeOzonUrl(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/https?:\/\/[^\s"'<>]+/i);
  const url = match ? match[0] : raw;
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url.replace(/[，。；;]+$/, ""));
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "ozon.ru" && !host.endsWith(".ozon.ru"))) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeSkuKey(value) {
  return String(value || "").trim();
}

function normalizeLinkKey(value) {
  const normalized = normalizeOzonUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return `${url.hostname.toLowerCase()}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return normalized.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

function rowDedupeKeys(row) {
  const sku = normalizeSkuKey(row?.sku);
  const link = normalizeLinkKey(row?.link);
  return [
    sku ? `sku:${sku}` : "",
    link ? `link:${link}` : "",
  ].filter(Boolean);
}

function existingDedupeKeys(records) {
  const keys = new Set();
  records.forEach((record) => {
    const fields = record.fields || {};
    const sku = normalizeSkuKey(getTextField(fields, "SKU"));
    const link = normalizeLinkKey(getTextField(fields, "跟卖链接"));
    if (sku) keys.add(`sku:${sku}`);
    if (link) keys.add(`link:${link}`);
  });
  return keys;
}

async function cachedDedupeKeys(env, rows) {
  const keys = [...new Set(rows.flatMap(rowDedupeKeys))];
  const values = await Promise.all(keys.map(async (key) => [key, await env.SYNC_CACHE.get(`dedupe:${key}`)]));
  return new Set(values.filter(([, value]) => value).map(([key]) => key));
}

async function rememberDedupeKeys(env, rows) {
  const keys = [...new Set(rows.flatMap(rowDedupeKeys))];
  await Promise.all(keys.map((key) => env.SYNC_CACHE.put(`dedupe:${key}`, "1")));
}

async function rebuildDedupeIndex(env, token) {
  const records = await listDetailRecords(env, token, 100000);
  const keys = [...existingDedupeKeys(records)];
  for (let index = 0; index < keys.length; index += 100) {
    await Promise.all(keys.slice(index, index + 100).map((key) => env.SYNC_CACHE.put(`dedupe:${key}`, "1")));
  }
  await env.SYNC_CACHE.put("dedupe:index-ready", new Date().toISOString());
  return { scannedRows: records.length, indexedKeys: keys.length };
}

async function getCachedResponse(env, requestId) {
  if (!requestId) return null;
  const value = await env.SYNC_CACHE.get(`request:${requestId}`);
  return value ? JSON.parse(value) : null;
}

async function cacheResponse(env, requestId, data) {
  if (!requestId) return;
  await env.SYNC_CACHE.put(`request:${requestId}`, JSON.stringify(data), { expirationTtl: IDEMPOTENCY_TTL_SECONDS });
}

function filterDuplicateRows(rows, existingKeys) {
  const syncedRows = [];
  const skippedRows = [];
  rows.forEach((row, index) => {
    const keys = rowDedupeKeys(row);
    const duplicate = keys.length && keys.some((key) => existingKeys.has(key));
    if (duplicate) {
      skippedRows.push({
        index: number(row.index) || index + 1,
        sku: normalizeSkuKey(row.sku),
        link: normalizeOzonUrl(row.link),
      });
      return;
    }
    syncedRows.push(row);
    keys.forEach((key) => existingKeys.add(key));
  });
  return { syncedRows, skippedRows };
}

function summaryFromRows(rows) {
  const margins = rows.map((row) => number(row.margin));
  return {
    filledRows: rows.length,
    okRows: margins.filter((margin) => margin >= 0.18).length,
    totalProfit: rows.reduce((sum, row) => sum + number(row.profit), 0),
    avgMargin: rows.length ? margins.reduce((sum, margin) => sum + margin, 0) / rows.length : 0,
  };
}

async function listDetailRecords(env, token, limit) {
  const records = [];
  let pageToken = "";
  while (records.length < limit) {
    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);
    const data = await feishuRequest(
      `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_DETAIL_TABLE_ID}/records?${params}`,
      token,
      { method: "GET" },
    );
    records.push(...(data.data?.items || []));
    pageToken = data.data?.page_token || "";
    if (!data.data?.has_more || !pageToken) break;
  }
  return records;
}

function htmlDecode(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return htmlDecode(match[1]).trim();
  }
  return "";
}

function parsePrice(text) {
  const value = firstMatch(text, [
    /"price"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)/i,
    /"cardPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)/i,
    /([0-9][0-9\s\u00a0\u202f.,]*)\s*₽/i,
  ]);
  return value ? number(value) : 0;
}

function parseDimensions(text) {
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|мм|cm|см|毫米|厘米)?/i,
    /(?:длина|length|长)[^0-9]{0,20}(\d+(?:[.,]\d+)?)[\s\S]{0,80}(?:ширина|width|宽)[^0-9]{0,20}(\d+(?:[.,]\d+)?)[\s\S]{0,80}(?:высота|height|高)[^0-9]{0,20}(\d+(?:[.,]\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    let dims = [number(match[1]), number(match[2]), number(match[3])].filter(Boolean);
    if (dims.length !== 3) continue;
    const unit = String(match[4] || "").toLowerCase();
    if (unit.includes("mm") || unit.includes("мм") || unit.includes("毫米") || (!unit && Math.max(...dims) > 150)) {
      dims = dims.map((value) => value / 10);
    }
    dims.sort((a, b) => b - a);
    return { length: dims[0], width: dims[1], height: dims[2] };
  }
  return { length: 0, width: 0, height: 0 };
}

function parseWeight(text) {
  const match =
    text.match(/(?:вес|weight|重量)[^0-9]{0,30}(\d+(?:[.,]\d+)?)\s*(kg|кг|g|гр|г|千克|公斤|克)?/i) ||
    text.match(/(\d+(?:[.,]\d+)?)\s*(kg|кг|千克|公斤)\b/i);
  if (!match) return 0;
  const raw = number(match[1]);
  const unit = String(match[2] || "").toLowerCase();
  if (unit === "g" || unit === "гр" || unit === "г" || unit.includes("克")) return raw / 1000;
  return raw;
}

function parseSku(url, text) {
  return firstMatch(text, [
    /"sku"\s*:\s*"?(\d{5,})"?/i,
    /"id"\s*:\s*"?(\d{5,})"?/i,
  ]) || firstMatch(url, [/-(\d{5,})(?:[/?#]|$)/]);
}

async function fetchProductInfo(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
      "Accept-Language": "ru-RU,ru;q=0.9,zh-CN;q=0.8,en;q=0.7",
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`OZON page failed: HTTP ${response.status}`);
  }
  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /"name"\s*:\s*"([^"]{2,160})"/i,
  ]).replace(/\s*\|\s*Ozon.*$/i, "");
  const dims = parseDimensions(html);
  return {
    title,
    price: parsePrice(html),
    sku: parseSku(url, html),
    weight: parseWeight(html),
    ...dims,
  };
}

function enrichFields(info, status, note = "") {
  const fields = {
    "抓取状态": status,
    "抓取时间": Date.now(),
  };
  if (note) fields["抓取备注"] = note.slice(0, 500);
  if (info?.title) fields["商品标题"] = info.title.slice(0, 500);
  if (info?.price) fields["商品价格"] = number(info.price);
  if (info?.sku) fields["SKU"] = String(info.sku);
  if (info?.length) fields["长cm"] = number(info.length.toFixed(2));
  if (info?.width) fields["宽cm"] = number(info.width.toFixed(2));
  if (info?.height) fields["高cm"] = number(info.height.toFixed(2));
  if (info?.weight) fields["重量kg"] = number(info.weight.toFixed(3));
  return fields;
}

async function updateDetailRecord(env, token, recordId, fields) {
  return feishuRequest(`/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_DETAIL_TABLE_ID}/records/${recordId}`, token, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
}

async function enrichLinks(env, token, payload) {
  const limit = Math.min(Math.max(number(payload.limit) || 20, 1), 50);
  const records = await listDetailRecords(env, token, 500);
  const candidates = records
    .map((record) => {
      const fields = record.fields || {};
      const link = normalizeOzonUrl(getTextField(fields, "跟卖链接"));
      const status = getTextField(fields, "抓取状态");
      return { record, fields, link, status };
    })
    .filter((item) => item.link && item.status !== "已完成")
    .slice(0, limit);

  const results = [];
  for (const item of candidates) {
    try {
      const info = await fetchProductInfo(item.link);
      await updateDetailRecord(env, token, item.record.record_id, enrichFields(info, "已完成"));
      results.push({ ok: true, link: item.link, title: info.title, sku: info.sku });
    } catch (error) {
      const message = error.message || String(error);
      await updateDetailRecord(env, token, item.record.record_id, enrichFields(null, "失败", message));
      results.push({ ok: false, link: item.link, error: message });
    }
  }
  return {
    scannedRows: records.length,
    matchedRows: candidates.length,
    successRows: results.filter((item) => item.ok).length,
    failedRows: results.filter((item) => !item.ok).length,
    results,
  };
}

async function syncPricingRows(env, token, payload) {
  const data = normalizePayload(payload);
  const syncTime = Date.now();
  const indexReady = await env.SYNC_CACHE.get("dedupe:index-ready");
  const existingKeys = indexReady
    ? await cachedDedupeKeys(env, data.rows)
    : existingDedupeKeys(await listDetailRecords(env, token, 10000));
  const { syncedRows, skippedRows } = filterDuplicateRows(data.rows, existingKeys);

  if (!syncedRows.length) {
    return {
      batchId: "",
      syncedRows: 0,
      skippedRows: skippedRows.length,
      duplicateRows: skippedRows.slice(0, 20),
      syncTime,
    };
  }

  const batchId = makeBatchId(data.submitter);
  const syncedData = {
    ...data,
    rows: syncedRows,
    summary: summaryFromRows(syncedRows),
    note: [data.note, skippedRows.length ? `本次跳过重复 ${skippedRows.length} 行` : ""].filter(Boolean).join("；"),
  };

  await createRecord(env, token, env.FEISHU_BATCH_TABLE_ID, batchFields(batchId, syncTime, syncedData));
  await createDetailRecords(env, token, syncedRows.map((row) => detailFields(batchId, syncTime, data.submitter, row)));
  await rememberDedupeKeys(env, syncedRows);

  return {
    batchId,
    syncedRows: syncedRows.length,
    skippedRows: skippedRows.length,
    duplicateRows: skippedRows.slice(0, 20),
    syncTime,
  };
}

function compactText(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function erpProductFields(batchId, syncTime, submitter, product, index, includeExtraFields = true) {
  const rawText = compactText(product.rawText, 1800);
  const fields = {
    "批次ID": batchId,
    "提交人": submitter,
    "同步时间": syncTime,
    "序号": index + 1,
    "SKU": String(product.sku || ""),
    "跟卖链接": String(product.link || ""),
    "货源": "毛子ERP插件采集",
    "备注": [
      product.title ? `标题：${product.title}` : "",
      product.priceRub ? `页面价格：${product.priceRub}卢布` : "",
      product.commissionText ? `rFBS佣金：${product.commissionText}` : "",
      product.monthSales ? `月销量：${product.monthSales}` : "",
      product.fulfillment ? `发货模式：${product.fulfillment}` : "",
      product.dimensionsText ? `长宽高：${product.dimensionsText}` : "",
      product.weightText ? `重量：${product.weightText}` : "",
      product.listingDate ? `上架时间：${product.listingDate}` : "",
      product.competitorText ? `跟卖列表：${product.competitorText}` : "",
      product.minCompetitorPrice ? `跟卖最低价：${product.minCompetitorPrice}` : "",
      rawText ? `原文：${rawText}` : "",
    ].filter(Boolean).join("\n").slice(0, 5000),
  };

  if (!includeExtraFields) return fields;

  return {
    ...fields,
    "ERP标签": String(product.tag || "符合要求"),
    "商品标题": String(product.title || ""),
    "商品价格": number(product.priceRub),
    "rFBS佣金": String(product.commissionText || ""),
    "月销量": number(product.monthSales),
    "发货模式": String(product.fulfillment || ""),
    "长cm": number(product.lengthCm),
    "宽cm": number(product.widthCm),
    "高cm": number(product.heightCm),
    "重量kg": number(product.weightKg),
    "上架时间": String(product.listingDate || ""),
    "跟卖最低价": number(product.minCompetitorPrice),
    "跟卖卖家数": number(product.competitorCount),
    "采集原文": rawText,
  };
}

async function collectErpProducts(env, token, payload) {
  const submitter = String(payload.submitter || "").trim();
  if (!submitter) throw new Error("请先填写提交人");
  const products = Array.isArray(payload.products) ? payload.products : [];
  if (!products.length) throw new Error("没有采集到带“符合要求”标签的商品");

  const batchId = makeBatchId(submitter);
  const syncTime = Date.now();
  const note = String(payload.note || "OZON页面ERP插件采集").trim();
  await createRecord(env, token, env.FEISHU_BATCH_TABLE_ID, batchFields(batchId, syncTime, {
    submitter,
    note,
    rows: products,
    summary: {
      filledRows: products.length,
      okRows: products.length,
      totalProfit: 0,
      avgMargin: 0,
    },
  }));

  const fullRows = products.map((product, index) => erpProductFields(batchId, syncTime, submitter, product, index, true));
  try {
    await createDetailRecords(env, token, fullRows);
    return { batchId, syncedRows: products.length, syncTime, mode: "full" };
  } catch (error) {
    const safeRows = products.map((product, index) => erpProductFields(batchId, syncTime, submitter, product, index, false));
    await createDetailRecords(env, token, safeRows);
    return {
      batchId,
      syncedRows: products.length,
      syncTime,
      mode: "safe",
      warning: `扩展字段未完全写入，已改写到备注。原错误：${error.message || String(error)}`,
    };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return json({ ok: true, service: "ozon-feishu-sync", version: WORKER_VERSION }, 200, request, env);
    }
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(request, env)) return json({ ok: false, error: "Origin is not allowed" }, 403, request, env);
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "Only POST is supported" }, 405, request, env);
    }
    const missing = requiredEnv(env);
    if (missing.length) {
      return json({ ok: false, error: `Missing env: ${missing.join(", ")}` }, 500, request, env);
    }
    if (!isAllowedOrigin(request, env)) return json({ ok: false, error: "Origin is not allowed" }, 403, request, env);
    if (!isAuthorized(request, env)) return json({ ok: false, error: "同步令牌无效" }, 401, request, env);
    if (!await checkRateLimit(request, env)) return json({ ok: false, error: "请求过于频繁，请稍后重试" }, 429, request, env);

    try {
      const payload = await readJsonPayload(request);
      const requestId = String(payload.requestId || "").trim();
      if (!/^[A-Za-z0-9_-]{12,100}$/.test(requestId)) throw new Error("缺少有效的请求 ID");
      const cached = await getCachedResponse(env, requestId);
      if (cached) return json({ ok: true, cached: true, ...cached }, 200, request, env);
      const token = await getTenantToken(env);
      const action = String(payload.action || "sync");
      if (!["sync", "enrichLinks", "collectErpProducts", "rebuildDedupeIndex"].includes(action)) {
        throw new Error("不支持的操作");
      }
      const data = action === "enrichLinks"
        ? await enrichLinks(env, token, payload)
        : action === "collectErpProducts"
          ? await collectErpProducts(env, token, payload)
          : action === "rebuildDedupeIndex"
            ? await rebuildDedupeIndex(env, token)
            : await syncPricingRows(env, token, payload);
      const result = { action, version: WORKER_VERSION, ...data };
      await cacheResponse(env, requestId, result);
      return json({ ok: true, ...result }, 200, request, env);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: safeClientError(error), version: WORKER_VERSION }, 400, request, env);
    }
  },
};

export { normalizeOzonUrl };
