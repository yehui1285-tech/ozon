import assert from "node:assert/strict";
import fs from "node:fs";
import { applySelectedCandidate, extractPinduoduoCandidates, findUiNode, isTrustedOzonImageUrl, parseMumuInfo, parseUiNodes, queueStats, safeTaskFileName, taskReadiness } from "../pinduoduo-agent/core.mjs";

assert.equal(isTrustedOzonImageUrl("https://ir.ozone.ru/s3/multimedia-test/wc1000/1.jpg"), true);
assert.equal(isTrustedOzonImageUrl("http://ir.ozone.ru/s3/multimedia-test/1.jpg"), false);
assert.equal(isTrustedOzonImageUrl("https://example.com/s3/multimedia-test/1.jpg"), false);

assert.deepEqual(parseMumuInfo('{"index":"0","name":"工作室","android_version":"15.0","is_process_started":true,"is_android_started":true,"error_code":0}'), {
  index: "0", name: "工作室", androidVersion: "15.0", processStarted: true, androidStarted: true, errorCode: 0,
});
assert.equal(parseMumuInfo("not-json").errorCode, -1);
assert.equal(safeTaskFileName("ozon:123 / test"), "ozon_123_test");

const uiNodes = parseUiNodes('<?xml version="1.0"?><hierarchy><node text="" resource-id="" class="android.view.View" content-desc="拍照搜索" clickable="false" bounds="[0,0][900,1600]" /><node text="" resource-id="pdd" class="android.view.View" content-desc="拍照搜索" clickable="true" bounds="[831,57][900,90]" /></hierarchy>');
assert.equal(uiNodes.length, 2);
assert.deepEqual(findUiNode(uiNodes, ["拍照搜索"])?.bounds, [831, 57, 900, 90]);
assert.deepEqual(extractPinduoduoCandidates([
  { text: "皇冠外压条", description: "皇冠外压条\n", resourceId: "com.xunmeng.pinduoduo:id/tv_title", bounds: [12, 759, 436, 783] },
  { text: "23.79", description: "", resourceId: "com.xunmeng.pinduoduo:id/pdd", bounds: [23, 823, 80, 853] },
  { text: "22.24", description: "", resourceId: "com.xunmeng.pinduoduo:id/pdd", bounds: [514, 823, 571, 853] },
])[0].displayedPrice, 23.79);

const readyTask = {
  taskId: "ozon-123",
  status: "pending_pinduoduo_search",
  ozon: { sku: "123", name: "测试" },
  enrichment: { mainImageUrl: "https://ir.ozone.ru/s3/multimedia-test/wc1000/1.jpg", maxPurchaseCostAt18Pct: 88.88 },
  sourcing: { candidates: [] },
  pricing: {}, audit: {},
};
assert.equal(taskReadiness(readyTask).ready, true);
assert.equal(taskReadiness({ ...readyTask, status: "pending_ozon_enrichment" }).ready, false);
const result = applySelectedCandidate(readyTask, { purchaseCost: 80, sourceUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=1" }, { updatedAt: "2026-08-28T00:00:00.000Z" });
assert.equal(result.eligibleAt18Pct, true);
assert.equal(readyTask.pricing.purchaseCost, 80);
assert.equal(readyTask.pricing.eligibleAt18Pct, true);
assert.equal(readyTask.status, "pending_human_review");
assert.equal(applySelectedCandidate({ ...readyTask, status: "pending_pinduoduo_search", enrichment: { ...readyTask.enrichment, maxPurchaseCostAt18Pct: 70 }, sourcing: { candidates: [] }, pricing: {}, audit: {} }, { purchaseCost: 80 }).eligibleAt18Pct, false);
assert.deepEqual(queueStats({ tasks: [readyTask, { status: "pending_ozon_enrichment" }] }), { total: 2, ready: 1, blocked: 1, priced: 1, eligible: 1 });

const serverSource = fs.readFileSync(new URL("../pinduoduo-agent/server.mjs", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../pinduoduo-agent/public/app.js", import.meta.url), "utf8");
assert.match(serverSource, /127\.0\.0\.1/);
assert.match(serverSource, /MuMuManager\.exe/);
assert.match(serverSource, /PINDUODUO_PACKAGE/);
assert.match(serverSource, /MEDIA_SCANNER_SCAN_FILE/);
assert.match(serverSource, /x-ozon-agent/);
assert.match(appSource, /pending_pinduoduo_search/);
assert.match(appSource, /x-ozon-agent/);
assert.match(appSource, /eligibleAt18Pct/);
console.log("Pinduoduo agent core tests passed.");
