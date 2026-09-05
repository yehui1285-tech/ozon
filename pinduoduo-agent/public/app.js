import { applyFinalOzonPricing, createFinalPricingRequestGuard, preliminaryPricingDecision, previewFinalOzonPricing } from "./pricing-flow.js";
import * as sourcingFlow from "./sourcing-flow.js";
import * as sourcingCore from "/sourcing-core.mjs";

const storageKey = "ozon-sourcing-agent-mvp6";
const legacyStorageKeys = ["ozon-pinduoduo-agent-mvp3"];
const appVersion = "MVP 6.0";
const finalPricingRequestGuard = createFinalPricingRequestGuard();
const automaticRuns = new WeakMap();
const activeAutomaticRuns = new Set();
const taskActionLocks = new WeakMap();
const manualTaskLocks = new WeakMap();
const automaticProvider = { task: null, mode: "", generation: 0 };
const automaticBatch = { running: false, paused: false, stopRequested: false, cursor: 0, completed: 0, failed: 0, activeTaskId: "", pauseReason: "", status: "idle" };

let queue = null;
let sourceName = "ozon-sourcing.json";
let pageUnloading = false;
let requestSequence = 0;

const $ = (id) => document.getElementById(id);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
window.addEventListener("beforeunload", () => {
  pageUnloading = true;
  for (const context of [...activeAutomaticRuns]) {
    const task = context?.task;
    if (!task) continue;
    invalidateAutomaticRun(task, "page_unload");
    if (task?.sourcing?.timing) {
      task.sourcing.timing = sourcingFlow.pauseAutomaticTiming(task.sourcing.timing);
      task.sourcing.status = "paused_manual";
    }
  }
  persistQueue();
});

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function text(value, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; } }
function safeTaskId(value) { const id = text(value); return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) ? id : ""; }
function taskIdOf(task) {
  const hasTaskId = object(task) && Object.hasOwn(task, "taskId"), hasId = object(task) && Object.hasOwn(task, "id");
  const taskId = hasTaskId ? safeTaskId(task.taskId) : "", id = hasId ? safeTaskId(task.id) : "";
  if ((hasTaskId && !taskId) || (hasId && !id) || (taskId && id && taskId !== id)) return "";
  return taskId || id;
}
function stableTaskIdentity(task) {
  const id = taskIdOf(task); if (!id) return "";
  return Object.hasOwn(object(task) || {}, "taskId") ? `taskId:${id}` : `id:${id}`;
}
function queueTasksWithId(id) { return Array.isArray(queue?.tasks) ? queue.tasks.filter((task) => taskIdOf(task) === id) : []; }
function currentQueuedTask(taskOrId) {
  if (!Array.isArray(queue?.tasks)) return null;
  if (taskOrId && typeof taskOrId === "object") {
    const id = taskIdOf(taskOrId), matches = id ? queueTasksWithId(id) : [];
    return matches.length === 1 && matches[0] === taskOrId ? taskOrId : null;
  }
  const id = text(taskOrId);
  const matches = id ? queueTasksWithId(id) : [];
  return matches.length === 1 ? matches[0] : null;
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
function formatMoney(value) { return typeof value === "number" && Number.isFinite(value) ? `¥${value.toFixed(2)}` : "待确认"; }
function stageLabel(status) {
  return ({ automatic_running: "自动处理中", paused_platform_verification: "平台验证暂停", paused_manual: "已暂停", automatic_cancelled: "已取消", final_confirmation_pending: "待最终确认", final_confirmation_blocked: "需人工处理", final_confirmation_confirmed: "已确认采购来源", final_confirmation_rejected: "已否决，待继续", confirmed_purchase_source: "已确认采购来源", no_source_found: "未找到可确认货源" })[status] || text(status) || "待处理";
}
function blockerLabel(value) {
  const code = text(value);
  const labels = {
    automatic_timeout: "自动找货源超过活动时间上限",
    automatic_task_failed: "自动找货源未完成，请人工复核",
    automatic_state_machine_invalid: "自动流程状态异常，请人工复核",
    automatic_state_machine_exhausted: "自动流程步骤已耗尽，请人工复核",
    no_complete_1688_candidate: "未取得完整的1688候选详情",
    no_usable_1688_source: "未找到可确认的1688货源",
    no_acceptable_next_candidate: "没有可继续尝试的安全候选",
    judgement_missing_or_failed: "同款判断未完成",
    judgement_requires_human_confirmation: "同款判断需要人工确认",
    sku_options_missing: "1688页面缺少可核验规格",
    sku_selection_missing_or_failed: "目标规格判断未完成",
    sku_selection_requires_human_confirmation: "目标规格需要人工确认",
    sku_verification_failed: "1688页面规格复核未通过",
    sku_not_verified: "目标规格尚未复核",
    shipping_unknown: "国内运费待确认",
    minimum_order_quantity_unknown: "最小起订量待确认",
    minimum_order_quantity_gt_2: "最小起订量超过自动核价范围",
    single_unit_price_unverified: "一件采购价待人工确认",
    missing_single_unit_price: "单件采购价待确认",
    invalid_product_identity: "1688商品身份不一致",
    missing_title: "1688商品标题缺失",
    candidate_not_whitelisted: "候选不属于本次安全候选集",
    judgement_not_same_product: "同款判断未通过",
    candidate_assessment_conflict: "候选判断存在冲突",
    final_pricing_not_eligible_at_18pct: "最终18%利润试算未通过",
    final_pricing_preview_missing_or_failed: "最终18%利润试算未完成",
    confirmation_data_changed: "候选或报价已变化，请重新复核",
    confirmation_task_identity_invalid: "任务身份无效，无法确认",
    confirmation_build_failed: "确认卡片生成失败，请人工复核",
  };
  if (code.startsWith("automatic_preconditions_missing:")) return "自动找货源前置资料不完整";
  return labels[code] || "需人工复核（原因待确认）";
}
function blockersLabel(values) { return (Array.isArray(values) ? values : []).map(blockerLabel).filter(Boolean).join("、"); }
function priceSourceLabel(value) {
  return ({ one_piece: "页面一件价", sample: "页面样品价", selected_sku: "已核验规格价", manual_exact_product_exception: "客服确认的本商品一件价", unknown: "待确认" })[text(value)] || "待确认";
}
function segmentedTimingLabel(task) {
  const attempts = Array.isArray(task?.sourcing?.searchAttempts) ? task.sourcing.searchAttempts.slice(-6) : [];
  const labels = { image: "图片搜同款", keyword: "关键词搜索", similar_supplier: "相似供应商" };
  const segments = attempts.map((attempt) => {
    const durationMs = Number(attempt?.durationMs);
    const seconds = Number.isFinite(durationMs) && durationMs >= 0 ? `${(durationMs / 1000).toFixed(1)}秒` : "进行中";
    return `${labels[text(attempt?.strategy)] || "找货源"} ${seconds}`;
  });
  return segments.length ? segments.join("；") : "待确认";
}
function trustedLocalEvidenceRef(rawValue) {
  try {
    const url = new URL(text(rawValue), window.location.origin);
    return url.origin === window.location.origin
      && url.search === ""
      && url.hash === ""
      && /^\/api\/evidence\/1688\/[a-f0-9]{32}$/i.test(url.pathname)
      ? url.pathname
      : "";
  } catch { return ""; }
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
    const values = [String(index + 1), `${text(task?.ozon?.sku) || "—"}\n${text(task?.ozon?.name) || "未命名商品"}`, formatMoney(task?.enrichment?.maxPurchaseCostAt18Pct), stageLabel(task?.sourcing?.status), text(candidate?.title, "—"), blockersLabel(final?.blockers) || (final?.eligibleAt18Pct ? "18%通过" : "待试算"), task?.pricing?.purchaseCost === undefined ? "确认后写入" : formatMoney(task.pricing.purchaseCost)];
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
    const final = task.sourcing.finalConfirmation, candidate = currentCardCandidate(task, final), judgement = task.sourcing.aiJudgement || final.judgementSnapshot || final.judgement || {}, quote = candidate ? sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)) : (task.sourcing.quote || final.quoteSnapshot || final), preview = task.sourcing.finalPricingPreview || final.finalPricing;
    const card = document.createElement("article"); card.className = `confirmation-card ${final.status === "final_confirmation_pending" ? "ready" : "blocked"}`;
    const head = document.createElement("div"), title = document.createElement("div"), h3 = document.createElement("h3"), sub = document.createElement("p"), badge = document.createElement("strong");
    head.className = "confirmation-card-head"; h3.textContent = text(task?.ozon?.name, "未命名Ozon商品"); sub.textContent = `SKU：${text(task?.ozon?.sku, "—")} · ${stageLabel(final.status)}`; badge.textContent = final.status === "final_confirmation_pending" ? "可确认" : stageLabel(final.status); title.append(h3, sub); head.append(title, badge); card.append(head);
    const media = document.createElement("div"); media.className = "confirmation-media";
    if (trustedOzonImage(task?.enrichment?.mainImageUrl || task?.ozon?.mainImageUrl)) { const image = document.createElement("img"); image.className = "thumb"; image.alt = "Ozon主图"; image.src = task.enrichment?.mainImageUrl || task.ozon?.mainImageUrl; media.append(image); }
    if (trusted1688Image(candidate?.imageUrl)) { const image = document.createElement("img"); image.className = "thumb"; image.alt = "1688候选图"; image.src = candidate.imageUrl; media.append(image); }
    if (media.children.length) card.append(media);
    const facts = document.createElement("div"); facts.className = "confirmation-facts";
    const selectedOption = candidate?.sku?.options?.find((option) => text(option?.id || option?.optionId) === text(candidate?.sku?.selectedOptionId));
    facts.append(
      fact("候选商品", text(candidate?.title, "候选缺失")),
      fact("平台", text(candidate?.provider, "1688")),
      fact("供应商", text(candidate?.supplierName, "未提供")),
      fact("同款置信度", Number.isFinite(Number(judgement?.confidence)) ? `${Number(judgement.confidence)}%` : "未判断"),
      fact("目标规格", text(selectedOption?.label, text(candidate?.sku?.selectedOptionId, "未核验"))),
      fact("MOQ", Number.isInteger(candidate?.minimumOrderQuantity) ? `${candidate.minimumOrderQuantity}件` : "待确认"),
      fact("价格来源", priceSourceLabel(quote?.priceSource)),
      fact("商品价", formatMoney(quote?.productPrice)),
      fact("国内运费", formatMoney(quote?.domesticShipping)),
      fact("采购成本", formatMoney(quote?.purchaseCost)),
      fact("最终18%", preview?.eligibleAt18Pct === true ? "通过" : preview ? "不通过 / 待复核" : "待确认"),
      fact("分段耗时", segmentedTimingLabel(task)),
    ); card.append(facts);
    const evidence = document.createElement("p"); evidence.className = "confirmation-evidence";
    const canonicalCandidateUrl = sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl), localEvidenceRef = trustedLocalEvidenceRef(candidate?.evidence?.localRef);
    if (canonicalCandidateUrl) { const link = document.createElement("a"); link.textContent = "打开1688候选"; link.href = canonicalCandidateUrl; link.target = "_blank"; link.rel = "noreferrer"; evidence.append(link); }
    if (localEvidenceRef) { const link = document.createElement("a"); link.textContent = "查看本地证据"; link.href = localEvidenceRef; link.target = "_blank"; link.rel = "noreferrer"; evidence.append(document.createTextNode(evidence.children.length ? " · " : ""), link); }
    const differences = Array.isArray(judgement?.candidateAssessments) ? judgement.candidateAssessments.find((item) => text(item?.candidateId) === text(candidate?.candidateId))?.differences : [];
    if (Array.isArray(differences) && differences.length) evidence.append(document.createTextNode(`${evidence.children.length ? " · " : ""}差异：${differences.join("；")}`));
    if (evidence.children.length || evidence.textContent) card.append(evidence);
    if (Array.isArray(final.blockers) && final.blockers.length) { const blockers = document.createElement("p"); blockers.className = "confirmation-blockers"; blockers.textContent = `需确认：${blockersLabel(final.blockers)}`; card.append(blockers); }
    const actions = document.createElement("div"); actions.className = "confirmation-actions";
    const actionTarget = { task, taskId: taskIdOf(task), final, confirmationId: text(final.confirmationId) };
    const pending = final.status === "final_confirmation_pending", rejected = final.status === "final_confirmation_rejected";
    const locked = taskActionLocks.has(task) || manualTaskLocks.has(task);
    const needsSingleUnitException = final.status === "final_confirmation_blocked"
      && Number(candidate?.minimumOrderQuantity) === 2
      && Array.isArray(quote?.blockers)
      && quote.blockers.includes("single_unit_price_unverified");
    if (pending) {
      actions.append(
        actionButton("确认采用", () => confirmFinalCandidate(actionTarget), { disabled: locked }),
        actionButton("否决并尝试下一候选", async () => {
          await rejectFinalCandidate(actionTarget);
          const terminal = terminalResult(task, actionTarget.confirmationId);
          return terminal?.action === "reject" ? continueRejectedCandidate(actionTarget) : terminal;
        }, { secondary: true, disabled: locked || !candidate }),
      );
    } else if (rejected) {
      actions.append(actionButton("尝试下一候选", () => continueRejectedCandidate(actionTarget), { secondary: true, disabled: locked }));
    } else if (needsSingleUnitException) {
      const input = document.createElement("input"); input.type = "number"; input.min = "0.01"; input.step = "0.01"; input.placeholder = "客服确认的一件价"; input.className = "price";
      actions.append(input, actionButton("确认客服可一件采购", () => saveSingleUnitException(actionTarget, input.value), { secondary: true, disabled: locked }));
    }
    if (final.status === "final_confirmation_blocked") actions.append(actionButton("单品拼多多深度补搜", () => startSinglePinduoduoDeepSearch(actionTarget), { secondary: true, disabled: locked }));
    if (actions.children.length) card.append(actions); rows.append(card);
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
function abortedError() { const error = new Error("自动找货源已停止。"); error.code = "AUTOMATIC_RUN_ABORTED"; return error; }
async function apiWithTimeout(path, body, timeoutMs, label, signal = null) {
  if (signal?.aborted) throw abortedError();
  const controller = typeof AbortController === "function" ? new AbortController() : null; let timedOut = false;
  const abort = () => controller?.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller?.abort(); }, timeoutMs);
  try { return await api(path, { method: "POST", body: JSON.stringify(body), signal: controller?.signal }); }
  catch (error) { if (timedOut) throw new Error(`${label}超时，请转入人工确认。`); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener?.("abort", abort); }
}
async function sourcingExtensionRequest(action, payload = {}, timeoutMs = 15000, signal = null) {
  const allowed = new Set(["start_1688_job", "get_1688_job", "cancel_1688_job"]);
  if (!allowed.has(action)) return Promise.reject(new Error("找品桥接动作不在允许列表中。"));
  if (pageUnloading) return Promise.reject(new Error("页面正在关闭，已停止找品请求。"));
  if (signal?.aborted) return Promise.reject(abortedError());
  const id = requestId("sourcing");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener("message", onMessage); window.removeEventListener("beforeunload", onUnload); signal?.removeEventListener?.("abort", onAbort); callback(value); };
    const onMessage = (event) => {
      const data = event?.data;
      if (event?.source !== window || event?.origin !== window.location.origin || data?.type !== "OZON_SOURCING_EXTENSION_RESPONSE_V1" || data?.requestId !== id) return;
      if (data?.ok !== true) finish(reject, new Error(text(data?.error, "1688扩展没有完成请求。"))); else finish(resolve, data);
    };
    const timer = setTimeout(() => finish(reject, new Error("1688扩展响应超时，请转入人工确认。")), timeoutMs);
    const onUnload = () => finish(reject, new Error("页面正在关闭，已停止找品请求。"));
    const onAbort = () => finish(reject, abortedError());
    window.addEventListener("message", onMessage);
    window.addEventListener("beforeunload", onUnload);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try { window.postMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action, requestId: id, ...payload }, window.location.origin); }
    catch (error) { finish(reject, error); }
  });
}
function requestFinalOzonPricing(task, timeoutMs = 90000, signal = null) {
  if (signal?.aborted) return Promise.reject(abortedError());
  const id = requestId("final-price");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener("message", onMessage); signal?.removeEventListener?.("abort", onAbort); callback(value); };
    const onMessage = (event) => {
      const data = event?.data;
      if (event?.source !== window || event?.origin !== window.location.origin || data?.type !== "OZON_FINAL_REPRICE_RESPONSE_V1" || data?.requestId !== id) return;
      if (data?.ok !== true) finish(reject, new Error(text(data?.error, "Ozon最终复价失败。"))); else finish(resolve, data);
    };
    const timer = setTimeout(() => finish(reject, new Error("Ozon最终复价响应超时。")), timeoutMs);
    const onAbort = () => finish(reject, abortedError());
    window.addEventListener("message", onMessage);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try { window.postMessage({ type: "OZON_FINAL_REPRICE_REQUEST_V1", requestId: id, task }, window.location.origin); }
    catch (error) { finish(reject, error); }
  });
}
function finalPricingTaskIdentity(task) { return `${taskIdOf(task)}:${text(task?.ozon?.productUrl || task?.ozon?.sku)}`; }
async function preview1688PurchaseCostWithFinalPricing(task, purchaseCost, timeoutMs = 90000, signal = null, context = null) {
  const identity = finalPricingTaskIdentity(task), token = finalPricingRequestGuard.start(task, identity);
  try {
    const response = await requestFinalOzonPricing(task, timeoutMs, signal), current = currentQueuedTask(task);
    if (Number.isInteger(context?.generation) && !automaticContextCanAdvance(context)) return { stale: true };
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

function contextIsCurrent(context) {
  const task = context?.task;
  if (pageUnloading || currentQueuedTask(task) !== task || taskIdOf(task) !== context?.taskId) return false;
  if (!Number.isInteger(context?.generation)) return true;
  return task?.sourcing?.automaticGeneration === context.generation && !context?.invalidated && !context?.controller?.signal?.aborted;
}
function automaticContextCanAdvance(context) {
  return contextIsCurrent(context)
    && context?.task?.sourcing?.status === "automatic_running"
    && automaticBatch.stopRequested !== true
    && automaticBatch.paused !== true;
}
function automaticContextStopResult(context, jobId = "") {
  const status = text(context?.task?.sourcing?.status);
  if (status === "automatic_cancelled" || automaticBatch.stopRequested) return { status: "cancelled", jobId };
  if (status === "paused_manual" || automaticBatch.paused) return { status: "paused_manual", jobId };
  if (status === "paused_platform_verification") return { status: "paused_platform_verification", jobId };
  return { status: "stale", jobId };
}
function nextAutomaticGeneration(task) {
  const sourcing = sourcingState(task);
  const generation = Number.isInteger(sourcing.automaticGeneration) && sourcing.automaticGeneration >= 0 ? sourcing.automaticGeneration + 1 : 1;
  sourcing.automaticGeneration = generation;
  return generation;
}
function beginAutomaticRun(task, mode) {
  const context = {
    task,
    taskId: taskIdOf(task),
    generation: nextAutomaticGeneration(task),
    mode,
    controller: typeof AbortController === "function" ? new AbortController() : null,
    invalidated: false,
    cleanupJobIds: new Set(),
    promise: null,
  };
  automaticRuns.set(task, context);
  activeAutomaticRuns.add(context);
  return context;
}
function invalidateAutomaticRun(task, reason = "stopped") {
  const context = automaticRuns.get(task);
  if (context) {
    context.invalidated = true;
    try { context.controller?.abort(reason); } catch { context.controller?.abort(); }
    if (automaticProvider.task === task && automaticProvider.generation === context.generation) {
      automaticProvider.task = null; automaticProvider.mode = ""; automaticProvider.generation = 0;
    }
  }
  const sourcing = object(task?.sourcing);
  if (sourcing) sourcing.automaticGeneration = (Number.isInteger(sourcing.automaticGeneration) ? sourcing.automaticGeneration : 0) + 1;
  return context || null;
}
function finishAutomaticRun(context) {
  activeAutomaticRuns.delete(context);
  if (automaticRuns.get(context?.task) === context) automaticRuns.delete(context.task);
  if (automaticProvider.task === context?.task && automaticProvider.generation === context?.generation) {
    automaticProvider.task = null; automaticProvider.mode = ""; automaticProvider.generation = 0;
  }
}
function acquireAutomaticProvider(context) {
  if (context.mode === "single" && automaticBatch.running) return { status: "provider_busy_batch" };
  if (automaticProvider.task && automaticProvider.task !== context.task) return { status: "provider_busy" };
  automaticProvider.task = context.task; automaticProvider.mode = context.mode; automaticProvider.generation = context.generation;
  return null;
}
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
function buildNoSourceFinal(task, blocker, status = "no_source_found", context = null) {
  if (context && !automaticContextCanAdvance(context)) return automaticContextStopResult(context);
  const sourcing = sourcingState(task); sourcing.status = status; sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing);
  sourcing.finalConfirmation = { taskIdentity: stableTaskIdentity(task), status: "final_confirmation_blocked", blockers: [blocker], candidate: null, candidateSnapshot: null, judgement: null, judgementSnapshot: null, quoteSnapshot: null, finalPricing: null, generatedAt: new Date().toISOString() };
  persistQueue(); render(); return sourcing.finalConfirmation;
}
function queueCandidateFinal(task, candidate, judgement, quote, finalPricing, extraBlockers = [], context = null) {
  if (context && !automaticContextCanAdvance(context)) return automaticContextStopResult(context);
  const sourcing = sourcingState(task); let pending;
  try { pending = sourcingCore.buildFinalConfirmation({ task, candidate, judgement, quote, finalPricing }); }
  catch (error) {
    pending = { taskIdentity: stableTaskIdentity(task), status: "final_confirmation_blocked", candidate: null, judgement: null, productPrice: quote?.productPrice ?? null, domesticShipping: quote?.domesticShipping ?? null, purchaseCost: quote?.purchaseCost ?? null, priceSource: quote?.priceSource || "unknown", sourceUrl: sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl) || null, eligibleAt18Pct: finalPricing?.eligibleAt18Pct === true, blockers: ["confirmation_task_identity_invalid", text(error?.message, "confirmation_build_failed")] };
  }
  const blockers = appendBlockers(pending, extraBlockers);
  sourcing.activeCandidate = clone(candidate, null); sourcing.aiJudgement = clone(judgement, null); sourcing.quote = clone(quote, null); sourcing.finalPricingPreview = clone(finalPricing, null); sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing);
  Object.assign(pending, {
    status: blockers.length ? "final_confirmation_blocked" : pending.status,
    blockers,
    candidateSnapshot: clone(candidate, null),
    judgementSnapshot: clone(judgement, null),
    quoteSnapshot: clone(quote, null),
    finalPricing: clone(finalPricing, null),
    generatedAt: new Date().toISOString(),
  });
  sourcing.finalConfirmation = pending;
  sourcing.status = sourcing.finalConfirmation.status; task.status = "pending_human_review"; persistQueue(); render(); return sourcing.finalConfirmation;
}
function mergeDetailedCandidates(existing, incoming) {
  return sourcingFlow.mergeAutomaticCandidates(existing, incoming)
    .slice(0, sourcingFlow.AUTOMATIC_1688_LIMITS.maxDetailCandidates);
}
function mergeJobCandidates(task, strategy, job) {
  const sourcing = sourcingState(task);
  const lightweight = sourcingFlow.mergeAutomaticCandidates([], Array.isArray(job?.candidates) ? job.candidates : []);
  const detailed = mergeDetailedCandidates([], Array.isArray(job?.detailCandidates) ? job.detailCandidates : []);
  if (!lightweight.length && !detailed.length) return { lightweight, detailed, usableCount: usableCandidates(task).length };
  sourcing.strategyCandidates = object(sourcing.strategyCandidates) || {};
  const previous = object(sourcing.strategyCandidates[strategy?.type]) || {};
  const strategyLightweight = sourcingFlow.mergeAutomaticCandidates(previous.lightweightCandidates || [], lightweight);
  const strategyDetailed = mergeDetailedCandidates(previous.detailCandidates || [], detailed);
  sourcing.strategyCandidates[strategy.type] = {
    lightweightCandidates: clone(strategyLightweight, []),
    detailCandidates: clone(strategyDetailed, []),
    query: text(strategy?.query) || null,
    jobId: text(job?.jobId) || null,
    updatedAt: new Date().toISOString(),
  };
  sourcing.lightweightCandidates = sourcingFlow.mergeAutomaticCandidates(sourcing.lightweightCandidates || [], lightweight);
  sourcing.detailCandidates = mergeDetailedCandidates(sourcing.detailCandidates || [], detailed);
  return { lightweight, detailed, usableCount: usableCandidates(task).length };
}
function usableCandidates(task) {
  const rejected = new Set((task?.sourcing?.rejectedCandidateIds || []).map(String));
  return sourcingFlow.detailCandidatesForInspection(task?.sourcing?.detailCandidates || [])
    .filter((candidate) => !rejected.has(text(candidate?.candidateId)))
    .slice(0, sourcingFlow.AUTOMATIC_1688_LIMITS.maxDetailCandidates);
}
function boundedDiagnostics(value) {
  const diagnostics = clone(value, null), serialized = JSON.stringify(diagnostics);
  return typeof serialized === "string" && serialized.length <= 4_000
    ? diagnostics
    : { code: text(diagnostics?.code, "diagnostics_truncated"), truncated: true };
}
function recordSearchAttempt(task, strategy, result) {
  const sourcing = sourcingState(task), attempts = Array.isArray(sourcing.searchAttempts) ? sourcing.searchAttempts : [];
  attempts.push({ strategy, status: text(result.status, "failed"), usableCount: Number(result.usableCount) || 0, candidateCount: Number(result.candidateCount) || 0, durationMs: Math.max(0, Math.min(Number(result.durationMs) || 0, sourcingFlow.AUTOMATIC_1688_LIMITS.totalActiveMs)), diagnostics: boundedDiagnostics(result.diagnostics), jobId: text(result.jobId) || null, completedAt: new Date().toISOString() }); sourcing.searchAttempts = attempts.slice(-20);
}
async function safeCancel1688Job(jobId, context = null) {
  const safeJobId = text(jobId);
  if (!safeJobId) return null;
  if (context?.cleanupJobIds?.has(safeJobId)) return null;
  context?.cleanupJobIds?.add(safeJobId);
  try { return await sourcingExtensionRequest("cancel_1688_job", { jobId: safeJobId }, 8000); } catch { return null; }
}
function pauseForPlatformVerification(context, job, strategy) {
  if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context, text(job?.jobId));
  const sourcing = sourcingState(context.task); sourcing.timing = sourcingFlow.pauseAutomaticTiming(sourcing.timing); sourcing.status = "paused_platform_verification"; sourcing.searchStrategy = strategy.type;
  sourcing.activeJob = { jobId: text(job?.jobId), strategy: clone(strategy, null), status: "paused_platform_verification", diagnostics: boundedDiagnostics(job?.diagnostics) };
  automaticBatch.paused = true; automaticBatch.status = "paused_platform_verification"; automaticBatch.pauseReason = "1688平台要求人工验证"; persistQueue(); render(); setStatus("1688平台要求人工验证，整批已暂停；验证后点击恢复。", "bad");
  invalidateAutomaticRun(context.task, "platform_verification");
  return { status: "paused_platform_verification", jobId: text(job?.jobId) };
}
async function poll1688Job(context, jobId, strategy) {
  const task = context.task, startedAt = Date.now();
  while (true) {
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context, jobId);
    const sourcing = sourcingState(task);
    if (timeExceeded(task)) { await safeCancel1688Job(jobId, context); return { status: "automatic_timeout", diagnostics: { code: "automatic_timeout" }, jobId }; }
    const now = Date.now(), activeStageAt = startedAt;
    const budget = strategy.type === "verify_sku" ? sourcingFlow.AUTOMATIC_1688_LIMITS.detailSkuMs : sourcingFlow.AUTOMATIC_1688_LIMITS.searchPageMs;
    if (now - activeStageAt >= budget) { await safeCancel1688Job(jobId, context); return { status: "stage_timeout", diagnostics: { code: "stage_timeout", stage: strategy.type === "verify_sku" ? "detail_or_sku" : "search_page" }, jobId }; }
    const requestTimeout = activeRequestTimeout(task, Math.min(15000, budget - (now - activeStageAt)));
    if (!requestTimeout) { await safeCancel1688Job(jobId, context); return automaticTimeoutResult(); }
    let job;
    try { job = await sourcingExtensionRequest("get_1688_job", { jobId }, requestTimeout, context.controller?.signal); }
    catch (error) {
      if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context, jobId);
      return timeExceeded(task) ? automaticTimeoutResult() : { status: "bridge_failed", diagnostics: { code: "bridge_failed", message: text(error?.message) }, jobId };
    }
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context, jobId);
    if (timeExceeded(task)) { await safeCancel1688Job(jobId, context); return automaticTimeoutResult(); }
    const progress = mergeJobCandidates(task, strategy, job);
    sourcing.activeJob = {
      jobId,
      strategy: clone(strategy, null),
      status: text(job?.status),
      phase: text(job?.phase),
      phaseStartedAt: text(job?.phaseStartedAt) || null,
      currentDetailIndex: Number.isInteger(job?.currentDetailIndex) && job.currentDetailIndex >= 0 ? job.currentDetailIndex : null,
      diagnostics: boundedDiagnostics(job?.diagnostics),
      updatedAt: new Date().toISOString(),
    }; persistQueue(); render();
    if (job?.status === "paused_platform_verification") return { ...job, status: "paused_platform_verification", jobId };
    if (["completed", "failed", "cancelled"].includes(job?.status)) { sourcing.activeJob = null; persistQueue(); return { ...job, jobId }; }
    if (job?.phase === "inspect_details") {
      const phaseStartedAt = Date.parse(text(job?.phaseStartedAt));
      const detailIndex = job?.currentDetailIndex;
      if (!Number.isInteger(detailIndex) || detailIndex < 0 || !Number.isFinite(phaseStartedAt) || phaseStartedAt > Date.now() + 1_000) {
        await safeCancel1688Job(jobId, context);
        return { status: "stage_timeout", diagnostics: { code: "detail_phase_clock_missing", stage: "detail_or_sku" }, jobId };
      }
      if (Date.now() - phaseStartedAt >= sourcingFlow.AUTOMATIC_1688_LIMITS.detailSkuMs) {
        await safeCancel1688Job(jobId, context);
        return { status: "stage_timeout", diagnostics: { code: "stage_timeout", stage: "detail_or_sku", currentDetailIndex: detailIndex }, jobId };
      }
    }
    await delay(1000);
  }
}
function sameBridgeStrategy(left, right) {
  if (text(left?.type) !== text(right?.type)) return false;
  const leftPrice = Number(left?.expectedPrice), rightPrice = Number(right?.expectedPrice);
  return text(left?.query) === text(right?.query)
    && text(left?.sourceUrl) === text(right?.sourceUrl)
    && text(left?.optionId) === text(right?.optionId)
    && text(left?.optionLabel) === text(right?.optionLabel)
    && (Number.isFinite(leftPrice) ? leftPrice === rightPrice : !Number.isFinite(rightPrice));
}
function activeSearchStrategy(task) {
  const active = object(task?.sourcing?.activeJob), strategy = object(active?.strategy);
  if (!active || active.restartRequired === true || !text(active.jobId) || !strategy) return null;
  if (!["image", "keyword", "similar_supplier"].includes(text(strategy.type))) return null;
  return clone(strategy, null);
}
async function run1688BridgeJob(context, strategy) {
  if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
  const active = object(context.task?.sourcing?.activeJob);
  if (active && active.restartRequired !== true && text(active.jobId) && sameBridgeStrategy(active.strategy, strategy)) {
    return poll1688Job(context, text(active.jobId), strategy);
  }
  const mainImageUrl = context.task?.enrichment?.mainImageUrl || context.task?.ozon?.mainImageUrl; let started;
  const requestTimeout = activeRequestTimeout(context.task, 15000);
  if (!requestTimeout) return automaticTimeoutResult();
  try { started = await sourcingExtensionRequest("start_1688_job", { taskId: context.taskId, mainImageUrl, strategy }, requestTimeout, context.controller?.signal); }
  catch (error) {
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
    return timeExceeded(context.task) ? automaticTimeoutResult() : { status: "bridge_failed", diagnostics: { code: "bridge_start_failed", message: text(error?.message) } };
  }
  if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context, text(started?.jobId));
  const jobId = text(started?.jobId); if (timeExceeded(context.task)) { await safeCancel1688Job(jobId, context); return automaticTimeoutResult(); }
  if (!jobId) return { status: "bridge_failed", diagnostics: { code: "missing_job_id" } };
  const sourcing = sourcingState(context.task); sourcing.searchStrategy = strategy.type; sourcing.activeJob = { jobId, strategy: clone(strategy, null), status: text(started.status, "queued"), phase: text(started.phase, "queued"), updatedAt: new Date().toISOString() }; persistQueue(); render();
  return poll1688Job(context, jobId, strategy);
}
async function runSearchStrategy(context, strategy) {
  const startedAt = Date.now();
  const result = await run1688BridgeJob(context, strategy);
  if (!contextIsCurrent(context) || result.status === "stale") return result;
  if (!automaticContextCanAdvance(context) && result.status !== "paused_platform_verification") return automaticContextStopResult(context, result.jobId);
  const sourcing = sourcingState(context.task);
  const progress = mergeJobCandidates(context.task, strategy, result);
  if (!sourcing.strategyCandidates?.[strategy.type]) {
    sourcing.strategyCandidates = object(sourcing.strategyCandidates) || {};
    sourcing.strategyCandidates[strategy.type] = { lightweightCandidates: [], detailCandidates: [], query: text(strategy?.query) || null, jobId: text(result?.jobId) || null, updatedAt: new Date().toISOString() };
  }
  if (!["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) {
    recordSearchAttempt(context.task, strategy.type, { status: result.status === "completed" ? "completed" : result.status || "failed", usableCount: progress.usableCount, candidateCount: progress.lightweight.length, diagnostics: result.diagnostics, jobId: result.jobId, durationMs: Date.now() - startedAt });
  }
  persistQueue(); render();
  if (result.status === "paused_platform_verification") return pauseForPlatformVerification(context, result, strategy);
  if (["paused_manual", "cancelled"].includes(result.status)) return result;
  return { ...result, usableCount: progress.usableCount };
}
async function ensureKeywords(context) {
  if (!automaticContextCanAdvance(context)) return null;
  const sourcing = sourcingState(context.task); if (Array.isArray(sourcing.keywords) && sourcing.keywords.length) return sourcing.keywords;
  const requestTimeout = activeRequestTimeout(context.task, sourcingFlow.AUTOMATIC_1688_LIMITS.qwenMs);
  if (!requestTimeout) { buildNoSourceFinal(context.task, "automatic_timeout", "pending_human_review", context); return null; }
  try {
    const result = await apiWithTimeout("/api/ai/1688-keywords", context.task, requestTimeout, "1688关键词判断", context.controller?.signal); if (!automaticContextCanAdvance(context)) return null;
    if (timeExceeded(context.task)) { buildNoSourceFinal(context.task, "automatic_timeout", "pending_human_review", context); return null; }
    const keywords = Array.isArray(result?.keywords) ? result.keywords.filter((value) => typeof value === "string" && value.trim()).slice(0, 3) : []; if (!keywords.length) throw new Error("未得到可验证关键词");
    sourcing.keywords = keywords; sourcing.keywordModel = { provider: text(result.provider), model: text(result.model), judgedAt: text(result.judgedAt) || new Date().toISOString() }; persistQueue(); render(); return keywords;
  } catch (error) {
    if (!automaticContextCanAdvance(context)) return null;
    const blocker = timeExceeded(context.task) ? "automatic_timeout" : "keyword_generation_failed"; buildNoSourceFinal(context.task, blocker, "pending_human_review", context); setStatus(`关键词生成失败：${text(error?.message, "请人工确认")}`, "bad"); return null;
  }
}
async function runKeywordSearches(context) {
  const keywords = await ensureKeywords(context); if (!keywords) return automaticContextCanAdvance(context) ? { status: "failed" } : automaticContextStopResult(context);
  let last = { status: "failed", usableCount: 0 };
  for (const query of keywords.slice(0, 3)) {
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
    if (timeExceeded(context.task)) return { status: "automatic_timeout" };
    last = await runSearchStrategy(context, { type: "keyword", query });
    if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(last.status) || last.usableCount > 0) return last;
  }
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
  if (context?.generation !== undefined && !automaticContextCanAdvance(context)) return { stale: true };
  const preliminary = preliminaryPricingDecision(context.task, quote.purchaseCost);
  if (preliminary.status === "rejected_preliminary") return { status: "rejected_preliminary", eligibleAt18Pct: false, purchaseCost: quote.purchaseCost, maxPurchaseCostAt18Pct: preliminary.preliminaryLimit };
  const remaining = activeRequestTimeout(context.task, 90000);
  if (remaining <= 0) throw new Error("automatic_timeout");
  try {
    const preview = await preview1688PurchaseCostWithFinalPricing(context.task, quote.purchaseCost, remaining, context.controller?.signal, context); if ((context?.generation !== undefined && !automaticContextCanAdvance(context)) || !contextIsCurrent(context) || preview?.stale) return { stale: true }; if (timeExceeded(context.task)) throw new Error("automatic_timeout"); return preview;
  } catch (error) { if (context?.generation !== undefined && !automaticContextCanAdvance(context)) return { stale: true }; if (timeExceeded(context.task)) throw new Error("automatic_timeout"); throw error; }
}
async function evaluateCandidates(context) {
  if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
  const task = context.task, candidates = usableCandidates(task); if (!candidates.length) return buildNoSourceFinal(task, "no_complete_1688_candidate", "no_source_found", context);
  const judgementTimeout = activeRequestTimeout(task, sourcingFlow.AUTOMATIC_1688_LIMITS.qwenMs);
  if (!judgementTimeout) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
  let result; try { result = await apiWithTimeout("/api/ai/1688-judge", { task, candidates }, judgementTimeout, "1688同款判断", context.controller?.signal); }
  catch {
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
    return buildNoSourceFinal(task, timeExceeded(task) ? "automatic_timeout" : "judgement_missing_or_failed", "pending_human_review", context);
  }
  if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
  if (timeExceeded(task)) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
  const judgement = result?.judgement, candidate = candidates.find((entry) => text(entry?.candidateId) === text(judgement?.bestCandidateId)) || candidates[0], sourcing = sourcingState(task);
  sourcing.aiJudgement = clone(judgement, null); sourcing.judgementMetadata = { provider: text(result?.provider), model: text(result?.model), judgedAt: text(result?.judgedAt) || new Date().toISOString() }; persistQueue(); render();
  if (!judgementCanContinue(judgement, candidate)) { const quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)); return queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["judgement_requires_human_confirmation"], context); }
  const options = Array.isArray(candidate?.sku?.options) ? candidate.sku.options : [];
  if (!options.length) { const quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)); return queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_options_missing"], context); }
  const selectionTimeout = activeRequestTimeout(task, sourcingFlow.AUTOMATIC_1688_LIMITS.qwenMs);
  if (!selectionTimeout) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
  let selectionResult; try { selectionResult = await apiWithTimeout("/api/ai/1688-select-sku", { task, candidate, skuOptions: options }, selectionTimeout, "1688规格判断", context.controller?.signal); }
  catch {
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
    const quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exactExceptionForCandidate(candidate)); return timeExceeded(task) ? buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context) : queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_selection_missing_or_failed"], context);
  }
  if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
  if (timeExceeded(task)) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
  const selection = selectionResult?.selection, selected = options.find((option) => text(option?.id || option?.optionId) === text(selection?.selectedOptionId)), selectedCandidate = { ...candidate, sku: { ...candidate.sku, selectedOptionId: selected ? text(selected.id || selected.optionId) : null, selectionVerified: false } };
  sourcing.skuSelection = clone(selection, null);
  if (!selected || selection?.verdict !== "exact_match" || selection?.needsHumanReview !== false || Number(selection?.confidence) < 85) { const quote = sourcingFlow.quoteAutomaticSingleUnit(selectedCandidate, exactExceptionForCandidate(selectedCandidate)); return queueCandidateFinal(task, selectedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_selection_requires_human_confirmation"], context); }
  const verification = await run1688BridgeJob(context, { type: "verify_sku", sourceUrl: sourcingFlow.canonical1688OfferUrl(selectedCandidate.sourceUrl), optionId: text(selected.id || selected.optionId), optionLabel: text(selected.label), expectedPrice: Number(selectedCandidate?.pricing?.selectedSkuPrice) });
  if (!automaticContextCanAdvance(context) || verification.status === "stale") return automaticContextStopResult(context, verification?.jobId);
  const selectionVerified = verification.status === "completed" && verification?.diagnostics?.code === "sku_verified";
  sourcing.skuVerification = {
    status: text(verification.status, "failed"), jobId: text(verification.jobId) || null,
    selectedOptionId: text(selected.id || selected.optionId), selectionVerified,
    diagnostics: boundedDiagnostics(verification.diagnostics), checkedAt: new Date().toISOString(),
  };
  persistQueue(); render();
  if (["paused_platform_verification", "paused_manual", "cancelled"].includes(verification.status)) return verification;
  if (verification.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
  const verifiedCandidate = { ...selectedCandidate, sku: { ...selectedCandidate.sku, selectionVerified } };
  if (verification.status !== "completed" || !verifiedCandidate.sku.selectionVerified) { const quote = sourcingFlow.quoteAutomaticSingleUnit(verifiedCandidate, exactExceptionForCandidate(verifiedCandidate)); return queueCandidateFinal(task, verifiedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, ["sku_verification_failed"], context); }
  const quote = sourcingFlow.quoteAutomaticSingleUnit(verifiedCandidate, exactExceptionForCandidate(verifiedCandidate)); if (!quote.confirmable) return queueCandidateFinal(task, verifiedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }, [], context);
  let finalPricing; try { finalPricing = await previewCandidatePricing(context, quote); }
  catch (error) {
    if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
    return text(error?.message) === "automatic_timeout" || timeExceeded(task) ? buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context) : queueCandidateFinal(task, verifiedCandidate, judgement, quote, { eligibleAt18Pct: false, status: "preview_failed" }, ["final_pricing_preview_missing_or_failed"], context);
  }
  if (!automaticContextCanAdvance(context) || finalPricing?.stale) return automaticContextStopResult(context);
  return queueCandidateFinal(task, verifiedCandidate, judgement, quote, finalPricing, [], context);
}
async function resumePausedAutomaticTask(context) {
  const sourcing = sourcingState(context.task), activeJob = object(sourcing?.activeJob), jobId = text(activeJob?.jobId);
  if (activeJob?.restartRequired === true) {
    sourcing.activeJob = null;
    return contextIsCurrent(context);
  }
  if (sourcing.status === "paused_manual") return contextIsCurrent(context);
  if (jobId) await safeCancel1688Job(jobId, context);
  if (!contextIsCurrent(context)) return false;
  sourcing.activeJob = null;
  return true;
}
async function runAutomatic1688Task(task, { mode = "single" } = {}) {
  const taskId = taskIdOf(task);
  if (!taskId || currentQueuedTask(task) !== task) throw new Error("任务ID无效、重复或已变更，无法启动自动找货源。");
  const existing = automaticRuns.get(task);
  if (existing?.promise && !existing.invalidated) return existing.promise;
  const context = beginAutomaticRun(task, mode);
  const run = (async () => {
    const providerBusy = acquireAutomaticProvider(context);
    if (providerBusy) return providerBusy;
    if (!contextIsCurrent(context)) return automaticContextStopResult(context);
    const sourcing = sourcingState(task);
    if (sourcing.status === "confirmed_purchase_source" || sourcing.finalConfirmation?.status === "final_confirmation_pending") return sourcing.finalConfirmation || { status: sourcing.status };
    const preflight = readiness(task);
    if (!preflight.ready) {
      sourcing.status = "automatic_running";
      return buildNoSourceFinal(task, `automatic_preconditions_missing:${preflight.reasons.join("/")}`, "pending_human_review", context);
    }
    if (["paused_platform_verification", "paused_manual"].includes(sourcing.status)) {
      if (!await resumePausedAutomaticTask(context)) return automaticContextStopResult(context);
      if (!contextIsCurrent(context)) return automaticContextStopResult(context);
    }
    sourcing.status = "automatic_running";
    sourcing.provider = "1688";
    sourcing.timing = sourcingFlow.resumeAutomaticTiming(sourcing.timing);
    sourcing.searchAttempts = Array.isArray(sourcing.searchAttempts) ? sourcing.searchAttempts : [];
    sourcing.lightweightCandidates = Array.isArray(sourcing.lightweightCandidates) ? sourcing.lightweightCandidates : [];
    sourcing.detailCandidates = Array.isArray(sourcing.detailCandidates) ? sourcing.detailCandidates : [];
    sourcing.rejectedCandidateIds = Array.isArray(sourcing.rejectedCandidateIds) ? sourcing.rejectedCandidateIds : [];
    persistQueue(); render();
    const resumedStrategy = activeSearchStrategy(task);
    if (resumedStrategy) {
      const resumed = await runSearchStrategy(context, resumedStrategy);
      if (!automaticContextCanAdvance(context) && !["paused_platform_verification", "paused_manual", "cancelled"].includes(resumed.status)) return automaticContextStopResult(context);
      if (resumed.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
      if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(resumed.status)) return resumed;
    }
    for (let transition = 0; transition < 12; transition += 1) {
      if (!automaticContextCanAdvance(context)) return automaticContextStopResult(context);
      if (timeExceeded(task)) return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
      const action = sourcingFlow.nextAutomaticAction(sourcingState(task));
      if (action.type === "start_image_search") {
        const result = await runSearchStrategy(context, { type: "image", sourceUrl: task.enrichment?.mainImageUrl || task.ozon?.mainImageUrl });
        if (!automaticContextCanAdvance(context) && !["paused_platform_verification", "paused_manual", "cancelled"].includes(result.status)) return automaticContextStopResult(context);
        if (result.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
        if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) return result;
        continue;
      }
      if (action.type === "generate_keywords") {
        if (!await ensureKeywords(context)) return automaticContextCanAdvance(context) ? { status: "keyword_failed" } : automaticContextStopResult(context);
        continue;
      }
      if (action.type === "start_keyword_search") {
        const result = await runKeywordSearches(context);
        if (!automaticContextCanAdvance(context) && !["paused_platform_verification", "paused_manual", "cancelled"].includes(result.status)) return automaticContextStopResult(context);
        if (result.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
        if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) return result;
        continue;
      }
      if (action.type === "start_similar_supplier_search") {
        const similar = similarSupplierImage(task);
        if (!similar) {
          recordSearchAttempt(task, "similar_supplier", { status: "completed", usableCount: 0, candidateCount: 0, diagnostics: { code: "no_trusted_supplier_image" } });
          persistQueue(); render(); continue;
        }
        const result = await runSearchStrategy(context, { type: "similar_supplier", query: text(similar.candidate?.title), sourceUrl: similar.imageUrl });
        if (!automaticContextCanAdvance(context) && !["paused_platform_verification", "paused_manual", "cancelled"].includes(result.status)) return automaticContextStopResult(context);
        if (result.status === "automatic_timeout") return buildNoSourceFinal(task, "automatic_timeout", "pending_human_review", context);
        if (["paused_platform_verification", "paused_manual", "cancelled", "stale"].includes(result.status)) return result;
        continue;
      }
      if (action.type === "judge_candidates") return evaluateCandidates(context);
      if (action.type === "queue_no_source_confirmation") return buildNoSourceFinal(task, "no_usable_1688_source", "no_source_found", context);
      if (action.type === "pause_platform_verification") return { status: "paused_platform_verification" };
      if (action.type === "complete") return sourcing.finalConfirmation || { status: sourcing.status };
      return buildNoSourceFinal(task, "automatic_state_machine_invalid", "pending_human_review", context);
    }
    return buildNoSourceFinal(task, "automatic_state_machine_exhausted", "pending_human_review", context);
  })();
  context.promise = run;
  try { return await run; } finally { finishAutomaticRun(context); }
}
async function runAutomatic1688Batch() {
  if (automaticBatch.running) return { status: "already_running" }; if (!queue?.tasks?.length) throw new Error("请先导入Ozon补全JSON。");
  automaticBatch.running = true; automaticBatch.paused = false; automaticBatch.stopRequested = false; automaticBatch.status = "running"; automaticBatch.pauseReason = ""; persistQueue(); render();
  try {
    const tasks = queue.tasks;
    for (; automaticBatch.cursor < tasks.length; automaticBatch.cursor += 1) {
      if (automaticBatch.stopRequested || automaticBatch.paused) break; const task = tasks[automaticBatch.cursor]; automaticBatch.activeTaskId = taskIdOf(task); persistQueue(); render();
      try {
        const result = await runAutomatic1688Task(task, { mode: "batch" });
        if (result?.status === "paused_platform_verification" || task?.sourcing?.status === "paused_platform_verification") { automaticBatch.paused = true; automaticBatch.status = "paused_platform_verification"; automaticBatch.pauseReason = "1688平台要求人工验证"; break; }
        if (["cancelled", "paused_manual"].includes(result?.status)) break; automaticBatch.completed += 1;
      } catch {
        if (currentQueuedTask(task) === task && task?.sourcing?.status === "automatic_running") {
          automaticBatch.failed += 1; buildNoSourceFinal(task, "automatic_task_failed", "pending_human_review");
        }
      }
      persistQueue(); render();
    }
    if (automaticBatch.cursor >= tasks.length && !automaticBatch.paused && !automaticBatch.stopRequested) automaticBatch.status = "completed"; if (automaticBatch.stopRequested) automaticBatch.status = "cancelled";
    setStatus(automaticBatch.status === "completed" ? "批量自动找货源已完成，待确认商品在下方队列。" : `批量自动找货源已${automaticBatch.status === "paused_platform_verification" ? "因平台验证暂停" : "停止"}。`, automaticBatch.status === "completed" ? "ok" : "bad"); return { status: automaticBatch.status };
  } finally { automaticBatch.running = false; automaticBatch.activeTaskId = ""; persistQueue(); render(); }
}
async function pauseAutomatic1688Batch() {
  automaticBatch.paused = true; automaticBatch.status = "paused_manual"; automaticBatch.pauseReason = "用户暂停"; const task = currentQueuedTask(automaticBatch.activeTaskId), jobId = text(task?.sourcing?.activeJob?.jobId);
  const context = task ? invalidateAutomaticRun(task, "manual_pause") : null;
  if (task) {
    const sourcing = sourcingState(task);
    sourcing.timing = sourcingFlow.pauseAutomaticTiming(task.sourcing.timing); sourcing.status = "paused_manual";
    if (object(sourcing.activeJob)) sourcing.activeJob = { ...sourcing.activeJob, status: "paused_manual", restartRequired: Boolean(jobId) };
  }
  persistQueue(); render(); await safeCancel1688Job(jobId, context); setStatus("已暂停当前批量；恢复后会从安全阶段继续。", "ok");
}
async function resumeAutomatic1688Batch() { automaticBatch.paused = false; automaticBatch.stopRequested = false; automaticBatch.status = "idle"; automaticBatch.pauseReason = ""; persistQueue(); render(); return runAutomatic1688Batch(); }
async function cancelAutomatic1688Batch() {
  automaticBatch.stopRequested = true; automaticBatch.paused = false; automaticBatch.status = "cancelled"; const task = currentQueuedTask(automaticBatch.activeTaskId), jobId = text(task?.sourcing?.activeJob?.jobId);
  const context = task ? invalidateAutomaticRun(task, "manual_cancel") : null;
  if (task) {
    const sourcing = sourcingState(task);
    sourcing.status = "automatic_cancelled";
    if (object(sourcing.activeJob)) sourcing.activeJob = { ...sourcing.activeJob, status: "automatic_cancelled", restartRequired: Boolean(jobId) };
    recordAudit(task, "automatic_cancelled", { jobId: jobId || null });
  }
  persistQueue(); render(); await safeCancel1688Job(jobId, context); setStatus("已取消批量自动找货源；没有写入任何采购价。", "ok");
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
function terminalActionStore(task) {
  const sourcing = sourcingState(task);
  sourcing.finalActionTerminals = object(sourcing.finalActionTerminals) || {};
  return sourcing.finalActionTerminals;
}
function terminalResult(task, confirmationId) {
  const stored = object(task?.sourcing?.finalActionTerminals)?.[confirmationId];
  return object(stored) ? clone(stored, null) : null;
}
function rememberTerminalAction(task, pending, action, result) {
  const confirmationId = text(pending?.confirmationId);
  if (!confirmationId) return null;
  const terminal = {
    confirmationId,
    action,
    status: text(result?.status, action === "confirm" ? "confirmed" : "rejected"),
    finalStatus: text(pending?.status),
    completedAt: new Date().toISOString(),
  };
  const store = terminalActionStore(task);
  store[confirmationId] = terminal;
  const entries = Object.entries(store).sort(([, left], [, right]) => Date.parse(text(left?.completedAt)) - Date.parse(text(right?.completedAt)));
  for (const [staleId] of entries.slice(0, Math.max(0, entries.length - 24))) delete store[staleId];
  return terminal;
}
function finalActionBinding(target) {
  const raw = object(target);
  const requestedTask = raw?.task || (object(target) && taskIdOf(target) ? target : null);
  const requestedId = raw ? text(raw.taskId || raw.id || taskIdOf(requestedTask)) : text(target);
  const task = requestedTask ? currentQueuedTask(requestedTask) : currentQueuedTask(requestedId);
  if (!task || !requestedId || taskIdOf(task) !== requestedId) throw new Error("任务已变更、重复或不存在，拒绝执行最终确认操作。");
  const final = sourcingState(task).finalConfirmation;
  const confirmationId = text(raw?.confirmationId || raw?.final?.confirmationId || final?.confirmationId);
  if (!final || !confirmationId || text(final.confirmationId) !== confirmationId || (raw?.final && raw.final !== final)) throw new Error("当前确认能力已变更或不存在，拒绝执行操作。");
  return { task, taskId: requestedId, final, confirmationId };
}
function bindingStillCurrent(binding, { allowTerminal = true } = {}) {
  const task = binding?.task;
  if (!task || currentQueuedTask(task) !== task || taskIdOf(task) !== binding.taskId) return false;
  const final = sourcingState(task).finalConfirmation;
  if (final !== binding.final || text(final?.confirmationId) !== binding.confirmationId) return false;
  return allowTerminal || final.status === "final_confirmation_pending" || final.status === "final_confirmation_blocked";
}
function withFinalActionLock(target, operation) {
  const binding = finalActionBinding(target);
  const priorTerminal = terminalResult(binding.task, binding.confirmationId);
  if (priorTerminal) return Promise.resolve({ ...priorTerminal, idempotent: true });
  const inFlight = taskActionLocks.get(binding.task);
  if (inFlight) return inFlight;
  const run = Promise.resolve().then(async () => {
    const terminal = terminalResult(binding.task, binding.confirmationId);
    if (terminal) return { ...terminal, idempotent: true };
    if (!bindingStillCurrent(binding)) throw new Error("当前确认能力已变更，拒绝执行过期操作。");
    return operation(binding);
  }).finally(() => {
    if (taskActionLocks.get(binding.task) === run) taskActionLocks.delete(binding.task);
    render();
  });
  taskActionLocks.set(binding.task, run); render(); return run;
}
function withManualTaskLock(task, operation) {
  if (manualTaskLocks.has(task)) return manualTaskLocks.get(task);
  const run = Promise.resolve().then(operation).finally(() => {
    if (manualTaskLocks.get(task) === run) manualTaskLocks.delete(task);
    render();
  });
  manualTaskLocks.set(task, run); return run;
}
function refreshedPendingForBinding(binding, facts) {
  if (!factsMatchFinal(binding.final, facts)) return null;
  const rebuilt = sourcingCore.buildFinalConfirmation({ task: binding.task, candidate: facts.candidate, judgement: facts.judgement, quote: facts.quote, finalPricing: facts.finalPricing });
  if (rebuilt.status !== "final_confirmation_pending") return null;
  Object.assign(rebuilt, {
    candidateSnapshot: clone(facts.candidate, null),
    judgementSnapshot: clone(facts.judgement, null),
    quoteSnapshot: clone(facts.quote, null),
    finalPricing: clone(facts.finalPricing, null),
    generatedAt: new Date().toISOString(),
  });
  sourcingState(binding.task).finalConfirmation = rebuilt;
  binding.final = rebuilt;
  binding.confirmationId = text(rebuilt.confirmationId);
  return rebuilt;
}
function currentPendingForFinalAction(binding, facts) {
  if (!bindingStillCurrent(binding, { allowTerminal: false }) || binding.final?.status !== "final_confirmation_pending" || !factsMatchFinal(binding.final, facts)) return null;
  return binding.final;
}
async function confirmFinalCandidate(target) {
  return withFinalActionLock(target, async (binding) => {
    const task = binding.task, facts = currentConfirmationFacts(task);
    let pending = currentPendingForFinalAction(binding, facts);
    if (!pending) {
      if (binding.final?.status === "final_confirmation_pending") {
        binding.final.status = "final_confirmation_blocked";
        binding.final.blockers = appendBlockers(binding.final, ["confirmation_data_changed"]);
        recordAudit(task, "confirmation_blocked", { reason: "confirmation_data_changed" }); persistQueue();
      }
      throw new Error("候选、判断、报价或最终试算已变化/缺失，未写入采购价。");
    }
    clearStaleTask5Pending(task);
    const current = { task, candidate: facts.candidate, judgement: facts.judgement, quote: facts.quote, finalPricing: facts.finalPricing };
    let result;
    try { result = sourcingCore.confirmRecommendation(task, pending, current, new Date().toISOString()); }
    catch (error) {
      if (!/确认对象不是本次流程生成/.test(text(error?.message))) throw error;
      pending = refreshedPendingForBinding(binding, facts);
      if (!pending || !bindingStillCurrent(binding, { allowTerminal: false })) throw new Error("恢复后的确认能力未通过当前证据复验，未写入采购价。");
      result = sourcingCore.confirmRecommendation(task, pending, current, new Date().toISOString());
    }
    const sourcing = sourcingState(task);
    sourcing.confirmedCandidate = clone(facts.candidate, null);
    pricingState(task).finalOzonPricing = clone(facts.finalPricing, null);
    rememberTerminalAction(task, pending, "confirm", result);
    recordAudit(task, "confirmed_purchase_source", { candidateId: text(facts.candidate.candidateId), confirmationId: pending.confirmationId });
    persistQueue(); render(); setStatus("已确认采用，采购成本现已写入该任务。", "ok"); return result;
  });
}
async function rejectFinalCandidate(target) {
  return withFinalActionLock(target, async (binding) => {
    const task = binding.task, facts = currentConfirmationFacts(task), sourcing = sourcingState(task);
    let pending = currentPendingForFinalAction(binding, facts);
    const candidateId = text(facts.candidate?.candidateId || pending?.candidate?.candidateId);
    if (!pending || !candidateId) throw new Error("当前确认卡片已变化或缺少候选身份，不能否决。");
    clearStaleTask5Pending(task);
    let result;
    try { result = sourcingCore.rejectRecommendation(task, pending, new Date().toISOString()); }
    catch (error) {
      if (!/确认对象不是本次流程生成/.test(text(error?.message))) throw error;
      pending = refreshedPendingForBinding(binding, facts);
      if (!pending || !bindingStillCurrent(binding, { allowTerminal: false })) throw new Error("恢复后的确认能力未通过当前证据复验，不能否决。");
      result = sourcingCore.rejectRecommendation(task, pending, new Date().toISOString());
    }
    sourcing.rejectedCandidateIds = [...new Set([...(Array.isArray(sourcing.rejectedCandidateIds) ? sourcing.rejectedCandidateIds : []), candidateId])];
    rememberTerminalAction(task, pending, "reject", result);
    recordAudit(task, "candidate_rejected", { candidateId, confirmationId: pending.confirmationId });
    persistQueue(); render(); setStatus("已否决当前候选；可继续尝试下一候选。", "ok"); return result;
  });
}
async function continueRejectedCandidate(target) {
  const binding = finalActionBinding(target);
  const terminal = terminalResult(binding.task, binding.confirmationId);
  if (!terminal || terminal.action !== "reject" || !bindingStillCurrent(binding) || binding.final.status !== "final_confirmation_rejected") return terminal ? { ...terminal, idempotent: true } : Promise.reject(new Error("仅能继续当前已否决的确认卡片。"));
  return withManualTaskLock(binding.task, async () => {
    if (!bindingStillCurrent(binding) || binding.final.status !== "final_confirmation_rejected") throw new Error("当前已否决卡片已变更，不能继续。");
    const sourcing = sourcingState(binding.task), rejected = new Set((sourcing.rejectedCandidateIds || []).map(String));
    const next = sourcingFlow.detailCandidatesForInspection(sourcing.detailCandidates || [])
      .find((candidate) => !rejected.has(text(candidate?.candidateId))) || null;
    if (!next) {
      sourcing.status = "no_source_found";
      binding.task.status = "pending_human_review";
      binding.final.blockers = appendBlockers(binding.final, ["no_acceptable_next_candidate"]);
      persistQueue(); render(); setStatus("已否决当前候选，暂无可继续尝试的1688候选。", "bad"); return { status: "no_next_candidate" };
    }
    delete sourcing.finalConfirmation; delete sourcing.activeCandidate; delete sourcing.aiJudgement; delete sourcing.quote; delete sourcing.finalPricingPreview;
    sourcing.status = "automatic_running"; binding.task.status = "pending_human_review";
    persistQueue(); render(); setStatus("已否决当前候选，正在按安全规则尝试下一候选。", "ok"); return runAutomatic1688Task(binding.task);
  });
}
function strictSingleUnitPrice(value) { const raw = typeof value === "number" ? value.toFixed(2) : text(value); if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null; const money = Number(raw); return Number.isFinite(money) && money > 0 && money <= 1_000_000_000 ? Number(money.toFixed(2)) : null; }
async function saveSingleUnitException(taskId, price) {
  return withFinalActionLock(taskId, async (binding) => {
    if (!bindingStillCurrent(binding, { allowTerminal: false }) || binding.final.status !== "final_confirmation_blocked") throw new Error("当前确认能力已变更，不能保存一件价例外。");
    const task = binding.task, final = binding.final, candidate = currentCardCandidate(task, final), onePiecePrice = strictSingleUnitPrice(price), sourceUrl = sourcingFlow.canonical1688OfferUrl(candidate?.sourceUrl), productId = text(candidate?.productId) || /^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html$/.exec(sourceUrl)?.[1] || "";
    if (Number(candidate?.minimumOrderQuantity) !== 2 || !sourceUrl || !productId || onePiecePrice === null) throw new Error("仅能为当前1688页面已核验的MOQ 2候选保存正数、两位小数以内的一件采购价。");
    const exceptions = queueMeta().singleUnitExceptions, existing = exceptions[productId]; if (existing && (text(existing.productId) !== productId || sourcingFlow.canonical1688OfferUrl(existing.sourceUrl) !== sourceUrl)) throw new Error("同一产品ID已有不同页面的例外记录，拒绝跨商品复用。");
    const exception = { productId, sourceUrl, onePiecePrice, confirmedAt: new Date().toISOString() };
    const judgement = task?.sourcing?.aiJudgement || final?.judgementSnapshot || final?.judgement, quote = sourcingFlow.quoteAutomaticSingleUnit(candidate, exception);
    if (!quote.confirmable) { queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "not_eligible" }); throw new Error("例外价格未能通过当前商品、MOQ、规格或运费复验。"); }
    const context = { task, taskId: taskIdOf(task) }; let finalPricing;
    try { finalPricing = await previewCandidatePricing(context, quote); } catch {
      if (bindingStillCurrent(binding, { allowTerminal: false })) {
        exceptions[productId] = exception; recordAudit(task, "manual_exact_product_exception_saved", { productId, sourceUrl, onePiecePrice });
        queueCandidateFinal(task, candidate, judgement, quote, { eligibleAt18Pct: false, status: "preview_failed" }, ["final_pricing_preview_missing_or_failed"]);
      }
      throw new Error("一件价已任务绑定保存，但最终利润试算未完成，仍不能确认采用。");
    }
    if (!contextIsCurrent(context) || finalPricing?.stale || !bindingStillCurrent(binding, { allowTerminal: false })) throw new Error("当前确认能力已变更，例外未用于写入采购价。");
    exceptions[productId] = exception; recordAudit(task, "manual_exact_product_exception_saved", { productId, sourceUrl, onePiecePrice });
    queueCandidateFinal(task, candidate, judgement, quote, finalPricing); setStatus("一件采购价已按当前产品绑定保存；请重新查看试算后单独确认采用。", "ok"); return exception;
  });
}
async function startSinglePinduoduoDeepSearch(taskId) {
  const binding = finalActionBinding(taskId);
  return withManualTaskLock(binding.task, async () => {
    if (!bindingStillCurrent(binding, { allowTerminal: false }) || !["final_confirmation_pending", "final_confirmation_blocked"].includes(binding.final.status)) throw new Error("当前确认能力已变更，不能启动单品补搜。");
    if (!window.confirm("将仅为这一件打开 MuMu 和拼多多进行深度补搜；不会自动下单、购买或联系商家。是否继续？")) return { cancelled: true };
    const result = await api("/api/task/search", { method: "POST", body: JSON.stringify(binding.task) });
    if (!bindingStillCurrent(binding, { allowTerminal: false })) throw new Error("当前确认能力已变更，未保存单品补搜结果。");
    sourcingState(binding.task).manualPinduoduoDeepSearch = { requestedAt: new Date().toISOString(), result: clone(result, null) }; recordAudit(binding.task, "manual_pinduoduo_deep_search_requested", { taskId: binding.taskId }); persistQueue(); render(); setStatus("已仅为当前单品启动拼多多深度补搜；采购价仍需人工确认。", "ok"); return result;
  });
}

function importQueueFile(file) {
  if (!file) return; const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "")), imported = object(parsed?.queue) || object(parsed);
      if (!Array.isArray(imported?.tasks)) throw new Error("JSON中没有任务数组。");
      const migrated = sourcingFlow.migrateMvp6StoredQueue({ queue: imported, sourceName: file.name || sourceName });
      if (!migrated.saved) throw new Error("任务必须是普通对象，并且任务ID必须安全且唯一。");
      queue = migrated.saved.queue; sourceName = migrated.saved.sourceName || file.name || sourceName; queueMeta(); automaticBatch.cursor = 0; automaticBatch.completed = 0; automaticBatch.failed = 0; automaticBatch.status = "idle"; persistQueue(); render(); setStatus(`已导入${queue.tasks.length}个任务；可开始批量自动找货源。`, "ok");
    }
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
