# 1688 Full-Automation Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automatic 1688 image/keyword/similar-supplier sourcing pipeline that produces a final product confirmation queue without invoking Pinduoduo or MuMu during batch execution.

**Architecture:** The Chrome/Edge extension controls visible 1688 pages and persists short-lived browser jobs; the local Agent orchestrates search strategies, Qwen matching, deterministic SKU/cost gates, and final confirmation. Existing Pinduoduo MVP 5.3 remains isolated behind an explicit single-item button on the final confirmation screen.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript, Node.js ES modules, local HTTP Agent on `127.0.0.1:17628`, Alibaba Cloud Bailian `qwen3.7-flash`, PowerShell release tooling.

**Spec:** `docs/superpowers/specs/2026-08-31-1688-sourcing-provider-design.md`

## Global Constraints

- 1688 visible web pages are the only automatic batch sourcing channel.
- Automatic search order is image search, AI keyword search, then similar-product/supplier search.
- The automatic batch path must never call a Pinduoduo or MuMu endpoint.
- Pinduoduo MVP 5.3 is available only through an explicit single-item action on the final confirmation screen.
- Minimum order quantity greater than 2 is rejected; quantity 2 remains a candidate but cannot produce a confirmable single-unit cost without one-piece/sample evidence or an exact-product local exception.
- Qwen may choose a candidate and SKU but may not invent or calculate a page price.
- A confirmable recommendation requires `same_product`, confidence at least 85, consistent candidate evidence, a verified target SKU, a reproducible single-unit price, and known domestic shipping.
- Each strategy collects at most 12 lightweight candidates and opens at most 5 detail pages; the average end-to-end automatic stage target is at most 2.5 minutes per item, excluding time paused for platform verification.
- The final sourcing result is written only after the user clicks “确认采用”.
- Never click order, payment, contact-supplier, chat, or coupon controls.
- Login expiry, CAPTCHA, or account verification pauses the batch and preserves progress.
- Keep credentials, cookies, exported task data, supplier chats, runtime evidence, and diagnostics out of Git.
- Keep the existing `pinduoduo-agent` directory name for this release.
- Implementation release targets: extension `0.6.30`, local Agent `MVP 6.0`.
- Before implementation edits, create a dated rollback backup and rotate ordinary `_备份_...` directories to at most 5.

---

## File Map

**Create**

- `docs/superpowers/probes/2026-08-31-1688-browser-compatibility.md` — recorded result of the signed-in read-only compatibility gate.
- `tools/fixtures/1688-search-snapshot.json` — sanitized visible-node search fixture captured during the gate.
- `tools/fixtures/1688-detail-snapshot.json` — sanitized product/SKU fixture captured during the gate.
- `tools/fixtures/1688-two-unit-snapshot.json` — sanitized MOQ 2 fixture.
- `ozon-erp-collector-extension/1688-core.js` — pure 1688 parsing, normalization, filtering, and quote rules.
- `ozon-erp-collector-extension/1688-content.js` — visible-page commands and DOM-to-snapshot conversion.
- `ozon-erp-collector-extension/1688-background.js` — durable 1688 tab/job controller.
- `pinduoduo-agent/sourcing-core.mjs` — provider-neutral candidate, strategy, confirmation, and safety-gate rules.
- `pinduoduo-agent/qwen-transport.mjs` — shared DPAPI/environment credential loading and JSON Qwen transport.
- `pinduoduo-agent/sourcing-qwen.mjs` — 1688 keyword, candidate, and SKU Qwen requests.
- `pinduoduo-agent/public/sourcing-flow.js` — browser-side batch state machine and final confirmation transitions.
- `tools/test-1688-core.mjs` — pure 1688 parsing and cost tests.
- `tools/test-1688-extension.mjs` — extension job/bridge tests with a fake Chrome API.
- `tools/test-sourcing-agent-1688.mjs` — provider-neutral, Qwen normalization, UI-state, and Pinduoduo-isolation tests.

**Modify**

- `ozon-erp-collector-extension/manifest.json:1-32` — version, 1688 host permissions, and 1688 content scripts.
- `ozon-erp-collector-extension/background.js:1-10,1248-1295` — load and route the focused 1688 background module.
- `ozon-erp-collector-extension/pinduoduo-bridge.js:1-35` — add generic, allowlisted 1688 job messages while preserving final Ozon repricing.
- `pinduoduo-agent/server.mjs:1-18,686-735` — source-neutral status and new Qwen endpoints; keep old Pinduoduo endpoints.
- `pinduoduo-agent/qwen-client.mjs:1-261` — reuse the shared transport without changing legacy Pinduoduo prompts or normalization.
- `pinduoduo-agent/public/pricing-flow.js:1-74` — split non-mutating preview from confirmed write.
- `pinduoduo-agent/public/app.js:1-784` — MVP 6 orchestration, persistence migration, final confirmation, and explicit Pinduoduo deep search.
- `pinduoduo-agent/public/index.html:1-32` — source-neutral wording, 1688 controls, and confirmation queue.
- `pinduoduo-agent/public/styles.css` — strategy badges, blockers, and confirmation cards.
- `pinduoduo-agent/public/ai.css` — final AI evidence and safety-gate styling.
- `pinduoduo-agent/README.md` — 1688 prerequisites, automatic boundary, and test instructions.
- `tools/test-pinduoduo-agent.mjs` — legacy MVP 5.3 regression and explicit-only deep search assertions.
- `package.json:5-22` — add the three new test commands to the full suite.
- `真实浏览器验收清单.md` — MVP 6.0 signed-in 1688 and Pinduoduo isolation checks.
- `PROJECT_STATUS.md` and `CHANGELOG.md` — implementation, verification, release, and remaining real-world acceptance.

---

### Task 1: Pass the 1688 Browser Compatibility Gate

**Files:**
- Create: `docs/superpowers/probes/2026-08-31-1688-browser-compatibility.md`
- Create: `tools/fixtures/1688-search-snapshot.json`
- Create: `tools/fixtures/1688-detail-snapshot.json`
- Create: `tools/fixtures/1688-two-unit-snapshot.json`

**Interfaces:**
- Consumes: A user-signed-in Chrome/Edge 1688 session and one non-sensitive Ozon product image URL.
- Produces: Three sanitized fixtures shaped as `{ pageType, pageUrl, title, nodes, capturedAt }`, where each node is `{ text, href, imageUrl, ariaLabel, data, visible }`.

- [ ] **Step 1: Open a normal signed-in 1688 image-search page and verify the page is script-readable**

Use the Chrome browser control workflow to open the visible 1688 image-search entry, upload one Ozon main image, and run this read-only page expression:

```js
({
  pageUrl: location.href,
  title: document.title,
  itemLinks: [...document.querySelectorAll('a[href*="offer/"]')].slice(0, 20).map((a) => a.href),
  images: [...document.images].slice(0, 20).map((img) => img.currentSrc || img.src),
  loginBlocked: /登录|验证码|安全验证/.test(document.body.innerText),
})
```

Expected: at least one `detail.1688.com/offer/` link, at least one official image URL, and `loginBlocked: false`.

In the same visible page, verify the identified `input[type="file"]` accepts a programmatically constructed `File` through `DataTransfer` and reacts to a dispatched `change` event. If the site ignores or rejects this standard browser input path, mark the gate `FAIL`; fully automatic image search is not feasible under this design.

- [ ] **Step 2: Verify a product detail exposes visible SKU, MOQ, price, and shipping evidence**

Open one result in a visible tab and inspect only visible text/attributes:

```js
({
  pageUrl: location.href,
  title: document.title,
  visibleText: document.body.innerText.slice(0, 30000),
  offerLinks: [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((href) => /offer\/\d+\.html/.test(href)).slice(0, 20),
  controls: [...document.querySelectorAll('button,[role="button"],[aria-checked],[aria-selected]')].slice(0, 200).map((node) => ({
    text: (node.innerText || node.getAttribute('aria-label') || '').trim(),
    selected: node.getAttribute('aria-selected') || node.getAttribute('aria-checked') || '',
  })),
})
```

Expected: product URL plus visible evidence for title, price, MOQ, at least one SKU or explicit single-spec signal, and shipping/free-shipping or an explicit unknown state.

- [ ] **Step 3: Capture sanitized fixtures**

Store only the minimum node fields needed by parsers. Remove account names, phone numbers, chat text, cookies, tokens, tracking query strings, and unrelated recommendations. Normalize offer URLs to `https://detail.1688.com/offer/<digits>.html` and replace product-specific text with stable representative Chinese fixture text while retaining numeric structure.

Example fixture root:

```json
{
  "pageType": "search",
  "pageUrl": "https://s.1688.com/selloffer/offer_search.htm",
  "title": "1688找货",
  "nodes": [
    {
      "text": "测试商品 一件代发 ¥12.80 2件起批",
      "href": "https://detail.1688.com/offer/1234567890.html",
      "imageUrl": "https://cbu01.alicdn.com/img/example.jpg",
      "ariaLabel": "",
      "data": {},
      "visible": true
    }
  ],
  "capturedAt": "2026-08-31T00:00:00.000Z"
}
```

- [ ] **Step 4: Write the compatibility finding**

Record exact observed page hosts, result/detail URL patterns, official image hosts, stable visible anchors, and blockers. End with exactly one decision:

```markdown
## Gate decision

PASS — visible image search, result links, detail price, MOQ, SKU, and shipping evidence are script-readable.
```

If any required field is not readable, write `FAIL` with evidence and stop the implementation before Task 2. Do not add scraping workarounds.

- [ ] **Step 5: Review fixture safety**

Run:

```powershell
rg -n "cookie|token|authorization|手机号|旺旺|收货地址" tools/fixtures/1688-*.json docs/superpowers/probes/2026-08-31-1688-browser-compatibility.md
```

Expected: no secret, account, address, or chat content.

- [ ] **Step 6: Create the implementation rollback backup and rotate to five**

```powershell
$backupPath = "C:\Users\Microsoft\Documents\Ozon\_备份_20260831_1688_automatic_sourcing_before"
New-Item -ItemType Directory -Path $backupPath | Out-Null
Copy-Item -LiteralPath "C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension" -Destination $backupPath -Recurse
New-Item -ItemType Directory -Path (Join-Path $backupPath "pinduoduo-agent\public") | Out-Null
Get-ChildItem -LiteralPath "C:\Users\Microsoft\Documents\Ozon\pinduoduo-agent" -File | Copy-Item -Destination (Join-Path $backupPath "pinduoduo-agent")
Get-ChildItem -LiteralPath "C:\Users\Microsoft\Documents\Ozon\pinduoduo-agent\public" -File | Copy-Item -Destination (Join-Path $backupPath "pinduoduo-agent\public")
Copy-Item -LiteralPath "C:\Users\Microsoft\Documents\Ozon\PROJECT_STATUS.md" -Destination $backupPath
Copy-Item -LiteralPath "C:\Users\Microsoft\Documents\Ozon\CHANGELOG.md" -Destination $backupPath
$ordinaryBackups = Get-ChildItem -LiteralPath "C:\Users\Microsoft\Documents\Ozon" -Directory | Where-Object { $_.Name -like "_备份_*" } | Sort-Object LastWriteTime
while ($ordinaryBackups.Count -gt 5) {
  $oldest = $ordinaryBackups[0].FullName
  $resolved = (Resolve-Path -LiteralPath $oldest).Path
  if (-not $resolved.StartsWith("C:\Users\Microsoft\Documents\Ozon\_备份_")) { throw "备份轮换目标越界" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
  $ordinaryBackups = Get-ChildItem -LiteralPath "C:\Users\Microsoft\Documents\Ozon" -Directory | Where-Object { $_.Name -like "_备份_*" } | Sort-Object LastWriteTime
}
```

Expected: the new backup contains both code modules and the two status documents; exactly five ordinary backup directories remain.

- [ ] **Step 7: Commit the passed gate**

```powershell
git add -- docs/superpowers/probes/2026-08-31-1688-browser-compatibility.md tools/fixtures/1688-search-snapshot.json tools/fixtures/1688-detail-snapshot.json tools/fixtures/1688-two-unit-snapshot.json
git commit -m "test: record 1688 browser compatibility"
```

---

### Task 2: Implement Pure 1688 Parsing and Cost Rules

**Files:**
- Create: `ozon-erp-collector-extension/1688-core.js`
- Create: `tools/test-1688-core.mjs`
- Modify: `package.json:5-22`

**Interfaces:**
- Consumes: `nodes: Array<{text,href,imageUrl,ariaLabel,data,visible}>`, normalized detail URLs, and page metadata from Task 1.
- Produces: `globalThis.Ozon1688Core` with `parseSearchSnapshot(snapshot)`, `parseDetailSnapshot(snapshot)`, `normalizeCandidate(raw)`, `candidateBlockers(candidate)`, `singleUnitQuote(candidate, exception)`, and `nextSearchStrategy(attempts)`.

- [ ] **Step 1: Write failing fixture parsing tests**

Create `tools/test-1688-core.mjs` using the repository’s VM pattern:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../ozon-erp-collector-extension/1688-core.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: "1688-core.js" });
const core = context.Ozon1688Core;
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688-search-snapshot.json", import.meta.url), "utf8"));

const candidates = JSON.parse(JSON.stringify(core.parseSearchSnapshot(fixture)));
assert.equal(candidates[0].provider, "1688");
assert.match(candidates[0].sourceUrl, /^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/);
assert.equal(candidates[0].minimumOrderQuantity, 2);
assert.equal(core.nextSearchStrategy([]), "image");
assert.equal(core.nextSearchStrategy(["image"]), "keyword");
assert.equal(core.nextSearchStrategy(["image", "keyword"]), "similar_supplier");
assert.equal(core.nextSearchStrategy(["image", "keyword", "similar_supplier"]), "complete");
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node tools/test-1688-core.mjs`

Expected: FAIL because `1688-core.js` does not exist.

- [ ] **Step 3: Implement the UMD core and canonical types**

Start `1688-core.js` with this exact public shape:

```js
(function install1688Core(root) {
  "use strict";

  function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

  function canonicalOfferUrl(rawUrl) {
    try {
      const url = new URL(clean(rawUrl));
      const match = /^\/offer\/(\d+)\.html$/.exec(url.pathname);
      return url.protocol === "https:" && url.hostname === "detail.1688.com" && match
        ? `https://detail.1688.com/offer/${match[1]}.html`
        : "";
    } catch { return ""; }
  }

  root.Ozon1688Core = {
    parseSearchSnapshot,
    parseDetailSnapshot,
    normalizeCandidate,
    candidateBlockers,
    singleUnitQuote,
    nextSearchStrategy,
    canonicalOfferUrl,
  };
})(globalThis);
```

Use this normalized candidate contract:

```js
{
  provider: "1688",
  candidateId: "1688-<offerId>",
  productId: "<offerId>",
  sourceUrl: "https://detail.1688.com/offer/<offerId>.html",
  title: "",
  imageUrl: "",
  supplierName: "",
  minimumOrderQuantity: null,
  supportsOnePiece: false,
  supportsSample: false,
  pricing: {
    displayedPrice: null,
    onePiecePrice: null,
    samplePrice: null,
    tiers: [],
    selectedSkuPrice: null,
    priceSource: "unknown"
  },
  shipping: { status: "unknown", fee: null },
  sku: { dimensions: [], options: [], selectedOptionId: null, selectionVerified: false },
  detailStatus: "search_only",
  evidence: null
}
```

- [ ] **Step 4: Write failing MOQ and quote tests**

Add:

```js
assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/1.html",
  title: "测试商品",
  minimumOrderQuantity: 3,
  pricing: { selectedSkuPrice: 10 },
  shipping: { status: "free", fee: 0 },
}))).blockers, ["minimum_order_quantity_gt_2"]);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/2.html",
  title: "测试商品",
  minimumOrderQuantity: 2,
  supportsOnePiece: false,
  supportsSample: false,
  pricing: { selectedSkuPrice: 10, priceSource: "tier" },
  shipping: { status: "free", fee: 0 },
}))).blockers, ["single_unit_price_unverified"]);

assert.deepEqual(JSON.parse(JSON.stringify(core.singleUnitQuote({
  sourceUrl: "https://detail.1688.com/offer/3.html",
  title: "测试商品",
  minimumOrderQuantity: 2,
  supportsSample: true,
  pricing: { samplePrice: 12.5, priceSource: "sample" },
  shipping: { status: "known", fee: 3 },
}))), {
  confirmable: true,
  productPrice: 12.5,
  domesticShipping: 3,
  purchaseCost: 15.5,
  priceSource: "sample",
  blockers: []
});

const twoUnitCandidate = {
  productId: "4",
  sourceUrl: "https://detail.1688.com/offer/4.html",
  title: "测试商品",
  minimumOrderQuantity: 2,
  pricing: { selectedSkuPrice: 10, priceSource: "tier" },
  shipping: { status: "free", fee: 0 },
};
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "4", sourceUrl: twoUnitCandidate.sourceUrl, onePiecePrice: 11, confirmedAt: "2026-08-31T00:00:00.000Z" }).purchaseCost, 11);
assert.equal(core.singleUnitQuote(twoUnitCandidate, { productId: "different", sourceUrl: "https://detail.1688.com/offer/5.html", onePiecePrice: 9 }).confirmable, false);
```

- [ ] **Step 5: Run the test and verify the new cases fail**

Run: `node tools/test-1688-core.mjs`

Expected: FAIL until MOQ, sample, shipping, and two-decimal cost rules are implemented.

- [ ] **Step 6: Implement candidate blockers and single-unit quote**

Use deterministic blockers only:

```js
function candidateBlockers(candidate) {
  const blockers = [];
  if (Number(candidate?.minimumOrderQuantity) > 2) blockers.push("minimum_order_quantity_gt_2");
  if (!candidate?.sourceUrl) blockers.push("missing_source_url");
  if (!candidate?.title) blockers.push("missing_title");
  return blockers;
}

function singleUnitQuote(candidate, exception = null) {
  const blockers = candidateBlockers(candidate);
  const moq = Number(candidate?.minimumOrderQuantity);
  const pricing = candidate?.pricing || {};
  const exactException = exception?.productId === candidate?.productId
    && exception?.sourceUrl === candidate?.sourceUrl
    && Number(exception?.onePiecePrice) > 0 ? Number(exception.onePiecePrice) : null;
  const price = exactException ? exactException
    : Number(pricing.onePiecePrice) > 0 ? Number(pricing.onePiecePrice)
    : Number(pricing.samplePrice) > 0 ? Number(pricing.samplePrice)
      : moq <= 1 && Number(pricing.selectedSkuPrice) > 0 ? Number(pricing.selectedSkuPrice)
        : null;
  if (!(price > 0)) blockers.push(moq === 2 ? "single_unit_price_unverified" : "missing_single_unit_price");
  if (!candidate?.shipping || candidate.shipping.status === "unknown") blockers.push("shipping_unknown");
  const shipping = candidate?.shipping?.status === "free" ? 0 : Number(candidate?.shipping?.fee);
  if (!Number.isFinite(shipping) || shipping < 0) blockers.push("shipping_unknown");
  const unique = [...new Set(blockers)];
  return {
    confirmable: unique.length === 0,
    productPrice: price ? Number(price.toFixed(2)) : null,
    domesticShipping: Number.isFinite(shipping) ? Number(shipping.toFixed(2)) : null,
    purchaseCost: unique.length === 0 ? Number((price + shipping).toFixed(2)) : null,
    priceSource: exactException ? "manual_exact_product_exception" : String(pricing.priceSource || "unknown"),
    blockers: unique,
  };
}
```

- [ ] **Step 7: Add the test command and run it**

Add to `package.json`:

```json
"test:1688-core": "node tools/test-1688-core.mjs"
```

Run: `npm.cmd run test:1688-core`

Expected: PASS.

- [ ] **Step 8: Commit the pure core**

```powershell
git add -- ozon-erp-collector-extension/1688-core.js tools/test-1688-core.mjs package.json
git commit -m "feat: add 1688 sourcing core"
```

---

### Task 3: Add the Durable 1688 Extension Job Driver

**Files:**
- Create: `ozon-erp-collector-extension/1688-content.js`
- Create: `ozon-erp-collector-extension/1688-background.js`
- Create: `tools/test-1688-extension.mjs`
- Modify: `ozon-erp-collector-extension/manifest.json:1-32`
- Modify: `ozon-erp-collector-extension/background.js:1-10,1248-1295`
- Modify: `package.json:5-22`

**Interfaces:**
- Consumes: `Ozon1688Core`, a trusted Ozon image URL, a strategy `{type:"image"|"keyword"|"similar_supplier"|"verify_sku", query?:string, sourceUrl?:string, optionId?:string, optionLabel?:string, expectedPrice?:number}`, and Chrome tabs/storage APIs.
- Produces: `Ozon1688Background.startJob(request) -> job` with `jobId` and `status:"queued"`, `getJob(jobId) -> job`, `cancelJob(jobId) -> job`; content messages `OZON_1688_PAGE_COMMAND_V1` and `OZON_1688_PAGE_RESULT_V1`; local evidence references returned by the Agent.

- [ ] **Step 1: Write failing manifest and background wiring tests**

Create `tools/test-1688-extension.mjs` and assert:

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));
assert.equal(manifest.version, "0.6.30");
assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
assert.ok(manifest.host_permissions.includes("https://*.ozone.ru/*"));
assert.ok(manifest.host_permissions.includes("https://*.alicdn.com/*"));
const content = manifest.content_scripts.find((entry) => entry.matches.includes("https://*.1688.com/*"));
assert.deepEqual(content.js, ["1688-core.js", "1688-content.js"]);

const background = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
assert.match(background, /importScripts\("1688-core\.js", "1688-background\.js"\)/);
assert.match(background, /start1688SourcingJob/);
assert.match(background, /get1688SourcingJob/);
assert.match(background, /cancel1688SourcingJob/);
```

- [ ] **Step 2: Run the wiring test and verify it fails**

Run: `node tools/test-1688-extension.mjs`

Expected: FAIL on version, permissions, files, and handlers.

- [ ] **Step 3: Add the manifest permissions and content scripts**

Set version `0.6.30`, add only:

```json
"https://*.1688.com/*",
"https://*.ozone.ru/*",
"https://*.alicdn.com/*"
```

Add a content-script entry:

```json
{
  "matches": ["https://*.1688.com/*"],
  "js": ["1688-core.js", "1688-content.js"],
  "run_at": "document_idle"
}
```

Do not add `<all_urls>` or cookie permissions.

- [ ] **Step 4: Implement the content command boundary**

`1688-content.js` must expose only these commands:

```js
const ALLOWED_COMMANDS = new Set([
  "probe",
  "submit_image_search",
  "submit_keyword_search",
  "read_search_results",
  "read_product_detail",
  "read_sku_options",
  "select_sku_option",
]);
```

Convert visible DOM to sanitized snapshots:

```js
function visibleNodeSnapshot(root = document) {
  return [...root.querySelectorAll("a,img,button,[role='button'],[aria-selected],[aria-checked],[data-offer-id]")]
    .filter((node) => node.getClientRects().length > 0)
    .slice(0, 2000)
    .map((node) => ({
      text: String(node.innerText || node.alt || "").replace(/\s+/g, " ").trim().slice(0, 500),
      href: node.href || "",
      imageUrl: node.currentSrc || node.src || "",
      ariaLabel: node.getAttribute("aria-label") || "",
      data: { offerId: node.getAttribute("data-offer-id") || "" },
      visible: true,
    }));
}
```

The image/keyword submitters may click only an identified upload/search control. `select_sku_option` may click only the exact option ID/label supplied by the Agent, then must read an `aria-selected`/`aria-checked`/selected-class or visible “已选” equivalent and the resulting normal price twice. Every command must reject selectors containing order, payment, contact, chat, coupon, or purchase semantics.

For image search, the background validates the existing Ozon image allowlist, downloads at most 15 MB from HTTPS `*.ozone.ru`, and sends the bytes plus MIME type to the content script. For similar-supplier expansion it may perform the same operation with the selected candidate image after validating an HTTPS `*.alicdn.com` or other Task 1 documented official 1688 image host. The content script creates a `File`, assigns it through `DataTransfer` to the verified upload input, and dispatches `input` and `change`. Do not use clipboard automation or a local filesystem picker.

- [ ] **Step 5: Implement persistent job records**

`1688-background.js` uses storage key `ozon1688Job:<jobId>` and this shape:

```js
{
  jobId: "1688-<requestId>",
  taskId: "ozon-<sku>",
  strategy: { type: "image", query: "", sourceUrl: "" },
  status: "queued|running|completed|failed|paused_platform_verification|cancelled",
  tabId: null,
  candidates: [],
  detailCandidates: [],
  error: "",
  diagnostics: null,
  startedAt: "",
  updatedAt: "",
  completedAt: ""
}
```

Use one active 1688 job at a time. Before every transition, write the job to `chrome.storage.local`. Close only tabs created by this job; never close a pre-existing user tab.

After each inspected detail, capture the active job tab as JPEG quality 60 with `chrome.tabs.captureVisibleTab`. If the resulting bytes are at most 1 MB, POST the binary JPEG to `http://127.0.0.1:17628/api/evidence/1688?taskId=<encoded>&candidateId=<encoded>` with `x-ozon-agent: local-ui-v1`, then retain only the returned `localRef`. If screenshot capture is unavailable or exceeds 1 MB, retain the sanitized page snapshot and candidate image URL as evidence and set `screenshotStatus: "capture_failed"`; do not discard an otherwise complete candidate.

- [ ] **Step 6: Route focused background messages**

At the top of `background.js`:

```js
importScripts("1688-core.js", "1688-background.js");
```

Add message routes:

```js
else if (message?.type === "start1688SourcingJob") operation = Ozon1688Background.startJob(message.request);
else if (message?.type === "get1688SourcingJob") operation = Ozon1688Background.getJob(message.jobId);
else if (message?.type === "cancel1688SourcingJob") operation = Ozon1688Background.cancelJob(message.jobId);
```

- [ ] **Step 7: Add fake-Chrome lifecycle tests**

Test these exact transitions:

```js
assert.equal((await api.startJob(validImageRequest)).status, "queued");
assert.equal((await api.getJob(jobId)).status, "completed");
assert.equal((await api.cancelJob(jobId)).status, "cancelled");
assert.equal(fakeChrome.calls.some((call) => /pinduoduo|yangkeduo|mumu/i.test(JSON.stringify(call))), false);
```

Also test login/CAPTCHA text produces `paused_platform_verification`, and a page parser failure stores diagnostics without guessing candidates.

Add download tests that reject HTTP, non-Ozon hosts, non-image content types, empty images, and payloads over 15 MB.

Add a SKU verification test where `select_sku_option` accepts only the requested option, confirms the page selected state, and rejects a changed price or any candidate node whose text contains order/payment/contact/chat semantics.

Add result-cap tests proving every search command returns at most 12 normalized lightweight candidates and the controller opens at most 5 complete detail pages for one strategy.

Add an evidence test that posts at most 1 MB of JPEG bytes to the exact local endpoint, persists only `localRef`, and never stores a base64 screenshot in `chrome.storage.local`.

- [ ] **Step 8: Add and run the extension test command**

Add:

```json
"test:1688-extension": "node tools/test-1688-extension.mjs"
```

Run: `npm.cmd run test:1688-extension`

Expected: PASS.

- [ ] **Step 9: Commit the extension driver**

```powershell
git add -- ozon-erp-collector-extension/manifest.json ozon-erp-collector-extension/1688-content.js ozon-erp-collector-extension/1688-background.js ozon-erp-collector-extension/background.js tools/test-1688-extension.mjs package.json
git commit -m "feat: automate 1688 browser sourcing jobs"
```

---

### Task 4: Extend the Local Extension Bridge with Allowlisted Jobs

**Files:**
- Modify: `ozon-erp-collector-extension/pinduoduo-bridge.js:1-35`
- Modify: `tools/test-1688-extension.mjs`

**Interfaces:**
- Consumes: same-window messages from exact origin `http://127.0.0.1:17628`.
- Produces: window request `OZON_SOURCING_EXTENSION_REQUEST_V1`, response `OZON_SOURCING_EXTENSION_RESPONSE_V1`, actions `start_1688_job|get_1688_job|cancel_1688_job`; existing Ozon final repricing messages remain unchanged.

- [ ] **Step 1: Write failing bridge validation tests**

Add assertions for the source text and run the bridge in a VM with fake `window` and `chrome.runtime.sendMessage`. Required cases:

```js
function postBridgeMessage(data) {
  windowMessageListener({ source: fakeWindow, origin: "http://127.0.0.1:17628", data });
}

postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "request-123", taskId: "ozon-1", mainImageUrl: "https://ir.ozone.ru/s3/multimedia-x/a.jpg" });
assert.equal(runtimeMessages.at(-1).type, "start1688SourcingJob");

const countAfterValid = runtimeMessages.length;
postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "start_1688_job", requestId: "request-124", taskId: "ozon-1", mainImageUrl: "https://evil.example/a.jpg" });
postBridgeMessage({ type: "OZON_SOURCING_EXTENSION_REQUEST_V1", action: "launch_pinduoduo", requestId: "request-125" });
assert.equal(runtimeMessages.length, countAfterValid);
```

- [ ] **Step 2: Run the bridge tests and verify failure**

Run: `npm.cmd run test:1688-extension`

Expected: FAIL because the new request types are absent.

- [ ] **Step 3: Implement the generic sourcing bridge**

Keep the current final repricing block intact. Add:

```js
const SOURCING_REQUEST = "OZON_SOURCING_EXTENSION_REQUEST_V1";
const SOURCING_RESPONSE = "OZON_SOURCING_EXTENSION_RESPONSE_V1";
const SOURCING_ACTIONS = {
  start_1688_job: "start1688SourcingJob",
  get_1688_job: "get1688SourcingJob",
  cancel_1688_job: "cancel1688SourcingJob",
};
```

Validate `requestId`, `taskId`, trusted Ozon main image URL, job ID, and action-specific fields. Never forward arbitrary runtime message types from page data.

- [ ] **Step 4: Verify request correlation and timeout behavior**

Test that each response echoes the exact `requestId`, runtime errors become `{ok:false,error}`, and an unknown action is rejected before `chrome.runtime.sendMessage`.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:1688-extension`

Expected: PASS.

```powershell
git add -- ozon-erp-collector-extension/pinduoduo-bridge.js tools/test-1688-extension.mjs
git commit -m "feat: bridge local agent to 1688 jobs"
```

---

### Task 5: Add Provider-Neutral Safety Rules and 1688 Qwen Calls

**Files:**
- Create: `pinduoduo-agent/sourcing-core.mjs`
- Create: `pinduoduo-agent/qwen-transport.mjs`
- Create: `pinduoduo-agent/sourcing-qwen.mjs`
- Create: `tools/test-sourcing-agent-1688.mjs`
- Modify: `pinduoduo-agent/qwen-client.mjs:1-261`
- Modify: `pinduoduo-agent/server.mjs:1-18,686-735`
- Modify: `package.json:5-22`

**Interfaces:**
- Consumes: normalized 1688 candidates from Task 2 and trusted Ozon task images.
- Produces: shared `loadQwenCredential()` and `requestQwenJson(options)` transport; `normalizeSourcingCandidate`, `normalizeKeywordResult`, `recommendationSafetyGate`, `buildFinalConfirmation`, `confirmRecommendation`, `rejectRecommendation`, `generate1688Keywords`, `judge1688Candidates`, `select1688Sku`; HTTP endpoints `/api/ai/1688-keywords`, `/api/ai/1688-judge`, `/api/ai/1688-select-sku`, and binary `/api/evidence/1688`.

- [ ] **Step 1: Write failing provider-neutral safety tests**

Create `tools/test-sourcing-agent-1688.mjs`:

```js
import assert from "node:assert/strict";
import { buildFinalConfirmation, confirmRecommendation, recommendationSafetyGate } from "../pinduoduo-agent/sourcing-core.mjs";

const candidate = {
  provider: "1688",
  candidateId: "1688-1",
  sourceUrl: "https://detail.1688.com/offer/1.html",
  title: "测试商品",
  minimumOrderQuantity: 1,
  pricing: { selectedSkuPrice: 20, priceSource: "selected_sku" },
  shipping: { status: "known", fee: 3 },
  sku: { selectedOptionId: "sku-1", selectionVerified: true },
};
const judgement = {
  verdict: "same_product",
  confidence: 92,
  bestCandidateId: "1688-1",
  needsHumanReview: false,
  candidateAssessments: [{ candidateId: "1688-1", verdict: "same_product", confidence: 92, differences: [] }],
};
const quote = { confirmable: true, productPrice: 20, domesticShipping: 3, purchaseCost: 23, priceSource: "selected_sku", blockers: [] };

assert.deepEqual(recommendationSafetyGate(candidate, judgement, quote).blockers, []);
const pending = buildFinalConfirmation({ candidate, judgement, quote, finalPricing: { eligibleAt18Pct: true } });
assert.equal(pending.status, "final_confirmation_pending");
assert.equal(pending.purchaseCost, 23);
const task = { sourcing: {}, pricing: {} };
confirmRecommendation(task, pending, "2026-08-31T00:00:00.000Z");
assert.equal(task.sourcing.status, "confirmed_purchase_source");
assert.equal(task.pricing.purchaseCost, 23);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node tools/test-sourcing-agent-1688.mjs`

Expected: FAIL because `sourcing-core.mjs` does not exist.

- [ ] **Step 3: Implement the safety gate and final confirmation contract**

The safety gate must add explicit blocker codes for:

```js
[
  "judgement_not_same_product",
  "confidence_below_85",
  "candidate_assessment_conflict",
  "critical_spec_difference",
  "sku_not_verified",
  "single_unit_price_unverified",
  "shipping_unknown",
  "price_changed",
  "minimum_order_quantity_gt_2"
]
```

`buildFinalConfirmation` must not mutate the task. `confirmRecommendation` is the only new function allowed to write `task.pricing.purchaseCost` and `task.pricing.sourceUrl`.

`recommendationSafetyGate(candidate, judgement, quote)` must reject a quote unless `confirmable === true`, blockers are empty, all three monetary fields are finite non-negative numbers, and `purchaseCost === productPrice + domesticShipping` after two-decimal rounding.

- [ ] **Step 4: Write failing keyword normalization tests**

```js
import { normalizeKeywordResult } from "../pinduoduo-agent/sourcing-core.mjs";

assert.deepEqual(normalizeKeywordResult({ keywords: ["汽车 螺丝刀", "汽车 螺丝刀", "品牌X 型号Y"] }, { allowedBrand: "", allowedModel: "" }), ["汽车 螺丝刀"]);
assert.deepEqual(normalizeKeywordResult({ keywords: ["丝杠 组合 更换设备", "滚珠丝杠 维修套装"] }, {}), ["丝杠 组合 更换设备", "滚珠丝杠 维修套装"]);
```

Remove duplicate keywords, limit to three, limit each to 40 characters, and reject a brand/model token not present in Ozon evidence.

- [ ] **Step 5: Extract the shared Qwen transport**

Move the existing environment/DPAPI credential loader and compatible-mode JSON request into `qwen-transport.mjs`:

```js
export async function loadQwenCredential() {}
export async function requestQwenJson({ content, temperature, maxTokens, timeoutMs = 90000 }) {}
```

`requestQwenJson` must keep `response_format: { type: "json_object" }`, `enable_thinking: false`, configured `QWEN_MODEL` fallback to `qwen3.7-flash`, the existing Bailian endpoint, redacted errors, and no credential logging. Refactor `qwen-client.mjs` to use this transport without changing its Pinduoduo prompts or return contracts.

- [ ] **Step 6: Run the legacy Qwen/static tests after extraction**

Run: `npm.cmd run test:pinduoduo-agent`

Expected: PASS with unchanged legacy prompt and normalization assertions.

- [ ] **Step 7: Implement 1688 Qwen requests**

Use `requestQwenJson` without copying credential logic. `sourcing-qwen.mjs` exports:

```js
export async function generate1688Keywords(task) {}
export async function judge1688Candidates(task, candidates) {}
export async function select1688Sku(task, candidate, skuOptions) {}
export function isTrusted1688ImageUrl(rawUrl) {}
```

Trusted image hosts are HTTPS subdomains of `alicdn.com`, `1688.com`, or an additional exact official host documented and tested in Task 1. The prompt must state that price is not match evidence and the model must not invent brand, model, SKU, price, MOQ, or shipping.

- [ ] **Step 8: Add server endpoints without changing Pinduoduo endpoints**

Import the new functions and add:

```js
if (request.method === "POST" && url.pathname === "/api/ai/1688-keywords") {
  return json(response, 200, { ok: true, ...(await generate1688Keywords(await readJsonBody(request))) });
}
if (request.method === "POST" && url.pathname === "/api/ai/1688-judge") {
  const body = await readJsonBody(request);
  return json(response, 200, { ok: true, ...(await judge1688Candidates(body.task, body.candidates)) });
}
if (request.method === "POST" && url.pathname === "/api/ai/1688-select-sku") {
  const body = await readJsonBody(request);
  return json(response, 200, { ok: true, ...(await select1688Sku(body.task, body.candidate, body.skuOptions)) });
}
```

Keep `/api/task/search` and every `/api/pinduoduo/*` endpoint unchanged for explicit legacy use.

Add a binary evidence route before JSON body parsing. Accept only `image/jpeg`, require numeric-safe/sanitized task and candidate IDs, cap the body at 1 MB, write under `pinduoduo-agent/runtime/evidence/<safe-task>/1688-<safe-candidate>.jpg`, and return `{ok:true,localRef:"/api/evidence/..."}`. Reject path traversal, wrong content type, empty bodies, and oversized bodies.

- [ ] **Step 9: Test endpoint wiring and hostile model output**

Add static endpoint assertions plus normalization tests where the model returns a nonexistent candidate, nonexistent SKU, 101 confidence, duplicate keywords, invented model text, or a contradictory 95% result. All must be clamped, rejected, or moved to blockers.

- [ ] **Step 10: Add and run the test command**

Add:

```json
"test:sourcing-agent-1688": "node tools/test-sourcing-agent-1688.mjs"
```

Run:

```powershell
npm.cmd run test:sourcing-agent-1688
npm.cmd run test:pinduoduo-agent
```

Expected: both PASS.

- [ ] **Step 11: Commit the source-neutral Agent core**

```powershell
git add -- pinduoduo-agent/sourcing-core.mjs pinduoduo-agent/qwen-transport.mjs pinduoduo-agent/sourcing-qwen.mjs pinduoduo-agent/qwen-client.mjs pinduoduo-agent/server.mjs tools/test-sourcing-agent-1688.mjs package.json
git commit -m "feat: add 1688 sourcing decisions"
```

---

### Task 6: Split Ozon Pricing Preview from Confirmed Purchase Writes

**Files:**
- Modify: `pinduoduo-agent/public/pricing-flow.js:1-74`
- Modify: `pinduoduo-agent/public/app.js:350-400`
- Modify: `tools/test-pinduoduo-agent.mjs`
- Modify: `tools/test-sourcing-agent-1688.mjs`

**Interfaces:**
- Consumes: candidate purchase cost and current Ozon repricing response.
- Produces: `previewFinalOzonPricing(task,response,purchaseCost,fetchedAt) -> preview` without task mutation; existing `applyFinalOzonPricing` remains for legacy Pinduoduo; confirmed 1688 writes go through `confirmRecommendation` from Task 5.

- [ ] **Step 1: Write the failing no-mutation preview test**

```js
import { previewFinalOzonPricing } from "../pinduoduo-agent/public/pricing-flow.js";

const task = { enrichment: { maxPurchaseCostAt18Pct: 50 }, pricing: {} };
const before = JSON.stringify(task);
const preview = previewFinalOzonPricing(task, {
  ok: true,
  maxPurchaseCostAt18Pct: 36.17,
  effectiveGreenPrice: 121.18,
  originalBlackPrice: 128.95,
  internationalFreight: 52.52,
  selectedCommission: 20,
  calculation: {}
}, 23, "2026-08-31T00:00:00.000Z");
assert.equal(preview.eligibleAt18Pct, true);
assert.equal(JSON.stringify(task), before);
```

- [ ] **Step 2: Run and verify failure**

Run: `npm.cmd run test:pinduoduo-agent`

Expected: FAIL because the preview function is absent.

- [ ] **Step 3: Implement the pure preview**

Return the same computed fields used by `applyFinalOzonPricing`, but do not assign to `task.ozon`, `task.enrichment`, `task.pricing`, or `task.audit`.

```js
export function previewFinalOzonPricing(task, response, purchaseCost, fetchedAt = new Date().toISOString()) {
  const limit = Number(response?.maxPurchaseCostAt18Pct);
  if (!response?.ok || !(limit >= 0)) throw new Error("Ozon最终复价响应不完整。");
  return {
    status: "completed",
    fetchedAt,
    purchaseCost: Number(Number(purchaseCost).toFixed(2)),
    maxPurchaseCostAt18Pct: Number(limit.toFixed(2)),
    eligibleAt18Pct: Number(purchaseCost) <= limit,
    effectiveGreenPrice: Number(response.effectiveGreenPrice) || null,
    originalBlackPrice: Number(response.originalBlackPrice) || null,
    internationalFreight: Number(response.internationalFreight) || null,
    selectedCommission: Number(response.selectedCommission) || null,
    calculation: response.calculation || null,
  };
}
```

- [ ] **Step 4: Refactor legacy apply to reuse preview and preserve behavior**

`applyFinalOzonPricing` calls `previewFinalOzonPricing`, then performs the existing legacy assignments. Existing Pinduoduo assertions must remain unchanged.

- [ ] **Step 5: Run both pricing suites**

```powershell
npm.cmd run test:pinduoduo-agent
npm.cmd run test:sourcing-agent-1688
```

Expected: PASS, including legacy mutation and new preview immutability.

- [ ] **Step 6: Commit the pricing boundary**

```powershell
git add -- pinduoduo-agent/public/pricing-flow.js pinduoduo-agent/public/app.js tools/test-pinduoduo-agent.mjs tools/test-sourcing-agent-1688.mjs
git commit -m "refactor: preview sourcing profit before confirmation"
```

---

### Task 7: Build the Automatic Batch State Machine and Final Confirmation UI

**Files:**
- Create: `pinduoduo-agent/public/sourcing-flow.js`
- Modify: `pinduoduo-agent/public/app.js:1-784`
- Modify: `pinduoduo-agent/public/index.html:1-32`
- Modify: `pinduoduo-agent/public/styles.css`
- Modify: `pinduoduo-agent/public/ai.css`
- Modify: `tools/test-sourcing-agent-1688.mjs`
- Modify: `tools/test-pinduoduo-agent.mjs`

**Interfaces:**
- Consumes: extension job start/status/cancel bridge, Agent 1688 Qwen endpoints, `previewFinalOzonPricing`, and Task 5 safety/confirmation contracts.
- Produces: `runAutomatic1688Task(task)`, `runAutomatic1688Batch()`, `confirmFinalCandidate(taskId)`, `rejectFinalCandidate(taskId)`, `saveSingleUnitException(taskId, price)`, `startSinglePinduoduoDeepSearch(taskId)`; persistent task fields `searchAttempts`, `searchStrategy`, `finalConfirmation`, and `confirmedCandidate`.

- [ ] **Step 1: Write failing state-machine tests**

Export pure functions from `sourcing-flow.js` and test:

```js
import { nextAutomaticAction, promoteNextCandidate } from "../pinduoduo-agent/public/sourcing-flow.js";

assert.equal(nextAutomaticAction({ searchAttempts: [] }).type, "start_image_search");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }] }).type, "generate_keywords");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }, { strategy: "keyword", usableCount: 0 }] }).type, "start_similar_supplier_search");
assert.equal(nextAutomaticAction({ searchAttempts: [{ strategy: "image", usableCount: 0 }, { strategy: "keyword", usableCount: 0 }, { strategy: "similar_supplier", usableCount: 0 }] }).type, "queue_no_source_confirmation");
assert.equal(promoteNextCandidate([{ candidateId: "a" }, { candidateId: "b" }], ["a"]).candidateId, "b");
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd run test:sourcing-agent-1688`

Expected: FAIL because `sourcing-flow.js` is absent.

- [ ] **Step 3: Implement the pure automatic action reducer**

Use these action types only:

```js
[
  "start_image_search",
  "generate_keywords",
  "start_keyword_search",
  "start_similar_supplier_search",
  "judge_candidates",
  "select_target_sku",
  "preview_final_pricing",
  "queue_final_confirmation",
  "queue_no_source_confirmation",
  "pause_platform_verification",
  "complete"
]
```

No reducer branch may return a Pinduoduo action.

- [ ] **Step 4: Migrate browser storage without losing MVP 5.3 history**

Use:

```js
const storageKey = "ozon-sourcing-agent-mvp6";
const legacyStorageKeys = ["ozon-pinduoduo-agent-mvp3"];
```

On first load, read the new key; if absent, copy the first valid legacy queue to the new key without deleting the legacy key. Add `queue.meta.sourcingSchema = "mvp6"` and preserve all existing task fields.

- [ ] **Step 5: Implement the bridge client and polling**

Add a single request helper:

```js
async function sourcingExtensionRequest(action, payload = {}, timeoutMs = 15000) {}
```

Start returns a job ID. Poll `get_1688_job` every 1000 ms. Use explicit budgets of 45 seconds for one search page, 15 seconds for one detail/SKU page, 75 seconds for one Qwen request, and 150 seconds for the complete image → keyword → similar-supplier automatic sequence. Persist task state after every returned status. A stage timeout stores its diagnostics and advances only when the strategy rules permit; the 150-second overall timeout queues the task with an explicit `automatic_timeout` blocker. Time spent in `paused_platform_verification` is excluded from elapsed sourcing time; on that state, stop the whole batch and preserve the cursor.

- [ ] **Step 6: Implement the three automatic search strategies**

`runAutomatic1688Task` must:

1. start image job;
2. if no usable candidate, call `/api/ai/1688-keywords` and run up to three keyword queries;
3. if still no usable candidate, run the similar-supplier strategy by submitting the best partial candidate’s trusted main image back through 1688 image search and deduplicating the returned offer URLs;
4. collect at most 12 lightweight candidates and inspect at most five complete details per strategy;
5. deduplicate by canonical offer URL;
6. call `/api/ai/1688-judge` and `/api/ai/1688-select-sku`, then start a `verify_sku` extension job for the exact option and require selected-state plus repeated-price verification;
7. calculate the deterministic cost quote and final Ozon pricing preview;
8. create `finalConfirmation` without writing final purchase fields.

- [ ] **Step 7: Add the final confirmation queue HTML**

Change title and primary controls to “采购找品 Agent” and “批量自动找货源”. Add a section after timing:

```html
<section class="panel confirmation-panel">
  <div class="confirmation-head">
    <div><h2>最终商品确认</h2><p>系统已完成找款、同款判断、目标规格核验和利润试算；确认后才写入采购结果。</p></div>
    <strong id="confirmationSummary">待确认0件</strong>
  </div>
  <div id="confirmationRows" class="confirmation-rows"></div>
</section>
```

Each card shows Ozon image/name/SKU, candidate image/title/supplier/link, confidence, differences, target SKU, product price, domestic shipping, purchase cost, final 18% result, blockers, and evidence.

For an MOQ 2 candidate with no page-proven one-piece/sample price, the same final card may show “确认客服可一件采购” plus a required single-unit price input. Saving creates `queue.meta.singleUnitExceptions[productId] = { productId, sourceUrl, onePiecePrice, confirmedAt }`. Reuse requires exact `productId` and canonical `sourceUrl`; never apply the exception to another product from the same supplier.

- [ ] **Step 8: Implement confirmation actions**

- “确认采用” calls `confirmRecommendation`, persists, and marks `confirmed_purchase_source`.
- “否决并尝试下一候选” stores the rejected candidate ID, promotes the next safe candidate, reruns SKU/cost/pricing preview, and stays on the final queue.
- “确认客服可一件采购” validates a positive two-decimal price, saves the exact-product exception, recalculates the quote and Ozon preview, and still requires a separate “确认采用”.
- “单品拼多多深度补搜” is the only UI action allowed to call existing `/api/task/search`; show an explicit confirmation that MuMu will open for this one task.

- [ ] **Step 9: Prove automatic batch isolation**

Add static and reducer tests:

```js
const appSource = fs.readFileSync(new URL("../pinduoduo-agent/public/app.js", import.meta.url), "utf8");
const batchBody = appSource.slice(appSource.indexOf("async function runAutomatic1688Batch"), appSource.indexOf("async function startSinglePinduoduoDeepSearch"));
assert.doesNotMatch(batchBody, /\/api\/pinduoduo\//);
assert.doesNotMatch(batchBody, /\/api\/task\/search/);
assert.match(appSource, /startSinglePinduoduoDeepSearch[\s\S]*\/api\/task\/search/);
```

Add fake-clock assertions that the complete automatic sequence stops at 150 seconds with `automatic_timeout`, and that time in `paused_platform_verification` is not charged to the sourcing duration.

- [ ] **Step 10: Run UI and legacy tests**

```powershell
npm.cmd run test:sourcing-agent-1688
npm.cmd run test:pinduoduo-agent
node --check pinduoduo-agent/public/app.js
node --check pinduoduo-agent/public/sourcing-flow.js
```

Expected: PASS.

- [ ] **Step 11: Commit the MVP 6 UI and flow**

```powershell
git add -- pinduoduo-agent/public/sourcing-flow.js pinduoduo-agent/public/app.js pinduoduo-agent/public/index.html pinduoduo-agent/public/styles.css pinduoduo-agent/public/ai.css tools/test-sourcing-agent-1688.mjs tools/test-pinduoduo-agent.mjs
git commit -m "feat: add automatic 1688 confirmation flow"
```

---

### Task 8: Integrate Full Tests, Release Package, and User Acceptance

**Files:**
- Modify: `package.json:5-22`
- Modify: `pinduoduo-agent/README.md`
- Modify: `真实浏览器验收清单.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `CHANGELOG.md`
- Regenerate: `ozon-erp-collector-extension.zip`

**Interfaces:**
- Consumes: all completed tasks and the signed-in user browser.
- Produces: extension `0.6.30`, Agent `MVP 6.0`, release ZIP, documented rollback, test evidence, and a user-test handoff.

- [ ] **Step 1: Add all new tests to the full suite**

Ensure `npm test` runs these before legacy browser integration tests:

```json
"test:1688-core": "node tools/test-1688-core.mjs",
"test:1688-extension": "node tools/test-1688-extension.mjs",
"test:sourcing-agent-1688": "node tools/test-sourcing-agent-1688.mjs"
```

The `test` command must include all three and retain every existing command.

- [ ] **Step 2: Run focused syntax and test checks**

```powershell
node --check ozon-erp-collector-extension/1688-core.js
node --check ozon-erp-collector-extension/1688-content.js
node --check ozon-erp-collector-extension/1688-background.js
node --check pinduoduo-agent/server.mjs
node --check pinduoduo-agent/sourcing-core.mjs
node --check pinduoduo-agent/sourcing-qwen.mjs
node --check pinduoduo-agent/public/app.js
npm.cmd run test:1688-core
npm.cmd run test:1688-extension
npm.cmd run test:sourcing-agent-1688
npm.cmd run test:pinduoduo-agent
```

Expected: all PASS.

- [ ] **Step 3: Run the complete project suite**

Run: `npm.cmd test`

Expected: PASS with every existing and new suite.

- [ ] **Step 4: Update operational documentation**

Document:

- signed-in 1688 browser prerequisite;
- image → keyword → similar-supplier automatic sequence;
- final confirmation semantics;
- MOQ 2 handling;
- login/CAPTCHA pause and resume;
- Pinduoduo single-item-only boundary;
- no automatic order/payment/contact actions;
- user test steps for one item, three items, and twenty-item acceptance.

- [ ] **Step 5: Run the required release build**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-release.ps1
```

Expected: build and all verification pass; `ozon-erp-collector-extension.zip` is regenerated.

- [ ] **Step 6: Verify the ZIP independently**

Confirm the ZIP contains version `0.6.30` and at least:

```text
manifest.json
background.js
pinduoduo-bridge.js
1688-core.js
1688-content.js
1688-background.js
```

Record ZIP item count and SHA-256 in `CHANGELOG.md` and `PROJECT_STATUS.md`.

- [ ] **Step 7: Run a three-item signed-in browser smoke test**

Reload extension `0.6.30`, restart the local Agent, import three representative tasks, and verify:

1. automatic search uses only 1688 tabs;
2. no MuMu/Pinduoduo launch occurs;
3. image miss advances to keyword search;
4. final cards show evidence and cost breakdown;
5. before confirmation, task final purchase fields remain unchanged;
6. confirm writes the selected source once;
7. reject promotes the next candidate;
8. explicit single-item Pinduoduo deep search still works only after its confirmation prompt;
9. no order, payment, chat, contact, or coupon control is clicked.
10. timing records exclude platform-verification pauses and the average automatic-stage duration across the three smoke items is reported separately from waits.

- [ ] **Step 8: Hand off the twenty-item user acceptance**

Provide the user a short checklist covering the 20 representative cases in the spec. The acceptance report must calculate the average image → keyword → similar-supplier automatic-stage duration and compare it with the 2.5-minute target, excluding platform-verification waits. Do not claim the 20-item acceptance has passed until the user runs it and returns the exported queue/timing evidence.

- [ ] **Step 9: Review repository scope**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: only implementation, tests, docs, manifest, generated extension ZIP, and deterministic release artifacts are included. Exclude backups, runtime evidence, exported tasks, credentials, and unrelated user files.

- [ ] **Step 10: Commit the release**

```powershell
git add -- package.json ozon-erp-collector-extension/manifest.json ozon-erp-collector-extension/background.js ozon-erp-collector-extension/pinduoduo-bridge.js ozon-erp-collector-extension/1688-core.js ozon-erp-collector-extension/1688-content.js ozon-erp-collector-extension/1688-background.js pinduoduo-agent/server.mjs pinduoduo-agent/sourcing-core.mjs pinduoduo-agent/qwen-transport.mjs pinduoduo-agent/sourcing-qwen.mjs pinduoduo-agent/qwen-client.mjs pinduoduo-agent/public/pricing-flow.js pinduoduo-agent/public/sourcing-flow.js pinduoduo-agent/public/app.js pinduoduo-agent/public/index.html pinduoduo-agent/public/styles.css pinduoduo-agent/public/ai.css pinduoduo-agent/README.md tools/test-1688-core.mjs tools/test-1688-extension.mjs tools/test-sourcing-agent-1688.mjs tools/test-pinduoduo-agent.mjs tools/fixtures/1688-search-snapshot.json tools/fixtures/1688-detail-snapshot.json tools/fixtures/1688-two-unit-snapshot.json 真实浏览器验收清单.md PROJECT_STATUS.md CHANGELOG.md ozon-erp-collector-extension.zip
git commit -m "feat: add automatic 1688 sourcing"
```

- [ ] **Step 11: Push and verify remote main**

```powershell
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: local `HEAD` equals remote `refs/heads/main`.
