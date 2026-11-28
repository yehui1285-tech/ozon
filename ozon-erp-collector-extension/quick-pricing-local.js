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
  const isBlankRow = row => {
    const keys = ['green','black','commission','factorOverride','quoteOverride','cost','source','note'];
    if (keys.some(k => String(row?.[k] ?? '').trim() !== '')) return false;
    const f = String(row?.freight ?? '').trim();
    return f === '' || Math.abs(Number(f) - 37.44) < 0.005;
  };
  async function createRow(request){
    const pricingUrl=chrome.runtime.getURL('pricing.html');const open=(await chrome.tabs.query({})).filter(tab=>tab.url===pricingUrl||tab.pendingUrl===pricingUrl);
    if(open.length>1)throw Error('请只保留一个本地核价表页面，避免同时保存');
    if(open.length===1){const response=await chrome.runtime.sendMessage({type:'quickPricingCreate',...request});if(!response?.ok)throw Error(response?.error||'核价页面未准备好，请重试');const created=response.row;if(!created?.id||created.id!==request.id||String(created.sku)!==String(request.sku))throw Error('本地核价新建未确认');return created}
    const {raw,payload}=readDraft();
    const baseRows=payload.rows.length===1&&isBlankRow(payload.rows[0])?[]:payload.rows;
    const existing=baseRows.find(row=>row.id===request.id);
    const expected=quick.createRow([],request,1000).row;
    if(existing){if(JSON.stringify(existing)===JSON.stringify(expected))return existing;throw Error('本次新建编号已用于其他核价内容')}
    const {rows,row}=quick.createRow(baseRows,{...request},1000);
    const serialized=JSON.stringify({...payload,savedAt:new Date().toISOString(),rows});if(serialized.length>4000000)throw Error('核价记录超过容量限制');if(localStorage.getItem(key)!==raw)throw Error('核价已变化，请重新读取');localStorage.setItem(key,serialized);
    const saved=readDraft().payload.rows.find(r=>r.id===row.id&&r.sku===String(request.sku));if(!saved)throw Error('本地核价新建未确认');return saved;
  }
  async function fetchBlackPrice(product){
    const task=quick.buildTaskPricingPayload(product,globalThis.OzonTaskPricingCore);
    const response=await chrome.runtime.sendMessage({type:'readOzonTaskPricing',task});
    if(!response?.ok)throw new Error(response?.error||'同源黑标价读取失败');
    return response;
  }
  let order=[],beforeAdvance=null;
  const panel=globalThis.OzonQuickPricingPanel.create(root,{math:OzonPricingCore,taskPricing:globalThis.OzonTaskPricingCore,normalizeImageUrl:poolCore.normalizeImageUrl,
    openImage:p=>globalThis.ozonOpenPoolImageLightbox?.(p),
    load:async sku=>quick.rowsForSku(readDraft().payload.rows,sku),save:saveRow,create:createRow,fetchBlackPrice,
    selection:p=>{for(const row of document.querySelectorAll('#rows tr'))row.classList.toggle('qp-selected',!!p&&row.dataset.sku===p.sku)},
    status:async(p,status)=>{if(poolOperationBusy())throw Error('商品池正在更新，请稍后重试');if(drafts.has(p.sku))throw Error('左侧状态或备注未保存，请先保存该行');const current=pool.products[p.sku];if(!current||status==='approved'&&current.blocked)throw Error('商品不存在或运输待复核');beforeAdvance={items:order.slice(),offset};quickStatusBusy=true;render();try{const r=await send({type:'updateProductPoolItem',sku:p.sku,patch:{status,notes:current.notes},expected:poolCore.productExpectation(current)});const saved=r.state?.products?.[p.sku];if(saved?.status!==status||saved.notes!==current.notes||!saved.manualSavedAt)throw Error('商品处理状态未确认');feedback(`SKU ${p.sku} · ${poolCore.statuses[status]}`);await reloadAfterWrite()}catch(e){beforeAdvance=null;throw e}finally{quickStatusBusy=false;render()}},
    advance:async p=>{if(!p||poolOperationBusy())return;const source=beforeAdvance||{items:order.slice(),offset};beforeAdvance=null;const index=source.items.findIndex(x=>x.sku===p.sku);const start=source.offset+Math.max(0,index)+(pool.products[p.sku]?1:0);if(['approved','rejected'].includes($("filter").value)){feedback('当前筛选仅显示已处理商品，请切换至待处理。');return}quickStatusBusy=true;try{
      const pending=x=>x.sku!==p.sku&&poolCore.matchesStatus(x,'pending');
      const initialOffset=offset;
      let next;
      // Request only the page containing the next position; removals shift the next row left.
      for(let at=Math.min(Math.floor(start/pageSize)*pageSize,Math.max(0,Math.floor((pageInfo.matched-1)/pageSize)*pageSize));at<pageInfo.matched;at+=pageSize){if(at!==offset)await loadPage(at);next=pageInfo.items.find((x,i)=>offset+i>=start&&pending(x));if(next)break;}
      if(!next){for(let at=0;at<=Math.min(initialOffset,pageInfo.matched-1);at+=pageSize){if(at!==offset)await loadPage(at);next=pageInfo.items.find(pending);if(next)break;}}
      if(!panel.select(next||null)&&offset!==initialOffset)await loadPage(initialOffset);
      if(next)globalThis.ozonClearProductPoolSelection?.();
    }catch(e){feedback(`切换商品失败：${e.message}`,true)}finally{quickStatusBusy=false;render()}}
  });
  globalThis.ozonLocalQuick={get selectedSku(){return panel.selectedSku},select:p=>panel.select(p),sync:filtered=>{order=filtered;if(quickStatusBusy||beforeAdvance)return;if(panel.selectedSku&&pool.products[panel.selectedSku])panel.select(pool.products[panel.selectedSku]);else panel.select(filtered[0]||null)}};
  render();
})();
