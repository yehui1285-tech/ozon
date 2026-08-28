import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PINDUODUO_PACKAGE, extractPinduoduoCandidates, extractPinduoduoDetail, findUiNode, isTrustedOzonImageUrl, parseMumuInfo, parsePinduoduoRoute, parseUiNodes, safeTaskFileName } from "./core.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(moduleDir, "public");
const runtimeDir = path.join(moduleDir, "runtime");
const managerPath = "E:\\Program Files\\Netease\\MuMu\\nx_main\\MuMuManager.exe";
const adbPath = "E:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe";
const adbSerial = "127.0.0.1:16384";
const host = "127.0.0.1";
const port = 17628;
const localUiHeader = "local-ui-v1";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function prepareTask(body) {
  const taskId = String(body.taskId || "").trim();
  const imageUrl = String(body.mainImageUrl || "").trim();
  if (!taskId) throw new Error("缺少任务ID。");
  const status = await deviceStatus();
  if (!status.bootCompleted) throw new Error("MuMu安卓设备尚未启动完成。");
  if (!status.pinduoduoInstalled) throw new Error("MuMu中未检测到拼多多。");
  const image = await downloadTaskImage(taskId, imageUrl);
  const remoteDir = "/sdcard/Pictures/OzonSourcing";
  const remotePath = `${remoteDir}/${image.fileName}`;
  await adb(["shell", "mkdir", "-p", remoteDir]);
  await adb(["push", image.localPath, remotePath], { timeoutMs: 30000 });
  await adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file://${remotePath}`]);
  await manager(["control", "-v", "0", "app", "launch", "-pkg", PINDUODUO_PACKAGE]);
  return { ok: true, taskId, remotePath, imageBytes: image.bytes, message: "主图已下发到模拟器并启动拼多多。" };
}

async function captureUi() {
  await adb(["shell", "uiautomator", "dump", "/sdcard/ozon-agent-window.xml"]).catch((error) => {
    if (!/dumped to:/i.test(error.message || "")) throw error;
  });
  const xml = (await adb(["exec-out", "cat", "/sdcard/ozon-agent-window.xml"])).output;
  const nodes = parseUiNodes(xml);
  return { nodes, cameraSearch: findUiNode(nodes, ["拍照搜索", "图片搜索"]), capturedAt: new Date().toISOString() };
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

async function startImageSearch() {
  await adb(["shell", "am", "force-stop", PINDUODUO_PACKAGE]);
  await adb(["shell", "monkey", "-p", PINDUODUO_PACKAGE, "-c", "android.intent.category.LAUNCHER", "1"]);
  const camera = await waitForUiNode(["拍照搜索", "图片搜索"], 12000);
  if (!camera.node?.bounds) throw new Error("拼多多首页未加载出拍照搜索按钮。");
  await tapBounds(camera.node.bounds);
  await delay(250);
  const sizeOutput = (await adb(["shell", "wm", "size"])).output;
  const size = /(\d+)x(\d+)/.exec(sizeOutput);
  const width = Number(size?.[1]) || 900;
  const height = Number(size?.[2]) || 1600;
  await adb(["shell", "input", "tap", String(Math.round(width / 8)), String(Math.round(height - height * 0.105))]);
  const result = await waitForUiNode(["搜图片同款"], 15000);
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
  let lastDetail = null;
  while (Date.now() - startedAt < timeoutMs) {
    const ui = await captureUi();
    const route = await captureCurrentRoute();
    lastDetail = extractPinduoduoDetail(ui.nodes, route);
    if (lastDetail.detailStatus === "detail_captured") return lastDetail;
    await delay(500);
  }
  return lastDetail;
}

async function returnToSearchResults(maxBackPresses = 3) {
  for (let attempt = 0; attempt <= maxBackPresses; attempt += 1) {
    const ui = await captureUi();
    if (findUiNode(ui.nodes, ["搜图片同款"])) return ui;
    if (attempt < maxBackPresses) {
      await adb(["shell", "input", "keyevent", "4"]);
      await delay(700);
    }
  }
  throw new Error("候选详情核验后未能返回拼多多以图搜索结果页。");
}

async function inspectVisibleCandidates(candidates, limit = 3) {
  const inspected = [];
  for (const candidate of candidates.slice(0, limit)) {
    let navigationError = null;
    try {
      const resultUi = await returnToSearchResults();
      const currentCandidates = extractPinduoduoCandidates(resultUi.nodes);
      const current = currentCandidates.find((entry) => entry.title === candidate.title && entry.displayedPrice === candidate.displayedPrice)
        || currentCandidates.find((entry) => entry.title === candidate.title)
        || candidate;
      await tapBounds(current.bounds);
      const detail = await waitForCandidateDetail(12000);
      if (!detail || detail.detailStatus !== "detail_captured") throw new Error("详情标题、价格或商品ID未完整加载。");
      inspected.push({ ...candidate, bounds: current.bounds, priceBounds: current.priceBounds, sourceUrl: detail.sourceUrl, detail });
    } catch (error) {
      inspected.push({ ...candidate, detail: { detailStatus: "detail_failed", error: error.message || String(error), capturedAt: new Date().toISOString() } });
    } finally {
      try {
        await returnToSearchResults();
      } catch (error) {
        navigationError = error;
      }
    }
    if (navigationError) break;
  }
  return inspected;
}

async function searchTask(body) {
  const prepared = await prepareTask(body);
  const search = await startImageSearch();
  const inspected = await inspectVisibleCandidates(search.candidates, 3);
  const candidates = [
    ...inspected,
    ...search.candidates.slice(inspected.length).map((candidate) => ({ ...candidate, detail: { detailStatus: "detail_not_inspected", capturedAt: new Date().toISOString() } })),
  ];
  const detailCompleted = candidates.filter((candidate) => candidate.detail?.detailStatus === "detail_captured").length;
  return { ok: true, taskId: prepared.taskId, remotePath: prepared.remotePath, ...search, candidates, detailCompleted, message: `${search.message} 已完成${detailCompleted}个候选详情核验。` };
}

async function captureScreenshot() {
  await fs.mkdir(runtimeDir, { recursive: true });
  const screenshot = (await adb(["exec-out", "screencap", "-p"], { binary: true, timeoutMs: 10000 })).output;
  const localPath = path.join(runtimeDir, "current-screen.png");
  await fs.writeFile(localPath, screenshot);
  return { ok: true, localPath, bytes: screenshot.length, capturedAt: new Date().toISOString() };
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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "POST" && request.headers["x-ozon-agent"] !== localUiHeader) return json(response, 403, { ok: false, error: "拒绝非本地控制页面的操作请求。" });
    if (request.method === "GET" && url.pathname === "/api/status") return json(response, 200, { ok: true, status: await deviceStatus() });
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
    if (request.method === "GET" && await staticFile(url.pathname, response)) return;
    json(response, 404, { ok: false, error: "未找到接口或页面。" });
  } catch (error) {
    json(response, 500, { ok: false, error: error.message || String(error) });
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
