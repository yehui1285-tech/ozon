import assert from "node:assert/strict";
import fs from "node:fs";
import { buildQueueCsv, parseBatchMarkdown, selectRepresentativeTasks } from "../sourcing-agent/queue-core.mjs";

const fixture = `# Ozon 批量店铺“符合要求”商品清单

- 批次编号：batch-test
- 导出时间：2026/8/15 16:24:39
- 店铺数量：3 个
- 符合要求商品：4 个
- 批次状态：已停止

| 店铺序号 | 店铺 | 状态 | 商品序号 | 商品名称 | SKU | 价格 | rFBS 佣金 | 月销量 | 发货模式 | 长宽高 | 重量 | 跟卖最低价 | 商品链接 |
| ---: | --- | --- | ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | ---: | --- |
| 1 | [Store A](https://www.ozon.ru/seller/a/) | 已完成 | 1 | 过滤器 | 1001 | 90,31 | 12% / 17% / 19% | 2 | FBS | 150 x 120 x 80mm | 300g | ¥64.83 | [打开商品](https://www.ozon.ru/product/filter-1001/?x=1) |
| 1 | [Store A](https://www.ozon.ru/seller/a/) | 已完成 | 2 | 过滤器 | 1002 | 700,00 | 12% / 14% / 18% | 1 | FBS | 200 x 100 x 50mm | 1.5kg | 无 | [打开商品](https://www.ozon.ru/product/filter-1002/) |
| 2 | [Store B](https://www.ozon.ru/seller/b/) | 已跳过 | 1 | 脚踏板, 2个 | 2001 | 135,19 | 12% / 17% / 17% | 1 | FBS | 300 x 200 x 200mm | 450g | ¥101.37 | [打开商品](https://www.ozon.ru/product/pedal-2001/) |
| 3 | [Store C](https://www.ozon.ru/seller/c/) | 等待中 | - | 暂无符合要求的商品 | - | - | - | - | - | - | - | - | - |
| 3 | [Store C](https://www.ozon.ru/seller/c/) | 等待中 | 1 | 钥匙套 | 3001 | 237,68 | 12% / 17% / 17% | 1 | FBS | 100 x 80 x 30mm | 0.2kg | ¥116.60 | [打开商品](https://www.ozon.ru/product/keycase-3001/) |

> 测试数据
`;

const queue = parseBatchMarkdown(fixture, { createdAt: "2026-08-25T00:00:00.000Z" });
assert.equal(queue.batch.batchId, "batch-test");
assert.equal(queue.batch.declaredStoreCount, 3);
assert.equal(queue.batch.declaredProductCount, 4);
assert.equal(queue.summary.parsedProductCount, 4);
assert.equal(queue.summary.storeCount, 3);

const first = queue.tasks[0];
assert.equal(first.ozon.sku, "1001");
assert.equal(first.ozon.pagePrice, 90.31);
assert.equal(first.ozon.competitorPrice, 64.83);
assert.equal(first.ozon.effectiveGreenPrice, 64.83);
assert.equal(first.ozon.selectedCommission, 17);
assert.equal(first.ozon.lengthMm, 150);
assert.equal(first.ozon.weightG, 300);
assert.equal(first.ozon.productUrl, "https://www.ozon.ru/product/filter-1001/");
assert.equal(first.enrichment.originalBlackPrice, null);
assert.equal(first.status, "pending_ozon_enrichment");
assert.deepEqual(first.qualification, {
  status: "qualified",
  source: "batch_store_scan",
  verifiedAt: "2026/8/15 16:24:39",
});

const second = queue.tasks[1];
assert.equal(second.ozon.effectiveGreenPrice, 700);
assert.equal(second.ozon.selectedCommission, 18);
assert.equal(second.ozon.weightG, 1500);

const selected = selectRepresentativeTasks(queue.tasks, 3);
assert.equal(selected.length, 3);
assert.equal(new Set(selected.map((task) => task.source.storeName)).size, 3);

const csv = buildQueueCsv(selected);
assert.match(csv, /任务ID,状态,店铺,SKU/);
assert.match(csv, /同源原始黑标价,国际运费,运费线路,18%最高采购成本/);
assert.match(csv, /ozon-1001/);
assert.doesNotMatch(csv, /暂无符合要求/);

assert.throws(() => parseBatchMarkdown("# no table"), /没有找到批量扫描商品表格/);

const guiToolSource = fs.readFileSync(new URL("./md-to-json-gui.ps1", import.meta.url), "utf8");
const launcherPath = new URL("../Ozon批量MD转JSON.cmd", import.meta.url);
const launcherBuffer = fs.readFileSync(launcherPath);
const launcherSource = launcherBuffer.toString("ascii");
assert.match(guiToolSource, /sourcing-agent\\build-queue\.mjs/);
assert.match(guiToolSource, /--input \$resolvedInput --output \$resolvedOutput --limit 10/);
assert.match(guiToolSource, /转换工具不会重新检查商品标签/);
assert.match(guiToolSource, /Start-Process explorer\.exe/);
assert.match(launcherSource, /md-to-json-gui\.ps1/);
assert.match(launcherSource, /md-to-json-gui\.ps1" %\*/);
assert.ok([...launcherBuffer].every((byte) => byte < 128), "Windows CMD launcher must remain ASCII-only");
assert.match(launcherSource, /if errorlevel 1[\s\S]*?pause/);

console.log("Sourcing queue parser tests passed.");
