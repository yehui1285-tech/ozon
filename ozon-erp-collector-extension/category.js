const $ = (id) => document.getElementById(id);
let state = null;
let history = [], busy = false;
const core=globalThis.OzonCategoryCore;
const catalog=globalThis.OzonCategoryCatalog;
let catalogData=null, treeSelection=null, treeNodes=new Map(), favorites=[], expandedTree=new Set();
const labels={running:'运行中',paused:'已暂停',completed:'已完成',stopped:'已停止',pending:'待开始',loading:'打开页面',scanning:'扫描中',partial:'部分完成',failed:'失败',skipped:'已跳过'};
function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(Error(response?.error || "操作失败"));
    else resolve(response);
  }));
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function selectedCount(){return treeSelection?.selected.size||0}
function syncCatalogUrls(){ $('catalogCount').textContent=`树形已选 ${selectedCount()} / ${catalog.MAX}；手动链接会在开始时合并` }
function renderTree(){
  if(!treeSelection)return;
  const query=$('catalogSearch').value.trim().toLocaleLowerCase();
  const isVisible=n=>!query||catalog.names(n).toLocaleLowerCase().includes(query)||n.nameRu.toLocaleLowerCase().includes(query)||n.children.some(isVisible);
  function row(n,depth=0){if(!isVisible(n))return '';const checked=treeSelection.selected.has(n.id);const expanded=!!query||expandedTree.has(n.id);return `<div class="tree-row" role="treeitem" aria-level="${depth+1}"><span class="tree-indent" style="--depth:${depth}"></span>${n.children.length?`<details data-node="${esc(n.id)}" ${expanded?'open':''}><summary>${esc(catalog.names(n))}${checked?' · 已选':''}</summary><div class="tree-child">${checkbox(n,checked)}<button type="button" class="tree-branch" data-branch="${esc(n.id)}">选末级</button>${n.children.map(c=>row(c,depth+1)).join('')}</div></details>`:checkbox(n,checked)}</div>`}
  function checkbox(n,checked){return `<label class="tree-choice"><input type="checkbox" data-id="${esc(n.id)}" ${checked?'checked':''}><span>${esc(catalog.names(n))}</span></label>`}
  $('catalogTree').innerHTML=treeSelection.roots.map(n=>row(n)).join('')||'<div class="empty">没有匹配的类目。</div>';
  $('catalogTree').querySelectorAll('details[data-node]').forEach(d=>d.addEventListener('toggle',()=>{if(!query){if(d.open)expandedTree.add(d.dataset.node);else expandedTree.delete(d.dataset.node)}}));
  $('catalogTree').querySelectorAll('input[data-id]').forEach(input=>input.addEventListener('change',()=>{const node=treeNodes.get(input.dataset.id);try{treeSelection.toggle(node,input.checked);renderTree()}catch(e){input.checked=false;$('message').textContent=e.message}}));
  $('catalogTree').querySelectorAll('button[data-branch]').forEach(button=>button.addEventListener('click',()=>{try{treeSelection.addLeaves(treeNodes.get(button.dataset.branch));renderTree()}catch(e){$('message').textContent=e.message}}));syncCatalogUrls();
}
async function loadCatalog(){try{const response=await fetch('category-catalog.json');catalogData=await response.json();$('catalogProvenance').textContent=catalogData.provenance?.note||'本机类目快照';initCatalog();}catch(e){$('catalogProvenance').textContent='类目目录无法读取，请重载扩展后重试。';$('message').textContent=e.message}}
function initCatalog(){if(!catalogData)return;const source=$('catalogSource').value;const nodes=catalogData[source]||[];treeSelection=catalog.makeSelection(nodes);treeNodes=treeSelection.byId;expandedTree=new Set();renderTree()}
async function refreshFavorites(){favorites=await catalog.readFavorites();const select=$('favoriteSelect');const keep=select.value;select.replaceChildren(new Option('选择本机组合',''),...favorites.map(f=>new Option(`${f.name} · ${f.source==='china'?'中国专区':'普通 Ozon'}`,f.id)));if(favorites.some(f=>f.id===keep))select.value=keep}
function categoryLabels(){const labels={};for(const n of treeSelection?.selected.values()||[])labels[core.normalizeUrl(n.url)]=catalog.names(n).slice(0,120);return labels}
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
  const finishedBatch = ["completed","stopped","failed"].includes(batch?.status);
  $("start").disabled=busy||active;
  $("pause").disabled = busy||!active || batch.status === "paused";
  $("resume").disabled = busy||batch?.status !== "paused";
  $("stop").disabled = busy||!active;
  $("addPool").disabled = busy||!batch || !selected;
  if($("syncWorkbench")) $("syncWorkbench").disabled = busy||!batch || !stores.length;
  $("openScanTab").disabled=!Number.isInteger(batch?.tabId);
  $("exportBatch").disabled=busy||!batch;
  $("deleteCurrentBatch").disabled=busy||!finishedBatch;
  const chosen=$("historyBatch").value;$("historyBatch").replaceChildren(new Option('选择已结束批次',''),...history.map(b=>{const ended=["completed","stopped","failed"].includes(b.status);const option=new Option(`${new Date(b.updatedAt).toLocaleString('zh-CN')} · ${Number(b.qualifiedCount||b.count||0)} 件 · ${labels[b.status]||b.status}`,b.id);option.disabled=!ended;return option}));
  if(history.some(b=>b.id===chosen))$("historyBatch").value=chosen;
  $("addHistoryPool").disabled=$("exportHistoryBatch").disabled=busy||!$("historyBatch").value;
  $("deleteHistoryBatch").disabled=busy||!history.some(b=>b.id===$("historyBatch").value&&["completed","stopped","failed"].includes(b.status));
  const currentEmpty=finishedBatch&&Number(batch?.qualifiedSkuIds?.length||0)===0&&stores.reduce((n,s)=>n+Number(s.qualifiedCount||0),0)===0;
  $("cleanupEmptyBatches").disabled=busy||(!currentEmpty&&!history.some(b=>["completed","stopped","failed"].includes(b.status)&&Number(b.qualifiedCount||b.count||0)===0));
}
async function refresh() { if(busy)return;try { const r = await send({type:"categoryGet"}); render(r.batch || r.state || null,r.history); } catch(e) { $("message").textContent=e.message; } }
$("start").onclick = async () => {
  try{const treeUrls=treeSelection?.urls()||[];const manual=$('urls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const parsed=core.parseUrls([...manual,...treeUrls]);if(!parsed.urls.length||parsed.invalid.length||parsed.overflowCount)throw Error('请提供 1–20 个有效 Ozon 类目链接，修正无效或超限地址。');
    const options=core.validateOptions({targetCount:$("targetCount").value,minPrice:$("minPrice").value,maxPrice:$("maxPrice").value});
    const needsArchiveConfirmation=history.length>=5&&!!state;
    if(needsArchiveConfirmation&&!confirm('历史类目批次已达 5 份，新任务可能替换最早批次；请先将需要的历史商品入池或同步。是否继续？'))return;
    await perform({type:"categoryStart",urls:parsed.urls,categoryLabels:categoryLabels(),...options,confirmArchiveOverflow:needsArchiveConfirmation});
  }catch(e){$("message").textContent=e.message;}
};
async function perform(message){if(busy)return;busy=true;render(state);try{const r=await send(message);busy=false;render(Object.hasOwn(r,'batch')?r.batch:state,Array.isArray(r.history)?r.history:history);$("message").textContent=r.message||(message.type==='categoryAddPool'?`已加入 ${r.added||0} 件 · 重复 ${r.duplicates||0} · 历史排除 ${r.historySkipped||0}`:r.batch?.message||'操作已完成。');}catch(e){busy=false;render(state);$("message").textContent=e.message;}}
for(const [id,type] of [["pause","categoryPause"],["resume","categoryResume"],["stop","categoryStop"],["addPool","categoryAddPool"],["syncWorkbench","categorySyncWorkbench"]]) if($(id))$(id).onclick=()=>perform({type,batchId:state?.id});
$("historyBatch").onchange=()=>{$("addHistoryPool").disabled=$("exportHistoryBatch").disabled=$("deleteHistoryBatch").disabled=busy||!$("historyBatch").value};
$("addHistoryPool").onclick=()=>perform({type:'categoryAddPool',batchId:$("historyBatch").value});
$("deleteHistoryBatch").onclick=()=>{const id=$("historyBatch").value;if(!id)return;const item=history.find(x=>x.id===id);if(!confirm(`确认删除所选已结束类目批次（${Number(item?.qualifiedCount||0)} 个候选）？本机商品池、SKU 历史和工作台云端数据不会改动。`))return;void perform({type:'categoryDeleteBatch',batchId:id})};
$("deleteCurrentBatch").onclick=()=>{if(!state||!["completed","stopped","failed"].includes(state.status))return;const count=Number(state.qualifiedSkuIds?.length||state.stores?.reduce((n,s)=>n+Number(s.qualifiedCount||0),0)||0);if(!confirm(`确认删除当前已结束类目批次（${count} 个候选）？本机商品池、SKU 历史和工作台云端数据不会改动。`))return;void perform({type:'categoryDeleteBatch',batchId:state.id})};
$("cleanupEmptyBatches").onclick=()=>{if(!confirm('清理所有已结束且没有候选的类目批次，包括当前已结束的空批次？运行中和暂停中的批次会保留；商品池、SKU 历史和工作台云端数据不会改动。'))return;void perform({type:'categoryCleanupEmpty'})};
async function exportCsv(batchId){try{const r=await send({type:'categoryExport',batchId});const url=URL.createObjectURL(new Blob(['\ufeff'+r.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`Ozon类目选品-${batchId}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){$("message").textContent=e.message}}
$("exportBatch").onclick=()=>exportCsv(state?.id);$("exportHistoryBatch").onclick=()=>exportCsv($("historyBatch").value);
$("openScanTab").onclick=async()=>{try{if(!Number.isInteger(state?.tabId))return;const tab=await chrome.tabs.get(state.tabId);if(!tab)throw Error('采集页面已关闭');await chrome.tabs.update(tab.id,{active:true});if(tab.windowId!=null)await chrome.windows.update(tab.windowId,{focused:true});}catch(e){$("message").textContent=e.message}};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.ozonCategoryBatchV1||changes.ozonCategoryBatchHistoryV1))void refresh()});
// Tree selection is independent until Start is pressed; switching sources preserves manual links.
$('catalogSource').onchange=()=>{initCatalog();$('message').textContent='已切换目录来源；手动链接保持不变。'};
$('catalogSearch').oninput=renderTree;$('catalogClear').onclick=()=>{treeSelection?.clear();renderTree()};
$('saveFavorite').onclick=async()=>{const name=$('favoriteName').value.trim();if(!name){$('message').textContent='请先填写组合名称。';return}if(!selectedCount()){ $('message').textContent='请选择至少一个目录类目。';return}favorites=await catalog.readFavorites();const item={id:crypto.randomUUID(),name,source:$('catalogSource').value,ids:[...treeSelection.selected.keys()]};favorites=[...favorites.filter(f=>f.name!==name||f.source!==item.source),item].slice(-30);await catalog.writeFavorites(favorites);await refreshFavorites();$('message').textContent=`已保存“${name}”到本机。`};
$('loadFavorite').onclick=()=>{const f=favorites.find(x=>x.id===$('favoriteSelect').value);if(!f||!catalogData)return;if(f.source!==$('catalogSource').value){$('catalogSource').value=f.source;initCatalog()}try{treeSelection.clear();let missing=0;for(const id of f.ids){const node=treeNodes.get(id);if(node&&!treeSelection.selected.has(id)){treeSelection.add(node);for(let p=node;p;p=treeNodes.get(p.parentId))expandedTree.add(p.id)}else if(!node)missing++}renderTree();$('message').textContent=`已载入“${f.name}”${missing?`，${missing} 项已不在目录中需复核`:''}。`}catch(e){treeSelection.clear();renderTree();$('message').textContent=`组合超过当前上限，未载入：${e.message}`}};
$('deleteFavorite').onclick=async()=>{const id=$('favoriteSelect').value;if(!id)return;await catalog.writeFavorites(favorites.filter(f=>f.id!==id));await refreshFavorites();$('message').textContent='已删除本机组合。'};
void refreshFavorites();void loadCatalog();
void refresh();
