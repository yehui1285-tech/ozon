import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ozon-standalone-test-"));
execFileSync(process.execPath,["tools/build-standalone.mjs",dir],{stdio:"pipe"});
const read=name=>fs.readFileSync(path.join(dir,name),"utf8");
const manifest=JSON.parse(read("manifest.json"));
assert.equal(manifest.name,"OZON 独立选品助手");
assert.ok(!fs.existsSync(path.join(dir,"workbench-bridge.js")));
assert.ok(!manifest.host_permissions.some(url=>url.includes("yehui1285")));
for(const name of fs.readdirSync(dir)){
  assert.doesNotMatch(read(name),/yehui1285|deep-breath-design-desk|feishu\.cn\/base\/MnB1/);
  if(name.endsWith(".js"))execFileSync(process.execPath,["--check",path.join(dir,name)]);
}
assert.match(read("background.js"),/chrome\.runtime\.getURL\("pricing\.html"\)/);
assert.match(read("pricing-app.js"),/deliverProductToPricing/);
assert.match(read("pricing.html"),/src="pricing-app\.js"/);
assert.doesNotMatch(read("pricing.html"),/<script>/);
assert.equal(read("product-pool-core.js"),fs.readFileSync("ozon-erp-collector-extension/product-pool-core.js","utf8"));
console.log("Standalone build: local pricing, shared pool and account isolation passed.");
