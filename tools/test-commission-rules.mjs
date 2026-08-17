import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "ozon-erp-collector-extension", "content.js"), "utf8");
const match = source.match(/function pickCommission\(price, values\) \{[\s\S]*?\n\}/);
assert.ok(match, "没有找到 pickCommission 函数");

const context = {};
vm.runInNewContext(`${match[0]}\nglobalThis.pickCommission = pickCommission;`, context);
const pickCommission = context.pickCommission;

assert.equal(pickCommission(0, [5, 10, 15]), 10, "低价不应再使用第一档");
assert.equal(pickCommission(135, [5, 10, 15]), 10, "135 应使用第二档");
assert.equal(pickCommission(600, [5, 10, 15]), 10, "600 应使用第二档");
assert.equal(pickCommission(600.01, [5, 10, 15]), 15, "大于 600 应使用第三档");
assert.equal(pickCommission(500, [5]), 0, "第二档缺失时不得回退第一档");
assert.equal(pickCommission(700, [5, 10]), 0, "第三档缺失时不得回退第二档或第一档");
assert.equal(pickCommission(500, []), 0, "未识别到百分比时应为空");

console.log("佣金档位规则测试通过");
