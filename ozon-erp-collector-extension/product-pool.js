const core = globalThis.OzonProductPoolCore;
const $ = id => document.getElementById(id);
let pool = core.emptyPool();
let offset = 0;
const pageSize = 50;
const drafts = new Map();
const saving = new Set();
const saveErrors = new Map();
const selected = new Set();
const selectionExpected = new Map();
let batchBusy = false;
let historyBusy = false;
let refreshBusy = false;
let quickStatusBusy = false;
const poolOperationBusy = () => batchBusy || historyBusy || refreshBusy || quickStatusBusy || saving.size > 0;
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
  const all = Object.values(pool.products);
  $("total").textContent = all.length;
  $("newCount").textContent = all.filter(p => p.status === "new" && !p.blocked).length;
  $("historyCount").textContent = Object.keys(pool.history).length;
  const query = $("query").value.trim().toLowerCase();
  const filtered = all.filter(p => core.matchesStatus(p, $("filter").value)
    && [p.sku,p.title,p.category,p.storeName].some(s => String(s || "").toLowerCase().includes(query)))
    .sort((a,b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  offset = Math.min(offset, Math.max(0, Math.floor((filtered.length - 1) / pageSize) * pageSize));
  const page = filtered.slice(offset, offset + pageSize);
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
    const name = cell(row, p.sku);
    name.append(document.createElement("br"));
    const link = document.createElement("a");
    link.textContent = p.title || "商品";
    if (/^https:\/\/www\.ozon\.ru\/product\//i.test(p.link)) {link.href = p.link; link.target = "_blank"; link.rel = "noopener noreferrer";}
    name.append(link);
    if(globalThis.ozonLocalQuick){const select=e=>globalThis.OzonQuickPricingCore.selectBeforeOpen(e,()=>globalThis.ozonLocalQuick.select(p));link.addEventListener('click',select);link.addEventListener('auxclick',select);link.title='选中此 SKU 并打开 Ozon 商品页';}
    cell(row,p.category); cell(row,p.price);
    const weight = cell(row,String(p.weight||"").trim());
    if (p.blocked) {const warning=document.createElement("small");warning.className="weight-warning";warning.textContent="运输待复核";warning.title=p.shippingRisk||"";weight.append(warning);}
    cell(row, `${p.storeName} · ${String(p.lastSeenAt || "").slice(0,10)}`);
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
        pool = result.state;
        const saved = pool.products[p.sku];
        if (!saved?.manualSavedAt || saved.status !== patch.status || saved.notes !== patch.notes) throw Error("保存结果未确认，请刷新核对。");
        drafts.delete(p.sku);toggleSelected(p,false);
        feedback(`SKU ${p.sku} · 已保存到本机 · ${core.statuses[saved.status]}${core.matchesStatus(saved,$("filter").value) ? "" : "（已从当前筛选视图移出）"}`);
      } catch(e) {
        drafts.set(p.sku,{...patch,expected});saveErrors.set(p.sku,e.message);feedback(`SKU ${p.sku} · 保存未确认：${e.message}`,true);
      } finally { saving.delete(p.sku); render(); }
    });
    row.insertCell().append(save,reset,receipt);
    showReceipt();
  }
  if (!filtered.length) {const c = $("rows").insertRow().insertCell();c.colSpan=9;c.textContent="暂无符合条件的商品。请先在批量扫描页加入本批商品。";}
  updateSelection(page);
  $("page").textContent = filtered.length ? `${offset+1}–${Math.min(offset+pageSize,filtered.length)} / ${filtered.length}` : "0 件";
  $("previous").disabled = poolOperationBusy() || offset === 0;
  $("next").disabled = poolOperationBusy() || offset + pageSize >= filtered.length;
  globalThis.ozonLocalQuick?.sync(filtered);
  if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
}
async function refresh() {if(poolOperationBusy())return;refreshBusy=true;render();try {pool=(await send({type:"getProductPool"})).pool;}catch(e){feedback(e.message,true);}finally{refreshBusy=false;render();}}
function updateSelection(page) {
  const count=selected.size, selectedOnPage=page.filter(p=>selected.has(p.sku)).length;
  $("selectionCount").textContent=`已选 ${count} 件`;
  $("selectPage").checked=page.length>0&&selectedOnPage===page.length;
  $("selectPage").indeterminate=selectedOnPage>0&&selectedOnPage<page.length;
  $("selectPage").disabled=poolOperationBusy()||!page.length;
  $("saveSelected").disabled=poolOperationBusy()||!page.some(p=>selected.has(p.sku)&&drafts.has(p.sku));
  $("rejectSelected").disabled=poolOperationBusy()||!count;
  $("refresh").disabled=poolOperationBusy();$("importHistory").disabled=poolOperationBusy();
  $("query").disabled=poolOperationBusy();$("filter").disabled=poolOperationBusy();
}
function visiblePage(){const q=$("query").value.trim().toLowerCase();return Object.values(pool.products).filter(p=>core.matchesStatus(p,$("filter").value)&&[p.sku,p.title,p.category,p.storeName].some(s=>String(s||"").toLowerCase().includes(q))).sort((a,b)=>String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))).slice(offset,offset+pageSize);}
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
    pool=r.state;for(const change of changes){drafts.delete(change.sku);saveErrors.delete(change.sku);toggleSelected(pool.products[change.sku],false);}
    feedback(mode==="reject"?`已淘汰 ${changes.length} 件商品，备注已保留。`:`已保存 ${changes.length} 件商品。`);
  }catch(e){feedback(`批量操作未确认，草稿和勾选已保留：${e.message}`,true);}
  finally{batchBusy=false;globalThis.ozonProductPoolBatchBusy=false;render();}
}
function download(name,text,type) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const a = document.createElement("a"); a.href=url; a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("query").addEventListener("input",()=>{if(poolOperationBusy())return;offset=0;clearSelection();render();});
$("filter").addEventListener("change",()=>{if(poolOperationBusy())return;offset=0;clearSelection();render();});
$("previous").addEventListener("click",()=>{if(poolOperationBusy())return;offset-=pageSize;clearSelection();render();});
$("next").addEventListener("click",()=>{if(poolOperationBusy())return;offset+=pageSize;clearSelection();render();});
$("selectPage").addEventListener("change",()=>{if(poolOperationBusy())return;for(const p of visiblePage())toggleSelected(p,$("selectPage").checked);render();});
$("saveSelected").addEventListener("click",()=>runBulk("save"));
$("rejectSelected").addEventListener("click",()=>runBulk("reject"));
$("refresh").addEventListener("click",refresh);
$("export").addEventListener("click",()=>download("Ozon商品池.csv","\ufeff"+core.exportPoolCsv(pool),"text/csv;charset=utf-8"));
$("backup").addEventListener("click",()=>download("Ozon商品池备份.json",JSON.stringify(pool,null,2),"application/json"));
$("exportHistory").addEventListener("click",()=>download("Ozon历史SKU.txt",Object.keys(pool.history).join("\n"),"text/plain;charset=utf-8"));
$("importHistory").addEventListener("click",async()=>{
  if(poolOperationBusy())return;historyBusy=true;const button=$("importHistory"); button.disabled=true;render();
  try {const r=await send({type:"importProductPoolHistory",text:$("history").value});pool=r.state;$("history").value="";feedback(`新增历史 SKU ${r.added} 个，忽略无效项 ${r.invalid} 个`);render();}
  catch(e){feedback(e.message,true);}finally{historyBusy=false;button.disabled=false;render();}
});
refresh();
