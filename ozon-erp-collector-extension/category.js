const $ = (id) => document.getElementById(id);
let state = null;
let history = [], busy = false, refreshSequence = 0, actionRevision = 0, refreshInFlight = false, refreshPending = false;
const core=globalThis.OzonCategoryCore;
const catalog=globalThis.OzonCategoryCatalog;
let catalogData=null, treeSelection=null, confirmedSource='china', draftSelection=null, favorites=[], navPath=[];
const labels={running:'运行中',paused:'已暂停',completed:'已完成',stopped:'已停止',pending:'待开始',loading:'打开页面',scanning:'扫描中',partial:'部分完成',deferred:'待回查',failed:'失败',skipped:'已跳过'};
const waitReasons={catalog_loading:'商品列表仍在加载',hidden_bottom:'页面在后台，列表底部尚未确认',scroll_stalled:'页面滚动暂时停滞',review_pending:'仍有商品字段待复查',list_ambiguous:'商品列表范围不明确',no_new_sku:'本轮尚未发现新商品'};
const pageModes={foreground:'前台',background:'后台',waiting:'等待中',recovering:'恢复中'};
const pagePriceStatusLabels={confirmed:'页面价格筛选已确认',unconfirmed:'页面价格筛选未确认',pending:'页面价格筛选待确认'};
const activityLabels={'starting':'正在连接','native-background-only':'普通后台','focus-emulation-enabled':'试验模式已连接','focus-emulation-unavailable':'试验连接不可用','unavailable':'试验连接不可用','focus-emulation-detached':'试验连接已结束','focus-emulation-released':'试验连接已释放'};
const sourceInput=()=>document.querySelector('[name="catalogSource"]:checked');
const sourceValue=()=>sourceInput()?.value||'china';
function setSource(source){const input=document.querySelector(`[name="catalogSource"][value="${source==='ordinary'?'ordinary':'china'}"]`);if(input)input.checked=true;$('catalogAdvanced').open=source==='ordinary'}
function formatTimestamp(value){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN')}
const diagnosticLabels={erp_pending:'ERP待补',erp_conflict:'ERP冲突',data_pending:'资料待补',no_label:'无标签命中',price_outside:'价格范围外',transport_blocked:'运输受限',accepted:'已接受',batch_duplicate:'本批重复',pool_duplicate:'商品池重复',history_duplicate:'历史重复',target_limit:'达到目标上限',invalid_candidate:'候选无效',eligible:'可入选',unknown:'原因未分类'};
function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(Error(response?.error || "操作失败"));
    else resolve(response);
  }));
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderTaskCard(task,batch){
  const status=task.status==='scanning'&&['paused','stopped'].includes(batch?.status)?(batch.status==='paused'?'paused':'stopped'):task.status||'pending';
  const canManage=['paused','stopped'].includes(batch?.status);
  const runnable=!['completed','skipped','failed'].includes(task.status||'pending')&&!task.removedFromQueue;
  const targetReached=Number(batch?.options?.targetCount)>0&&(batch?.stores||[]).reduce((n,item)=>n+Number(item.qualifiedCount||0),0)>=Number(batch.options.targetCount);
  const reason=status==='skipped'?task.skipReason:(['deferred','partial','paused'].includes(status)||batch?.status==='paused'
    ? waitReasons[task.waitReason]||task.error||task.message||task.note||(task.waitReason?'等待条件暂未分类':'')
    : task.error||task.message||task.note);
  const revisitCount=Math.max(0,Number(task.revisitCount)||0);
  const pagePriceStatus=pagePriceStatusLabels[task.pagePriceStatus]||'';
  const dc=task.diagnosticCounts&&typeof task.diagnosticCounts==='object'?task.diagnosticCounts:null;
  const diagnostic=dc?`<details class="diagnostic" data-category-key="${esc(task.sellerKey||task.url||'')}"><summary>唯一 SKU 诊断（${Object.values(dc).reduce((n,v)=>n+(Number(v)||0),0)}）</summary><div class="diagnostic-chips">${Object.entries(diagnosticLabels).filter(([k])=>Number(dc[k])>0).map(([k,v])=>`<span class="diagnostic-chip">${v} ${Number(dc[k])}</span>`).join('')||'<span>暂无原因计数</span>'}</div></details>`:'';
  const isScheduled=batch?.status==='paused'&&Number.isInteger(batch.resumeIndex)&&(batch.stores||[])[batch.resumeIndex]===task;
  const actions=canManage&&runnable&&!busy?`<div class="store-actions">${!targetReached?`<button type="button" class="soft-primary compact" data-task-action="resume" data-seller-key="${esc(task.sellerKey||'')}">${isScheduled?'下一次继续':'从此类目继续'}</button>`:''}<button type="button" class="compact" data-task-action="skip" data-seller-key="${esc(task.sellerKey||'')}">跳过</button><button type="button" class="danger compact" data-task-action="remove" data-seller-key="${esc(task.sellerKey||'')}">删除</button></div>`:'';
  return `<article class="store${status==='scanning'?' active':''}">
    <div class="store-top"><strong>${esc(task.name||task.label||task.url||'类目')}</strong><span class="status-badge${status==='scanning'?' running':''}">${esc(labels[status]||status||'等待')}</span></div>
    <div class="store-url">${esc(task.pageUrl||task.url||'')}</div>
    <div class="counts">已检查 ${Number(task.observedCount||0)} · 新候选 ${Number(task.qualifiedCount||0)} · ${status==='skipped'?'历史待复查':'待复查'} ${Number(task.pendingCount||0)}</div>
    <div class="counts">发现商品 ${task.discoveredCount??'—'} · ERP 就绪 ${task.erpReadyCount??'—'} · 标签命中 ${task.labelHitCount??'—'}</div>
    ${pagePriceStatus?`<div class="counts">${pagePriceStatus}</div>`:''}
    ${diagnostic}
    ${status==='deferred'?'<p class="store-reason">先扫待开始类目，再回查此项</p>':''}
    ${revisitCount>0?`<p class="store-reason">自动回查 ${revisitCount}/1</p>`:''}
    ${reason?`<p class="store-reason">${esc(reason)}</p>`:''}
    ${actions}
  </article>`;
}
const sourceName=source=>source==='china'?'中国专区':'普通 Ozon 类目';
function pathFor(node,selection){const path=[];for(let n=node;n;n=selection.byId.get(n.parentId))path.unshift(n);return path}
function displayPath(node,selection){return pathFor(node,selection).map(catalog.names).join(' / ')}
function newSelection(source,ids=[]){const selection=catalog.makeSelection(catalogData[source]||[]);let missing=0;for(const id of ids){const node=selection.byId.get(id);if(node)selection.add(node);else missing++}return {selection,missing}}
function setDraft(source,ids=[]){const result=newSelection(source,ids);draftSelection=result.selection;setSource(source);navPath=[];$('catalogSearch').value='';const first=[...draftSelection.selected.values()][0];if(first)navPath=pathFor(first,draftSelection).map(n=>n.id);return result.missing}
function selectedCount(selection=treeSelection){return selection?.selected.size||0}
function renderSelected(container,selection,remove){const items=[...(selection?.selected.values()||[])];container.innerHTML=items.length?items.map(n=>`<span class="catalog-chip"><span title="${esc(displayPath(n,selection))}">${esc(displayPath(n,selection))}</span><button type="button" data-remove="${esc(n.id)}" aria-label="移除 ${esc(displayPath(n,selection))}">×</button></span>`).join(''):'<span class="catalog-muted">尚未选择类目</span>';container.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>remove(selection.byId.get(btn.dataset.remove)))}
function syncCatalogUrls(){ $('catalogCount').textContent=`已选 ${selectedCount()} / ${catalog.MAX}`;$('catalogSourceLabel').textContent=sourceName(confirmedSource);renderSelected($('catalogSelected'),treeSelection,node=>{treeSelection.remove(node);syncCatalogUrls()}) }
function normalizeSearch(s){return String(s||'').trim().toLocaleLowerCase().replace(/\s*(?:[>›/→]+)\s*/g,'/')}
function categoryNumber(n){try{const u=new URL(n.url);return u.searchParams.get('category')||u.pathname.match(/-(\d+)\/?$/)?.[1]||''}catch{return ''}}
function nodeMatch(n,query){const path=pathFor(n,draftSelection);return [catalog.names(n),n.nameRu,categoryNumber(n),n.id,path.map(catalog.names).join('/'),path.map(p=>p.nameRu).join('/'),path.map(categoryNumber).join('/')].some(value=>normalizeSearch(value).includes(query))}
function renderPicker(resetFrom=4){
  if(!draftSelection)return;
  const query=normalizeSearch($('catalogSearch').value);const visible=new Set();
  function visit(n){const child=n.children.map(visit).some(Boolean),match=!query||nodeMatch(n,query)||child;if(match)visible.add(n.id);return match}
  draftSelection.roots.forEach(visit);
  const roots=draftSelection.roots.filter(n=>visible.has(n.id));
  const root=roots.find(n=>n.id===navPath[0]);const second=(root?.children||[]).find(n=>n.id===navPath[1]&&visible.has(n.id));
  if(!root)navPath=[];else if(!second)navPath=[root.id];
  const lists=[roots,(root?.children||[]).filter(n=>visible.has(n.id)),(second?.children||[]).filter(n=>visible.has(n.id))];
  $('catalogTitle2').textContent=root?catalog.names(root):'二级类目';$('catalogTitle3').textContent=second?catalog.names(second):'三级类目';
  $('catalogLeaves1').hidden=!root?.children.length;$('catalogLeaves2').hidden=!second?.children.length;
  const focused=document.activeElement,focusId=focused?.dataset?.check||focused?.dataset?.nav,focusKey=focused?.dataset?.check?'check':'nav';
  lists.forEach((nodes,i)=>{const level=i+1,box=$('catalogLevel'+level),scroll=level<resetFrom?box.scrollTop:0;
    box.innerHTML=nodes.length?nodes.map(n=>{const checked=draftSelection.selected.has(n.id),active=navPath[i]===n.id;return `<div class="catalog-row${active?' active':''}${checked?' checked':''}"><input type="checkbox" data-check="${esc(n.id)}" aria-label="${esc(catalog.names(n))}" ${checked?'checked':''}><button type="button" class="catalog-node" data-nav="${esc(n.id)}" aria-pressed="${active}" title="${esc(displayPath(n,draftSelection))} · ${esc(n.nameRu)}"><span>${esc(catalog.names(n))}</span>${n.children.length?'<span class="catalog-chevron" aria-hidden="true">›</span>':''}</button></div>`}).join(''):`<div class="catalog-empty">${level===1?'没有匹配的类目':level===2&&!root?'点击左侧一级类目名称':level===3&&!second?'点击左侧二级类目名称':'没有下级类目'}</div>`;
    box.scrollTop=scroll;
    box.querySelectorAll('[data-nav]').forEach(btn=>btn.onclick=()=>{const node=draftSelection.byId.get(btn.dataset.nav);navPath=pathFor(node,draftSelection).map(n=>n.id);renderPicker(level+1)});
    box.querySelectorAll('[data-check]').forEach(input=>input.onchange=()=>{try{draftSelection.toggle(draftSelection.byId.get(input.dataset.check),input.checked);$('catalogFeedback').textContent='';renderPicker()}catch(e){input.checked=false;$('catalogFeedback').textContent=e.message}});
    if(focusId){const target=[...box.querySelectorAll(`[data-${focusKey}]`)].find(el=>el.dataset[focusKey]===focusId);target?.focus({preventScroll:true})}
  });
  $('catalogDraftCount').textContent=`已选 ${selectedCount(draftSelection)} / ${catalog.MAX}`;
  renderSelected($('catalogDraftSelected'),draftSelection,node=>{draftSelection.remove(node);$('catalogFeedback').textContent='';renderPicker()});
}
function searchPicker(){const query=normalizeSearch($('catalogSearch').value);if(query){const nodes=[...draftSelection.byId.values()];const first=nodes.find(n=>normalizeSearch(categoryNumber(n))===query)||nodes.find(n=>nodeMatch(n,query));navPath=first?pathFor(first,draftSelection).map(n=>n.id):[]}renderPicker(1)}
async function loadCatalog(){try{const response=await fetch('category-catalog.json');if(!response.ok)throw Error('类目目录无法读取');catalogData=await response.json();$('catalogProvenance').textContent=catalogData.provenance?.note||'本机类目快照';treeSelection=newSelection(confirmedSource).selection;syncCatalogUrls();$('openCatalog').disabled=false;$('catalogLoadState').textContent='选择后可直接开始扫描'}catch(e){$('catalogLoadState').textContent='类目目录无法读取，请重载扩展后重试。';$('message').textContent=e.message}}
async function refreshFavorites(){favorites=await catalog.readFavorites();const select=$('favoriteSelect');const keep=select.value;select.replaceChildren(new Option('选择本机组合',''),...favorites.map(f=>new Option(`${f.name} · ${f.source==='china'?'中国专区':'普通 Ozon'}`,f.id)));if(favorites.some(f=>f.id===keep))select.value=keep}
function categoryLabels(){const labels={};for(const n of treeSelection?.selected.values()||[])labels[core.normalizeUrl(n.url)]=catalog.names(n).slice(0,120);return labels}
function render(batch, archive=history) {
  const expandedDiagnostics=batch?.id===state?.id?new Set([...$('batch').querySelectorAll('.diagnostic[open]')].map(item=>item.dataset.categoryKey)):new Set();
  $("backgroundExperiment").checked=false;
  state = batch || null;
  history=Array.isArray(archive)?archive:[];
  const stores = Array.isArray(batch?.stores) ? batch.stores : [];
  const selected = stores.reduce((a,s)=>a+Number(s.qualifiedCount||0),0);
  const checked = stores.reduce((a,s)=>a+Number(s.observedCount||0),0);
  const eligible = stores.filter(s=>!s.removedFromQueue&&s.status!=='skipped'&&s.status!=='completed').reduce((a,s)=>a+Number(s.pendingCount||0),0);
  const summaryParts=batch?[labels[batch.status]||batch.status,`新候选 ${selected}/${batch.options?.targetCount||'—'}`,`已检查 ${checked}`,`待复查 ${eligible}`]:[];
  if(batch){const min=batch.options?.pageMinRub,max=batch.options?.pageMaxRub;summaryParts.push(min==null&&max==null?'页面筛选 未设置':`页面筛选 ${min??'不限'}–${max??'不限'} ₽`)}
  if(batch){const progressAt=formatTimestamp(batch.lastProgressAt),newSkuAt=formatTimestamp(batch.lastNewSkuAt);if(progressAt)summaryParts.push(`最近上报 ${progressAt}`);if(newSkuAt)summaryParts.push(`最近新增 SKU ${newSkuAt}`);if(batch.pageMode)summaryParts.push(`页面${pageModes[batch.pageMode]||'未知'}`)}
  if(batch?.activityStatus)summaryParts.push(activityLabels[batch.activityStatus]||'等待采集连接');
  const diagTotals={};for(const store of stores)for(const [key,value] of Object.entries(store.diagnosticCounts||{}))diagTotals[key]=(diagTotals[key]||0)+(Number(value)||0);
  const diagnosticLines=[];
  if(Object.keys(diagTotals).length)diagnosticLines.push(`诊断按类目 SKU 汇总（同一 SKU 跨类目会重复计数）：${Object.entries(diagnosticLabels).filter(([k])=>diagTotals[k]>0).map(([k,v])=>`${v} ${diagTotals[k]}`).join(' · ')}`);
  else if(batch)diagnosticLines.push('原因诊断暂无数据（旧批次可能不含诊断计数）');
  if(batch){
    const browser=batch.diagnosticBrowser;
    if(browser){
      const actual=({complete:'已加载',loading:'加载中',unloaded:'已卸载'})[browser.tabStatus]||'未知';
      const focus=browser.windowFocused===true?'窗口已聚焦':browser.windowFocused===false?'窗口未聚焦':'窗口状态未知';
      const page=browser.pageReportedHidden===true?'页面自报后台':browser.pageReportedHidden===false?'页面自报前台':'页面可见性未知';
      const pageFocus=browser.pageFocused===true?'页面自报有焦点':browser.pageFocused===false?'页面自报无焦点':'页面焦点未知';
      const active=browser.tabActive===true?'活动标签':browser.tabActive===false?'非活动标签':'标签活动状态未知';
      diagnosticLines.push(`浏览器状态：${actual}${browser.frozen?' · 冻结':''}${browser.discarded?' · 已丢弃':''} · ${active} · ${focus}${formatTimestamp(browser.checkedAt)?` · 检查于 ${formatTimestamp(browser.checkedAt)}`:''}`);
      diagnosticLines.push(`${page} · ${pageFocus}${formatTimestamp(browser.pageReportedAt)?` · 上报于 ${formatTimestamp(browser.pageReportedAt)}`:''}`);
    }
    const times=[];for(const [key,label] of [['lastDiscoveryAt','最近发现'],['lastErpReadyAt','最近 ERP 就绪'],['lastLabelHitAt','最近标签命中'],['lastAcceptedAt','最近新增候选']]){const at=formatTimestamp(batch[key]);if(at)times.push(`${label} ${at}`)}
    if(times.length)diagnosticLines.push(times.join(' · '));
    if(batch.recentWaitReason)diagnosticLines.push(`最近等待：${waitReasons[batch.recentWaitReason]||'查看诊断记录'}`);
  }
  if($('diagBox'))$('diagBox').hidden=!batch;
  $('diagnosticOverview').hidden=!batch;$('diagnosticOverview').textContent=diagnosticLines.join('\n');
  const statusBadge=$('batchStatusBadge');
  if(statusBadge){
    statusBadge.hidden=!batch;
    if(batch){
      statusBadge.textContent=labels[batch.status]||batch.status||'';
      statusBadge.className='status-badge'+(['running','scanning'].includes(batch.status)?' running':'');
    }
  }
  const kpiGrid=$('kpiGrid');
  if(kpiGrid){
    kpiGrid.hidden=!batch;
    if(batch){
      const min=batch.options?.pageMinRub,max=batch.options?.pageMaxRub;
      $('kpiCandidates').textContent=`${selected} / ${batch.options?.targetCount||'—'}`;
      $('kpiObserved').textContent=String(checked);
      $('kpiReview').textContent=String(eligible);
      $('kpiRub').textContent=min==null&&max==null?'未设置':`${min??'不限'}–${max??'不限'} ₽`;
    }
  }
  $("summary").textContent=batch?summaryParts.join(' · '):"暂无类目批次";
  $("message").textContent = batch?.message || "";
  const visibleStores=stores.filter(task=>!task.removedFromQueue);
  const removedCount=stores.filter(task=>task.removedFromQueue).length;
  $("batch").innerHTML = stores.length
    ? `${removedCount?`<p class="removed-summary">已移出 ${removedCount} 项；移出只调整本批队列，已采集商品仍计入本批结果。</p>`:''}${visibleStores.length?`<div class="store-list">${visibleStores.map(task=>renderTaskCard(task,batch)).join('')}</div>`:'<div class="empty">本批类目均已移出队列。</div>'}`
    : `<div class="empty">${batch ? "批次已建立，等待类目进度…" : "创建任务后，这里会显示每个类目的进度和结果。"}</div>`;
  $('batch').querySelectorAll('.diagnostic').forEach(item=>{item.open=expandedDiagnostics.has(item.dataset.categoryKey)});
  const active = ["running","paused","scanning"].includes(batch?.status);
  const finishedBatch = ["completed","stopped","failed"].includes(batch?.status);
  $("batch").querySelectorAll('[data-task-action]').forEach(button=>button.onclick=()=>{
    const action=button.dataset.taskAction,sellerKey=button.dataset.sellerKey;
    if(!sellerKey||!state||!['paused','stopped'].includes(state.status))return;
    if(action==='remove'&&!confirm('确认从本批队列删除此类目？已采集商品仍保留并计入本批结果。'))return;
    const type={resume:'categoryTaskResume',skip:'categoryTaskSkip',remove:'categoryTaskRemove'}[action];
    void perform({type,batchId:state.id,sellerKey,...(action==='resume'?{backgroundExperiment:$('backgroundExperiment').checked}:{})});
  });
  $("start").disabled=busy||active;
  $("backgroundExperiment").disabled=true;
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
  const diagnosticChosen=$("diagnosticHistory").value;$("diagnosticHistory").replaceChildren(new Option('当前批次',''),...history.filter(b=>["completed","stopped","failed"].includes(b.status)).map(b=>new Option(`${new Date(b.updatedAt).toLocaleString('zh-CN')} · ${Number(b.qualifiedCount||b.count||0)} 件`,b.id)));if(history.some(b=>b.id===diagnosticChosen))$("diagnosticHistory").value=diagnosticChosen;
  $("exportDiagnostic").disabled=busy||!batch&&!$("diagnosticHistory").value;
  $("addHistoryPool").disabled=$("exportHistoryBatch").disabled=busy||!$("historyBatch").value;
  $("deleteHistoryBatch").disabled=busy||!history.some(b=>b.id===$("historyBatch").value&&["completed","stopped","failed"].includes(b.status));
  const currentEmpty=finishedBatch&&Number(batch?.qualifiedSkuIds?.length||0)===0&&stores.reduce((n,s)=>n+Number(s.qualifiedCount||0),0)===0;
  $("cleanupEmptyBatches").disabled=busy||(!currentEmpty&&!history.some(b=>["completed","stopped","failed"].includes(b.status)&&Number(b.qualifiedCount||b.count||0)===0));
}
async function refresh() { if(busy)return;if(refreshInFlight){refreshPending=true;return}refreshInFlight=true;const sequence=++refreshSequence,revision=actionRevision;try { const r=await send({type:"categoryGet"});if(!busy&&sequence===refreshSequence&&revision===actionRevision)render(r.batch||r.state||null,r.history); } catch(e) { if(!busy&&sequence===refreshSequence&&revision===actionRevision)$("message").textContent=e.message; } finally {refreshInFlight=false;if(refreshPending){refreshPending=false;if(!busy)void refresh()}} }
$("start").onclick = async () => {
  try{const treeUrls=treeSelection?.urls()||[];const manual=$('urls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const parsed=core.parseUrls([...manual,...treeUrls]);if(!parsed.urls.length||parsed.invalid.length||parsed.overflowCount)throw Error('请提供 1–20 个有效 Ozon 类目链接，修正无效或超限地址。');
    const options=core.validateOptions({targetCount:$("targetCount").value,minPrice:$("minPrice").value,maxPrice:$("maxPrice").value,pageMinRub:$("pageMinRub").value,pageMaxRub:$("pageMaxRub").value});
    const needsArchiveConfirmation=history.length>=5&&!!state;
    if(needsArchiveConfirmation&&!confirm('历史类目批次已达 5 份，新任务可能替换最早批次；请先将需要的历史商品入池或同步。是否继续？'))return;
    await perform({type:"categoryStart",urls:parsed.urls,categoryLabels:categoryLabels(),...options,backgroundExperiment:$("backgroundExperiment").checked,confirmArchiveOverflow:needsArchiveConfirmation});
  }catch(e){$("message").textContent=e.message;}
};
async function perform(message){if(busy)return;actionRevision++;refreshSequence++;busy=true;render(state);try{const r=await send(message);busy=false;render(Object.hasOwn(r,'batch')?r.batch:state,Array.isArray(r.history)?r.history:history);$("message").textContent=r.message||(message.type==='categoryAddPool'?`已加入 ${r.added||0} 件 · 重复 ${r.duplicates||0} · 历史排除 ${r.historySkipped||0}`:r.batch?.message||'操作已完成。');}catch(e){busy=false;render(state);$("message").textContent=e.message;}}
for(const [id,type] of [["pause","categoryPause"],["resume","categoryResume"],["stop","categoryStop"],["addPool","categoryAddPool"],["syncWorkbench","categorySyncWorkbench"]]) if($(id))$(id).onclick=()=>perform({type,batchId:state?.id,...(id==='resume'?{backgroundExperiment:$("backgroundExperiment").checked}:{})});
$("historyBatch").onchange=()=>{$("addHistoryPool").disabled=$("exportHistoryBatch").disabled=$("deleteHistoryBatch").disabled=busy||!$("historyBatch").value};
$("addHistoryPool").onclick=()=>perform({type:'categoryAddPool',batchId:$("historyBatch").value});
$("deleteHistoryBatch").onclick=()=>{const id=$("historyBatch").value;if(!id)return;const item=history.find(x=>x.id===id);if(!confirm(`确认删除所选已结束类目批次（${Number(item?.qualifiedCount||0)} 个候选）？本机商品池、SKU 历史和工作台云端数据不会改动。`))return;void perform({type:'categoryDeleteBatch',batchId:id})};
$("deleteCurrentBatch").onclick=()=>{if(!state||!["completed","stopped","failed"].includes(state.status))return;const count=Number(state.qualifiedSkuIds?.length||state.stores?.reduce((n,s)=>n+Number(s.qualifiedCount||0),0)||0);if(!confirm(`确认删除当前已结束类目批次（${count} 个候选）？本机商品池、SKU 历史和工作台云端数据不会改动。`))return;void perform({type:'categoryDeleteBatch',batchId:state.id})};
$("cleanupEmptyBatches").onclick=()=>{if(!confirm('清理所有已结束且没有候选的类目批次，包括当前已结束的空批次？运行中和暂停中的批次会保留；商品池、SKU 历史和工作台云端数据不会改动。'))return;void perform({type:'categoryCleanupEmpty'})};
async function exportCsv(batchId){try{const r=await send({type:'categoryExport',batchId});const url=URL.createObjectURL(new Blob(['\ufeff'+r.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`Ozon类目选品-${batchId}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){$("message").textContent=e.message}}
async function exportDiagnostic(batchId){try{const r=await send({type:'categoryDiagnostic',batchId});const url=URL.createObjectURL(new Blob([JSON.stringify(r.diagnostic??r,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`Ozon类目运行诊断-${batchId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){$("message").textContent=e.message}}
$("exportDiagnostic").onclick=()=>{const batchId=$('diagnosticHistory').value||state?.id;if(batchId)void exportDiagnostic(batchId)};
$("diagnosticHistory").onchange=()=>{$("exportDiagnostic").disabled=busy||!state&&!$("diagnosticHistory").value};
$("exportBatch").onclick=()=>exportCsv(state?.id);$("exportHistoryBatch").onclick=()=>exportCsv($("historyBatch").value);
$("openScanTab").onclick=async()=>{try{if(!Number.isInteger(state?.tabId))return;const tab=await chrome.tabs.get(state.tabId);if(!tab)throw Error('采集页面已关闭');await chrome.tabs.update(tab.id,{active:true});if(tab.windowId!=null)await chrome.windows.update(tab.windowId,{focused:true});}catch(e){$("message").textContent=e.message}};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.ozonCategoryBatchV1||changes.ozonCategoryBatchHistoryV1))void refresh()});
window.addEventListener('focus',()=>void refresh());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh()});
window.setInterval(()=>{if(['running','scanning'].includes(state?.status)&&document.visibilityState==='visible')void refresh()},2500);
// Modal selection is a draft. Completing applies it; cancel/Escape leaves the
// previous committed source and selection and all manual links untouched.
const dialog=$('catalogDialog'),feedback=$('catalogFeedback');
$('openCatalog').onclick=()=>{if(!catalogData||dialog.open)return;setDraft(confirmedSource,[...(treeSelection?.selected.keys()||[])]);feedback.textContent='';dialog.showModal();renderPicker(1);$('catalogSearch').focus()};
$('catalogCancel').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{draftSelection=null;navPath=[];$('openCatalog').focus()});
$('catalogDone').onclick=()=>{if(!draftSelection)return;const combined=core.parseUrls([...$('urls').value.split(/\r?\n/),...draftSelection.urls()]);if(combined.overflowCount){feedback.textContent='与手动链接合计最多 20 个类目，请减少选择后再完成。';return}treeSelection=draftSelection;confirmedSource=sourceValue();syncCatalogUrls();dialog.close()};
document.querySelectorAll('[name="catalogSource"]').forEach(input=>input.onchange=()=>{const next=input.value;const had=selectedCount(draftSelection)>0;setDraft(next);feedback.textContent=had?'已切换目录，本次原选择已清空；取消可保留此前确认结果。':'已切换目录；手动链接保持不变。';renderPicker(1)});
$('catalogSearch').oninput=searchPicker;$('catalogClear').onclick=()=>{draftSelection?.clear();feedback.textContent='';renderPicker()};
for(const [id,depth] of [['catalogLeaves1',0],['catalogLeaves2',1]])$(id).onclick=()=>{const node=draftSelection?.byId.get(navPath[depth]);if(!node)return;try{draftSelection.addLeaves(node);feedback.textContent='';renderPicker()}catch(e){feedback.textContent=e.message}};
$('saveFavorite').onclick=async()=>{const name=$('favoriteName').value.trim();if(!name){feedback.textContent='请先填写组合名称。';return}if(!selectedCount(draftSelection)){feedback.textContent='请选择至少一个目录类目。';return}const item={id:crypto.randomUUID(),name,source:sourceValue(),ids:[...draftSelection.selected.keys()]};try{favorites=await catalog.readFavorites();favorites=[...favorites.filter(f=>f.name!==name||f.source!==item.source),item].slice(-30);await catalog.writeFavorites(favorites);await refreshFavorites();feedback.textContent=`已保存“${name}”到本机。`}catch(e){feedback.textContent=e.message}};
$('loadFavorite').onclick=()=>{const f=favorites.find(x=>x.id===$('favoriteSelect').value);if(!f||!catalogData)return;try{const missing=setDraft(f.source,f.ids);renderPicker(1);feedback.textContent=`已载入“${f.name}”${missing?`，${missing} 项已不在目录中需复核`:''}。`}catch(e){feedback.textContent=`组合未载入：${e.message}`}};
$('deleteFavorite').onclick=async()=>{const id=$('favoriteSelect').value;if(!id)return;try{await catalog.writeFavorites(favorites.filter(f=>f.id!==id));await refreshFavorites();feedback.textContent='已删除本机组合。'}catch(e){feedback.textContent=e.message}};
void refreshFavorites();void loadCatalog();
void refresh();
