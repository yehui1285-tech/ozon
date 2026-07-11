const TARGET_URL = "https://yehui1285-tech.github.io/ozon/feishu.html?v=20260711";
const TARGET_MATCH = "https://yehui1285-tech.github.io/ozon/feishu.html*";
const AUTO_INJECT_KEY = "ozonAutoInjectEnabled";
const AUTO_INJECT_DELAY_MS = 1000;
const AUTO_INJECT_RETRY_DELAY_MS = 1800;
const autoInjectedTabs = new Set();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabLoaded(tabId, timeoutMs = 15000) {
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
      if (removedTabId === tabId) finish(new Error("核价页在加载完成前被关闭。"));
    };
    const timer = setTimeout(() => finish(new Error("核价页加载超时，请检查网络后重试。")), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removedListener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) finish(new Error("无法读取核价页状态。"));
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
    throw new Error("请先打开 OZON 商品详情页，再点击启动采集。");
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
  return { ok: true };
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
  const stored = await chrome.storage.session.get(AUTO_INJECT_KEY);
  if (!stored[AUTO_INJECT_KEY]) return;
  autoInjectedTabs.add(tabId);
  const tryInject = async (delayMs) => {
    await wait(delayMs);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id || tab.url !== url || !autoInjectedTabs.has(tabId)) return false;
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "activateOnCurrentOzonTab") {
    injectCurrentOzonTab()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "setAutoInject") {
    setAutoInject(message.enabled)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "getAutoInject") {
    getAutoInject()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type !== "sendProductToPricing") return false;
  sendToPricing(message.product || {})
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading") autoInjectedTabs.delete(tabId);
  if (info.status === "complete") autoInjectOzonTab(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoInjectedTabs.delete(tabId);
});
