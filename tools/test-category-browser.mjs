// Isolated Chromium UI + actual category reader on synthetic pages. No live Ozon or account traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OZON_PLAYWRIGHT_MODULE||'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ozon-category-browser-'));
execFileSync(process.execPath,['tools/build-standalone.mjs',dir],{stdio:'pipe'});
const browser=await chromium.launch({headless:true,...(process.env.OZON_BROWSER_PATH?{executablePath:process.env.OZON_BROWSER_PATH}:{})});
try{
 const manager=await browser.newPage(),errors=[];manager.on('pageerror',e=>errors.push(e.message));
 await manager.addInitScript(()=>{
  window.calls=[];window.state=null;window.changeListeners=[];
  Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{sendMessage(m,cb){calls.push(m);if(m.type==='categoryGet')return cb({ok:true,batch:state,history:[]});if(m.type==='categoryStart'){state={id:'category-fixture',status:'running',options:{targetCount:m.targetCount},stores:m.urls.map(url=>({url,status:'scanning',observedCount:0,qualifiedCount:0,pendingCount:0})),tabId:9};return cb({ok:true,batch:state})}if(m.type==='categoryPause'){state.status='paused';return cb({ok:true,batch:state})}if(m.type==='categoryResume'){state.status='running';return cb({ok:true,batch:state})}if(m.type==='categoryStop'){state.status='stopped';return cb({ok:true,batch:state})}cb({ok:false,error:'unexpected'})}},storage:{onChanged:{addListener(fn){changeListeners.push(fn)}}},tabs:{},windows:{}}});
 });
 await manager.goto(pathToFileURL(path.join(dir,'category.html')).href);
 assert.equal(await manager.locator('#syncWorkbench').count(),0);
 await manager.locator('#urls').fill('https://www.ozon.ru/category/tools-1234/\nhttps://www.ozon.ru/category/car-2345/');
 await manager.locator('#targetCount').fill('3');await manager.locator('#minPrice').fill('20');
 await manager.locator('#start').click();await manager.getByText('运行中',{exact:false}).first().waitFor();
 const request=await manager.evaluate(()=>calls.find(m=>m.type==='categoryStart'));assert.equal(request.targetCount,3);assert.equal(request.minPrice,20);assert.equal(request.urls.length,2);
 await manager.locator('#pause').click();assert.match(await manager.locator('#summary').innerText(),/已暂停/);
 await manager.locator('#resume').click();assert.match(await manager.locator('#summary').innerText(),/运行中/);
 await manager.locator('#stop').click();assert.match(await manager.locator('#summary').innerText(),/已停止/);assert.deepEqual(errors,[]);
 const reader=await browser.newPage();reader.on('pageerror',e=>errors.push(e.message));
 const readerUrl='https://www.ozon.ru/category/tools-1234/';
 const card=(sku,name,label='符合要求',category='工具')=>`<article style="padding:12px"><div><a href="/product/tool-${sku}/">${name}</a></div><div>${label}</div><div>80.50 ¥</div><div>类目：${category}</div><div>rFBS佣金：10% / 14.5%</div><div>SKU：${sku}</div><div>月销量：20</div><div>发货模式：FBS</div><div>长宽高：100x100x100</div><div>重量：500g</div><div>跟卖最低价：70.50</div></article>`;
 await reader.route('**/*',route=>{const u=new URL(route.request().url());if(u.href===readerUrl)return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset=utf-8><h1>工具</h1><main data-widget="searchResultsV2"><section data-widget="tileGridDesktop">${card('100','钳子')}${card('101','不合格','不符合要求')}${card('102','电子烟')}${card('103','推荐商品')}</section></main><aside data-widget="recommendations"><div data-widget="tileGridDesktop">${card('999','推荐')}</div></aside>`});return route.abort()});
 await reader.addInitScript(()=>{window.messages=[];window.startListener=null;Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{onMessage:{addListener(fn){window.startListener=fn}},sendMessage(m,cb){messages.push(m);cb({ok:true,stop:m.type==='categorySample'})}}}})});
 await reader.goto(readerUrl);for(const f of ['store-scanner-core.js','category-core.js','category-scanner.js'])await reader.addScriptTag({path:path.join(dir,f)});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'a',categoryUrl:url,options:{minPrice:20,maxPrice:100,targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categorySample'));
 const sample=await reader.evaluate(()=>messages.find(m=>m.type==='categorySample'));assert.deepEqual(sample.products.map(x=>x.sku),['100','103']);assert.ok(!sample.products.some(x=>['101','102','999'].includes(x.sku)));assert.equal(sample.categoryName,'工具');assert.deepEqual(errors,[]);
 console.log('Isolated Chromium category manager and actual main-list card reading passed.');
}finally{await browser.close()}
