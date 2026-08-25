import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const coreSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/main-image-core.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
context.globalThis = context;
vm.runInContext(coreSource, context, { filename: "main-image-core.js" });
const core = context.OzonMainImageCore;

assert.equal(
  core.normalizedImageUrl("https://ir-3.ozone.ru/s3/multimedia-a/wc1000/123.jpg?x=1#part"),
  "https://ir-3.ozone.ru/s3/multimedia-a/wc1000/123.jpg?x=1",
);
assert.equal(core.normalizedImageUrl("https://www.ozon.ru/product/test-1/"), "");
assert.equal(core.normalizedImageUrl("https://example.com/s3/multimedia-a/wc1000/123.jpg"), "");
assert.equal(core.normalizedImageUrl("javascript:alert(1)"), "");

const selected = core.chooseBestCandidate([
  { url: "https://ir.ozone.ru/s3/multimedia-a/wc50/thumbnail.jpg", source: "gallery", width: 50, height: 50, visible: true },
  { url: "https://ir.ozone.ru/s3/multimedia-a/wc1000/main.jpg", source: "og:image" },
  { url: "https://cdn1.ozone.ru/s3/multimedia-a/wc500/other.jpg", source: "image", width: 800, height: 800, visible: true },
]);
assert.equal(selected.url, "https://ir.ozone.ru/s3/multimedia-a/wc1000/main.jpg");
assert.equal(selected.source, "og:image");

const gallerySelected = core.chooseBestCandidate([
  { url: "https://ir.ozone.ru/s3/multimedia-b/wc300/small.jpg", source: "gallery", width: 100, height: 100 },
  { url: "https://ir.ozone.ru/s3/multimedia-b/wc1200/large.jpg", source: "gallery", width: 700, height: 700 },
]);
assert.equal(gallerySelected.url, "https://ir.ozone.ru/s3/multimedia-b/wc1200/large.jpg");
assert.equal(core.chooseBestCandidate([{ url: "https://example.com/image.jpg", source: "og:image" }]), null);

const backgroundSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/background.js", import.meta.url), "utf8");
const popupSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/popup.js", import.meta.url), "utf8");
const enrichmentSource = fs.readFileSync(new URL("../ozon-erp-collector-extension/sourcing-enrichment.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../ozon-erp-collector-extension/manifest.json", import.meta.url), "utf8"));

assert.equal(manifest.version, "0.6.12");
assert.match(backgroundSource, /probeMainImageCandidates/);
assert.match(backgroundSource, /readMainImageAsSoonAsAvailable\(tab\.id, 6000\)/);
assert.match(backgroundSource, /message\?\.type === "readMainImageFromProductUrl"/);
assert.match(backgroundSource, /chrome\.tabs\.remove\(tab\.id\)/);
assert.match(popupSource, /openSourcingEnrichment/);
assert.match(enrichmentSource, /mainImageStatus = "completed"/);
assert.match(enrichmentSource, /mainImageError/);
assert.match(enrichmentSource, /replaceChildren/);
assert.doesNotMatch(enrichmentSource, /\.innerHTML\s*=/);

console.log("Main-image core and sourcing-enrichment wiring tests passed.");
