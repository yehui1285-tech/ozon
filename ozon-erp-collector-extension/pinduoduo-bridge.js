(() => {
  const ORIGIN = "http://127.0.0.1:17628";
  const REQUEST = "OZON_FINAL_REPRICE_REQUEST_V1";
  const RESPONSE = "OZON_FINAL_REPRICE_RESPONSE_V1";
  const PING = "OZON_FINAL_REPRICE_PING_V1";
  const READY = "OZON_FINAL_REPRICE_READY_V1";
  const SOURCING_REQUEST = "OZON_SOURCING_EXTENSION_REQUEST_V1";
  const SOURCING_RESPONSE = "OZON_SOURCING_EXTENSION_RESPONSE_V1";
  const SOURCING_ACTIONS = {
    start_1688_job: "start1688SourcingJob",
    get_1688_job: "get1688SourcingJob",
    cancel_1688_job: "cancel1688SourcingJob",
  };
  const SOURCING_TIMEOUT_MS = 10000;

  function validTask(task) {
    if (!task || typeof task !== "object") return false;
    const sku = String(task?.ozon?.sku || "").trim();
    const productUrl = String(task?.ozon?.productUrl || "").trim();
    return /^\d+$/.test(sku) && /^https:\/\/www\.ozon\.ru\/product\//i.test(productUrl);
  }

  function validRequestId(value) {
    return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value);
  }

  function validId(value) {
    return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value);
  }

  function validOzonImage(value) {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname !== "ozone.ru" && url.hostname.endsWith(".ozone.ru") && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function validStrategy(strategy) {
    return strategy && typeof strategy === "object" && ["image", "keyword", "similar_supplier", "verify_sku"].includes(strategy.type);
  }

  function sourcingPayload(data) {
    if (!validRequestId(data?.requestId) || !SOURCING_ACTIONS[data?.action]) return null;
    if (data.action === "start_1688_job") {
      if (!validId(data.taskId) || !validOzonImage(data.mainImageUrl) || !validStrategy(data.strategy)) return null;
      return { requestId: data.requestId, taskId: data.taskId, mainImageUrl: data.mainImageUrl, strategy: data.strategy };
    }
    if (!validId(data.jobId)) return null;
    return { requestId: data.requestId, jobId: data.jobId };
  }

  function handleSourcing(event) {
    const data = event.data;
    const requestId = typeof data?.requestId === "string" ? data.requestId : "";
    const payload = sourcingPayload(data);
    if (!payload) {
      window.postMessage({ type: SOURCING_RESPONSE, requestId, ok: false, error: "找品请求格式无效。" }, ORIGIN);
      return;
    }
    const runtimeRequest = data.action === "start_1688_job"
      ? { type: SOURCING_ACTIONS[data.action], request: payload }
      : { type: SOURCING_ACTIONS[data.action], jobId: payload.jobId };
    let responded = false;
    const respond = (result) => {
      if (responded) return;
      responded = true;
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        type: SOURCING_RESPONSE,
        ...(runtimeError ? { ok: false, error: runtimeError.message || "扩展后台不可用" } : (result || { ok: true })),
        requestId,
      }, ORIGIN);
    };
    const timeout = setTimeout(() => respond({ ok: false, error: "扩展后台响应超时" }), SOURCING_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage(runtimeRequest, (result) => {
        clearTimeout(timeout);
        respond(result);
      });
    } catch (error) {
      clearTimeout(timeout);
      respond({ ok: false, error: error?.message || "扩展后台不可用" });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    if (event.data?.type === SOURCING_REQUEST) {
      handleSourcing(event);
      return;
    }
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
