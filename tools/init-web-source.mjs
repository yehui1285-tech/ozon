import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "feishu.html"), "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!style || scripts.length !== 1) throw new Error("feishu.html 结构不符合拆分要求");

const sourceDir = path.join(root, "web-src");
fs.mkdirSync(sourceDir, { recursive: true });
const template = html
  .replace(style[1], "\n__OZON_STYLES__\n")
  .replace(scripts[0][1], "\n__OZON_APP__\n");
fs.writeFileSync(path.join(sourceDir, "index.template.html"), template, "utf8");
fs.writeFileSync(path.join(sourceDir, "styles.css"), style[1].trim() + "\n", "utf8");
fs.writeFileSync(path.join(sourceDir, "app.js"), scripts[0][1].trim() + "\n", "utf8");
console.log("网页源码已拆分到 web-src");
