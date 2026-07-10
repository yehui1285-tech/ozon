import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = JSON.parse(fs.readFileSync(path.join(root, "shared", "freight-rules.json"), "utf8"));
const checkOnly = process.argv.includes("--check");
const pageFiles = [path.join("web-src", "app.js")];
const extensionFile = path.join("ozon-erp-collector-extension", "content.js");
const pageOnlyKeys = new Set(["cn", "delivery", "feeText", "weightText", "valueText"]);

function findArrayEnd(text, arrayStart) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = arrayStart; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) return index;
  }
  throw new Error("没有找到运费规则数组结尾");
}

function generatedBlock(prefix, values, indent) {
  const lines = values.map((rule) => `${indent}  ${JSON.stringify(rule)}`);
  return `${prefix}[\n${lines.join(",\n")}\n${indent}]`;
}

function updateFile(relativePath, prefix, values, indent) {
  const file = path.join(root, relativePath);
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf(prefix);
  if (start < 0) throw new Error(`${relativePath} 没有找到 routes 定义`);
  const arrayStart = text.indexOf("[", start + prefix.length);
  const arrayEnd = findArrayEnd(text, arrayStart);
  const current = text.slice(start, arrayEnd + 1);
  const next = generatedBlock(prefix, values, indent);
  if (current === next) return false;
  if (checkOnly) throw new Error(`${relativePath} 的运费规则未与 shared/freight-rules.json 同步`);
  fs.writeFileSync(file, text.slice(0, start) + next + text.slice(arrayEnd + 1), "utf8");
  return true;
}

const extensionRules = rules.map((rule) => Object.fromEntries(Object.entries(rule).filter(([key]) => !pageOnlyKeys.has(key))));
let changed = false;
for (const file of pageFiles) changed = updateFile(file, "const routes = ", rules, "") || changed;
changed = updateFile(extensionFile, "const routes = ", extensionRules, "") || changed;
console.log(checkOnly ? "运费规则同步检查通过" : changed ? "运费规则已同步" : "运费规则无需更新");
