const PANEL_ID = "ozon-erp-detail-panel";
const PANEL_POSITION_KEY = "ozonErpDetailPanelPosition";
const PANEL_COLLAPSED_KEY = "ozonErpDetailPanelCollapsed";
const COLLECTION_LOG_KEY = "ozonErpCollectionLog";
const SENT_PRODUCTS_KEY = "ozonErpSentProducts";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const MAX_LOG_ENTRIES = 50;
const MAX_SENT_PRODUCTS = 500;
const TARGET_ORIGIN = "https://yehui1285-tech.github.io";
const blackPriceCore = globalThis.OzonBlackPriceCore || null;

function textOf(node) {
  return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
}

function num(text) {
  let value = String(text || "")
    .replace(/[¥￥₽%]/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim();
  const match = value.match(/-?[\d\s.,]+/);
  if (!match) return 0;
  value = match[0].replace(/\s+/g, "");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalMark = lastComma > lastDot ? "," : ".";
    value = value
      .replace(new RegExp(`\\${decimalMark === "," ? "." : ","}`, "g"), "")
      .replace(decimalMark, ".");
  } else if (/^-?\d{1,3}(,\d{3})+$/.test(value)) {
    value = value.replace(/,/g, "");
  } else if (lastComma >= 0) {
    value = value.replace(",", ".");
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function first(raw, pattern) {
  return raw.match(pattern)?.[1]?.trim() || "";
}

function normalizeText(text) {
  return String(text || "")
    .replace(/[：]/g, ":")
    .replace(/[×]/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePercents(raw) {
  const line = first(raw, /rFBS[^0-9]*([0-9%％\s-]+)/i);
  return {
    line,
    values: [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => num(m[1])),
  };
}

function parseDimensions(raw) {
  const text = normalizeText(raw);
  const patterns = [
    /(?:长\s*宽\s*高|长宽高|尺寸|包装尺寸|规格)\s*:?\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*(mm|毫米|cm|厘米)?/i,
    /(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*(mm|毫米|cm|厘米)/i,
  ];
  const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
  if (!match) return { dimensionsText: "", lengthCm: 0, widthCm: 0, heightCm: 0 };
  let values = [num(match[1]), num(match[2]), num(match[3])];
  const unit = String(match[4] || "").toLowerCase();
  if (unit.includes("mm") || unit.includes("毫米") || (!unit && Math.max(...values) > 150)) values = values.map((v) => v / 10);
  values.sort((a, b) => b - a);
  return {
    dimensionsText: `${match[1]} x ${match[2]} x ${match[3]}${match[4] || ""}`,
    lengthCm: values[0] || 0,
    widthCm: values[1] || 0,
    heightCm: values[2] || 0,
  };
}

function parseWeight(raw) {
  const text = normalizeText(raw);
  const toKg = (valueText, unitText) => {
    let weight = num(valueText);
    const unit = String(unitText || "").toLowerCase();
    if (unit === "g" || unit.includes("克")) weight /= 1000;
    return weight;
  };
  const labeled = [...text.matchAll(/(?:重\s*量|实\s*重|毛\s*重|净\s*重)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|g|克)?/gi)];
  const fallback = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|g|克)/gi)];
  const match = [...labeled, ...fallback].find((item) => {
    const weight = toKg(item[1], item[2]);
    return weight > 0 && weight <= 80;
  });
  if (!match) return { weightText: "", weightKg: 0 };
  const weight = toKg(match[1], match[2]);
  return { weightText: `${match[1]}${match[2] || ""}`, weightKg: weight };
}

const routes = [
  {"name":"CEL Economy Extra Small","minValue":0,"maxValue":1500,"minWeightExclusive":0,"maxWeight":0.5,"maxSum":90,"maxSide":60,"usesVolume":false,"rate":28.1,"fixed":3.4},
  {"name":"CEL Economy Budget","minValue":0,"maxValue":1500,"minWeightExclusive":0.5,"maxWeight":25,"maxSum":150,"maxSide":60,"usesVolume":false,"rate":19.1,"fixed":25.9},
  {"name":"CEL Economy Small","minValue":1500,"maxValue":7000,"minWeightExclusive":0,"maxWeight":2,"maxSum":150,"maxSide":60,"usesVolume":false,"rate":28.1,"fixed":18.8},
  {"name":"CEL Economy Premium Small","minValue":7000,"maxValue":250000,"minWeightExclusive":0,"maxWeight":5,"maxSum":250,"maxSide":150,"usesVolume":false,"rate":28.1,"fixed":24.8},
  {"name":"CEL Economy Big","minValue":1500,"maxValue":7000,"minWeightExclusive":2,"maxWeight":30,"maxBillable":31,"maxSum":250,"maxSide":150,"usesVolume":true,"rate":19.1,"fixed":40.5},
  {"name":"CEL Economy Premium Big","minValue":7000,"maxValue":250000,"minWeightExclusive":5,"maxWeight":25,"maxBillable":80,"maxSum":310,"maxSide":150,"usesVolume":true,"rate":25.8,"fixed":69.7}
];

function saleValue(price) {
  if (price < 135) return 200;
  if (price <= 600) return 2000;
  return 20000;
}

function calcFreight(price, weight, length, width, height) {
  const sale = saleValue(price);
  const sides = [length, width, height].sort((a, b) => b - a);
  const sum = length + width + height;
  const volume = length * width * height / 12000;
  const available = [];
  for (const route of routes) {
    const billable = route.usesVolume ? Math.max(weight, volume) : weight;
    const limits = route.maxBox ? [...route.maxBox].sort((a, b) => b - a) : null;
    const ok = sale > route.minValue &&
      sale <= route.maxValue &&
      weight > route.minWeightExclusive &&
      weight <= route.maxWeight &&
      (!route.maxBillable || billable <= route.maxBillable) &&
      sum <= route.maxSum &&
      Math.max(...sides) <= route.maxSide &&
      (!limits || sides.every((side, index) => side <= limits[index]));
    if (ok) available.push({ route: route.name, price: billable * route.rate + route.fixed });
  }
  available.sort((a, b) => a.price - b.price);
  return available[0] || { route: "", price: 0 };
}

function pickCommission(price, values) {
  if (!values.length) return 0;
  if (price <= 600) return values[1] || 0;
  return values[2] || 0;
}

function hasErpPanelData(raw) {
  const text = String(raw || "");
  return /SKU\s*[:：]?\s*\d{5,}/i.test(text)
    && /rFBS佣金/.test(text)
    && /(?:跟卖最低价|跟卖列表)/.test(text);
}

function hasQualifiedSelection(raw) {
  const text = String(raw || "");
  return /选品标签\s*[:：]?\s*符合要求/.test(text)
    || /(?:^|\n)\s*符合要求\s*(?:\n|$)/.test(text);
}

function isVisibleElement(el) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 80 && rect.height > 40 && style.display !== "none" && style.visibility !== "hidden";
}

function erpText() {
  const full = textOf(document.body);
  const candidates = [...document.querySelectorAll("div, section, aside")]
    .filter(isVisibleElement)
    .map((el) => {
      const text = textOf(el);
      if (!hasErpPanelData(text) && !(/SKU\s*[:：]?\s*\d{5,}/i.test(text) && /选品标签/.test(text))) return null;
      const rect = el.getBoundingClientRect();
      let score = 0;
      if (/SKU\s*[:：]?\s*\d{5,}/i.test(text)) score += 5;
      if (/选品标签/.test(text)) score += 4;
      if (/(?:长\s*宽\s*高|长宽高|尺寸|包装尺寸|规格)/.test(text)) score += 4;
      if (/(?:重\s*量|实\s*重|毛\s*重|净\s*重)\s*[:：]?\s*\d/.test(text)) score += 4;
      if (/跟卖最低价/.test(text)) score += 3;
      if (/rFBS/.test(text)) score += 2;
      if (rect.left > window.innerWidth * 0.45) score += 1;
      score -= Math.min(text.length / 5000, 2);
      return { text, score, top: rect.top, left: rect.left };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.left - a.left || a.top - b.top);
  if (candidates[0]) return candidates[0].text;
  const marker = full.indexOf("毛子ERP");
  return marker >= 0 ? full.slice(marker, marker + 2500) : full;
}

function rgbParts(value) {
  const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isGreenColor(value) {
  const rgb = rgbParts(value);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return g >= 120 && g > r * 1.25 && g > b * 1.15;
}

function hasGreenPriceStyle(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  for (let depth = 0; el && depth < 5; depth += 1, el = el.parentElement) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 14) continue;
    if (isGreenColor(style.backgroundColor) || isGreenColor(style.color)) return true;
  }
  return false;
}

function pageGreenPrice() {
  const collectCandidates = (root) => {
    const candidates = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const pricePattern = /(\d[\d\s]*(?:[,.]\d{1,2})?)\s*[₽¥￥]/g;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue || "";
      if (!/[₽¥￥]/.test(text)) continue;
      let match;
      while ((match = pricePattern.exec(text))) {
        const value = num(match[1]);
        if (value <= 0) continue;
        const parent = node.parentElement;
        if (!parent || !hasGreenPriceStyle(parent)) continue;
        const rect = parent.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 14) continue;
        candidates.push({ value, top: rect.top, left: rect.left });
      }
    }
    candidates.sort((a, b) => a.top - b.top || b.left - a.left);
    return candidates;
  };
  const priceWidgets = [...document.querySelectorAll('[data-widget="webPrice"]')].filter(isDisplayedElement);
  for (const widget of priceWidgets) {
    const candidates = collectCandidates(widget);
    if (candidates[0]?.value > 0) return candidates[0].value;
  }
  const candidates = collectCandidates(document.body);
  return candidates[0]?.value || 0;
}

function isDisplayedElement(element) {
  if (!(element instanceof Element)) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function readOriginalBlackPrice(pageGreen = 0) {
  const widgets = [...document.querySelectorAll('[data-widget="webPrice"]')].filter(isDisplayedElement);
  for (const widget of widgets) {
    const direct = [...widget.querySelectorAll("span.pdp_h0b")]
      .filter((element) => isDisplayedElement(element) && !element.closest("#mz-black-price-tag"))
      .map((element) => num(textOf(element)))
      .find((value) => value > 0);
    if (direct) return direct;
    const prices = [...widget.querySelectorAll("span")]
      .filter((element) => isDisplayedElement(element) && !element.closest("#mz-black-price-tag"))
      .map((element) => ({ element, value: num(textOf(element)) }))
      .filter((entry) => entry.value > 0 && /[¥￥₽]/.test(textOf(entry.element)));
    let greenIndex = prices.findIndex((entry) => hasGreenPriceStyle(entry.element));
    if (greenIndex < 0 && pageGreen > 0) greenIndex = prices.findIndex((entry) => Math.abs(entry.value - pageGreen) <= 0.02);
    if (greenIndex >= 0) {
      const black = prices.slice(greenIndex + 1).find((entry) => !hasGreenPriceStyle(entry.element));
      if (black) return black.value;
    }
  }
  return 0;
}

async function waitForOriginalBlackPrice(pageGreen, timeoutMs = 4500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = readOriginalBlackPrice(pageGreen);
    if (value > 0) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return 0;
}

function findCompetitorHoverTrigger() {
  if (!blackPriceCore?.competitorTriggerScore) return null;
  return [...document.querySelectorAll("span, button, a, div")]
    .filter(isDisplayedElement)
    .map((element) => {
      const style = getComputedStyle(element);
      return {
        element,
        score: blackPriceCore.competitorTriggerScore({
          text: textOf(element),
          cursor: style.cursor,
          textDecorationLine: style.textDecorationLine,
        }),
      };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score)[0]?.element || null;
}

function hoverElement(element) {
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter"]) {
    const EventType = type.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, view: window }));
  }
}

function visibleCompetitorRows() {
  return [...document.querySelectorAll("tr.ant-table-row")]
    .filter(isDisplayedElement)
    .map((row) => {
      const cells = [...row.querySelectorAll("td.ant-table-cell")];
      const link = cells[3]?.querySelector('a[href*="/product/"]') || row.querySelector('a[href*="/product/"]');
      const priceText = cells[4] ? textOf(cells[4]) : textOf(row);
      return { url: link?.href || "", price: num(priceText) };
    });
}

async function findLowestCompetitorProduct(product, timeoutMs = 5500) {
  if (!blackPriceCore) return null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const trigger = findCompetitorHoverTrigger();
    if (trigger) hoverElement(trigger);
    const selected = blackPriceCore.chooseCompetitorRow(visibleCompetitorRows(), product.minCompetitorPrice);
    if (selected) return selected;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function requestRemoteBlackPrice(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "readBlackPriceFromProductUrl", url }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || "跟卖商品页黑标价读取失败"));
      else resolve(response);
    });
  });
}

function collectProduct({ enrichStoreRecord = true } = {}) {
  const raw = erpText();
  const dims = parseDimensions(raw);
  const weight = parseWeight(raw);
  const commissions = parsePercents(raw);
  const visibleGreen = pageGreenPrice();
  const competitorMatch = raw.match(/跟卖最低价\s*[:：]?\s*[¥￥₽]?([0-9][0-9\s\u00a0\u202f.,]*)/);
  const competitorUnavailable = /跟卖最低价\s*[:：]?\s*(?:无|暂无|没有|未发现|[-—]+)/.test(raw);
  const minSeller = num(competitorMatch?.[1]);
  const candidates = [visibleGreen, minSeller].filter((v) => v > 0);
  const greenPrice = candidates.length ? Math.min(...candidates) : 0;
  const sku = first(raw, /SKU\s*[:：]?\s*(\d{5,})/i);
  const erpLoaded = hasErpPanelData(raw);
  const selectionQualified = hasQualifiedSelection(raw);
  const commission = pickCommission(greenPrice, commissions.values);
  const freight = calcFreight(greenPrice, weight.weightKg, dims.lengthCm, dims.widthCm, dims.heightCm);
  const notes = [];
  if (visibleGreen && minSeller) notes.push(`页面绿底价${visibleGreen}，ERP跟卖最低价${minSeller}，取低价${greenPrice}`);
  if (!greenPrice) notes.push("未识别到页面绿底价或ERP跟卖最低价");
  if (!dims.lengthCm || !dims.widthCm || !dims.heightCm) notes.push("未识别到长宽高");
  if (!weight.weightKg) notes.push("未识别到重量");
  if (!freight.price) notes.push("未匹配到可用国际运费");
  const product = {
    link: location.href,
    sku,
    greenPrice,
    pageGreenPrice: visibleGreen,
    minCompetitorPrice: minSeller,
    erpLoaded,
    selectionQualified,
    competitorPriceResolved: Boolean(competitorMatch || competitorUnavailable),
    commission,
    commissionText: commissions.line,
    commissionOptions: commissions.values,
    freight: Number(freight.price.toFixed(2)),
    freightRoute: freight.route,
    note: notes.join("; "),
    rawText: raw,
    ...dims,
    ...weight,
  };
  if (enrichStoreRecord) enrichStoredStoreRecord(product);
  return product;
}

function enrichStoredStoreRecord(product) {
  const sku = String(product?.sku || "").trim();
  const price = Number(product?.minCompetitorPrice || 0);
  if (!sku || !(price > 0)) return;
  const competitor = `¥${price.toFixed(2)}`;
  chrome.runtime.sendMessage({ type: "enrichStoreProductBySku", sku, competitor }, () => void chrome.runtime.lastError);
}

function setStatus(message, ok = true) {
  const el = document.getElementById("ozon-detail-status");
  if (!el) return;
  el.textContent = message;
  el.style.color = ok ? "#067647" : "#b42318";
}

function renderCollectionLog(entries) {
  const container = document.getElementById("ozon-collection-log");
  if (!container) return;
  container.replaceChildren();
  if (!entries.length) {
    container.textContent = "暂无记录";
    return;
  }
  entries.slice(0, 3).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "ozon-log-row";
    row.style.color = entry.ok ? "#237a5b" : "#b44b61";
    row.textContent = `${entry.time} ${entry.message}`;
    container.appendChild(row);
  });
}

function addCollectionLog(message, ok = true) {
  const now = new Date();
  const entry = {
    time: now.toLocaleTimeString("zh-CN", { hour12: false }),
    timestamp: now.toISOString(),
    message,
    ok,
  };
  chrome.storage.local.get(COLLECTION_LOG_KEY, (stored) => {
    const entries = [entry, ...(stored?.[COLLECTION_LOG_KEY] || [])].slice(0, MAX_LOG_ENTRIES);
    chrome.storage.local.set({ [COLLECTION_LOG_KEY]: entries });
    renderCollectionLog(entries);
  });
}

function editorNumber(id) {
  return num(document.getElementById(id)?.value);
}

let currentProduct = null;
let blackPriceLookupPromise = null;
let blackPriceLookupId = 0;

function setBlackPriceStatus(message, ok = true) {
  const element = document.getElementById("ozon-edit-black-status");
  if (!element) return;
  element.textContent = message;
  element.style.color = ok ? "#067647" : "#b42318";
}

function startBlackPriceLookup(product) {
  const requestId = ++blackPriceLookupId;
  const source = blackPriceCore?.chooseSource(product.pageGreenPrice, product.minCompetitorPrice) || "none";
  const sourceText = source === "competitor" ? "跟卖最低价商品页" : "当前商品页";
  setBlackPriceStatus(source === "none" ? "缺少绿标价格来源，请手动填写黑标价。" : `正在从${sourceText}读取原始黑价…`, source !== "none");
  blackPriceLookupPromise = (async () => {
    try {
      let blackPrice = 0;
      let sourceUrl = location.href;
      if (source === "page") {
        blackPrice = await waitForOriginalBlackPrice(product.pageGreenPrice);
      } else if (source === "competitor") {
        const competitor = await findLowestCompetitorProduct(product);
        if (!competitor?.url) throw new Error("未能从跟卖列表取得最低价商品链接");
        sourceUrl = competitor.url;
        const response = await requestRemoteBlackPrice(competitor.url);
        blackPrice = Number(response.blackPrice || 0);
        if (response.singlePrice && Number(response.sourceGreenPrice || 0) > 0) {
          product.greenPrice = Number(response.sourceGreenPrice);
          const greenInput = document.getElementById("ozon-edit-green");
          if (greenInput) greenInput.value = product.greenPrice.toFixed(2);
        }
      } else {
        throw new Error("没有可用的绿标价格来源");
      }
      if (!(blackPrice > 0)) throw new Error(`${sourceText}没有读取到原始黑价`);
      if (requestId !== blackPriceLookupId) return null;
      const input = document.getElementById("ozon-edit-black");
      const manualValue = num(input?.value);
      const previousAuto = num(input?.dataset.autoValue);
      if (manualValue > 0 && Math.abs(manualValue - previousAuto) > 0.001) {
        setBlackPriceStatus(`已自动读到 ${blackPrice.toFixed(2)}，但保留你手动填写的 ${manualValue.toFixed(2)}。`);
        return { blackPrice: manualValue, source: "manual", sourceUrl };
      }
      input.value = blackPrice.toFixed(2);
      input.dataset.autoValue = input.value;
      currentProduct = { ...(currentProduct || product), greenPrice: product.greenPrice, blackPrice, blackPriceSource: source, blackPriceSourceUrl: sourceUrl };
      recalculateEditor();
      setBlackPriceStatus(`已自动填入 ${blackPrice.toFixed(2)}（${sourceText}）。`);
      addCollectionLog(`黑标价自动读取成功：${blackPrice.toFixed(2)}（${sourceText}）`);
      return { blackPrice, source, sourceUrl };
    } catch (error) {
      if (requestId !== blackPriceLookupId) return null;
      setBlackPriceStatus(`自动读取失败：${error.message || error}。请手动填写。`, false);
      addCollectionLog(`黑标价自动读取失败：${error.message || error}`, false);
      return null;
    }
  })();
  return blackPriceLookupPromise;
}

async function collectOzonTaskPricingSnapshot(hints = {}) {
  const expectedSku = String(hints.sku || "").trim();
  const startedAt = Date.now();
  let product = null;
  let pagePrice = 0;
  let competitorPrice = 0;
  let source = "none";
  let stableFingerprint = "";
  let stableCount = 0;
  let lastObservedSku = "";
  let unqualifiedFingerprint = "";
  let unqualifiedStableCount = 0;
  while (Date.now() - startedAt < 15000) {
    product = collectProduct({ enrichStoreRecord: false });
    lastObservedSku = String(product.sku || "").trim();
    if (expectedSku && lastObservedSku && lastObservedSku !== expectedSku) {
      stableCount = 0;
      stableFingerprint = "";
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    if (product.erpLoaded && !product.selectionQualified) {
      const fingerprint = JSON.stringify([
        product.sku, product.commissionOptions, product.lengthCm, product.widthCm,
        product.heightCm, product.weightKg, product.competitorPriceResolved,
        /暂无数据/.test(product.rawText || ""),
      ]);
      unqualifiedStableCount = fingerprint === unqualifiedFingerprint ? unqualifiedStableCount + 1 : 1;
      unqualifiedFingerprint = fingerprint;
      if (unqualifiedStableCount >= 8) {
        return {
          disqualified: true,
          disqualificationReason: "产品不合要求：未发现“选品标签：符合要求”",
          product,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    unqualifiedStableCount = 0;
    unqualifiedFingerprint = "";
    pagePrice = Number(product.pageGreenPrice || 0);
    competitorPrice = Number(product.minCompetitorPrice || 0);
    source = blackPriceCore?.chooseSource(pagePrice, competitorPrice) || "none";
    const complete = product.erpLoaded
      && product.selectionQualified
      && product.competitorPriceResolved
      && product.sku
      && pagePrice > 0
      && product.commissionOptions?.length >= 3
      && product.lengthCm > 0
      && product.widthCm > 0
      && product.heightCm > 0
      && product.weightKg > 0
      && source !== "none";
    if (complete) {
      const fingerprint = JSON.stringify([
        product.sku, pagePrice, competitorPrice, product.commissionOptions,
        product.lengthCm, product.widthCm, product.heightCm, product.weightKg,
      ]);
      stableCount = fingerprint === stableFingerprint ? stableCount + 1 : 1;
      stableFingerprint = fingerprint;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
      stableFingerprint = "";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (product?.erpLoaded && !product?.selectionQualified) {
    return {
      disqualified: true,
      disqualificationReason: "产品不合要求：未发现“选品标签：符合要求”",
      product,
    };
  }
  const missing = [];
  if (!product?.erpLoaded) missing.push("毛子ERP面板");
  if (!product?.sku) missing.push("当前SKU");
  if (!(pagePrice > 0)) missing.push("当前页面绿标价");
  if (!product?.competitorPriceResolved) missing.push("当前跟卖最低价状态");
  if (!(product?.commissionOptions?.length >= 3)) missing.push("当前佣金档位");
  if (!(product?.lengthCm > 0 && product?.widthCm > 0 && product?.heightCm > 0)) missing.push("当前尺寸");
  if (!(product?.weightKg > 0)) missing.push("当前重量");
  if (expectedSku && lastObservedSku && lastObservedSku !== expectedSku) {
    throw new Error(`15秒内未切换到任务商品：任务${expectedSku}，页面${lastObservedSku}`);
  }
  if (stableCount < 3 || source === "none") throw new Error(`15秒内当前页面数据未完整稳定：${missing.join("、") || "价格或ERP字段仍在变化"}`);
  let sourceUrl = location.href;
  let currentBlackPrice = 0;
  if (source === "page") {
    currentBlackPrice = await waitForOriginalBlackPrice(pagePrice, 5000);
  } else {
    const competitor = await findLowestCompetitorProduct({ ...(product || {}), minCompetitorPrice: competitorPrice }, 6000);
    if (!competitor?.url) throw new Error("未能从跟卖列表定位最低价商品链接");
    sourceUrl = competitor.url;
  }
  return {
    product: product || {},
    pageGreenPrice: pagePrice,
    minCompetitorPrice: competitorPrice,
    effectiveGreenPrice: source === "competitor" ? competitorPrice : pagePrice,
    source,
    sourceUrl,
    currentBlackPrice,
  };
}

function recalculateEditor() {
  const price = editorNumber("ozon-edit-green");
  const length = editorNumber("ozon-edit-length");
  const width = editorNumber("ozon-edit-width");
  const height = editorNumber("ozon-edit-height");
  const weight = editorNumber("ozon-edit-weight");
  const commission = pickCommission(price, currentProduct?.commissionOptions || []);
  const freight = calcFreight(price, weight, length, width, height);
  document.getElementById("ozon-edit-commission").value = commission || "";
  document.getElementById("ozon-edit-freight").value = freight.price ? freight.price.toFixed(2) : "";
  document.getElementById("ozon-edit-route").textContent = freight.route || "未匹配到可用运费渠道";
}

function fillEditor(product) {
  currentProduct = product;
  const values = {
    "ozon-edit-sku": product.sku,
    "ozon-edit-green": product.greenPrice,
    "ozon-edit-black": product.blackPrice || "",
    "ozon-edit-length": product.lengthCm,
    "ozon-edit-width": product.widthCm,
    "ozon-edit-height": product.heightCm,
    "ozon-edit-weight": product.weightKg,
    "ozon-edit-commission": product.commission,
    "ozon-edit-freight": product.freight,
  };
  Object.entries(values).forEach(([id, value]) => {
    document.getElementById(id).value = value || "";
  });
  const blackInput = document.getElementById("ozon-edit-black");
  delete blackInput.dataset.autoValue;
  if (product.blackPrice) blackInput.dataset.autoValue = String(product.blackPrice);
  setBlackPriceStatus(product.blackPrice ? `已填入黑标价 ${Number(product.blackPrice).toFixed(2)}。` : "等待自动读取；失败时可手动填写。", true);
  document.getElementById("ozon-edit-route").textContent = product.freightRoute || "未匹配到可用运费渠道";
  document.getElementById("ozon-editor").hidden = false;
}

function productFromEditor() {
  const lengthCm = editorNumber("ozon-edit-length");
  const widthCm = editorNumber("ozon-edit-width");
  const heightCm = editorNumber("ozon-edit-height");
  const weightKg = editorNumber("ozon-edit-weight");
  const product = {
    ...(currentProduct || collectProduct()),
    sku: document.getElementById("ozon-edit-sku").value.trim(),
    greenPrice: editorNumber("ozon-edit-green"),
    blackPrice: editorNumber("ozon-edit-black"),
    commission: editorNumber("ozon-edit-commission"),
    freight: editorNumber("ozon-edit-freight"),
    freightRoute: document.getElementById("ozon-edit-route").textContent,
    lengthCm,
    widthCm,
    heightCm,
    weightKg,
    dimensionsText: `${lengthCm} x ${widthCm} x ${heightCm}cm`,
    weightText: `${weightKg}kg`,
  };
  const missing = [];
  if (!product.sku) missing.push("SKU");
  if (!product.greenPrice) missing.push("绿标价格");
  if (!product.blackPrice) missing.push("黑标价格");
  if (!lengthCm || !widthCm || !heightCm) missing.push("尺寸");
  if (!weightKg) missing.push("重量");
  if (missing.length) product.note = [product.note, `发送前仍缺少：${missing.join("、")}`].filter(Boolean).join("; ");
  return product;
}

function normalizedProductLink(link) {
  try {
    const url = new URL(link);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return String(link || "").trim();
  }
}

function findDuplicate(product, callback) {
  chrome.storage.local.get(SENT_PRODUCTS_KEY, (stored) => {
    const entries = stored?.[SENT_PRODUCTS_KEY] || [];
    const link = normalizedProductLink(product.link);
    const duplicate = entries.find((entry) =>
      (product.sku && entry.sku === product.sku) ||
      (link && entry.link === link)
    );
    callback(duplicate);
  });
}

function rememberSentProduct(product) {
  chrome.storage.local.get(SENT_PRODUCTS_KEY, (stored) => {
    const entry = {
      sku: product.sku,
      link: normalizedProductLink(product.link),
      sentAt: new Date().toISOString(),
    };
    const previous = stored?.[SENT_PRODUCTS_KEY] || [];
    chrome.storage.local.set({ [SENT_PRODUCTS_KEY]: [entry, ...previous].slice(0, MAX_SENT_PRODUCTS) });
  });
}

function sendConfirmedProduct(product) {
  const detailText = `尺寸 ${product.lengthCm || "-"}x${product.widthCm || "-"}x${product.heightCm || "-"}cm，重量 ${product.weightKg || "-"}kg`;
  setStatus("正在发送到核价页...");
  chrome.runtime.sendMessage({ type: "sendProductToPricing", product }, (response) => {
    if (chrome.runtime.lastError) {
      const message = chrome.runtime.lastError.message;
      setStatus(`发送失败：${message}`, false);
      addCollectionLog(`发送失败：${message}`, false);
      return;
    }
    if (!response?.ok) {
      const message = response?.error || "未知错误";
      setStatus(`发送失败：${message}`, false);
      addCollectionLog(`发送失败：${message}`, false);
      return;
    }
    rememberSentProduct(product);
    setStatus(`已发送：SKU ${product.sku || "-"}，绿标 ${product.greenPrice || "-"}，黑标 ${product.blackPrice || "-"}，佣金 ${product.commission || "-"}%，运费 ${product.freight || "-"}；${detailText}`);
    addCollectionLog(`发送成功：SKU ${product.sku || "-"}，绿标 ${product.greenPrice || "-"}，黑标 ${product.blackPrice || "-"}`);
  });
}

async function sendToPricingPage() {
  if (!currentProduct) {
    const product = collectProduct();
    fillEditor(product);
    startBlackPriceLookup(product);
  }
  if (blackPriceLookupPromise) await blackPriceLookupPromise;
  const product = productFromEditor();
  if (!product.sku && !product.greenPrice) {
    setStatus("没有读到ERP数据，请等毛子ERP加载后再点。", false);
    addCollectionLog("检查失败：没有读到ERP数据", false);
    return;
  }
  findDuplicate(product, (duplicate) => {
    if (duplicate) {
      const sentAt = new Date(duplicate.sentAt).toLocaleString("zh-CN", { hour12: false });
      const proceed = window.confirm(`这个商品可能已经发送过。\nSKU：${product.sku || "-"}\n上次发送：${sentAt}\n\n仍然新增一行吗？`);
      if (!proceed) {
        setStatus("已取消发送：检测到重复商品。", false);
        addCollectionLog(`取消重复发送：SKU ${product.sku || "-"}`, false);
        return;
      }
    }
    sendConfirmedProduct(product);
  });
}

function clampPanelPosition(panel, left, top) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin), maxTop),
  };
}

function applyPanelPosition(panel, position) {
  const next = clampPanelPosition(panel, Number(position?.left) || 18, Number(position?.top) || 160);
  panel.style.left = `${next.left}px`;
  panel.style.top = `${next.top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  return next;
}

function makePanelDraggable(panel, handle) {
  let drag = null;

  chrome.storage.local.get(PANEL_POSITION_KEY, (stored) => {
    if (chrome.runtime.lastError || !stored?.[PANEL_POSITION_KEY]) return;
    applyPanelPosition(panel, stored[PANEL_POSITION_KEY]);
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    handle.setPointerCapture(event.pointerId);
    handle.style.cursor = "grabbing";
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    applyPanelPosition(panel, {
      left: event.clientX - drag.offsetX,
      top: event.clientY - drag.offsetY,
    });
  });

  const finishDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = panel.getBoundingClientRect();
    drag = null;
    handle.style.cursor = "grab";
    chrome.storage.local.set({
      [PANEL_POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) },
    });
  };

  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  window.addEventListener("resize", () => {
    const rect = panel.getBoundingClientRect();
    const next = applyPanelPosition(panel, { left: rect.left, top: rect.top });
    chrome.storage.local.set({ [PANEL_POSITION_KEY]: next });
  });
}

function resetPanelPosition(panel) {
  chrome.storage.local.remove(PANEL_POSITION_KEY);
  panel.style.left = "18px";
  panel.style.top = "auto";
  panel.style.right = "auto";
  panel.style.bottom = "120px";
  setStatus("面板位置已恢复默认。", true);
}

function setPanelCollapsed(panel, collapsed) {
  const body = document.getElementById("ozon-panel-body");
  const button = document.getElementById("ozon-panel-collapse");
  body.hidden = collapsed;
  button.textContent = collapsed ? "+" : "−";
  button.title = collapsed ? "展开面板" : "折叠面板";
  chrome.storage.local.set({ [PANEL_COLLAPSED_KEY]: collapsed });
  if (!collapsed) {
    requestAnimationFrame(() => {
      const rect = panel.getBoundingClientRect();
      applyPanelPosition(panel, { left: rect.left, top: rect.top });
    });
  }
}

function ensurePanelStyles() {
  const styleId = "ozon-erp-detail-panel-style";
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    #${PANEL_ID} {
      box-sizing: border-box !important;
      width: 336px !important;
      padding: 14px !important;
      border: 1px solid rgba(255,255,255,.92) !important;
      border-radius: 16px !important;
      background: linear-gradient(145deg, rgba(250,252,255,.97), rgba(240,243,252,.95)) !important;
      box-shadow: 0 18px 42px rgba(37,52,104,.18) !important;
      color: #1d2942 !important;
      backdrop-filter: blur(14px);
    }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${PANEL_ID} #ozon-panel-drag-handle {
      margin: -5px -5px 11px !important;
      padding: 10px !important;
      border-radius: 12px !important;
      color: #fff !important;
      background: linear-gradient(135deg, #235aeb, #7c78dc) !important;
      box-shadow: 0 8px 18px rgba(67,78,188,.22);
    }
    #${PANEL_ID} #ozon-panel-drag-handle small { color: rgba(255,255,255,.76) !important; }
    #${PANEL_ID} #ozon-panel-drag-handle button {
      border-color: rgba(255,255,255,.3) !important;
      border-radius: 8px !important;
      background: rgba(255,255,255,.15) !important;
      color: #fff !important;
    }
    #${PANEL_ID} #ozon-panel-body { padding-right: 3px !important; scrollbar-width: thin; }
    #${PANEL_ID} button { font-family: inherit; transition: transform .16s ease, box-shadow .16s ease, filter .16s ease; }
    #${PANEL_ID} button:hover { filter: brightness(1.03); transform: translateY(-1px); }
    #${PANEL_ID} #ozon-check-detail {
      height: 36px !important;
      border-color: #d9e1fb !important;
      border-radius: 10px !important;
      color: #3554bc !important;
      background: rgba(255,255,255,.78) !important;
      box-shadow: 0 4px 12px rgba(67,84,171,.07);
    }
    #${PANEL_ID} #ozon-editor {
      margin-top: 10px !important;
      padding: 11px !important;
      border-color: rgba(221,227,248,.9) !important;
      border-radius: 12px !important;
      background: rgba(255,255,255,.72) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.9);
    }
    #${PANEL_ID} #ozon-editor > div:first-child { color: #29375b; font-size: 12px; }
    #${PANEL_ID} label { color: #65718d; font-size: 11px; font-weight: 700; }
    #${PANEL_ID} input {
      border-color: #dbe2f2 !important;
      border-radius: 7px !important;
      color: #243250 !important;
      background: rgba(250,252,255,.95) !important;
      outline: none;
      transition: border-color .16s ease, box-shadow .16s ease;
    }
    #${PANEL_ID} input:focus { border-color: #7d86e8 !important; box-shadow: 0 0 0 3px rgba(112,122,224,.14); }
    #${PANEL_ID} #ozon-edit-black { border-color: #d9cdf9 !important; background: #faf8ff !important; }
    #${PANEL_ID} #ozon-edit-commission,
    #${PANEL_ID} #ozon-edit-freight { color: #5e6790 !important; background: #eef1fb !important; }
    #${PANEL_ID} #ozon-edit-route { padding: 7px 8px; border-radius: 8px; background: #f1f4fb; color: #687491 !important; }
    #${PANEL_ID} #ozon-send-pricing {
      height: 38px !important;
      border-radius: 10px !important;
      background: linear-gradient(135deg, #235aeb, #756fda) !important;
      box-shadow: 0 8px 16px rgba(60,78,196,.22) !important;
    }
    #${PANEL_ID} #ozon-detail-status {
      min-height: 36px;
      padding: 8px 9px;
      border-radius: 9px;
      background: rgba(238,241,251,.82);
      font-size: 11px;
    }
    #${PANEL_ID} #ozon-collection-log {
      padding: 2px 8px;
      border: 1px solid #e5e9f5;
      border-radius: 9px;
      background: rgba(255,255,255,.6);
      color: #71809c !important;
    }
    #${PANEL_ID} .ozon-log-row { padding: 7px 0; border-top: 1px solid #edf0f8; font-size: 11px; }
    #${PANEL_ID} #ozon-clear-log { border-color: #dce2f1 !important; border-radius: 7px !important; background: #fff !important; color: #69758f !important; }
  `;
  document.head.appendChild(style);
}

function installPanel() {
  if (document.getElementById(PANEL_ID)) return;
  ensurePanelStyles();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = [
    "position:fixed",
    "left:18px",
    "bottom:160px",
    "z-index:2147483647",
    "width:300px",
    "padding:12px",
    "border:1px solid #bfd3ff",
    "border-radius:12px",
    "background:#f8fbff",
    "box-shadow:0 10px 28px rgba(15,23,42,.16)",
    "font-family:Microsoft YaHei,system-ui,sans-serif",
    "font-size:12px",
    "color:#172033",
  ].join(";");
  panel.innerHTML = `
    <div id="ozon-panel-drag-handle" title="按住拖动面板" style="display:flex;align-items:center;justify-content:space-between;margin:-4px -4px 8px;padding:4px;cursor:grab;user-select:none;touch-action:none;font-weight:800;">
      <span>OZON详情采集 <small style="font-weight:500;color:#64748b;">v${EXTENSION_VERSION}</small></span>
      <span style="display:flex;align-items:center;gap:4px;">
        <button id="ozon-panel-reset" type="button" title="恢复默认位置" style="width:25px;height:25px;padding:0;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;cursor:pointer;">↺</button>
        <button id="ozon-panel-collapse" type="button" title="折叠面板" style="width:25px;height:25px;padding:0;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;font-size:17px;line-height:1;cursor:pointer;">−</button>
        <span aria-hidden="true" style="font-size:16px;line-height:1;color:#64748b;">&#8942;&#8942;</span>
      </span>
    </div>
    <div id="ozon-panel-body" style="max-height:calc(100vh - 90px);overflow:auto;padding-right:2px;">
      <button id="ozon-check-detail" style="width:100%;height:32px;border:1px solid #bed0f7;border-radius:8px;background:white;color:#174ea6;font-weight:700;cursor:pointer;">检查本页数据</button>
      <div id="ozon-editor" hidden style="margin-top:8px;padding:8px;border:1px solid #dbe5f5;border-radius:8px;background:#fff;">
        <div style="margin-bottom:6px;font-weight:700;">发送前确认，可直接修改</div>
        <label style="display:grid;grid-template-columns:72px 1fr;align-items:center;gap:6px;margin-top:5px;">SKU<input id="ozon-edit-sku" type="text" style="min-width:0;height:26px;border:1px solid #cbd5e1;border-radius:5px;padding:0 6px;"></label>
        <label style="display:grid;grid-template-columns:72px 1fr;align-items:center;gap:6px;margin-top:5px;">绿标价格<input id="ozon-edit-green" type="number" step="0.01" min="0" style="min-width:0;height:26px;border:1px solid #cbd5e1;border-radius:5px;padding:0 6px;"></label>
        <label style="display:grid;grid-template-columns:72px 1fr;align-items:center;gap:6px;margin-top:5px;">黑标价格<input id="ozon-edit-black" type="number" step="0.01" min="0" placeholder="自动读取失败时手动填写" style="min-width:0;height:26px;border:1px solid #f59e0b;border-radius:5px;padding:0 6px;background:#fffbeb;"></label>
        <div id="ozon-edit-black-status" style="margin-top:4px;color:#64748b;line-height:1.35;">等待自动读取；失败时可手动填写。</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:6px;">
          <label>长cm<input id="ozon-edit-length" type="number" step="0.01" min="0" style="box-sizing:border-box;width:100%;height:26px;margin-top:2px;border:1px solid #cbd5e1;border-radius:5px;padding:0 5px;"></label>
          <label>宽cm<input id="ozon-edit-width" type="number" step="0.01" min="0" style="box-sizing:border-box;width:100%;height:26px;margin-top:2px;border:1px solid #cbd5e1;border-radius:5px;padding:0 5px;"></label>
          <label>高cm<input id="ozon-edit-height" type="number" step="0.01" min="0" style="box-sizing:border-box;width:100%;height:26px;margin-top:2px;border:1px solid #cbd5e1;border-radius:5px;padding:0 5px;"></label>
        </div>
        <label style="display:grid;grid-template-columns:72px 1fr;align-items:center;gap:6px;margin-top:5px;">重量kg<input id="ozon-edit-weight" type="number" step="0.001" min="0" style="min-width:0;height:26px;border:1px solid #cbd5e1;border-radius:5px;padding:0 6px;"></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px;">
          <label>佣金%<input id="ozon-edit-commission" type="number" readonly style="box-sizing:border-box;width:100%;height:26px;margin-top:2px;border:1px solid #dbe5f5;border-radius:5px;padding:0 5px;background:#f8fafc;"></label>
          <label>国际运费<input id="ozon-edit-freight" type="number" readonly style="box-sizing:border-box;width:100%;height:26px;margin-top:2px;border:1px solid #dbe5f5;border-radius:5px;padding:0 5px;background:#f8fafc;"></label>
        </div>
        <div id="ozon-edit-route" style="margin-top:5px;color:#64748b;line-height:1.35;"></div>
      </div>
      <button id="ozon-send-pricing" style="width:100%;height:34px;margin-top:8px;border:0;border-radius:8px;background:#1768d1;color:#fff;font-weight:800;cursor:pointer;">发送到核价页</button>
      <div id="ozon-detail-status" style="margin-top:8px;line-height:1.45;color:#334155;">先检查数据，再确认发送</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:9px;">
        <strong>最近采集日志</strong>
        <button id="ozon-clear-log" type="button" style="padding:2px 6px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;color:#64748b;cursor:pointer;">清空</button>
      </div>
      <div id="ozon-collection-log" style="margin-top:3px;max-height:118px;overflow:auto;line-height:1.35;color:#64748b;">暂无记录</div>
    </div>
  `;
  document.body.appendChild(panel);
  makePanelDraggable(panel, document.getElementById("ozon-panel-drag-handle"));
  document.getElementById("ozon-panel-reset").addEventListener("click", (event) => {
    event.stopPropagation();
    resetPanelPosition(panel);
  });
  document.getElementById("ozon-panel-collapse").addEventListener("click", (event) => {
    event.stopPropagation();
    setPanelCollapsed(panel, !document.getElementById("ozon-panel-body").hidden);
  });
  chrome.storage.local.get([PANEL_COLLAPSED_KEY, COLLECTION_LOG_KEY], (stored) => {
    if (stored?.[PANEL_COLLAPSED_KEY]) setPanelCollapsed(panel, true);
    renderCollectionLog(stored?.[COLLECTION_LOG_KEY] || []);
  });
  ["ozon-edit-green", "ozon-edit-length", "ozon-edit-width", "ozon-edit-height", "ozon-edit-weight"].forEach((id) => {
    document.getElementById(id).addEventListener("input", recalculateEditor);
  });
  document.getElementById("ozon-edit-black").addEventListener("input", (event) => {
    const value = num(event.currentTarget.value);
    if (value > 0) setBlackPriceStatus(`已手动填写 ${value.toFixed(2)}；发送时以该值为准。`);
    else setBlackPriceStatus("黑标价为空，核价结果将不完整。", false);
  });
  document.getElementById("ozon-clear-log").addEventListener("click", () => {
    chrome.storage.local.remove(COLLECTION_LOG_KEY, () => renderCollectionLog([]));
  });
  document.getElementById("ozon-send-pricing").addEventListener("click", sendToPricingPage);
  document.getElementById("ozon-check-detail").addEventListener("click", () => {
    const p = collectProduct();
    fillEditor(p);
    setStatus(`SKU ${p.sku || "-"}，绿标 ${p.greenPrice || "-"}，佣金 ${p.commission || "-"}%，运费 ${p.freight || "-"}；尺寸 ${p.lengthCm || "-"}x${p.widthCm || "-"}x${p.heightCm || "-"}cm，重量 ${p.weightKg || "-"}kg`, Boolean(p.sku || p.greenPrice));
    const missing = [];
    if (!p.sku) missing.push("SKU");
    if (!p.greenPrice) missing.push("绿标价格");
    if (!p.lengthCm || !p.widthCm || !p.heightCm) missing.push("尺寸");
    if (!p.weightKg) missing.push("重量");
    addCollectionLog(missing.length ? `检查完成，缺少：${missing.join("、")}` : `检查成功：SKU ${p.sku}`, !missing.length);
    startBlackPriceLookup(p);
    console.table([p]);
  });
}

if (location.hostname === "yehui1285-tech.github.io") {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "deliverProductToPricing") return false;
    window.postMessage({ type: "OZON_ERP_DETAIL", product: message.product || {} }, TARGET_ORIGIN);
    sendResponse({ ok: true });
    return true;
  });
} else if (!/^\/seller\/[^/]+/i.test(location.pathname)) {
  installPanel();
  if (!globalThis.__ozonTaskPricingListenerInstalled) {
    globalThis.__ozonTaskPricingListenerInstalled = true;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "collectOzonTaskPricingSnapshot") return false;
      collectOzonTaskPricingSnapshot(message.hints || {})
        .then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    });
  }
}
