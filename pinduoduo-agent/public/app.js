import { applyFinalOzonPricing, createFinalPricingRequestGuard, preliminaryPricingDecision, previewFinalOzonPricing } from "./pricing-flow.js";
import * as sourcingFlow from "./sourcing-flow.js";
import * as sourcingCore from "/sourcing-core.mjs";

const storageKey = "ozon-sourcing-agent-mvp6";
const legacyStorageKeys = ["ozon-pinduoduo-agent-mvp3"];
const appVersion = "MVP 6.0";
const finalPricingRequestGuard = createFinalPricingRequestGuard();
const automaticRuns = new Map();
const taskActionLocks = new Map();
const automaticBatch = { running: false, paused: false, stopRequested: false, cursor: 0, completed: 0, failed: 0, activeTaskId: "", pauseReason: "", status: "idle" };

let queue = null;
let sourceName = "ozon-sourcing.json";
let pageUnloading = false;
let requestSequence = 0;

const $ = (id) => document.getElementById(id);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
window.addEventListener("beforeunload", () => {
  pageUnloading = true;
  const activeTask = currentQueuedTask(automaticBatch.activeTaskId);
  if (activeTask?.sourcing?.timing) {
    activeTask.sourcing.timing = sourcingFlow.pauseAutomaticTiming(activeTask.sourcing.timing);
    activeTask.sourcing.status = "paused_manual";
    persistQueue();
  }
});

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function text(value, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; } }
function taskIdOf(task) { return text(task?.taskId || task?.id); }
function stableTaskIdentity(task) { const id = taskIdOf(task); return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) ? `taskId:${id}` : ""; }
function currentQueuedTask(taskOrId) {
  if (!Array.isArray(queue?.tasks)) return null;
  if (taskOrId && typeof taskOrId === "object") return queue.tasks.find((task) => task === taskOrId) || null;
  const id = text(taskOrId);
  return id ? queue.tasks.find((task) => taskIdOf(task) === id) || null : null;
}
function sourcingState(task) { task.sourcing = object(task?.sourcing) || {}; return task.sourcing; }
function pricingState(task) { task.pricing = object(task?.pricing) || {}; return task.pricing; }
function queueMeta() {
  if (!queue) return {};
  queue.meta = object(queue.meta) || {};
  queue.meta.sourcingSchema = "mvp6";
  if (!object(queue.meta.singleUnitExceptions)) queue.meta.singleUnitExceptions = {};
  return queue.meta;
}
function setStatus(message, state = "") { const node = $("status"); if (node) { node.textContent = message; node.className = state; } }

function persistQueue() {
  if (!queue) return;
  const meta = queueMeta();
  meta.automatic1688Batch = {
    cursor: automaticBatch.cursor, completed: automaticBatch.completed, failed: automaticBatch.failed,
    activeTaskId: automaticBatch.activeTaskId || null, status: automaticBatch.running ? "running" : automaticBatch.status,
    pauseReason: automaticBatch.pauseReason || null, updatedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(storageKey, JSON.stringify({ queue, sourceName })); }
  catch (error) { setStatus(`本地保存失败：${error?.message || "浏览器存储不可用"}`, "bad"); }
}

function restoreQueue() {
  try {
    const primary = localStorage.getItem(storageKey);
    const migrated = sourcingFlow.migrateMvp6StoredQueue(primary, legacyStorageKeys.map((key) => localStorage.getItem(key)));
    if (!migrated.saved) return false;
    queue = migrated.saved.queue;
    sourceName = migrated.saved.sourceName || sourceName;
    const state = queueMeta().automatic1688Batch;
    automaticBatch.cursor = Number.isInteger(state.cursor) && state.cursor >= 0 ? state.cursor : 0;
    automaticBatch.completed = Number.isInteger(state.completed) && state.completed >= 0 ? state.completed : 0;
    automaticBatch.failed = Number.isInteger(state.failed) && state.failed >= 0 ? state.failed : 0;
    automaticBatch.status = text(state.status, "idle") || "idle";
    automaticBatch.pauseReason = text(state.pauseReason);
    if (migrated.migratedFromLegacy || !primary) localStorage.setItem(storageKey, JSON.stringify(migrated.saved));
    return true;
  } catch { return false; }
}

function trustedOzonImage(rawUrl) {
  try {
    const url = new URL(text(rawUrl)); const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.port && !url.username && !url.password && (host === "ozone.ru" || host.endsWith(".ozone.ru"));
  } catch { return false; }
}
function trusted1688Image(rawUrl) {
  try {
    const url = new URL(text(rawUrl)); const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && (host === "alicdn.com" || host.endsWith(".alicdn.com") || host === "1688.com" || host.endsWith(".1688.com"));
  } catch { return false; }
}
function readiness(task) {
  const reasons = [];
  if (!taskIdOf(task)) reasons.push("任务ID缺失");
  if (!trustedOzonImage(task?.enrichment?.mainImageUrl || task?.ozon?.mainImageUrl)) reasons.push("缺可信Ozon主图");
  if (!(Number(task?.enrichment?.maxPurchaseCostAt18Pct ?? task?.pricing?.preliminaryMaxPurchaseCostAt18Pct) >= 0)) reasons.push("缺18%成本上限");
  return { ready: reasons.length === 0, reasons };
}
function formatMoney(value) { return typeof value === "number" && Number.isFinite(value) ? `¥${value.toFixed(2)}` : "—"; }
function stageLabel(status) {
  return ({ automatic_running: "自动处理中", paused_platform_verification: "平台验证暂停", paused_manual: "已暂停", automatic_cancelled: "已取消", final_confirmation_pending: "待最终确认", final_confirmation_blocked: "需人工处理", confirmed_purchase_source: "已确认采购来源", no_source_found: "未找到可确认货源" })[status] || text(status) || "待处理";
}

function actionButton(label, action, { secondary = false, disabled = false } = {}) {
  const button = document.createElement("button");
  button.textContent = label; button.className = secondary ? "secondary" : ""; button.disabled = disabled;
  button.addEventListener("click", () => Promise.resolve(action()).catch((error) => setStatus(error?.message || "操作未完成，请稍后重试。", "bad")));
  return button;
}
function fact(label, value) {
  const node = document.createElement("div"); node.className = "confirmation-fact";
  const small = document.createElement("small"); small.textContent = label;
  const strong = document.createElement("strong"); strong.textContent = value || "—";
  node.append(small, strong); return node;
}
function currentCardCandidate(task, final) {
  if (task?.sourcing?.activeCandidate) return task.sourcing.activeCandidate;
  const id = text(final?.candidate?.candidateId || final?.candidateSnapshot?.candidateId);
  return (task?.sourcing?.detailCandidates || []).find((candidate) => text(candidate?.candidateId) === id)
    || final?.candidateSnapshot || final?.candidate || null;
}

function renderStats() {
  const tasks = queue?.tasks || [];
  const values = {
    total: tasks.length, ready: tasks.filter((task) => readiness(task).ready).length,
    running: tasks.filter((task) => task?.sourcing?.status === "automatic_running").length,
    pending: tasks.filter((task) => task?.sourcing?.finalConfirmation?.status === "final_confirmation_pending").length,
    blocked: tasks.filter((task) => task?.sourcing?.finalConfirmation?.status === "final_confirmation_blocked").length,
    paused: tasks.filter((task) => task?.sourcing?.status === "paused_platform_verification").length,
    confirmed: tasks.filter((task) => task?.sourcing?.status === "confirmed_purchase_source").length,
    noSource: tasks.filter((task) => task?.sourcing?.status === "no_source_found").length,
  };
  for (const [id, value] of Object.entries(values)) if ($(id)) $(id).textContent = String(value);
}
function renderRows() {
  const rows = $("rows"); if (!rows) return; rows.replaceChildren();
  const tasks = queue?.tasks || [];
  if (!tasks.length) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 7; cell.className = "empty"; cell.textContent = "尚未导入任务。"; row.append(cell); rows.append(row); return;
  }
  tasks.forEach((task, index) => {
    const row = document.createElement("tr"), final = task?.sourcing?.finalConfirmation, candidate = task?.sourcing?.activeCandidate || task?.sourcing?.confirmedCandidate;
    const values = [String(index + 1), `${text(task?.ozon?.sku) || "—"}\n${text(task?.ozon?.name) || "未命名商品"}`, formatMoney(Number(task?.enrichment?.maxPurchaseCostAt18Pct)), stageLabel(task?.sourcing?.status), text(candidate?.title, "—"), final?.blockers?.join("、") || (final?.eligibleAt18Pct ? "18%通过" : "待试算"), task?.pricing?.purchaseCost === undefined ? "确认后写入" : formatMoney(Number(task.pricing.purchaseCost))];
    values.forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }); rows.append(row);
  });
}
function renderTimingPanel() {
  const rows = $("timingRows"), summary = $("timingSummary"); if (!rows) return;
  const tasks = (queue?.tasks || []).filter((task) => task?.sourcing?.timing);
  if (summary) summary.textContent = tasks.length ? `自动任务${tasks.length}件 · 平台暂停${tasks.filter((task) => task?.sourcing?.status === "paused_platform_verification").length}件` : "尚无自动找货源记录";
  rows.replaceChildren();
  if (!tasks.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "自动链路按每件最多150秒活动时间计算，平台验证等待不计入。"; rows.append(empty); return; }
  tasks.slice(0, 12).forEach((task) => {
    const card = document.createElement("div"); card.className = "timing-card";
    card.append(fact(text(task?.ozon?.sku, taskIdOf(task)), stageLabel(task?.sourcing?.status)), fact("活动时间", `${Math.round(sourcingFlow.automaticElapsedMs(task.sourcing.timing) / 1000)} / 150 秒`), fact("当前策略", text(task?.sourcing?.searchStrategy, "等待"))); rows.append(card);
  });
}
function renderConfirmationQueue() {
  const rows = $("confirmationRows"), summary = $("confirmationSummary"); if (!rows) return;
  const tasks = (queue?.tasks || []).filter((task) => object(task?.sourcing?.finalConfirmation));
  if (summary) summary.textContent = `待确认${tasks.filter((task) => task.sourcing.finalConfirmation.status === "final_confirmation_pending").length}件`;
  rows.replaceChildren();
  if (!tasks.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "自动找货源完成后，需要人工确认的商品会显示在这里。"; rows.append(empty); return; }
  tasks.forEach((task) => {
    const final = task.sourcing.finalConfirmation, candidate = currentCardCandidate(task, final), judgement = task.sourcing.aiJudgement || final.judgementSnapshot || final.judgement || {}, quote = task.sourcing.quote || final.quoteSnapshot || final, preview = task.sourcing.finalPricingPreview || final.finalPricing;
    const card = document.createElement("article"); card.className = `confirmation-card ${final.status === "final_confirmation_pending" ? "ready" : "blocked"}`;
    const head = document.createElement("div"), title = document.createElement("div"), h3 = document.createElement("h3"), sub = document.createElement("p"), badge = document.createElement("strong");
    head.className = "confirmation-card-head"; h3.textContent = text(task?.ozon?.name, "未命名Ozon商品"); sub.textContent = `SKU：${text(task?.ozon?.sku, "—")} · ${stageLabel(final.status)}`; badge.textContent = final.status === "final_confirmation_pending" ? "可确认" : "需人工复核"; title.append(h3, sub); head.append(title, badge); card.append(head);
    const media = document.createElement("div"); media.className = "confirmation-media";
    if (trustedOzonImage(task?.enrichment?.mainImageUrl || task?.ozon?.mainImageUrl)) { const image = document.createElement("img"); image.className = "thumb"; image.alt = "Ozon主图"; image.src = task.enrichment?.mainImageUrl || task.ozon?.mainImageUrl; media.append(image); }
    if (trusted1688Image(candidate?.imageUrl)) { const image = document.createElement("img"); image.className = "thumb"; image.alt = "1688候选图"; image.src = candidate.imageUrl; media.append(image); }
    if (media.children.length) card.append(media);
    const facts = document.createElement("div"); facts.className = "confirmation-facts";
    const selectedOption = candidate?.sku?.options?.find((option) => text(option?.id || option?.optionId) === text(candidate?.sku?.selectedOptionId));
    facts.append(fact("候选商品", text(candidate?.title, "候选缺失")), fact("供应商", text(candidate?.supplierName, "未提供")), fact("同款置信度", Number.isFinite(Number(judgement?.confidence)) ? `${Number(judgement.confidence)}%` : "未判断"), fact("目标规格", text(selectedOption?.label, text(candidate?.sku?.selectedOptionId, "未核验"))), fact("商品价", formatMoney(Number(quote?.productPrice))), fact("国内运费", formatMoney(Number(quote?.domesticShipping))), fact("采购成本", formatMoney(Number(quote?.purchaseCost))), fact("最终18%", preview?.eligibleAt18Pct === true ? "通过" : preview ? "不通过 / 待复核" : "未取得")); card.append(facts);
    const evidence = document.createElement("p"); evidence.className = "confirmation-evidence";
    if (sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl)) { const link = document.createElement("a"); link.textContent = "打开1688候选"; link.href = candidate.sourceUrl; link.target = "_blank"; link.rel = "noreferrer"; evidence.append(link); }
    if (candidate?.evidence?.localRef) { const link = document.createElement("a"); link.textContent = "查看本地证据"; link.href = candidate.evidence.localRef; link.target = "_blank"; link.rel = "noreferrer"; evidence.append(document.createTextNode(evidence.children.length ? " · " : ""), link); }
    const differences = Array.isArray(judgement?.candidateAssessments) ? judgement.candidateAssessments.find((item) => text(item?.candidateId) === text(candidate?.candidateId))?.differences : [];
    if (Array.isArray(differences) && differences.length) evidence.append(document.createTextNode(`${evidence.children.length ? " · " : ""}差异：${differences.join("；")}`));
    if (evidence.children.length || evidence.textContent) card.append(evidence);
    if (Array.isArray(final.blockers) && final.blockers.length) { const blockers = document.createElement("p"); blockers.className = "confirmation-blockers"; blockers.textContent = `需确认：${final.blockers.join("、")}`; card.append(blockers); }
    const actions = document.createElement("div"); actions.className = "confirmation-actions"; const pending = final.status === "final_confirmation_pending";
    actions.append(actionButton("确认采用", () => confirmFinalCandidate(taskIdOf(task)), { disabled: !pending }), actionButton("否决并尝试下一候选", () => rejectFinalCandidate(taskIdOf(task)), { secondary: true, disabled: !candidate }));
    if (Number(candidate?.minimumOrderQuantity) === 2 && !candidate?.supportsOnePiece && !candidate?.supportsSample) { const input = document.createElement("input"); input.type = "number"; input.min = "0.01"; input.step = "0.01"; input.placeholder = "客服确认的一件价"; input.className = "price"; actions.append(input, actionButton("确认客服可一件采购", () => saveSingleUnitException(taskIdOf(task), input.value), { secondary: true })); }
    actions.append(actionButton("单品拼多多深度补搜", () => startSinglePinduoduoDeepSearch(taskIdOf(task)), { secondary: true })); card.append(actions); rows.append(card);
  });
}
function renderControls() {
  if ($("batchState")) $("batchState").textContent = automaticBatch.running ? "运行中" : automaticBatch.status === "paused_platform_verification" ? "平台验证暂停" : automaticBatch.paused ? "已暂停" : "待运行";
  if ($("download")) $("download").disabled = !queue;
  if ($("batchStart")) $("batchStart").disabled = automaticBatch.running;
  if ($("batchPause")) $("batchPause").disabled = !automaticBatch.running || automaticBatch.paused;
  if ($("batchResume")) $("batchResume").disabled = automaticBatch.running || (!automaticBatch.paused && automaticBatch.status !== "paused_platform_verification");
  if ($("batchStop")) $("batchStop").disabled = !automaticBatch.running && !automaticBatch.paused;
}
function render() { renderStats(); renderRows(); renderTimingPanel(); renderConfirmationQueue(); renderControls(); }

function requestId(prefix) { requestSequence += 1; return `${prefix}-${Date.now().toString(36)}-${requestSequence.toString(36)}`; }
async function api(path, options = {}) {
  const headers = { "content-type": "application/json", "x-ozon-agent": "local-ui-v1", ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers }); let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || body?.ok === false) throw new Error(text(body?.error, "本地Agent未完成请求。"));
  return body;
}
async function apiWithTimeout(path, body, timeoutMs, label) {
  const controller = typeof AbortController === "function" ? new AbortController() : null; let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller?.abort(); }, timeoutMs);
  try { return await api(path, { method: "POST", body: JSON.stringify(body), signal: controller?.signal }); }
  catch (error) { if (timedOut) throw new Error(`${label}超时，请转入人工确认。`); throw error; }
  finally { clearTimeout(timer); }
}
async function sourcingExtensionRequest(action, payload = {}, timeoutMs = 15000) {
  const allowed = new Set(["start_1688_job", "get_1688_job", "cancel_1688_job"]);
  if (!allowed.has(action)) return Promise.reject(new Error("找品桥接动作不在允许列表中。"));
  if (pageUnloading) return Promise.reject(new Error("页面正在关闭，已停止找品请求。"));
  const id = requestId("sourcing");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener("message", onMessage); window.removeEventListener("beforeunload", onUnload); callback(value); };
    const onMessage = (event) => {
      const data = event?.data;
      if (event?.source !== window || event?.origin !== window.location.origin || data?.type !== "OZON_SOURCING_EXTENSION_RESPONSE_V1" || data?.requestId !== id) return;
      if (data?.ok !== true) finish(reject, new Error(text(data?.error, "1688扩展没有完成请求。"))); else finish(resolve, data);
    };
    const timer = setTimeout(() => finish(reject, new Error("1688扩展响应超时，请转入人工确认。")), timeoutMs);
    const onUnload = () => finish(reject, new Error("页面正在关闭，已停止找品请求。"));
    window.addEventListener("message", onMessage);
    window.addEventListener("beforeunload", onUnload);
    try { window.postMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action, requestId: id, ...payload }, window.location.origin); }
    catch (error) { finish(reject, error); }
  });
}
function requestFinalOzonPricing(task, timeoutMs = 90000) {
  const id = requestId("final-price");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener("message", onMessage); callback(value); };
    const onMessage = (event) => {
      const data = event?.data;
      if (event?.source !== window || event?.origin !== window.location.origin || data?.type !== "OZON_FINAL_REPRICE_RESPONSE_V1" || data?.requestId !== id) return;
      if (data?.ok !== true) finish(reject, new Error(text(data?.error, "Ozon最终复价失败。"))); else finish(resolve, data);
    };
    const timer = setTimeout(() => finish(reject, new Error("Ozon最终复价响应超时。")), timeoutMs);
    window.addEventListener("message", onMessage);
    try { window.postMessage({ type: "OZON_FINAL_REPRICE_REQUEST_V1", requestId: id, task }, window.location.origin); }
    catch (error) { finish(reject, error); }
  });
}
function finalPricingTaskIdentity(task) { return `${taskIdOf(task)}:${text(task?.ozon?.productUrl || task?.ozon?.sku)}`; }
async function preview1688PurchaseCostWithFinalPricing(task, purchaseCost, timeoutMs = 90000) {
  const identity = finalPricingTaskIdentity(task), token = finalPricingRequestGuard.start(task, identity);
  try {
    const response = await requestFinalOzonPricing(task, timeoutMs), current = currentQueuedTask(task);
    if (!finalPricingRequestGuard.isActive(task, token, current, finalPricingTaskIdentity(current))) return { stale: true };
    return previewFinalOzonPricing(task, response, purchaseCost, new Date().toISOString());
  } finally { finalPricingRequestGuard.finish(task, token); }
}
async function commitPurchaseCostWithFinalPricing(task, purchaseCost, sourceUrl, verification, { batchMode = false } = {}) {
  if (task?.sourcing?.provider === "1688") return preview1688PurchaseCostWithFinalPricing(task, purchaseCost);
  const preliminary = preliminaryPricingDecision(task, purchaseCost); if (preliminary.status === "rejected_preliminary") throw new Error("采购成本高于当前18%上限。");
  const response = await requestFinalOzonPricing(task); if (currentQueuedTask(task) !== task) return { stale: true };
  const result = applyFinalOzonPricing(task, response, purchaseCost, new Date().toISOString());
  task.pricing.sourceUrl = text(sourceUrl) || null; sourcingState(task).verification = clone(verification, null);
  if (!batchMode) setStatus(result.eligibleAt18Pct ? "最终复价通过。" : "最终复价未达到18%。", result.eligibleAt18Pct ? "ok" : "bad");
  persistQueue(); render(); return result;
}

function contextIsCurrent(context) { return !pageUnloading && currentQueuedTask(context?.task) === context?.task && taskIdOf(context?.task) === context?.taskId; }
function timeExceeded(task) { return sourcingFlow.automaticTimeBudgetExceeded(task?.sourcing?.timing || {}); }
function remainingActiveMs(task) {
  return Math.max(0, sourcingFlow.AUTOMATIC_1688_LIMITS.totalActiveMs - sourcingFlow.automaticElapsedMs(task?.sourcing?.timing || {}));
}
function activeRequestTimeout(task, requestedMs) {
  return sourcingFlow.automaticRequestTimeoutMs(task?.sourcing?.timing || {}, requestedMs);
}
function automaticTimeoutResult() { return { status: "automatic_timeout", diagnostics: { code: "automatic_timeout" } }; }
function recordAudit(task, action, details = {}) {
  const sourcing = sourcingState(task), entries = Array.isArray(sourcing.confirmationAudit) ? sourcing.confirmationAudit : [];
  entries.push({ taskIdentity: stableTaskIdentity(task), action, at: new Date().toISOString(), ...clone(details, {}) }); sourcing.confirmationAudit = entries.slice(-80);
}
function appendBlockers(final, blockers = []) { return [...new Set([...(Array.isArray(final?.blockers) ? final.blockers : []), ...blockers.filter(Boolean)])]; }
function buildNoSourceFinal(task, blocker, status = "no_source_found") {
  const sourcing = sourcingState(task); sourcing.status = status; sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing);
  sourcing.finalConfirmation = { taskIdentity: stableTaskIdentity(task), status: "final_confirmation_blocked", blockers: [blocker], candidate: null, candidateSnapshot: null, judgement: null, judgementSnapshot: null, quoteSnapshot: null, finalPricing: null, generatedAt: new Date().toISOString() };
  persistQueue(); render(); return sourcing.finalConfirmation;
}
function queueCandidateFinal(task, candidate, judgement, quote, finalPricing, extraBlockers = []) {
  const sourcing = sourcingState(task); let pending;
  try { pending = sourcingCore.buildFinalConfirmation({ task, candidate, judgement, quote, finalPricing }); }
  catch (error) {
    pending = { taskIdentity: stableTaskIdentity(task), status: "final_confirmation_blocked", candidate: null, judgement: null, productPrice: quote?.productPrice ?? null, domesticShipping: quote?.domesticShipping ?? null, purchaseCost: quote?.purchaseCost ?? null, priceSource: quote?.priceSource || "unknown", sourceUrl: sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl) || null, eligibleAt18Pct: finalPricing?.eligibleAt18Pct === true, blockers: ["confirmation_task_identity_invalid", text(error?.message, "confirmation_build_failed")] };
  }
  const blockers = appendBlockers(pending, extraBlockers);
  sourcing.activeCandidate = clone(candidate, null); sourcing.aiJudgement = clone(judgement, null); sourcing.quote = clone(quote, null); sourcing.finalPricingPreview = clone(finalPricing, null); sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing);
  sourcing.finalConfirmation = { ...pending, status: blockers.length ? "final_confirmation_blocked" : pending.status, blockers, candidateSnapshot: clone(candidate, null), judgementSnapshot: clone(judgement, null), quoteSnapshot: clone(quote, null), finalPricing: clone(finalPricing, null), generatedAt: new Date().toISOString() };
  sourcing.status = sourcing.finalConfirmation.status; task.status = "pending_human_review"; persistQueue(); render(); return sourcing.finalConfirmation;
}
function mergeDetailedCandidates(existing, incoming) {
  const result = [], seen = new Set();
  for (const candidate of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const sourceUrl = sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl); if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl); result.push({ ...candidate, sourceUrl }); if (result.length >= sourcingFlow.AUTOMATIC_1688_LIMITS.maxLightweightCandidates) break;
  }
  return result;
}
function usableCandidates(task) {
  const rejected = new Set((task?.sourcing?.rejectedCandidateIds || []).map(String));
  return (task?.sourcing?.detailCandidates || []).filter((candidate) => !rejected.has(text(candidate?.candidateId)) && sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl) && text(candidate?.title) && candidate?.identityValid !== false).slice(0, sourcingFlow.AUTOMATIC_1688_LIMITS.maxLightweightCandidates);
}
function recordSearchAttempt(task, strategy, result) {
  const sourcing = sourcingState(task), attempts = Array.isArray(sourcing.searchAttempts) ? sourcing.searchAttempts : [];
  attempts.push({ strategy, status: result.status, usableCount: Number(result.usableCount) || 0, candidateCount: Number(result.candidateCount) || 0, diagnostics: clone(result.diagnostics, null), jobId: text(result.jobId) || null, completedAt: new Date().toISOString() }); sourcing.searchAttempts = attempts.slice(-20);
}
async function safeCancel1688Job(jobId) { if (!text(jobId)) return null; try { return await sourcingExtensionRequest("cancel_1688_job", { jobId }, 8000); } catch { return null; } }
function pauseForPlatformVerification(context, job, strategy) {
  const sourcing = sourcingState(context.task); sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing); sourcing.status = "paused_platform_verification"; sourcing.searchStrategy = strategy.type;
  sourcing.activeJob = { jobId: text(job?.jobId), strategy: clone(strategy, null), status: "paused_platform_verification", diagnostics: clone(job?.diagnostics, null) };
  automaticBatch.paused = true; automaticBatch.status = "paused_platform_verification"; automaticBatch.pauseReason = "1688平台要求人工验证"; persistQueue(); render(); setStatus("1688平台要求人工验证，整批已暂停；验证后点击恢复。", "bad");
}
async function poll1688Job(context, jobId, strategy) {
  const task = context.task, startedAt = Date.now(); let detailStartedAt = null;
  while (contextIsCurrent(context)) {
    const sourcing = sourcingState(task);
    if (automaticBatch.stopRequested) { await safeCancel1688Job(jobId); return { status: "cancelled", diagnostics: { code: "batch_cancelled" }, jobId }; }
    if (automaticBatch.paused && automaticBatch.status !== "paused_platform_verification") { await safeCancel1688Job(jobId); sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing); sourcing.status = "paused_manual"; persistQueue(); render(); return { status: "paused_manual", diagnostics: { code: "batch_paused" }, jobId }; }
    if (timeExceeded(task)) { await safeCancel1688Job(jobId); return { status: "automatic_timeout", diagnostics: { code: "automatic_timeout" }, jobId }; }
    const now = Date.now(), activeStageAt = strategy.type === "verify_sku" ? startedAt : detailStartedAt || startedAt;
    const budget = strategy.type === "verify_sku" || detailStartedAt ? sourcingFlow.AUTOMATIC_1688_LIMITS.detailSkuMs : sourcingFlow.AUTOMATIC_1688_LIMITS.searchPageMs;
    if (now - activeStageAt >= budget) { await safeCancel1688Job(jobId); return { status: "stage_timeout", diagnostics: { code: "stage_timeout", stage: strategy.type === "verify_sku" || detailStartedAt ? "detail_or_sku" : "search_page" }, jobId }; }
    const requestTimeout = activeRequestTimeout(task, Math.min(15000, budget - (now - activeStageAt)));
    if (!requestTimeout) { await safeCancel1688Job(jobId); return automaticTimeoutResult(); }
    let job;
    try { job = await sourcingExtensionRequest("get_1688_job", { jobId }, requestTimeout); }
    catch (error) { return timeExceeded(task) ? automaticTimeoutResult() : { status: "bridge_failed", diagnostics: { code: "bridge_failed", message: text(error?.message) }, jobId }; }
    if (!contextIsCurrent(context)) return { status: "stale", jobId };
    if (timeExceeded(task)) { await safeCancel1688Job(jobId); return automaticTimeoutResult(); }
    sourcing.activeJob = { jobId, strategy: clone(strategy, null), status: text(job?.status), phase: text(job?.phase), diagnostics: clone(job?.diagnostics, null), updatedAt: new Date().toISOString() }; persistQueue(); render();
    if (job?.status === "paused_platform_verification") { pauseForPlatformVerification(context, job, strategy); return { ...job, status: "paused_platform_verification", jobId }; }
    if (["completed", "failed", "cancelled"].includes(job?.status)) { sourcing.activeJob = null; persistQueue(); return { ...job, jobId }; }
    if (job?.phase === "inspect_details" && detailStartedAt === null) detailStartedAt = Date.now();
    await delay(1000);
  }
  return { status: "stale", jobId };
}
async function run1688BridgeJob(context, strategy) {
  const mainImageUrl = context.task?.enrichment?.mainImageUrl || context.task?.ozon?.mainImageUrl; let started;
  const requestTimeout = activeRequestTimeout(context.task, 15000);
  if (!requestTimeout) return automaticTimeoutResult();
  try { started = await sourcingExtensionRequest("start_1688_job", { taskId: context.taskId, mainImageUrl, strategy }, requestTimeout); }
  catch (error) { return timeExceeded(context.task) ? automaticTimeoutResult() : { status: "bridge_failed", diagnostics: { code: "bridge_start_failed", message: text(error?.message) } }; }
  if (!contextIsCurrent(context)) return { status: "stale" };
  const jobId = text(started?.jobId); if (timeExceeded(context.task)) { await safeCancel1688Job(jobId); return automaticTimeoutResult(); }
  if (!jobId) return { status: "bridge_failed", diagnostics: { code: "missing_job_id" } };
  const sourcing = sourcingState(context.task); sourcing.searchStrategy = strategy.type; sourcing.activeJob = { jobId, strategy: clone(strategy, null), status: text(started.status, "queued"), phase: text(started.phase, "queued"), updatedAt: new Date().toISOString() }; persistQueue(); render();
  return poll1688Job(context, jobId, strategy);
}
async function runSearchStrategy(context, strategy) {
  const result = await run1688BridgeJob(context, strategy); if (!contextIsCurrent(context) || result.status === "stale") return result;
  if (["paused_platform_verification", "paused_manual", "cancelled"].includes(result.status)) return result;
  const sourcing = sourcingState(context.task), light = Array.isArray(result?.candidates) ? result.candidates.slice(0, sourcingFlow.AUTOMATIC_1688_LIMITS.maxLightweightCandidates) : [], details = sourcingFlow.detailCandidatesForInspection(Array.isArray(result?.detailCandidates) ? result.detailCandidates : []).filter((candidate) => sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl));
  sourcing.strategyCandidates = object(sourcing.strategyCandidates) || {}; sourcing.strategyCandidates[strategy.type] = { lightweightCandidates: clone(light, []), detailCandidates: clone(details, []), completedAt: new Date().toISOString() };
  sourcing.lightweightCandidates = sourcingFlow.mergeAutomaticCandidates(sourcing.lightweightCandidates || [], light); sourcing.detailCandidates = mergeDetailedCandidates(sourcing.detailCandidates || [], details);
  recordSearchAttempt(context.task, strategy.type, { status: result.status === "completed" ? "completed" : result.status || "failed", usableCount: details.length, candidateCount: light.length, diagnostics: result.diagnostics, jobId: result.jobId }); persistQueue(); render(); return { ...result, usableCount: details.length };
}
async function ensureKeywords(context) {
  const sourcing = sourcingState(context.task); if (Array.isArray(sourcing.keywords) && sourcing.keywords.length) return sourcing.keywords;
  const requestTimeout = activeRequestTimeout(context.task, sourcingFlow.AUTOMATIC_1688_LIMITS.qwenMs);
  if (!requestTimeout) { buildNoSourceFinal(context.task, "automatic_timeout", "pending_human_review"); return null; }
  try {
    const result = await apiWithTimeout("/api/ai/1688-keywords", context.task, requestTimeout, "1688关键词判断"); if (!contextIsCurrent(context)) return null;
    if (timeExceeded(context.task)) { buildNoSourceFinal(context.task, "automatic_timeout", "pending_human_review"); return null; }
    const keywords = Array.isArray(result?.keywords) ? result.keywords.filter((value) => typeof value === "string" && value.trim()).slice(0, 3) : []; if (!keywords.length) throw new Error("未得到可验证关键词");
    sourcing.keywords = keywords; sourcing.keywordModel = { provider: text(result.provider), model: text(result.model), judgedAt: text(result.judgedAt) || new Date().toISOString() }; persistQueue(); render(); return keywords;
  } catch (error) { const blocker = timeExceeded(context.task) ? "automatic_timeout" : "keyword_generation_failed"; buildNoSourceFinal(context.task, blocker, "pending_human_review"); setStatus(`关键词生成失败：${text(error?.message, "请人工确认")}`, "bad"); return null; }
}
async function runKeywordSearches(context) {
  const keywords = await ensureKeywords(context); if (!keywords || !contextIsCurrent(context)) return { status: "failed" };
  let last = { status: "failed", usableCount: 0 };
  for (const query of keywords.slice(0, 3)) { if (timeExceeded(context.task)) return { status: "automatic_timeout" }; last = await runSearchStrategy(context, { type: "keyword", query }); if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(last.status) || last.usableCount > 0) return last; }
  return last;
}
function similarSupplierImage(task) { return [...(task?.sourcing?.lightweightCandidates || []), ...(task?.sourcing?.detailCandidates || [])].map((candidate) => ({ candidate, imageUrl: text(candidate?.imageUrl) })).find((entry) => trusted1688Image(entry.imageUrl)) || null; }
function judgementCanContinue(judgement, candidate) {
  const assessment = (judgement?.candidateAssessments || []).find((entry) => text(entry?.candidateId) === text(candidate?.candidateId));
  return judgement?.verdict === "same_product" && judgement?.needsHumanReview === false && Number(judgement?.confidence) >= 85 && judgement?.bestCandidateId === candidate?.candidateId && assessment?.verdict === "same_product" && Number(assessment?.confidence) >= 85 && Array.isArray(assessment?.differences) && assessment.differences.length === 0;
}
function exactExceptionForCandidate(candidate) {
  const url = sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl), productId = text(candidate?.productId) || /^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html$/.exec(url)?.[1] || "";
  return productId ? queueMeta().singleUnitExceptions[productId] || null : null;
}
async function previewCandidatePricing(context, quote) {
  const preliminary = preliminaryPricingDecision(context.task, quote.purchaseCost);
  if (preliminary.status === "rejected_preliminary") return { status: "rejected_preliminary", eligibleAt18Pct: false, purchaseCost: quote.purchaseCost, maxPurchaseCostAt18Pct: preliminary.preliminaryLimit };
  const remaining = activeRequestTimeout(context.task, 90000);
  if (remaining <= 0) throw new Error("automatic_timeout");
  try {
    const preview = await preview1688PurchaseCostWithFinalPricing(context.task, quote.purchaseCost, remaining); if (!contextIsCurrent(context) || preview?.stale) return { stale: true }; if (timeExceeded(context.task)) throw new Error("automatic_timeout"); return preview;
  } catch (error) { if (timeExceeded(context.task)) throw new Error("automatic_timeout"); throw error; }
}
async function evaluateCandidates(context) {
  const task = context.task, candidates = usableCandidates(task); if (!candidates.length) return buildNoSourceFinal(task, "no_complete_1688_candidate");
  const judgementTimeout = activeRequestTimeout(task, sourcingFlow.AUTOMATIC_1688_LIMITS.qwenMs);
  if (!judgementTimeout) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review");
  let result; try { result = await apiWithTimeout("/api/ai/1688-judge", { task, candidates }, judgementTimeout, "1688同款判断"); }
  catch { return buildNoSourceFinal(task, timeExceeded(task) ? "automatic_timeout" : "judgement_missing_or_failed", "pending_human_review"); }
  if (!contextIsCurrent(context)) return { status: "stale" };
  if (timeExceeded(task)) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review");
  const judgement = result?.judgement, candidate = candidates.find((entry) => text(entry?.candidateId) === text(judgement?.bestCandidateId)) || candidates[0], sourcing = sourcingState(task);
  sourcing.aiJudgement = clone(judgement, null); sourcing.judgementMetadata = { provider: text(result?.provider), model: text(result?.model), judgedAt: text(result?.judgedAt) || new Date().toISOString() }; persistQueue(); render();
  if (!judgementCanContinue(judgement, candidate)) { const quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)); return queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["judgement_requires_human_confirmation"]); }
  const options = Array.isArray(candidate?.sku?.options) ? candidate.sku.options : [];
  if (!options.length) { const quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)); return queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_options_missing"]); }
  const selectionTimeout = activeRequestTimeout(task, sourcingFlow.AUTOMATIC_1688_LIMITS.qwenMs);
  if (!selectionTimeout) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review");
  let selectionResult; try { selectionResult = await apiWithTimeout("/api/ai/1688-select-sku", { task, candidate, skuOptions: options }, selectionTimeout, "1688规格判断"); }
  catch { const quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)); return timeExceeded(task) ? buildNoSourceFinal(task, "automatic_timeout", "pending_human_review") : queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_selection_missing_or_failed"]); }
  if (!contextIsCurrent(context)) return { status: "stale" };
  if (timeExceeded(task)) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review");
  const selection = selectionResult?.selection, selected = options.find((option) => text(option?.id || option?.optionId) === text(selection?.selectedOptionId)), selectedCandidate = { ...candidate, sku: { ...candidate.sku, selectedOptionId: selected ? text(selected.id || selected.optionId) : null, selectionVerified: false } };
  sourcing.skuSelection = clone(selection, null);
  if (!selected || selection?.verdict !== "exact_match" || selection?.needsHumanReview !== false || Number(selection?.confidence) < 85) { const quote = sourcingFlow.quoteAutomaticSingleUnit(selectedCandidate, exactExceptionForCandidate(selectedCandidate)); return queueCandidateFinal(task, selectedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_selection_requires_human_confirmation"]); }
  const verification = await run1688BridgeJob(context, { type: "verify_sku", sourceUrl: sourcingFlow.canonical1688OfferUrl(selectedCandidate.sourceUrl), optionId: text(selected.id || selected.optionId), optionLabel: text(selected.label), expectedPrice: Number(selectedCandidate?.pricing?.selectedSkuPrice) });
  if (!contextIsCurrent(context) || verification.status === "stale") return verification;
  const selectionVerified = verification.status === "completed" && verification?.diagnostics?.code === "sku_verified";
  sourcing.skuVerification = {
    status: text(verification.status, "failed"), jobId: text(verification.jobId) || null,
    selectedOptionId: text(selected.id || selected.optionId), selectionVerified,
    diagnostics: clone(verification.diagnostics, null), checkedAt: new Date().toISOString(),
  };
  persistQueue(); render();
  if (["paused_platform_verification", "paused_manual", "cancelled"].includes(verification.status)) return verification;
  if (verification.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review");
  const verifiedCandidate = { ...selectedCandidate, sku: { ...selectedCandidate.sku, selectionVerified } };
  if (verification.status !== "completed" || !verifiedCandidate.sku.selectionVerified) { const quote = sourcingFlow.quoteAutomaticSingleUnit(verifiedCandidate, exactExceptionForCandidate(verifiedCandidate)); return queueCandidateFinal(task, verifiedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_verification_failed"]); }
  const quote = sourcingFlow.quoteAutomaticSingleUnit(verifiedCandidate, exactExceptionForCandidate(verifiedCandidate)); if (!quote.confirmable) return queueCandidateFinal(task, verifiedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" });
  let finalPricing; try { finalPricing = await previewCandidatePricing(context, quote); }
  catch (error) { return text(error?.message) === "automatic_timeout" || timeExceeded(task) ? buildNoSourceFinal(task, "automatic_timeout", "pending_human_review") : queueCandidateFinal(task, verifiedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "preview_failed" }, ["final_pricing_preview_missing_or_failed"]); }
  if (!contextIsCurrent(context) || finalPricing?.stale) return { status: "stale" }; return queueCandidateFinal(task, verifiedCandidate, judgement, quote, finalPricing);
}
async function resumePausedAutomaticTask(context) {
  const sourcing = sourcingState(context.task), jobId = text(sourcing?.activeJob?.jobId); if (jobId) await safeCancel1688Job(jobId); if (!contextIsCurrent(context)) return false;
  sourcing.activeJob = null; sourcing.status = "automatic_running"; sourcing.timing = sourcingFlow.resumeAutomaticTiming(sourcing.timing); persistQueue(); render(); return true;
}
async function runAutomatic1688Task(task) {
  const taskId = taskIdOf(task); if (!taskId) throw new Error("任务ID缺失，无法启动自动找货源。"); if (automaticRuns.has(taskId)) return automaticRuns.get(taskId);
  const run = (async () => {
    const context = { task, taskId }; if (!contextIsCurrent(context)) return { stale: true };
    const sourcing = sourcingState(task); if (sourcing.status === "confirmed_purchase_source" || sourcing.finalConfirmation?.status === "final_confirmation_pending") return sourcing.finalConfirmation || { status: sourcing.status };
    const preflight = readiness(task); if (!preflight.ready) return buildNoSourceFinal(task, `automatic_preconditions_missing:${preflight.reasons.join("/")}`, "pending_human_review");
    if (["paused_platform_verification", "paused_manual"].includes(sourcing.status)) { if (!await resumePausedAutomaticTask(context)) return { stale: true }; }
    else { sourcing.status = "automatic_running"; sourcing.provider = "1688"; sourcing.timing = sourcingFlow.resumeAutomaticTiming(sourcing.timing); sourcing.searchAttempts = Array.isArray(sourcing.searchAttempts) ? sourcing.searchAttempts : []; sourcing.lightweightCandidates = Array.isArray(sourcing.lightweightCandidates) ? sourcing.lightweightCandidates : []; sourcing.detailCandidates = Array.isArray(sourcing.detailCandidates) ? sourcing.detailCandidates : []; sourcing.rejectedCandidateIds = Array.isArray(sourcing.rejectedCandidateIds) ? sourcing.rejectedCandidateIds : []; persistQueue(); render(); }
    for (let transition = 0; transition < 12; transition += 1) {
      if (!contextIsCurrent(context)) return { stale: true }; if (timeExceeded(task)) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review"); if (automaticBatch.stopRequested) return { status: "cancelled" }; if (automaticBatch.paused && automaticBatch.status !== "paused_platform_verification") return { status: "paused_manual" };
      const action = sourcingFlow.nextAutomaticAction(sourcingState(task));
      if (action.type === "start_image_search") { const result = await runSearchStrategy(context, { type: "image", sourceUrl: task.enrichment?.mainImageUrl || task.ozon?.mainImageUrl }); if (result.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review"); if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) return result; continue; }
      if (action.type === "generate_keywords") { if (!await ensureKeywords(context)) return { status: "keyword_failed" }; continue; }
      if (action.type === "start_keyword_search") { const result = await runKeywordSearches(context); if (result.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review"); if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) return result; continue; }
      if (action.type === "start_similar_supplier_search") { const similar = similarSupplierImage(task); if (!similar) { recordSearchAttempt(task, "similar_supplier", { status: "completed", usableCount: 0, candidateCount: 0, diagnostics: { code: "no_trusted_supplier_image" } }); persistQueue(); render(); continue; } const result = await runSearchStrategy(context, { type: "similar_supplier", query: text(similar.candidate?.title), sourceUrl: similar.imageUrl }); if (result.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review"); if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) return result; continue; }
      if (action.type === "judge_candidates") return evaluateCandidates(context);
      if (action.type === "queue_no_source_confirmation") return buildNoSourceFinal(task, "no_usable_1688_source");
      if (action.type === "pause_platform_verification") return { status: "paused_platform_verification" };
      if (action.type === "complete") return sourcing.finalConfirmation || { status: sourcing.status };
      return buildNoSourceFinal(task, "automatic_state_machine_invalid", "pending_human_review");
    }
    return buildNoSourceFinal(task, "automatic_state_machine_exhausted", "pending_human_review");
  })();
  automaticRuns.set(taskId, run); try { return await run; } finally { if (automaticRuns.get(taskId) === run) automaticRuns.delete(taskId); }
}
async function runAutomatic1688Batch() {
  if (automaticBatch.running) return { status: "already_running" }; if (!queue?.tasks?.length) throw new Error("请先导入Ozon补全JSON。");
  automaticBatch.running = true; automaticBatch.paused = false; automaticBatch.stopRequested = false; automaticBatch.status = "running"; automaticBatch.pauseReason = ""; persistQueue(); render();
  try {
    const tasks = queue.tasks;
    for (; automaticBatch.cursor < tasks.length; automaticBatch.cursor += 1) {
      if (automaticBatch.stopRequested || automaticBatch.paused) break; const task = tasks[automaticBatch.cursor]; automaticBatch.activeTaskId = taskIdOf(task); persistQueue(); render();
      try {
        const result = await runAutomatic1688Task(task);
        if (result?.status === "paused_platform_verification" || task?.sourcing?.status === "paused_platform_verification") { automaticBatch.paused = true; automaticBatch.status = "paused_platform_verification"; automaticBatch.pauseReason = "1688平台要求人工验证"; break; }
        if (["cancelled", "paused_manual"].includes(result?.status)) break; automaticBatch.completed += 1;
      } catch { automaticBatch.failed += 1; buildNoSourceFinal(task, "automatic_task_failed", "pending_human_review"); }
      persistQueue(); render();
    }
    if (automaticBatch.cursor >= tasks.length && !automaticBatch.paused && !automaticBatch.stopRequested) automaticBatch.status = "completed"; if (automaticBatch.stopRequested) automaticBatch.status = "cancelled";
    setStatus(automaticBatch.status === "completed" ? "批量自动找货源已完成，待确认商品在下方队列。" : `批量自动找货源已${automaticBatch.status === "paused_platform_verification" ? "因平台验证暂停" : "停止"}。`, automaticBatch.status === "completed" ? "ok" : "bad"); return { status: automaticBatch.status };
  } finally { automaticBatch.running = false; automaticBatch.activeTaskId = ""; persistQueue(); render(); }
}
async function pauseAutomatic1688Batch() {
  automaticBatch.paused = true; automaticBatch.status = "paused_manual"; automaticBatch.pauseReason = "用户暂停"; const task = currentQueuedTask(automaticBatch.activeTaskId), jobId = text(task?.sourcing?.activeJob?.jobId);
  if (task) { sourcingState(task).timing = sourcingFlow.pauseAutomaticTiming(task.sourcing.timing); sourcingState(task).status = "paused_manual"; }
  persistQueue(); render(); await safeCancel1688Job(jobId); setStatus("已暂停当前批量；恢复后会从安全阶段继续。", "ok");
}
async function resumeAutomatic1688Batch() { automaticBatch.paused = false; automaticBatch.stopRequested = false; automaticBatch.status = "idle"; automaticBatch.pauseReason = ""; persistQueue(); render(); return runAutomatic1688Batch(); }
async function cancelAutomatic1688Batch() {
  automaticBatch.stopRequested = true; automaticBatch.paused = false; automaticBatch.status = "cancelled"; const task = currentQueuedTask(automaticBatch.activeTaskId), jobId = text(task?.sourcing?.activeJob?.jobId);
  if (task) { sourcingState(task).status = "automatic_cancelled"; recordAudit(task, "automatic_cancelled", { jobId: jobId || null }); }
  persistQueue(); render(); await safeCancel1688Job(jobId); setStatus("已取消批量自动找货源；没有写入任何采购价。", "ok");
}

function currentConfirmationFacts(task) {
  const sourcing = sourcingState(task), final = sourcing.finalConfirmation, candidate = currentCardCandidate(task, final), judgement = sourcing.aiJudgement, quote = candidate ? sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)) : null;
  return { final, candidate, judgement, quote, finalPricing: sourcing.finalPricingPreview };
}
function factsMatchFinal(final, facts) {
  return Boolean(final && facts?.candidate && facts?.judgement && facts?.quote && facts?.finalPricing)
    && JSON.stringify(final.candidateSnapshot) === JSON.stringify(facts.candidate)
    && JSON.stringify(final.judgementSnapshot) === JSON.stringify(facts.judgement)
    && JSON.stringify(final.quoteSnapshot) === JSON.stringify(facts.quote)
    && JSON.stringify(final.finalPricing) === JSON.stringify(facts.finalPricing);
}
function clearStaleTask5Pending(task) {
  const sourcing = sourcingState(task);
  if (sourcing.pendingConfirmation?.status === "final_confirmation_pending") { recordAudit(task, "stale_pending_confirmation_discarded", { previousConfirmationId: text(sourcing.pendingConfirmation.confirmationId) || null }); delete sourcing.pendingConfirmation; }
}
function withTaskActionLock(taskId, action, operation) {
  const key = `${taskId}:${action}`; if (taskActionLocks.has(key)) return taskActionLocks.get(key);
  const run = Promise.resolve().then(operation).finally(() => { if (taskActionLocks.get(key) === run) taskActionLocks.delete(key); render(); }); taskActionLocks.set(key, run); render(); return run;
}
async function confirmFinalCandidate(taskId) {
  return withTaskActionLock(taskId, "confirm", async () => {
    const task = currentQueuedTask(taskId); if (!task) throw new Error("任务已变更或不存在，拒绝写入采购价。"); const facts = currentConfirmationFacts(task);
    if (facts.final?.status !== "final_confirmation_pending" || !factsMatchFinal(facts.final, facts)) { if (facts.final) { facts.final.status = "final_confirmation_blocked"; facts.final.blockers = appendBlockers(facts.final, ["confirmation_data_changed"]); } recordAudit(task, "confirmation_blocked", { reason: "confirmation_data_changed" }); persistQueue(); throw new Error("候选、判断、报价或最终试算已变化/缺失，已保留在人工确认队列且未写入采购价。"); }
    clearStaleTask5Pending(task); const pending = sourcingCore.buildFinalConfirmation({ task, candidate: facts.candidate, judgement: facts.judgement, quote: facts.quote, finalPricing: facts.finalPricing });
    if (pending.status !== "final_confirmation_pending") { facts.final.status = "final_confirmation_blocked"; facts.final.blockers = appendBlockers(facts.final, ["confirmation_current_revalidation_failed"]); persistQueue(); throw new Error("当前安全复验未通过，未写入采购价。"); }
    const result = sourcingCore.confirmRecommendation(task, pending, { task, candidate: facts.candidate, judgement: facts.judgement, quote: facts.quote, finalPricing: facts.finalPricing }, new Date().toISOString());
    const sourcing = sourcingState(task); sourcing.confirmedCandidate = clone(facts.candidate, null); sourcing.finalConfirmation = { ...pending, status: "final_confirmation_confirmed", candidateSnapshot: clone(facts.candidate, null), judgementSnapshot: clone(facts.judgement, null), quoteSnapshot: clone(facts.quote, null), finalPricing: clone(facts.finalPricing, null), confirmedAt: new Date().toISOString() }; pricingState(task).finalOzonPricing = clone(facts.finalPricing, null); recordAudit(task, "confirmed_purchase_source", { candidateId: text(facts.candidate.candidateId), confirmationId: pending.confirmationId }); persistQueue(); render(); setStatus("已确认采用，采购成本现已写入该任务。", "ok"); return result;
  });
}
async function rejectFinalCandidate(taskId) {
  return withTaskActionLock(taskId, "reject", async () => {
    const task = currentQueuedTask(taskId); if (!task) throw new Error("任务已变更或不存在。"); const facts = currentConfirmationFacts(task), sourcing = sourcingState(task), candidateId = text(facts.candidate?.candidateId || facts.final?.candidate?.candidateId); if (!candidateId) throw new Error("当前确认卡片缺少候选身份，不能否决。");
    if (facts.final?.status === "final_confirmation_pending" && factsMatchFinal(facts.final, facts)) { clearStaleTask5Pending(task); const pending = sourcingCore.buildFinalConfirmation({ task, candidate: facts.candidate, judgement: facts.judgement, quote: facts.quote, finalPricing: facts.finalPricing }); if (pending.status === "final_confirmation_pending") { sourcingCore.rejectRecommendation(task, pending, new Date().toISOString()); delete sourcingState(task).pendingConfirmation; } }
    sourcing.rejectedCandidateIds = [...new Set([...(Array.isArray(sourcing.rejectedCandidateIds) ? sourcing.rejectedCandidateIds : []), candidateId])]; recordAudit(task, "candidate_rejected", { candidateId, finalStatus: facts.final?.status || "missing" });
    const next = sourcingFlow.promoteNextCandidate(sourcing.detailCandidates || [], sourcing.rejectedCandidateIds);
    if (!next) { buildNoSourceFinal(task, "no_acceptable_next_candidate", "pending_human_review"); setStatus("已否决当前候选，暂无可继续尝试的1688候选。", "bad"); return { status: "no_next_candidate" }; }
    delete sourcing.finalConfirmation; delete sourcing.activeCandidate; delete sourcing.aiJudgement; delete sourcing.quote; delete sourcing.finalPricingPreview; sourcing.status = "automatic_running"; task.status = "pending_human_review"; persistQueue(); render(); setStatus("已否决当前候选，正在按安全规则尝试下一候选。", "ok"); return runAutomatic1688Task(task);
  });
}
function strictSingleUnitPrice(value) { const raw = typeof value === "number" ? value.toFixed(2) : text(value); if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null; const money = Number(raw); return Number.isFinite(money) && money > 0 && money <= 1_000_000_000 ? Number(money.toFixed(2)) : null; }
async function saveSingleUnitException(taskId, price) {
  return withTaskActionLock(taskId, "single-unit-exception", async () => {
    const task = currentQueuedTask(taskId); if (!task) throw new Error("任务已变更或不存在，不能保存例外。"); const final = task?.sourcing?.finalConfirmation, candidate = currentCardCandidate(task, final), onePiecePrice = strictSingleUnitPrice(price), sourceUrl = sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl), productId = text(candidate?.productId) || /^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html$/.exec(sourceUrl)?.[1] || "";
    if (Number(candidate?.minimumOrderQuantity) !== 2 || !sourceUrl || !productId || onePiecePrice === null) throw new Error("仅能为当前1688页面已核验的MOQ 2候选保存正数、两位小数以内的一件采购价。");
    const exceptions = queueMeta().singleUnitExceptions, existing = exceptions[productId]; if (existing && (text(existing.productId) !== productId || sourcingFlow.canonical1688OfferUrl(existing.sourceUrl) !== sourceUrl)) throw new Error("同一产品ID已有不同页面的例外记录，拒绝跨商品复用。");
    const exception = { productId, sourceUrl, onePiecePrice, confirmedAt: new Date().toISOString() }; exceptions[productId] = exception; recordAudit(task, "manual_exact_product_exception_saved", { productId, sourceUrl, onePiecePrice });
    const judgement = task?.sourcing?.aiJudgement || final?.judgementSnapshot || final?.judgement, quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exception);
    if (!quote.confirmable) { queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }); throw new Error("例外价格未能通过当前商品、MOQ、规格或运费复验。"); }
    const context = { task, taskId: taskIdOf(task) }; let finalPricing;
    try { finalPricing = await previewCandidatePricing(context, quote); } catch { queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "preview_failed" }, ["final_pricing_preview_missing_or_failed"]); throw new Error("一件价已任务绑定保存，但最终利润试算未完成，仍不能确认采用。"); }
    if (!contextIsCurrent(context) || finalPricing?.stale) throw new Error("任务已变更，例外未用于写入采购价。"); queueCandidateFinal(task, candidate, judgement, quote, finalPricing); setStatus("一件采购价已按当前产品绑定保存；请重新查看试算后单独确认采用。", "ok"); return exception;
  });
}
async function startSinglePinduoduoDeepSearch(taskId) {
  return withTaskActionLock(taskId, "manual-pinduoduo-deep-search", async () => {
    const task = currentQueuedTask(taskId); if (!task) throw new Error("任务已变更或不存在。"); if (!window.confirm("将仅为这一件打开 MuMu 和拼多多进行深度补搜；不会自动下单、购买或联系商家。是否继续？")) return { cancelled: true };
    const result = await api("/api/task/search", { method: "POST", body: JSON.stringify(task) }); sourcingState(task).manualPinduoduoDeepSearch = { requestedAt: new Date().toISOString(), result: clone(result, null) }; recordAudit(task, "manual_pinduoduo_deep_search_requested", { taskId: taskIdOf(task) }); persistQueue(); render(); setStatus("已仅为当前单品启动拼多多深度补搜；采购价仍需人工确认。", "ok"); return result;
  });
}

function importQueueFile(file) {
  if (!file) return; const reader = new FileReader();
  reader.onload = () => {
    try { const parsed = JSON.parse(String(reader.result || "")), imported = object(parsed?.queue) || object(parsed); if (!Array.isArray(imported?.tasks)) throw new Error("JSON中没有任务数组。"); queue = imported; sourceName = file.name || sourceName; queueMeta(); automaticBatch.cursor = 0; automaticBatch.completed = 0; automaticBatch.failed = 0; automaticBatch.status = "idle"; persistQueue(); render(); setStatus(`已导入${queue.tasks.length}个任务；可开始批量自动找货源。`, "ok"); }
    catch (error) { setStatus(`导入失败：${error?.message || "JSON格式无效"}`, "bad"); }
  };
  reader.readAsText(file);
}
function downloadQueue() { if (!queue) return; const blob = new Blob([JSON.stringify({ queue, sourceName }, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = sourceName.replace(/\.json$/i, "") + "-sourcing-mvp6.json"; link.click(); URL.revokeObjectURL(url); }
function bindUi() {
  $("queueFile")?.addEventListener("change", (event) => importQueueFile(event?.target?.files?.[0])); $("download")?.addEventListener("click", downloadQueue);
  $("batchStart")?.addEventListener("click", () => runAutomatic1688Batch().catch((error) => setStatus(error?.message || "批量启动失败。", "bad")));
  $("batchPause")?.addEventListener("click", () => pauseAutomatic1688Batch().catch((error) => setStatus(error?.message || "暂停失败。", "bad")));
  $("batchResume")?.addEventListener("click", () => resumeAutomatic1688Batch().catch((error) => setStatus(error?.message || "恢复失败。", "bad")));
  $("batchStop")?.addEventListener("click", () => cancelAutomatic1688Batch().catch((error) => setStatus(error?.message || "取消失败。", "bad")));
}

restoreQueue();
bindUi();
render();
