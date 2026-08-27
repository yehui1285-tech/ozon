import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const coreSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/black-price-core.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
context.globalThis = context;
vm.runInContext(coreSource, context, { filename: "black-price-core.js" });
const core = context.OzonBlackPriceCore;

assert.equal(core.number("129,02 ₽"), 129.02);
assert.equal(core.number("1 299,50 ¥"), 1299.5);
assert.equal(core.chooseSource(122.61, 124.29), "page");
assert.equal(core.chooseSource(130, 124.29), "competitor");
assert.equal(core.chooseSource(124.29, 124.29), "page");
assert.equal(core.chooseSource(0, 124.29), "competitor");
assert.equal(core.chooseSource(0, 0), "none");

assert.equal(
  core.competitorTriggerScore({ text: "跟卖列表：", cursor: "auto", textDecorationLine: "none" }),
  Number.POSITIVE_INFINITY,
);
assert.ok(
  Number.isFinite(core.competitorTriggerScore({
    text: "Крупные ...等9个卖家",
    cursor: "pointer",
    textDecorationLine: "underline",
  })),
);
assert.equal(
  core.competitorTriggerScore({ text: "Крупные ...", cursor: "pointer", textDecorationLine: "none" }),
  Number.POSITIVE_INFINITY,
);

assert.equal(
  core.normalizeProductUrl("https://www.ozon.ru/product/test-4821128720/?sh=abc#part"),
  "https://www.ozon.ru/product/test-4821128720/",
);
assert.equal(core.normalizeProductUrl("https://example.com/product/test"), "");
assert.equal(core.normalizeProductUrl("https://www.ozon.ru/seller/test"), "");

const selected = core.chooseCompetitorRow([
  { url: "https://www.ozon.ru/product/first-1/", price: "124,29 ₽" },
  { url: "https://www.ozon.ru/product/second-2/", price: "125,10 ₽" },
], 125.08);
assert.equal(selected.url, "https://www.ozon.ru/product/second-2/");
assert.equal(selected.price, 125.1);
assert.equal(core.chooseCompetitorRow([
  { url: "https://www.ozon.ru/product/wrong-3/", price: "130.00 ₽" },
], 125.08), null);

const contentSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/content.js", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));

assert.equal(manifest.version, "0.6.25");
assert.match(contentSource, /span\.pdp_h0b/);
assert.match(contentSource, /#mz-black-price-tag/);
assert.match(contentSource, /readBlackPriceFromProductUrl/);
assert.match(contentSource, /startBlackPriceLookup\(p\)/);
assert.match(contentSource, /competitorTriggerScore/);
assert.match(backgroundSource, /importScripts\("black-price-core\.js", "main-image-core\.js", "task-pricing-core\.js", "store-scanner-core\.js"\)/);
assert.match(backgroundSource, /files: \["black-price-core\.js", "content\.js", "store-scanner-core\.js", "store-scanner\.js"\]/);
assert.match(backgroundSource, /message\?\.type === "readBlackPriceFromProductUrl"/);
assert.match(backgroundSource, /chrome\.tabs\.remove\(tab\.id\)/);
assert.match(backgroundSource, /readOriginalBlackPriceWithQuickWakeup\(tab\.id, 6000, 6000\)/);
assert.match(backgroundSource, /chrome\.tabs\.query\(\{ active: true, windowId: tab\.windowId \}\)/);
assert.match(backgroundSource, /chrome\.tabs\.update\(tabId, \{ active: true \}\)/);
assert.match(backgroundSource, /if \(sourceTab\?\.active\)/);
assert.match(backgroundSource, /runWithForegroundTabWakeup/);
assert.match(backgroundSource, /wakeupUsed: false/);
assert.match(backgroundSource, /wakeupUsed: true/);
assert.doesNotMatch(backgroundSource, /chrome\.windows\.update\([^)]*focused:\s*true/);
assert.match(backgroundSource, /uniquePrices\.length === 1/);
assert.match(backgroundSource, /singlePrice:\s*true/);
assert.match(backgroundSource, /sourceGreenPrice/);
assert.match(backgroundSource, /singleStableCount >= 3/);
assert.match(backgroundSource, /!element\.closest\("#mz-black-price-tag"\)/);
assert.match(backgroundSource, /Math\.min\(900, Math\.max\(250, remainingMs\)\)/);
assert.doesNotMatch(backgroundSource, /waitForTabLoaded\(tab\.id, 20000, "跟卖商品页"\)/);

console.log("Black-price core and wiring tests passed.");
