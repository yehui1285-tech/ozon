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

export function aiJudgementReadiness(task = {}) {
  const reasons = [];
  if (!isTrustedOzonImageUrl(task?.enrichment?.mainImageUrl)) reasons.push("缺少可信Ozon主图");
  const candidates = Array.isArray(task?.sourcing?.searchCandidates)
    ? task.sourcing.searchCandidates.filter((candidate) => candidate?.detail?.detailStatus === "detail_captured").slice(0, 3)
    : [];
  if (!candidates.length) reasons.push("缺少已核验的拼多多候选详情");
  return { ready: reasons.length === 0, reasons, candidates };
}

export function normalizeAiJudgement(raw = {}, candidateCount = 0) {
  const allowedVerdicts = new Set(["same_product", "possible_match", "no_match", "insufficient_evidence"]);
  const verdict = allowedVerdicts.has(clean(raw.verdict)) ? clean(raw.verdict) : "insufficient_evidence";
  const candidateIndex = Number(raw.bestCandidateIndex);
  const bestCandidateIndex = Number.isInteger(candidateIndex) && candidateIndex >= 1 && candidateIndex <= candidateCount ? candidateIndex : null;
  const confidence = Math.max(0, Math.min(100, Math.round(Number(raw.confidence) || 0)));
  const specConflicts = Array.isArray(raw.specConflicts) ? raw.specConflicts.map(clean).filter(Boolean).slice(0, 12) : [];
  const assessments = Array.isArray(raw.candidateAssessments) ? raw.candidateAssessments.map((entry) => {
    const index = Number(entry?.candidateIndex);
    const itemVerdict = ["same_product", "possible_match", "different_product", "insufficient_evidence"].includes(clean(entry?.verdict))
      ? clean(entry.verdict)
      : "insufficient_evidence";
    return {
      candidateIndex: Number.isInteger(index) && index >= 1 && index <= candidateCount ? index : null,
      verdict: itemVerdict,
      confidence: Math.max(0, Math.min(100, Math.round(Number(entry?.confidence) || 0))),
      differences: Array.isArray(entry?.differences) ? entry.differences.map(clean).filter(Boolean).slice(0, 8) : [],
    };
  }).filter((entry) => entry.candidateIndex !== null).slice(0, candidateCount) : [];
  const needsHumanReview = raw.needsHumanReview !== false || verdict !== "same_product" || confidence < 85 || specConflicts.length > 0;
  return {
    bestCandidateIndex,
    verdict,
    confidence,
    specConflicts,
    reason: clean(raw.reason).slice(0, 800),
    needsHumanReview,
    candidateAssessments: assessments,
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

export function pinduoduoProductGoodsId(rawUrl) {
  try {
    const url = new URL(clean(rawUrl));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "mobile.yangkeduo.com" || url.pathname !== "/goods.html") return "";
    const goodsId = clean(url.searchParams.get("goods_id"));
    return /^\d+$/.test(goodsId) ? goodsId : "";
  } catch {
    return "";
  }
}

export function pinduoduoFavoriteState(nodes) {
  const favorited = findUiNode(nodes, ["已收藏", "取消收藏"]);
  if (favorited) return { status: "favorited", node: favorited };
  const available = findUiNode(nodes, ["收藏"]);
  if (available) return { status: "not_favorited", node: available };
  return { status: "unknown", node: null };
}

function parseYuanAmount(value) {
  const match = /[¥￥]\s*(\d+(?:\.\d{1,2})?)/.exec(clean(value).replaceAll(",", ""));
  const amount = Number(match?.[1]);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null;
}

export function extractPinduoduoSkuSheet(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const selectedNode = list.find((node) => /^已选\s*[:：]/.test(clean(node?.text || node?.description)));
  const selectedText = clean(selectedNode?.text || selectedNode?.description).replace(/^已选\s*[:：]\s*/, "");
  const options = [];
  const seen = new Set();
  let currentGroup = "";
  for (const node of list) {
    const label = clean(node?.text || node?.description).replace(/\s+/g, " ");
    if (!node?.clickable && /^(?:颜色分类|颜色|型号|规格|尺寸|款式|套餐|数量|类型)$/.test(label)) {
      currentGroup = label;
      continue;
    }
    if (!node?.clickable || !node?.bounds || !/[¥￥]\s*\d/.test(label)) continue;
    if (/提交订单|单独购买|免拼购买|仅\d+件|快要抢光|到手价|券后/.test(label)) continue;
    const price = parseYuanAmount(label);
    const optionLabel = label.replace(/\s*[¥￥]\s*\d+(?:\.\d{1,2})?\s*$/, "").trim();
    if (!optionLabel || !(price > 0)) continue;
    const key = `${optionLabel}\u0000${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ optionId: `sku-option-${options.length + 1}`, group: currentGroup || "规格", label: optionLabel, price, rawText: label, bounds: node.bounds });
  }
  const groups = [...new Set(options.map((option) => option.group))];
  const paymentBalanceNode = list.find((node) => /多多支付余额/.test(clean(node?.text || node?.description)));
  const submitNode = list.find((node) => /提交订单/.test(clean(node?.text || node?.description)));
  const selectedOption = options.find((option) => selectedText && (selectedText === option.label || selectedText.includes(option.label) || option.label.includes(selectedText))) || null;
  return {
    status: options.length ? "sku_options_captured" : "sku_options_missing",
    selectedText,
    selectedOptionId: selectedOption?.optionId || null,
    options,
    groups,
    multiDimension: groups.length > 1,
    accountSpecificDiscountVisible: Boolean(paymentBalanceNode),
    submitPrice: parseYuanAmount(submitNode?.text || submitNode?.description),
  };
}

export function normalizeSkuSelection(raw = {}, options = []) {
  const allowed = new Set(["exact_match", "no_match", "insufficient_evidence"]);
  const verdict = allowed.has(clean(raw?.verdict)) ? clean(raw.verdict) : "insufficient_evidence";
  const optionId = clean(raw?.selectedOptionId);
  const selectedOption = (Array.isArray(options) ? options : []).find((option) => clean(option?.optionId) === optionId) || null;
  const confidence = Math.max(0, Math.min(100, Math.round(Number(raw?.confidence) || 0)));
  const needsHumanReview = raw?.needsHumanReview !== false || verdict !== "exact_match" || !selectedOption || confidence < 85;
  return {
    verdict,
    selectedOptionId: selectedOption?.optionId || null,
    confidence,
    reason: clean(raw?.reason).slice(0, 600),
    needsHumanReview,
  };
}

export function resolveAiRecommendedCandidate(task = {}, judgement = task?.sourcing?.aiJudgement || {}) {
  const candidates = Array.isArray(task?.sourcing?.searchCandidates)
    ? task.sourcing.searchCandidates.filter((candidate) => candidate?.detail?.detailStatus === "detail_captured").slice(0, 3)
    : [];
  const candidateId = clean(judgement?.bestCandidateId);
  if (candidateId) {
    const exact = candidates.find((candidate) => clean(candidate?.candidateId) === candidateId);
    if (exact) return exact;
  }
  const index = Number(judgement?.bestCandidateIndex);
  return Number.isInteger(index) && index >= 1 && index <= candidates.length ? candidates[index - 1] : null;
}

export function detectPinduoduoRiskPage(nodes) {
  const visibleText = (Array.isArray(nodes) ? nodes : [])
    .flatMap((node) => [clean(node?.text), clean(node?.description)])
    .filter(Boolean);
  const pageText = visibleText.join("\n");
  const rules = [
    { type: "real_name_verification", signals: ["实名认证提示", "提交实名信息"] },
    { type: "face_verification", signals: ["请将正脸置于框内"] },
    { type: "account_risk", signals: ["账号存在风险", "限制部分操作"] },
    { type: "security_verification", signals: ["请完成安全验证", "安全验证"] },
    { type: "captcha_verification", signals: ["拖动滑块", "请输入验证码"] },
  ];
  const matched = rules.find((rule) => rule.signals.some((signal) => pageText.includes(signal)));
  if (!matched) return { blocked: false, type: "", matchedText: "" };
  return {
    blocked: true,
    type: matched.type,
    matchedText: visibleText.filter((text) => matched.signals.some((signal) => text.includes(signal))).join("；").slice(0, 240),
  };
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

export function reconcilePinduoduoDisplayedPrice(searchPrice, detailPrice, rawPriceText = "") {
  const search = Number(searchPrice);
  const detail = Number(detailPrice);
  if (!(search > 0)) return { displayedPrice: detail > 0 ? detail : null, priceSource: "detail" };
  if (!(detail > 0)) return { displayedPrice: search, priceSource: "search_result" };
  if (Math.abs(search - detail) < 0.005) return { displayedPrice: detail, priceSource: "detail" };

  const searchDigits = String(Number(search.toFixed(2))).replace(".", "");
  const detailDigits = String(Number(detail.toFixed(2))).replace(".", "");
  const compactRaw = clean(rawPriceText).replace(/[¥￥,.\s]/g, "");
  const hasCountLabel = /已拼|人付款|付款|销量|售出|件/.test(compactRaw);
  const looksConcatenated = detailDigits.startsWith(searchDigits)
    && detailDigits.length > searchDigits.length
    && detailDigits.length - searchDigits.length <= 6;
  const ratio = detail / search;
  const implausibleNonRoundJump = ratio >= 8 && Math.abs(ratio - Math.round(ratio)) > 0.001;

  if (looksConcatenated && (hasCountLabel || implausibleNonRoundJump)) {
    return {
      displayedPrice: search,
      rawDisplayedPrice: detail,
      priceSource: "search_result_reconciled",
      priceCorrectionReason: "详情无障碍文本把价格与销量/件数拼接，已使用同一候选的搜索页价格",
    };
  }
  return { displayedPrice: detail, priceSource: "detail" };
}

export function candidateInspectionOrder(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return [];
  const lowestIndex = list.reduce((bestIndex, candidate, index) => {
    const price = Number(candidate?.displayedPrice);
    const bestPrice = Number(list[bestIndex]?.displayedPrice);
    if (!(price > 0)) return bestIndex;
    if (!(bestPrice > 0) || price < bestPrice) return index;
    return bestIndex;
  }, 0);
  return [lowestIndex, ...list.map((_, index) => index).filter((index) => index !== lowestIndex)];
}

export function parsePinduoduoRoute(output) {
  const source = String(output || "");
  const match = /"url"\s*:\s*"((?:https?:\\?\/\\?\/mobile\.yangkeduo\.com\\?\/)?goods\.html\?[^"\r\n]+)"/.exec(source);
  if (!match) return { goodsId: "", sourceUrl: "", thumbnailUrl: "", rawRoute: "" };
  let rawRoute = match[1];
  try {
    rawRoute = JSON.parse(`"${rawRoute.replace(/"/g, '\\"')}"`);
  } catch {
    rawRoute = rawRoute.replace(/\\\//g, "/");
  }
  const route = new URL(rawRoute, "https://mobile.yangkeduo.com/");
  const goodsId = clean(route.searchParams.get("goods_id"));
  const thumbnailUrl = clean(route.searchParams.get("thumb_url"));
  return {
    goodsId,
    sourceUrl: goodsId ? `https://mobile.yangkeduo.com/goods.html?goods_id=${encodeURIComponent(goodsId)}` : "",
    thumbnailUrl,
    rawRoute,
  };
}

export function extractPinduoduoDetail(nodes, routeInfo = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const inRange = (node, minTop, maxTop) => node.bounds && node.bounds[1] >= minTop && node.bounds[1] <= maxTop;
  const titleNode = list.find((node) => /\/tv_title$/.test(node.resourceId || "") && inRange(node, 450, 700) && (node.description || node.text));
  const priceGroup = list.find((node) => inRange(node, 450, 620) && /^¥\s*\d+(?:\.\d{1,2})?/.test(node.description || ""));
  const priceText = priceGroup?.description || list.find((node) => inRange(node, 450, 620) && /^\d+(?:\.\d{1,2})?$/.test(node.text || ""))?.text || "";
  const priceMatch = /(?:¥\s*)?(\d+(?:\.\d{1,2})?)/.exec(priceText);
  const visibleText = list.map((node) => `${node.text || ""} ${node.description || ""}`.trim()).filter(Boolean);
  const visibleLabels = [...new Set(visibleText.filter((text) => /包邮|运费|新客|券后|限购|仅剩|最后\d+件|已拼|先用后付|免拼购买/.test(text)).map((text) => text.replace(/\s+/g, " ").slice(0, 120)))].slice(0, 20);
  const shippingIncluded = visibleText.some((text) => /全场包邮|商品包邮|卖家包邮|免运费/.test(text));
  const displayedPrice = Number(priceMatch?.[1]);
  return {
    title: clean(titleNode?.description || titleNode?.text).replace(/&#10;|\n/g, " ").trim(),
    displayedPrice: Number.isFinite(displayedPrice) && displayedPrice > 0 ? displayedPrice : null,
    rawPriceText: clean(priceText),
    goodsId: clean(routeInfo.goodsId),
    sourceUrl: clean(routeInfo.sourceUrl),
    thumbnailUrl: clean(routeInfo.thumbnailUrl),
    shippingIncluded,
    shippingFee: shippingIncluded ? 0 : null,
    visibleLabels,
    detailStatus: titleNode && displayedPrice > 0 && routeInfo.goodsId ? "detail_captured" : "detail_incomplete",
    capturedAt: new Date().toISOString(),
  };
}
