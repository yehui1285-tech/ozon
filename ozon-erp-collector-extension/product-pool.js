const core = globalThis.OzonProductPoolCore;
const $ = id => document.getElementById(id);
let pool = core.emptyPool();
let offset = 0;
const pageSize = 50;
let pageInfo = {items:[],total:0,matched:0,newCount:0,historyCount:0,offset:0,limit:pageSize};
let appliedQuery = core.normalizePageQuery();
let searchTimer;
let searchPending = false;
let exportBusy = false;
const drafts = new Map();
const saving = new Set();
const saveErrors = new Map();
const selected = new Set();
const selectionExpected = new Map();
let batchBusy = false;
let historyBusy = false;
let refreshBusy = false;
let quickStatusBusy = false;
const poolWriteOrLoadBusy = () => batchBusy || historyBusy || refreshBusy || quickStatusBusy || exportBusy || saving.size > 0;
const poolOperationBusy = () => searchPending || poolWriteOrLoadBusy();
function toggleSelected(item, checked) {if(checked){selected.add(item.sku);if(!selectionExpected.has(item.sku))selectionExpected.set(item.sku,core.productExpectation(item));}else{selected.delete(item.sku);selectionExpected.delete(item.sku);}}
function clearSelection(){selected.clear();selectionExpected.clear();}
globalThis.ozonClearProductPoolSelection = clearSelection;
const saveTime = value => new Date(value).toLocaleString("zh-CN", { hour12: false });

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "操作失败");
  return result;
}
function feedback(text, error = false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#a52e1b" : "#226247";
}
const showImagesKey = "ozonPoolShowImages";
let showImages = (() => { try { return localStorage.getItem(showImagesKey) !== "0"; } catch { return true; } })();
const failedImages = new Set();
if ($("showImages")) $("showImages").checked = showImages;
function createThumb(item) {
  const box = document.createElement("span");
  box.className = "pool-thumb";
  const url = core.normalizeImageUrl ? core.normalizeImageUrl(item.imageUrl) : "";
  const fallback = text => {
    const label = document.createElement("span");
    label.className = "pool-thumb-fallback";
    label.textContent = text;
    return label;
  };
  if (!url || failedImages.has(url)) {
    box.append(fallback(url ? "加载失败" : "无图"));
    return box;
  }
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.alt = item.title || item.sku || "商品缩略图";
  img.src = url;
  const preview = document.createElement("span");
  preview.className = "pool-thumb-preview";
  const previewImg = document.createElement("img");
  previewImg.loading = "lazy";
  previewImg.decoding = "async";
  previewImg.referrerPolicy = "no-referrer";
  previewImg.alt = "";
  previewImg.src = url;
  preview.append(previewImg);
  img.addEventListener("error", () => {
    failedImages.add(url);
    box.replaceChildren(fallback("加载失败"));
  }, { once: true });
  box.append(img, preview);
  return box;
}
async function loadPage(at = offset) {
  const options=core.normalizePageQuery({query:$("query").value,filter:$("filter").value,source:$("source")?.value||"",sort:$("sort").value,offset:at,limit:pageSize});
  const {page}=await send({type:"getProductPoolPage",...options});
  if(!Array.isArray(page?.items)||page.items.length>pageSize||!Number.isSafeInteger(page.offset)||!Number.isSafeInteger(page.matched))throw Error("商品池分页响应异常");
  pageInfo=page;offset=page.offset;appliedQuery=options;
  pool={...core.emptyPool(),products:Object.fromEntries(page.items.map(p=>[p.sku,p]))};
}
async function reloadAfterWrite() {
  try { await loadPage(); }
  catch (e) {
    // A confirmed write must not be retried automatically. Clear stale rows.
    pageInfo={...pageInfo,items:[]};pool=core.emptyPool();
    feedback(`已保存，但列表刷新失败：${e.message}。请点击刷新。`,true);
  }
}
function cell(row, text) {
  const td = row.insertCell();
  td.textContent = text || "—";
  return td;
}
function option(select, value, text) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = text;
  select.append(item);
}
for (const [value, text] of Object.entries(core.statuses)) option($("filter"), value, text);
function render() {
  const table=document.querySelector('.table'),scrollTop=table?.scrollTop||0,scrollLeft=table?.scrollLeft||0;
  $("total").textContent = pageInfo.total;
  $("newCount").textContent = pageInfo.newCount;
  $("historyCount").textContent = pageInfo.historyCount;
  const page = pageInfo.items;
  const visible=new Set(page.map(p=>p.sku));for(const sku of selected)if(!visible.has(sku)){selected.delete(sku);selectionExpected.delete(sku);}
  $("rows").replaceChildren();
  for (const p of page) {
    const row = $("rows").insertRow();
    row.dataset.status = p.status;
    row.dataset.sku = p.sku;
    if (globalThis.ozonLocalQuick?.selectedSku === p.sku) row.classList.add('qp-selected');
    const checkCell = row.insertCell(); checkCell.className = "check-col";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = selected.has(p.sku); check.disabled = poolOperationBusy(); check.setAttribute("aria-label", `选择 ${p.sku}`);
    check.addEventListener("change", () => { toggleSelected(p,check.checked); updateSelection(page); }); checkCell.append(check);
    const nameCell = row.insertCell();
    const link = document.createElement("a");
    link.textContent = p.title || "商品";
    if (/^https:\/\/www\.ozon\.ru\/product\//i.test(p.link)) {link.href = p.link; link.target = "_blank"; link.rel = "noopener noreferrer";}
    if(globalThis.ozonLocalQuick){const select=e=>globalThis.OzonQuickPricingCore.selectBeforeOpen(e,()=>globalThis.ozonLocalQuick.select(p));link.addEventListener('click',select);link.addEventListener('auxclick',select);link.title='选中此 SKU 并打开 Ozon 商品页';}
    const meta = document.createElement("div");
    meta.className = "pool-product-meta";
    meta.append(document.createTextNode(p.sku), document.createElement("br"), link);
    if (p.category) {
      const catTag = document.createElement("small");
      catTag.className = "pool-cat-tag";
      catTag.textContent = p.category;
      meta.append(catTag);
    }
    if (showImages) {
      const wrap = document.createElement("div");
      wrap.className = "pool-product-cell";
      wrap.append(createThumb(p), meta);
      nameCell.append(wrap);
    } else {
      nameCell.append(meta);
    }
    const metricsCell = row.insertCell();
    const priceDiv = document.createElement("div");
    priceDiv.className = "pool-metrics-price";
    priceDiv.textContent = p.price || "—";
    const subDiv = document.createElement("div");
    subDiv.className = "pool-metrics-sub";
    const salesText = String(p.monthlySales || "").trim() || "—";
    const weightText = String(p.weight || "").trim() || "—";
    subDiv.textContent = `月销 ${salesText} · ${weightText}`;
    metricsCell.append(priceDiv, subDiv);
    if (p.blocked) {const warning=document.createElement("small");warning.className="weight-warning";warning.textContent="运输待复核";warning.title=p.shippingRisk||"";metricsCell.append(warning);}
    const sourceCell = row.insertCell();
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "pool-source-badge" + (p.sourceMode === "category" ? "" : " store");
    sourceBadge.textContent = p.sourceMode === "category" ? "类目" : "店铺";
    sourceCell.append(sourceBadge, document.createElement("br"), document.createTextNode(`${p.storeName} · ${String(p.lastSeenAt || "").slice(0,10)}`));
    const select = document.createElement("select");
    for (const [value,text] of Object.entries(core.statuses)) option(select,value,text);
    const draft = drafts.get(p.sku);
    select.value = draft?.status ?? p.status;
    const statusCell = row.insertCell();
    const badge = document.createElement("small");
    badge.className = "saved-status";
    badge.textContent = core.statuses[p.status] || "待找品";
    statusCell.append(select, badge);
    const notes = document.createElement("textarea"); notes.rows = 2; notes.maxLength = 4000; notes.value = draft?.notes ?? p.notes;
    notes.setAttribute("aria-label", `${p.sku} 备注`);
    row.insertCell().append(notes);
    const save = document.createElement("button");
    const reset = document.createElement("button"); reset.textContent="放弃草稿"; reset.hidden=!draft; reset.title="放弃未保存修改，恢复当前已保存状态";
    reset.addEventListener("click",()=>{if(poolOperationBusy())return;drafts.delete(p.sku);saveErrors.delete(p.sku);toggleSelected(p,false);render();});
    const receipt = document.createElement("small"); receipt.setAttribute("role","status");
    function showReceipt() {
      const pending = saving.has(p.sku), error = saveErrors.get(p.sku);
      select.disabled = notes.disabled = save.disabled = reset.disabled = poolOperationBusy();
      save.textContent = pending ? "保存中…" : "保存";
      receipt.className = pending ? "receipt-pending" : error ? "receipt-error" : drafts.has(p.sku) ? "receipt-dirty" : p.manualSavedAt ? "receipt-ok" : "";
      receipt.textContent = pending ? "正在写入本机…" : error ? error : drafts.has(p.sku) ? "有未保存修改" : p.manualSavedAt ? "✓ 已保存 " + saveTime(p.manualSavedAt) : "未记录人工保存时间";
    }
    function editDraft() {
      if (select.value === p.status && notes.value === p.notes) drafts.delete(p.sku);
      else drafts.set(p.sku, {status:select.value, notes:notes.value, expected:drafts.get(p.sku)?.expected || core.productExpectation(p)});
      saveErrors.delete(p.sku);
      reset.hidden=!drafts.has(p.sku);
      showReceipt();
      updateSelection(page);
    }
    select.addEventListener("change",editDraft);
    notes.addEventListener("input",editDraft);
    save.addEventListener("click", async () => {
      if (poolOperationBusy()) return;
      const patch = {status:select.value,notes:notes.value};
      const expected=drafts.get(p.sku)?.expected || core.productExpectation(p);
      saving.add(p.sku); saveErrors.delete(p.sku); render();
      try {
        const result = await send({type:"updateProductPoolItem",sku:p.sku,patch,expected});
        const saved = result.state?.products?.[p.sku];
        if (!saved?.manualSavedAt || saved.status !== patch.status || saved.notes !== patch.notes) throw Error("保存结果未确认，请刷新核对。");
        drafts.delete(p.sku);toggleSelected(p,false);
        feedback(`SKU ${p.sku} · 已保存到本机 · ${core.statuses[saved.status]}${core.matchesStatus(saved,$("filter").value) ? "" : "（已从当前筛选视图移出）"}`);
        await reloadAfterWrite();
      } catch(e) {
        drafts.set(p.sku,{...patch,expected});saveErrors.set(p.sku,e.message);feedback(`SKU ${p.sku} · 保存未确认：${e.message}`,true);
      } finally { saving.delete(p.sku); render(); }
    });
    row.insertCell().append(save,reset,receipt);
    showReceipt();
  }
  if (!page.length) {const c = $("rows").insertRow().insertCell();c.colSpan=7;c.textContent=refreshBusy?"正在读取…":"暂无符合条件的商品。请刷新或先在批量扫描页加入本批商品。";}
  updateSelection(page);
  $("page").textContent = pageInfo.matched ? `${offset+1}–${Math.min(offset+pageSize,pageInfo.matched)} / ${pageInfo.matched}` : "0 件";
  $("previous").disabled = poolOperationBusy() || offset === 0;
  $("next").disabled = poolOperationBusy() || offset + pageSize >= pageInfo.matched;
  globalThis.ozonLocalQuick?.sync(page);
  if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
}
async function refresh(at=offset) {if(poolWriteOrLoadBusy())return;clearTimeout(searchTimer);searchPending=false;refreshBusy=true;render();try {await loadPage(at);}catch(e){$("query").value=appliedQuery.query;$("filter").value=appliedQuery.filter;if($("source"))$("source").value=appliedQuery.source;$("sort").value=appliedQuery.sort;feedback(e.message,true);}finally{refreshBusy=false;render();}}
function updateSelection(page) {
  const count=selected.size, selectedOnPage=page.filter(p=>selected.has(p.sku)).length;
  $("selectionCount").textContent=`已选 ${count} 件`;
  if ($("batchFloat")) $("batchFloat").hidden = count === 0;
  $("selectPage").checked=page.length>0&&selectedOnPage===page.length;
  $("selectPage").indeterminate=selectedOnPage>0&&selectedOnPage<page.length;
  $("selectPage").disabled=poolOperationBusy()||!page.length;
  $("saveSelected").disabled=poolOperationBusy()||!page.some(p=>selected.has(p.sku)&&drafts.has(p.sku));
  $("rejectSelected").disabled=poolOperationBusy()||!count;
  $("refresh").disabled=poolOperationBusy();$("importHistory").disabled=poolOperationBusy();
  $("query").disabled=poolWriteOrLoadBusy();$("filter").disabled=poolOperationBusy();if($("source"))$("source").disabled=poolOperationBusy();$("sort").disabled=poolOperationBusy();
  for(const id of ["export","backup","exportHistory"])$(id).disabled=poolOperationBusy();
}
function visiblePage(){return pageInfo.items;}
async function runBulk(mode){
  if(poolOperationBusy())return;const skus=visiblePage().filter(p=>selected.has(p.sku)).map(p=>p.sku);if(!skus.length)return;
  if(mode==="reject"&&!confirm(`确认淘汰所选 ${skus.length} 件商品？已保存备注和未保存备注都会保留。`))return;
  const targets=mode==="save"?skus.filter(sku=>drafts.has(sku)):skus;
  if(!targets.length){feedback("所选商品没有待保存修改。",true);return;}
  const changes=targets.map(sku=>{const p=pool.products[sku],d=drafts.get(sku);return {sku,patch:{status:mode==="reject"?"rejected":d.status,notes:d?.notes??p.notes},expected:d?.expected||selectionExpected.get(sku)||core.productExpectation(p)}});
  batchBusy=true;globalThis.ozonProductPoolBatchBusy=true;render();
  try{
    const r=await send({type:"updateProductPoolItems",changes});
    for(const change of changes){const saved=r.state?.products?.[change.sku];if(!saved?.manualSavedAt||saved.status!==change.patch.status||saved.notes!==change.patch.notes)throw Error(`SKU ${change.sku} 保存结果未确认`);}
    for(const change of changes){drafts.delete(change.sku);saveErrors.delete(change.sku);toggleSelected(r.state.products[change.sku],false);}
    feedback(mode==="reject"?`已淘汰 ${changes.length} 件商品，备注已保留。`:`已保存 ${changes.length} 件商品。`);
    await reloadAfterWrite();
  }catch(e){feedback(`批量操作未确认，草稿和勾选已保留：${e.message}`,true);}
  finally{batchBusy=false;globalThis.ozonProductPoolBatchBusy=false;render();}
}
function download(name,text,type) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const a = document.createElement("a"); a.href=url; a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("query").addEventListener("input",()=>{if(poolWriteOrLoadBusy())return;clearTimeout(searchTimer);clearSelection();searchPending=true;render();searchTimer=setTimeout(()=>void refresh(0),180);});
for(const id of ["filter","source","sort"])if($(id))$(id).addEventListener("change",()=>{if(poolOperationBusy())return;clearSelection();void refresh(0);});
if($("showImages"))$("showImages").addEventListener("change",()=>{showImages=$("showImages").checked;try{localStorage.setItem(showImagesKey,showImages?"1":"0");}catch{}render();});
$("previous").addEventListener("click",()=>{if(poolOperationBusy())return;clearSelection();void refresh(Math.max(0,offset-pageSize));});
$("next").addEventListener("click",()=>{if(poolOperationBusy())return;clearSelection();void refresh(offset+pageSize);});
$("selectPage").addEventListener("change",()=>{if(poolOperationBusy())return;for(const p of visiblePage())toggleSelected(p,$("selectPage").checked);render();});
if($("clearSelectionBtn"))$("clearSelectionBtn").addEventListener("click",()=>{clearSelection();render();});
$("saveSelected").addEventListener("click",()=>runBulk("save"));
$("rejectSelected").addEventListener("click",()=>runBulk("reject"));
$("refresh").addEventListener("click",()=>void refresh());
async function exportAll(id){if(poolOperationBusy())return;exportBusy=true;render();try{const full=(await send({type:"getProductPool"})).pool;if(!full?.products||!full?.history)throw Error("导出读取失败");if(id==="export")download("Ozon商品池.csv","\ufeff"+core.exportPoolCsv(full),"text/csv;charset=utf-8");else if(id==="backup")download("Ozon商品池备份.json",JSON.stringify(full,null,2),"application/json");else download("Ozon历史SKU.txt",Object.keys(full.history).join("\n"),"text/plain;charset=utf-8");}catch(e){feedback(e.message,true);}finally{exportBusy=false;render();}}
for(const id of ["export","backup","exportHistory"])$(id).addEventListener("click",()=>void exportAll(id));
$("importHistory").addEventListener("click",async()=>{
  if(poolOperationBusy())return;historyBusy=true;const button=$("importHistory"); button.disabled=true;render();
  try {const r=await send({type:"importProductPoolHistory",text:$("history").value});$("history").value="";feedback(`新增历史 SKU ${r.added} 个，忽略无效项 ${r.invalid} 个`);await reloadAfterWrite();}
  catch(e){feedback(e.message,true);}finally{historyBusy=false;button.disabled=false;render();}
});
refresh();
