const core = globalThis.OzonStoreScannerCore;
const BATCH_KEY = "ozonStoreBatchV1";
const statusLabels = { running: "运行中", paused: "已暂停", completed: "已完成", stopped: "已停止", pending: "等待中", loading: "正在打开", recovering: "刷新后恢复中", scanning: "扫描中", retrying: "等待重试", partial: "部分完成", failed: "失败", skipped: "已跳过" };
const phaseLabels = { pending: "等待", loading: "打开页面", recovering: "刷新恢复", scanning: "正向扫描", "boundary-check": "末尾确认", reviewing: "反向复查", completed: "已完成", skipped: "已跳过", retrying: "等待重试", failed: "失败", partial: "部分完成", idle: "空闲" };
let currentBatch = null;

const $ = (id) => document.getElementById(id);
$("version").textContent = `v${chrome.runtime.getManifest().version}`;

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || "操作失败"));
      else resolve(response);
    });
  });
}

function setMessage(message, error = false) {
  $("message").textContent = message;
  $("message").style.color = error ? "#b42318" : "#566784";
}

function healthSummary(task) {
  const parts = [];
  if (task.health === "stalled") parts.push("疑似卡住");
  parts.push(phaseLabels[task.phase] || phaseLabels[task.status] || "等待");
  if (Number(task.noNewSkuScreens) > 0) parts.push(`连续 ${task.noNewSkuScreens} 屏无新增`);
  if (Number(task.reloadCount) > 0) parts.push(`页面重载 ${task.reloadCount} 次`);
  if (task.lastProgressAt) {
    const updated = new Date(task.lastProgressAt);
    if (!Number.isNaN(updated.getTime())) parts.push(`更新 ${updated.toLocaleTimeString("zh-CN", { hour12: false })}`);
  }
  return parts.join(" · ");
}

function render(batch) {
  currentBatch = batch;
  const tasks = batch?.stores || [];
  const completed = tasks.filter((task) => ["completed", "partial", "failed", "skipped"].includes(task.status)).length;
  $("batchStatus").textContent = statusLabels[batch?.status] || "未创建";
  $("storeProgress").textContent = `${completed} / ${tasks.length}`;
  $("observedTotal").textContent = String(tasks.reduce((sum, task) => sum + (Number(task.observedCount) || 0), 0));
  $("qualifiedTotal").textContent = String(tasks.reduce((sum, task) => sum + (Number(task.qualifiedCount) || 0), 0));
  setMessage(batch?.message || "粘贴店铺地址后开始任务。");
  $("pause").disabled = batch?.status !== "running";
  $("resume").disabled = !["paused", "stopped"].includes(batch?.status);
  $("skip").disabled = !batch || batch.currentIndex >= tasks.length || !["loading", "recovering", "scanning"].includes(tasks[batch.currentIndex]?.status);
  $("stop").disabled = !batch || ["completed", "stopped"].includes(batch.status);
  $("clearBatch").disabled = !batch;
  $("retryFailed").disabled = !tasks.some((task) => ["failed", "partial"].includes(task.status));
  $("exportMd").disabled = !tasks.length;
  $("exportCsv").disabled = !tasks.length;
  $("exportJson").disabled = !tasks.length;
  if (!tasks.length) {
    $("tasks").innerHTML = '<tr><td colspan="10" class="empty">尚未创建批量任务</td></tr>';
    return;
  }
  $("tasks").innerHTML = tasks.map((task, index) => `<tr class="${index === batch.currentIndex && batch.status !== "completed" ? "current" : ""}"><td>${index + 1}</td><td class="url"><a href="${task.url}" target="_blank">${task.sellerKey}</a></td><td class="status-${task.status}">${statusLabels[task.status] || task.status}</td><td>${task.attempts}/3</td><td title="本轮已查看 ${task.runObservedCount || 0} 个">${task.observedCount || 0}${task.runObservedCount ? `<small>（本轮${task.runObservedCount}）</small>` : ""}</td><td>${task.qualifiedCount || 0}</td><td>${task.pendingCount || 0}</td><td class="health ${task.health === "stalled" ? "health-stalled" : ""}">${healthSummary(task)}</td><td title="${task.note || task.error || ""}">${task.note || task.error || "-"}</td><td><button type="button" class="row-delete" data-delete-store="${encodeURIComponent(task.sellerKey)}">删除</button></td></tr>`).join("");
}

async function refresh() {
  try {
    const response = await send({ type: "getStoreBatchState" });
    render(response.batch);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function runAction(type) {
  try {
    const response = await send({ type });
    render(response.batch || currentBatch);
  } catch (error) {
    setMessage(error.message, true);
  }
}

$("start").addEventListener("click", async () => {
  const parsed = core.parseStoreUrlList($("urls").value, 50);
  if (!parsed.urls.length) {
    setMessage("没有识别到有效的 Ozon 店铺地址，请检查输入。", true);
    return;
  }
  if (parsed.invalid.length || parsed.overflowCount) {
    const details = [parsed.invalid.length ? `${parsed.invalid.length} 行无效` : "", parsed.overflowCount ? `${parsed.overflowCount} 家超过 50 家上限` : ""].filter(Boolean).join("，");
    if (!confirm(`${details}，是否继续处理其余 ${parsed.urls.length} 家店铺？`)) return;
  }
  try {
    setMessage("正在创建批量任务……");
    const response = await send({ type: "startStoreBatch", urls: parsed.urls, clearExisting: $("clearExisting").checked });
    render(response.batch);
  } catch (error) {
    setMessage(error.message, true);
  }
});

$("pause").addEventListener("click", () => runAction("pauseStoreBatch"));
$("resume").addEventListener("click", () => runAction("resumeStoreBatch"));
$("stop").addEventListener("click", () => runAction("stopStoreBatch"));
$("clearBatch").addEventListener("click", async () => {
  if (!currentBatch) return;
  const active = currentBatch.status === "running";
  const activeWarning = active ? "\n\n当前任务仍在运行，清空时会同时停止扫描。" : "";
  if (!confirm(`确认清空当前批次？\n\n左侧链接、右侧任务列表、统计和运行状态会被清除。已下载到电脑的 JSON/Markdown/CSV 文件以及各店铺历史采集记录都会保留。${activeWarning}`)) return;
  $("clearBatch").disabled = true;
  try {
    const response = await send({ type: "clearStoreBatch", batchId: currentBatch.id });
    $("urls").value = "";
    render(response.batch || null);
    $("urls").focus();
  } catch (error) {
    $("clearBatch").disabled = false;
    setMessage(error.message, true);
  }
});
$("skip").addEventListener("click", async () => {
  try {
    const response = await send({ type: "skipStoreBatchCurrent", source: "batch-manager" });
    render(response.batch || currentBatch);
  } catch (error) {
    setMessage(error.message, true);
  }
});
$("retryFailed").addEventListener("click", () => runAction("retryFailedStoreBatch"));

$("tasks").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-store]");
  if (!button || !currentBatch) return;
  const sellerKey = decodeURIComponent(button.dataset.deleteStore || "");
  const task = currentBatch.stores.find((item) => item.sellerKey === sellerKey);
  if (!task) return;
  const activeWarning = currentBatch.stores[currentBatch.currentIndex]?.sellerKey === sellerKey && ["loading", "recovering", "scanning"].includes(task.status)
    ? "\n\n这家店正在扫描，删除后会停止当前扫描并继续下一家。"
    : "";
  if (!confirm(`确认从当前批次删除店铺 ${sellerKey}？${activeWarning}\n\n本地已采集记录不会被清空。`)) return;
  button.disabled = true;
  try {
    const response = await send({ type: "removeStoreBatchTask", batchId: currentBatch.id, sellerKey });
    render(response.batch);
  } catch (error) {
    button.disabled = false;
    setMessage(error.message, true);
  }
});

function download(name, content, type, includeBom = true) {
  const blob = new Blob([includeBom ? "\ufeff" : "", content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportBatch(format) {
  if (!currentBatch) return;
  const response = await send({ type: "getBatchStoreResults", sellerKeys: currentBatch.stores.map((task) => task.sellerKey) });
  const stores = response.stores || {};
  const date = new Date().toISOString().slice(0, 10);
  const exportedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  if (format === "md") download(`Ozon批量店铺符合要求_${date}.md`, core.buildBatchMarkdown({ batch: currentBatch, stores, exportedAt }), "text/markdown;charset=utf-8");
  else if (format === "csv") download(`Ozon批量店铺符合要求_${date}.csv`, core.buildBatchCsv({ batch: currentBatch, stores }), "text/csv;charset=utf-8");
  else {
    const queue = core.buildBatchTaskQueue({ batch: currentBatch, stores, exportedAt });
    if (!queue.tasks.length) throw new Error("当前批次没有可导出的符合要求商品。");
    download(`Ozon找品任务_${date}.json`, `${JSON.stringify(queue, null, 2)}\n`, "application/json;charset=utf-8", false);
    setMessage(`已导出找品任务JSON，共${queue.tasks.length}件，可直接进入主图与核价补全。`);
  }
}

$("exportJson").addEventListener("click", () => exportBatch("json").catch((error) => setMessage(error.message, true)));
$("exportMd").addEventListener("click", () => exportBatch("md").catch((error) => setMessage(error.message, true)));
$("exportCsv").addEventListener("click", () => exportBatch("csv").catch((error) => setMessage(error.message, true)));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[BATCH_KEY]) {
    if (!changes[BATCH_KEY].newValue) $("urls").value = "";
    render(changes[BATCH_KEY].newValue || null);
  }
});

refresh();
