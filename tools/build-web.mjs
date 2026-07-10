import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "web-src");
const template = fs.readFileSync(path.join(sourceDir, "index.template.html"), "utf8");
const styles = fs.readFileSync(path.join(sourceDir, "styles.css"), "utf8").trim();
const core = fs.readFileSync(path.join(sourceDir, "pricing-core.js"), "utf8").trim();
const app = `${core}\n\n${fs.readFileSync(path.join(sourceDir, "app.js"), "utf8").trim()}`;
const html = template.replace("__OZON_STYLES__", styles).replace("__OZON_APP__", app);
const targets = [path.join(root, "feishu.html"), path.join(root, "ozon-feishu-sync", "site", "index.html")];
const checkOnly = process.argv.includes("--check");

for (const target of targets) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current === html) continue;
  if (checkOnly) throw new Error(`${path.relative(root, target)} 未从 web-src 生成`);
  fs.writeFileSync(target, html, "utf8");
}
console.log(checkOnly ? "网页构建检查通过" : "网页构建完成");
