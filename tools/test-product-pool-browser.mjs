// Optional isolated browser regression; never loads a user's browser profile or real records.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OZON_PLAYWRIGHT_MODULE || 'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ozon-pool-browser-'));
execFileSync(process.execPath,['tools/build-standalone.mjs',dir],{stdio:'pipe'});
const browser=await chromium.launch({headless:true,...(process.env.OZON_BROWSER_PATH?{executablePath:process.env.OZON_BROWSER_PATH}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:920}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const products={};
    for(let n=100;n<151;n++){const sku=String(n);products[sku]={sku,title:'测试商品 '+sku,category:'工具',link:'https://www.ozon.ru/product/test-'+sku+'/',price:'100',shippingRisk:'正常',blocked:false,storeName:'测试店铺',batchIds:['fixture'],firstSeenAt:'2026-11-21T00:00:00Z',lastSeenAt:new Date(Date.UTC(2026,10,21,0,0,151-n)).toISOString(),status:'new',notes:'',manualSavedAt:''};}
    products['100'].weight='800g';products['101'].weight='1.2 kg';products['105'].weight='2 kg';products['105'].blocked=true;products['105'].shippingRisk='运输待复核';
    window.fixturePool={schemaVersion:1,products,history:{}};window.fixtureWrites=[];window.fixtureFail=false;window.fixtureReads=[];
    Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{getURL:p=>p,sendMessage:async m=>{
      if(m.type==='getProductPool'){fixtureReads.push('full');return {ok:true,pool:structuredClone(window.fixturePool)};}
      if(m.type==='getProductPoolPage'){const opts=OzonProductPoolCore.normalizePageQuery(m);fixtureReads.push(opts);const all=Object.values(fixturePool.products),matched=all.filter(p=>OzonProductPoolCore.matchesPageQuery(p,opts)).sort((a,b)=>OzonProductPoolCore.comparePoolItems(a,b,opts.sort));const offset=Math.min(opts.offset,Math.max(0,Math.floor((matched.length-1)/opts.limit)*opts.limit));return {ok:true,page:{items:structuredClone(matched.slice(offset,offset+opts.limit)),total:all.length,matched:matched.length,newCount:all.filter(p=>p.status==='new'&&!p.blocked).length,historyCount:Object.keys(fixturePool.history).length,offset,limit:opts.limit}};}
      if(m.type==='updateProductPoolItem'){
        const current=fixturePool.products[m.sku];if(!current||Object.entries(m.expected).some(([k,v])=>OzonProductPoolCore.productExpectation(current)[k]!==v))return {ok:false,error:'已变化'};
        fixturePool=OzonProductPoolCore.updateProduct(fixturePool,m.sku,m.patch);return {ok:true,state:{products:{[m.sku]:structuredClone(fixturePool.products[m.sku])}}};
      }
      if(m.type==='updateProductPoolItems'){
        if(window.fixtureFail){window.fixtureFail=false;return {ok:false,error:'模拟并发冲突'};}
        try{window.fixturePool=OzonProductPoolCore.updateProducts(window.fixturePool,m.changes);window.fixtureWrites.push(structuredClone(m.changes));return {ok:true,state:{products:Object.fromEntries(m.changes.map(c=>[c.sku,structuredClone(fixturePool.products[c.sku])]))}}}catch(e){return {ok:false,error:e.message}}
      }
      return {ok:false,error:'unexpected '+m.type};
    }},tabs:{query:async()=>[]}}});
  });
  await page.goto(pathToFileURL(path.join(dir,'product-pool.html')).href);
  await page.locator('#rows tr[data-sku="100"]').waitFor();
  assert.equal(await page.locator('#rows tr[data-sku]').count(),50);
  assert.equal(await page.evaluate(()=>fixtureReads.some(x=>x==='full')),false);
  const row=sku=>page.locator(`#rows tr[data-sku="${sku}"]`);
  assert.equal(await page.getByRole('columnheader',{name:'重量',exact:true}).count(),1);
  assert.equal(await page.getByRole('columnheader',{name:'运输复核',exact:true}).count(),0);
  assert.equal(await row('100').locator('td').nth(4).innerText(),'800g');
  assert.equal(await row('101').locator('td').nth(4).innerText(),'1.2 kg');
  assert.equal(await row('102').locator('td').nth(4).innerText(),'—');
  assert.match(await row('105').locator('td').nth(4).innerText(),/2 kg[\s\S]*运输待复核/);
  const selectedCount=()=>page.locator('#selectionCount').innerText();
  const waitMessage=pattern=>page.waitForFunction(s=>document.querySelector('#message').textContent.includes(s),pattern);
  await row('100').locator('input[type=checkbox]').check();
  await row('101').locator('input[type=checkbox]').check();
  await row('102').locator('input[type=checkbox]').check();
  assert.match(await selectedCount(),/3/);
  await row('100').locator('textarea').fill('备注一');await row('101').locator('textarea').fill('备注二');
  await page.locator('#saveSelected').click();
  await waitMessage('已保存 2');
  assert.deepEqual(await page.evaluate(()=>fixtureWrites[0].map(x=>x.sku)),['100','101']);
  assert.equal(await page.evaluate(()=>fixturePool.products['102'].manualSavedAt),'');
  await row('102').locator('textarea').fill('跨页草稿');
  await page.locator('#next').click();await row('150').waitFor();
  assert.match(await selectedCount(),/0/);
  await page.locator('#previous').click();await row('102').waitFor();
  assert.equal(await row('102').locator('textarea').inputValue(),'跨页草稿');
  await row('102').locator('input[type=checkbox]').check();
  await row('103').locator('input[type=checkbox]').check();
  await page.evaluate(()=>{fixtureFail=true;});
  await page.locator('#saveSelected').click();await waitMessage('模拟并发冲突');
  assert.match(await selectedCount(),/2/);
  assert.equal(await row('102').locator('textarea').inputValue(),'跨页草稿');
  page.once('dialog',d=>d.dismiss());await page.locator('#rejectSelected').click();
  assert.equal(await page.evaluate(()=>fixtureWrites.length),1);
  page.once('dialog',d=>d.accept());await page.locator('#rejectSelected').click();await waitMessage('已淘汰 2');
  assert.equal(await row('102').count(),0);assert.equal(await row('103').count(),0);
  assert.deepEqual(await page.evaluate(()=>[fixturePool.products['102'].status,fixturePool.products['102'].notes,fixturePool.products['103'].status]),['rejected','跨页草稿','rejected']);
  await page.locator('#filter').selectOption('');await row('102').waitFor();
  assert.equal(await row('102').getAttribute('data-status'),'rejected');
  assert.equal(await row('102').locator('textarea').inputValue(),'跨页草稿');
  assert.equal(await row('102').locator('td').first().evaluate(el=>getComputedStyle(el).position),'sticky');
  assert.equal(await row('102').locator('td').last().evaluate(el=>getComputedStyle(el).position),'sticky');
  // A selected but unedited row must not silently overwrite a newer note after refresh.
  await row('104').locator('input[type=checkbox]').check();
  await page.evaluate(()=>{fixturePool.products['104'].notes='其他窗口新备注';fixturePool.products['104'].manualSavedAt='2026-11-21T13:00:00Z'});
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('[data-sku="104"] textarea').value==='其他窗口新备注');
  page.once('dialog',d=>d.accept());await page.locator('#rejectSelected').click();await waitMessage('已变化');
  assert.equal(await page.evaluate(()=>fixturePool.products['104'].status),'new');
  assert.equal(await page.evaluate(()=>fixturePool.products['104'].notes),'其他窗口新备注');
  await row('104').locator('input[type=checkbox]').uncheck();
  await row('104').locator('textarea').fill('旧草稿');
  await page.evaluate(()=>{fixturePool.products['104'].notes='更新备注';fixturePool.products['104'].manualSavedAt='2026-11-21T14:00:00Z'});
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await row('104').locator('textarea').inputValue(),'旧草稿');
  await row('104').getByRole('button',{name:'放弃草稿'}).click();
  assert.equal(await row('104').locator('textarea').inputValue(),'更新备注');
  // Quick-price workflow continues to the next page and a removal shifts the correct next row into view.
  await page.evaluate(()=>ozonLocalQuick.select(pool.products['149']));
  await page.locator('[data-qp="next"]').click();await page.waitForFunction(()=>ozonLocalQuick.selectedSku==='150');
  await row('150').waitFor();
  await page.locator('#previous').click();await row('100').waitFor();
  await page.locator('#filter').selectOption('pending');await page.waitForFunction(()=>!document.querySelector('#filter').disabled);
  await page.evaluate(()=>ozonLocalQuick.select(pool.products['148']));
  page.once('dialog',d=>d.accept());await page.locator('[data-qp="reject"]').click();await page.waitForFunction(()=>ozonLocalQuick.selectedSku==='149');
  assert.equal(await page.evaluate(()=>fixturePool.products['148'].status),'rejected');
  await page.locator('#sort').selectOption('skuDesc');await page.waitForFunction(()=>document.querySelector('#rows tr[data-sku]')?.dataset.sku==='150');
  await page.locator('#query').fill('测试商品 104');await page.waitForFunction(()=>document.querySelectorAll('#rows tr[data-sku]').length===1&&document.querySelector('#rows tr[data-sku]').dataset.sku==='104');
  assert.equal(await page.evaluate(()=>fixtureReads.some(x=>x==='full')),false);
  const download=page.waitForEvent('download');await page.locator('#backup').click();await download;
  assert.equal(await page.evaluate(()=>fixtureReads.filter(x=>x==='full').length),1);
  assert.deepEqual(errors,[]);
  console.log('Isolated Chromium UI: selected draft save, paging, failure retention, reject cancel/confirm, history and sticky columns passed.');
}finally{await browser.close()}
