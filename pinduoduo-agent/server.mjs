import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PINDUODUO_PACKAGE, candidateInspectionOrder, detectPinduoduoRiskPage, extractPinduoduoCandidates, extractPinduoduoDetail, extractPinduoduoSkuSheet, findUiNode, isTrustedOzonImageUrl, parseMumuInfo, parsePinduoduoRoute, parseUiNodes, pinduoduoFavoriteState, pinduoduoProductGoodsId, reconcilePinduoduoDisplayedPrice, safeTaskFileName } from "./core.mjs";
import { judgeTaskWithQwen, qwenStatus, selectSkuOptionWithQwen } from "./qwen-client.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(moduleDir, "public");
const runtimeDir = path.join(moduleDir, "runtime");
const managerPath = "E:\\Program Files\\Netease\\MuMu\\nx_main\\MuMuManager.exe";
const adbPath = "E:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe";
const adbSerial = "127.0.0.1:16384";
const host = "127.0.0.1";
const port = Number(process.env.OZON_PDD_AGENT_PORT) || 17628;
const localUiHeader = "local-ui-v1";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createTimingTrace() {
  return { startedAt: new Date().toISOString(), startedAtMs: Date.now(), stages: [] };
}

function timingSnapshot(trace, status = "completed") {
  if (!trace) return null;
  return {
    status,
    startedAt: trace.startedAt,
    completedAt: new Date().toISOString(),
    totalMs: Math.max(0, Date.now() - trace.startedAtMs),
    stages: trace.stages.slice(0, 40),
  };
}

async function timed(trace, label, action) {
  if (!trace) return action();
  const startedAt = Date.now();
  try {
    const value = await action();
    trace.stages.push({ label, durationMs: Date.now() - startedAt, status: "ok" });
    return value;
  } catch (error) {
    trace.stages.push({ label, durationMs: Date.now() - startedAt, status: "error", error: String(error?.message || error).slice(0, 160) });
    throw error;
  }
}

class PinduoduoRiskControlError extends Error {
  constructor(risk) {
    super(`检测到拼多多风控页面（${risk.type}），批量任务已暂停，请人工处理后再继续。`);
    this.code = "PINDUODUO_RISK_CONTROL";
    this.risk = risk;
  }
}

function assertNoPinduoduoRisk(nodes) {
  const risk = detectPinduoduoRiskPage(nodes);
  if (risk.blocked) throw new PinduoduoRiskControlError(risk);
}

function run(executable, args, { timeoutMs = 20000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`命令执行超时：${path.basename(executable)}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const outputBuffer = Buffer.concat(stdout);
      const output = binary ? outputBuffer : outputBuffer.toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) reject(new Error(errorOutput || output || `命令失败，退出码${code}`));
      else resolve({ output, errorOutput });
    });
  });
}

async function manager(args, options) {
  try {
    await fs.access(managerPath);
  } catch {
    throw new Error(`未找到MuMu控制器：${managerPath}`);
  }
  return run(managerPath, args, options);
}

async function adb(args, options) {
  try {
    await fs.access(adbPath);
  } catch {
    throw new Error(`未找到MuMu ADB：${adbPath}`);
  }
  const connected = await run(adbPath, ["connect", adbSerial], { timeoutMs: 10000 });
  if (!/connected to|already connected to/i.test(connected.output || "")) throw new Error(`无法连接MuMu安卓设备：${connected.output || "未知错误"}`);
  return run(adbPath, ["-s", adbSerial, ...args], options);
}

async function deviceStatus() {
  const info = parseMumuInfo((await manager(["info", "-v", "0"])).output);
  let pinduoduoInstalled = false;
  let bootCompleted = false;
  if (info.processStarted || info.androidStarted) {
    const boot = await manager(["sh", "-v", "0", "-c", "getprop sys.boot_completed"]).catch(() => ({ output: "" }));
    bootCompleted = boot.output.trim() === "1";
    const app = await manager(["sh", "-v", "0", "-c", `pm path ${PINDUODUO_PACKAGE}`]).catch(() => ({ output: "" }));
    pinduoduoInstalled = /package:/i.test(app.output);
  }
  return { managerFound: true, ...info, bootCompleted, pinduoduoInstalled, packageName: PINDUODUO_PACKAGE };
}

async function downloadTaskImage(taskId, imageUrl) {
  if (!isTrustedOzonImageUrl(imageUrl)) throw new Error("主图不是受信任的Ozon图片地址。");
  const response = await fetch(imageUrl, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`主图下载失败：HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("主图地址返回的不是图片。");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("主图文件为空或超过15MB。");
  await fs.mkdir(runtimeDir, { recursive: true });
  const fileName = `${safeTaskFileName(taskId)}.jpg`;
  const localPath = path.join(runtimeDir, fileName);
  await fs.writeFile(localPath, bytes);
  return { localPath, fileName, bytes: bytes.length };
}

async function prepareTask(body, trace = null) {
  const taskId = String(body.taskId || "").trim();
  const imageUrl = String(body.mainImageUrl || "").trim();
  if (!taskId) throw new Error("缺少任务ID。");
  const status = await timed(trace, "检查MuMu与拼多多", () => deviceStatus());
  if (!status.bootCompleted) throw new Error("MuMu安卓设备尚未启动完成。");
  if (!status.pinduoduoInstalled) throw new Error("MuMu中未检测到拼多多。");
  const image = await timed(trace, "下载Ozon主图", () => downloadTaskImage(taskId, imageUrl));
  const remoteDir = "/sdcard/Pictures/OzonSourcing";
  const remotePath = `${remoteDir}/${image.fileName}`;
  await timed(trace, "创建模拟器相册目录", () => adb(["shell", "mkdir", "-p", remoteDir]));
  await timed(trace, "下发主图到MuMu", () => adb(["push", image.localPath, remotePath], { timeoutMs: 30000 }));
  await timed(trace, "刷新MuMu相册", () => adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file://${remotePath}`]));
  await timed(trace, "启动拼多多", () => manager(["control", "-v", "0", "app", "launch", "-pkg", PINDUODUO_PACKAGE]));
  return { ok: true, taskId, remotePath, imageBytes: image.bytes, message: "主图已下发到模拟器并启动拼多多。" };
}

function isTransientUiCaptureError(error) {
  return /(?:退出码|exit code)\s*137\b/i.test(String(error?.message || error));
}

async function captureUiOnce() {
  await adb(["shell", "uiautomator", "dump", "/sdcard/ozon-agent-window.xml"]).catch((error) => {
    if (!/dumped to:/i.test(error.message || "")) throw error;
  });
  const xml = (await adb(["exec-out", "cat", "/sdcard/ozon-agent-window.xml"])).output;
  const nodes = parseUiNodes(xml);
  assertNoPinduoduoRisk(nodes);
  return { nodes, cameraSearch: findUiNode(nodes, ["拍照搜索", "图片搜索"]), capturedAt: new Date().toISOString() };
}

async function captureUi() {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await captureUiOnce();
    } catch (error) {
      lastError = error;
      if (!isTransientUiCaptureError(error) || attempt === 3) throw error;
      await delay(attempt * 600);
    }
  }
  throw lastError;
}

async function clickNamedUi(body) {
  const terms = Array.isArray(body.terms) ? body.terms : [];
  if (!terms.length) throw new Error("缺少要点击的控件名称。");
  const ui = await captureUi();
  const node = findUiNode(ui.nodes, terms);
  if (!node?.bounds) throw new Error(`当前页面未找到控件：${terms.join("/")}`);
  const [left, top, right, bottom] = node.bounds;
  await adb(["shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))]);
  return { ok: true, node, message: `已点击：${node.description || node.text}` };
}

async function tapBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) throw new Error("控件缺少有效点击区域。");
  const [left, top, right, bottom] = bounds;
  await adb(["shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))]);
}

async function waitForUiNode(terms, timeoutMs = 12000) {
  const startedAt = Date.now();
  let lastUi = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastUi = await captureUi();
    const node = findUiNode(lastUi.nodes, terms);
    if (node) return { node, ui: lastUi };
    await delay(500);
  }
  return { node: null, ui: lastUi };
}

function findUiNodeContaining(nodes, terms) {
  const wanted = (Array.isArray(terms) ? terms : [terms]).map((term) => String(term || "").trim()).filter(Boolean);
  const candidates = (nodes || []).filter((node) => wanted.some((term) => String(node.text || node.description || "").includes(term)));
  const area = (node) => node.bounds ? Math.max(0, node.bounds[2] - node.bounds[0]) * Math.max(0, node.bounds[3] - node.bounds[1]) : Number.MAX_SAFE_INTEGER;
  return candidates.sort((left, right) => Number(right.clickable) - Number(left.clickable) || area(left) - area(right))[0] || null;
}

async function closeSkuSheet() {
  const ui = await captureUi().catch(() => null);
  const sheet = ui ? extractPinduoduoSkuSheet(ui.nodes) : null;
  const hasPurchaseOverlay = Boolean(ui && (sheet?.selectedText || Number(sheet?.submitPrice) > 0 || findUiNodeContaining(ui.nodes, ["提交订单", "已选:", "已选："])));
  const close = hasPurchaseOverlay ? findUiNode(ui?.nodes, ["关闭"]) : null;
  if (close?.bounds) await tapBounds(close.bounds);
  if (close?.bounds) await delay(350);
  return Boolean(close?.bounds);
}

async function waitForSkuSheet(timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastSheet = { status: "sku_options_missing", options: [] };
  let lastUi = null;
  while (Date.now() - startedAt < timeoutMs) {
    const ui = await captureUi();
    lastUi = ui;
    lastSheet = extractPinduoduoSkuSheet(ui.nodes);
    if (lastSheet.options.length) return { ui, sheet: lastSheet };
    if (findUiNodeContaining(ui.nodes, ["提交订单"])) return { ui, sheet: lastSheet };
    await delay(400);
  }
  return { ui: lastUi, sheet: lastSheet };
}

async function openSkuSheet(sourceUrl) {
  const opened = await openCandidateDetail({ sourceUrl });
  const ui = await captureUi();
  const purchase = ["免拼购买", "直接拼成", "单独购买"].map((term) => findUiNodeContaining(ui.nodes, [term])).find(Boolean);
  if (!purchase?.bounds) throw new Error("商品详情页未加载出安全的规格选择入口。");
  await tapBounds(purchase.bounds);
  const captured = await waitForSkuSheet(10000);
  if (!captured.sheet.options.length) {
    const diagnostic = await saveSkuDiagnostic(captured.ui, captured.sheet, "sku_options_missing").catch(() => null);
    await closeSkuSheet();
    const pageHint = captured.sheet.selectedText || captured.sheet.submitVisible
      ? "购买页存在“已选/提交订单”信号，可能是单一规格，也可能是规格控件未向系统暴露"
      : "购买页没有暴露可识别的规格控件";
    const diagnosticHint = diagnostic ? `；诊断已保存到${diagnostic.jsonPath}和${diagnostic.screenshotPath}` : "";
    throw new Error(`已打开购买页，但未读取到可选规格；${pageHint}。程序未点击提交订单，请人工确认该商品是否为单一规格${diagnosticHint}。`);
  }
  return { ...opened, ...captured };
}

async function captureSkuOptions(body = {}) {
  const opened = await openSkuSheet(String(body.sourceUrl || "").trim());
  const evidence = await captureScreenshot().catch(() => null);
  await closeSkuSheet();
  return {
    ok: true,
    status: "sku_options_captured",
    goodsId: opened.goodsId,
    sourceUrl: opened.sourceUrl,
    skuSheet: opened.sheet,
    evidencePath: evidence?.localPath || null,
    message: `已读取${opened.sheet.options.length}个可选规格；尚未触发下单。`,
  };
}

async function selectSkuOption(body = {}) {
  const optionId = String(body.optionId || "").trim();
  const expectedLabel = String(body.optionLabel || "").trim();
  if (!optionId) throw new Error("缺少要核验的规格编号。");
  const opened = await openSkuSheet(String(body.sourceUrl || "").trim());
  const option = opened.sheet.options.find((entry) => entry.optionId === optionId);
  if (!option?.bounds || (expectedLabel && option.label !== expectedLabel)) {
    await closeSkuSheet();
    throw new Error("规格弹窗已变化，未找到AI选择的规格；请重新读取规格。");
  }
  await tapBounds(option.bounds);
  let verified = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 6000) {
    const ui = await captureUi();
    const sheet = extractPinduoduoSkuSheet(ui.nodes);
    if (sheet.selectedText && (sheet.selectedText.includes(option.label) || option.label.includes(sheet.selectedText))) {
      verified = sheet;
      break;
    }
    await delay(350);
  }
  const evidence = await captureScreenshot().catch(() => null);
  await closeSkuSheet();
  if (!verified) throw new Error("已点击规格，但未能从页面确认“已选”规格一致；未写入采购价。");
  return {
    ok: true,
    status: "sku_price_verified",
    goodsId: opened.goodsId,
    sourceUrl: opened.sourceUrl,
    selectedOption: { optionId: option.optionId, label: option.label, price: option.price, rawText: option.rawText },
    stableUnitPrice: option.price,
    accountSpecificDiscountIgnored: Boolean(verified.accountSpecificDiscountVisible),
    submitPriceIgnored: verified.submitPrice,
    evidencePath: evidence?.localPath || null,
    verifiedAt: new Date().toISOString(),
    message: `已确认规格“${option.label}”常规标价${option.price.toFixed(2)}元；未使用账号余额优惠，未提交订单。`,
  };
}

async function startImageSearch(trace = null) {
  await timed(trace, "重置拼多多页面", () => adb(["shell", "am", "force-stop", PINDUODUO_PACKAGE]));
  await timed(trace, "启动拼多多首页", () => adb(["shell", "monkey", "-p", PINDUODUO_PACKAGE, "-c", "android.intent.category.LAUNCHER", "1"]));
  const camera = await timed(trace, "等待拍照搜索入口", () => waitForUiNode(["拍照搜索", "图片搜索"], 12000));
  if (!camera.node?.bounds) throw new Error("拼多多首页未加载出拍照搜索按钮。");
  await timed(trace, "点击拍照搜索入口", () => tapBounds(camera.node.bounds));
  await timed(trace, "打开相册缓冲", () => delay(250));
  const sizeOutput = (await timed(trace, "读取MuMu屏幕尺寸", () => adb(["shell", "wm", "size"]))).output;
  const size = /(\d+)x(\d+)/.exec(sizeOutput);
  const width = Number(size?.[1]) || 900;
  const height = Number(size?.[2]) || 1600;
  await timed(trace, "选择最新主图", () => adb(["shell", "input", "tap", String(Math.round(width / 8)), String(Math.round(height - height * 0.105))]));
  const result = await timed(trace, "等待以图搜索结果", () => waitForUiNode(["搜图片同款"], 15000));
  if (!result.node) throw new Error("已进入拍照搜索，但未能选中最新主图或结果页未加载。");
  const candidates = extractPinduoduoCandidates(result.ui.nodes);
  if (!candidates.length) throw new Error("拼多多以图搜结果已打开，但当前屏未读取到候选价格。");
  return { candidates, visibleCount: candidates.length, message: `已读取当前屏${candidates.length}个拼多多同款候选。` };
}

async function captureCurrentRoute() {
  const output = (await adb(["shell", "dumpsys", "activity", "top"], { timeoutMs: 15000 })).output;
  return parsePinduoduoRoute(output);
}

async function waitForCandidateDetail(timeoutMs = 12000) {
  const startedAt = Date.now();
  let bestDetail = null;
  while (Date.now() - startedAt < timeoutMs) {
    const ui = await captureUi();
    if (findUiNode(ui.nodes, ["搜图片同款"])) {
      await delay(500);
      continue;
    }
    const route = await captureCurrentRoute();
    const current = extractPinduoduoDetail(ui.nodes, route);
    const merged = {
      ...(bestDetail || {}),
      ...current,
      title: current.title || bestDetail?.title || "",
      displayedPrice: current.displayedPrice || bestDetail?.displayedPrice || null,
      rawPriceText: current.rawPriceText || bestDetail?.rawPriceText || "",
      goodsId: current.goodsId || bestDetail?.goodsId || "",
      sourceUrl: current.sourceUrl || bestDetail?.sourceUrl || "",
      thumbnailUrl: current.thumbnailUrl || bestDetail?.thumbnailUrl || "",
      shippingIncluded: Boolean(current.shippingIncluded || bestDetail?.shippingIncluded),
      shippingFee: current.shippingFee === 0 || bestDetail?.shippingFee === 0 ? 0 : null,
      visibleLabels: [...new Set([...(bestDetail?.visibleLabels || []), ...(current.visibleLabels || [])])].slice(0, 20),
    };
    merged.missingFields = [
      ...(!merged.goodsId ? ["goods_id"] : []),
      ...(!merged.title ? ["title"] : []),
      ...(!(Number(merged.displayedPrice) > 0) ? ["price"] : []),
    ];
    merged.detailStatus = merged.missingFields.length === 0 ? "detail_captured" : merged.goodsId ? "detail_partial" : "detail_incomplete";
    bestDetail = merged;
    if (bestDetail.detailStatus === "detail_captured") return bestDetail;
    await delay(500);
  }
  return bestDetail;
}

async function returnToSearchResults(maxBackPresses = 3) {
  for (let attempt = 0; attempt <= maxBackPresses; attempt += 1) {
    await closeSkuSheet();
    const ui = await captureUi();
    if (findUiNode(ui.nodes, ["搜图片同款"])) return ui;
    if (attempt < maxBackPresses) {
      await adb(["shell", "input", "keyevent", "4"]);
      await delay(700);
    }
  }
  throw new Error("候选详情核验后未能返回拼多多以图搜索结果页。");
}

async function captureCandidateEvidence(taskId, candidateId, goodsId) {
  const screenshot = (await adb(["exec-out", "screencap", "-p"], { binary: true, timeoutMs: 10000 })).output;
  if (!screenshot.length || screenshot.length > 15 * 1024 * 1024) throw new Error("候选详情截图为空或超过15MB。");
  const taskDirName = safeTaskFileName(taskId);
  const evidenceDir = path.join(runtimeDir, "evidence", taskDirName);
  await fs.mkdir(evidenceDir, { recursive: true });
  const fileName = `${safeTaskFileName(candidateId)}-${safeTaskFileName(goodsId)}.png`;
  const localPath = path.join(evidenceDir, fileName);
  await fs.writeFile(localPath, screenshot);
  const relativePath = path.relative(runtimeDir, localPath).split(path.sep).join("/");
  return {
    status: "captured",
    type: "pinduoduo_detail_screenshot",
    localRef: `/api/evidence/${encodeURIComponent(relativePath)}`,
    bytes: screenshot.length,
    capturedAt: new Date().toISOString(),
  };
}

async function inspectCandidateDetail(taskId, candidate, index, maxAttempts = 2, trace = null) {
  let lastError = "";
  let bestPartial = null;
  let bestObserved = null;
  let bestPartialEvidence = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resultUi = await timed(trace, `候选${index + 1}返回搜索页（第${attempt}次）`, () => returnToSearchResults());
      const currentCandidates = extractPinduoduoCandidates(resultUi.nodes);
      const current = currentCandidates.find((entry) => entry.title === candidate.title && entry.displayedPrice === candidate.displayedPrice)
        || currentCandidates.find((entry) => entry.title === candidate.title)
        || candidate;
      await timed(trace, `打开候选${index + 1}详情（第${attempt}次）`, () => tapBounds(current.bounds));
      const detail = await timed(trace, `候选${index + 1}详情读取（第${attempt}次）`, () => waitForCandidateDetail(12000));
      if (detail && (!bestObserved || (detail.missingFields?.length || 3) < (bestObserved.missingFields?.length || 3))) bestObserved = detail;
      if (detail?.sourceUrl && (!bestPartial || (detail.missingFields?.length || 3) < (bestPartial.missingFields?.length || 3))) {
        bestPartial = detail;
        bestPartialEvidence = await timed(trace, `保存候选${index + 1}部分证据图`, () => captureCandidateEvidence(taskId, candidate.candidateId || `candidate-${index + 1}`, detail.goodsId))
          .catch((error) => ({ status: "capture_failed", error: error.message || String(error), capturedAt: new Date().toISOString() }));
      }
      if (!detail || detail.detailStatus !== "detail_captured") {
        const missing = detail?.missingFields?.length ? detail.missingFields.join(",") : "unknown";
        throw new Error(`候选详情未完整加载，缺少字段：${missing}`);
      }
      const reconciledPrice = reconcilePinduoduoDisplayedPrice(current.displayedPrice, detail.displayedPrice, detail.rawPriceText);
      const evidence = await timed(trace, `保存候选${index + 1}证据图`, () => captureCandidateEvidence(taskId, candidate.candidateId || `candidate-${index + 1}`, detail.goodsId))
        .catch((error) => ({ status: "capture_failed", error: error.message || String(error), capturedAt: new Date().toISOString() }));
      return { ...candidate, bounds: current.bounds, priceBounds: current.priceBounds, sourceUrl: detail.sourceUrl, detail: { ...detail, ...reconciledPrice, attemptCount: attempt }, evidence };
    } catch (error) {
      if (error?.code === "PINDUODUO_RISK_CONTROL") throw error;
      lastError = error.message || String(error);
    } finally {
      try {
        await timed(trace, `候选${index + 1}详情后返回搜索页（第${attempt}次）`, () => returnToSearchResults());
      } catch (error) {
        if (error?.code === "PINDUODUO_RISK_CONTROL") throw error;
        lastError = lastError || error.message || String(error);
      }
    }
    if (attempt < maxAttempts) await timed(trace, `候选${index + 1}重试缓冲`, () => delay(700 + Math.floor(Math.random() * 500)));
  }
  if (bestPartial?.sourceUrl) {
    return {
      ...candidate,
      sourceUrl: bestPartial.sourceUrl,
      detail: { ...bestPartial, detailStatus: "detail_partial", error: lastError, attemptCount: maxAttempts },
      evidence: bestPartialEvidence,
    };
  }
  return { ...candidate, detail: { ...(bestObserved || {}), detailStatus: "detail_failed", missingFields: bestObserved?.missingFields || ["goods_id", "title", "price"], error: lastError || "候选详情读取失败。", attemptCount: maxAttempts, capturedAt: new Date().toISOString() } };
}

async function inspectVisibleCandidates(taskId, candidates, successLimit = 3, trace = null) {
  const list = Array.isArray(candidates) ? candidates : [];
  const inspectedByIndex = new Map();
  let completed = 0;
  for (const index of candidateInspectionOrder(list)) {
    if (completed >= successLimit) break;
    const result = await inspectCandidateDetail(taskId, list[index], index, 2, trace);
    inspectedByIndex.set(index, result);
    if (result.detail?.detailStatus === "detail_captured") completed += 1;
    if (completed < successLimit) await timed(trace, "候选切换随机缓冲", () => delay(1200 + Math.floor(Math.random() * 1401)));
  }
  return list.map((candidate, index) => inspectedByIndex.get(index) || {
    ...candidate,
    detail: {
      detailStatus: "detail_not_inspected",
      reason: completed >= successLimit ? `已取得${successLimit}个完整候选` : "本轮未进入详情核验",
      capturedAt: new Date().toISOString(),
    },
  });
}

async function searchTask(body) {
  const trace = createTimingTrace();
  try {
    const prepared = await prepareTask(body, trace);
    const search = await startImageSearch(trace);
    const candidates = await inspectVisibleCandidates(prepared.taskId, search.candidates, 3, trace);
    const detailCompleted = candidates.filter((candidate) => candidate.detail?.detailStatus === "detail_captured").length;
    return { ok: true, taskId: prepared.taskId, remotePath: prepared.remotePath, ...search, candidates, detailCompleted, timing: timingSnapshot(trace), message: `${search.message} 已完成${detailCompleted}个候选详情核验。` };
  } catch (error) {
    error.timing = timingSnapshot(trace, "failed");
    throw error;
  }
}

async function waitForFavoriteControl(goodsId, { requireFavorited = false, timeoutMs = 15000 } = {}) {
  const startedAt = Date.now();
  let lastState = { status: "unknown", node: null };
  while (Date.now() - startedAt < timeoutMs) {
    const ui = await captureUi();
    const route = await captureCurrentRoute();
    if (route.goodsId === goodsId) {
      lastState = pinduoduoFavoriteState(ui.nodes);
      if (lastState.status === "favorited" || (!requireFavorited && lastState.status === "not_favorited")) return { ...lastState, route };
    }
    await delay(500);
  }
  return { ...lastState, route: null };
}

async function openCandidateDetail(body = {}) {
  const sourceUrl = String(body.sourceUrl || "").trim();
  const goodsId = pinduoduoProductGoodsId(sourceUrl);
  if (!goodsId) throw new Error("候选商品链接不是受信任的拼多多商品地址。");
  const status = await deviceStatus();
  if (!status.bootCompleted) throw new Error("MuMu安卓设备尚未启动完成。");
  if (!status.pinduoduoInstalled) throw new Error("MuMu中未检测到拼多多。");
  const canonicalUrl = `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}`;
  await adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", canonicalUrl, "-p", PINDUODUO_PACKAGE]);
  const initial = await waitForFavoriteControl(goodsId, { timeoutMs: 15000 });
  if (!initial.route || initial.status === "unknown") throw new Error("拼多多App未能打开指定候选商品详情页。");
  return { goodsId, sourceUrl: canonicalUrl, favoriteState: initial.status, favoriteNode: initial.node };
}

async function openCandidate(body = {}) {
  const opened = await openCandidateDetail(body);
  return { ok: true, status: "opened_in_app", goodsId: opened.goodsId, sourceUrl: opened.sourceUrl, favoriteState: opened.favoriteState, message: "已在MuMu拼多多App中打开候选商品。" };
}

async function favoriteCandidate(body = {}) {
  const opened = await openCandidateDetail(body);
  const { goodsId, sourceUrl: canonicalUrl } = opened;
  const initial = { status: opened.favoriteState, node: opened.favoriteNode };
  if (initial.status === "favorited") {
    return { ok: true, status: "favorited", alreadyFavorited: true, goodsId, sourceUrl: canonicalUrl, message: "该候选商品已经收藏。" };
  }
  if (initial.status !== "not_favorited" || !initial.node?.bounds) throw new Error("商品详情页未加载出收藏按钮。");
  await tapBounds(initial.node.bounds);
  const verified = await waitForFavoriteControl(goodsId, { requireFavorited: true, timeoutMs: 8000 });
  if (verified.status !== "favorited") throw new Error("已点击收藏，但未能确认页面变为“已收藏”；请人工复核后重试。");
  return { ok: true, status: "favorited", alreadyFavorited: false, goodsId, sourceUrl: canonicalUrl, message: "推荐同款已加入拼多多收藏。" };
}

async function captureScreenshot() {
  await fs.mkdir(runtimeDir, { recursive: true });
  const screenshot = (await adb(["exec-out", "screencap", "-p"], { binary: true, timeoutMs: 10000 })).output;
  const localPath = path.join(runtimeDir, "current-screen.png");
  await fs.writeFile(localPath, screenshot);
  return { ok: true, localPath, bytes: screenshot.length, capturedAt: new Date().toISOString() };
}

async function saveSkuDiagnostic(ui, sheet, reason) {
  const diagnosticDir = path.join(runtimeDir, "diagnostics");
  await fs.mkdir(diagnosticDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(diagnosticDir, `sku-${stamp}.json`);
  const screenshotPath = path.join(diagnosticDir, `sku-${stamp}.png`);
  await fs.writeFile(jsonPath, JSON.stringify({ capturedAt: new Date().toISOString(), reason, sheet, nodes: ui?.nodes || [] }, null, 2), "utf8");
  const screenshot = await captureScreenshot();
  await fs.copyFile(screenshot.localPath, screenshotPath);
  return { jsonPath, screenshotPath };
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error("请求内容超过1MB。");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function json(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
}

async function staticFile(requestPath, response) {
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(`${path.resolve(publicDir)}${path.sep}`) && target !== path.join(publicDir, "index.html")) return false;
  try {
    const content = await fs.readFile(target);
    const extension = path.extname(target).toLowerCase();
    const contentType = ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" })[extension] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType, "content-length": content.length, "cache-control": "no-store" });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function evidenceFile(requestPath, response) {
  const prefix = "/api/evidence/";
  if (!requestPath.startsWith(prefix)) return false;
  const relative = decodeURIComponent(requestPath.slice(prefix.length)).replaceAll("/", path.sep);
  const target = path.resolve(runtimeDir, relative);
  const root = path.resolve(runtimeDir);
  if (!target.startsWith(`${root}${path.sep}`) || !/\.(?:png|jpe?g)$/i.test(target)) return false;
  try {
    const content = await fs.readFile(target);
    const contentType = /\.jpe?g$/i.test(target) ? "image/jpeg" : "image/png";
    response.writeHead(200, { "content-type": contentType, "content-length": content.length, "cache-control": "no-store" });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "POST" && request.headers["x-ozon-agent"] !== localUiHeader) return json(response, 403, { ok: false, error: "拒绝非本地控制页面的操作请求。" });
    if (request.method === "GET" && url.pathname === "/api/status") return json(response, 200, { ok: true, status: await deviceStatus() });
    if (request.method === "GET" && url.pathname === "/api/ai/status") return json(response, 200, { ok: true, status: await qwenStatus() });
    if (request.method === "POST" && url.pathname === "/api/device/launch") {
      await manager(["main", "launch"]);
      await manager(["control", "-v", "0", "launch"]);
      return json(response, 200, { ok: true, message: "已请求启动MuMu安卓设备。" });
    }
    if (request.method === "POST" && url.pathname === "/api/pinduoduo/launch") {
      await manager(["control", "-v", "0", "app", "launch", "-pkg", PINDUODUO_PACKAGE]);
      return json(response, 200, { ok: true, message: "已启动拼多多。" });
    }
    if (request.method === "POST" && url.pathname === "/api/device/ui") return json(response, 200, { ok: true, ...(await captureUi()) });
    if (request.method === "POST" && url.pathname === "/api/device/click-named") return json(response, 200, await clickNamedUi(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/device/screenshot") return json(response, 200, await captureScreenshot());
    if (request.method === "POST" && url.pathname === "/api/task/prepare") return json(response, 200, await prepareTask(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/task/search") return json(response, 200, await searchTask(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/pinduoduo/open") return json(response, 200, await openCandidate(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/pinduoduo/favorite") return json(response, 200, await favoriteCandidate(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/pinduoduo/sku-options") return json(response, 200, await captureSkuOptions(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/pinduoduo/select-sku") return json(response, 200, await selectSkuOption(await readJsonBody(request)));
    if (request.method === "POST" && url.pathname === "/api/ai/judge") return json(response, 200, { ok: true, ...(await judgeTaskWithQwen(await readJsonBody(request))) });
    if (request.method === "POST" && url.pathname === "/api/ai/select-sku") {
      const body = await readJsonBody(request);
      return json(response, 200, { ok: true, ...(await selectSkuOptionWithQwen(body.task, body.candidate, body.skuSheet)) });
    }
    if (request.method === "GET" && await evidenceFile(url.pathname, response)) return;
    if (request.method === "GET" && await staticFile(url.pathname, response)) return;
    json(response, 404, { ok: false, error: "未找到接口或页面。" });
  } catch (error) {
    const riskControl = error?.code === "PINDUODUO_RISK_CONTROL";
    json(response, riskControl ? 423 : 500, { ok: false, error: error.message || String(error), code: error?.code || "", risk: error?.risk || null, timing: error?.timing || null });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`端口${port}已被占用；如果控制器已经打开，请直接使用现有页面。`);
  else console.error(error.message || String(error));
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = `http://${host}:${port}/`;
  console.log(`拼多多找品Agent已启动：${address}`);
  const browser = spawn("explorer.exe", [address], { detached: true, windowsHide: true, stdio: "ignore" });
  browser.unref();
});
