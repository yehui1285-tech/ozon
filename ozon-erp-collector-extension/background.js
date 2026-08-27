importScripts("black-price-core.js", "main-image-core.js", "task-pricing-core.js", "store-scanner-core.js");

const blackPriceCore = globalThis.OzonBlackPriceCore;
const mainImageCore = globalThis.OzonMainImageCore;
const taskPricingCore = globalThis.OzonTaskPricingCore;
const storeScannerCore = globalThis.OzonStoreScannerCore;
const TARGET_URL = "https://yehui1285-tech.github.io/ozon/feishu.html?v=20260720";
const TARGET_MATCH = "https://yehui1285-tech.github.io/ozon/feishu.html*";
const AUTO_INJECT_KEY = "ozonAutoInjectEnabled";
const AUTO_INJECT_DELAY_MS = 1000;
const AUTO_INJECT_RETRY_DELAY_MS = 1800;
const STORE_SCAN_ALARM_PREFIX = "ozonStoreScanWatchdog:";
const STORE_SCAN_PROTECTION_KEY = "ozonStoreScanProtectionV1";
const STORE_RESULTS_LEGACY_KEY = "ozonStoreQualifiedProductsV1";
const STORE_RESULTS_INDEX_KEY = "ozonStoreQualifiedProductsIndexV2";
const STORE_RESULTS_MIGRATION_KEY = "ozonStoreQualifiedProductsMigratedV2";
const BATCH_KEY = "ozonStoreBatchV1";
const BATCH_NEXT_ALARM = "ozonStoreBatchNext";
const BATCH_MAX_STORES = 50;
const BATCH_RETRY_LIMIT = 2;
const BATCH_COOLDOWN_MS = 8000;
const BATCH_ALARM_FALLBACK_MS = 30000;
const BATCH_START_DELAY_MS = 2500;
const BATCH_RELOAD_SKIP_LIMIT = 2;
const ZERO_MATCH_OBSERVED_THRESHOLD = 500;
const AUTO_SKIP_OBSERVED_THRESHOLD = 1000;
const AUTO_SKIP_QUALIFIED_LIMIT = 3;
const autoInjectedTabs = new Set();
const temporaryProductTabs = new Set();
const enqueueBatchOperation = storeScannerCore.createSerializedExecutor();
const enqueueStoreOperation = storeScannerCore.createSerializedExecutor();
let batchCooldownTimer = null;

async function setStoreScanProtection(tabId, active) {
  if (!Number.isInteger(tabId)) throw new Error("无法识别店铺扫描标签页。");
  const alarmName = `${STORE_SCAN_ALARM_PREFIX}${tabId}`;
  const stored = await chrome.storage.session.get(STORE_SCAN_PROTECTION_KEY);
  const protections = stored[STORE_SCAN_PROTECTION_KEY] || {};
  const key = String(tabId);
  if (active) {
    if (!Object.prototype.hasOwnProperty.call(protections, key)) {
      const tab = await chrome.tabs.get(tabId);
      protections[key] = tab.autoDiscardable !== false;
    }
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    await chrome.alarms.create(alarmName, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(alarmName);
    const originalAutoDiscardable = Object.prototype.hasOwnProperty.call(protections, key) ? Boolean(protections[key]) : true;
    await chrome.tabs.update(tabId, { autoDiscardable: originalAutoDiscardable }).catch(() => null);
    delete protections[key];
  }
  await chrome.storage.session.set({ [STORE_SCAN_PROTECTION_KEY]: protections });
  return { ok: true, active: Boolean(active) };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productSkuFromUrl(value) {
  const normalized = blackPriceCore.normalizeProductUrl(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).pathname.match(/-(\d+)\/?$/)?.[1] || "";
  } catch {
    return "";
  }
}

async function waitForOzonProductNavigation(tabId, expectedSku, timeoutMs = 20000, label = "Ozon商品页") {
  const targetSku = String(expectedSku || "").trim();
  const startedAt = Date.now();
  let lastUrl = "";
  let lastSku = "";
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) throw new Error(`${label}在加载完成前被关闭。`);
    lastUrl = String(tab.url || "");
    lastSku = productSkuFromUrl(lastUrl);
    if (!targetSku || lastSku === targetSku) {
      const probe = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ href: location.href, readyState: document.readyState }),
      }).catch(() => null);
      const documentState = probe?.[0]?.result || {};
      const documentSku = productSkuFromUrl(documentState.href);
      if ((!targetSku || documentSku === targetSku) && ["interactive", "complete"].includes(documentState.readyState)) return tab;
    }
    await wait(150);
  }
  const observed = lastSku ? `，当前地址SKU ${lastSku}` : "";
  throw new Error(`${label}未在${Math.ceil(timeoutMs / 1000)}秒内进入任务SKU ${targetSku || "-"}${observed}`);
}

function waitForTabLoaded(tabId, timeoutMs = 15000, label = "核价页") {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removedListener);
      clearTimeout(timer);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        finish();
      }
    };
    const removedListener = (removedTabId) => {
      if (removedTabId === tabId) finish(new Error(`${label}在加载完成前被关闭。`));
    };
    const timer = setTimeout(() => finish(new Error(`${label}加载超时，请检查网络后重试。`)), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removedListener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) finish(new Error(`无法读取${label}状态。`));
      else if (tab?.status === "complete") finish();
    });
  });
}

async function findOrOpenPricingTab() {
  const tabs = await chrome.tabs.query({ url: TARGET_MATCH });
  if (tabs[0]?.id) return tabs[0];
  const tab = await chrome.tabs.create({ url: TARGET_URL, active: false });
  await waitForTabLoaded(tab.id);
  await wait(800);
  return tab;
}

async function injectPricingContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function injectCurrentOzonTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !/^https:\/\/www\.ozon\.ru\//.test(tab.url || "")) {
    throw new Error("请先打开 OZON 商品详情页或店铺页，再点击启动采集。");
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["black-price-core.js", "content.js", "store-scanner-core.js", "store-scanner.js"],
  });
  return { ok: true };
}

async function probeOriginalBlackPrice(timeoutMs) {
  const parseNumber = (value) => {
    let text = String(value || "").replace(/[¥￥₽%]/g, "").replace(/[\u00a0\u202f]/g, " ").trim();
    const match = text.match(/-?[\d\s.,]+/);
    if (!match) return 0;
    text = match[0].replace(/\s+/g, "");
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : ".";
      text = text.replace(new RegExp(`\\${decimal === "," ? "." : ","}`, "g"), "").replace(decimal, ".");
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
    else if (comma >= 0) text = text.replace(",", ".");
    const result = Number(text);
    return Number.isFinite(result) ? result : 0;
  };
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const isGreen = (element) => {
    for (let node = element, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const style = getComputedStyle(node);
      for (const value of [style.color, style.backgroundColor]) {
        const rgb = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!rgb) continue;
        const [r, g, b] = rgb.slice(1).map(Number);
        if (g >= 120 && g > r * 1.25 && g > b * 1.15) return true;
      }
    }
    return false;
  };
  const readOnce = () => {
    const widgets = [...document.querySelectorAll('[data-widget="webPrice"]')].filter(isVisible);
    for (const widget of widgets) {
      const direct = [...widget.querySelectorAll("span.pdp_h0b")]
        .filter((element) => isVisible(element) && !element.closest("#mz-black-price-tag"))
        .map((element) => parseNumber(element.textContent))
        .find((value) => value > 0);
      if (direct) return direct;
      const prices = [...widget.querySelectorAll("span")]
        .filter((element) => isVisible(element) && !element.closest("#mz-black-price-tag"))
        .map((element) => ({ element, value: parseNumber(element.textContent) }))
        .filter((entry) => entry.value > 0 && /[¥￥₽]/.test(entry.element.textContent || ""));
      const greenIndex = prices.findIndex((entry) => isGreen(entry.element));
      if (greenIndex >= 0) {
        const black = prices.slice(greenIndex + 1).find((entry) => !isGreen(entry.element));
        if (black) return black.value;
      }
    }
    return 0;
  };
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = readOnce();
    if (value > 0) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return 0;
}

async function readOriginalBlackPriceAsSoonAsAvailable(tabId, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: probeOriginalBlackPrice,
        args: [Math.min(900, Math.max(250, remainingMs))],
      });
      const blackPrice = Number(results?.[0]?.result || 0);
      if (blackPrice > 0) return blackPrice;
    } catch {
      // The new tab may still be switching from its initial document to Ozon.
      // Retry immediately instead of waiting for the whole page to finish loading.
    }
    await wait(120);
  }
  return 0;
}

async function readBlackPriceFromProductUrl(rawUrl) {
  const url = blackPriceCore.normalizeProductUrl(rawUrl);
  if (!url) throw new Error("跟卖商品链接无效，黑标价已留空。");
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    temporaryProductTabs.add(tab.id);
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => null);
    const blackPrice = await readOriginalBlackPriceAsSoonAsAvailable(tab.id, 8000);
    if (!(blackPrice > 0)) throw new Error("8秒内未读取到跟卖商品页原始黑价，已保留手工填写。");
    return { ok: true, blackPrice, url };
  } finally {
    if (tab?.id) {
      temporaryProductTabs.delete(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => null);
    }
  }
}

function probeMainImageCandidates() {
  const candidates = [];
  const add = (url, source, image = null, visible = true) => {
    if (!url) return;
    const rect = image?.getBoundingClientRect?.() || { width: 0, height: 0 };
    candidates.push({
      url: String(url),
      source,
      width: Math.round(rect.width || 0),
      height: Math.round(rect.height || 0),
      naturalWidth: Number(image?.naturalWidth || 0),
      naturalHeight: Number(image?.naturalHeight || 0),
      visible,
    });
  };
  const addImageValue = (value, source) => {
    if (Array.isArray(value)) value.forEach((entry) => addImageValue(entry, source));
    else if (typeof value === "string") add(value, source);
    else if (value && typeof value === "object") addImageValue(value.url || value.contentUrl, source);
  };
  const visitJson = (value) => {
    if (Array.isArray(value)) return value.forEach(visitJson);
    if (!value || typeof value !== "object") return;
    const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (type.some((entry) => /product/i.test(String(entry || "")))) addImageValue(value.image, "jsonld");
    Object.values(value).forEach((entry) => {
      if (entry && typeof entry === "object") visitJson(entry);
    });
  };

  add(document.querySelector('meta[property="og:image"]')?.content, "og:image");
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visitJson(JSON.parse(script.textContent || "null")); } catch { /* Ignore incomplete structured data. */ }
  }
  const likelyProductImage = (candidate) => /^https:\/\/(?:[^./]+\.)*(?:ozone|ozon)\.ru\/s3\/multimedia-/i.test(String(candidate?.url || ""));
  if (candidates.some(likelyProductImage)) return candidates;

  const galleryImages = [...document.querySelectorAll('[data-widget="webGallery"] img, [data-widget*="gallery" i] img')];
  const imagePool = galleryImages.length ? galleryImages : [...document.images].slice(0, 120);
  for (const image of imagePool) {
    const rect = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    const inGallery = Boolean(image.closest('[data-widget="webGallery"], [data-widget*="gallery" i]'));
    const source = inGallery ? "gallery" : "image";
    add(image.currentSrc || image.src, source, image, visible);
    const srcset = String(image.getAttribute("srcset") || "");
    srcset.split(",").forEach((entry) => add(entry.trim().split(/\s+/)[0], inGallery ? "gallery" : "picture", image, visible));
    for (const pictureSource of image.closest("picture")?.querySelectorAll("source[srcset]") || []) {
      String(pictureSource.getAttribute("srcset") || "").split(",").forEach((entry) => add(entry.trim().split(/\s+/)[0], inGallery ? "gallery" : "picture", image, visible));
    }
  }
  return candidates;
}

async function readMainImageAsSoonAsAvailable(tabId, timeoutMs = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      // Keep the proven 0.6.12 behavior: allow Chrome to finish the current
      // document injection instead of cutting it off and losing a valid image.
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: probeMainImageCandidates });
      const selected = mainImageCore.chooseBestCandidate(results?.[0]?.result || []);
      if (selected?.url) return { ...selected, elapsedMs: Date.now() - startedAt };
    } catch {
      // The tab may still be switching from the initial document to Ozon.
    }
    await wait(150);
  }
  return null;
}

async function readMainImageFromProductUrl(rawUrl) {
  const url = blackPriceCore.normalizeProductUrl(rawUrl);
  if (!url) throw new Error("Ozon商品链接无效，主图未补齐。");
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    temporaryProductTabs.add(tab.id);
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => null);
    const startedAt = Date.now();
    const image = await readMainImageAsSoonAsAvailable(tab.id, 6000);
    if (!image?.url) {
      const error = new Error("后台商品页未读取到Ozon主图，可稍后重试或手工补齐。");
      error.elapsedMs = Date.now() - startedAt;
      throw error;
    }
    return { ok: true, imageUrl: image.url, source: image.source, route: "tab-reliable", elapsedMs: image.elapsedMs, url };
  } finally {
    if (tab?.id) {
      temporaryProductTabs.delete(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => null);
    }
  }
}

async function injectTaskPricingCollector(tabId, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["black-price-core.js", "content.js"] });
      return;
    } catch {
      await wait(150);
    }
  }
  throw new Error("Ozon商品页核价采集器未能启动");
}

async function collectTaskPricingSnapshot(tabId, task) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await injectTaskPricingCollector(tabId);
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: "collectOzonTaskPricingSnapshot",
        hints: {
          sku: String(task?.ozon?.sku || ""),
        },
      });
    } catch (error) {
      lastError = error;
      await wait(200);
    }
  }
  throw new Error(lastError?.message || "无法连接Ozon商品页核价采集器");
}

async function readOzonTaskPricing(rawTask) {
  const task = rawTask && typeof rawTask === "object" ? rawTask : {};
  const url = blackPriceCore.normalizeProductUrl(task?.ozon?.productUrl);
  if (!url) throw new Error("任务缺少有效Ozon商品链接");
  const startedAt = Date.now();
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    temporaryProductTabs.add(tab.id);
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => null);
    await waitForOzonProductNavigation(tab.id, task?.ozon?.sku, 20000, "任务商品页");
    const snapshotResponse = await collectTaskPricingSnapshot(tab.id, task);
    if (!snapshotResponse?.ok) throw new Error(snapshotResponse?.error || "Ozon商品页核价信息读取失败");
    const snapshot = snapshotResponse.snapshot || {};
    const sourceUrl = blackPriceCore.normalizeProductUrl(snapshot.sourceUrl || url);
    if (!sourceUrl) throw new Error("未能定位绿标价对应的商品来源链接");
    let blackPrice = Number(snapshot.currentBlackPrice || 0);
    if (snapshot.source === "competitor") {
      await chrome.tabs.update(tab.id, { url: sourceUrl, active: false });
      await waitForOzonProductNavigation(tab.id, productSkuFromUrl(sourceUrl), 20000, "最低跟卖商品页");
      blackPrice = await readOriginalBlackPriceAsSoonAsAvailable(tab.id, 8000);
    } else if (!(blackPrice > 0)) {
      blackPrice = await readOriginalBlackPriceAsSoonAsAvailable(tab.id, 5000);
    }
    if (!(blackPrice > 0)) throw new Error("未读取到有效绿标来源商品的原始黑标价");
    const pricing = taskPricingCore.buildTaskPricing(task, snapshot, blackPrice, sourceUrl);
    return { ok: true, ...pricing, elapsedMs: Date.now() - startedAt, sourceProductUrl: sourceUrl };
  } finally {
    if (tab?.id) {
      temporaryProductTabs.delete(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => null);
    }
  }
}

async function setAutoInject(enabled) {
  await chrome.storage.session.set({ [AUTO_INJECT_KEY]: Boolean(enabled) });
  return { ok: true, enabled: Boolean(enabled) };
}

async function getAutoInject() {
  const stored = await chrome.storage.session.get(AUTO_INJECT_KEY);
  return { ok: true, enabled: Boolean(stored[AUTO_INJECT_KEY]) };
}

async function autoInjectOzonTab(tabId, url) {
  if (!/^https:\/\/www\.ozon\.ru\//.test(url || "")) return;
  if (temporaryProductTabs.has(tabId)) return;
  const stored = await chrome.storage.session.get(AUTO_INJECT_KEY);
  if (!stored[AUTO_INJECT_KEY]) return;
  autoInjectedTabs.add(tabId);
  const tryInject = async (delayMs) => {
    await wait(delayMs);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id || tab.url !== url || !autoInjectedTabs.has(tabId)) return false;
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["black-price-core.js", "content.js", "store-scanner-core.js", "store-scanner.js"],
    }).then(() => true).catch(() => false);
    if (result) autoInjectedTabs.delete(tabId);
    return result;
  };
  const injected = await tryInject(AUTO_INJECT_DELAY_MS);
  if (!injected) await tryInject(AUTO_INJECT_RETRY_DELAY_MS);
}

async function sendToPricing(product) {
  const tab = await findOrOpenPricingTab();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await chrome.tabs
      .sendMessage(tab.id, { type: "deliverProductToPricing", product })
      .catch(() => null);
    if (response?.ok) {
      await chrome.tabs.update(tab.id, { active: true });
      return response;
    }
    if (attempt === 1) {
      await injectPricingContentScript(tab.id).catch(() => null);
    }
    await wait(500);
  }
  throw new Error("核价页已打开，但扩展没有连接上。请关闭核价页后重新发送，或在扩展管理页重新加载插件。");
}

async function getBatch() {
  return (await chrome.storage.local.get(BATCH_KEY))[BATCH_KEY] || null;
}

async function saveBatch(batch) {
  batch.revision = (Number(batch.revision) || 0) + 1;
  batch.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [BATCH_KEY]: batch });
  return batch;
}

async function ensureStoreStorageMigrated() {
  const seed = await chrome.storage.local.get([STORE_RESULTS_LEGACY_KEY, STORE_RESULTS_INDEX_KEY, STORE_RESULTS_MIGRATION_KEY]);
  if (seed[STORE_RESULTS_MIGRATION_KEY]) return seed[STORE_RESULTS_INDEX_KEY] || [];
  const legacyStores = seed[STORE_RESULTS_LEGACY_KEY] || {};
  const sellerKeys = [...new Set([...(seed[STORE_RESULTS_INDEX_KEY] || []), ...Object.keys(legacyStores)].map(String).filter(Boolean))];
  const resultKeys = sellerKeys.map((sellerKey) => storeScannerCore.storeResultStorageKey(sellerKey));
  const existing = resultKeys.length ? await chrome.storage.local.get(resultKeys) : {};
  const updates = {
    [STORE_RESULTS_INDEX_KEY]: sellerKeys,
    [STORE_RESULTS_MIGRATION_KEY]: { migratedAt: new Date().toISOString(), storeCount: sellerKeys.length },
  };
  sellerKeys.forEach((sellerKey) => {
    const storageKey = storeScannerCore.storeResultStorageKey(sellerKey);
    updates[storageKey] = storeScannerCore.mergeStoreState(existing[storageKey], legacyStores[sellerKey]);
  });
  await chrome.storage.local.set(updates);
  const verified = resultKeys.length ? await chrome.storage.local.get(resultKeys) : {};
  if (resultKeys.every((key) => verified[key])) await chrome.storage.local.remove(STORE_RESULTS_LEGACY_KEY);
  return sellerKeys;
}

async function readStoreResult(sellerKey) {
  await ensureStoreStorageMigrated();
  const storageKey = storeScannerCore.storeResultStorageKey(sellerKey);
  return storageKey ? (await chrome.storage.local.get(storageKey))[storageKey] || null : null;
}

async function writeStoreResult(sellerKey, state, mode = "merge") {
  const key = String(sellerKey || "");
  const storageKey = storeScannerCore.storeResultStorageKey(key);
  if (!storageKey) throw new Error("无法识别店铺记录。 ");
  const sellerKeys = await ensureStoreStorageMigrated();
  const existing = (await chrome.storage.local.get(storageKey))[storageKey] || {};
  const next = mode === "replace" ? { ...state } : storeScannerCore.mergeStoreState(existing, state);
  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({
    [storageKey]: next,
    [STORE_RESULTS_INDEX_KEY]: [...new Set([...sellerKeys, key])],
  });
  return next;
}

async function clearStoreResult(sellerKey) {
  return enqueueStoreOperation(async () => {
    const sellerKeys = await ensureStoreStorageMigrated();
    const storageKey = storeScannerCore.storeResultStorageKey(sellerKey);
    if (storageKey) await chrome.storage.local.remove(storageKey);
    await chrome.storage.local.set({ [STORE_RESULTS_INDEX_KEY]: sellerKeys.filter((key) => key !== sellerKey) });
  });
}

async function getStoreScanState(message = {}) {
  const state = await enqueueStoreOperation(() => readStoreResult(String(message.sellerKey || "")));
  return { ok: true, state };
}

async function saveStoreScanState(message = {}) {
  const state = await enqueueStoreOperation(() => writeStoreResult(String(message.sellerKey || ""), message.state || {}, message.mode));
  return { ok: true, state };
}

async function enrichStoreProductBySku(message = {}) {
  const sku = String(message.sku || "").trim();
  const competitor = String(message.competitor || "").trim();
  if (!sku || !competitor) return { ok: true, updatedStores: 0 };
  const updatedStores = await enqueueStoreOperation(async () => {
    const sellerKeys = await ensureStoreStorageMigrated();
    let changed = 0;
    for (const sellerKey of sellerKeys) {
      const storageKey = storeScannerCore.storeResultStorageKey(sellerKey);
      const state = (await chrome.storage.local.get(storageKey))[storageKey];
      const saved = state?.products?.[sku];
      if (!saved || (saved.competitor === competitor && saved.competitorReady)) continue;
      const next = {
        ...state,
        products: { ...state.products, [sku]: { ...saved, competitor, competitorReady: true } },
        updatedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ [storageKey]: next });
      changed += 1;
    }
    return changed;
  });
  return { ok: true, updatedStores };
}

async function getBatchStoreResults(message = {}) {
  const sellerKeys = [...new Set((message.sellerKeys || []).map(String).filter(Boolean))];
  const stores = await enqueueStoreOperation(async () => {
    await ensureStoreStorageMigrated();
    const storageKeys = sellerKeys.map((sellerKey) => storeScannerCore.storeResultStorageKey(sellerKey));
    const stored = storageKeys.length ? await chrome.storage.local.get(storageKeys) : {};
    return Object.fromEntries(sellerKeys.map((sellerKey, index) => [sellerKey, stored[storageKeys[index]] || { products: {} }]));
  });
  return { ok: true, stores };
}

function nextPendingIndex(batch, fromIndex = 0) {
  for (let index = Math.max(0, fromIndex); index < batch.stores.length; index += 1) {
    if (["pending", "retrying", "loading", "recovering", "scanning"].includes(batch.stores[index].status)) return index;
  }
  return -1;
}

function clearBatchCooldownTimer() {
  if (batchCooldownTimer) clearTimeout(batchCooldownTimer);
  batchCooldownTimer = null;
}

async function disarmBatchCooldown() {
  clearBatchCooldownTimer();
  await chrome.alarms.clear(BATCH_NEXT_ALARM);
}

async function armBatchCooldown(batch) {
  clearBatchCooldownTimer();
  const dueAt = Number(batch?.nextRunAt) || 0;
  if (!dueAt || batch?.status !== "running") return;
  const remaining = Math.max(0, dueAt - Date.now());
  batchCooldownTimer = setTimeout(() => {
    batchCooldownTimer = null;
    batchOperation(() => continueBatchAfterCooldown({ batchId: batch.id, dueAt, source: "background-timer" }))
      .catch((error) => batchOperation(() => failCurrentBatchStore(error.message || String(error))));
  }, remaining);
  if (batch.tabId) {
    chrome.tabs.sendMessage(batch.tabId, { type: "armBatchCooldown", batchId: batch.id, dueAt }).catch(() => null);
  }
  await chrome.alarms.clear(BATCH_NEXT_ALARM);
  await chrome.alarms.create(BATCH_NEXT_ALARM, { when: Math.max(dueAt, Date.now() + BATCH_ALARM_FALLBACK_MS) });
}

async function continueBatchAfterCooldown(message = {}, sender = {}) {
  const batch = await getBatch();
  if (!batch || batch.status !== "running" || !batch.nextRunAt) return { ok: true, ignored: true, batch };
  if (message.batchId && message.batchId !== batch.id) return { ok: true, ignored: true, batch };
  if (message.dueAt && Number(message.dueAt) !== Number(batch.nextRunAt)) return { ok: true, ignored: true, batch };
  if (sender.tab?.id && sender.tab.id !== batch.tabId) return { ok: true, ignored: true, batch };
  if (Date.now() + 50 < Number(batch.nextRunAt)) {
    await armBatchCooldown(batch);
    return { ok: true, early: true, batch };
  }
  batch.nextRunAt = 0;
  batch.message = "店铺间隔已结束，正在进入下一家。";
  await saveBatch(batch);
  await disarmBatchCooldown();
  try {
    await runCurrentBatchStore();
  } catch (error) {
    await failCurrentBatchStore(error.message || String(error));
  }
  return { ok: true, batch: await getBatch() };
}

async function scheduleBatchNext(batch, sameStore = false, message = "") {
  if (!sameStore) batch.currentIndex += 1;
  const nextIndex = nextPendingIndex(batch, batch.currentIndex);
  if (nextIndex < 0) {
    batch.status = "completed";
    batch.currentIndex = batch.stores.length;
    batch.nextRunAt = 0;
    batch.message = "全部店铺已处理完成，可以导出汇总结果。";
    await saveBatch(batch);
    await disarmBatchCooldown();
    return;
  }
  batch.currentIndex = nextIndex;
  batch.nextRunAt = Date.now() + BATCH_COOLDOWN_MS;
  batch.message = message || `等待 ${BATCH_COOLDOWN_MS / 1000} 秒后处理下一家店铺。`;
  await saveBatch(batch);
  await armBatchCooldown(batch);
}

async function runCurrentBatchStore() {
  const batch = await getBatch();
  if (!batch || batch.status !== "running") return;
  const index = nextPendingIndex(batch, batch.currentIndex);
  if (index < 0) {
    await scheduleBatchNext(batch, true);
    return;
  }
  batch.currentIndex = index;
  const task = batch.stores[index];
  if (batch.options?.clearExisting !== false && task.attempts === 0) await clearStoreResult(task.sellerKey);
  task.status = "loading";
  task.phase = "loading";
  task.attempts += 1;
  task.attemptId = `${batch.id}:${task.sellerKey}:${task.attempts}:${Date.now()}`;
  task.attemptObservedSkus = [];
  task.runObservedCount = 0;
  task.needsRecovery = false;
  task.startedAt = task.startedAt || new Date().toISOString();
  task.error = "";
  batch.message = `正在打开第 ${index + 1}/${batch.stores.length} 家店铺。`;
  let tab = Number.isInteger(batch.tabId) ? await chrome.tabs.get(batch.tabId).catch(() => null) : null;
  if (tab?.id) {
    await saveBatch(batch);
    await chrome.tabs.update(tab.id, { url: task.url, active: false });
  }
  else {
    tab = await chrome.tabs.create({ url: task.url, active: true });
    batch.tabId = tab.id;
    await saveBatch(batch);
  }
}

async function failCurrentBatchStore(errorMessage) {
  const batch = await getBatch();
  if (!batch || batch.status !== "running") return;
  const task = batch.stores[batch.currentIndex];
  if (!task) return;
  task.error = errorMessage || "扫描未完成";
  task.note = "";
  task.completedAt = new Date().toISOString();
  if (task.attempts <= (batch.options?.retryLimit ?? BATCH_RETRY_LIMIT)) {
    task.status = "retrying";
    task.phase = "retrying";
    batch.message = `第 ${batch.currentIndex + 1} 家店铺未完成，将自动重试。`;
    await scheduleBatchNext(batch, true);
    return;
  }
  task.status = task.observedCount > 0 ? "partial" : "failed";
  task.phase = task.status;
  batch.message = `第 ${batch.currentIndex + 1} 家店铺已达到重试上限，继续下一家。`;
  await scheduleBatchNext(batch, false);
}

async function launchBatchScanner(tabId, url) {
  const batch = await getBatch();
  if (!batch || batch.status !== "running" || batch.tabId !== tabId) return;
  if (batch.nextRunAt) {
    if (/^https:\/\/www\.ozon\.ru\/seller\//.test(url || "")) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["black-price-core.js", "content.js", "store-scanner-core.js", "store-scanner.js"] }).catch(() => null);
      await armBatchCooldown(batch);
    }
    return;
  }
  const task = batch.stores[batch.currentIndex];
  if (!task || (!task.needsRecovery && !["loading", "recovering"].includes(task.status)) || storeScannerCore.sellerKeyFromUrl(url) !== task.sellerKey) return;
  await wait(BATCH_START_DELAY_MS);
  const latest = await getBatch();
  const pendingLaunchTask = latest?.stores?.[latest.currentIndex];
  if (!latest || latest.status !== "running" || latest.tabId !== tabId || latest.currentIndex !== batch.currentIndex || (!pendingLaunchTask?.needsRecovery && !["loading", "recovering"].includes(pendingLaunchTask?.status))) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["black-price-core.js", "content.js", "store-scanner-core.js", "store-scanner.js"] });
    const latestTask = latest.stores[latest.currentIndex];
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "startStoreScan",
      batchId: latest.id,
      attemptId: latestTask.attemptId,
      attemptObservedSkus: latestTask.attemptObservedSkus || [],
    }).catch(() => null);
    if (!response?.ok) throw new Error(response?.error || "店铺扫描面板未能启动");
    const refreshed = await getBatch();
    const current = refreshed?.stores?.[refreshed.currentIndex];
    if (!refreshed || refreshed.id !== latest.id || current?.sellerKey !== task.sellerKey || current?.attemptId !== latestTask.attemptId) return;
    current.status = "scanning";
    current.phase = "scanning";
    current.needsRecovery = false;
    refreshed.message = task.status === "recovering"
      ? `页面重新加载后，已自动恢复第 ${refreshed.currentIndex + 1}/${refreshed.stores.length} 家店铺。`
      : `正在扫描第 ${refreshed.currentIndex + 1}/${refreshed.stores.length} 家店铺。`;
    await saveBatch(refreshed);
  } catch (error) {
    await failCurrentBatchStore(error.message || String(error));
  }
}

async function startStoreBatch(message) {
  const parsed = storeScannerCore.parseStoreUrlList((message.urls || []).join("\n"), BATCH_MAX_STORES);
  if (!parsed.urls.length) throw new Error("没有识别到有效的 Ozon 店铺地址。");
  const oldBatch = await getBatch();
  const oldTask = oldBatch?.stores?.[oldBatch.currentIndex];
  if (oldBatch?.tabId && ["loading", "recovering", "scanning"].includes(oldTask?.status)) {
    await chrome.tabs.sendMessage(oldBatch.tabId, { type: "stopStoreScan", silent: true }).catch(() => null);
  }
  await disarmBatchCooldown();
  const now = new Date().toISOString();
  const batch = {
    id: `batch-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    status: "running",
    currentIndex: 0,
    tabId: null,
    nextRunAt: 0,
    message: "批量任务已创建。",
    options: { retryLimit: BATCH_RETRY_LIMIT, cooldownMs: BATCH_COOLDOWN_MS, clearExisting: message.clearExisting !== false },
    revision: 0,
    stores: parsed.urls.map((url) => ({ sellerKey: storeScannerCore.sellerKeyFromUrl(url), url, status: "pending", attempts: 0, attemptId: "", attemptObservedSkus: [], runObservedCount: 0, needsRecovery: false, observedCount: 0, qualifiedCount: 0, pendingCount: 0, phase: "pending", health: "normal", noNewSkuScreens: 0, lastNewSkuAt: "", lastProgressAt: "", reloadCount: 0, error: "", note: "", startedAt: "", completedAt: "" })),
  };
  await saveBatch(batch);
  await runCurrentBatchStore();
  return { ok: true, batch: await getBatch(), parse: parsed };
}

async function updateBatchProgress(message, sender) {
  const batch = await getBatch();
  if (!batch || batch.status !== "running" || batch.id !== message.batchId || batch.tabId !== sender.tab?.id) return { ok: false };
  const task = batch.stores[batch.currentIndex];
  if (!task || task.sellerKey !== message.sellerKey || task.attemptId !== message.attemptId || !["loading", "recovering", "scanning"].includes(task.status)) return { ok: false };
  task.status = "scanning";
  task.observedCount = Number(message.observedCount) || 0;
  task.attemptObservedSkus = storeScannerCore.mergeAttemptObservedSkus(task.attemptObservedSkus, message.attemptObservedSkuDelta || message.attemptObservedSkus);
  task.runObservedCount = task.attemptObservedSkus.length;
  task.qualifiedCount = Number(message.qualifiedCount) || 0;
  task.pendingCount = Number(message.pendingCount) || 0;
  task.phase = String(message.phase || task.phase || "scanning");
  task.health = message.stalled ? "stalled" : "normal";
  task.noNewSkuScreens = Math.max(0, Number(message.noNewSkuScreens) || 0);
  task.lastNewSkuAt = String(message.lastNewSkuAt || task.lastNewSkuAt || "");
  task.lastProgressAt = new Date().toISOString();
  const autoSkip = storeScannerCore.autoSkipDisposition(task.runObservedCount, task.qualifiedCount, ZERO_MATCH_OBSERVED_THRESHOLD, AUTO_SKIP_OBSERVED_THRESHOLD, AUTO_SKIP_QUALIFIED_LIMIT);
  if (autoSkip) {
    task.status = "skipped";
    task.phase = "skipped";
    task.health = "normal";
    task.error = "";
    task.note = autoSkip.code === "zero-match-500"
      ? `自动提前跳过：本轮已查看${task.runObservedCount}个，符合要求0个`
      : `自动提前跳过：本轮已查看${task.runObservedCount}个，符合要求${task.qualifiedCount}个（少于${AUTO_SKIP_QUALIFIED_LIMIT}个）`;
    task.completedAt = new Date().toISOString();
    task.attemptObservedSkus = [];
    const skipMessage = autoSkip.code === "zero-match-500"
      ? `第 ${batch.currentIndex + 1} 家店铺已查看500个仍无符合要求商品，已自动提前跳过。`
      : `第 ${batch.currentIndex + 1} 家店铺符合要求商品过少，已自动提前跳过。`;
    batch.message = skipMessage;
    await saveBatch(batch);
    if (batch.tabId) await chrome.tabs.sendMessage(batch.tabId, { type: "stopStoreScan", silent: true }).catch(() => null);
    await scheduleBatchNext(batch, false, `${skipMessage} 等待 ${BATCH_COOLDOWN_MS / 1000} 秒后处理下一家店铺。`);
    return { ok: true, autoSkipped: true };
  }
  batch.message = message.message || batch.message;
  await saveBatch(batch);
  return { ok: true };
}

async function finishBatchStore(message, sender) {
  const batch = await getBatch();
  if (!batch || batch.id !== message.batchId || batch.tabId !== sender.tab?.id) return { ok: false };
  const task = batch.stores[batch.currentIndex];
  if (!task || task.sellerKey !== message.sellerKey || task.attemptId !== message.attemptId) return { ok: false };
  task.observedCount = Number(message.observedCount) || 0;
  task.attemptObservedSkus = storeScannerCore.mergeAttemptObservedSkus(task.attemptObservedSkus, message.attemptObservedSkuDelta || message.attemptObservedSkus);
  task.runObservedCount = task.attemptObservedSkus.length;
  task.qualifiedCount = Number(message.qualifiedCount) || 0;
  task.pendingCount = Number(message.pendingCount) || 0;
  task.completedAt = new Date().toISOString();
  if (message.reason === "manual-stop") {
    task.status = "pending";
    task.phase = "pending";
    task.attempts = Math.max(0, task.attempts - 1);
    task.attemptObservedSkus = [];
    batch.status = "paused";
    batch.message = "当前店铺由用户停止，批量任务已暂停。";
    await saveBatch(batch);
    return { ok: true };
  }
  if (!message.complete) {
    await saveBatch(batch);
    await failCurrentBatchStore(message.message || "店铺未完成末尾确认");
    return { ok: true };
  }
  task.status = "completed";
  task.phase = "completed";
  task.health = "normal";
  task.error = "";
  task.note = "";
  task.attemptObservedSkus = [];
  await scheduleBatchNext(batch, false);
  return { ok: true };
}

async function pauseStoreBatch() {
  const batch = await getBatch();
  if (!batch) throw new Error("当前没有批量任务。");
  batch.status = "paused";
  batch.nextRunAt = 0;
  batch.message = "批量任务已暂停，可稍后继续。";
  const task = batch.stores[batch.currentIndex];
  const wasActive = task && ["loading", "recovering", "scanning"].includes(task.status);
  if (wasActive) {
    task.status = "pending";
    task.phase = "pending";
    task.attempts = Math.max(0, task.attempts - 1);
  }
  await disarmBatchCooldown();
  if (wasActive && batch.tabId) await chrome.tabs.sendMessage(batch.tabId, { type: "stopStoreScan", silent: true }).catch(() => null);
  await saveBatch(batch);
  return { ok: true, batch };
}

async function resumeStoreBatch() {
  const batch = await getBatch();
  if (!batch) throw new Error("当前没有可继续的批量任务。");
  if (batch.currentIndex >= batch.stores.length) throw new Error("这个批量任务已经全部完成。");
  const task = batch.stores[batch.currentIndex];
  if (["loading", "recovering", "scanning"].includes(task?.status)) {
    task.status = "pending";
    task.phase = "pending";
  }
  batch.nextRunAt = 0;
  batch.status = "running";
  batch.message = "正在恢复批量任务。";
  await disarmBatchCooldown();
  await saveBatch(batch);
  await runCurrentBatchStore();
  return { ok: true, batch: await getBatch() };
}

async function stopStoreBatch() {
  const batch = await getBatch();
  if (!batch) throw new Error("当前没有批量任务。");
  batch.status = "stopped";
  batch.nextRunAt = 0;
  batch.message = "批量任务已停止，已完成结果仍可导出。";
  const task = batch.stores[batch.currentIndex];
  const wasActive = task && ["loading", "recovering", "scanning"].includes(task.status);
  if (wasActive) {
    task.status = "pending";
    task.phase = "pending";
    task.attempts = Math.max(0, task.attempts - 1);
  }
  await disarmBatchCooldown();
  if (wasActive && batch.tabId) await chrome.tabs.sendMessage(batch.tabId, { type: "stopStoreScan", silent: true }).catch(() => null);
  await saveBatch(batch);
  return { ok: true, batch };
}

async function clearStoreBatch(message = {}) {
  const batch = await getBatch();
  if (!batch) return { ok: true, batch: null, cleared: false };
  if (message.batchId && message.batchId !== batch.id) throw new Error("批量任务已经变化，请刷新页面后重试。");
  const task = batch.stores?.[batch.currentIndex];
  const wasActive = batch.status === "running" || ["loading", "recovering", "scanning", "retrying"].includes(task?.status);
  await disarmBatchCooldown();
  if (wasActive && batch.tabId) {
    await chrome.tabs.sendMessage(batch.tabId, { type: "stopStoreScan", silent: true }).catch(() => null);
  }
  if (batch.tabId) await setStoreScanProtection(batch.tabId, false).catch(() => null);
  await chrome.storage.local.remove(BATCH_KEY);
  return { ok: true, batch: null, cleared: true };
}

async function skipCurrentBatchStore(message = {}) {
  const batch = await getBatch();
  if (!batch || batch.currentIndex >= batch.stores.length) throw new Error("没有可跳过的店铺。");
  const task = batch.stores[batch.currentIndex];
  if (!["loading", "recovering", "scanning"].includes(task.status)) throw new Error("当前没有正在扫描的店铺，请等待下一家开始后再操作。");
  if (message.source === "store-panel" && message.sellerKey !== task.sellerKey) return { ok: true, batch };
  let finishContext = message;
  if (message.source !== "store-panel" && batch.tabId) {
    const live = await chrome.tabs.sendMessage(batch.tabId, { type: "getStoreScanStatus" }).catch(() => null);
    if (live?.ok && live.sellerKey === task.sellerKey) finishContext = { ...message, ...live };
  }
  if (Number.isFinite(Number(finishContext.observedCount))) task.observedCount = Number(finishContext.observedCount);
  task.attemptObservedSkus = storeScannerCore.mergeAttemptObservedSkus(task.attemptObservedSkus, finishContext.attemptObservedSkuDelta || finishContext.attemptObservedSkus);
  task.runObservedCount = task.attemptObservedSkus.length;
  if (Number.isFinite(Number(finishContext.qualifiedCount))) task.qualifiedCount = Number(finishContext.qualifiedCount);
  if (Number.isFinite(Number(finishContext.pendingCount))) task.pendingCount = Number(finishContext.pendingCount);
  const disposition = storeScannerCore.classifyStoreFinish({
    reviewing: Boolean(finishContext.reviewing),
    forwardReachedBoundary: Boolean(finishContext.forwardReachedBoundary),
    pendingCount: task.pendingCount,
  });
  task.status = disposition.status;
  task.phase = disposition.status;
  task.health = "normal";
  task.error = "";
  task.note = disposition.note;
  task.completedAt = new Date().toISOString();
  task.attemptObservedSkus = [];
  batch.status = "running";
  if (batch.tabId) await chrome.tabs.sendMessage(batch.tabId, { type: "stopStoreScan", silent: true, complete: disposition.complete }).catch(() => null);
  await scheduleBatchNext(batch, false);
  return { ok: true, batch: await getBatch() };
}

async function removeStoreBatchTask(message = {}) {
  const batch = await getBatch();
  if (!batch) throw new Error("当前没有批量任务。");
  if (message.batchId && message.batchId !== batch.id) throw new Error("批量任务已经变化，请刷新页面后重试。");
  const result = storeScannerCore.removeBatchStoreTask(batch, String(message.sellerKey || ""));
  if (!result.removed) throw new Error("没有找到要删除的店铺，请刷新页面后重试。");
  const wasActive = result.wasCurrent && ["loading", "recovering", "scanning"].includes(result.removed.status);
  if (wasActive && batch.tabId) await chrome.tabs.sendMessage(batch.tabId, { type: "stopStoreScan", silent: true }).catch(() => null);

  if (!batch.stores.length) {
    batch.status = "completed";
    batch.currentIndex = 0;
    batch.nextRunAt = 0;
    batch.message = "当前批次的店铺已全部删除。";
    await disarmBatchCooldown();
    await saveBatch(batch);
    return { ok: true, batch, removed: result.removed };
  }

  if (result.wasCurrent) {
    const nextIndex = nextPendingIndex(batch, batch.currentIndex);
    if (nextIndex < 0) {
      batch.status = "completed";
      batch.currentIndex = batch.stores.length;
      batch.nextRunAt = 0;
      batch.message = "删除当前店铺后，批次中没有尚待扫描的店铺。";
      await disarmBatchCooldown();
    } else {
      batch.currentIndex = nextIndex;
      if (batch.status === "running") {
        await scheduleBatchNext(batch, true, `已删除 ${result.removed.sellerKey}，等待 ${BATCH_COOLDOWN_MS / 1000} 秒后扫描下一家。`);
        return { ok: true, batch: await getBatch(), removed: result.removed };
      } else {
        batch.nextRunAt = 0;
        batch.message = `已删除 ${result.removed.sellerKey}；任务仍保持${batch.status === "paused" ? "暂停" : "停止"}。`;
      }
    }
  } else {
    batch.message = `已从当前批次删除 ${result.removed.sellerKey}。`;
  }
  await saveBatch(batch);
  return { ok: true, batch, removed: result.removed };
}

async function retryFailedBatchStores() {
  const batch = await getBatch();
  if (!batch) throw new Error("当前没有批量任务。");
  const indexes = [];
  batch.stores.forEach((task, index) => {
    if (["failed", "partial"].includes(task.status)) {
      task.status = "pending";
      task.phase = "pending";
      task.health = "normal";
      task.attempts = 0;
      task.attemptId = "";
      task.attemptObservedSkus = [];
      task.runObservedCount = 0;
      task.error = "";
      task.note = "";
      indexes.push(index);
    }
  });
  if (!indexes.length) throw new Error("没有失败或部分完成的店铺需要重试。");
  batch.currentIndex = indexes[0];
  batch.nextRunAt = 0;
  batch.status = "running";
  batch.message = "正在重新处理失败店铺。";
  await disarmBatchCooldown();
  await saveBatch(batch);
  await runCurrentBatchStore();
  return { ok: true, batch: await getBatch() };
}

async function resumeInterruptedBatch() {
  const batch = await getBatch();
  if (!batch || batch.status !== "running") return;
  if (batch.nextRunAt && Date.now() < Number(batch.nextRunAt)) {
    batch.message = `浏览器恢复后继续等待店铺间隔，剩余约 ${Math.max(1, Math.ceil((Number(batch.nextRunAt) - Date.now()) / 1000))} 秒。`;
    await saveBatch(batch);
    await armBatchCooldown(batch);
    return;
  }
  if (batch.nextRunAt) {
    await continueBatchAfterCooldown({ batchId: batch.id, dueAt: batch.nextRunAt, source: "browser-resume" });
    return;
  }
  const task = batch.stores[batch.currentIndex];
  if (task && ["loading", "recovering", "scanning"].includes(task.status)) {
    task.status = "pending";
    task.phase = "pending";
  }
  batch.message = "浏览器恢复后继续批量任务。";
  await saveBatch(batch);
  await runCurrentBatchStore();
}

async function markBatchTabReloading(tabId) {
  const batch = await getBatch();
  if (!batch || batch.status !== "running" || batch.tabId !== tabId) return;
  const task = batch.stores[batch.currentIndex];
  if (!task || task.status !== "scanning") return;
  task.status = "recovering";
  task.needsRecovery = true;
  task.reloadCount = (Number(task.reloadCount) || 0) + 1;
  if (task.reloadCount >= BATCH_RELOAD_SKIP_LIMIT) {
    task.status = "skipped";
    task.phase = "skipped";
    task.needsRecovery = false;
    task.error = "";
    task.note = `页面连续刷新${BATCH_RELOAD_SKIP_LIMIT}次，已自动跳过当前店铺（保留已找到商品）。`;
    task.completedAt = new Date().toISOString();
    await chrome.tabs.sendMessage(tabId, { type: "stopStoreScan", silent: true }).catch(() => null);
    await scheduleBatchNext(batch, false, `第 ${batch.currentIndex + 1}/${batch.stores.length} 家店铺页面连续刷新${BATCH_RELOAD_SKIP_LIMIT}次，已自动跳过，等待 ${BATCH_COOLDOWN_MS / 1000} 秒后扫描下一家。`);
    return;
  }
  task.phase = "recovering";
  batch.message = `第 ${batch.currentIndex + 1}/${batch.stores.length} 家店铺页面正在重新加载（第 ${task.reloadCount}/${BATCH_RELOAD_SKIP_LIMIT} 次），完成后会自动续扫。`;
  await saveBatch(batch);
}

function batchOperation(operation) {
  return enqueueBatchOperation(operation);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation = null;
  if (message?.type === "setStoreScanProtection") operation = setStoreScanProtection(sender.tab?.id, Boolean(message.active));
  else if (message?.type === "activateOnCurrentOzonTab") operation = injectCurrentOzonTab();
  else if (message?.type === "setAutoInject") operation = setAutoInject(message.enabled);
  else if (message?.type === "getAutoInject") operation = getAutoInject();
  else if (message?.type === "sendProductToPricing") operation = sendToPricing(message.product || {});
  else if (message?.type === "readBlackPriceFromProductUrl") operation = readBlackPriceFromProductUrl(message.url);
  else if (message?.type === "readMainImageFromProductUrl") operation = readMainImageFromProductUrl(message.url);
  else if (message?.type === "readOzonTaskPricing") operation = readOzonTaskPricing(message.task);
  else if (message?.type === "getStoreScanState") operation = getStoreScanState(message);
  else if (message?.type === "saveStoreScanState") operation = saveStoreScanState(message);
  else if (message?.type === "enrichStoreProductBySku") operation = enrichStoreProductBySku(message);
  else if (message?.type === "getBatchStoreResults") operation = getBatchStoreResults(message);
  else if (message?.type === "openBatchManager") operation = chrome.tabs.create({ url: chrome.runtime.getURL("batch.html") }).then(() => ({ ok: true }));
  else if (message?.type === "openSourcingEnrichment") operation = chrome.tabs.create({ url: chrome.runtime.getURL("sourcing-enrichment.html") }).then(() => ({ ok: true }));
  else if (message?.type === "getStoreBatchState") operation = batchOperation(() => getBatch().then((batch) => ({ ok: true, batch })));
  else if (message?.type === "startStoreBatch") operation = batchOperation(() => startStoreBatch(message));
  else if (message?.type === "pauseStoreBatch") operation = batchOperation(() => pauseStoreBatch());
  else if (message?.type === "resumeStoreBatch") operation = batchOperation(() => resumeStoreBatch());
  else if (message?.type === "stopStoreBatch") operation = batchOperation(() => stopStoreBatch());
  else if (message?.type === "clearStoreBatch") operation = batchOperation(() => clearStoreBatch(message));
  else if (message?.type === "skipStoreBatchCurrent") operation = batchOperation(() => skipCurrentBatchStore(message));
  else if (message?.type === "removeStoreBatchTask") operation = batchOperation(() => removeStoreBatchTask(message));
  else if (message?.type === "retryFailedStoreBatch") operation = batchOperation(() => retryFailedBatchStores());
  else if (message?.type === "storeScanProgress") operation = batchOperation(() => updateBatchProgress(message, sender));
  else if (message?.type === "storeScanFinished") operation = batchOperation(() => finishBatchStore(message, sender));
  else if (message?.type === "batchCooldownElapsed") operation = batchOperation(() => continueBatchAfterCooldown(message, sender));
  if (!operation) return false;
  Promise.resolve(operation)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      ok: false,
      error: error.message || String(error),
      elapsedMs: Number(error?.elapsedMs || 0) || null,
    }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading") {
    autoInjectedTabs.delete(tabId);
    batchOperation(() => markBatchTabReloading(tabId)).catch(() => null);
  }
  if (info.status === "complete") {
    batchOperation(() => launchBatchScanner(tabId, tab.url)).catch((error) => batchOperation(() => failCurrentBatchStore(error.message || String(error))));
    autoInjectOzonTab(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoInjectedTabs.delete(tabId);
  temporaryProductTabs.delete(tabId);
  setStoreScanProtection(tabId, false).catch(() => {
    chrome.alarms.clear(`${STORE_SCAN_ALARM_PREFIX}${tabId}`);
  });
  batchOperation(async () => {
    const batch = await getBatch();
    if (!batch || batch.tabId !== tabId || batch.status !== "running") return;
    batch.tabId = null;
    batch.status = "paused";
    batch.nextRunAt = 0;
    batch.message = "专用扫描标签页被关闭，任务已暂停；点击继续会新建标签页。";
    const task = batch.stores[batch.currentIndex];
    if (task && ["loading", "recovering", "scanning"].includes(task.status)) task.status = "pending";
    await disarmBatchCooldown();
    await saveBatch(batch);
  }).catch(() => null);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BATCH_NEXT_ALARM) {
    batchOperation(() => continueBatchAfterCooldown({ source: "alarm-fallback" })).catch((error) => batchOperation(() => failCurrentBatchStore(error.message || String(error))));
    return;
  }
  if (!alarm.name.startsWith(STORE_SCAN_ALARM_PREFIX)) return;
  const tabId = Number(alarm.name.slice(STORE_SCAN_ALARM_PREFIX.length));
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, { type: "storeScanWatchdogTick" }).catch(() => {
    chrome.alarms.clear(alarm.name);
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueueStoreOperation(() => ensureStoreStorageMigrated()).catch(() => null);
  batchOperation(() => resumeInterruptedBatch()).catch(() => null);
});
chrome.runtime.onInstalled.addListener(() => {
  enqueueStoreOperation(() => ensureStoreStorageMigrated()).catch(() => null);
  batchOperation(() => resumeInterruptedBatch()).catch(() => null);
});
