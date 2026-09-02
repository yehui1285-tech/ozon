(function install1688Background(root) {
  "use strict";

  const JOB_PREFIX = "ozon1688Job:";
  const ACTIVE_JOB_KEY = "ozon1688ActiveJobV1";
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const MAX_EVIDENCE_BYTES = 1024 * 1024;
  const MAX_SEARCH_CANDIDATES = 12;
  const MAX_DETAIL_CANDIDATES = 5;
  const TERMINAL_STATUSES = new Set(["completed", "failed", "paused_platform_verification", "cancelled"]);
  const STRATEGY_TYPES = new Set(["image", "keyword", "similar_supplier", "verify_sku"]);
  const UNSAFE_SEMANTICS = /(?:下单|订单|支付|付款|联系|客服|聊天|优惠券|购买|立即购买|buy\s*now|payment|contact|chat|coupon|order)/i;
  let activeJobId = null;
  const running = new Map();

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function now() {
    return new Date().toISOString();
  }

  function jobKey(jobId) {
    return `${JOB_PREFIX}${clean(jobId)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeRequestId(value) {
    const id = clean(value).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
    return id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function isOzonImageUrl(value) {
    try {
      const url = new URL(clean(value));
      return url.protocol === "https:" && /(^|\.)ozone\.ru$/i.test(url.hostname);
    } catch {
      return false;
    }
  }

  function isSupplierImageUrl(value) {
    try {
      const url = new URL(clean(value));
      return url.protocol === "https:" && /(^|\.)alicdn\.com$/i.test(url.hostname);
    } catch {
      return false;
    }
  }

  function containsUnsafeSemantics(value) {
    return UNSAFE_SEMANTICS.test(clean(value));
  }

  function validateStrategy(raw = {}) {
    const strategy = raw && typeof raw === "object" ? raw : {};
    const type = clean(strategy.type);
    if (!STRATEGY_TYPES.has(type)) throw new Error("不支持的 1688 找品策略。");
    const normalized = {
      type,
      query: clean(strategy.query),
      sourceUrl: clean(strategy.sourceUrl),
      optionId: clean(strategy.optionId),
      optionLabel: clean(strategy.optionLabel),
      expectedPrice: Number.isFinite(Number(strategy.expectedPrice)) ? Number(strategy.expectedPrice) : undefined,
    };
    if (containsUnsafeSemantics(normalized.query) || containsUnsafeSemantics(normalized.optionLabel)) throw new Error("任务参数包含交易语义。");
    if (type === "keyword" && !normalized.query) throw new Error("关键词策略缺少查询词。");
    if (type === "image" && !isOzonImageUrl(normalized.sourceUrl)) throw new Error("图片策略只接受 HTTPS Ozon 图片。");
    if (type === "similar_supplier" && !isSupplierImageUrl(normalized.sourceUrl)) throw new Error("相似供应商图片不在已允许的官方主机上。");
    if (type === "verify_sku" && (!normalized.optionId && !normalized.optionLabel)) throw new Error("SKU 核验缺少精确选项。");
    return normalized;
  }

  function createJob(request = {}) {
    const strategy = validateStrategy(request.strategy);
    const sku = clean(request.sku || request.taskId?.replace(/^ozon-/, ""));
    if (!sku) throw new Error("缺少 Ozon SKU。");
    const startedAt = now();
    return {
      jobId: `1688-${safeRequestId(request.requestId)}`,
      taskId: `ozon-${sku}`,
      strategy: { type: strategy.type, query: strategy.query, sourceUrl: strategy.sourceUrl },
      selection: { optionId: strategy.optionId, optionLabel: strategy.optionLabel, expectedPrice: strategy.expectedPrice },
      status: "queued",
      tabId: null,
      candidates: [],
      detailCandidates: [],
      error: "",
      diagnostics: null,
      startedAt,
      updatedAt: startedAt,
      completedAt: "",
    };
  }

  async function persist(job) {
    job.updatedAt = now();
    await chrome.storage.local.set({ [jobKey(job.jobId)]: clone(job), [ACTIVE_JOB_KEY]: job.jobId });
    return job;
  }

  async function load(jobId) {
    const stored = await chrome.storage.local.get(jobKey(jobId));
    return stored[jobKey(jobId)] ? clone(stored[jobKey(jobId)]) : null;
  }

  async function currentActive() {
    if (activeJobId) return load(activeJobId);
    const stored = await chrome.storage.local.get(ACTIVE_JOB_KEY);
    activeJobId = clean(stored[ACTIVE_JOB_KEY]) || null;
    return activeJobId ? load(activeJobId) : null;
  }

  async function transition(job, status, fields = {}) {
    const latest = await load(job.jobId);
    if (latest && latest.status === "cancelled" && status !== "cancelled") return latest;
    Object.assign(job, fields, { status });
    if (TERMINAL_STATUSES.has(status)) job.completedAt = job.completedAt || now();
    await persist(job);
    return job;
  }

  async function sendPageCommand(tabId, command, payload = {}) {
    const response = await chrome.tabs.sendMessage(tabId, { type: "OZON_1688_PAGE_COMMAND_V1", command, payload });
    if (!response?.ok) throw new Error(clean(response?.error) || `1688 页面命令失败：${command}`);
    return response.result;
  }

  function platformVerification(snapshot) {
    const text = [snapshot?.title, ...(snapshot?.nodes || []).map((node) => node?.text)].map(clean).join(" ");
    return /登录|验证码|滑块|人机验证|captcha|verify you are human|sign in|log in/i.test(text);
  }

  function safeSnapshot(snapshot) {
    const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
    return {
      pageUrl: clean(snapshot?.pageUrl),
      title: clean(snapshot?.title),
      capturedAt: clean(snapshot?.capturedAt) || now(),
      nodes: nodes.filter((node) => node && node.visible !== false && !containsUnsafeSemantics(`${node.text} ${node.ariaLabel}`)).slice(0, 2000),
    };
  }

  async function downloadTrustedImage(sourceUrl, kind = "ozon") {
    const allowed = kind === "supplier" ? isSupplierImageUrl(sourceUrl) : isOzonImageUrl(sourceUrl);
    if (!allowed) throw new Error("图片地址不在允许的 HTTPS 主机范围内。");
    const response = await fetch(sourceUrl);
    const contentType = clean(response.headers?.get("content-type")).toLowerCase();
    const contentLength = Number(response.headers?.get("content-length"));
    if (!response.ok || !/^image\/(?:jpeg|png|webp|gif)(?:;|$)/.test(contentType)) throw new Error("远程资源不是允许的图片。");
    if (Number.isFinite(contentLength) && (contentLength <= 0 || contentLength > MAX_IMAGE_BYTES)) throw new Error("图片大小不在允许范围内。");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("图片大小不在允许范围内。");
    return { bytes, mimeType: contentType.split(";")[0] };
  }

  function dataUrlToBytes(dataUrl) {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(clean(dataUrl));
    if (!match) return null;
    const raw = atob(match[1]);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  }

  async function attachEvidence(tabId, candidate, snapshot, taskId) {
    const snapshotText = [snapshot?.title, ...(snapshot?.nodes || []).map((node) => node?.text)]
      .map(clean).filter(Boolean).join(" ").slice(0, 2000);
    const fallback = { capturedAt: now(), text: snapshotText, imageUrl: clean(candidate.imageUrl), sourceUrl: clean(candidate.sourceUrl), screenshotStatus: "capture_failed" };
    try {
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
      const bytes = dataUrlToBytes(dataUrl);
      if (!bytes || bytes.byteLength > MAX_EVIDENCE_BYTES) return fallback;
      const endpoint = `http://127.0.0.1:17628/api/evidence/1688?taskId=${encodeURIComponent(taskId)}&candidateId=${encodeURIComponent(candidate.candidateId)}`;
      const response = await fetch(endpoint, { method: "POST", headers: { "x-ozon-agent": "local-ui-v1", "content-type": "image/jpeg" }, body: bytes });
      const payload = response.ok ? await response.json() : null;
      const localRef = clean(payload?.localRef);
      if (!/^\/api\/evidence\/[A-Za-z0-9._/-]+$/.test(localRef) || localRef.includes("..")) return fallback;
      return { capturedAt: now(), localRef };
    } catch {
      return fallback;
    }
  }

  async function acquireTab(job) {
    const existing = await chrome.tabs.query({ url: ["https://*.1688.com/*"] });
    const tab = existing.find((entry) => /^https:\/\/(?:[^/]+\.)?1688\.com\//i.test(entry.url || ""));
    if (tab?.id != null) return { tab, created: false };
    const created = await chrome.tabs.create({ url: "https://s.1688.com/", active: false });
    return { tab: created, created: true };
  }

  async function inspectDetails(job, snapshot) {
    const details = [];
    for (const candidate of job.candidates.slice(0, MAX_DETAIL_CANDIDATES)) {
      const latest = await load(job.jobId);
      if (latest?.status === "cancelled") return { cancelled: true, details };
      await chrome.tabs.update(job.tabId, { url: candidate.sourceUrl });
      const detailSnapshot = safeSnapshot(await sendPageCommand(job.tabId, "read_product_detail"));
      if (platformVerification(detailSnapshot)) return { paused: true, details };
      const evidence = await attachEvidence(job.tabId, candidate, detailSnapshot, job.taskId);
      const detail = root.Ozon1688Core.parseDetailSnapshot(detailSnapshot);
      if (!detail?.identityValid) {
        job.diagnostics = { code: "detail_parser_failed", message: "详情页未返回可验证商品身份。", evidence };
        await persist(job);
        continue;
      }
      detail.evidence = evidence;
      details.push(detail);
      job.detailCandidates = details;
      await persist(job);
    }
    return { details };
  }

  async function runJob(jobId) {
    let job = await load(jobId);
    if (!job || job.status === "cancelled") return job;
    await transition(job, "running");
    job = await load(jobId);
    let createdTab = false;
    try {
      const acquired = await acquireTab(job);
      createdTab = acquired.created;
      job.tabId = acquired.tab.id;
      job.createdTab = createdTab;
      await persist(job);
      const probe = safeSnapshot(await sendPageCommand(job.tabId, "probe"));
      if (platformVerification(probe)) return transition(job, "paused_platform_verification", { diagnostics: { code: "platform_verification", message: "1688 要求登录或人机验证。" } });
      if (job.strategy.type === "image" || job.strategy.type === "similar_supplier") {
        const image = await downloadTrustedImage(job.strategy.sourceUrl, job.strategy.type === "similar_supplier" ? "supplier" : "ozon");
        await sendPageCommand(job.tabId, "submit_image_search", image);
      } else if (job.strategy.type === "keyword") {
        await sendPageCommand(job.tabId, "submit_keyword_search", { query: job.strategy.query });
      } else {
        const selection = await sendPageCommand(job.tabId, "select_sku_option", { ...job.strategy, ...job.selection });
        if (!selection?.selected) throw new Error("SKU 选项未被确认选择。");
      }
      const snapshot = safeSnapshot(await sendPageCommand(job.tabId, "read_search_results"));
      if (platformVerification(snapshot)) return transition(job, "paused_platform_verification", { diagnostics: { code: "platform_verification", message: "1688 要求登录或人机验证。" } });
      const candidates = root.Ozon1688Core.parseSearchSnapshot(snapshot).filter((candidate) => !containsUnsafeSemantics(candidate.title)).slice(0, MAX_SEARCH_CANDIDATES);
      if (!candidates.length) return transition(job, "failed", { diagnostics: { code: "search_parser_failed", message: "搜索页没有可验证的候选，未猜测补全。" } });
      job.candidates = candidates;
      await persist(job);
      const detailResult = await inspectDetails(job, snapshot);
      if (detailResult.cancelled) return load(jobId);
      if (detailResult.paused) return transition(job, "paused_platform_verification", { diagnostics: { code: "platform_verification", message: "1688 要求登录或人机验证。" } });
      const latest = await load(jobId);
      if (latest?.status === "cancelled") return latest;
      if (!job.detailCandidates.length) return transition(job, "failed", { diagnostics: job.diagnostics || { code: "detail_parser_failed", message: "没有可验证的详情候选。" } });
      return transition(job, "completed");
    } catch (error) {
      const latest = await load(jobId);
      if (latest?.status === "cancelled") return latest;
      return transition(job, "failed", { error: clean(error?.message) || "1688 任务失败", diagnostics: { code: "driver_error", message: clean(error?.message) || "1688 任务失败" } });
    } finally {
      const finalJob = await load(jobId);
      if (createdTab && Number.isInteger(finalJob?.tabId) && TERMINAL_STATUSES.has(finalJob.status)) {
        await chrome.tabs.remove(finalJob.tabId).catch(() => null);
        finalJob.tabId = null;
        await persist(finalJob);
      }
      if (finalJob && TERMINAL_STATUSES.has(finalJob.status)) activeJobId = null;
      running.delete(jobId);
    }
  }

  async function startJob(request) {
    const previous = await currentActive();
    if (previous && !TERMINAL_STATUSES.has(previous.status)) throw new Error("已有一个 1688 找品任务正在运行。");
    const job = createJob(request);
    activeJobId = job.jobId;
    await persist(job);
    const promise = runJob(job.jobId);
    running.set(job.jobId, promise);
    return clone(job);
  }

  async function getJob(jobId) {
    return load(jobId);
  }

  async function cancelJob(jobId) {
    const job = await load(jobId);
    if (!job) throw new Error("1688 任务不存在。");
    if (!TERMINAL_STATUSES.has(job.status)) await transition(job, "cancelled", { error: "" });
    const cancelled = await load(jobId);
    if (cancelled?.createdTab && Number.isInteger(cancelled.tabId)) {
      await chrome.tabs.remove(cancelled.tabId).catch(() => null);
      cancelled.tabId = null;
      await persist(cancelled);
    }
    activeJobId = null;
    return cancelled;
  }

  root.Ozon1688Background = Object.freeze({
    startJob,
    getJob,
    cancelJob,
    __test: Object.freeze({ downloadTrustedImage, containsUnsafeSemantics, MAX_SEARCH_CANDIDATES, MAX_DETAIL_CANDIDATES }),
  });
})(globalThis);
