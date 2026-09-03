import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.join(moduleDir, "runtime");
const encryptedKeyPath = path.join(runtimeDir, "qwen-api-key.dpapi");
const readKeyScript = path.join(moduleDir, "read-qwen-key.ps1");
const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const defaultModel = "qwen3.7-flash";
const maxModelJsonBytes = 64 * 1024;
const maxResponseBytes = 1024 * 1024;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function configuredQwenModel() {
  return clean(process.env.QWEN_MODEL) || defaultModel;
}

/** Loads only the existing environment/DPAPI credential sources; never logs a key. */
export async function loadQwenCredential() {
  const environmentKey = clean(process.env.DASHSCOPE_API_KEY);
  if (environmentKey) return { key: environmentKey, source: "environment" };
  try {
    await fs.access(encryptedKeyPath);
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", readKeyScript, encryptedKeyPath], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const key = clean(stdout);
    return key ? { key, source: "windows_dpapi" } : { key: "", source: "" };
  } catch {
    return { key: "", source: "" };
  }
}

/** Strictly parse one JSON object; markdown fences, prose, arrays, and large outputs fail closed. */
export function parseQwenJsonResponse(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回有效JSON对象。");
  if (Buffer.byteLength(content, "utf8") > maxModelJsonBytes || /^\s*```/i.test(content)) throw new Error("模型JSON输出不符合安全限制。");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("模型没有返回有效JSON对象。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型没有返回有效JSON对象。");
  return parsed;
}

function safeTimeout(value) {
  return Number.isInteger(value) && value >= 1000 && value <= 180000 ? value : 90000;
}

function safeTemperature(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2 ? value : 0.1;
}

function safeMaxTokens(value) {
  return Number.isInteger(value) && value >= 1 && value <= 4096 ? value : 900;
}

/** Read a Fetch response incrementally so chunked responses cannot bypass the size limit. */
export async function readLimitedQwenResponse(response, maxBytes = maxResponseBytes) {
  const limit = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : maxResponseBytes;
  const declaredSize = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > limit) throw new Error("千问响应超过安全大小限制。");
  const body = response?.body;
  if (body?.getReader) {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          throw new Error("千问响应超过安全大小限制。");
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      reader.releaseLock?.();
    }
  }
  const responseText = await response?.text?.();
  if (typeof responseText !== "string" || Buffer.byteLength(responseText, "utf8") > limit) throw new Error("千问响应超过安全大小限制。");
  return responseText;
}

/**
 * Calls the existing Bailian compatible-mode endpoint. The outward result is
 * parsed JSON plus non-secret metadata, shared by Pinduoduo and 1688 flows.
 */
export async function requestQwenJson({ content, temperature, maxTokens, timeoutMs = 90000 } = {}) {
  if (!Array.isArray(content) || !content.length) throw new Error("千问请求缺少内容。");
  const credential = await loadQwenCredential();
  if (!credential.key) throw new Error("尚未配置阿里云百炼API Key，请先双击“配置千问API密钥.cmd”。");
  const model = configuredQwenModel();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${credential.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
        enable_thinking: false,
        temperature: safeTemperature(temperature),
        max_tokens: safeMaxTokens(maxTokens),
      }),
      signal: AbortSignal.timeout(safeTimeout(timeoutMs)),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") throw new Error("千问调用超时，请稍后重试。");
    throw new Error("千问调用失败，请稍后重试。");
  }
  const responseText = await readLimitedQwenResponse(response);
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("千问服务返回了无效响应。");
  }
  if (!response.ok) throw new Error(`千问调用失败：HTTP ${response.status}`);
  return {
    json: parseQwenJsonResponse(payload?.choices?.[0]?.message?.content),
    usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : null,
    model,
  };
}
