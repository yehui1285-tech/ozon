// Isolated Chromium UI + actual category reader on synthetic pages. No live Ozon or account traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OZON_PLAYWRIGHT_MODULE||'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ozon-category-browser-'));
execFileSync(process.execPath,['tools/build-standalone.mjs',dir],{stdio:'pipe'});
const browser=await chromium.launch({headless:true,...(process.env.OZON_BROWSER_PATH?{executablePath:process.env.OZON_BROWSER_PATH}:{})});
try{
 const manager=await browser.newPage(),errors=[];manager.on('pageerror',e=>errors.push(e.message));
 await manager.route('**/*',route=>{const u=new URL(route.request().url()),f=u.pathname.slice(1);if(u.origin!=='https://catalog-fixture.invalid'||!['category.html','category.css','standalone-nav.css','store-scanner-core.js','category-core.js','category-catalog.js','category.js','category-catalog.json'].includes(f))return route.abort();return route.fulfill({contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':'text/javascript',body:fs.readFileSync(path.join(dir,f))})});
 await manager.addInitScript(()=>{
  window.calls=[];window.state=null;window.changeListeners=[];window.favoriteStorage={};
  Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{sendMessage(m,cb){calls.push(m);if(m.type==='categoryGet')return cb({ok:true,batch:state,history:[]});if(m.type==='categoryStart'){state={id:'category-fixture',status:'running',options:{targetCount:m.targetCount},stores:m.urls.map(url=>({url,status:'scanning',observedCount:0,qualifiedCount:0,pendingCount:0})),tabId:9};return cb({ok:true,batch:state})}if(m.type==='categoryPause'){state.status='paused';return cb({ok:true,batch:state})}if(m.type==='categoryResume'){state.status='running';return cb({ok:true,batch:state})}if(m.type==='categoryStop'){state.status='stopped';return cb({ok:true,batch:state})}cb({ok:false,error:'unexpected'})}},storage:{local:{async get(k){return {[k]:favoriteStorage[k]}},async set(v){Object.assign(favoriteStorage,v)}},onChanged:{addListener(fn){changeListeners.push(fn)}}},tabs:{},windows:{}}});
 });
 await manager.goto('https://catalog-fixture.invalid/category.html');
 await manager.waitForFunction(()=>document.querySelectorAll('#catalogTree details').length>0);
 assert.equal(await manager.locator('#syncWorkbench').count(),0);
 await manager.locator('#urls').fill('https://www.ozon.ru/category/tools-1234/\nhttps://www.ozon.ru/category/car-2345/');
 await manager.locator('#targetCount').fill('3');await manager.locator('#minPrice').fill('20');
 await manager.locator('#start').click();await manager.getByText('运行中',{exact:false}).first().waitFor();
 const request=await manager.evaluate(()=>calls.find(m=>m.type==='categoryStart'));assert.equal(request.targetCount,3);assert.equal(request.minPrice,20);assert.equal(request.urls.length,2);
 await manager.locator('#pause').click();assert.match(await manager.locator('#summary').innerText(),/已暂停/);
 await manager.locator('#resume').click();assert.match(await manager.locator('#summary').innerText(),/运行中/);
 await manager.locator('#stop').click();assert.match(await manager.locator('#summary').innerText(),/已停止/);assert.deepEqual(errors,[]);
 // Select a whole China category as one task, persist a local named combination, and retain manual links.
 await manager.locator('#urls').fill('https://www.ozon.ru/category/car-8500/');
 await manager.locator('#catalogSource').selectOption('china');await manager.locator('#catalogSearch').fill('汽车用品');
 await manager.locator('#catalogTree label').filter({hasText:/^汽车用品$/}).first().locator('input').check();
 assert.match(await manager.locator('#catalogCount').innerText(),/已选 1/);
 await manager.locator('#favoriteName').fill('汽车组合');await manager.locator('#saveFavorite').click();
 await manager.waitForFunction(()=>document.querySelector('#favoriteSelect').options.length===2);
 await manager.locator('#catalogClear').click();assert.match(await manager.locator('#catalogCount').innerText(),/已选 0/);
 await manager.locator('#favoriteSelect').selectOption({index:1});await manager.locator('#loadFavorite').click();assert.match(await manager.locator('#catalogCount').innerText(),/已选 1/);
 assert.equal(await manager.locator('#urls').inputValue(),'https://www.ozon.ru/category/car-8500/');
 await manager.locator('#start').click();await manager.getByText('运行中',{exact:false}).first().waitFor();
 const treeRequest=await manager.evaluate(()=>calls.filter(m=>m.type==='categoryStart').at(-1));
 const chinaUrl='https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/?category=8500';
 assert.deepEqual(treeRequest.urls,['https://www.ozon.ru/category/car-8500/',chinaUrl]);assert.equal(treeRequest.categoryLabels[chinaUrl],'汽车用品');
 await manager.locator('#stop').click();assert.deepEqual(errors,[]);
 const reader=await browser.newPage();reader.on('pageerror',e=>errors.push(e.message));
 const readerUrl='https://www.ozon.ru/category/tools-1234/';
 const card=(sku,name,label='符合要求',category='工具')=>`<article style="padding:12px"><div><a href="/product/tool-${sku}/">${name}</a></div><div>${label}</div><div>80.50 ¥</div><div>类目：${category}</div><div>rFBS佣金：10% / 14.5%</div><div>SKU：${sku}</div><div>月销量：20</div><div>发货模式：FBS</div><div>长宽高：100x100x100</div><div>重量：500g</div><div>跟卖最低价：70.50</div></article>`;
 await reader.route('**/*',route=>{const u=new URL(route.request().url());if(u.href===readerUrl)return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset=utf-8><h1>工具</h1><main data-widget="searchResultsV2"><section data-widget="tileGridDesktop">${card('100','钳子')}${card('101','不合格','不符合要求')}${card('102','电子烟')}${card('103','推荐商品')}</section></main><aside data-widget="recommendations"><div data-widget="tileGridDesktop">${card('999','推荐')}</div></aside>`});return route.abort()});
 await reader.addInitScript(()=>{window.messages=[];window.startListener=null;Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{onMessage:{addListener(fn){window.startListener=fn}},sendMessage(m,cb){messages.push(m);cb({ok:true,stop:m.type==='categorySample'})}}}})});
 await reader.goto(readerUrl);for(const f of ['store-scanner-core.js','category-core.js','category-scanner.js'])await reader.addScriptTag({path:path.join(dir,f)});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'a',categoryUrl:url,options:{minPrice:20,maxPrice:100,targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categorySample'));
 const sample=await reader.evaluate(()=>messages.find(m=>m.type==='categorySample'));assert.deepEqual(sample.products.map(x=>x.sku),['100','103']);assert.ok(!sample.products.some(x=>['101','102','999'].includes(x.sku)));assert.equal(sample.categoryName,'工具');assert.deepEqual(errors,[]);
 // Numeric values in ordinary product cards are not HTTP errors.
 await reader.evaluate(({normal,price})=>{messages.length=0;const section=document.querySelector('main section');window.savedCatalogMarkup=section.innerHTML;section.innerHTML=normal+price;}, {normal:card('5840376192','普通配件'),price:card('105','普通售价').replace('80.50 ¥','403.50 ¥')});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'ordinary-numbers',categoryUrl:url,options:{minPrice:20,maxPrice:500,targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categorySample'||x.type==='categoryPageDone'));
 const ordinary=await reader.evaluate(()=>messages);
 assert.equal(ordinary.some(m=>m.type==='categoryPageDone'),false,'ordinary SKU and price numbers must not trigger verification');
 assert.deepEqual(ordinary[0].products.map(p=>p.sku),['5840376192','105']);
 await reader.evaluate(()=>{document.querySelector('main section').innerHTML=window.savedCatalogMarkup;messages.length=0;});
 // Real DOM: after the first successful sample the catalog disappears for >1.8s.
 // The same run must recover; multiple grids inside the same unique catalog wrapper are legitimate.
 await reader.evaluate(({second,third})=>{
   messages.length=0;
   const original=document.querySelector('main');
   const originalSend=chrome.runtime.sendMessage;
   let first=true;
   chrome.runtime.sendMessage=(m,cb)=>{
     if(m.type==='categorySample'&&first){first=false;messages.push(m);original.style.display='none';
       setTimeout(()=>{original.innerHTML=`<section data-widget="tileGridDesktop">${second}</section><section data-widget="tileGridDesktop">${third}</section>`;original.style.display='';},4500);
       cb({ok:true});return;
     }
     originalSend(m,cb);
   };
 },{second:card('200','第二组'),third:card('201','第三组')});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'transient',categoryUrl:url,options:{minPrice:20,maxPrice:100,targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categoryPageDone'||x.type==='categorySample'&&x.products.some(p=>p.sku==='200')),{},{timeout:20000});
 const recovered=await reader.evaluate(()=>messages);
 assert.equal(recovered.some(x=>x.type==='categoryPageDone'),false,'temporary list disappearance must not pause');
 assert.deepEqual(recovered.filter(x=>x.type==='categorySample').at(-1).products.map(p=>p.sku),['200','201'],'read both grids inside one unambiguous main catalog');
 assert.deepEqual(errors,[]);
 // A pending card at a confirmed list end must trigger an automatic review.
 // Its missing fields appear only once the reader begins the review pass.
 await reader.evaluate(({ready})=>{
   messages.length=0;const original=document.querySelector('main');
   original.innerHTML='<section data-widget="tileGridDesktop"><article><a href="/product/tool-301/">待加载</a></article><div data-testid="catalog-list-end">已加载末尾</div></section>';
   const nativeScroll=window.scrollTo.bind(window);
   window.scrollTo=(...args)=>{nativeScroll(...args);original.querySelector('article').outerHTML=ready};
   chrome.runtime.sendMessage=(m,cb)=>{messages.push(m);cb({ok:true,stop:false})};
   nativeScroll(0,999999);
 },{ready:card('301','已完成加载')});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'review',categoryUrl:url,options:{minPrice:20,maxPrice:100,targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categoryPageDone'),{},{timeout:25000});
 const review=await reader.evaluate(()=>messages);
 assert.ok(review.some(x=>x.type==='categoryWait'&&x.reason==='review_pending'),'pending fields receive an automatic review pass');
 assert.ok(review.some(x=>x.type==='categorySample'&&x.products.some(p=>p.sku==='301')));
 assert.equal(review.find(x=>x.type==='categoryPageDone').reason,'visible_catalog_end');
 assert.equal(review.find(x=>x.type==='categoryPageDone').complete,true);
 // A platform challenge must pause before any wait or sample; never retry it automatically.
 await reader.evaluate(()=>{messages.length=0;document.title='captcha';});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'verification',categoryUrl:url,options:{targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categoryPageDone'));
 const verify=await reader.evaluate(()=>messages);assert.deepEqual(verify.map(x=>x.type),['categoryPageDone']);assert.equal(verify[0].reason,'manual-verification');assert.equal(verify[0].verificationDetail,'security_prompt');
 // Real page-level denial must still stop immediately, even if catalog markup persists.
 await reader.evaluate(()=>{messages.length=0;document.title='403 Forbidden';});
 await reader.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'denied',categoryUrl:url,options:{targetCount:3}},{},()=>{}),readerUrl);
 await reader.waitForFunction(()=>messages.some(x=>x.type==='categoryPageDone'));
 const denied=await reader.evaluate(()=>messages);assert.deepEqual(denied.map(x=>x.type),['categoryPageDone']);assert.equal(denied[0].reason,'manual-verification');assert.equal(denied[0].verificationDetail,'http_denied');
 const cn=await browser.newPage();cn.on('pageerror',e=>errors.push(e.message));await cn.route('**/*',route=>route.request().url()===chinaUrl?route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset=utf-8><h1>汽车用品</h1><main data-widget="searchResultsV2"><section data-widget="tileGridDesktop">${card('850001','测试商品')}</section></main>`}):route.abort());
 await cn.addInitScript(()=>{window.messages=[];Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{onMessage:{addListener(fn){window.startListener=fn}},sendMessage(m,cb){messages.push(m);cb({ok:true,stop:m.type==='categorySample'})}}}})});
 await cn.goto(chinaUrl);for(const f of ['store-scanner-core.js','category-core.js','category-scanner.js'])await cn.addScriptTag({path:path.join(dir,f)});
 await cn.evaluate(url=>startListener({type:'categoryScanStart',batchId:'fixture',attemptId:'china',categoryUrl:url,options:{targetCount:3}},{},()=>{}),chinaUrl);
 await cn.waitForFunction(()=>messages.some(x=>x.type==='categorySample'||x.type==='categoryPageDone'));
 const chinaSample=await cn.evaluate(()=>messages[0]);assert.equal(chinaSample.type,'categorySample');assert.equal(chinaSample.categoryUrl,chinaUrl);assert.deepEqual(chinaSample.products.map(p=>p.sku),['850001']);
 assert.deepEqual(errors,[]);
 console.log('Isolated Chromium category manager and actual main-list card reading passed.');
}finally{await browser.close()}
