(function(){
  'use strict';
  const root=document.getElementById('quick-pricing-panel');if(!root)return;
  const quick=globalThis.OzonQuickPricingCore,poolCore=globalThis.OzonProductPoolCore;
  const key='ozon_pricing_draft_v1';
  function readDraft(){const raw=localStorage.getItem(key);if(!raw)return {raw,payload:{version:1,rows:[]}};const payload=JSON.parse(raw);if(payload?.version!==1||!Array.isArray(payload.rows))throw Error('本地核价数据格式异常');return {raw,payload}}
  async function saveRow(request){
    const pricingUrl=chrome.runtime.getURL('pricing.html');const open=(await chrome.tabs.query({})).filter(tab=>tab.url===pricingUrl||tab.pendingUrl===pricingUrl);
    if(open.length>1)throw Error('请只保留一个本地核价表页面，避免同时保存');
    if(open.length===1){const response=await chrome.runtime.sendMessage({type:'quickPricingPatch',...request});if(!response?.ok)throw Error(response?.error||'核价页面未准备好，请重试');const saved=response.rows?.find(r=>r.id===request.id&&r.sku===request.sku);if(!saved||Object.entries(request.patch).some(([k,v])=>saved[k]!==v))throw Error('本地核价保存未确认');return saved}
    const {raw,payload}=readDraft();const rows=quick.patchRow(payload.rows,request);const serialized=JSON.stringify({...payload,savedAt:new Date().toISOString(),rows});if(serialized.length>4000000)throw Error('核价记录超过容量限制');if(localStorage.getItem(key)!==raw)throw Error('核价已变化，请重新读取');localStorage.setItem(key,serialized);
    const saved=readDraft().payload.rows.find(r=>r.id===request.id&&r.sku===request.sku);if(!saved||Object.entries(request.patch).some(([k,v])=>saved[k]!==v))throw Error('本地核价保存未确认');return saved;
  }
  let order=[],beforeAdvance=null;
  const panel=globalThis.OzonQuickPricingPanel.create(root,{math:OzonPricingCore,
    load:async sku=>quick.rowsForSku(readDraft().payload.rows,sku),save:saveRow,
    selection:p=>{for(const row of document.querySelectorAll('#rows tr'))row.classList.toggle('qp-selected',!!p&&row.dataset.sku===p.sku)},
    status:async(p,status)=>{if(drafts.has(p.sku))throw Error('左侧状态或备注未保存，请先保存该行');const current=pool.products[p.sku];if(!current||status==='approved'&&current.blocked)throw Error('商品不存在或运输待复核');beforeAdvance=order.slice();const r=await send({type:'updateProductPoolItem',sku:p.sku,patch:{status,notes:current.notes},expected:{status:current.status,notes:current.notes,blocked:current.blocked}});const saved=r.state.products[p.sku];if(saved?.status!==status||saved.notes!==current.notes||!saved.manualSavedAt)throw Error('商品处理状态未确认');pool=r.state;render();feedback(`SKU ${p.sku} · ${poolCore.statuses[status]}`)},
    advance:p=>{const source=beforeAdvance||order;beforeAdvance=null;const index=source.findIndex(x=>x.sku===p.sku);const next=source.slice(index+1).concat(source.slice(0,index)).find(x=>pool.products[x.sku]&&poolCore.matchesStatus(pool.products[x.sku],'pending'));if(panel.select(next?pool.products[next.sku]:null)&&next){const i=order.findIndex(x=>x.sku===next.sku);if(i>=0){offset=Math.floor(i/pageSize)*pageSize;render()}}}
  });
  globalThis.ozonLocalQuick={get selectedSku(){return panel.selectedSku},select:p=>panel.select(p),sync:filtered=>{order=filtered;if(panel.selectedSku&&pool.products[panel.selectedSku])panel.select(pool.products[panel.selectedSku]);else if(filtered.length)panel.select(filtered[0])}};
  render();
})();
