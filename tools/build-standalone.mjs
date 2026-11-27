import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv[2] && path.resolve(process.argv[2]);
if (!dest || !fs.existsSync(dest) || fs.readdirSync(dest).length) throw new Error("Specify an empty output directory");
const extension = path.join(root, "ozon-erp-collector-extension");
const read = name => fs.readFileSync(path.join(extension, name), "utf8").replace(/\r\n/g, "\n");
const write = (name, text) => fs.writeFileSync(path.join(dest, name), text, "utf8");
const replace = (text, before, after) => {
  if (!text.includes(before)) throw new Error("Standalone source anchor missing: " + before.slice(0, 80));
  return text.replace(before, after);
};
const localTabs = [["product-pool.html","商品池"],["batch.html","批量店铺扫描"],["category.html","类目选品"],["pricing.html","核价表"]];
const withLocalNav = (html,current,anchor) => {
  const nav = `<nav class="standalone-nav" aria-label="Ozon 功能导航">${localTabs.map(([href,label])=>`<a href="${href}"${href===current?' aria-current="page"':''}>${label}</a>`).join("")}</nav>`;
  return replace(replace(html,"</head>",'<link rel="stylesheet" href="standalone-nav.css">\n</head>'),anchor,anchor+"\n    "+nav);
};
write("standalone-nav.css",`.standalone-nav{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:7px;margin:0 0 18px;background:#fff;border:1px solid #e3e7e0;border-radius:12px;box-shadow:0 3px 12px rgba(24,38,29,.05)}.standalone-nav a{display:flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:8px;text-decoration:none;color:#58685e;font-size:14px;font-weight:700;min-height:42px;white-space:nowrap}.standalone-nav a:hover{background:#eaf2e9;color:#3a5a40}.standalone-nav a[aria-current=page]{background:#3a5a40;color:#fff}.standalone-nav a:focus-visible{outline:2px solid #3a5a40;outline-offset:2px}body>.standalone-nav{margin:18px 24px 0}@media(max-width:600px){.standalone-nav a{flex:1;padding:9px 6px;font-size:13px}.standalone-nav{gap:4px}}`);
const keep = [
  "1688-background.js","1688-content.js","1688-core.js","black-price-core.js","main-image-core.js",
  "task-pricing-core.js","store-scanner-core.js","store-scanner.js","pinduoduo-bridge.js",
  "sourcing-enrichment.html","sourcing-enrichment.js","product-pool-core.js","product-pool-idb.js","product-pool.html","product-pool.js","product-pool.css",
  "category-core.js","category-background.js","category-scanner.js","category.css","category.js","category-catalog.js","category-catalog.json",
];
for (const name of keep) fs.copyFileSync(path.join(extension, name), path.join(dest, name));
let poolHtml = withLocalNav(read("product-pool.html"),"product-pool.html","<main>");
poolHtml = replace(poolHtml,"</head>",'<link rel="stylesheet" href="quick-pricing-panel.css">\n</head>');
poolHtml = replace(poolHtml,'    <section class="panel">','    <div class="qp-layout"><div><section class="panel">');
poolHtml = replace(poolHtml,'  </main>','    </div><aside id="quick-pricing-panel" aria-label="单品快速核价"></aside></div>\n  </main>');
poolHtml = replace(poolHtml,'</body>','<script src="pricing-core.js"></script><script src="quick-pricing-core.js"></script><script src="quick-pricing-panel.js"></script><script src="quick-pricing-local.js"></script>\n</body>');
write("product-pool.html",poolHtml);
for (const name of ['quick-pricing-core.js','quick-pricing-panel.js','quick-pricing-panel.css','quick-pricing-local.js']) fs.copyFileSync(path.join(extension,name),path.join(dest,name));
const manifest = JSON.parse(read("manifest.json"));
manifest.name = "OZON 独立选品助手";
manifest.host_permissions = manifest.host_permissions.filter(url => !url.includes("yehui1285"));
manifest.content_scripts = manifest.content_scripts.filter(script => !script.matches.some(url => url.includes("yehui1285")));
write("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

let background = read("background.js");
background = replace(background, 'importScripts("workbench-bridge.js", "product-pool-core.js", "product-pool-idb.js");', 'importScripts("product-pool-core.js", "product-pool-idb.js");');
background = background.replace(/^const TARGET_URL = .*?;$/m, 'const TARGET_URL = chrome.runtime.getURL("pricing.html");')
  .replace(/^const TARGET_MATCH = .*?;$/m, '');
background = replace(background, 'const tabs = await chrome.tabs.query({ url: TARGET_MATCH });', 'const tabs = (await chrome.tabs.query({})).filter(tab => tab.url === TARGET_URL);');
background = replace(background, 'operation = wbSendDetail(message.product || {},message.destination || "original",message.requestId);', 'operation = sendToPricing(message.product || {});');
background = background.split(/\r?\n/).filter(line => !/wbArchiveBeforeReset|wbSettings\(\)|WB_ALARM|wbSyncCategory|message\?\.type === "wb/.test(line)).join("\n");
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
write("batch.html", withLocalNav(batch,"batch.html",'<div class="wrap">'));
write("batch.js", read("batch.js").split(/\r?\nasync function wbBatchStatus\(/)[0] + "\n");
let category = read("category.html")
  .replace(/<button[^>]*id="syncWorkbench"[^>]*>[^<]+<\/button>/, "")
  .replace(/<button[^>]*id="cloudSyncBar"[\s\S]*?<\/button>/, "");
write("category.html",withLocalNav(category,"category.html",'<main class="shell">'));

// Reuse the exact local pricing code and freight rules; extension pages need external JS under MV3 CSP.
const web = name => fs.readFileSync(path.join(root,"web-src",name),"utf8").replace(/\r\n/g, "\n");
let html = web("index.template.html");
html = replace(html, "<style>\n__OZON_STYLES__\n</style>", '<link rel="stylesheet" href="pricing.css">');
html = replace(html, "<script>\n__OZON_APP__\n</script>", '<script src="pricing-core.js"></script><script src="quick-pricing-core.js"></script><script src="pricing-app.js"></script>');
html = html.replace(/<section class="panel">\s*<div class="toolbar">\s*<h2>云端同步/, '<section class="panel" hidden><div class="toolbar"><h2>云端同步');
html = html.replace(/\s*<div id="syncStatus" class="sync-status">[^<]*<\/div>\s*<\/section>/, '</section><div id="syncStatus" class="sync-status">核价数据仅保存于当前浏览器。</div>');
write("pricing.html", withLocalNav(html,"pricing.html","<body>"));
write("pricing.css", web("styles.css") + "\n[hidden] { display: none !important; }\n");
write("pricing-core.js", web("pricing-core.js"));
write("quick-pricing-core.js", read("quick-pricing-core.js"));
let app = web("app.js").replace(/^\s*const FEISHU_DETAIL_TABLE_URL = .*?;$/m, '    const FEISHU_DETAIL_TABLE_URL = "";');
app = app.replace(/window\.addEventListener\("message", \(event\) => \{[\s\S]*?applyErpDetailToRow\(data\.product \|\| \{\}\);\s*\}\);/, `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "deliverProductToPricing" || sender.id !== chrome.runtime.id) return false;
      try {
        const before = rows.length;
        const blank = before === 1 && isBlankOrLegacyDefaultRow(rows[0]);
        if (!blank && before >= MAX_DRAFT_ROWS) throw new Error("核价表已达到行数上限");
        if(quickPricingConflict || localStorage.getItem(PRICING_DRAFT_KEY)!==quickPricingBaseline)throw Error('核价已在另一页面变化，请刷新核价页后重试');
        applyErpDetailToRow(message.product || {});
        if(!savePricingDraft())throw Error('核价保存未确认，请重新读取核对');
        sendResponse({ok:true,destinations:["本地核价表"]});
      } catch (error) { sendResponse({ok:false,error:error.message}); }
      return false;
    });`);
app += `
// The pricing page remains the sole writer of its existing local draft.
let quickPricingBaseline = localStorage.getItem(PRICING_DRAFT_KEY);
let quickPricingConflict = false;
const quickPricingOriginalSave = savePricingDraft;
savePricingDraft = function () {
  if (quickPricingConflict || localStorage.getItem(PRICING_DRAFT_KEY) !== quickPricingBaseline) {
    if ($("syncStatus")) $("syncStatus").textContent="本地核价记录已在另一页面修改。请刷新核价页后继续。";
    return false;
  }
  quickPricingOriginalSave();
  quickPricingBaseline = localStorage.getItem(PRICING_DRAFT_KEY);
  try {const actual=JSON.parse(quickPricingBaseline||'null');return Array.isArray(actual?.rows)&&actual.rows.length===rows.length&&actual.rows.every((r,i)=>r.id===rows[i].id&&PRICING_ROW_KEYS.every(k=>String(r[k]??'')===String(rows[i][k]??'')));}catch{return false;}
};
window.addEventListener("storage", event => {
  if (event.storageArea === localStorage && event.key === PRICING_DRAFT_KEY && event.newValue !== quickPricingBaseline) quickPricingConflict = true;
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith("quickPricing") || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("product-pool.html")) return false;
  try {
    const stored = localStorage.getItem(PRICING_DRAFT_KEY);
    if (quickPricingConflict || stored !== quickPricingBaseline) throw new Error("核价页数据已在其他页面变化。请先检查并刷新核价页，再返回商品池。");
    if (message.type === "quickPricingRead") {
      sendResponse({ok:true,rows:OzonQuickPricingCore.rowsForSku(rows,message.sku)});
      return false;
    }
    if (message.type === "quickPricingPatch") {
      const before=rows;
      rows = OzonQuickPricingCore.patchRow(rows,{sku:message.sku,id:message.id,base:message.base,patch:message.patch});
      renderRows();
      if(!savePricingDraft()){rows=before;renderRows();throw Error("核价写入未确认，请刷新核价页");}
      const saved = JSON.parse(localStorage.getItem(PRICING_DRAFT_KEY) || "null");
      const persisted = saved?.rows?.find(row => row.id === message.id && row.sku === String(message.sku));
      const updated=rows.find(row=>row.id===message.id&&row.sku===String(message.sku));
      if (!persisted || !updated || PRICING_ROW_KEYS.some(key=>String(persisted[key]??'')!==String(updated[key]??''))) {rows=before;renderRows();throw new Error("核价已更新但本地保存未确认，请刷新核对。");}
      sendResponse({ok:true,rows:OzonQuickPricingCore.rowsForSku(saved.rows,message.sku)});
      return false;
    }
    throw new Error("不支持的核价操作");
  } catch (error) { sendResponse({ok:false,error:error.message || String(error)}); return false; }
});
`;
write("pricing-app.js",app);
write("安装说明.txt", `OZON 独立选品助手 ${manifest.version}

1. 解压到专用固定目录（例如 D:\\OzonStandalone），不要直接加载 ZIP。
2. 打开 Chrome 或 Edge 的扩展管理，开启开发者模式，加载此目录。
3. 在扩展弹窗打开批量店铺扫描、类目选品、商品池或本地核价页。无需工作台账号或连接码。
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
