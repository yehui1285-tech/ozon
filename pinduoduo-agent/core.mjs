export const PINDUODUO_PACKAGE = "com.xunmeng.pinduoduo";

export function clean(value) {
  return String(value ?? "").trim();
}

export function parseMumuInfo(output) {
  try {
    const parsed = JSON.parse(clean(output));
    return {
      index: clean(parsed.index || "0"),
      name: clean(parsed.name || "MuMu安卓设备"),
      androidVersion: clean(parsed.android_version),
      processStarted: Boolean(parsed.is_process_started),
      androidStarted: Boolean(parsed.is_android_started),
      errorCode: Number(parsed.error_code) || 0,
    };
  } catch {
    return { index: "0", name: "MuMu安卓设备", androidVersion: "", processStarted: false, androidStarted: false, errorCode: -1 };
  }
}

export function isTrustedOzonImageUrl(rawUrl) {
  try {
    const url = new URL(clean(rawUrl));
    const hostname = url.hostname.toLowerCase();
    const trustedHost = hostname === "ozone.ru" || hostname.endsWith(".ozone.ru") || hostname === "ozon.ru" || hostname.endsWith(".ozon.ru");
    return url.protocol === "https:" && trustedHost && /^\/s3\/multimedia-/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function taskReadiness(task = {}) {
  const reasons = [];
  if (!["pending_pinduoduo_search", "pending_human_review"].includes(clean(task.status))) reasons.push("任务尚未完成Ozon详情补全");
  if (!/^\d+$/.test(clean(task?.ozon?.sku))) reasons.push("缺少有效Ozon SKU");
  if (!isTrustedOzonImageUrl(task?.enrichment?.mainImageUrl)) reasons.push("缺少可信Ozon主图");
  if (!(Number(task?.enrichment?.maxPurchaseCostAt18Pct) >= 0)) reasons.push("缺少18%最高采购成本");
  return { ready: reasons.length === 0, reasons };
}

export function queueStats(queue = {}) {
  const tasks = Array.isArray(queue.tasks) ? queue.tasks : [];
  const ready = tasks.filter((task) => taskReadiness(task).ready);
  return {
    total: tasks.length,
    ready: ready.length,
    blocked: tasks.length - ready.length,
    priced: tasks.filter((task) => Number(task?.pricing?.purchaseCost) > 0).length,
    eligible: tasks.filter((task) => task?.pricing?.eligibleAt18Pct === true).length,
  };
}

export function normalizeCandidate(candidate = {}) {
  const purchaseCost = Number(candidate.purchaseCost);
  let sourceUrl = clean(candidate.sourceUrl);
  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/.test(parsed.protocol)) sourceUrl = "";
  } catch {
    sourceUrl = "";
  }
  return {
    platform: "pinduoduo",
    title: clean(candidate.title),
    purchaseCost: Number.isFinite(purchaseCost) && purchaseCost > 0 ? Number(purchaseCost.toFixed(2)) : null,
    sourceUrl,
    imageUrl: clean(candidate.imageUrl),
    matchStatus: clean(candidate.matchStatus) || "pending_human_review",
    capturedAt: clean(candidate.capturedAt) || new Date().toISOString(),
  };
}

export function applySelectedCandidate(task, rawCandidate, { updatedAt = new Date().toISOString() } = {}) {
  const candidate = normalizeCandidate(rawCandidate);
  if (!(candidate.purchaseCost > 0)) throw new Error("采购价必须大于0。");
  const limit = Number(task?.enrichment?.maxPurchaseCostAt18Pct);
  if (!(limit >= 0)) throw new Error("任务缺少18%最高采购成本。");
  task.sourcing = task.sourcing && typeof task.sourcing === "object" ? task.sourcing : {};
  task.pricing = task.pricing && typeof task.pricing === "object" ? task.pricing : {};
  task.audit = task.audit && typeof task.audit === "object" ? task.audit : {};
  const candidates = Array.isArray(task.sourcing.candidates) ? task.sourcing.candidates : [];
  const nextCandidates = [...candidates.filter((entry) => !(entry.sourceUrl && entry.sourceUrl === candidate.sourceUrl)), candidate];
  const eligibleAt18Pct = candidate.purchaseCost <= limit;
  Object.assign(task.sourcing, {
    platform: "pinduoduo",
    status: "pending_human_review",
    candidates: nextCandidates,
    selectedCandidate: candidate,
    judgeProvider: null,
    judgeResult: null,
  });
  Object.assign(task.pricing, {
    purchaseCost: candidate.purchaseCost,
    sourceUrl: candidate.sourceUrl || null,
    eligibleAt18Pct,
  });
  task.status = "pending_human_review";
  task.audit.updatedAt = updatedAt;
  return { task, candidate, maxPurchaseCostAt18Pct: limit, eligibleAt18Pct };
}

export function safeTaskFileName(taskId) {
  return clean(taskId).replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "ozon-task";
}

function decodeXml(value) {
  return clean(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseUiNodes(xml) {
  return [...String(xml || "").matchAll(/<node\s+([^>]+?)\/?\s*>/g)].map((match) => {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((entry) => [entry[1], decodeXml(entry[2])]));
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attributes.bounds || "");
    return {
      text: attributes.text || "",
      description: attributes["content-desc"] || "",
      resourceId: attributes["resource-id"] || "",
      className: attributes.class || "",
      clickable: attributes.clickable === "true",
      bounds: bounds ? bounds.slice(1).map(Number) : null,
    };
  }).filter((node) => node.text || node.description || node.resourceId || node.clickable);
}

export function findUiNode(nodes, terms) {
  const wanted = (Array.isArray(terms) ? terms : [terms]).map(clean).filter(Boolean);
  const candidates = (nodes || []).filter((node) => wanted.some((term) => node.text === term || node.description === term));
  const area = (node) => node.bounds ? Math.max(0, node.bounds[2] - node.bounds[0]) * Math.max(0, node.bounds[3] - node.bounds[1]) : Number.MAX_SAFE_INTEGER;
  return candidates.sort((left, right) => Number(right.clickable) - Number(left.clickable) || area(left) - area(right))[0] || null;
}

export function extractPinduoduoCandidates(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const titles = list.filter((node) => /\/tv_title$/.test(node.resourceId || "") && node.text && node.bounds);
  return titles.map((title, index) => {
    const [left, , right, bottom] = title.bounds;
    const numeric = list.filter((node) => {
      if (!node.bounds || !/^\d+(?:\.\d{1,2})?$/.test(node.text || "")) return false;
      const centerX = (node.bounds[0] + node.bounds[2]) / 2;
      return centerX >= left && centerX <= right && node.bounds[1] >= bottom && node.bounds[1] <= bottom + 100;
    }).sort((a, b) => a.bounds[1] - b.bounds[1]);
    const priceNode = numeric[0];
    const price = Number(priceNode?.text);
    return {
      candidateId: `visible-${index + 1}`,
      platform: "pinduoduo",
      title: clean(title.description || title.text).replace(/&#10;|\n/g, " ").trim(),
      displayedPrice: Number.isFinite(price) && price > 0 ? price : null,
      bounds: title.bounds,
      priceBounds: priceNode?.bounds || null,
      priceType: "search_result_displayed",
      requiresDetailVerification: true,
    };
  }).filter((candidate) => candidate.displayedPrice !== null);
}
