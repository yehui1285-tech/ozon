import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = JSON.parse(fs.readFileSync(path.join(root, "shared", "freight-rules.json"), "utf8"));

function available(input) {
  return routes.filter((route) => {
    const billable = route.usesVolume ? Math.max(input.weight, input.length * input.width * input.height / 12000) : input.weight;
    return input.sale > route.minValue && input.sale <= route.maxValue &&
      input.weight > route.minWeightExclusive && input.weight <= route.maxWeight &&
      (!route.maxBillable || billable <= route.maxBillable) &&
      input.length + input.width + input.height <= route.maxSum &&
      Math.max(input.length, input.width, input.height) <= route.maxSide;
  });
}

function routePrice(route, input) {
  const billable = route.usesVolume ? Math.max(input.weight, input.length * input.width * input.height / 12000) : input.weight;
  return billable * route.rate + route.fixed;
}

function assertPrice(routeName, input, expected) {
  const route = routes.find((item) => item.name === routeName);
  assert.ok(route, `没有找到运费线路：${routeName}`);
  assert.equal(Number(routePrice(route, input).toFixed(2)), expected, `${routeName} 最新价格公式不匹配`);
}

assert.equal(routes.length, 6);
assert.equal(available({ sale: 200, weight: 0.3, length: 70, width: 5, height: 5 }).length, 0, "超级轻小件单边不得超过 60cm");
assert.ok(available({ sale: 20000, weight: 25, length: 50, width: 40, height: 30 }).some((route) => route.name === "CEL Economy Premium Big"));
assert.ok(!available({ sale: 20000, weight: 25.001, length: 50, width: 40, height: 30 }).some((route) => route.name === "CEL Economy Premium Big"));
assert.ok(available({ sale: 1500, weight: 0.3, length: 30, width: 20, height: 8 }).some((route) => route.name === "CEL Economy Extra Small"));
assert.ok(!available({ sale: 0, weight: 0.3, length: 30, width: 20, height: 8 }).length);
assertPrice("CEL Economy Extra Small", { weight: 0.3, length: 30, width: 20, height: 8 }, 11.83);
assertPrice("CEL Economy Budget", { weight: 1, length: 30, width: 20, height: 10 }, 45);
assertPrice("CEL Economy Small", { weight: 1, length: 30, width: 20, height: 10 }, 46.9);
assertPrice("CEL Economy Premium Small", { weight: 1, length: 30, width: 20, height: 10 }, 52.9);
assertPrice("CEL Economy Big", { weight: 3, length: 30, width: 20, height: 10 }, 97.8);
assertPrice("CEL Economy Premium Big", { weight: 6, length: 30, width: 20, height: 10 }, 224.5);
console.log("运费规则边界测试通过");
