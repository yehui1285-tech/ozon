import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv[2] && path.resolve(process.argv[2]);
if (!dest || !fs.existsSync(dest) || fs.readdirSync(dest).length) throw new Error("Specify an empty output directory");
const extension = path.join(root, "ozon-erp-collector-extension");
const read = name => fs.readFileSync(path.join(extension, name), "utf8");
const write = (name, text) => fs.writeFileSync(path.join(dest, name), text, "utf8");
const replace = (text, before, after) => {
  if (!text.includes(before)) throw new Error("Standalone source anchor missing: " + before.slice(0, 80));
  return text.replace(before, after);
};
const keep = [
  "1688-background.js","1688-content.js","1688-core.js","black-price-core.js","main-image-core.js",
  "task-pricing-core.js","store-scanner-core.js","store-scanner.js","pinduoduo-bridge.js",
  "sourcing-enrichment.html","sourcing-enrichment.js","product-pool-core.js","product-pool.html","product-pool.js","product-pool.css",
];
for (const name of keep) fs.copyFileSync(path.join(extension, name), path.join(dest, name));
const manifest = JSON.parse(read("manifest.json"));
manifest.name = "OZON 独立选品助手";
manifest.host_permissions = manifest.host_permissions.filter(url => !url.includes("yehui1285"));
manifest.content_scripts = manifest.content_scripts.filter(script => !script.matches.some(url => url.includes("yehui1285")));
write("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

let background = read("background.js");
background = replace(background, 'importScripts("workbench-bridge.js", "product-pool-core.js");', 'importScripts("product-pool-core.js");');
background = background.replace(/^const TARGET_URL = .*?;$/m, 'const TARGET_URL = chrome.runtime.getURL("pricing.html");')
  .replace(/^const TARGET_MATCH = .*?;$/m, '');
background = replace(background, 'const tabs = await chrome.tabs.query({ url: TARGET_MATCH });', 'const tabs = (await chrome.tabs.query({})).filter(tab => tab.url === TARGET_URL);');
background = replace(background, 'operation = wbSendDetail(message.product || {},message.destination || "original",message.requestId);', 'operation = sendToPricing(message.product || {});');
background = background.split(/\r?\n/).filter(line => !/wbArchiveBeforeReset|wbSettings\(\)|WB_ALARM|message\?\.type === "wb/.test(line)).join("\n");
write("background.js", background);

let content = read("content.js");
content = content.replace(/^const TARGET_ORIGIN = .*?;$/m, "");
content = replace(content, 'const destination=document.getElementById("ozon-send-target")?.value||"workbench";', 'const destination="original";');
content = content.split(/\r?\n/).filter(line => !line.includes('id="ozon-send-target"') && !line.includes("const wbTarget=")).join("\n");
content = content.replace(/if \(location\.hostname === "yehui1285-tech\.github\.io"\) \{[\s\S]*?\} else if \(!\//, "if (!/");
write("content.js", content);
let popup = read("popup.html");
popup = popup.replace(/<hr style="border:0;border-top:1px solid #e0e5f7;margin:12px 0">[\s\S]*?(?=    <p id="status")/, "");
popup = replace(popup, 'https://yehui1285-tech.github.io/ozon/feishu.html?v=20260720', 'pricing.html');
write("popup.html", popup);
write("popup.js", read("popup.js").split(/\r?\nconst wbEl=/)[0] + "\n");
let batch = read("batch.html");
batch = batch.replace(/<button class="primary" id="wbSyncNow">[^<]+<\/button>/, "")
  .replace(/<p class="copy" id="wbBatchStatus">[^<]+<\/p>/, "");
write("batch.html", batch);
write("batch.js", read("batch.js").split(/\r?\nasync function wbBatchStatus\(/)[0] + "\n");

// Reuse the exact local pricing code and freight rules; extension pages need external JS under MV3 CSP.
const web = name => fs.readFileSync(path.join(root,"web-src",name),"utf8");
let html = web("index.template.html");
html = replace(html, "<style>\n__OZON_STYLES__\n</style>", '<link rel="stylesheet" href="pricing.css">');
html = replace(html, "<script>\n__OZON_APP__\n</script>", '<script src="pricing-core.js"></script><script src="pricing-app.js"></script>');
html = html.replace(/<section class="panel">\s*<div class="toolbar">\s*<h2>云端同步/, '<section class="panel" hidden><div class="toolbar"><h2>云端同步');
html = html.replace(/\s*<div id="syncStatus" class="sync-status">[^<]*<\/div>\s*<\/section>/, '</section><div id="syncStatus" class="sync-status">核价数据仅保存于当前浏览器。</div>');
write("pricing.html", html);
write("pricing.css", web("styles.css") + "\n[hidden] { display: none !important; }\n");
write("pricing-core.js", web("pricing-core.js"));
let app = web("app.js").replace(/^\s*const FEISHU_DETAIL_TABLE_URL = .*?;$/m, '    const FEISHU_DETAIL_TABLE_URL = "";');
app = app.replace(/window\.addEventListener\("message", \(event\) => \{[\s\S]*?applyErpDetailToRow\(data\.product \|\| \{\}\);\s*\}\);/, `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "deliverProductToPricing" || sender.id !== chrome.runtime.id) return false;
      try {
        const before = rows.length;
        const blank = before === 1 && isBlankOrLegacyDefaultRow(rows[0]);
        if (!blank && before >= MAX_DRAFT_ROWS) throw new Error("核价表已达到行数上限");
        applyErpDetailToRow(message.product || {});
        savePricingDraft();
        sendResponse({ok:true,destinations:["本地核价表"]});
      } catch (error) { sendResponse({ok:false,error:error.message}); }
      return false;
    });`);
write("pricing-app.js",app);
write("安装说明.txt", `OZON 独立选品助手 ${manifest.version}

1. 解压到专用固定目录（例如 D:\\OzonStandalone），不要直接加载 ZIP。
2. 打开 Chrome 或 Edge 的扩展管理，开启开发者模式，加载此目录。
3. 在扩展弹窗打开批量店铺扫描、商品池或本地核价页。无需工作台账号或连接码。
4. 批量扫描后点击本批加入商品池；历史 SKU 可在商品池导入。
5. 升级先备份商品池 CSV/JSON 和核价 CSV，再覆盖同一目录并重新加载扩展；保留原扩展，不要卸载。
6. 网页扫描需正常登录 Ozon，并具有所需 ERP 页面数据；登录、验证码由使用者自行处理。
本版仅保存本地数据。暂不提供自动采购、自动找品或跨电脑同步。
`);

for (const name of fs.readdirSync(dest)) {
  const contents = fs.readFileSync(path.join(dest,name),"utf8");
  if (/yehui1285|deep-breath-design-desk|feishu\.cn\/base\/MnB1/.test(contents)) throw new Error("Personal destination retained: " + name);
}
console.log("Standalone files generated:", fs.readdirSync(dest).length);
