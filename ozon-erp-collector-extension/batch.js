const core = globalThis.OzonStoreScannerCore;
const BATCH_KEY = "ozonStoreBatchV1";
const statusLabels = { running: "运行中", paused: "已暂停", completed: "已完成", stopped: "已停止", pending: "等待中", loading: "正在打开", recovering: "刷新后恢复中", scanning: "扫描中", retrying: "等待重试", partial: "部分完成", failed: "失败", skipped: "已跳过" };
const phaseLabels = { pending: "等待", loading: "打开页面", recovering: "刷新恢复", scanning: "正向扫描", "boundary-check": "末尾确认", reviewing: "反向复查", completed: "已完成", skipped: "已跳过", retrying: "等待重试", failed: "失败", partial: "部分完成", idle: "空闲" };
let currentBatch = null;
let riskRefreshToken = 0;

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function riskRows(batch, stores = {}) {
  const rows = [];
  (batch?.stores || []).forEach((task) => {
    const saved = stores[task.sellerKey] || { products: {} };
    Object.values(saved.products || {}).forEach((product) => {
      const risk = core.productShippingRisk(product);
      if (risk.type === "clear") return;
      rows.push({ task, saved, product, risk });
    });
  });
  return rows.sort((left, right) => {
    const priority = (entry) => entry.risk.type === "suspected_prohibited" && !entry.product.shippingReviewDecision ? 0 : entry.risk.type === "suspected_prohibited" ? 1 : 2;
    return priority(left) - priority(right) || String(left.product.sku || "").localeCompare(String(right.product.sku || ""), "zh-CN", { numeric: true });
  });
}

function renderRiskReview(batch, stores = {}) {
  const rows = riskRows(batch, stores);
  const suspected = rows.filter((entry) => entry.risk.type === "suspected_prohibited");
  $("riskPendingTotal").textContent = String(suspected.filter((entry) => !entry.product.shippingReviewDecision).length);
  $("riskAllowedTotal").textContent = String(suspected.filter((entry) => entry.product.shippingReviewDecision === "allowed").length);
  $("riskExcludedTotal").textContent = String(suspected.filter((entry) => entry.product.shippingReviewDecision === "excluded").length);
  $("landOnlyTotal").textContent = String(rows.filter((entry) => entry.risk.type === "land_only").length);
  if (!rows.length) {
    $("shippingRisks").innerHTML = '<tr><td colspan="8" class="empty">尚未识别到禁运或运输限制商品</td></tr>';
    return;
  }
  $("shippingRisks").innerHTML = rows.map(({ task, saved, product, risk }, index) => {
    const sellerKey = encodeURIComponent(task.sellerKey);
    const sku = encodeURIComponent(product.sku || "");
    const decision = product.shippingReviewDecision;
    const typeLabel = risk.type === "land_only" ? "仅限陆运" : "疑似禁运";
    const typeClass = risk.type === "land_only" ? "risk-land" : "risk-prohibited";
    let actions = '<span class="decision">运输限制已记录</span>';
    if (risk.type === "suspected_prohibited") {
      actions = `<div class="review-actions"><button type="button" class="allow-button" data-risk-action="allowed" data-seller-key="${sellerKey}" data-sku="${sku}" ${decision === "allowed" ? "disabled" : ""}>允许找品</button><button type="button" class="exclude-button" data-risk-action="excluded" data-seller-key="${sellerKey}" data-sku="${sku}" ${decision === "excluded" ? "disabled" : ""}>确认排除</button></div>`;
    }
    return `<tr><td>${index + 1}</td><td><span class="risk-badge ${typeClass}">${typeLabel}</span></td><td>${escapeHtml(product.name || "-")}<br><small>类目：${escapeHtml(product.category || "-")}</small></td><td>${escapeHtml(product.sku || "-")}</td><td>${escapeHtml(saved.storeName || task.sellerKey)}</td><td class="risk-rule">${escapeHtml(risk.label)}<br><small>命中：${escapeHtml(risk.matchedKeyword)}</small><br><small>${escapeHtml(core.shippingReviewLabel(product))}</small></td><td><a href="${escapeHtml(core.canonicalProductLink(product.link))}" target="_blank">打开商品</a></td><td>${actions}</td></tr>`;
  }).join("");
}

async function refreshRiskReview(batch = currentBatch) {
  const token = ++riskRefreshToken;
  const sellerKeys = (batch?.stores || []).map((task) => task.sellerKey);
  if (!sellerKeys.length) {
    renderRiskReview(batch, {});
    return;
  }
  try {
    const response = await send({ type: "getBatchStoreResults", sellerKeys });
    if (token !== riskRefreshToken || batch !== currentBatch) return;
    renderRiskReview(batch, response.stores || {});
  } catch (error) {
    if (token === riskRefreshToken) setMessage(`禁运复核列表读取失败：${error.message}`, true);
  }
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
    renderRiskReview(batch, {});
    return;
  }
  $("tasks").innerHTML = tasks.map((task, index) => `<tr class="${index === batch.currentIndex && batch.status !== "completed" ? "current" : ""}"><td>${index + 1}</td><td class="url"><a href="${task.url}" target="_blank">${task.sellerKey}</a></td><td class="status-${task.status}">${statusLabels[task.status] || task.status}</td><td>${task.attempts}/3</td><td title="本轮已查看 ${task.runObservedCount || 0} 个">${task.observedCount || 0}${task.runObservedCount ? `<small>（本轮${task.runObservedCount}）</small>` : ""}</td><td>${task.qualifiedCount || 0}</td><td>${task.pendingCount || 0}</td><td class="health ${task.health === "stalled" ? "health-stalled" : ""}">${healthSummary(task)}</td><td title="${task.note || task.error || ""}">${task.note || task.error || "-"}</td><td><button type="button" class="row-delete" data-delete-store="${encodeURIComponent(task.sellerKey)}">删除</button></td></tr>`).join("");
  void refreshRiskReview(batch);
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

$("shippingRisks").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-risk-action]");
  if (!button) return;
  const decision = button.dataset.riskAction;
  const sellerKey = decodeURIComponent(button.dataset.sellerKey || "");
  const sku = decodeURIComponent(button.dataset.sku || "");
  button.disabled = true;
  try {
    await send({ type: "setStoreProductShippingDecision", sellerKey, sku, decision });
    await refreshRiskReview();
    setMessage(decision === "allowed" ? `SKU ${sku} 已允许进入找品任务JSON。` : `SKU ${sku} 已确认排除，不会进入找品任务JSON。`);
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
    const excluded = Number(queue.summary?.excludedShippingRiskCount) || 0;
    setMessage(`已导出找品任务JSON，共${queue.tasks.length}件${excluded ? `；另有${excluded}件疑似禁运商品待复核或已排除` : ""}，可直接进入主图与核价补全。`);
  }
}

$("exportJson").addEventListener("click", () => exportBatch("json").catch((error) => setMessage(error.message, true)));
$("exportMd").addEventListener("click", () => exportBatch("md").catch((error) => setMessage(error.message, true)));
$("exportCsv").addEventListener("click", () => exportBatch("csv").catch((error) => setMessage(error.message, true)));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[BATCH_KEY]) {
    if (!changes[BATCH_KEY].newValue) $("urls").value = "";
    render(changes[BATCH_KEY].newValue || null);
    return;
  }
  if (areaName === "local" && Object.keys(changes).some((key) => key.startsWith("ozonStoreQualifiedProductsV2:"))) void refreshRiskReview();
});

refresh();
