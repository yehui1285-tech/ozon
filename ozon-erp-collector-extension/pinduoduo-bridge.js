(() => {
  const ORIGIN = "http://127.0.0.1:17628";
  const REQUEST = "OZON_FINAL_REPRICE_REQUEST_V1";
  const RESPONSE = "OZON_FINAL_REPRICE_RESPONSE_V1";
  const PING = "OZON_FINAL_REPRICE_PING_V1";
  const READY = "OZON_FINAL_REPRICE_READY_V1";

  function validTask(task) {
    if (!task || typeof task !== "object") return false;
    const sku = String(task?.ozon?.sku || "").trim();
    const productUrl = String(task?.ozon?.productUrl || "").trim();
    return /^\d+$/.test(sku) && /^https:\/\/www\.ozon\.ru\/product\//i.test(productUrl);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    if (event.data?.type === PING) {
      window.postMessage({ type: READY, requestId: String(event.data?.requestId || ""), version: chrome.runtime.getManifest().version }, ORIGIN);
      return;
    }
    if (event.data?.type !== REQUEST) return;
    const requestId = String(event.data?.requestId || "");
    if (!/^[a-z0-9-]{8,80}$/i.test(requestId) || !validTask(event.data?.task)) {
      window.postMessage({ type: RESPONSE, requestId, ok: false, error: "最终复价请求格式无效。" }, ORIGIN);
      return;
    }
    chrome.runtime.sendMessage({ type: "readOzonTaskPricing", task: event.data.task }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        type: RESPONSE,
        requestId,
        ...(runtimeError ? { ok: false, error: runtimeError.message || "扩展后台不可用" } : result),
      }, ORIGIN);
    });
  });
})();
