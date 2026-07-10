import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "web-src", "pricing-core.js"), "utf8");
const context = {};
vm.runInNewContext(`${source}\nglobalThis.core = OzonPricingCore;`, context);
const core = context.core;
const required = ["green", "black", "commission", "cost", "freight"];

assert.equal(core.number("1 234,56 ₽"), 1234.56);
assert.equal(core.number("1,234.56"), 1234.56);
assert.equal(core.isCompleteRow({ green: "1", black: "2", commission: "8", cost: "3", freight: "4" }, required), true);
assert.deepEqual([...core.missingRequiredFields({ green: "1" }, required)], ["black", "commission", "cost", "freight"]);
const calculated = core.calc({ green: 100, black: 150, commission: 8, cost: 50, freight: 20 });
assert.ok(Number.isFinite(calculated.quote));
assert.ok(Number.isFinite(calculated.profit));
assert.equal(calculated.pricingFactor, 0.97);
console.log("核价公式与完整行测试通过");
