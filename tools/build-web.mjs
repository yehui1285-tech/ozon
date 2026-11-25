import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "web-src");
const normalizeEol = text => text.replace(/\r\n/g, "\n");
const readSource = name => normalizeEol(fs.readFileSync(path.join(sourceDir, name), "utf8"));
const template = readSource("index.template.html");
const styles = readSource("styles.css").trim();
const core = readSource("pricing-core.js").trim();
const app = `${core}\n\n${readSource("app.js").trim()}`;
const html = template.replace("__OZON_STYLES__", styles).replace("__OZON_APP__", app);
const targets = [path.join(root, "feishu.html"), path.join(root, "ozon-feishu-sync", "site", "index.html")];
const checkOnly = process.argv.includes("--check");

for (const target of targets) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  // Git may check out generated HTML with CRLF while this builder emits LF.
  // Compare line endings semantically, while keeping every other byte significant.
  if (checkOnly) {
    if (normalizeEol(current) !== html) throw new Error(`${path.relative(root, target)} 未从 web-src 生成`);
  } else if(current!==html) fs.writeFileSync(target, html, "utf8");
}
console.log(checkOnly ? "网页构建检查通过" : "网页构建完成");
