const $ = (id) => document.getElementById(id);
let state = null;
let history = [], savedTasks = [], cloudSync = null, pagePriceCurrency = 'CNY', loadedTaskProfileId = '', loadedTaskProfileName = '', formDirty = false, hydratedBatchId = '', busy = false, refreshSequence = 0, actionRevision = 0, refreshInFlight = false, refreshPending = false;
const core = globalThis.OzonCategoryCore;
const catalog = globalThis.OzonCategoryCatalog;
let catalogData = null, treeSelection = null, confirmedSource = 'china', draftSelection = null, navPath = [];
const labels = { running: '运行中', paused: '已暂停', completed: '已完成', stopped: '已停止', pending: '待开始', loading: '打开页面', scanning: '扫描中', partial: '部分完成', deferred: '待回查', failed: '失败', skipped: '已跳过' };
const waitReasons = { catalog_loading: '商品列表仍在加载', hidden_bottom: '页面在后台，列表底部尚未确认', scroll_stalled: '页面滚动暂时停滞', review_pending: '仍有商品字段待复查', list_ambiguous: '商品列表范围不明确', no_new_sku: '本轮尚未发现新商品' };
const pagePriceStatusLabels = { confirmed: '页面价格筛选已确认', unconfirmed: '页面价格筛选未确认', pending: '页面价格筛选待确认' };
const diagnosticLabels = { erp_pending: 'ERP待补', erp_conflict: 'ERP冲突', data_pending: '资料待补', no_label: '无标签命中', price_outside: '价格范围外', transport_blocked: '运输受限', accepted: '已接受', batch_duplicate: '本批重复', pool_duplicate: '商品池重复', history_duplicate: '历史重复', target_limit: '达到目标上限', invalid_candidate: '候选无效', eligible: '可入选', unknown: '原因未分类' };
const sourceInput = () => document.querySelector('[name="catalogSource"]:checked');
const sourceValue = () => sourceInput()?.value || 'china';
function setSource(source) { const input = document.querySelector(`[name="catalogSource"][value="${source === 'ordinary' ? 'ordinary' : 'china'}"]`); if (input) input.checked = true; $('catalogAdvanced').open = source === 'ordinary'; }
function formatTimestamp(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN'); }
function formatShortTime(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(Error(response?.error || '操作失败'));
    else resolve(response);
  }));
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderTaskCard(task, batch) {
  const status = task.status === 'scanning' && ['paused', 'stopped'].includes(batch?.status) ? (batch.status === 'paused' ? 'paused' : 'stopped') : task.status || 'pending';
  const canManage = ['paused', 'stopped'].includes(batch?.status);
  const runnable = !['completed', 'skipped', 'failed'].includes(task.status || 'pending') && !task.removedFromQueue;
  const targetReached = Number(batch?.options?.targetCount) > 0 && (batch?.stores || []).reduce((n, item) => n + Number(item.qualifiedCount || 0), 0) >= Number(batch.options.targetCount);
  const reason = status === 'skipped' ? task.skipReason : (['deferred', 'partial', 'paused'].includes(status) || batch?.status === 'paused'
    ? waitReasons[task.waitReason] || task.error || task.message || task.note || (task.waitReason ? '等待条件暂未分类' : '')
    : task.error || task.message || task.note);
  const warnings = [];
  const unresolvedCount = Number(task.unresolvedErpCount ?? task.pendingCount ?? 0);
  if (status === 'deferred') warnings.push('先扫待开始类目，再回查此项');
  if (task.revisitingPendingPage) warnings.push('正在回查原页未就绪 ERP');
  if (Number(task.revisitCount) > 0) warnings.push(`自动回查 ${Math.max(0, Number(task.revisitCount))}/1`);
  if (Number(task.crashRecoveryCount) > 0) warnings.push(`已自动防崩溃重建标签页 ${Number(task.crashRecoveryCount)}/3 次`);
  if (unresolvedCount > 0 && !String(reason || '').includes('ERP 未就绪')) warnings.push(`有 ${unresolvedCount} 件 ERP 未就绪`);
  if (reason) warnings.push(reason);

  const pagePriceStatus = pagePriceStatusLabels[task.pagePriceStatus] || '';
  const dc = task.diagnosticCounts && typeof task.diagnosticCounts === 'object' ? task.diagnosticCounts : null;
  const chipsHtml = dc
    ? `<div class="diagnostic-chips">${Object.entries(diagnosticLabels).filter(([k]) => Number(dc[k]) > 0).map(([k, v]) => `<span class="diagnostic-chip">${v} ${Number(dc[k])}</span>`).join('') || '<span>暂无原因计数</span>'}</div>`
    : '';
  const detailMeta = [
    `发现商品 ${task.discoveredCount ?? '—'}`,
    `ERP 就绪 ${task.erpReadyCount ?? '—'}`,
    `标签命中 ${task.labelHitCount ?? '—'}`,
    ...(pagePriceStatus ? [pagePriceStatus] : [])
  ].join(' · ');

  const isScheduled = batch?.status === 'paused' && Number.isInteger(batch.resumeIndex) && (batch.stores || [])[batch.resumeIndex] === task;
  const isStopped = batch?.status === 'stopped';
  const resumeLabel = isStopped ? '按旧条件续跑此项' : (isScheduled ? '下一次继续' : '从此类目继续');
  const resumeBtnClass = isStopped ? 'compact' : 'soft-primary compact';
  const actions = canManage && runnable && !busy
    ? `<div class="store-actions">${!targetReached ? `<button type="button" class="${resumeBtnClass}" data-task-action="resume" data-seller-key="${esc(task.sellerKey || '')}">${resumeLabel}</button>` : ''}<button type="button" class="compact" data-task-action="skip" data-seller-key="${esc(task.sellerKey || '')}">跳过</button><button type="button" class="danger compact" data-task-action="remove" data-seller-key="${esc(task.sellerKey || '')}">删除</button></div>`
    : '';

  return `<article class="store${status === 'scanning' ? ' active' : ''}">
    <div class="store-top"><strong>${esc(task.name || task.label || task.url || '类目')}</strong><span class="status-badge${status === 'scanning' ? ' running' : ''}">${esc(labels[status] || status || '等待')}</span></div>
    <div class="store-summary-row">
      <span>已检查 ${Number(task.observedCount || 0)} · 新候选 ${Number(task.qualifiedCount || 0)} · ${status === 'skipped' ? '历史待复查' : '待复查'} ${Number(task.pendingCount || 0)}</span>
      <details class="store-detail-toggle" data-category-key="${esc(task.sellerKey || task.url || '')}">
        <summary>详情与诊断 ▾</summary>
        <div class="store-detail-panel">
          <div class="store-url">${esc(task.pageUrl || task.url || '')}</div>
          <div>${esc(detailMeta)}</div>
          ${chipsHtml}
        </div>
      </details>
    </div>
    ${warnings.length ? `<p class="store-reason">${esc(warnings.join(' · '))}</p>` : ''}
    ${actions}
  </article>`;
}

const sourceName = source => source === 'china' ? '中国专区' : '普通 Ozon 类目';
function pathFor(node, selection) { const path = []; for (let n = node; n; n = selection.byId.get(n.parentId)) path.unshift(n); return path; }
function displayPath(node, selection) { return pathFor(node, selection).map(catalog.names).join(' / '); }
function newSelection(source, ids = []) { const selection = catalog.makeSelection(catalogData[source] || []); let missing = 0; for (const id of ids) { const node = selection.byId.get(id); if (node) selection.add(node); else missing++; } return { selection, missing }; }
function setDraft(source, ids = []) { const result = newSelection(source, ids); draftSelection = result.selection; setSource(source); navPath = []; $('catalogSearch').value = ''; const first = [...draftSelection.selected.values()][0]; if (first) navPath = pathFor(first, draftSelection).map(n => n.id); return result.missing; }
function selectedCount(selection = treeSelection) { return selection?.selected.size || 0; }
function renderSelected(container, selection, remove) {
  const items = [...(selection?.selected.values() || [])];
  container.innerHTML = items.length
    ? items.map(n => `<span class="catalog-chip"><span title="${esc(displayPath(n, selection))}">${esc(displayPath(n, selection))}</span><button type="button" data-remove="${esc(n.id)}" aria-label="移除 ${esc(displayPath(n, selection))}">×</button></span>`).join('')
    : '<span class="catalog-muted">尚未选择类目</span>';
  container.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => remove(selection.byId.get(btn.dataset.remove)));
}
function syncCatalogUrls() {
  $('catalogCount').textContent = `已选 ${selectedCount()} / ${catalog.MAX}`;
  $('catalogSourceLabel').textContent = sourceName(confirmedSource);
  renderSelected($('catalogSelected'), treeSelection, node => { treeSelection.remove(node); syncCatalogUrls(); });
}
function setCustomUrlsOpen(open) {
  const drawer = $('customUrlsDrawer'), toggle = $('toggleCustomUrls');
  if (!drawer || !toggle) return;
  drawer.hidden = !open;
  toggle.textContent = open ? '− 收起自定义链接' : '+ 粘贴自定义链接';
}
function normalizeSearch(s) { return String(s || '').trim().toLocaleLowerCase().replace(/\s*(?:[>›/→]+)\s*/g, '/'); }
function categoryNumber(n) { try { const u = new URL(n.url); return u.searchParams.get('category') || u.pathname.match(/-(\d+)\/?$/)?.[1] || ''; } catch { return ''; } }
function nodeMatch(n, query) { const path = pathFor(n, draftSelection); return [catalog.names(n), n.nameRu, categoryNumber(n), n.id, path.map(catalog.names).join('/'), path.map(p => p.nameRu).join('/'), path.map(categoryNumber).join('/')].some(value => normalizeSearch(value).includes(query)); }
function renderPicker(resetFrom = 4) {
  if (!draftSelection) return;
  const query = normalizeSearch($('catalogSearch').value);
  const visible = new Set();
  function visit(n) { const child = n.children.map(visit).some(Boolean), match = !query || nodeMatch(n, query) || child; if (match) visible.add(n.id); return match; }
  draftSelection.roots.forEach(visit);
  const roots = draftSelection.roots.filter(n => visible.has(n.id));
  const root = roots.find(n => n.id === navPath[0]);
  const second = (root?.children || []).find(n => n.id === navPath[1] && visible.has(n.id));
  if (!root) navPath = []; else if (!second) navPath = [root.id];
  const lists = [roots, (root?.children || []).filter(n => visible.has(n.id)), (second?.children || []).filter(n => visible.has(n.id))];
  $('catalogTitle2').textContent = root ? catalog.names(root) : '二级类目';
  $('catalogTitle3').textContent = second ? catalog.names(second) : '三级类目';
  $('catalogLeaves1').hidden = !root?.children.length;
  $('catalogLeaves2').hidden = !second?.children.length;
  const focused = document.activeElement, focusId = focused?.dataset?.check || focused?.dataset?.nav, focusKey = focused?.dataset?.check ? 'check' : 'nav';
  lists.forEach((nodes, i) => {
    const level = i + 1, box = $('catalogLevel' + level), scroll = level < resetFrom ? box.scrollTop : 0;
    box.innerHTML = nodes.length
      ? nodes.map(n => {
        const checked = draftSelection.selected.has(n.id), active = navPath[i] === n.id;
        return `<div class="catalog-row${active ? ' active' : ''}${checked ? ' checked' : ''}"><input type="checkbox" data-check="${esc(n.id)}" aria-label="${esc(catalog.names(n))}" ${checked ? 'checked' : ''}><button type="button" class="catalog-node" data-nav="${esc(n.id)}" aria-pressed="${active}" title="${esc(displayPath(n, draftSelection))} · ${esc(n.nameRu)}"><span>${esc(catalog.names(n))}</span>${n.children.length ? '<span class="catalog-chevron" aria-hidden="true">›</span>' : ''}</button></div>`;
      }).join('')
      : `<div class="catalog-empty">${level === 1 ? '没有匹配的类目' : level === 2 && !root ? '点击左侧一级类目名称' : level === 3 && !second ? '点击左侧二级类目名称' : '没有下级类目'}</div>`;
    box.scrollTop = scroll;
    box.querySelectorAll('[data-nav]').forEach(btn => btn.onclick = () => { const node = draftSelection.byId.get(btn.dataset.nav); navPath = pathFor(node, draftSelection).map(n => n.id); renderPicker(level + 1); });
    box.querySelectorAll('[data-check]').forEach(input => input.onchange = () => { try { draftSelection.toggle(draftSelection.byId.get(input.dataset.check), input.checked); $('catalogFeedback').textContent = ''; renderPicker(); } catch (e) { input.checked = false; $('catalogFeedback').textContent = e.message; } });
    if (focusId) { const target = [...box.querySelectorAll(`[data-${focusKey}]`)].find(el => el.dataset[focusKey] === focusId); target?.focus({ preventScroll: true }); }
  });
  $('catalogDraftCount').textContent = `已选 ${selectedCount(draftSelection)} / ${catalog.MAX}`;
  renderSelected($('catalogDraftSelected'), draftSelection, node => { draftSelection.remove(node); $('catalogFeedback').textContent = ''; renderPicker(); });
}
function searchPicker() {
  const query = normalizeSearch($('catalogSearch').value);
  if (query) {
    const nodes = [...draftSelection.byId.values()];
    const first = nodes.find(n => normalizeSearch(categoryNumber(n)) === query) || nodes.find(n => nodeMatch(n, query));
    navPath = first ? pathFor(first, draftSelection).map(n => n.id) : [];
  }
  renderPicker(1);
}
async function loadCatalog() {
  try {
    const response = await fetch('category-catalog.json');
    if (!response.ok) throw Error('类目目录无法读取');
    catalogData = await response.json();
    $('catalogProvenance').textContent = catalogData.provenance?.note || '本机类目快照';
    treeSelection = newSelection(confirmedSource).selection;
    syncCatalogUrls();
    $('openCatalog').disabled = false;
    $('catalogLoadState').textContent = '';
  } catch (e) {
    $('catalogLoadState').textContent = '类目目录无法读取，请重载扩展后重试。';
    $('message').textContent = e.message;
  }
}
function categoryLabels() {
  const map = {};
  for (const n of treeSelection?.selected.values() || []) map[core.normalizeUrl(n.url)] = catalog.names(n).slice(0, 120);
  return map;
}

function setPagePriceCurrency(currency, { markDirty = false } = {}) {
  pagePriceCurrency = currency === 'RUB' ? 'RUB' : 'CNY';
  const isRub = pagePriceCurrency === 'RUB';
  const rubBtn = $('pageCurrencyRub'), cnyBtn = $('pageCurrencyCny');
  if (cnyBtn) { cnyBtn.classList.toggle('active', !isRub); cnyBtn.setAttribute('aria-pressed', String(!isRub)); }
  if (rubBtn) { rubBtn.classList.toggle('active', isRub); rubBtn.setAttribute('aria-pressed', String(isRub)); }
  const sym = isRub ? '₽' : '¥';
  if ($('pageMinPrefix')) $('pageMinPrefix').textContent = sym;
  if ($('pageMaxPrefix')) $('pageMaxPrefix').textContent = sym;
  if (!isRub) closeFxEditor();
  if (markDirty) formDirty = true;
  renderRubCnyHint();
  updateContinueHint();
}

function unifiedPriceSpec(opt = {}) {
  if (opt.minPriceRub != null || opt.maxPriceRub != null || opt.pageMinRub != null || opt.pageMaxRub != null) {
    const min = opt.minPriceRub ?? opt.pageMinRub ?? null;
    const max = opt.maxPriceRub ?? opt.pageMaxRub ?? null;
    return { currency: 'RUB', min, max, pagePrefilter: opt.pageMinRub != null && opt.pageMaxRub != null };
  }
  if (opt.minPrice != null || opt.maxPrice != null || opt.pageMinCny != null || opt.pageMaxCny != null) {
    const min = opt.minPrice ?? opt.pageMinCny ?? null;
    const max = opt.maxPrice ?? opt.pageMaxCny ?? null;
    return { currency: 'CNY', min, max, pagePrefilter: opt.pageMinCny != null && opt.pageMaxCny != null };
  }
  return null;
}

function formatUnifiedPriceText(opt = {}) {
  const spec = unifiedPriceSpec(opt);
  if (!spec) return '';
  if (spec.currency === 'RUB') return `${spec.min ?? '不限'}–${spec.max ?? '不限'} ₽`;
  return `¥${spec.min ?? '不限'}–¥${spec.max ?? '不限'}`;
}

function readFilterOptions() {
  const minVal = parseOptionalNum($('priceMin')), maxVal = parseOptionalNum($('priceMax'));
  if (Number.isNaN(minVal) || Number.isNaN(maxVal)) throw Error('请输入有效的价格金额');
  if (minVal !== null && maxVal !== null && minVal > maxVal) throw Error('最低价不能高于最高价');
  const both = minVal !== null && maxVal !== null;
  const isRub = pagePriceCurrency === 'RUB';
  const opt = core.validateOptions({
    targetCount: $('targetCount').value,
    perCategoryLimit: $('perCategoryLimit')?.value,
    minPrice: isRub ? null : minVal,
    maxPrice: isRub ? null : maxVal,
    minPriceRub: isRub ? minVal : null,
    maxPriceRub: isRub ? maxVal : null,
    pageMinRub: isRub && both ? Math.floor(minVal) : null,
    pageMaxRub: isRub && both ? Math.ceil(maxVal) : null,
    pageMinCny: !isRub && both ? Math.floor(minVal) : null,
    pageMaxCny: !isRub && both ? Math.ceil(maxVal) : null,
    fxRate: activeFxRate()
  });
  return {
    targetCount: opt.targetCount,
    perCategoryLimit: opt.perCategoryLimit ?? null,
    minPrice: opt.minPrice ?? null,
    maxPrice: opt.maxPrice ?? null,
    minPriceRub: opt.minPriceRub ?? null,
    maxPriceRub: opt.maxPriceRub ?? null,
    pageMinRub: opt.pageMinRub ?? null,
    pageMaxRub: opt.pageMaxRub ?? null,
    pageMinCny: opt.pageMinCny ?? null,
    pageMaxCny: opt.pageMaxCny ?? null,
    fxRate: opt.fxRate ?? activeFxRate()
  };
}

function readSetupForm() {
  const treeUrls = treeSelection?.urls() || [];
  const manual = $('urls').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const parsed = core.parseUrls([...manual, ...treeUrls]);
  if (!parsed.urls.length || parsed.invalid.length || parsed.overflowCount) throw Error('请提供 1–20 个有效 Ozon 类目链接，修正无效或超限地址。');
  return { urls: parsed.urls, categoryLabels: categoryLabels(), options: readFilterOptions() };
}

function applyOptionPriceFields(opt = {}) {
  const spec = unifiedPriceSpec(opt);
  if (!spec) {
    if ($('priceMin')) $('priceMin').value = '';
    if ($('priceMax')) $('priceMax').value = '';
    setPagePriceCurrency('CNY');
    return;
  }
  if ($('priceMin')) $('priceMin').value = spec.min ?? '';
  if ($('priceMax')) $('priceMax').value = spec.max ?? '';
  setPagePriceCurrency(spec.currency);
}

function syncFormFromBatch(batch) {
  if (formDirty || !batch?.id || batch.id === hydratedBatchId) return;
  const opt = batch.options || {};
  if ($('targetCount') && opt.targetCount != null) $('targetCount').value = opt.targetCount;
  if ($('perCategoryLimit')) $('perCategoryLimit').value = opt.perCategoryLimit ?? '';
  applyOptionPriceFields(opt);
  hydratedBatchId = batch.id;
}

function formatFormFilterBrief() {
  const target = String($('targetCount')?.value || '20').trim() || '20';
  const perCat = String($('perCategoryLimit')?.value || '').trim();
  const minRaw = String($('priceMin')?.value || '').trim();
  const maxRaw = String($('priceMax')?.value || '').trim();
  const parts = [`目标 ${target} 件`];
  if (perCat) parts.push(`单类目上限 ${perCat} 件`);
  if (minRaw || maxRaw) {
    const sym = pagePriceCurrency === 'RUB' ? '₽' : '¥';
    const mode = minRaw && maxRaw ? '网页预筛+复核' : '仅复核';
    parts.push(`${sym}${minRaw || '不限'}–${maxRaw || '不限'} (${mode})`);
  } else {
    parts.push('不限价格');
  }
  return parts.join(' · ');
}

function updateContinueHint(batch = state) {
  const continueHint = $('continueHint');
  if (!continueHint || !batch) return;
  const { remainingCount, resumableCount } = continuationCounts(batch);
  const brief = formatFormFilterBrief();
  continueHint.textContent = remainingCount > 0
    ? `按上方当前条件续扫（${brief}）：还有 ${remainingCount} 个未完成类目，也可对全部 ${resumableCount} 个未耗尽类目续扫`
    : `按上方当前条件续扫（${brief}）：还有 ${resumableCount} 个未耗尽类目可续扫，自动跳过本轮已采 SKU`;
}

function confirmArchiveIfNeeded() {
  const needed = history.length >= 5 && !!state;
  if (needed && !confirm('历史类目批次已达 5 份，新任务可能替换最早批次；请先将需要的历史商品入池或同步。是否继续？')) return null;
  return needed;
}

function continuationCounts(batch) {
  const stores = Array.isArray(batch?.stores) ? batch.stores : [];
  const isExcluded = t => !t?.url || t.removedFromQueue === true || t.exhausted === true || (t.status === 'skipped' && t.skipReason === '手动跳过');
  const remainingCount = stores.filter(t => !isExcluded(t) && t.status !== 'completed').length;
  const resumableCount = stores.filter(t => !isExcluded(t)).length;
  return { remainingCount, resumableCount };
}

function formatTaskOptionsSummary(options = {}) {
  const parts = [`目标 ${options.targetCount || '—'} 件`];
  if (options.perCategoryLimit) parts.push(`单类目上限 ${options.perCategoryLimit} 件`);
  const priceText = formatUnifiedPriceText(options);
  if (priceText) parts.push(priceText);
  return parts.join(' · ');
}

function loadTaskProfileIntoForm(profile) {
  if (!profile) return;
  const urls = Array.isArray(profile.urls) ? profile.urls : [];
  const manualUrls = [];
  if (catalogData) {
    const chinaSel = catalog.makeSelection(catalogData.china || []);
    const ordSel = catalog.makeSelection(catalogData.ordinary || []);
    const chinaByUrl = new Map([...chinaSel.byId.values()].map(n => [core.normalizeUrl(n.url), n]));
    const ordByUrl = new Map([...ordSel.byId.values()].map(n => [core.normalizeUrl(n.url), n]));
    const chinaHits = urls.filter(u => chinaByUrl.has(core.normalizeUrl(u)));
    const ordHits = urls.filter(u => ordByUrl.has(core.normalizeUrl(u)));
    const pickOrdinary = !chinaHits.length && ordHits.length > 0;
    const chosenSource = pickOrdinary ? 'ordinary' : 'china';
    const chosenMap = pickOrdinary ? ordByUrl : chinaByUrl;
    const chosenSel = pickOrdinary ? ordSel : chinaSel;
    for (const u of urls) {
      const node = chosenMap.get(core.normalizeUrl(u));
      if (node) { try { chosenSel.add(node); } catch { manualUrls.push(u); } }
      else manualUrls.push(u);
    }
    confirmedSource = chosenSource;
    treeSelection = chosenSel;
    syncCatalogUrls();
  } else {
    manualUrls.push(...urls);
  }
  $('urls').value = manualUrls.join('\n');
  setCustomUrlsOpen(manualUrls.length > 0);
  const opt = profile.options || {};
  if ($('targetCount')) $('targetCount').value = opt.targetCount ?? 20;
  if ($('perCategoryLimit')) $('perCategoryLimit').value = opt.perCategoryLimit ?? '';
  applyOptionPriceFields(opt);
  if ($('taskProfileName')) $('taskProfileName').value = profile.name || '';
  loadedTaskProfileId = profile.id || '';
  loadedTaskProfileName = profile.name || '';
  formDirty = true;
  $('message').textContent = `已载入常用任务「${profile.name}」（共 ${urls.length} 个类目），可直接修改或开始扫描。`;
}

function renderSavedTasks(tasks, active) {
  const cardEl = $('savedTasksCard'), listEl = $('savedTaskList'), countEl = $('savedTaskCount');
  if (!listEl || !countEl) return;
  const rows = Array.isArray(tasks) ? tasks : [];
  countEl.textContent = `${rows.length} 个`;
  if (cardEl) cardEl.hidden = rows.length === 0;
  if (!rows.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = rows.map(task => {
    const stats = task.stats || {};
    const total = stats.totalCategories ?? (task.urls?.length || 0);
    const remaining = stats.remainingCategories ?? total;
    const badgeText = remaining > 0 ? `${remaining}/${total} 类目可续扫` : '已全部扫到底';
    const hasProgress = (task.runCount || 0) > 0 || (stats.observedTotal || 0) > 0 || (stats.priorQualifiedCount || 0) > 0;
    return `<article class="saved-task-item">
      <div class="saved-task-info">
        <div class="saved-task-head"><strong>${esc(task.name || '未命名任务')}</strong><span class="status-badge${remaining > 0 ? '' : ' running'}">${esc(badgeText)}</span></div>
        <div class="saved-task-meta">${esc(formatTaskOptionsSummary(task.options))} · 已跑 ${Number(task.runCount || 0)} 轮 · 累计 ${Number(task.totalQualifiedCount || 0)} 件 · 避重 ${Number(stats.priorQualifiedCount || 0)}</div>
      </div>
      <div class="saved-task-actions">
        <button type="button" class="primary compact" data-profile-action="run" data-profile-id="${esc(task.id)}" ${busy || active || remaining === 0 ? 'disabled' : ''}>继续扫</button>
        <button type="button" class="soft-primary compact" data-profile-action="load" data-profile-id="${esc(task.id)}" ${busy ? 'disabled' : ''}>载入</button>
        <button type="button" class="compact" data-profile-action="reset" data-profile-id="${esc(task.id)}" ${busy || !hasProgress ? 'disabled' : ''}>重置</button>
        <button type="button" class="danger compact" data-profile-action="delete" data-profile-id="${esc(task.id)}" ${busy ? 'disabled' : ''}>删除</button>
      </div>
    </article>`;
  }).join('');
  listEl.querySelectorAll('[data-profile-action]').forEach(btn => btn.onclick = () => {
    const action = btn.dataset.profileAction, id = btn.dataset.profileId;
    const target = savedTasks.find(t => t.id === id);
    if (!target) return;
    if (action === 'load') { loadTaskProfileIntoForm(target); return; }
    if (action === 'delete') {
      if (!confirm(`确认删除常用类目任务「${target.name}」及其中保存的断点进度？已入池商品不受影响。`)) return;
      if (loadedTaskProfileId === id) { loadedTaskProfileId = ''; loadedTaskProfileName = ''; }
      void perform({ type: 'categoryTaskProfileDelete', taskId: id });
      return;
    }
    if (action === 'reset') {
      if (!confirm(`确认重置「${target.name}」的页码断点与已避重 SKU 记录？下次将从第 1 页重新扫描。`)) return;
      void perform({ type: 'categoryTaskProfileReset', taskId: id });
      return;
    }
    if (action === 'run') {
      const confirmArchive = confirmArchiveIfNeeded();
      if (confirmArchive === null) return;
      void perform({ type: 'categoryTaskProfileRun', taskId: id, mode: 'resume_all', confirmArchiveOverflow: confirmArchive });
    }
  });
}

function renderCloudSyncBar(cs = cloudSync) {
  const bar = $('cloudSyncBar'), statusEl = $('cloudSyncStatus'), iconEl = $('syncCloudNow');
  if (!bar || !statusEl) return;
  if (!cs) { bar.hidden = true; return; }
  bar.hidden = false;
  if (!cs.connected) {
    bar.disabled = true;
    statusEl.textContent = '本机去重（未连工作台）';
    bar.title = '在扩展弹窗连接工作台即可跨电脑云端去重并同步常用任务';
    if (iconEl) iconEl.hidden = true;
    return;
  }
  bar.disabled = busy;
  if (iconEl) iconEl.hidden = false;
  statusEl.textContent = `云端去重 ${Number(cs.poolCount || 0)}+${Number(cs.historyCount || 0)} · 同步`;
  const skuTime = formatTimestamp(cs.skusSyncedAt), taskTime = formatTimestamp(cs.tasksSyncedAt);
  const tips = [
    `已打通工作台云端去重（商品池 ${Number(cs.poolCount || 0)} · 历史 ${Number(cs.historyCount || 0)}${cs.truncated ? ' · 上限截断' : ''}）`,
    ...(skuTime ? [`去重同步：${skuTime}`] : []),
    ...(taskTime ? [`任务同步：${taskTime}`] : []),
    ...(cs.error ? [`同步异常：${cs.error}`] : []),
    '点击立即同步云端去重与常用任务'
  ];
  bar.title = tips.join('\n');
}

function render(batch, archive = history, tasks = savedTasks, nextCloudSync = cloudSync) {
  const expandedDiagnostics = batch?.id === state?.id
    ? new Set([...$('batch').querySelectorAll('.store-detail-toggle[open]')].map(item => item.dataset.categoryKey))
    : new Set();
  state = batch || null;
  history = Array.isArray(archive) ? archive : [];
  savedTasks = Array.isArray(tasks) ? tasks : savedTasks;
  cloudSync = nextCloudSync !== undefined ? nextCloudSync : cloudSync;
  renderCloudSyncBar(cloudSync);
  syncFormFromBatch(batch);

  const stores = Array.isArray(batch?.stores) ? batch.stores : [];
  const selected = stores.reduce((a, s) => a + Number(s.qualifiedCount || 0), 0);
  const checked = stores.reduce((a, s) => a + Number(s.observedCount || 0), 0);
  const eligible = stores.filter(s => !s.removedFromQueue && s.status !== 'skipped').reduce((a, s) => a + Number(s.unresolvedErpCount ?? s.pendingCount ?? 0), 0);
  const active = ['running', 'paused', 'scanning'].includes(batch?.status);
  const finishedBatch = ['completed', 'stopped', 'failed'].includes(batch?.status);
  let noNewSkuMinutes = 0;
  if (batch?.status === 'running') {
    const lastResp = Math.max(Date.parse(batch.lastSampleAt) || 0, Date.parse(batch.lastProgressAt) || 0);
    const ref = Math.max(Date.parse(batch.lastNewSkuAt) || 0, Date.parse(batch.lastDiscoveryAt) || 0, Date.parse(batch.startedAt) || 0);
    if (lastResp && (Date.now() - lastResp) <= 90000 && ref > 0 && (Date.now() - ref) >= 120000) {
      noNewSkuMinutes = Math.floor((Date.now() - ref) / 60000);
    }
  }

  const diagTotals = {};
  for (const store of stores) for (const [key, value] of Object.entries(store.diagnosticCounts || {})) diagTotals[key] = (diagTotals[key] || 0) + (Number(value) || 0);
  const diagnosticLines = [];
  if (Object.keys(diagTotals).length) diagnosticLines.push(`诊断按类目 SKU 汇总（同一 SKU 跨类目会重复计数）：${Object.entries(diagnosticLabels).filter(([k]) => diagTotals[k] > 0).map(([k, v]) => `${v} ${diagTotals[k]}`).join(' · ')}`);
  else if (batch) diagnosticLines.push('原因诊断暂无数据（旧批次可能不含诊断计数）');
  if (batch) {
    const browser = batch.diagnosticBrowser;
    if (browser) {
      const actual = ({ complete: '已加载', loading: '加载中', unloaded: '已卸载' })[browser.tabStatus] || '未知';
      const focus = browser.windowFocused === true ? '窗口已聚焦' : browser.windowFocused === false ? '窗口未聚焦' : '窗口状态未知';
      const page = browser.pageReportedHidden === true ? '页面自报后台' : browser.pageReportedHidden === false ? '页面自报前台' : '页面可见性未知';
      const pageFocus = browser.pageFocused === true ? '页面自报有焦点' : browser.pageFocused === false ? '页面自报无焦点' : '页面焦点未知';
      const activeTab = browser.tabActive === true ? '活动标签' : browser.tabActive === false ? '非活动标签' : '标签活动状态未知';
      diagnosticLines.push(`浏览器状态：${actual}${browser.frozen ? ' · 冻结' : ''}${browser.discarded ? ' · 已丢弃' : ''} · ${activeTab} · ${focus}${formatTimestamp(browser.checkedAt) ? ` · 检查于 ${formatTimestamp(browser.checkedAt)}` : ''}`);
      diagnosticLines.push(`${page} · ${pageFocus}${formatTimestamp(browser.pageReportedAt) ? ` · 上报于 ${formatTimestamp(browser.pageReportedAt)}` : ''}`);
    }
    const times = [];
    for (const [key, label] of [['lastDiscoveryAt', '最近发现'], ['lastErpReadyAt', '最近 ERP 就绪'], ['lastLabelHitAt', '最近标签命中'], ['lastAcceptedAt', '最近新增候选']]) {
      const at = formatTimestamp(batch[key]);
      if (at) times.push(`${label} ${at}`);
    }
    if (times.length) diagnosticLines.push(times.join(' · '));
    if (batch.recentWaitReason) diagnosticLines.push(`最近等待：${waitReasons[batch.recentWaitReason] || '查看诊断记录'}`);
    if (noNewSkuMinutes >= 2) diagnosticLines.push(`新增提示：采集页仍有响应，已 ${noNewSkuMinutes} 分钟未发现新商品`);
  }
  if ($('diagBox')) $('diagBox').hidden = !batch;
  if ($('diagnosticOverview')) $('diagnosticOverview').textContent = diagnosticLines.join('\n');

  const statusBadge = $('batchStatusBadge');
  if (statusBadge) {
    statusBadge.hidden = !batch;
    if (batch) {
      statusBadge.textContent = labels[batch.status] || batch.status || '';
      statusBadge.className = 'status-badge' + (['running', 'scanning'].includes(batch.status) ? ' running' : '');
    }
  }
  const kpiGrid = $('kpiGrid');
  if (kpiGrid) {
    kpiGrid.hidden = !batch;
    if (batch) {
      $('kpiCandidates').textContent = `${selected} / ${batch.options?.targetCount || '—'}`;
      $('kpiObserved').textContent = String(checked);
      $('kpiReview').textContent = String(eligible);
      $('kpiRub').textContent = formatUnifiedPriceText(batch.options) || '未设置';
    }
  }
  const updatedTime = formatShortTime(batch?.lastProgressAt || batch?.updatedAt);
  $('summary').textContent = batch ? (updatedTime ? `最近更新 ${updatedTime}` : '') : '暂无批次';
  $('message').textContent = noNewSkuMinutes >= 2
    ? `采集页仍有响应，已 ${noNewSkuMinutes} 分钟未发现新商品${batch?.pageMode === 'background' ? '（后台可能被限流，建议切回前台）' : ''}`
    : (batch?.message || '');

  const visibleStores = stores.filter(task => !task.removedFromQueue);
  const removedCount = stores.filter(task => task.removedFromQueue).length;
  $('batch').innerHTML = stores.length
    ? `${removedCount ? `<p class="removed-summary">已移出 ${removedCount} 项；移出只调整本批队列，已采集商品仍计入本批结果。</p>` : ''}${visibleStores.length ? `<div class="store-list">${visibleStores.map(task => renderTaskCard(task, batch)).join('')}</div>` : '<div class="empty">本批类目均已移出队列。</div>'}`
    : `<div class="empty">${batch ? '批次已建立，等待类目进度…' : '创建任务后，这里会显示每个类目的进度和结果。'}</div>`;
  $('batch').querySelectorAll('.store-detail-toggle').forEach(item => { item.open = expandedDiagnostics.has(item.dataset.categoryKey); });

  renderSavedTasks(savedTasks, active);

  const continueBar = $('continueBar'), continueRemaining = $('continueRemaining'), continueNextRound = $('continueNextRound');
  if (continueBar && continueRemaining && continueNextRound) {
    const { remainingCount, resumableCount } = finishedBatch ? continuationCounts(batch) : { remainingCount: 0, resumableCount: 0 };
    continueBar.hidden = !(finishedBatch && (remainingCount > 0 || resumableCount > 0));
    continueRemaining.hidden = remainingCount === 0;
    continueRemaining.disabled = busy || active || remainingCount === 0;
    continueRemaining.textContent = `仅扫剩余类目 (${remainingCount})`;
    continueNextRound.hidden = resumableCount === 0;
    continueNextRound.disabled = busy || active || resumableCount === 0;
    continueNextRound.textContent = `继续扫下一轮 (${resumableCount})`;
    updateContinueHint(batch);
  }

  $('batch').querySelectorAll('[data-task-action]').forEach(button => button.onclick = () => {
    const action = button.dataset.taskAction, sellerKey = button.dataset.sellerKey;
    if (!sellerKey || !state || !['paused', 'stopped'].includes(state.status)) return;
    if (action === 'remove' && !confirm('确认从本批队列删除此类目？已采集商品仍保留并计入本批结果。')) return;
    const type = { resume: 'categoryTaskResume', skip: 'categoryTaskSkip', remove: 'categoryTaskRemove' }[action];
    void perform({ type, batchId: state.id, sellerKey });
  });

  $('start').disabled = busy || active;
  const isRunning = batch?.status === 'running' || batch?.status === 'scanning';
  const isPaused = batch?.status === 'paused';
  $('pause').hidden = !isRunning;
  $('pause').disabled = busy || !isRunning;
  $('resume').hidden = !isPaused;
  $('resume').disabled = busy || !isPaused;
  $('stop').hidden = !active;
  $('stop').disabled = busy || !active;
  const hasTab = active && Number.isInteger(batch?.tabId);
  $('openScanTab').hidden = !hasTab;
  $('openScanTab').disabled = !hasTab;

  if ($('batchActions')) $('batchActions').hidden = !batch;
  $('addPool').disabled = busy || !batch || !selected;
  if ($('syncWorkbench')) $('syncWorkbench').disabled = busy || !batch || !stores.length;
  $('exportBatch').disabled = busy || !batch;
  $('deleteCurrentBatch').disabled = busy || !finishedBatch;

  if ($('historyToolsBox')) $('historyToolsBox').hidden = !batch && history.length === 0;
  if ($('historyToolsTitle')) $('historyToolsTitle').textContent = history.length ? `历史批次与诊断工具（含 ${history.length} 份历史）` : '历史批次与诊断工具';

  const chosen = $('historyBatch').value;
  $('historyBatch').replaceChildren(new Option('选择已结束批次', ''), ...history.map(b => {
    const ended = ['completed', 'stopped', 'failed'].includes(b.status);
    const option = new Option(`${new Date(b.updatedAt).toLocaleString('zh-CN')} · ${Number(b.qualifiedCount || b.count || 0)} 件 · ${labels[b.status] || b.status}`, b.id);
    option.disabled = !ended;
    return option;
  }));
  if (history.some(b => b.id === chosen)) $('historyBatch').value = chosen;

  const diagnosticChosen = $('diagnosticHistory').value;
  $('diagnosticHistory').replaceChildren(new Option('当前批次', ''), ...history.filter(b => ['completed', 'stopped', 'failed'].includes(b.status)).map(b => new Option(`${new Date(b.updatedAt).toLocaleString('zh-CN')} · ${Number(b.qualifiedCount || b.count || 0)} 件`, b.id)));
  if (history.some(b => b.id === diagnosticChosen)) $('diagnosticHistory').value = diagnosticChosen;

  $('exportDiagnostic').disabled = busy || (!batch && !$('diagnosticHistory').value);
  $('addHistoryPool').disabled = $('exportHistoryBatch').disabled = busy || !$('historyBatch').value;
  $('deleteHistoryBatch').disabled = busy || !history.some(b => b.id === $('historyBatch').value && ['completed', 'stopped', 'failed'].includes(b.status));
  const currentEmpty = finishedBatch && Number(batch?.qualifiedSkuIds?.length || 0) === 0 && stores.reduce((n, s) => n + Number(s.qualifiedCount || 0), 0) === 0;
  $('cleanupEmptyBatches').disabled = busy || (!currentEmpty && !history.some(b => ['completed', 'stopped', 'failed'].includes(b.status) && Number(b.qualifiedCount || b.count || 0) === 0));
}

async function refresh() {
  if (busy) return;
  if (refreshInFlight) { refreshPending = true; return; }
  refreshInFlight = true;
  const sequence = ++refreshSequence, revision = actionRevision;
  try {
    const r = await send({ type: 'categoryGet' });
    if (!busy && sequence === refreshSequence && revision === actionRevision) {
      render(r.batch || r.state || null, r.history, r.tasks, Object.hasOwn(r, 'cloudSync') ? r.cloudSync : cloudSync);
    }
  } catch (e) {
    if (!busy && sequence === refreshSequence && revision === actionRevision) $('message').textContent = e.message;
  } finally {
    refreshInFlight = false;
    if (refreshPending) { refreshPending = false; if (!busy) void refresh(); }
  }
}

$('start').onclick = async () => {
  try {
    const { urls, categoryLabels: labelsMap, options } = readSetupForm();
    const confirmArchive = confirmArchiveIfNeeded();
    if (confirmArchive === null) return;
    const taskName = $('taskProfileName')?.value.trim() || '';
    const matchedProfile = loadedTaskProfileId && taskName === loadedTaskProfileName ? loadedTaskProfileId : '';
    await perform({ type: 'categoryStart', urls, categoryLabels: labelsMap, ...options, taskProfileId: matchedProfile, taskProfileName: matchedProfile ? loadedTaskProfileName : '', confirmArchiveOverflow: confirmArchive });
  } catch (e) {
    $('message').textContent = e.message;
  }
};

function closeInlineSaveBox() {
  if ($('inlineSaveBox')) $('inlineSaveBox').hidden = true;
  if ($('openSaveTask')) $('openSaveTask').hidden = false;
}
if ($('openSaveTask')) $('openSaveTask').onclick = () => {
  $('openSaveTask').hidden = true;
  if ($('inlineSaveBox')) $('inlineSaveBox').hidden = false;
  if ($('taskProfileName')) {
    if (!$('taskProfileName').value.trim() && loadedTaskProfileName) $('taskProfileName').value = loadedTaskProfileName;
    $('taskProfileName').focus();
    $('taskProfileName').select();
  }
};
if ($('cancelSaveTask')) $('cancelSaveTask').onclick = () => closeInlineSaveBox();
if ($('taskProfileName')) $('taskProfileName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('saveTaskProfile')?.click(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeInlineSaveBox(); }
});
if ($('saveTaskProfile')) $('saveTaskProfile').onclick = async () => {
  try {
    const name = $('taskProfileName')?.value.trim() || '';
    if (!name) throw Error('请先输入常用任务名称再保存');
    const { urls, categoryLabels: labelsMap, options } = readSetupForm();
    const taskId = loadedTaskProfileId && name === loadedTaskProfileName ? loadedTaskProfileId : '';
    const r = await perform({ type: 'categoryTaskProfileSave', taskId, name, urls, categoryLabels: labelsMap, ...options });
    if (r?.task?.id) {
      loadedTaskProfileId = r.task.id;
      loadedTaskProfileName = r.task.name;
      closeInlineSaveBox();
    }
  } catch (e) {
    $('message').textContent = e.message;
  }
};

for (const [btnId, mode] of [['continueRemaining', 'remaining_only'], ['continueNextRound', 'resume_all']]) {
  if ($(btnId)) $(btnId).onclick = () => {
    if (!state || !['completed', 'stopped', 'failed'].includes(state.status)) return;
    try {
      const filterOptions = readFilterOptions();
      const confirmArchive = confirmArchiveIfNeeded();
      if (confirmArchive === null) return;
      void perform({ type: 'categoryContinueNextRound', batchId: state.id, mode, ...filterOptions, confirmArchiveOverflow: confirmArchive });
    } catch (e) {
      $('message').textContent = e.message;
    }
  };
}

async function perform(message) {
  if (busy) return null;
  actionRevision++; refreshSequence++; busy = true;
  render(state);
  try {
    const r = await send(message);
    busy = false;
    const cs = Object.hasOwn(r, 'cloudSync') ? r.cloudSync : cloudSync;
    render(Object.hasOwn(r, 'batch') ? r.batch : state, Array.isArray(r.history) ? r.history : history, Array.isArray(r.tasks) ? r.tasks : savedTasks, cs);
    let note = r.message || r.batch?.message || '操作已完成。';
    if (message.type === 'categoryAddPool') {
      note = r.added > 0
        ? `已新增 ${r.added} 件到本机商品池 · 重复 ${r.duplicates || 0} · 历史排除 ${r.historySkipped || 0}`
        : r.duplicates > 0
          ? `本批 ${r.duplicates} 件均已在商品池中（新增 0 件），可点右上角打开商品池切换「全部状态」查看。`
          : `未新增商品（历史排除 ${r.historySkipped || 0} · 无效或待复核 ${r.riskSkipped || 0}）`;
      const link = document.querySelector('a.pool-link'), targetId = message.batchId || state?.id || '';
      if (link && targetId) link.href = `product-pool.html?batchId=${encodeURIComponent(targetId)}${r.added === 0 && r.duplicates > 0 ? '&filter=all' : ''}`;
    }
    $('message').textContent = note;
    return r;
  } catch (e) {
    busy = false;
    render(state);
    $('message').textContent = e.message;
    return null;
  }
}

if ($('cloudSyncBar')) $('cloudSyncBar').onclick = async () => {
  if (!cloudSync?.connected) return;
  const bar = $('cloudSyncBar'), statusEl = $('cloudSyncStatus');
  bar.classList.add('syncing');
  if (statusEl) statusEl.textContent = '同步中…';
  try {
    const r = await perform({ type: 'wbSyncCloudState' });
    if (r?.ok) {
      const msg = `云端同步完成：商品池 ${Number(r.cloudSync?.poolCount || 0)} 条、历史 ${Number(r.cloudSync?.historyCount || 0)} 条、常用任务 ${Number(r.cloudSync?.taskCount || 0)} 个。`;
      await refresh();
      $('message').textContent = msg;
    }
  } finally {
    bar.classList.remove('syncing');
  }
};

for (const [id, type] of [['pause', 'categoryPause'], ['resume', 'categoryResume'], ['stop', 'categoryStop'], ['addPool', 'categoryAddPool'], ['syncWorkbench', 'categorySyncWorkbench']]) {
  if ($(id)) $(id).onclick = () => perform({ type, batchId: state?.id });
}
$('historyBatch').onchange = () => { $('addHistoryPool').disabled = $('exportHistoryBatch').disabled = $('deleteHistoryBatch').disabled = busy || !$('historyBatch').value; };
$('addHistoryPool').onclick = () => perform({ type: 'categoryAddPool', batchId: $('historyBatch').value });
$('deleteHistoryBatch').onclick = () => {
  const id = $('historyBatch').value;
  if (!id) return;
  const item = history.find(x => x.id === id);
  if (!confirm(`确认删除所选已结束类目批次（${Number(item?.qualifiedCount || 0)} 个候选）？本机商品池、SKU 历史和工作台云端数据不会改动。`)) return;
  void perform({ type: 'categoryDeleteBatch', batchId: id });
};
$('deleteCurrentBatch').onclick = () => {
  if (!state || !['completed', 'stopped', 'failed'].includes(state.status)) return;
  const count = Number(state.qualifiedSkuIds?.length || state.stores?.reduce((n, s) => n + Number(s.qualifiedCount || 0), 0) || 0);
  if (!confirm(`确认删除当前已结束类目批次（${count} 个候选）？本机商品池、SKU 历史和工作台云端数据不会改动。`)) return;
  void perform({ type: 'categoryDeleteBatch', batchId: state.id });
};
$('cleanupEmptyBatches').onclick = () => {
  if (!confirm('清理所有已结束且没有候选的类目批次，包括当前已结束的空批次？运行中和暂停中的批次会保留；商品池、SKU 历史和工作台云端数据不会改动。')) return;
  void perform({ type: 'categoryCleanupEmpty' });
};
async function exportCsv(batchId) {
  try {
    const r = await send({ type: 'categoryExport', batchId });
    const url = URL.createObjectURL(new Blob(['\ufeff' + r.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `Ozon类目选品-${batchId}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { $('message').textContent = e.message; }
}
async function exportDiagnostic(batchId) {
  try {
    const r = await send({ type: 'categoryDiagnostic', batchId });
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.diagnostic ?? r, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `Ozon类目运行诊断-${batchId}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { $('message').textContent = e.message; }
}
$('exportDiagnostic').onclick = () => { const batchId = $('diagnosticHistory').value || state?.id; if (batchId) void exportDiagnostic(batchId); };
$('diagnosticHistory').onchange = () => { $('exportDiagnostic').disabled = busy || (!state && !$('diagnosticHistory').value); };
$('exportBatch').onclick = () => exportCsv(state?.id);
$('exportHistoryBatch').onclick = () => exportCsv($('historyBatch').value);
$('openScanTab').onclick = async () => {
  try {
    if (!Number.isInteger(state?.tabId)) return;
    const tab = await chrome.tabs.get(state.tabId);
    if (!tab) throw Error('采集页面已关闭');
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) { $('message').textContent = e.message; }
};

if ($('toggleCustomUrls')) $('toggleCustomUrls').onclick = () => setCustomUrlsOpen($('customUrlsDrawer').hidden);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.ozonCategoryBatchV1 || changes.ozonCategoryBatchHistoryV1 || changes.ozonCategoryTasksV1 || changes.ozonWorkbenchCloudSkusV1 || changes.ozonWorkbenchCategoryTasksSyncV1 || changes.ozonWorkbenchSettingsV1)) void refresh();
  if (area === 'local' && changes.ozonCategoryFxRateV1) {
    const val = changes.ozonCategoryFxRateV1.newValue;
    if (val && typeof val === 'object') {
      fxState = { autoRate: val.autoRate ?? null, autoFetchedAt: Number(val.autoFetchedAt) || 0, manualRate: val.manualRate ?? null };
      renderRubCnyHint();
    }
  }
});
window.addEventListener('focus', () => void refresh());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
window.setInterval(() => { if (['running', 'scanning'].includes(state?.status) && document.visibilityState === 'visible') void refresh(); }, 2500);

const dialog = $('catalogDialog'), feedback = $('catalogFeedback');
$('openCatalog').onclick = () => { if (!catalogData || dialog.open) return; setDraft(confirmedSource, [...(treeSelection?.selected.keys() || [])]); feedback.textContent = ''; dialog.showModal(); renderPicker(1); $('catalogSearch').focus(); };
$('catalogCancel').onclick = () => dialog.close();
dialog.addEventListener('close', () => { draftSelection = null; navPath = []; $('openCatalog').focus(); });
$('catalogDone').onclick = () => {
  if (!draftSelection) return;
  const combined = core.parseUrls([...$('urls').value.split(/\r?\n/), ...draftSelection.urls()]);
  if (combined.overflowCount) { feedback.textContent = '与手动链接合计最多 20 个类目，请减少选择后再完成。'; return; }
  treeSelection = draftSelection;
  confirmedSource = sourceValue();
  syncCatalogUrls();
  dialog.close();
};
document.querySelectorAll('[name="catalogSource"]').forEach(input => input.onchange = () => {
  const next = input.value;
  const had = selectedCount(draftSelection) > 0;
  setDraft(next);
  feedback.textContent = had ? '已切换目录，本次原选择已清空；取消可保留此前确认结果。' : '已切换目录；手动链接保持不变。';
  renderPicker(1);
});
$('catalogSearch').oninput = searchPicker;
$('catalogClear').onclick = () => { draftSelection?.clear(); feedback.textContent = ''; renderPicker(); };
for (const [id, depth] of [['catalogLeaves1', 0], ['catalogLeaves2', 1]]) $(id).onclick = () => {
  const node = draftSelection?.byId.get(navPath[depth]);
  if (!node) return;
  try { draftSelection.addLeaves(node); feedback.textContent = ''; renderPicker(); } catch (e) { feedback.textContent = e.message; }
};

const FX_STORAGE_KEY = 'ozonCategoryFxRateV1', FX_DEFAULT_RATE = 11.8, FX_TTL_MS = 12 * 60 * 60 * 1000;
const FX_ENDPOINTS = [
  { url: 'https://open.er-api.com/v6/latest/CNY', pick: d => Number(d?.rates?.RUB) },
  { url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json', pick: d => Number(d?.cny?.rub) }
];
let fxState = { autoRate: null, autoFetchedAt: 0, manualRate: null };
function validFx(v) { const n = Number(v); return Number.isFinite(n) && n >= 0.1 && n <= 1000 ? n : null; }
function activeFxRate() { return validFx(fxState.manualRate) || validFx(fxState.autoRate) || FX_DEFAULT_RATE; }
function parseOptionalNum(el) {
  const raw = String(el?.value ?? '').trim();
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}
function formatCny(val) {
  const rounded = Math.round(Math.max(0, val) * 10) / 10;
  return '¥' + (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1));
}
async function saveFxState() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
    await chrome.storage.local.set({ [FX_STORAGE_KEY]: fxState }).catch(() => null);
  }
}
function renderRubCnyHint() {
  const bar = $('rubCnyBar'), modeEl = $('priceModePill'), amountEl = $('rubCnyAmount'), warnEl = $('rubCnyWarn'), fxControls = $('fxControls');
  if (!bar || !amountEl || !warnEl) return;
  const minVal = parseOptionalNum($('priceMin')), maxVal = parseOptionalNum($('priceMax'));
  if (minVal === null && maxVal === null) { bar.hidden = true; return; }
  bar.hidden = false;
  warnEl.hidden = true;
  warnEl.textContent = '';
  const isRub = pagePriceCurrency === 'RUB';
  if ($('fxEditBtn')) $('fxEditBtn').textContent = `调整汇率 (1¥ = ${activeFxRate().toFixed(2)}₽)`;
  if ($('fxAutoBtn')) $('fxAutoBtn').hidden = !isRub || !validFx(fxState.manualRate);

  if (Number.isNaN(minVal) || Number.isNaN(maxVal)) {
    if (fxControls) fxControls.hidden = true;
    if (modeEl) { modeEl.textContent = '区间有误'; modeEl.className = 'mode-pill review-only'; }
    amountEl.textContent = '请输入有效数字金额（最多两位小数）';
    return;
  }
  if (minVal !== null && maxVal !== null && minVal > maxVal) {
    if (fxControls) fxControls.hidden = true;
    if (modeEl) { modeEl.textContent = '区间有误'; modeEl.className = 'mode-pill review-only'; }
    amountEl.textContent = '最低价不能高于最高价';
    return;
  }
  const bothFilled = minVal !== null && maxVal !== null;
  if (modeEl) {
    modeEl.textContent = bothFilled ? '网页预筛 + 采集后复核' : '仅采集后复核';
    modeEl.className = bothFilled ? 'mode-pill' : 'mode-pill review-only';
  }
  if (!isRub) {
    if (fxControls) fxControls.hidden = true;
    amountEl.textContent = bothFilled
      ? `Ozon 页面按 ¥${Math.floor(minVal)}–${Math.ceil(maxVal)} 预筛，入池前精确复核`
      : '仅填了一端，将跳过 Ozon 网页预筛，采集时按人民币复核（填满两端即启用网页预筛）';
    return;
  }
  if (fxControls) fxControls.hidden = false;
  const rate = activeFxRate();
  const minCny = minVal !== null ? minVal / rate : null;
  const maxCny = maxVal !== null ? maxVal / rate : null;
  const equiv = minCny !== null && maxCny !== null
    ? `约合 ${formatCny(minCny)} – ${formatCny(maxCny)}`
    : minCny !== null ? `约合 ${formatCny(minCny)} 起` : `约合 ${formatCny(maxCny)} 以内`;
  amountEl.innerHTML = `<strong>${esc(equiv)}</strong> · ${bothFilled ? '已启用 Ozon 卢布网页预筛 + 复核' : '仅采集后复核（填满两端即启用网页预筛）'}`;
}

async function fetchAutoFx() {
  for (const ep of FX_ENDPOINTS) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
    try {
      const res = await fetch(ep.url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) continue;
      const data = await res.json();
      const rate = validFx(ep.pick(data));
      if (rate) { fxState = { ...fxState, autoRate: rate, autoFetchedAt: Date.now() }; await saveFxState(); renderRubCnyHint(); return; }
    } catch {} finally { if (timer) clearTimeout(timer); }
  }
}
async function initFxRate() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
    try {
      const stored = (await chrome.storage.local.get(FX_STORAGE_KEY))[FX_STORAGE_KEY];
      if (stored && typeof stored === 'object') {
        fxState = { autoRate: validFx(stored.autoRate), autoFetchedAt: Number(stored.autoFetchedAt) || 0, manualRate: validFx(stored.manualRate) };
      }
    } catch {}
  }
  renderRubCnyHint();
  if (!validFx(fxState.autoRate) || Date.now() - (fxState.autoFetchedAt || 0) >= FX_TTL_MS) void fetchAutoFx();
}
function closeFxEditor() {
  if ($('fxEditor')) $('fxEditor').hidden = true;
  if ($('fxEditBtn')) $('fxEditBtn').hidden = false;
}
if ($('fxEditBtn')) $('fxEditBtn').onclick = () => {
  if (!$('fxEditor') || !$('fxRateInput')) return;
  $('fxRateInput').value = activeFxRate().toFixed(2);
  $('fxEditBtn').hidden = true; $('fxEditor').hidden = false;
  $('fxRateInput').focus(); $('fxRateInput').select();
};
if ($('fxCancelBtn')) $('fxCancelBtn').onclick = () => closeFxEditor();
if ($('fxSaveBtn')) $('fxSaveBtn').onclick = async () => {
  const next = validFx($('fxRateInput')?.value);
  if (!next) { $('fxRateInput')?.focus(); return; }
  fxState = { ...fxState, manualRate: next }; await saveFxState(); closeFxEditor(); renderRubCnyHint();
};
if ($('fxAutoBtn')) $('fxAutoBtn').onclick = async () => {
  fxState = { ...fxState, manualRate: null }; await saveFxState(); closeFxEditor(); renderRubCnyHint();
  if (!validFx(fxState.autoRate) || Date.now() - (fxState.autoFetchedAt || 0) >= FX_TTL_MS) void fetchAutoFx();
};
if ($('fxRateInput')) $('fxRateInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('fxSaveBtn')?.click(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFxEditor(); }
});
if ($('pageCurrencyRub')) $('pageCurrencyRub').onclick = () => setPagePriceCurrency('RUB', { markDirty: true });
if ($('pageCurrencyCny')) $('pageCurrencyCny').onclick = () => setPagePriceCurrency('CNY', { markDirty: true });
for (const id of ['targetCount', 'perCategoryLimit', 'priceMin', 'priceMax']) {
  const el = $(id);
  if (el) {
    const onFormEdit = () => { formDirty = true; renderRubCnyHint(); updateContinueHint(); };
    el.addEventListener('input', onFormEdit);
    el.addEventListener('change', onFormEdit);
  }
}

void initFxRate();
void loadCatalog();
void refresh();
