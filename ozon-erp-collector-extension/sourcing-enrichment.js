const fileInput = document.getElementById("queueFile");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const downloadButton = document.getElementById("download");
const statusElement = document.getElementById("status");
const rowsElement = document.getElementById("taskRows");

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

function taskState(task) {
  if (task?.enrichment?.mainImageUrl) return "completed";
  return task?.enrichment?.mainImageStatus || "pending";
}

function stats() {
  const tasks = queue?.tasks || [];
  const success = tasks.filter((task) => taskState(task) === "completed").length;
  const failed = tasks.filter((task) => taskState(task) === "failed").length;
  return { total: tasks.length, success, failed, pending: tasks.length - success - failed };
}

function updateStats() {
  const current = stats();
  document.getElementById("totalCount").textContent = current.total;
  document.getElementById("successCount").textContent = current.success;
  document.getElementById("failedCount").textContent = current.failed;
  document.getElementById("pendingCount").textContent = current.pending;
}

function cell(text, className = "") {
  const element = document.createElement("td");
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderRows() {
  rowsElement.replaceChildren();
  const tasks = queue?.tasks || [];
  if (!tasks.length) {
    const row = document.createElement("tr");
    const empty = cell("尚未导入任务。", "muted");
    empty.colSpan = 9;
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
    row.append(cell(task.source?.storeName || "-"));
    const state = taskState(task);
    const stateLabels = { pending: "等待", running: "读取中", completed: "成功", failed: "失败" };
    row.append(cell(stateLabels[state] || state, state === "completed" ? "ok" : state === "failed" ? "bad" : "muted"));
    const routeLabels = { "metadata-fetch": "元数据直读", "tab-fallback": "标签页兜底" };
    row.append(cell(routeLabels[task.enrichment?.mainImageRoute] || "-", "muted"));
    row.append(cell(task.enrichment?.mainImageElapsedMs ? `${(task.enrichment.mainImageElapsedMs / 1000).toFixed(1)}秒` : "-", "muted"));
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
    if (!task.enrichment.mainImageUrl && task.enrichment.mainImageStatus === "running") task.enrichment.mainImageStatus = "pending";
  });
  queue = parsed;
  sourceFileName = file.name || sourceFileName;
  startButton.disabled = false;
  downloadButton.disabled = false;
  renderRows();
  const current = stats();
  setStatus(`已导入${current.total}件；已有主图${current.success}件，等待/可重试${current.total - current.success}件。`, "success");
}

async function runEnrichment() {
  if (!queue || running) return;
  running = true;
  stopRequested = false;
  startButton.disabled = true;
  stopButton.disabled = false;
  fileInput.disabled = true;
  const pending = queue.tasks.filter((task) => !task.enrichment?.mainImageUrl);
  for (let index = 0; index < pending.length; index += 1) {
    if (stopRequested) break;
    const task = pending[index];
    task.enrichment.mainImageStatus = "running";
    task.enrichment.mainImageError = null;
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
    renderRows();
    if (!stopRequested && index < pending.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  running = false;
  stopButton.disabled = true;
  fileInput.disabled = false;
  startButton.disabled = false;
  downloadButton.disabled = false;
  const current = stats();
  const stoppedText = stopRequested ? "已按要求停止。" : "本轮完成。";
  setStatus(`${stoppedText} 主图成功${current.success}/${current.total}，失败${current.failed}；可下载结果或再次重试失败项。`, current.failed ? "error" : "success");
}

function downloadQueue() {
  if (!queue) return;
  queue.generatedAt = new Date().toISOString();
  queue.enrichmentRun = { stage: "ozon-main-image", completedAt: queue.generatedAt, ...stats() };
  const blob = new Blob([`${JSON.stringify(queue, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = sourceFileName.replace(/\.json$/i, "") + "-main-images.json";
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
    startButton.disabled = true;
    downloadButton.disabled = true;
    renderRows();
    setStatus(error.message || String(error), "error");
  }
});
startButton.addEventListener("click", runEnrichment);
stopButton.addEventListener("click", () => { stopRequested = true; stopButton.disabled = true; setStatus("将在当前商品处理完成后停止。", ""); });
downloadButton.addEventListener("click", downloadQueue);

renderRows();
