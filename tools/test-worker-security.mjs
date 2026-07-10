import assert from "node:assert/strict";
import worker, { normalizeOzonUrl } from "../ozon-feishu-sync/worker/worker.js";

const cache = new Map();
const env = {
  FEISHU_APP_ID: "test",
  FEISHU_APP_SECRET: "test",
  FEISHU_APP_TOKEN: "test",
  FEISHU_BATCH_TABLE_ID: "test",
  FEISHU_DETAIL_TABLE_ID: "test",
  ALLOWED_ORIGIN: "https://yehui1285-tech.github.io",
  SYNC_API_TOKEN: "test-token-123456",
  SYNC_CACHE: {
    get: async (key) => cache.get(key) || null,
    put: async (key, value) => cache.set(key, value),
  },
};

assert.ok(normalizeOzonUrl("https://www.ozon.ru/product/test-123456/"));
assert.equal(normalizeOzonUrl("http://www.ozon.ru/product/test-123456/"), "");
assert.equal(normalizeOzonUrl("https://example.com/private"), "");

let response = await worker.fetch(new Request("https://worker.test/health"), env);
assert.equal(response.status, 200);

response = await worker.fetch(new Request("https://worker.test/", {
  method: "POST",
  headers: { Origin: "https://evil.example", "Content-Type": "application/json", "X-Ozon-Sync-Token": env.SYNC_API_TOKEN },
  body: "{}",
}), env);
assert.equal(response.status, 403);

response = await worker.fetch(new Request("https://worker.test/", {
  method: "POST",
  headers: { Origin: env.ALLOWED_ORIGIN, "Content-Type": "application/json" },
  body: "{}",
}), env);
assert.equal(response.status, 401);

const originalConsoleError = console.error;
console.error = () => {};
try {
  response = await worker.fetch(new Request("https://worker.test/", {
    method: "POST",
    headers: { Origin: env.ALLOWED_ORIGIN, "Content-Type": "text/plain", "X-Ozon-Sync-Token": env.SYNC_API_TOKEN },
    body: "{}",
  }), env);
} finally {
  console.error = originalConsoleError;
}
assert.equal(response.status, 400);

console.log("Worker 来源、令牌、内容类型与 Ozon 域名白名单测试通过");
