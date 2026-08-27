const fileInput = document.getElementById("queueFile");
const imageButton = document.getElementById("startImages");
const pricingButton = document.getElementById("startPricing");
const stopButton = document.getElementById("stop");
const downloadButton = document.getElementById("download");
const statusElement = document.getElementById("status");
const rowsElement = document.getElementById("taskRows");
const SAVED_QUEUE_KEY = "ozonSourcingEnrichmentQueueV1";
const PRICING_METHOD_VERSION = "live-selection-wakeup-v8";

let queue = null;
let sourceFileName = "sourcing-queue.json";
let running = false;
let stopRequested = false;

function setStatus(message, state = "") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

function isOzonProductUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "www.ozon.ru" && url.pathname.startsWith("/product/");
  } catch {
    return false;
  }
}

function mainImageState(task) {
  if (task?.enrichment?.mainImageUrl) return "completed";
  return task?.enrichment?.mainImageStatus || "pending";
}

function hasFiniteValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
}

function pricingState(task) {
  if (task?.enrichment?.ozonPricingStatus === "completed"
    && task?.enrichment?.ozonPricingMethodVersion === PRICING_METHOD_VERSION
    && Number(task?.enrichment?.originalBlackPrice) > 0
    && Number(task?.enrichment?.internationalFreight) > 0
    && hasFiniteValue(task?.enrichment?.maxPurchaseCostAt18Pct)) return "completed";
  return task?.enrichment?.ozonPricingStatus || "pending";
}

function syncTaskStage(task) {
  if (pricingState(task) === "disqualified") {
    task.enrichment.status = "disqualified";
    task.status = "rejected_not_qualified";
    return;
  }
  const ready = mainImageState(task) === "completed" && pricingState(task) === "completed";
  task.enrichment.status = ready ? "completed" : "pending";
  task.status = ready ? "pending_pinduoduo_search" : "pending_ozon_enrichment";
}

function clearTaskPricingValues(task, { preserveLiveBase = false } = {}) {
  const liveBase = preserveLiveBase && task?.enrichment?.ozonPricingMethodVersion === PRICING_METHOD_VERSION
    ? {
        pagePrice: task.ozon?.pagePrice,
        competitorPrice: task.ozon?.competitorPrice,
        effectiveGreenPrice: task.ozon?.effectiveGreenPrice,
        commissions: task.ozon?.commissions,
        selectedCommission: task.ozon?.selectedCommission,
        lengthMm: task.ozon?.lengthMm,
        widthMm: task.ozon?.widthMm,
        heightMm: task.ozon?.heightMm,
        weightG: task.ozon?.weightG,
      }
    : null;
  const liveEnrichmentBase = liveBase
    ? {
        blackPriceSource: task.enrichment?.blackPriceSource,
        blackPriceSourceUrl: task.enrichment?.blackPriceSourceUrl,
        internationalFreight: task.enrichment?.internationalFreight,
        freightRoute: task.enrichment?.freightRoute,
      }
    : null;
  Object.assign(task.ozon, {
    pagePrice: null,
    competitorPrice: null,
    effectiveGreenPrice: null,
    commissions: [],
    selectedCommission: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    weightG: null,
    ...(liveBase || {}),
  });
  Object.assign(task.enrichment, {
    originalBlackPrice: null,
    blackPriceSource: null,
    blackPriceSourceUrl: null,
    internationalFreight: null,
    freightRoute: null,
    maxPurchaseCostAt18Pct: null,
    pricingCalculation: null,
    ...(liveEnrichmentBase || {}),
  });
}

function invalidateLegacyPricing(task) {
  if (!["completed", "disqualified"].includes(task?.enrichment?.ozonPricingStatus)
    || task.enrichment.ozonPricingMethodVersion === PRICING_METHOD_VERSION) return;
  clearTaskPricingValues(task);
  if (task.ozon && typeof task.ozon === "object") task.ozon.selectionQualified = null;
  Object.assign(task.enrichment, {
    ozonPricingStatus: "pending",
    ozonPricingError: "旧版核价或资格结论已作废，需要按当前页面重新读取",
  });
}

function stats() {
  const tasks = queue?.tasks || [];
  const imageCompleted = tasks.filter((task) => mainImageState(task) === "completed").length;
  const pricingCompleted = tasks.filter((task) => pricingState(task) === "completed").length;
  const pricingFailed = tasks.filter((task) => pricingState(task) === "failed").length;
  const pricingDisqualified = tasks.filter((task) => pricingState(task) === "disqualified").length;
  return { total: tasks.length, imageCompleted, pricingCompleted, pricingFailed, pricingDisqualified, pricingPending: tasks.length - pricingCompleted - pricingFailed - pricingDisqualified };
}

function updateStats() {
  const current = stats();
  document.getElementById("totalCount").textContent = current.total;
  document.getElementById("imageCount").textContent = current.imageCompleted;
  document.getElementById("pricingSuccessCount").textContent = current.pricingCompleted;
  document.getElementById("pricingFailedCount").textContent = current.pricingFailed;
  document.getElementById("pricingDisqualifiedCount").textContent = current.pricingDisqualified;
  document.getElementById("pricingPendingCount").textContent = current.pricingPending;
}

function cell(text, className = "") {
  const element = document.createElement("td");
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "-";
}

function renderRows() {
  rowsElement.replaceChildren();
  const tasks = queue?.tasks || [];
  if (!tasks.length) {
    const row = document.createElement("tr");
    const empty = cell("尚未导入任务。", "muted");
    empty.colSpan = 13;
    row.append(empty);
    rowsElement.append(row);
    updateStats();
    return;
  }
  tasks.forEach((task, index) => {
    const row = document.createElement("tr");
    row.append(cell(String(index + 1)));
    const imageCell = document.createElement("td");
    if (task.enrichment?.mainImageUrl) {
      const image = document.createElement("img");
      image.className = "thumb";
      image.src = task.enrichment.mainImageUrl;
      image.alt = `${task.ozon?.sku || ""} 主图`;
      imageCell.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "placeholder";
      placeholder.textContent = "待读取";
      imageCell.append(placeholder);
    }
    row.append(imageCell);
    row.append(cell(task.ozon?.sku || "-"));
    row.append(cell(task.ozon?.name || "-", "name"));
    row.append(cell(money(task.ozon?.effectiveGreenPrice)));
    row.append(cell(money(task.enrichment?.originalBlackPrice)));
    row.append(cell(money(task.enrichment?.internationalFreight)));
    row.append(cell(hasFiniteValue(task.enrichment?.maxPurchaseCostAt18Pct) ? Number(task.enrichment.maxPurchaseCostAt18Pct).toFixed(2) : "-", "limit"));
    const state = pricingState(task);
    const stateLabels = { pending: "等待核价", running: "核价中", completed: "核价完成", failed: "核价失败", disqualified: "产品不合要求" };
    row.append(cell(stateLabels[state] || state, state === "completed" ? "ok" : ["failed", "disqualified"].includes(state) ? "bad" : "muted"));
    const sourceLabels = { page: "当前商品", competitor: "跟卖商品" };
    const reason = ["failed", "disqualified"].includes(state) ? (task.enrichment?.ozonPricingError || "未知错误") : (sourceLabels[task.enrichment?.blackPriceSource] || "-");
    row.append(cell(reason, ["failed", "disqualified"].includes(state) ? "bad" : "muted"));
    row.append(cell(task.enrichment?.freightRoute || "-", "muted"));
    row.append(cell(task.enrichment?.ozonPricingElapsedMs ? `${(task.enrichment.ozonPricingElapsedMs / 1000).toFixed(1)}秒` : "-", "muted"));
    const linkCell = document.createElement("td");
    if (isOzonProductUrl(task.ozon?.productUrl)) {
      const link = document.createElement("a");
      link.href = task.ozon.productUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "打开";
      linkCell.append(link);
    } else linkCell.textContent = "无效链接";
    row.append(linkCell);
    rowsElement.append(row);
  });
  updateStats();
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) {
        const error = new Error(response?.error || "扩展后台未返回结果");
        error.elapsedMs = Number(response?.elapsedMs || 0) || null;
        return reject(error);
      }
      resolve(response);
    });
  });
}

async function loadQueue(file) {
  const parsed = JSON.parse(await file.text());
  if (!parsed || !Array.isArray(parsed.tasks) || !parsed.tasks.length) throw new Error("JSON中没有可处理的tasks任务列表。");
  const invalidCount = parsed.tasks.filter((task) => !isOzonProductUrl(task?.ozon?.productUrl)).length;
  if (invalidCount) throw new Error(`有${invalidCount}件商品缺少有效Ozon商品链接。`);
  parsed.tasks.forEach((task) => {
    task.enrichment = task.enrichment && typeof task.enrichment === "object" ? task.enrichment : {};
    task.audit = task.audit && typeof task.audit === "object" ? task.audit : {};
    task.ozon = task.ozon && typeof task.ozon === "object" ? task.ozon : {};
    if (!task.enrichment.mainImageUrl && task.enrichment.mainImageStatus === "running") task.enrichment.mainImageStatus = "pending";
    if (task.enrichment.ozonPricingStatus === "running") task.enrichment.ozonPricingStatus = "pending";
    invalidateLegacyPricing(task);
    if (!["completed", "disqualified"].includes(pricingState(task))) clearTaskPricingValues(task, { preserveLiveBase: true });
    syncTaskStage(task);
  });
  queue = parsed;
  sourceFileName = file.name || sourceFileName;
  imageButton.disabled = false;
  pricingButton.disabled = false;
  downloadButton.disabled = false;
  await persistQueue();
  renderRows();
  const current = stats();
  setStatus(`已导入${current.total}件；主图完成${current.imageCompleted}件，Ozon核价完成${current.pricingCompleted}件。`, "success");
}

async function persistQueue() {
  if (!queue) return;
  await chrome.storage.local.set({
    [SAVED_QUEUE_KEY]: {
      queue,
      sourceFileName,
      savedAt: new Date().toISOString(),
    },
  });
}

async function restoreQueue() {
  const stored = await chrome.storage.local.get(SAVED_QUEUE_KEY);
  const saved = stored?.[SAVED_QUEUE_KEY];
  if (!saved?.queue || !Array.isArray(saved.queue.tasks) || !saved.queue.tasks.length) return false;
  queue = saved.queue;
  sourceFileName = saved.sourceFileName || sourceFileName;
  queue.tasks.forEach((task) => {
    task.enrichment = task.enrichment && typeof task.enrichment === "object" ? task.enrichment : {};
    task.audit = task.audit && typeof task.audit === "object" ? task.audit : {};
    task.ozon = task.ozon && typeof task.ozon === "object" ? task.ozon : {};
    if (!task.enrichment.mainImageUrl && task.enrichment.mainImageStatus === "running") task.enrichment.mainImageStatus = "pending";
    if (task.enrichment.ozonPricingStatus === "running") task.enrichment.ozonPricingStatus = "pending";
    invalidateLegacyPricing(task);
    if (!["completed", "disqualified"].includes(pricingState(task))) clearTaskPricingValues(task, { preserveLiveBase: true });
    syncTaskStage(task);
  });
  imageButton.disabled = false;
  pricingButton.disabled = false;
  downloadButton.disabled = false;
  renderRows();
  const current = stats();
  setStatus(`已恢复上次进度：${current.total}件，核价完成${current.pricingCompleted}件，可继续处理或导出。`, "success");
  return true;
}

function setRunning(value) {
  running = value;
  imageButton.disabled = value || !queue;
  pricingButton.disabled = value || !queue;
  stopButton.disabled = !value;
  fileInput.disabled = value;
  downloadButton.disabled = value || !queue;
}

async function runEnrichment() {
  if (!queue || running) return;
  stopRequested = false;
  setRunning(true);
  const pending = queue.tasks.filter((task) => !task.enrichment?.mainImageUrl);
  for (let index = 0; index < pending.length; index += 1) {
    if (stopRequested) break;
    const task = pending[index];
    task.enrichment.mainImageStatus = "running";
    task.enrichment.mainImageError = null;
    await persistQueue();
    renderRows();
    setStatus(`正在处理 ${index + 1}/${pending.length}：SKU ${task.ozon.sku}…`);
    try {
      const response = await sendMessage({ type: "readMainImageFromProductUrl", url: task.ozon.productUrl });
      task.enrichment.mainImageUrl = response.imageUrl;
      task.enrichment.mainImageSource = response.source;
      task.enrichment.mainImageRoute = response.route;
      task.enrichment.mainImageElapsedMs = Number(response.elapsedMs || 0);
      task.enrichment.mainImageFetchedAt = new Date().toISOString();
      task.enrichment.mainImageStatus = "completed";
    } catch (error) {
      task.enrichment.mainImageStatus = "failed";
      task.enrichment.mainImageError = error.message || String(error);
      task.enrichment.mainImageElapsedMs = Number(error?.elapsedMs || 0) || null;
    }
    task.audit = task.audit && typeof task.audit === "object" ? task.audit : {};
    task.audit.updatedAt = new Date().toISOString();
    syncTaskStage(task);
    await persistQueue();
    renderRows();
    if (!stopRequested && index < pending.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  setRunning(false);
  const current = stats();
  const stoppedText = stopRequested ? "已按要求停止。" : "本轮完成。";
  const imageFailed = queue.tasks.filter((task) => mainImageState(task) === "failed").length;
  setStatus(`${stoppedText} 主图成功${current.imageCompleted}/${current.total}，失败${imageFailed}；可下载结果或再次重试失败项。`, imageFailed ? "error" : "success");
}

async function runPricingEnrichment() {
  if (!queue || running) return;
  stopRequested = false;
  setRunning(true);
  const pending = queue.tasks.filter((task) => !["completed", "disqualified"].includes(pricingState(task)));
  for (let index = 0; index < pending.length; index += 1) {
    if (stopRequested) break;
    const task = pending[index];
    clearTaskPricingValues(task);
    task.enrichment.ozonPricingStatus = "running";
    task.enrichment.ozonPricingError = null;
    await persistQueue();
    renderRows();
    setStatus(`正在批量核价 ${index + 1}/${pending.length}：SKU ${task.ozon.sku}…`);
    try {
      const response = await sendMessage({ type: "readOzonTaskPricing", task });
      if (response.disqualified) {
        Object.assign(task.ozon, { selectionQualified: false });
        Object.assign(task.enrichment, {
          ozonPricingStatus: "disqualified",
          ozonPricingMethodVersion: PRICING_METHOD_VERSION,
          ozonPricingError: response.disqualificationReason || "产品不合要求：页面明确显示非符合要求的选品标签",
          ozonPricingElapsedMs: Number(response.elapsedMs || 0),
          ozonPricingFetchedAt: new Date().toISOString(),
          originalBlackPrice: null,
          blackPriceSource: null,
          blackPriceSourceUrl: null,
          internationalFreight: null,
          freightRoute: null,
          maxPurchaseCostAt18Pct: null,
          pricingCalculation: null,
        });
      } else {
      Object.assign(task.ozon, {
        pagePrice: response.pagePrice,
        competitorPrice: response.competitorPrice,
        effectiveGreenPrice: response.effectiveGreenPrice,
        commissions: response.commissions,
        selectedCommission: response.selectedCommission,
        lengthMm: response.lengthMm,
        widthMm: response.widthMm,
        heightMm: response.heightMm,
        weightG: response.weightG,
      });
      Object.assign(task.enrichment, {
        ozonPricingStatus: response.partial ? "failed" : "completed",
        ozonPricingMethodVersion: PRICING_METHOD_VERSION,
        ozonPricingError: response.partial ? (response.partialError || "黑标价读取失败，已保留有效绿标价") : null,
        ozonPricingElapsedMs: Number(response.elapsedMs || 0),
        ozonPricingFetchedAt: new Date().toISOString(),
        originalBlackPrice: response.partial ? null : response.originalBlackPrice,
        blackPriceSource: response.blackPriceSource,
        blackPriceSourceUrl: response.blackPriceSourceUrl,
        internationalFreight: response.internationalFreight,
        freightRoute: response.freightRoute,
        maxPurchaseCostAt18Pct: response.partial ? null : response.maxPurchaseCostAt18Pct,
        pricingCalculation: response.partial ? null : response.calculation,
      });
      }
    } catch (error) {
      task.enrichment.ozonPricingStatus = "failed";
      task.enrichment.ozonPricingError = error.message || String(error);
      task.enrichment.ozonPricingElapsedMs = Number(error?.elapsedMs || 0) || null;
    }
    task.audit.updatedAt = new Date().toISOString();
    syncTaskStage(task);
    await persistQueue();
    renderRows();
    if (!stopRequested && index < pending.length - 1) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  setRunning(false);
  const current = stats();
  setStatus(`${stopRequested ? "已停止。" : "本轮核价补全完成。"} 成功${current.pricingCompleted}/${current.total}，不合要求${current.pricingDisqualified}，失败${current.pricingFailed}；失败项可再次重试。`, current.pricingFailed ? "error" : "success");
}

function downloadQueue() {
  if (!queue) return;
  queue.generatedAt = new Date().toISOString();
  queue.enrichmentRun = { stage: "ozon-task-pricing", completedAt: queue.generatedAt, ...stats() };
  const blob = new Blob([`${JSON.stringify(queue, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const base = sourceFileName.replace(/(?:-main-images|-ozon-pricing)?\.json$/i, "");
  link.download = `${base}-ozon-pricing.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus(`已下载 ${link.download}。`, "success");
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { await loadQueue(file); }
  catch (error) {
    queue = null;
    imageButton.disabled = true;
    pricingButton.disabled = true;
    downloadButton.disabled = true;
    renderRows();
    setStatus(error.message || String(error), "error");
  }
});
imageButton.addEventListener("click", runEnrichment);
pricingButton.addEventListener("click", runPricingEnrichment);
stopButton.addEventListener("click", () => { stopRequested = true; stopButton.disabled = true; setStatus("将在当前商品处理完成后停止。", ""); });
downloadButton.addEventListener("click", downloadQueue);

renderRows();
restoreQueue().catch((error) => setStatus(`未能恢复上次进度：${error.message || String(error)}`, "error"));
