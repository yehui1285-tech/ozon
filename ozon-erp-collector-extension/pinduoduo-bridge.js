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

  function validTaskId(value) {
    return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value);
  }

  function validJobId(value) {
    return typeof value === "string" && /^1688-[a-z0-9._-]{1,79}$/i.test(value);
  }

  function validOzonImage(value) {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
      const url = new URL(value);
      const authority = value.slice(8).split(/[/?#]/)[0];
      return url.protocol === "https:" && !authority.includes(":") && !url.username && !url.password && (url.hostname === "ozone.ru" || url.hostname.endsWith(".ozone.ru"));
    } catch {
      return false;
    }
  }

  function validText(value, max = 200) {
    return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validAliImage(value) {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
      const url = new URL(value);
      const authority = value.slice(8).split(/[/?#]/)[0];
      return url.protocol === "https:" && !authority.includes(":") && !url.username && !url.password && url.hostname !== "alicdn.com" && url.hostname.endsWith(".alicdn.com");
    } catch {
      return false;
    }
  }

  function ownKeysOnly(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
  }

  function normalizeStrategy(strategy, mainImageUrl) {
    if (strategy === undefined) return { type: "image", sourceUrl: mainImageUrl };
    if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) return null;
    if (strategy.type === "image") return ownKeysOnly(strategy, ["type", "sourceUrl"]) ? { type: "image", sourceUrl: mainImageUrl } : null;
    if (strategy.type === "keyword") return ownKeysOnly(strategy, ["type", "query"]) && validText(strategy.query) ? { type: "keyword", query: strategy.query, sourceUrl: "" } : null;
    if (strategy.type === "similar_supplier") {
      if (!ownKeysOnly(strategy, ["type", "query", "sourceUrl"])) return null;
      if (!validAliImage(strategy.sourceUrl)) return null;
      if (strategy.query !== undefined && !validText(strategy.query)) return null;
      return { type: "similar_supplier", query: strategy.query || "", sourceUrl: strategy.sourceUrl };
    }
    if (strategy.type === "verify_sku") {
      if (!ownKeysOnly(strategy, ["type", "query", "sourceUrl", "optionId", "optionLabel", "expectedPrice"])) return null;
      if (strategy.query !== undefined && !validText(strategy.query)) return null;
      const sourceUrl = strategy.sourceUrl;
      if (typeof sourceUrl !== "string" || !/^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/i.test(sourceUrl) || sourceUrl.length > 300) return null;
      if (!(validText(strategy.optionId, 100) || validText(strategy.optionLabel, 100))) return null;
      if (!Number.isFinite(strategy.expectedPrice) || strategy.expectedPrice < 0 || strategy.expectedPrice > 1e9) return null;
      return { type: "verify_sku", query: strategy.query || "", sourceUrl, optionId: validText(strategy.optionId, 100) ? strategy.optionId : "", optionLabel: validText(strategy.optionLabel, 100) ? strategy.optionLabel : "", expectedPrice: strategy.expectedPrice };
    }
    return null;
  }

  function sourcingPayload(data) {
    if (!validRequestId(data?.requestId) || !SOURCING_ACTIONS[data?.action]) return null;
    if (data.action === "start_1688_job") {
      if (!validTaskId(data.taskId) || !validOzonImage(data.mainImageUrl)) return null;
      const strategy = normalizeStrategy(data.strategy, data.mainImageUrl);
      if (!strategy) return null;
      return { requestId: data.requestId, taskId: data.taskId, mainImageUrl: data.mainImageUrl, strategy };
    }
    if (!validJobId(data.jobId)) return null;
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
      const body = runtimeError ? { ok: false, error: runtimeError.message || "扩展后台不可用" } : (result || { ok: true });
      window.postMessage({ ...body, type: SOURCING_RESPONSE, requestId }, ORIGIN);
    };
    const timeout = setTimeout(() => respond({ ok: false, error: "扩展后台响应超时" }), SOURCING_TIMEOUT_MS);
    try {
      const pending = chrome.runtime.sendMessage(runtimeRequest, (result) => {
        clearTimeout(timeout);
        respond(result);
      });
      if (pending && typeof pending.then === "function") pending.then((result) => { clearTimeout(timeout); respond(result); }, (error) => { clearTimeout(timeout); respond({ ok: false, error: error?.message || "扩展后台不可用" }); });
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
