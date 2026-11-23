const $ = (id) => document.getElementById(id);
let state = null;
let history = [], busy = false;
const core=globalThis.OzonCategoryCore;
const labels={running:'运行中',paused:'已暂停',completed:'已完成',stopped:'已停止',pending:'待开始',loading:'打开页面',scanning:'扫描中',partial:'部分完成',failed:'失败',skipped:'已跳过'};
function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(Error(response?.error || "操作失败"));
    else resolve(response);
  }));
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function render(batch, archive=history) {
  state = batch || null;
  history=Array.isArray(archive)?archive:[];
  const stores = Array.isArray(batch?.stores) ? batch.stores : [];
  const selected = stores.reduce((a,s)=>a+Number(s.qualifiedCount||0),0);
  const checked = stores.reduce((a,s)=>a+Number(s.observedCount||0),0);
  const eligible = stores.reduce((a,s)=>a+Number(s.pendingCount||0),0);
  $("summary").textContent = batch ? `${labels[batch.status]||batch.status} · 新候选 ${selected}/${batch.options?.targetCount||'—'} · 已检查 ${checked} · 待复查 ${eligible}` : "暂无类目批次";
  $("message").textContent = batch?.message || "";
  $("batch").innerHTML = stores.length ? `<div class="store-list">${stores.map(s=>`<article class="store"><div class="store-top"><strong>${esc(s.name||s.label||s.url||"类目")}</strong><span>${esc(labels[s.status]||s.status||"等待")}</span></div><div class="store-url">${esc(s.pageUrl||s.url||"")}</div><div class="counts">已检查 ${Number(s.observedCount||0)} · 新候选 ${Number(s.qualifiedCount||0)} · 待复查 ${Number(s.pendingCount||0)}</div>${s.error||s.message||s.note?`<p class="store-reason">${esc(s.error||s.message||s.note)}</p>`:""}</article>`).join("")}</div>` : `<div class="empty">${batch ? "批次已建立，等待类目进度…" : "创建任务后，这里会显示每个类目的进度和结果。"}</div>`;
  const active = ["running","paused","scanning"].includes(batch?.status);
  $("start").disabled=busy||active;
  $("pause").disabled = busy||!active || batch.status === "paused";
  $("resume").disabled = busy||batch?.status !== "paused";
  $("stop").disabled = busy||!active;
  $("addPool").disabled = busy||!batch || !selected;
  if($("syncWorkbench")) $("syncWorkbench").disabled = busy||!batch || !stores.length;
  $("openScanTab").disabled=!Number.isInteger(batch?.tabId);
  $("exportBatch").disabled=busy||!batch;
  const chosen=$("historyBatch").value;$("historyBatch").replaceChildren(new Option('选择已结束批次',''),...history.map(b=>new Option(`${new Date(b.updatedAt).toLocaleString('zh-CN')} · ${Number(b.qualifiedCount||b.count||0)} 件`,b.id)));
  if(history.some(b=>b.id===chosen))$("historyBatch").value=chosen;
  $("addHistoryPool").disabled=$("exportHistoryBatch").disabled=busy||!$("historyBatch").value;
}
async function refresh() { if(busy)return;try { const r = await send({type:"categoryGet"}); render(r.batch || r.state || null,r.history); } catch(e) { $("message").textContent=e.message; } }
$("start").onclick = async () => {
  try{const parsed=core.parseUrls($("urls").value);if(!parsed.urls.length||parsed.invalid.length||parsed.overflowCount)throw Error('请提供 1–20 个有效 Ozon 类目链接，修正无效或超限地址。');
    const options=core.validateOptions({targetCount:$("targetCount").value,minPrice:$("minPrice").value,maxPrice:$("maxPrice").value});
    const needsArchiveConfirmation=history.length>=5&&!!state;
    if(needsArchiveConfirmation&&!confirm('历史类目批次已达 5 份，新任务可能替换最早批次；请先将需要的历史商品入池或同步。是否继续？'))return;
    await perform({type:"categoryStart",urls:parsed.urls,...options,confirmArchiveOverflow:needsArchiveConfirmation});
  }catch(e){$("message").textContent=e.message;}
};
async function perform(message){if(busy)return;busy=true;render(state);try{const r=await send(message);busy=false;render(r.batch||state,r.history||history);$("message").textContent=r.message||(message.type==='categoryAddPool'?`已加入 ${r.added||0} 件 · 重复 ${r.duplicates||0} · 历史排除 ${r.historySkipped||0}`:r.batch?.message||'操作已完成。');}catch(e){busy=false;render(state);$("message").textContent=e.message;}}
for(const [id,type] of [["pause","categoryPause"],["resume","categoryResume"],["stop","categoryStop"],["addPool","categoryAddPool"],["syncWorkbench","categorySyncWorkbench"]]) if($(id))$(id).onclick=()=>perform({type,batchId:state?.id});
$("historyBatch").onchange=()=>{$("addHistoryPool").disabled=$("exportHistoryBatch").disabled=busy||!$("historyBatch").value};
$("addHistoryPool").onclick=()=>perform({type:'categoryAddPool',batchId:$("historyBatch").value});
async function exportCsv(batchId){try{const r=await send({type:'categoryExport',batchId});const url=URL.createObjectURL(new Blob(['\ufeff'+r.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`Ozon类目选品-${batchId}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){$("message").textContent=e.message}}
$("exportBatch").onclick=()=>exportCsv(state?.id);$("exportHistoryBatch").onclick=()=>exportCsv($("historyBatch").value);
$("openScanTab").onclick=async()=>{try{if(!Number.isInteger(state?.tabId))return;const tab=await chrome.tabs.get(state.tabId);if(!tab)throw Error('采集页面已关闭');await chrome.tabs.update(tab.id,{active:true});if(tab.windowId!=null)await chrome.windows.update(tab.windowId,{focused:true});}catch(e){$("message").textContent=e.message}};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.ozonCategoryBatchV1||changes.ozonCategoryBatchHistoryV1))void refresh()});
void refresh();
