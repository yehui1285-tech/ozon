let queue = null;
let sourceName = "ozon-sourcing.json";
const storageKey = "ozon-pinduoduo-agent-mvp3";
const batch = { running: false, paused: false, riskPaused: false, pauseReason: "", stopRequested: false, cursor: 0, completed: 0, failed: 0 };
const batchDelayRangeMs = { min: 12000, max: 25000 };

const $ = (id) => document.getElementById(id);

function setStatus(message, state = "") {
  $("status").textContent = message;
  $("status").className = state;
}

function candidateSearchComplete(task) {
  return Array.isArray(task?.sourcing?.searchCandidates)
    && task.sourcing.searchCandidates.some((candidate) => candidate?.detail?.detailStatus === "detail_captured");
}

function persistQueue() {
  if (!queue) return;
  queue.meta = queue.meta && typeof queue.meta === "object" ? queue.meta : {};
  queue.meta.pinduoduoBatch = {
    cursor: batch.cursor,
    completed: batch.completed,
    failed: batch.failed,
    status: batch.running ? (batch.paused ? (batch.riskPaused ? "paused_risk_control" : "paused") : "running") : (batch.stopRequested ? "stopped" : "idle"),
    pauseReason: batch.pauseReason || null,
    updatedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(storageKey, JSON.stringify({ queue, sourceName })); }
  catch (error) { setStatus(`本地保存失败：${error.message}`, "bad"); }
}

function restoreQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!Array.isArray(saved?.queue?.tasks)) return false;
    queue = saved.queue;
    sourceName = saved.sourceName || sourceName;
    const state = queue?.meta?.pinduoduoBatch || {};
    batch.cursor = Number(state.cursor) || 0;
    batch.completed = Number(state.completed) || 0;
    batch.failed = Number(state.failed) || 0;
    return true;
  } catch { return false; }
}

function readiness(task) {
  const reasons = [];
  if (task?.status !== "pending_pinduoduo_search" && task?.status !== "pending_human_review") reasons.push("Ozon补全未完成");
  if (!task?.enrichment?.mainImageUrl) reasons.push("缺主图");
  if (!(Number(task?.enrichment?.maxPurchaseCostAt18Pct) >= 0)) reasons.push("缺18%成本上限");
  return { ready: reasons.length === 0, reasons };
}

function stats() {
  const tasks = queue?.tasks || [];
  return {
    total: tasks.length,
    ready: tasks.filter((task) => readiness(task).ready).length,
    blocked: tasks.filter((task) => !readiness(task).ready).length,
    priced: tasks.filter((task) => Number(task?.pricing?.purchaseCost) > 0).length,
    eligible: tasks.filter((task) => task?.pricing?.eligibleAt18Pct === true).length,
    sourced: tasks.filter(candidateSearchComplete).length,
  };
}

function updateStats() {
  const value = stats();
  Object.entries(value).forEach(([key, count]) => $(key).textContent = count);
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "-";
}

function render() {
  updateStats();
  $("download").disabled = !queue;
  $("batchStart").disabled = !queue || batch.running;
  $("batchPause").disabled = !batch.running || batch.paused;
  $("batchResume").disabled = !batch.running || !batch.paused;
  $("batchStop").disabled = !batch.running;
  const tasks = queue?.tasks || [];
  if (!tasks.length) {
    $("rows").innerHTML = '<tr><td colspan="10" class="empty">尚未导入任务。</td></tr>';
    return;
  }
  $("rows").replaceChildren(...tasks.map((task, index) => {
    const ready = readiness(task);
    const row = document.createElement("tr");
    const purchaseCost = Number(task?.pricing?.purchaseCost);
    const suggestedCost = Number(task?.sourcing?.suggestedCandidate?.detail?.displayedPrice ?? task?.sourcing?.suggestedCandidate?.displayedPrice);
    const eligible = task?.pricing?.eligibleAt18Pct;
    const stage = task?.sourcing?.status === "paused_risk_control" ? "风控暂停" : task.status;
    row.innerHTML = `<td>${index + 1}</td><td></td><td class="name"></td><td class="money">${money(task?.enrichment?.maxPurchaseCostAt18Pct)}</td><td class="${task?.sourcing?.status === "paused_risk_control" || !ready.ready ? "bad" : "ok"}">${ready.ready ? stage : ready.reasons.join("、")}</td><td></td><td></td><td></td><td class="${eligible === true ? "ok" : eligible === false ? "bad" : "muted"}">${eligible === true ? "达到18%" : eligible === false ? "低于18%" : "待判断"}</td><td></td>`;
    const imageCell = row.children[1];
    if (task?.enrichment?.mainImageUrl) {
      const image = document.createElement("img"); image.className = "thumb"; image.src = task.enrichment.mainImageUrl; image.alt = "主图"; imageCell.append(image);
    } else imageCell.textContent = "-";
    row.children[2].textContent = `${task?.ozon?.sku || "-"}\n${task?.ozon?.name || "-"}`;
    const deviceCell = row.children[5];
    const prepare = document.createElement("button"); prepare.textContent = candidateSearchComplete(task) ? "重新找同款" : "自动以图找同款"; prepare.disabled = !ready.ready || batch.running; prepare.addEventListener("click", async () => { try { await searchTask(task, prepare); } catch {} }); deviceCell.append(prepare);
    if (task?.sourcing?.searchCandidates?.length) {
      const list = document.createElement("small");
      task.sourcing.searchCandidates.forEach((candidate, candidateIndex) => {
        const line = document.createElement("div");
        const detailPrice = candidate?.detail?.displayedPrice ?? candidate.displayedPrice;
        const shipping = candidate?.detail?.shippingFee === 0 ? "包邮" : "运费待核";
        const label = `候选${candidateIndex + 1}：${money(detailPrice)}元，${shipping}`;
        if (candidate.sourceUrl) { const anchor = document.createElement("a"); anchor.href = candidate.sourceUrl; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.textContent = label; line.append(anchor); }
        else line.textContent = `${label}（链接未取得）`;
        list.append(line);
      });
      deviceCell.append(list);
    }
    const price = document.createElement("input"); price.className = "price"; price.type = "number"; price.min = "0.01"; price.step = "0.01"; price.placeholder = "含运实付价"; if (purchaseCost > 0) price.value = purchaseCost.toFixed(2); else if (suggestedCost > 0) price.value = suggestedCost.toFixed(2); row.children[6].append(price);
    const link = document.createElement("input"); link.className = "link"; link.type = "url"; link.placeholder = "候选商品链接（可暂空）"; link.value = task?.pricing?.sourceUrl || task?.sourcing?.suggestedCandidate?.sourceUrl || ""; row.children[7].append(link);
    const actions = document.createElement("div"); actions.className = "row-actions"; const save = document.createElement("button"); save.textContent = "写入采购价"; save.disabled = !ready.ready; save.addEventListener("click", () => savePrice(task, price.value, link.value)); actions.append(save); row.children[9].append(actions);
    return row;
  }));
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-ozon-agent": "local-ui-v1", ...(options.headers || {}) } });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || "操作失败");
    error.code = payload.code || "";
    error.details = payload.risk || null;
    throw error;
  }
  return payload;
}

async function checkDevice() {
  try {
    setStatus("正在检查MuMu和拼多多……");
    const result = await api("/api/status");
    const status = result.status;
    setStatus(`MuMu：${status.androidStarted || status.bootCompleted ? "安卓已启动" : "未启动"}；拼多多：${status.pinduoduoInstalled ? "已安装" : "未检测到或设备未启动"}`, status.bootCompleted && status.pinduoduoInstalled ? "ok" : "bad");
  } catch (error) { setStatus(error.message, "bad"); }
}

async function searchTask(task, button = null, { batchMode = false } = {}) {
  if (button) button.disabled = true;
  try {
    if (!batchMode) setStatus(`SKU ${task.ozon.sku}：正在下发主图并执行拼多多以图搜索……`);
    const result = await api("/api/task/search", { method: "POST", body: JSON.stringify({ taskId: task.taskId, mainImageUrl: task.enrichment.mainImageUrl }) });
    task.sourcing = task.sourcing || {};
    task.sourcing.devicePreparation = { status: "completed", remoteImagePath: result.remotePath, completedAt: new Date().toISOString() };
    task.sourcing.searchCandidates = result.candidates;
    const detailCandidates = result.candidates.filter((candidate) => candidate?.detail?.detailStatus === "detail_captured");
    task.sourcing.suggestedCandidate = [...(detailCandidates.length ? detailCandidates : result.candidates)].sort((left, right) => Number(left?.detail?.displayedPrice ?? left.displayedPrice) - Number(right?.detail?.displayedPrice ?? right.displayedPrice))[0] || null;
    task.sourcing.status = detailCandidates.length ? "candidate_details_captured_pending_verification" : "candidates_found_pending_verification";
    task.sourcing.searchCompletedAt = detailCandidates.length ? new Date().toISOString() : null;
    task.sourcing.searchLastError = detailCandidates.length ? null : "未取得任何完整候选详情";
    persistQueue();
    if (!batchMode) setStatus(`${result.message} 已预填最低详情展示价及链接；确认规格和优惠条件后再写入采购价。`, detailCandidates.length ? "ok" : "bad");
    render();
    if (!detailCandidates.length) throw new Error("未取得任何完整候选详情，可稍后重试。");
    return result;
  } catch (error) {
    task.sourcing = task.sourcing || {};
    const riskControl = error.code === "PINDUODUO_RISK_CONTROL";
    task.sourcing.status = riskControl ? "paused_risk_control" : "search_failed_retryable";
    task.sourcing.searchLastError = error.message || String(error);
    task.sourcing.searchFailedAt = new Date().toISOString();
    task.sourcing.riskControl = riskControl ? { ...(error.details || {}), detectedAt: new Date().toISOString() } : null;
    persistQueue();
    if (!batchMode) setStatus(error.message, "bad");
    if (button) button.disabled = false;
    render();
    throw error;
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function randomBatchDelayMs() {
  return Math.floor(Math.random() * (batchDelayRangeMs.max - batchDelayRangeMs.min + 1)) + batchDelayRangeMs.min;
}

async function waitForNextBatchTask(nextIndex, total) {
  const endsAt = Date.now() + randomBatchDelayMs();
  while (Date.now() < endsAt) {
    if (batch.stopRequested) return false;
    if (batch.paused) {
      await wait(300);
      continue;
    }
    const seconds = Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
    setStatus(`随机间隔中：${seconds}秒后处理第${nextIndex + 1}/${total}件；可随时暂停或停止。`);
    await wait(Math.min(1000, Math.max(1, endsAt - Date.now())));
  }
  return !batch.stopRequested;
}

async function runBatch() {
  if (!queue || batch.running) return;
  const tasks = queue.tasks || [];
  if (batch.cursor >= tasks.length) batch.cursor = 0;
  batch.running = true; batch.paused = false; batch.riskPaused = false; batch.pauseReason = ""; batch.stopRequested = false; batch.completed = 0; batch.failed = 0;
  render(); persistQueue();
  try {
    for (let index = batch.cursor; index < tasks.length; index += 1) {
      batch.cursor = index;
      if (batch.paused) setStatus(`批量任务已暂停：下一件为第${index + 1}行。`, "");
      while (batch.paused && !batch.stopRequested) await wait(300);
      if (batch.stopRequested) break;
      const task = tasks[index];
      if (!readiness(task).ready || candidateSearchComplete(task)) { batch.cursor = index + 1; persistQueue(); continue; }
      setStatus(`批量找同款 ${index + 1}/${tasks.length}：SKU ${task?.ozon?.sku || "-"}，当前商品完成后可暂停或停止。`);
      let riskError = null;
      try { await searchTask(task, null, { batchMode: true }); batch.completed += 1; }
      catch (error) {
        if (error.code === "PINDUODUO_RISK_CONTROL") riskError = error;
        else batch.failed += 1;
      }
      if (riskError) {
        batch.paused = true; batch.riskPaused = true; batch.pauseReason = riskError.message;
        batch.cursor = index;
        persistQueue(); render();
        setStatus(`${riskError.message} 当前SKU ${task?.ozon?.sku || "-"}未跳过，解除限制后点击“继续”将重试本件。`, "bad");
        while (batch.paused && !batch.stopRequested) await wait(300);
        if (batch.stopRequested) break;
        batch.riskPaused = false; batch.pauseReason = "";
        index -= 1;
        continue;
      }
      batch.cursor = index + 1;
      persistQueue(); render();
      const nextPendingOffset = tasks.slice(index + 1).findIndex((entry) => readiness(entry).ready && !candidateSearchComplete(entry));
      if (nextPendingOffset >= 0 && !(await waitForNextBatchTask(index + 1 + nextPendingOffset, tasks.length))) break;
    }
  } finally {
    const stopped = batch.stopRequested;
    batch.running = false; batch.paused = false; batch.riskPaused = false; batch.pauseReason = ""; batch.stopRequested = false;
    persistQueue(); render();
    const remaining = tasks.filter((task) => readiness(task).ready && !candidateSearchComplete(task)).length;
    setStatus(`${stopped ? "批量任务已停止" : "批量任务本轮完成"}：新增成功${batch.completed}件，失败${batch.failed}件，剩余${remaining}件；失败项可再次批量重试。`, batch.failed ? "bad" : "ok");
  }
}

function savePrice(task, value, sourceUrl) {
  const purchaseCost = Number(value);
  const limit = Number(task?.enrichment?.maxPurchaseCostAt18Pct);
  if (!(purchaseCost > 0)) return setStatus("采购价必须大于0。", "bad");
  if (!(limit >= 0)) return setStatus("该任务缺少18%最高采购成本。", "bad");
  const candidate = { platform: "pinduoduo", purchaseCost: Number(purchaseCost.toFixed(2)), sourceUrl: String(sourceUrl || "").trim() || null, matchStatus: "pending_human_review", capturedAt: new Date().toISOString() };
  task.sourcing = task.sourcing || {}; task.pricing = task.pricing || {}; task.audit = task.audit || {};
  task.sourcing.platform = "pinduoduo"; task.sourcing.status = "pending_human_review"; task.sourcing.candidates = [...(task.sourcing.candidates || []), candidate]; task.sourcing.selectedCandidate = candidate;
  task.pricing.purchaseCost = candidate.purchaseCost; task.pricing.sourceUrl = candidate.sourceUrl; task.pricing.eligibleAt18Pct = candidate.purchaseCost <= limit;
  task.status = "pending_human_review"; task.audit.updatedAt = new Date().toISOString();
  persistQueue();
  setStatus(`SKU ${task.ozon.sku}采购价已写入：${candidate.purchaseCost.toFixed(2)}元，${task.pricing.eligibleAt18Pct ? "达到" : "未达到"}18%利润门槛。`, task.pricing.eligibleAt18Pct ? "ok" : "bad");
  render();
}

$("queueFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.tasks)) throw new Error("JSON中缺少tasks数组。");
    queue = parsed; sourceName = file.name; batch.cursor = 0; batch.completed = 0; batch.failed = 0; persistQueue(); render(); setStatus(`已导入${parsed.tasks.length}件，其中${stats().ready}件可进入拼多多找品。`, "ok");
  } catch (error) { queue = null; render(); setStatus(`导入失败：${error.message}`, "bad"); }
});

$("checkDevice").addEventListener("click", checkDevice);
$("startDevice").addEventListener("click", async () => { try { setStatus("正在请求启动MuMu……"); const result = await api("/api/device/launch", { method: "POST", body: "{}" }); setStatus(`${result.message}请等待安卓桌面出现后再次检查。`, "ok"); } catch (error) { setStatus(error.message, "bad"); } });
$("openPdd").addEventListener("click", async () => { try { const result = await api("/api/pinduoduo/launch", { method: "POST", body: "{}" }); setStatus(result.message, "ok"); } catch (error) { setStatus(error.message, "bad"); } });
$("batchStart").addEventListener("click", () => { void runBatch(); });
$("batchPause").addEventListener("click", () => { if (!batch.running) return; batch.paused = true; batch.riskPaused = false; batch.pauseReason = "人工暂停"; persistQueue(); render(); setStatus("已请求暂停；当前商品核验完成后暂停。", ""); });
$("batchResume").addEventListener("click", () => { if (!batch.running) return; batch.paused = false; batch.riskPaused = false; batch.pauseReason = ""; persistQueue(); render(); setStatus("批量任务已继续。", "ok"); });
$("batchStop").addEventListener("click", () => { if (!batch.running) return; batch.stopRequested = true; batch.paused = false; persistQueue(); render(); setStatus("已请求停止；当前商品核验完成后停止并保存进度。", ""); });
$("download").addEventListener("click", () => { if (!queue) return; const blob = new Blob([`${JSON.stringify(queue, null, 2)}\n`], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = sourceName.replace(/\.json$/i, "") + "-pinduoduo-pricing.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });

const restored = restoreQueue();
render();
const restoredRiskPause = restored && queue?.meta?.pinduoduoBatch?.status === "paused_risk_control";
if (restoredRiskPause) setStatus(`已恢复风控暂停进度：${queue.meta.pinduoduoBatch.pauseReason || "检测到拼多多验证页面"}。人工处理后可重新开始批量任务并重试当前SKU。`, "bad");
else {
  if (restored) setStatus(`已恢复本地任务：${queue.tasks.length}件，已完成找同款${stats().sourced}件，可继续批量处理。`, "ok");
  void checkDevice();
}
