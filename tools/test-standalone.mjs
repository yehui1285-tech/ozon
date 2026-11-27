import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import vm from "node:vm";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ozon-standalone-test-"));
execFileSync(process.execPath,["tools/build-standalone.mjs",dir],{stdio:"pipe"});
const read=name=>fs.readFileSync(path.join(dir,name),"utf8");
const manifest=JSON.parse(read("manifest.json"));
assert.equal(manifest.name,"OZON 独立选品助手");
assert.ok(!manifest.permissions.includes("debugger"),"standalone build does not request debugger access by default");
assert.ok(!manifest.optional_permissions?.includes("debugger"),"unsupported debugger optional permission is not declared");
assert.ok(!fs.existsSync(path.join(dir,"workbench-bridge.js")));
assert.ok(!manifest.host_permissions.some(url=>url.includes("yehui1285")));
for(const name of fs.readdirSync(dir)){
  assert.doesNotMatch(read(name),/yehui1285|deep-breath-design-desk|feishu\.cn\/base\/MnB1/);
  if(name.endsWith(".js"))execFileSync(process.execPath,["--check",path.join(dir,name)]);
}
assert.match(read("background.js"),/chrome\.runtime\.getURL\("pricing\.html"\)/);
assert.match(read("pricing-app.js"),/deliverProductToPricing/);
assert.match(read("pricing.html"),/src="pricing-app\.js"/);
assert.match(read("product-pool.html"),/quick-pricing-panel/);
assert.match(read("product-pool.html"),/quick-pricing-local\.js/);
assert.match(read("product-pool.html"),/quick-pricing-core\.js/);
assert.match(read("pricing-app.js"),/quickPricingPatch/);
assert.match(read("quick-pricing-local.js"),/rowsForSku/);
assert.doesNotMatch(read("pricing.html"),/<script>/);
for (const current of ["pricing.html","batch.html","category.html","product-pool.html"]) {
  const nav=read(current).match(/<nav class="standalone-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, `${current} must have shared local navigation`);
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]), ["product-pool.html","batch.html","category.html","pricing.html"], `${current}: product pool comes first`);
  for (const target of ["pricing.html","batch.html","category.html","product-pool.html"]) {
    assert.ok(nav.includes(`href="${target}"`), `${current} links to ${target}`);
    assert.equal(nav.includes(`href="${target}" aria-current="page"`), current===target);
  }
}
assert.ok(fs.existsSync(path.join(dir,'category-scanner.js')));
assert.ok(fs.existsSync(path.join(dir,'category-background.js')));
assert.ok(fs.existsSync(path.join(dir,'category-catalog.js')));
assert.ok(fs.existsSync(path.join(dir,'category-catalog.json')));
assert.doesNotMatch(read('category.html'),/id="syncWorkbench"/);
assert.doesNotMatch(read('category.html'),/id="cloudSyncBar"/);
assert.doesNotMatch(read('category.html'),/id="backgroundExperiment"/);
assert.doesNotMatch(read('category.html'),/id="saveFavorite"/);
assert.doesNotMatch(read('category.html'),/<details[^>]*id="diagBox"[^>]*\bopen\b/);
for (const id of ['priceMin','priceMax','priceModePill','rubCnyBar','rubCnyAmount','fxEditBtn','fxRateInput','perCategoryLimit','openSaveTask','saveTaskProfile','savedTaskList','continueBar','continueRemaining','continueNextRound','pageCurrencyRub','pageCurrencyCny','historyToolsBox']) {
  assert.ok(read('category.html').includes(`id="${id}"`), `standalone category.html retains #${id}`);
}
assert.ok(read('category.html').indexOf('id="continueBar"') < read('category.html').indexOf('id="batch"'), 'standalone category.html places #continueBar above #batch');
assert.match(read('standalone-nav.css'), /#3a5a40/);
assert.doesNotMatch(read('standalone-nav.css'), /#405ec5/);
assert.doesNotMatch(read('background.js'),/wbSyncCategory|wbSyncCloudState|wbRefreshCloudSkus|wbSyncCategoryTasks/);
assert.equal(read("product-pool-core.js"),fs.readFileSync("ozon-erp-collector-extension/product-pool-core.js","utf8"));
// Run the generated pricing-page bridge with an in-memory local draft and real row patch core.
const testKey='ozon_pricing_draft_v1',record={id:'a',sku:'123',green:'10',black:'12',commission:'8',freight:'2',cost:'5',factorOverride:'',quoteOverride:'',link:'',source:'',note:''},other={...record,id:'b',sku:'456',note:'preserve'};
let data=JSON.stringify({version:1,rows:[record,other]}),handler;
const localStorage={getItem:()=>data,setItem:(_key,value)=>{data=value}};
const context=vm.createContext({localStorage,window:{addEventListener(){}},chrome:{runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:{addListener:fn=>{handler=fn}}}},$:()=>null,renderRows(){},PRICING_DRAFT_KEY:testKey,PRICING_ROW_KEYS:Object.keys(record).filter(k=>k!=='id'),rows:[record,other]});
context.savePricingDraft=()=>localStorage.setItem(testKey,JSON.stringify({version:1,rows:context.rows}));
vm.runInContext(read('quick-pricing-core.js'),context);
vm.runInContext(read('pricing-app.js').split('// The pricing page remains the sole writer')[1].replace(/^ of its existing local draft\./,'// adapter'),context);
const message=(request,sender={id:'test',url:'chrome-extension://test/product-pool.html'})=>{let result;handler(request,sender,value=>{result=value});return result};
const base={...record};
assert.equal(message({type:'quickPricingPatch',sku:'123',id:'a',base,patch:{cost:'6'}}).ok,true);
assert.equal(JSON.parse(data).rows[0].cost,'6');assert.equal(JSON.parse(data).rows[1].note,'preserve');
assert.equal(message({type:'quickPricingPatch',sku:'123',id:'a',base,patch:{cost:'7'}}).ok,false);
assert.equal(message({type:'quickPricingPatch',sku:'456',id:'a',base,patch:{cost:'7'}}).ok,false);
assert.equal(message({type:'quickPricingPatch',sku:'123',id:'a',base,patch:{cost:'7'}},{id:'test',url:'chrome-extension://test/pricing.html'}),undefined);
console.log("Standalone build: local pricing, shared pool and account isolation passed.");
