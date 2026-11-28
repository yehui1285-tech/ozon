(() => {
  const ORIGIN = "https://deep-breath-design-desk.yehui1285.chatgpt.site";
  if (location.origin !== ORIGIN || !location.pathname.startsWith("/ozon/pool")) return;
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.ozonPoolBridge = version;
  window.dispatchEvent(new CustomEvent("ozon-pool-bridge-ready", { detail: { version } }));

  function cleanProductUrl(raw) {
    try {
      const u = new URL(String(raw || ""));
      if (u.protocol !== "https:" || u.hostname !== "www.ozon.ru" || !/^\/product\//i.test(u.pathname) || u.username || u.password) return "";
      u.search = "";
      u.hash = "";
      return u.href;
    } catch {
      return "";
    }
  }

  function sanitizeSnapshot(raw, sku) {
    if (!raw || typeof raw !== "object") return null;
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    const commissions = Array.isArray(raw.commissions) ? raw.commissions.map(num).filter((v) => v > 0).slice(0, 3) : [];
    return {
      sku,
      commissions,
      lengthMm: num(raw.lengthMm),
      widthMm: num(raw.widthMm),
      heightMm: num(raw.heightMm),
      weightG: num(raw.weightG),
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    const requestId = typeof msg.requestId === "string" && msg.requestId.length <= 100 ? msg.requestId : "";
    if (!requestId) return;

    if (msg.type === "OZON_POOL_BRIDGE_PING_V1") {
      window.postMessage({ type: "OZON_POOL_BRIDGE_PONG_V1", requestId, version }, ORIGIN);
      return;
    }

    if (msg.type !== "OZON_POOL_FETCH_BLACK_PRICE_REQ_V1") return;
    const sku = /^\d+$/.test(String(msg.sku || "").trim()) ? String(msg.sku).trim() : "";
    const productUrl = cleanProductUrl(msg.productUrl);
    if (!sku || !productUrl) {
      window.postMessage({ type: "OZON_POOL_FETCH_BLACK_PRICE_RES_V1", requestId, ok: false, error: "商品 SKU 或 Ozon 链接无效" }, ORIGIN);
      return;
    }
    const snapshot = sanitizeSnapshot(msg.snapshot, sku);
    const task = {
      qualification: { status: "qualified", source: "batch_store_scan" },
      ozon: { sku, productUrl, ...(snapshot ? { batchScanSnapshot: snapshot } : {}) },
    };
    chrome.runtime.sendMessage({ type: "readOzonTaskPricing", task }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({ type: "OZON_POOL_FETCH_BLACK_PRICE_RES_V1", requestId, ok: false, error: chrome.runtime.lastError.message }, ORIGIN);
        return;
      }
      if (!response?.ok) {
        window.postMessage({ type: "OZON_POOL_FETCH_BLACK_PRICE_RES_V1", requestId, ok: false, error: response?.error || "同源黑标价读取失败" }, ORIGIN);
        return;
      }
      window.postMessage({ type: "OZON_POOL_FETCH_BLACK_PRICE_RES_V1", requestId, ok: true, result: response }, ORIGIN);
    });
  });
})();
