import { applyFinalOzonPricing, preliminaryPricingDecision } from "./pricing-flow.js";

let queue = null;
let sourceName = "ozon-sourcing.json";
const storageKey = "ozon-pinduoduo-agent-mvp3";
const appVersion = "MVP 5.1";
const batch = { running: false, paused: false, riskPaused: false, pauseReason: "", stopRequested: false, cursor: 0, completed: 0, failed: 0 };
const aiBatch = { running: false, completed: 0, failed: 0, riskPaused: false, pauseReason: "" };
const skuBatch = { running: false, completed: 0, failed: 0 };
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

function aiJudgementComplete(task) {
  return Boolean(task?.sourcing?.aiJudgement?.judgedAt && task?.sourcing?.aiJudgement?.verdict);
}

function aiReady(task) {
  const candidates = Array.isArray(task?.sourcing?.searchCandidates)
    ? task.sourcing.searchCandidates.filter((candidate) => candidate?.detail?.detailStatus === "detail_captured")
    : [];
  return { ready: Boolean(task?.enrichment?.mainImageUrl && candidates.length), candidates };
}

function aiRecommendsSameProduct(task) {
  const judgement = task?.sourcing?.aiJudgement;
  return judgement?.verdict === "same_product" && judgement?.needsHumanReview === false && Number(judgement?.confidence) >= 85;
}

function resolveRecommendedCandidate(task) {
  const judgement = task?.sourcing?.aiJudgement;
  const candidates = aiReady(task).candidates.slice(0, 3);
  const candidateId = String(judgement?.bestCandidateId || "").trim();
  if (candidateId) {
    const exact = candidates.find((candidate) => String(candidate?.candidateId || "").trim() === candidateId);
    if (exact) return exact;
  }
  const index = Number(judgement?.bestCandidateIndex);
  return Number.isInteger(index) && index >= 1 && index <= candidates.length ? candidates[index - 1] : null;
}

function favoriteComplete(task) {
  return task?.sourcing?.favorite?.status === "favorited";
}

function skuVerificationComplete(task) {
  return task?.sourcing?.skuVerification?.status === "sku_price_verified";
}

function finalEligibility(task) {
  const status = task?.pricing?.finalOzonPricing?.status;
  if (status === "completed" || status === "rejected_preliminary") return task?.pricing?.eligibleAt18Pct === true;
  return null;
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
    eligible: tasks.filter((task) => finalEligibility(task) === true).length,
    sourced: tasks.filter(candidateSearchComplete).length,
    judged: tasks.filter(aiJudgementComplete).length,
    favorited: tasks.filter(favoriteComplete).length,
    skuVerified: tasks.filter(skuVerificationComplete).length,
  };
}

function updateStats() {
  const value = stats();
  Object.entries(value).forEach(([key, count]) => $(key).textContent = count);
}

function durationLabel(milliseconds) {
  const value = Number(milliseconds) || 0;
  return value >= 60000 ? `${(value / 60000).toFixed(1)}分` : `${(value / 1000).toFixed(1)}秒`;
}

function timingEntries() {
  return (queue?.tasks || [])
    .map((task) => ({ task, timing: task?.sourcing?.searchTiming }))
    .filter((entry) => entry.timing && Number(entry.timing.totalMs) >= 0)
    .sort((left, right) => String(right.timing.completedAt || "").localeCompare(String(left.timing.completedAt || "")));
}

function renderTimingPanel() {
  const summary = $("timingSummary");
  const container = $("timingRows");
  const entries = timingEntries();
  if (!entries.length) {
    summary.textContent = "尚无样本";
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "完成或失败一件找同款后，这里会显示阶段耗时。" }));
    return;
  }
  const totals = entries.map((entry) => Number(entry.timing.totalMs) || 0);
  const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  summary.textContent = `${entries.length}件 · 平均${durationLabel(average)} · 最慢${durationLabel(Math.max(...totals))}`;
  container.replaceChildren(...entries.slice(0, 6).map(({ task, timing }) => {
    const card = document.createElement("article"); card.className = `timing-card ${timing.status === "failed" ? "failed" : ""}`;
    const stages = Array.isArray(timing.stages) ? timing.stages : [];
    const slowest = stages.reduce((current, stage) => !current || Number(stage.durationMs) > Number(current.durationMs) ? stage : current, null);
    const heading = document.createElement("div"); heading.className = "timing-card-head";
    const title = document.createElement("strong"); title.textContent = `SKU ${task?.ozon?.sku || "-"} · ${durationLabel(timing.totalMs)}`;
    const meta = document.createElement("small"); meta.textContent = `${timing.status === "failed" ? "失败记录" : "完成"}${slowest ? ` · 最慢：${slowest.label} ${durationLabel(slowest.durationMs)}` : ""}`;
    heading.replaceChildren(title, meta);
    const details = document.createElement("div"); details.className = "timing-stages";
    stages.forEach((stage) => {
      const chip = document.createElement("span"); chip.className = stage.status === "error" ? "bad" : ""; chip.textContent = `${stage.label} ${durationLabel(stage.durationMs)}`; details.append(chip);
    });
    card.replaceChildren(heading, details);
    return card;
  }));
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "-";
}

function render() {
  updateStats();
  renderTimingPanel();
  $("download").disabled = !queue;
  $("batchStart").disabled = !queue || batch.running || aiBatch.running || skuBatch.running;
  $("aiBatchStart").disabled = !queue || batch.running || aiBatch.running || skuBatch.running;
  $("skuBatchStart").disabled = !queue || batch.running || aiBatch.running || skuBatch.running;
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
    const judgement = task?.sourcing?.aiJudgement;
    const judgedCandidate = resolveRecommendedCandidate(task);
    const suggestedCandidate = judgedCandidate || task?.sourcing?.suggestedCandidate;
    const verifiedCost = Number(task?.sourcing?.skuVerification?.purchaseCost);
    const eligible = finalEligibility(task);
    const stage = task?.sourcing?.status === "paused_risk_control" ? "风控暂停" : task.status;
    row.innerHTML = `<td>${index + 1}</td><td></td><td class="name"></td><td class="money">${money(task?.enrichment?.maxPurchaseCostAt18Pct)}</td><td class="${task?.sourcing?.status === "paused_risk_control" || !ready.ready ? "bad" : "ok"}">${ready.ready ? stage : ready.reasons.join("、")}</td><td></td><td></td><td></td><td class="${eligible === true ? "ok" : eligible === false ? "bad" : "muted"}">${eligible === true ? "达到18%" : eligible === false ? "低于18%" : "待判断"}</td><td></td>`;
    const imageCell = row.children[1];
    if (task?.enrichment?.mainImageUrl) {
      const image = document.createElement("img"); image.className = "thumb"; image.src = task.enrichment.mainImageUrl; image.alt = "主图"; imageCell.append(image);
    } else imageCell.textContent = "-";
    row.children[2].textContent = `${task?.ozon?.sku || "-"}\n${task?.ozon?.name || "-"}`;
    const deviceCell = row.children[5];
    const prepare = document.createElement("button"); prepare.textContent = candidateSearchComplete(task) ? "重新找同款" : "自动以图找同款"; prepare.disabled = !ready.ready || batch.running || aiBatch.running || skuBatch.running; prepare.addEventListener("click", async () => { try { await searchTask(task, prepare); } catch {} }); deviceCell.append(prepare);
    if (task?.sourcing?.searchCandidates?.length) {
      const list = document.createElement("small");
      task.sourcing.searchCandidates.forEach((candidate, candidateIndex) => {
        const line = document.createElement("div");
        const detailStatus = candidate?.detail?.detailStatus;
        const hasDetailPrice = Number(candidate?.detail?.displayedPrice) > 0;
        const detailPrice = hasDetailPrice ? candidate.detail.displayedPrice : candidate.displayedPrice;
        const shipping = candidate?.detail?.shippingFee === 0 ? "包邮" : "运费待核";
        const priceSource = hasDetailPrice ? "详情价" : "搜索页价";
        const missingLabels = (candidate?.detail?.missingFields || []).map((field) => ({ goods_id: "商品ID", title: "标题", price: "价格" }[field] || field));
        const partialState = detailStatus === "detail_partial" ? `，链接已取得，详情缺${missingLabels.join("/") || "字段"}` : "";
        const label = `候选${candidateIndex + 1}：${priceSource}${money(detailPrice)}元，${shipping}${partialState}`;
        if (candidate.sourceUrl) {
          const open = document.createElement("button"); open.className = "candidate-app-open"; open.textContent = `${label} · 在App打开`; open.disabled = batch.running || aiBatch.running || skuBatch.running; open.addEventListener("click", async () => { await openCandidateInApp(task, candidate, open); }); line.append(open);
          if (detailStatus === "detail_partial" && candidate?.detail?.error) line.title = candidate.detail.error;
        }
        else {
          const stateText = detailStatus === "detail_not_inspected" ? "未核验"
            : detailStatus === "detail_failed" ? `详情读取失败（已重试${candidate?.detail?.attemptCount || 2}次${missingLabels.length ? `，缺${missingLabels.join("/")}` : ""}）`
              : "链接解析失败";
          line.textContent = `${label}（${stateText}）`;
          if (candidate?.detail?.error) line.title = candidate.detail.error;
        }
        if (candidate?.evidence?.localRef) { const evidence = document.createElement("a"); evidence.href = candidate.evidence.localRef; evidence.target = "_blank"; evidence.rel = "noopener noreferrer"; evidence.textContent = " [证据图]"; line.append(evidence); }
        list.append(line);
      });
      deviceCell.append(list);
    }
    const price = document.createElement("input"); price.className = "price"; price.type = "number"; price.min = "0.01"; price.step = "0.01"; price.placeholder = "目标规格常规价"; if (purchaseCost > 0) price.value = purchaseCost.toFixed(2); else if (verifiedCost > 0) price.value = verifiedCost.toFixed(2); row.children[6].append(price);
    const link = document.createElement("input"); link.className = "link"; link.type = "url"; link.placeholder = "候选商品链接（可暂空）"; link.value = task?.pricing?.sourceUrl || suggestedCandidate?.sourceUrl || suggestedCandidate?.detail?.sourceUrl || ""; row.children[7].append(link);
    const resultCell = row.children[8]; resultCell.className = "ai-result";
    if (judgement) {
      const title = document.createElement("strong");
      title.className = judgement.verdict === "same_product" && !judgement.needsHumanReview ? "ok" : judgement.verdict === "no_match" ? "bad" : "muted";
      title.textContent = `${judgement.verdict === "same_product" ? "推荐同款" : judgement.verdict === "no_match" ? "未找到同款" : "需要复核"} · ${judgement.confidence}%`;
      const reason = document.createElement("small"); reason.textContent = judgement.reason || "无判断理由";
      resultCell.replaceChildren(title, reason);
      if (aiRecommendsSameProduct(task)) {
        const favorite = document.createElement("small");
        const favoriteStatus = task?.sourcing?.favorite?.status;
        favorite.className = favoriteStatus === "favorited" ? "ok" : favoriteStatus === "failed" || favoriteStatus === "paused_risk_control" ? "bad" : "muted";
        favorite.textContent = favoriteStatus === "favorited" ? (task.sourcing.favorite.alreadyFavorited ? "已收藏（原已收藏）" : "已收藏")
          : favoriteStatus === "favoriting" ? "收藏中……"
            : favoriteStatus === "paused_risk_control" ? `收藏暂停：${task.sourcing.favorite.error || "触发风控"}`
              : favoriteStatus === "failed" ? `收藏失败：${task.sourcing.favorite.error || "未知错误"}`
                : "等待自动收藏";
        resultCell.append(favorite);
        const sku = document.createElement("small");
        const verification = task?.sourcing?.skuVerification;
        sku.className = verification?.status === "sku_price_verified" ? "ok" : verification?.status === "failed" || verification?.status === "pending_human_review" ? "bad" : "muted";
        sku.textContent = verification?.status === "sku_price_verified"
          ? `规格已核验：${verification.optionLabel}，${money(verification.purchaseCost)}元${verification.finalPricingError ? `；最终复价失败：${verification.finalPricingError}` : ""}`
          : verification?.status === "pending_human_review" ? `规格需复核：${verification.reason || "证据不足"}`
            : verification?.status === "failed" ? `规格核验失败：${verification.error || "未知错误"}`
              : "等待规格实价核验";
        resultCell.append(sku);
        if (verification?.finalPricingError) sku.className = "bad";
      }
    } else if (task?.sourcing?.aiLastError) {
      const title = document.createElement("strong"); title.className = "bad"; title.textContent = "AI判断失败";
      const reason = document.createElement("small"); reason.textContent = task.sourcing.aiLastError;
      resultCell.replaceChildren(title, reason);
    } else resultCell.textContent = eligible === true ? "达到18%" : eligible === false ? "低于18%" : "待AI判断";
    const actions = document.createElement("div"); actions.className = "row-actions";
    const judge = document.createElement("button"); judge.textContent = aiJudgementComplete(task) ? "重新AI判断" : "AI判断"; judge.disabled = !aiReady(task).ready || batch.running || aiBatch.running || skuBatch.running; judge.addEventListener("click", async () => { try { await judgeTask(task, judge); } catch {} }); actions.append(judge);
    if (aiRecommendsSameProduct(task) && !favoriteComplete(task)) {
      const favorite = document.createElement("button"); favorite.textContent = task?.sourcing?.favorite?.status === "favoriting" ? "收藏中" : "重试收藏"; favorite.disabled = batch.running || aiBatch.running || skuBatch.running || task?.sourcing?.favorite?.status === "favoriting"; favorite.addEventListener("click", async () => { await favoriteRecommendedCandidate(task, favorite); }); actions.append(favorite);
    }
    if (aiRecommendsSameProduct(task) && !skuVerificationComplete(task)) {
      const verifySku = document.createElement("button"); verifySku.textContent = "核验规格价"; verifySku.disabled = batch.running || aiBatch.running || skuBatch.running; verifySku.addEventListener("click", async () => { await verifyRecommendedSku(task, verifySku); }); actions.append(verifySku);
    }
    const save = document.createElement("button"); save.textContent = "手动确认并复价"; save.disabled = !ready.ready; save.addEventListener("click", async () => { await savePrice(task, price.value, link.value); }); actions.append(save); row.children[9].append(actions);
    return row;
  }));
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-ozon-agent": "local-ui-v1", ...(options.headers || {}) } });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || "操作失败");
    error.code = payload.code || "";
    error.details = payload;
    throw error;
  }
  return payload;
}

function pingFinalPricingBridge(timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const requestId = `ping-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("未检测到Ozon最终复价桥接；请在扩展管理页重新加载0.6.29后刷新本页。"));
    }, timeoutMs);
    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== "OZON_FINAL_REPRICE_READY_V1" || event.data?.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener("message", onMessage); resolve(event.data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "OZON_FINAL_REPRICE_PING_V1", requestId }, window.location.origin);
  });
}

async function requestFinalOzonPricing(task, timeoutMs = 90000) {
  await pingFinalPricingBridge();
  return new Promise((resolve, reject) => {
    const requestId = `ozon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Ozon最终复价超时；请确认0.6.29扩展已重新加载，然后重试。"));
    }, timeoutMs);
    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== "OZON_FINAL_REPRICE_RESPONSE_V1" || event.data?.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (!event.data?.ok) reject(new Error(event.data?.error || "Ozon最终复价失败"));
      else resolve(event.data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "OZON_FINAL_REPRICE_REQUEST_V1", requestId, task }, window.location.origin);
  });
}

async function commitPurchaseCostWithFinalPricing(task, purchaseCost, sourceUrl, verification, { batchMode = false } = {}) {
  const cost = Number(Number(purchaseCost).toFixed(2));
  task.sourcing = task.sourcing || {};
  task.pricing = task.pricing || {};
  task.audit = task.audit || {};
  if (!(Number(task.pricing.preliminaryMaxPurchaseCostAt18Pct) >= 0)) task.pricing.preliminaryMaxPurchaseCostAt18Pct = Number(task?.enrichment?.maxPurchaseCostAt18Pct);
  task.pricing.purchaseCost = cost;
  task.pricing.sourceUrl = String(sourceUrl || "").trim() || null;
  task.pricing.eligibleAt18Pct = null;
  if (verification) task.sourcing.skuVerification = verification;
  const decision = preliminaryPricingDecision(task, cost);
  if (decision.status === "rejected_preliminary") {
    task.pricing.eligibleAt18Pct = false;
    task.pricing.finalOzonPricing = {
      status: "rejected_preliminary",
      checkedAt: new Date().toISOString(),
      preliminaryMaxPurchaseCostAt18Pct: decision.preliminaryLimit,
      purchaseCost: cost,
      reason: "目标规格采购价已高于历史成本上限，按条件规则跳过Ozon实时复价。",
    };
    task.status = "pending_human_review";
    task.audit.updatedAt = new Date().toISOString();
    persistQueue(); render();
    if (!batchMode) setStatus(`SKU ${task.ozon.sku}：目标规格价${cost.toFixed(2)}元高于历史上限${decision.preliminaryLimit.toFixed(2)}元，已淘汰并跳过Ozon实时复价。`, "bad");
    return { eligibleAt18Pct: false, skippedFinalReprice: true };
  }
  if (decision.status !== "requires_final_reprice" && decision.cacheFresh) {
    task.pricing.eligibleAt18Pct = decision.eligible;
    persistQueue(); render();
    return { eligibleAt18Pct: decision.eligible, cacheHit: true };
  }
  task.pricing.finalOzonPricing = { status: "running", startedAt: new Date().toISOString(), purchaseCost: cost };
  persistQueue(); render();
  if (!batchMode) setStatus(`SKU ${task.ozon.sku}：规格实价通过历史上限，正在执行一次Ozon最终实时复价……`);
  try {
    const response = await requestFinalOzonPricing(task);
    const final = applyFinalOzonPricing(task, response, cost);
    task.status = "pending_human_review";
    task.audit.updatedAt = new Date().toISOString();
    persistQueue(); render();
    if (!batchMode) setStatus(`SKU ${task.ozon.sku}：最终成本上限${final.finalLimit.toFixed(2)}元，采购价${cost.toFixed(2)}元，${final.eligibleAt18Pct ? "达到" : "未达到"}18%利润门槛。`, final.eligibleAt18Pct ? "ok" : "bad");
    return final;
  } catch (error) {
    task.pricing.finalOzonPricing = { status: "failed", failedAt: new Date().toISOString(), purchaseCost: cost, error: error.message || String(error) };
    task.pricing.eligibleAt18Pct = null;
    persistQueue(); render();
    if (!batchMode) setStatus(`规格实价已保留，但Ozon最终复价失败：${error.message || error}`, "bad");
    throw error;
  }
}

async function verifyRecommendedSku(task, button = null, { batchMode = false } = {}) {
  if (!aiRecommendsSameProduct(task)) return { skipped: true };
  const candidate = resolveRecommendedCandidate(task);
  const sourceUrl = candidate?.sourceUrl || candidate?.detail?.sourceUrl || "";
  if (!sourceUrl) throw new Error("AI推荐候选缺少商品链接。");
  if (button) button.disabled = true;
  task.sourcing = task.sourcing || {};
  task.sourcing.skuVerification = { status: "reading_options", sourceUrl, startedAt: new Date().toISOString() };
  persistQueue(); render();
  if (!batchMode) setStatus(`SKU ${task.ozon.sku}：正在打开拼多多规格弹窗并读取规格实价……`);
  try {
    const captured = await api("/api/pinduoduo/sku-options", { method: "POST", body: JSON.stringify({ taskId: task.taskId, sourceUrl }) });
    if (captured.skuSheet.multiDimension) {
      task.sourcing.skuVerification = {
        status: "pending_human_review",
        sourceUrl,
        options: captured.skuSheet.options,
        reason: `检测到多规格维度（${captured.skuSheet.groups.join("、")}），当前安全版本不自动组合选择。`,
        updatedAt: new Date().toISOString(),
      };
      persistQueue(); render();
      if (!batchMode) setStatus(`SKU ${task.ozon.sku}：检测到多规格维度，已保留规格列表并转人工复核。`, "bad");
      return { ok: false, needsHumanReview: true };
    }
    const ai = await api("/api/ai/select-sku", { method: "POST", body: JSON.stringify({ task, candidate, skuSheet: captured.skuSheet }) });
    const selected = captured.skuSheet.options.find((option) => option.optionId === ai.selection.selectedOptionId) || null;
    if (ai.selection.needsHumanReview || !selected) {
      task.sourcing.skuVerification = {
        status: "pending_human_review",
        sourceUrl,
        options: captured.skuSheet.options,
        selection: ai.selection,
        reason: ai.selection.reason || "AI无法确认完全一致的规格",
        updatedAt: new Date().toISOString(),
      };
      persistQueue(); render();
      if (!batchMode) setStatus(`SKU ${task.ozon.sku}：规格无法自动确认，已保留${captured.skuSheet.options.length}个规格供人工复核。`, "bad");
      return { ok: false, needsHumanReview: true };
    }
    const confirmed = await api("/api/pinduoduo/select-sku", { method: "POST", body: JSON.stringify({ taskId: task.taskId, sourceUrl, optionId: selected.optionId, optionLabel: selected.label }) });
    if (candidate?.detail?.shippingFee !== 0) throw new Error("目标规格已确认，但商品运费不是明确包邮，暂不写入采购成本。");
    const purchaseCost = Number(confirmed.stableUnitPrice);
    const verification = {
      status: "sku_price_verified",
      sourceUrl: confirmed.sourceUrl || sourceUrl,
      candidateId: candidate?.candidateId || null,
      optionId: confirmed.selectedOption.optionId,
      optionLabel: confirmed.selectedOption.label,
      optionPrice: purchaseCost,
      shippingFee: 0,
      purchaseCost,
      aiSelection: ai.selection,
      accountSpecificDiscountIgnored: Boolean(confirmed.accountSpecificDiscountIgnored),
      submitPriceIgnored: confirmed.submitPriceIgnored,
      verifiedAt: confirmed.verifiedAt || new Date().toISOString(),
    };
    task.sourcing.skuVerification = verification;
    persistQueue(); render();
    const result = await commitPurchaseCostWithFinalPricing(task, purchaseCost, sourceUrl, verification, { batchMode });
    return { ok: true, purchaseCost, ...result };
  } catch (error) {
    const priceAlreadyVerified = task?.sourcing?.skuVerification?.status === "sku_price_verified";
    task.sourcing.skuVerification = priceAlreadyVerified
      ? { ...task.sourcing.skuVerification, finalPricingError: error.message || String(error) }
      : { ...task.sourcing.skuVerification, status: error.code === "PINDUODUO_RISK_CONTROL" ? "paused_risk_control" : "failed", error: error.message || String(error), failedAt: new Date().toISOString() };
    persistQueue(); render();
    if (!batchMode) setStatus(error.message || String(error), "bad");
    return { ok: false, priceVerified: priceAlreadyVerified, riskControl: error.code === "PINDUODUO_RISK_CONTROL", error: error.message || String(error) };
  } finally {
    if (button) button.disabled = false;
  }
}

async function checkDevice() {
  try {
    setStatus("正在检查MuMu和拼多多……");
    const result = await api("/api/status");
    const status = result.status;
    setStatus(`MuMu：${status.androidStarted || status.bootCompleted ? "安卓已启动" : "未启动"}；拼多多：${status.pinduoduoInstalled ? "已安装" : "未检测到或设备未启动"}`, status.bootCompleted && status.pinduoduoInstalled ? "ok" : "bad");
  } catch (error) { setStatus(error.message, "bad"); }
}

async function checkAiStatus() {
  try {
    const result = await api("/api/ai/status");
    $("modelStatus").textContent = result.status.configured ? `${appVersion} · ${result.status.model}已配置` : `${appVersion} · ${result.status.model}待配置密钥`;
    $("modelStatus").className = result.status.configured ? "ok" : "bad";
    return result.status;
  } catch {
    $("modelStatus").textContent = `${appVersion} · AI状态检查失败`;
    $("modelStatus").className = "bad";
    return null;
  }
}

async function searchTask(task, button = null, { batchMode = false } = {}) {
  if (button) button.disabled = true;
  try {
    if (!batchMode) setStatus(`SKU ${task.ozon.sku}：正在下发主图并执行拼多多以图搜索……`);
    const result = await api("/api/task/search", { method: "POST", body: JSON.stringify({ taskId: task.taskId, mainImageUrl: task.enrichment.mainImageUrl }) });
    task.sourcing = task.sourcing || {};
    task.sourcing.devicePreparation = { status: "completed", remoteImagePath: result.remotePath, completedAt: new Date().toISOString() };
    task.sourcing.searchCandidates = result.candidates;
    task.sourcing.searchTiming = result.timing || null;
    task.sourcing.aiJudgement = null;
    task.sourcing.judgeProvider = null;
    task.sourcing.judgeResult = null;
    const detailCandidates = result.candidates.filter((candidate) => candidate?.detail?.detailStatus === "detail_captured");
    task.sourcing.suggestedCandidate = [...(detailCandidates.length ? detailCandidates : result.candidates)].sort((left, right) => Number(left?.detail?.displayedPrice ?? left.displayedPrice) - Number(right?.detail?.displayedPrice ?? right.displayedPrice))[0] || null;
    task.sourcing.status = detailCandidates.length ? "candidate_details_captured_pending_verification" : "candidates_found_pending_verification";
    task.sourcing.searchCompletedAt = detailCandidates.length ? new Date().toISOString() : null;
    const linkedPartialCount = result.candidates.filter((candidate) => candidate?.detail?.detailStatus === "detail_partial" && candidate?.sourceUrl).length;
    task.sourcing.searchLastError = detailCandidates.length ? null : linkedPartialCount ? `已保留${linkedPartialCount}个候选链接，详情字段待重试` : "未取得任何完整候选详情";
    persistQueue();
    if (!batchMode) setStatus(`${result.message}${linkedPartialCount ? ` 已先保留${linkedPartialCount}个候选链接。` : ""} 已记录候选详情价和链接；确认规格与优惠条件后再写入采购价。`, detailCandidates.length ? "ok" : "bad");
    render();
    if (!detailCandidates.length) throw new Error(linkedPartialCount
      ? `已保留${linkedPartialCount}个可打开候选链接，但详情字段尚未完整，可直接查看或稍后重试。`
      : "未取得任何完整候选详情，可稍后重试。");
    return result;
  } catch (error) {
    task.sourcing = task.sourcing || {};
    const riskControl = error.code === "PINDUODUO_RISK_CONTROL";
    task.sourcing.status = riskControl ? "paused_risk_control" : "search_failed_retryable";
    task.sourcing.searchLastError = error.message || String(error);
    task.sourcing.searchFailedAt = new Date().toISOString();
    if (error?.details?.timing) task.sourcing.searchTiming = error.details.timing;
    task.sourcing.riskControl = riskControl ? { ...(error.details?.risk || {}), detectedAt: new Date().toISOString() } : null;
    persistQueue();
    if (!batchMode) setStatus(error.message, "bad");
    if (button) button.disabled = false;
    render();
    throw error;
  }
}

async function openCandidateInApp(task, candidate, button = null) {
  const sourceUrl = candidate?.sourceUrl || candidate?.detail?.sourceUrl || "";
  if (!sourceUrl) return;
  if (button) { button.disabled = true; button.textContent = "正在MuMu中打开……"; }
  setStatus(`SKU ${task?.ozon?.sku || "-"}：正在MuMu拼多多App中打开候选商品……`);
  try {
    const result = await api("/api/pinduoduo/open", { method: "POST", body: JSON.stringify({ taskId: task.taskId, sourceUrl }) });
    if (button) button.textContent = "App已打开";
    setStatus(`SKU ${task?.ozon?.sku || "-"}：${result.message || "已在拼多多App中打开候选商品。"}`, "ok");
  } catch (error) {
    if (button) button.textContent = "打开失败，重试";
    setStatus(error.message || String(error), "bad");
  } finally {
    if (button) button.disabled = batch.running || aiBatch.running;
  }
}

async function favoriteRecommendedCandidate(task, button = null, { batchMode = false } = {}) {
  if (!aiRecommendsSameProduct(task)) return { skipped: true };
  const candidate = resolveRecommendedCandidate(task);
  const sourceUrl = candidate?.sourceUrl || candidate?.detail?.sourceUrl || "";
  if (!sourceUrl) {
    task.sourcing.favorite = { status: "failed", error: "AI推荐候选缺少商品链接。", attemptedAt: new Date().toISOString() };
    persistQueue(); render();
    if (!batchMode) setStatus(task.sourcing.favorite.error, "bad");
    return { ok: false, error: task.sourcing.favorite.error };
  }
  const current = task?.sourcing?.favorite;
  if (current?.status === "favorited" && current?.sourceUrl === sourceUrl) return { ok: true, alreadyFavorited: current.alreadyFavorited };
  if (button) button.disabled = true;
  task.sourcing.favorite = {
    status: "favoriting",
    candidateId: candidate?.candidateId || null,
    candidateIndex: Number(task?.sourcing?.aiJudgement?.bestCandidateIndex) || null,
    sourceUrl,
    attemptedAt: new Date().toISOString(),
  };
  persistQueue(); render();
  if (!batchMode) setStatus(`SKU ${task?.ozon?.sku || "-"}：AI已推荐同款，正在加入拼多多收藏……`);
  try {
    const result = await api("/api/pinduoduo/favorite", { method: "POST", body: JSON.stringify({ taskId: task.taskId, sourceUrl }) });
    task.sourcing.favorite = { ...task.sourcing.favorite, status: "favorited", goodsId: result.goodsId, sourceUrl: result.sourceUrl || sourceUrl, alreadyFavorited: Boolean(result.alreadyFavorited), error: null, favoritedAt: new Date().toISOString() };
    persistQueue(); render();
    if (!batchMode) setStatus(`SKU ${task?.ozon?.sku || "-"}：${result.message || "推荐同款已收藏。"}`, "ok");
    return { ok: true, ...result };
  } catch (error) {
    const riskControl = error.code === "PINDUODUO_RISK_CONTROL";
    task.sourcing.favorite = { ...task.sourcing.favorite, status: riskControl ? "paused_risk_control" : "failed", error: error.message || String(error), failedAt: new Date().toISOString() };
    persistQueue(); render();
    if (!batchMode) setStatus(task.sourcing.favorite.error, "bad");
    return { ok: false, riskControl, error: task.sourcing.favorite.error };
  } finally {
    if (button) button.disabled = false;
  }
}

async function judgeTask(task, button = null, { batchMode = false } = {}) {
  if (button) button.disabled = true;
  try {
    if (!batchMode) setStatus(`SKU ${task?.ozon?.sku || "-"}：正在由千问判断前3个候选……`);
    const result = await api("/api/ai/judge", { method: "POST", body: JSON.stringify(task) });
    task.sourcing = task.sourcing || {};
    task.sourcing.aiJudgement = { ...result.judgement, provider: result.provider, model: result.model, usage: result.usage, judgedAt: result.judgedAt };
    task.sourcing.judgeProvider = result.provider;
    task.sourcing.judgeResult = task.sourcing.aiJudgement;
    delete task.sourcing.aiLastError;
    delete task.sourcing.aiFailedAt;
    task.sourcing.status = result.judgement.needsHumanReview ? "pending_human_review" : "ai_match_recommended_pending_confirmation";
    task.status = "pending_human_review";
    task.audit = task.audit || {};
    task.audit.updatedAt = new Date().toISOString();
    persistQueue(); render();
    const favoriteResult = await favoriteRecommendedCandidate(task, null, { batchMode });
    if (aiRecommendsSameProduct(task)) await verifyRecommendedSku(task, null, { batchMode });
    else if (!batchMode && favoriteResult?.skipped) setStatus(`SKU ${task?.ozon?.sku || "-"}：AI判断完成，${result.judgement.confidence}%置信度；未达到自动规格核验条件。`, result.judgement.verdict === "same_product" ? "ok" : "bad");
    return result;
  } catch (error) {
    task.sourcing = task.sourcing || {};
    task.sourcing.aiLastError = error.message || String(error);
    task.sourcing.aiFailedAt = new Date().toISOString();
    persistQueue(); render();
    if (!batchMode) setStatus(error.message, "bad");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function runSkuBatch() {
  if (!queue || batch.running || aiBatch.running || skuBatch.running) return;
  skuBatch.running = true; skuBatch.completed = 0; skuBatch.failed = 0; render();
  try {
    const tasks = queue.tasks || [];
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      if (!aiRecommendsSameProduct(task) || skuVerificationComplete(task)) continue;
      setStatus(`批量规格核验与最终复价 ${index + 1}/${tasks.length}：SKU ${task?.ozon?.sku || "-"}`);
      const result = await verifyRecommendedSku(task, null, { batchMode: true });
      if (result?.ok) skuBatch.completed += 1;
      else {
        skuBatch.failed += 1;
        if (result?.riskControl) break;
      }
    }
  } finally {
    skuBatch.running = false; persistQueue(); render();
    setStatus(`批量规格核验与最终复价完成：成功${skuBatch.completed}件，需复核或失败${skuBatch.failed}件。只有规格实价通过历史上限的商品才执行Ozon实时复价。`, skuBatch.failed ? "bad" : "ok");
  }
}

async function runAiBatch() {
  if (!queue || aiBatch.running || batch.running) return;
  const tasks = queue.tasks || [];
  aiBatch.running = true; aiBatch.completed = 0; aiBatch.failed = 0; aiBatch.riskPaused = false; aiBatch.pauseReason = ""; render();
  try {
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      if (!aiReady(task).ready) continue;
      const needsFavorite = aiRecommendsSameProduct(task) && !favoriteComplete(task);
      if (aiJudgementComplete(task) && !needsFavorite) continue;
      setStatus(`批量AI判断与收藏 ${index + 1}/${tasks.length}：SKU ${task?.ozon?.sku || "-"}`);
      try {
        if (!aiJudgementComplete(task)) await judgeTask(task, null, { batchMode: true });
        else await favoriteRecommendedCandidate(task, null, { batchMode: true });
        if (task?.sourcing?.favorite?.status === "paused_risk_control") {
          aiBatch.riskPaused = true; aiBatch.pauseReason = task.sourcing.favorite.error || "拼多多风控"; break;
        }
        aiBatch.completed += 1;
      } catch { aiBatch.failed += 1; }
    }
  } finally {
    aiBatch.running = false; persistQueue(); render();
    if (aiBatch.riskPaused) setStatus(`批量AI判断与收藏已暂停：${aiBatch.pauseReason}。人工处理后再次点击批量按钮即可继续。`, "bad");
    else setStatus(`批量AI判断与收藏完成：处理${aiBatch.completed}件，失败${aiBatch.failed}件；明确推荐同款已自动收藏，采购规格和实付价仍需确认。`, aiBatch.failed ? "bad" : "ok");
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

async function savePrice(task, value, sourceUrl) {
  const purchaseCost = Number(value);
  if (!(purchaseCost > 0)) return setStatus("采购价必须大于0。", "bad");
  if (!(Number(task?.enrichment?.maxPurchaseCostAt18Pct) >= 0)) return setStatus("该任务缺少历史18%最高采购成本。", "bad");
  const verification = {
    status: "manual_price_confirmed",
    sourceUrl: String(sourceUrl || "").trim() || null,
    purchaseCost: Number(purchaseCost.toFixed(2)),
    reason: "由人工确认目标规格常规价",
    verifiedAt: new Date().toISOString(),
  };
  try { await commitPurchaseCostWithFinalPricing(task, verification.purchaseCost, verification.sourceUrl, verification); }
  catch { /* 规格价和复价失败状态已分别持久化并显示。 */ }
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
$("aiBatchStart").addEventListener("click", () => { void runAiBatch(); });
$("skuBatchStart").addEventListener("click", () => { void runSkuBatch(); });
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
void checkAiStatus();
