(function installOzonCategoryBackground(scope) {
  "use strict";
  const KEY = "ozonCategoryBatchV1";
  const HISTORY_KEY = "ozonCategoryBatchHistoryV1";
  const HISTORY_LIMIT = 5;
  const ALARM = 'ozon-category-runner';
  const PROTECTION_KEY = 'ozonCategoryScanProtectionV1';
  const STALE_MS = 15000, MESSAGE_TIMEOUT_MS = 4000, RECOVERY_LIMIT = 2;
  const STALL_MS = 90000;
  const CRASH_RECOVER_LIMIT = 3;
  let experimentDebuggerTabId = null;
  const waitLabels = {
    catalog_loading: '主商品列表尚未加载',
    hidden_bottom: '已到当前页底，未加载出下一段商品',
    scroll_stalled: '已尝试滚动，页面位置没有变化',
    review_pending: '商品字段尚未齐全',
    no_new_sku: '滚动后仍只有已检查的商品',
    list_ambiguous: '无法确认唯一的主商品列表',
    price_filter_loading: '等待 Ozon 页面卢布价格区间确认'
  };
  const core = scope.OzonCategoryCore;
  const scanner = scope.OzonStoreScannerCore;
  let serial = Promise.resolve();
  const queue = (fn) => { const p = serial.then(fn, fn); serial = p.catch(() => null); return p; };
  const now = () => new Date().toISOString();
  const uuid = () => scope.crypto.randomUUID();
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  const diagnosticOutcomes = new Set(['erp_pending','data_pending','no_label','price_outside','transport_blocked','eligible','erp_conflict','accepted','batch_duplicate','pool_duplicate','history_duplicate','target_limit','invalid_candidate']);
  const readerOutcomes = new Set(['erp_pending','data_pending','no_label','price_outside','transport_blocked','eligible','erp_conflict']);
  const finalOutcomes = new Set(['accepted','batch_duplicate','pool_duplicate','history_duplicate','target_limit','invalid_candidate']);
  function diagnosisCounts(task) {
    const decisions=task.diagnosticDecisions||{}, counts={};
    for(const reason of Object.values(decisions))if(diagnosticOutcomes.has(reason))counts[reason]=(counts[reason]||0)+1;
    const classified=Object.values(counts).reduce((sum,count)=>sum+count,0);
    const known=Math.max(Number(task.discoveredCount)||0,(Number(task.observedCount)||0)+(Number(task.pendingCount)||0),classified);
    if(known>classified)counts.unknown=known-classified;
    return counts;
  }
  function diagnosticEvent(batch,type,detail='') { batch.diagnosticEvents ||= []; const stamp=now();if(['watchdog_frozen','tab_discarded'].includes(type)&&batch.diagnosticEvents.at(-1)?.type===type)return;batch.diagnosticEvents.push({at:stamp,type,detail:String(detail).slice(0,180)}); if(batch.diagnosticEvents.length>120)batch.diagnosticEvents=batch.diagnosticEvents.slice(-120); }
  async function browserSnapshot(batch,pageReportedHidden,pageFocused) {
    if(!Number.isInteger(batch?.tabId))return null;
    try {
      const tab=await chrome.tabs.get(batch.tabId);if(!pageMatches(tab.pendingUrl||tab.url||'',currentStore(batch)))return null;
      const win=await chrome.windows?.get?.(tab.windowId).catch(()=>null);
      const known=value=>typeof value==='boolean'?value:null;
      const previous=batch.diagnosticBrowser||{};
      return {tabStatus:tab.status||'unknown',frozen:known(tab.frozen),discarded:known(tab.discarded),tabActive:known(tab.active),windowFocused:known(win?.focused),pageReportedHidden:typeof pageReportedHidden==='boolean'?pageReportedHidden:previous.pageReportedHidden??null,pageFocused:typeof pageFocused==='boolean'?pageFocused:previous.pageFocused??null,pageReportedAt:typeof pageReportedHidden==='boolean'?now():previous.pageReportedAt||null,checkedAt:now()};
    } catch{return null;}
  }
  // Chrome does not support requesting debugger as an optional permission.
  // The trial code is retained but this release declares no debugger access.
  // Downgrade legacy stored flags even if a stale API object is exposed.
  function reconcileExperiment(batch){
    if(batch?.backgroundExperiment&&(!chrome.runtime?.getManifest?.().permissions?.includes('debugger')||!chrome.debugger?.attach||!chrome.debugger?.sendCommand)){
      batch.backgroundExperiment=false;
      batch.activityStatus='unavailable';
      batch.experimentMessage='当前版本不具备调试权限，使用普通后台扫描';
    }
    return batch;
  }
  async function read() { return reconcileExperiment((await chrome.storage.local.get(KEY))[KEY] || null); }
  async function protectTab(tabId){
    if(!Number.isInteger(tabId)||!chrome.storage.session?.get)return;
    try{const stored=await chrome.storage.session.get(PROTECTION_KEY),record=stored[PROTECTION_KEY]||{};const tab=await chrome.tabs.get(tabId);if(!Object.hasOwn(record,tabId)){record[tabId]=tab.autoDiscardable!==false;await chrome.storage.session.set({[PROTECTION_KEY]:record})}if(tab.autoDiscardable!==false)await chrome.tabs.update(tabId,{autoDiscardable:false})}catch{}
  }
  async function releaseTab(tabId){
    if(!Number.isInteger(tabId)||!chrome.storage.session?.get)return;
    try{const stored=await chrome.storage.session.get(PROTECTION_KEY),record=stored[PROTECTION_KEY]||{};if(!Object.hasOwn(record,tabId))return;await chrome.tabs.update(tabId,{autoDiscardable:record[tabId]}).catch(()=>null);delete record[tabId];await chrome.storage.session.set({[PROTECTION_KEY]:record})}catch{}
  }
  async function releaseFocusExperiment(tabId) {
    if (!Number.isInteger(tabId) || experimentDebuggerTabId !== tabId) return;
    experimentDebuggerTabId = null;
    try { await chrome.debugger.sendCommand({tabId},'Emulation.setFocusEmulationEnabled',{enabled:false}); } catch {}
    try { await chrome.debugger.detach({tabId}); } catch {}
  }
  async function enableFocusExperiment(batch) {
    reconcileExperiment(batch);
    if (!batch?.backgroundExperiment || !Number.isInteger(batch.tabId)) return;
    if (experimentDebuggerTabId===batch.tabId) return;
    if (!chrome.debugger?.attach || !chrome.debugger?.sendCommand) { batch.activityStatus='unavailable'; return; }
    const target={tabId:batch.tabId};
    try {
      const tab=await chrome.tabs.get(batch.tabId);
      const task=currentStore(batch);
      if (!task || (tab.pendingUrl && !pageMatches(tab.pendingUrl,task)) || (!pageMatches(tab.url,task) && !pageMatches(tab.pendingUrl,task))) { batch.activityStatus='focus-emulation-unavailable'; return; }
      await chrome.debugger.attach(target,'1.3');
      experimentDebuggerTabId=batch.tabId;
      await chrome.debugger.sendCommand(target,'Emulation.setFocusEmulationEnabled',{enabled:true});
      batch.activityStatus='focus-emulation-enabled';
    } catch {
      // A denied permission or an existing user-owned DevTools session must not
      // interrupt category scanning, and must never be detached by this runner.
      if (experimentDebuggerTabId===batch.tabId) {
        try { await chrome.debugger.detach(target); } catch {}
        experimentDebuggerTabId=null;
      }
      batch.activityStatus='focus-emulation-unavailable';
      batch.experimentMessage='焦点模拟当前不可用，继续使用普通后台扫描';
    }
  }
  async function nativePageHidden(tabId) {
    try {
      const tab=await chrome.tabs.get(tabId);
      const win=await chrome.windows?.get?.(tab.windowId);
      return tab.active!==true || win?.focused!==true;
    } catch { return true; }
  }
  async function effectivePageHidden(batch,reportedHidden) {
    return batch?.backgroundExperiment ? nativePageHidden(batch.tabId) : reportedHidden===true;
  }
  async function createTaskWindow(url) {
    const win=await chrome.windows?.create?.({url,focused:false,type:'normal'});
    if (win?.tabs?.[0]) return win.tabs[0];
    return chrome.tabs.create({url,active:false});
  }
  async function save(batch) { reconcileExperiment(batch);batch.updatedAt = now();await chrome.storage.local.set({[KEY]:batch});if(batch.status==='running'){const alarm=await chrome.alarms?.get?.(ALARM);if(!alarm||alarm.periodInMinutes!==0.5)await chrome.alarms?.create?.(ALARM,{periodInMinutes:0.5})}else{await chrome.alarms?.clear?.(ALARM);if(experimentDebuggerTabId===batch.tabId&&batch.activityStatus==='focus-emulation-enabled')batch.activityStatus='focus-emulation-released';await releaseFocusExperiment(batch.tabId);await releaseTab(batch.tabId);await chrome.storage.local.set({[KEY]:batch})}return batch; }
  function bounded(promise,ms=MESSAGE_TIMEOUT_MS){let timer;return Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms)})]).finally(()=>clearTimeout(timer))}
  function phase(batch,mode,message){batch.pageMode=mode;batch.message=message;return batch}
  async function waitStatus(batch,message){if(batch.pageMode!=='waiting'||batch.message!==message){phase(batch,'waiting',message);await save(batch)}}
  function currentStore(batch) { return batch?.stores?.[batch.currentIndex] || null; }
  function runnableTask(task) {
    return !!task && !task.removedFromQueue && ['pending','deferred','partial','scanning','paused'].includes(task.status);
  }
  function nextResumeIndex(batch) {
    if (Number.isInteger(batch.resumeIndex) && runnableTask(batch.stores[batch.resumeIndex])) return batch.resumeIndex;
    if (runnableTask(currentStore(batch))) return batch.currentIndex;
    return batch.stores.findIndex(runnableTask);
  }
  function pageUrl(task) { return task?.pageUrl || task?.url || ""; }
  function pageMatches(actual, task) {
    return !!task && core.samePage(actual || "", task.url) && core.exactPageUrl(actual)===pageUrl(task);
  }
  function navigationMismatch(batch,task){
    if(task&&core.rubRange(batch.options)){task.pagePriceStatus='unconfirmed';return '任务标签页或卢布价格条件发生变化，已暂停，请返回原筛选页面'}
    return '任务标签页导航离开类目范围，已暂停';
  }
  const sourceKind=url=>core.keyFromUrl(url).startsWith('china-category:')?'china':'normal';
  function qualifiedTotal(batch) { return (batch.qualifiedSkuIds || []).length; }
  function finishAtTarget(batch) {
    if (qualifiedTotal(batch) < batch.options.targetCount) return false;
    batch.status = "completed"; batch.message = "已达到批次目标有效商品数";
    for (const task of batch.stores) if (task.status === 'deferred') {
      task.status = 'partial'; task.note = '批次目标已达到，保留已采记录';
    } else if (task.status === "pending" || task.status === "scanning") {
      task.status = task.qualifiedCount ? "completed" : "skipped";
      if (!task.qualifiedCount) task.skipReason = "批次目标已达到，未扫描";
    }
    return true;
  }
  function snapshot() { return read().then(batch => batch ? { batch: clone(batch), stores: clone(batch.results || {}) } : null); }
  async function snapshotHistory() { return clone((await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] || []); }
  const finished = batch => !!batch && ["completed", "stopped", "failed"].includes(batch.status);
  const emptyFinished = batch => finished(batch) && qualifiedTotal(batch) === 0;
  const historySummary = batch => ({ id: batch.id, status: batch.status, updatedAt: batch.updatedAt, qualifiedCount: qualifiedTotal(batch), storeCount: batch.stores?.length || 0 });
  function assertActive(batch, m, sender, requirePage = true) {
    if (!batch || batch.id !== m.batchId) throw Error("类目批次已变化");
    if (batch.status !== 'running' || currentStore(batch)?.status !== 'scanning') throw Error('类目任务已暂停或不再活动');
    if (!batch.attemptId || batch.attemptId !== m.attemptId) throw Error("类目扫描尝试已失效");
    if (!batch.tabId || sender?.tab?.id !== batch.tabId) throw Error(`消息来自非类目任务标签页 (${sender?.tab?.id ?? "missing"}/${batch.tabId ?? "missing"})`);
    const task = currentStore(batch);
    if (!task || !pageMatches(m.categoryUrl, task)) throw Error("类目页面与当前任务不匹配");
    if (requirePage && !pageMatches(sender?.tab?.url || "", task)) throw Error("标签页当前页面不属于此类目任务");
    return task;
  }
  async function stopScanner(batch) {
    if (batch?.tabId) await bounded(chrome.tabs.sendMessage(batch.tabId, { type: "categoryScanStop", batchId: batch.id, attemptId: batch.attemptId })).catch(() => null);
  }
  async function replaceTaskTab(batch, targetUrl, oldTab = null) {
    const oldTabId = oldTab?.id ?? batch.tabId;
    let fresh = null;
    if (oldTab && Number.isInteger(oldTab.windowId)) {
      fresh = await chrome.tabs.create({ windowId: oldTab.windowId, url: targetUrl, active: oldTab.active === true }).catch(() => null);
    }
    if (!fresh) fresh = await createTaskWindow(targetUrl);
    batch.tabId = fresh.id;
    await protectTab(fresh.id);
    await save(batch);
    if (Number.isInteger(oldTabId) && oldTabId !== fresh.id) {
      await releaseFocusExperiment(oldTabId);
      await releaseTab(oldTabId);
      await chrome.tabs.remove(oldTabId).catch(() => null);
    }
    return fresh;
  }
  async function recoverCrashedTab(batch, task, tab, reasonLabel) {
    if (!task || !tab || !pageMatches(tab.url, task) || tab.pendingUrl || tab.frozen || tab.discarded) return false;
    if ((Number(task.crashRecoveryCount) || 0) >= CRASH_RECOVER_LIMIT) {
      batch.status = 'paused';
      task.status = task.observedCount || task.pendingCount ? 'partial' : 'pending';
      task.note = '采集页连续崩溃或无响应，已保存进度';
      batch.message = '采集页连续崩溃达到自动恢复上限，已保存进度并暂停；可关闭原页面后点击继续。';
      diagnosticEvent(batch, 'tab_crash_limit');
      await save(batch);
      return true;
    }
    task.crashRecoveryCount = (Number(task.crashRecoveryCount) || 0) + 1;
    batch.recoveryAttempts = 0;
    batch.noResponseCount = 0;
    batch.attemptId = uuid();
    batch.watchdogSince = now();
    delete task.waitSince;
    delete task.waitReason;
    diagnosticEvent(batch, 'tab_crash_recover', `${reasonLabel} (${task.crashRecoveryCount}/${CRASH_RECOVER_LIMIT})`);
    phase(batch, 'recovering', `采集页无响应或内存崩溃，正在新标签页自动续扫（${task.crashRecoveryCount}/${CRASH_RECOVER_LIMIT}）`);
    const fresh = await replaceTaskTab(batch, pageUrl(task), tab);
    await enableFocusExperiment(batch);
    await save(batch);
    const liveTab = await chrome.tabs.get(fresh.id).catch(() => null);
    if (liveTab?.status === 'complete' && pageMatches(liveTab.url, task) && !liveTab.pendingUrl && !liveTab.frozen && !liveTab.discarded) {
      try { await startScanner(batch, task); }
      catch { await waitStatus(batch, '新采集页等待读取器响应，正在自动检查。'); }
    }
    return true;
  }
  // Store the checkpoint and intended destination before sending a navigation.
  // A restart or failed navigation can then resume without losing either task.
  async function switchTask(batch, index, allowFreshWindow = false) {
    const previous = currentStore(batch), next = batch.stores[index];
    diagnosticEvent(batch,'switch',`${previous?.sellerKey||'none'} -> ${next?.sellerKey||'unknown'}`);
    batch.diagnosticBrowser=null;batch.noResponseCount=0;delete batch.recentWaitReason;
    const resumingSwitch = batch.resumeIndex === index;
    batch.resumeIndex = index;
    await save(batch);
    try {
      const tab = batch.tabId == null ? null : await chrome.tabs.get(batch.tabId).catch(()=>null);
      const actual = tab && (tab.pendingUrl || tab.url);
      // Only reuse a tab whose native URL proves it belongs to this batch. If
      // the owned tab was closed or navigated elsewhere, leave it alone and
      // create a fresh task window for the explicitly selected category.
      if (tab && (pageMatches(actual, previous) || ((resumingSwitch || allowFreshWindow) && pageMatches(actual, next)))) {
        await stopScanner(batch);
        if (!pageMatches(actual, next)) {
          await replaceTaskTab(batch, pageUrl(next), tab);
          diagnosticEvent(batch, 'tab_recycled', `切换类目重建标签页释放内存: ${next.sellerKey}`);
        }
      } else if (allowFreshWindow) {
        if (batch.tabId != null) { await releaseFocusExperiment(batch.tabId); await releaseTab(batch.tabId); }
        const fresh = await createTaskWindow(pageUrl(next));
        batch.tabId = fresh.id;
        await protectTab(batch.tabId);
      } else throw Error();
    } catch {
      batch.status = 'paused';
      batch.message = '切换前无法确认采集页，进度已保存。请检查原标签页后继续。';
      await save(batch);
      return;
    }
    batch.currentIndex = index;
    delete batch.resumeIndex;
    if (next.status === 'deferred') next.revisitCount = 1;
    next.status = 'scanning';
    delete next.note;
    delete next.waitSince;
    delete next.waitReason;
    batch.attemptId = uuid();
    batch.watchdogSince = now();
    batch.recoveryAttempts = 0;
    await protectTab(batch.tabId);
    phase(batch,'waiting',next.revisitCount ? '正在回查已保存的类目' : '等待下一类目页面加载');
    await save(batch);
    await enableFocusExperiment(batch);
    await save(batch);
    // onUpdated handles loading pages. A same-page return needs an explicit start.
    const tab = await chrome.tabs.get(batch.tabId).catch(()=>null);
    if (tab?.status === 'complete' && pageMatches(tab.url,next) && !tab.pendingUrl && !tab.frozen && !tab.discarded) {
      try { await startScanner(batch,next); }
      catch { await waitStatus(batch,'页面读取器暂未响应，正在等待自动恢复。'); }
    }
  }
  async function advance(batch) {
    let next = batch.stores.findIndex(task=>task.status === 'pending');
    if (next < 0) next = batch.stores.findIndex(task=>task.status === 'deferred');
    if (next >= 0) return switchTask(batch,next);
    const partial = batch.stores.findIndex(task=>task.status === 'partial');
    if (partial >= 0) {
      batch.status = 'paused';
      if (currentStore(batch).status !== 'partial') batch.resumeIndex = partial;
      batch.message = '本批仍有类目待人工检查，自动回查已结束。已采记录已保存，可检查后继续。';
    } else {
      batch.status = 'completed';
      batch.message = '本批类目已扫描完成';
    }
    await stopScanner(batch);
    await save(batch);
  }
  async function startScanner(batch,task){
    if(core.rubRange(batch.options)&&task.pagePriceStatus!=='pending'){task.pagePriceStatus='pending';await save(batch);}
    const injection=await bounded(chrome.scripting.executeScript({target:{tabId:batch.tabId},files:['store-scanner-core.js','category-core.js','category-scanner.js']}));
    if(injection===null)throw Error('扫描页面暂未响应');
    const pageNativeHidden=batch.backgroundExperiment?await nativePageHidden(batch.tabId):false;
    const ack=await bounded(chrome.tabs.sendMessage(batch.tabId,{type:'categoryScanStart',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:pageUrl(task),options:batch.options,observedSkus:task.observedSkus||[],pendingSkus:task.pendingSkus||[],recheckFromTop:!!task.pendingCount&&!task.pendingSkus?.length,pageNativeHidden}));
    if(!ack?.ok)throw Error('扫描器未确认启动');
  }
  async function openCurrent(batch, create = false) {
    const task = currentStore(batch);
    if (!task) return;
    batch.watchdogSince=now();batch.recoveryAttempts=0;batch.noResponseCount=0;
    if (batch.tabId && !create) {
      try {
        const existing = await chrome.tabs.get(batch.tabId);
        if (pageMatches(existing?.url, task)) {
          await protectTab(batch.tabId);batch.attemptId = uuid();phase(batch,'recovering','正在恢复类目扫描');await save(batch);
          await enableFocusExperiment(batch);
          if(existing.status!=='loading'&&!existing.frozen&&!existing.discarded){
            try{await startScanner(batch,task)}
            catch{
              if(!existing.pendingUrl && await recoverCrashedTab(batch,task,existing,'继续任务时重建无响应标签页'))return;
              await waitStatus(batch,'页面读取器暂未响应，正在等待自动恢复。');
            }
          }
          return;
        }
      } catch { batch.tabId = null; }
      // Do not navigate away from a login/verification screen or another page
      // on behalf of the user. Resume only after the original page is ready.
      if(batch.tabId){batch.status='paused';batch.message=core.rubRange(batch.options)?navigationMismatch(batch,task):'当前标签页已离开本批类目，请完成页面检查并返回原类目后继续';await save(batch);return;}
    }
    batch.attemptId = uuid();batch.watchdogSince=now();phase(batch,'waiting','等待类目页面加载');
    if (!batch.tabId || create) {
      const tab = await createTaskWindow(pageUrl(task));
      batch.tabId = tab.id;
      await protectTab(batch.tabId);
    } else await chrome.tabs.update(batch.tabId, { url: pageUrl(task) });
    await save(batch);
    await enableFocusExperiment(batch);
    await save(batch);
  }
  function normalizeSampleProduct(p, task) {
    const sku = String(p?.sku || "").trim();
    const link = scanner.canonicalProductLink(String(p?.link || ""));
    if (!/^\d+$/.test(sku) || !/^https:\/\//i.test(link) || !core.qualifiedProduct(p, task.options)) return null;
    if (!scanner.productAllowedForTaskQueue(p)) return null;
    return { ...p, sku, link };
  }
  async function handle(message, sender = {}) {
    const m = message || {};
    if (!String(m.type || "").startsWith("category")) return null;
    return queue(async () => {
      let batch = await read();
      switch (m.type) {
        case "categoryGet": return { ok: true, batch: clone(batch), history: (await snapshotHistory()).map(historySummary) };
        case "categoryStart": {
          if (batch && ["running", "paused"].includes(batch.status)) throw Error("已有类目批次正在运行或暂停，请先停止");
          const parsed = core.parseUrls(m.urls, 20);
          const urls = Array.isArray(parsed) ? parsed : parsed.urls;
          if (!urls?.length||parsed.invalid?.length||parsed.overflowCount) throw Error("请提供 1–20 个有效的 Ozon 类目链接");
          const options = core.validateOptions({ targetCount: m.targetCount, minPrice: m.minPrice, maxPrice: m.maxPrice, pageMinRub:m.pageMinRub, pageMaxRub:m.pageMaxRub, fxRate:m.fxRate });
          if (batch) {
            const archived = await snapshotHistory();
            if (archived.length >= HISTORY_LIMIT && !m.confirmArchiveOverflow) throw Error("类目历史已满，请先导出或入池，再明确确认轮换最旧批次");
            archived.unshift(clone(batch));
            await chrome.storage.local.set({ [HISTORY_KEY]: archived.slice(0,HISTORY_LIMIT) });
          }
          const id = `category-${uuid()}`;
          const stores = urls.map((url, i) => {const kind=sourceKind(url),label=m.categoryLabels&&Object.hasOwn(m.categoryLabels,url)&&typeof m.categoryLabels[url]==='string'?m.categoryLabels[url].trim().slice(0,120):'';return { sellerKey: core.keyFromUrl(url), url, pageUrl:core.pricePageUrl(url,options), ...(core.rubRange(options)?{pagePriceStatus:'pending'}:{}), sourceKind:kind, ...(label?{label,name:(kind==='china'?'中国专区 · ':'普通类目 · ')+label}:{}), status: i === 0 ? "scanning" : "pending", observedCount: 0, qualifiedCount: 0, pendingCount: 0, observedSkus: [], visitedPages: [] }});
          batch = { id, sourceMode: "category", status: "running", currentIndex: 0, tabId: null, attemptId: null, options, stores, results: {}, updatedAt: now(), message: "类目扫描已开始", addedCount: 0, backgroundExperiment: m.backgroundExperiment===true, activityStatus: m.backgroundExperiment===true?'starting':'native-background-only', diagnosticEvents:[] };
          diagnosticEvent(batch,'start');
          await openCurrent(batch, true);
          return { ok: true, batch: clone(batch) };
        }
        case "categoryPause":
        case "categoryStop": {
          if (!batch) return { ok: true, batch: null };
          await stopScanner(batch);
          const active = currentStore(batch);
          if (active?.status === 'scanning') active.status = active.pendingCount || active.observedCount ? 'partial' : 'pending';
          batch.status = m.type === "categoryStop" ? "stopped" : "paused";
          batch.message = m.type === "categoryStop" ? "已停止" : "已暂停";
          diagnosticEvent(batch,m.type==='categoryStop'?'stop':'explicit_pause'); await save(batch); return { ok: true, batch: clone(batch) };
        }
        case "categoryResume":
          if (!batch || batch.status !== "paused") throw Error("没有可继续的暂停类目批次");
          diagnosticEvent(batch,'resume');
          if (typeof m.backgroundExperiment==='boolean') batch.backgroundExperiment=m.backgroundExperiment;
          if (finishAtTarget(batch)) { await save(batch); return {ok:true,batch:clone(batch)}; }
          const resumeIndex=nextResumeIndex(batch);
          if (resumeIndex<0) {
            batch.status='completed'; batch.message='本批已无待扫描类目'; delete batch.resumeIndex;
            await save(batch); return {ok:true,batch:clone(batch)};
          }
          if (resumeIndex!==batch.currentIndex) batch.resumeIndex=resumeIndex;
          else if (!runnableTask(batch.stores[batch.resumeIndex])) delete batch.resumeIndex;
          if (Number.isInteger(batch.resumeIndex)) {
            batch.status = 'running';
            const previousTab = batch.tabId == null ? null : await chrome.tabs.get(batch.tabId).catch(()=>null);
            if (!previousTab) {
              if (batch.tabId != null) await releaseTab(batch.tabId);
              batch.currentIndex = batch.resumeIndex;
              delete batch.resumeIndex;
              const next = currentStore(batch);
              if (next.status === 'deferred') next.revisitCount = 1;
              next.status = 'scanning'; delete next.note; delete next.waitSince; delete next.waitReason;
              await openCurrent(batch,true);
            } else await switchTask(batch,batch.resumeIndex);
            return {ok:true,batch:clone(batch)};
          }
          if (currentStore(batch)) {const task=currentStore(batch);task.status = "scanning";delete task.note;delete task.waitSince;delete task.waitReason;}
          batch.status = "running"; batch.message = "继续扫描"; await openCurrent(batch); return { ok: true, batch: clone(batch) };
        case "categoryTaskResume":
        case "categoryTaskSkip":
        case "categoryTaskRemove": {
          if (!batch || batch.id !== m.batchId) throw Error('类目批次已变化');
          if (!['paused','stopped'].includes(batch.status)) throw Error('仅可在已暂停或已停止的批次中操作类目卡片');
          const matches = batch.stores.map((task,index)=>({task,index})).filter(x=>x.task.sellerKey===m.sellerKey);
          if (matches.length !== 1) throw Error('未找到唯一的类目卡片');
          const {task,index} = matches[0];
          const active = currentStore(batch);
          if (active?.status === 'scanning') active.status = active.pendingCount || active.observedCount ? 'partial' : 'pending';
          if (m.type === 'categoryTaskResume') {
            if (task.removedFromQueue || ['completed','skipped'].includes(task.status)) throw Error('已完成或已移出队列的类目不能继续');
            if (qualifiedTotal(batch) >= batch.options.targetCount) throw Error('本批目标已达到，不能继续类目');
            if (!runnableTask(task)) throw Error('该类目当前不能继续');
            if (typeof m.backgroundExperiment==='boolean') batch.backgroundExperiment=m.backgroundExperiment;
            delete batch.resumeIndex;
            if (task.status==='scanning' || task.status==='paused') task.status = task.pendingCount || task.observedCount ? 'partial' : 'pending';
            batch.status='running'; batch.message='继续所选类目';
            await switchTask(batch,index,true);
            return {ok:true,batch:clone(batch)};
          }
          await stopScanner(batch);
          if (!runnableTask(task)) throw Error('该类目当前不能跳过或移出');
          task.status='skipped'; task.skipReason=m.type==='categoryTaskRemove'?'已移出本批':'手动跳过';
          if (m.type==='categoryTaskRemove') task.removedFromQueue=true;
          const next=nextResumeIndex(batch);
          if (next<0) {
            batch.status='completed'; batch.message='本批已无待扫描类目'; delete batch.resumeIndex;
          } else if (next!==batch.currentIndex) batch.resumeIndex=next;
          else delete batch.resumeIndex;
          if (batch.status !== 'completed') batch.message=m.type==='categoryTaskRemove'?'类目已移出本批':'已跳过此类目';
          await save(batch); return {ok:true,batch:clone(batch)};
        }
        case "categorySample": {
          const task = assertActive(batch, m, sender);
          if (batch.status !== "running") throw Error("类目批次当前未运行");
          if(core.rubRange(batch.options)){
            if(m.pagePriceConfirmed!==true)throw Error('未确认 Ozon 页面卢布价格区间');
            if(task.pagePriceStatus!=='confirmed')diagnosticEvent(batch,'page_price_confirmed');
            task.pagePriceStatus='confirmed';
          }
          const effectiveHidden=await effectivePageHidden(batch,m.pageHidden);
          const beforeDiscovered=task.discoveredCount||0,beforeErpReady=task.erpReadyCount||0,beforeHits=task.labelHitCount||0;
          for (const [listField,countField] of [['discoverSkus','discoveredCount'],['erpReadySkus','erpReadyCount'],['labelHitSkus','labelHitCount']]) {
            const key=listField==='discoverSkus'?'discoveredSkus':listField;
            const set=new Set(task[key]||[]);
            for (const sku of Array.isArray(m[listField])?m[listField]:[]) if (/^\d+$/.test(String(sku))) set.add(String(sku));
            task[key]=[...set];task[countField]=set.size;
          }
          const observed = new Set(task.observedSkus || []),beforeObserved=observed.size;
          for (const sku of m.observedSkus || []) if (/^\d+$/.test(String(sku))) observed.add(String(sku));
          task.observedSkus = [...observed]; task.observedCount = observed.size;
          if (!effectiveHidden || observed.size > beforeObserved) {delete task.waitSince;delete task.waitReason;}
          task.pendingCount = Math.max(0, Number(m.pendingCount) || 0);
          if(Array.isArray(m.pendingSkus))task.pendingSkus=[...new Set(m.pendingSkus.map(String).filter(s=>/^\d+$/.test(s)&&!observed.has(s)))];
          batch.lastProgressAt=now();if(observed.size>beforeObserved){batch.lastNewSkuAt=batch.lastProgressAt;task.crashRecoveryCount=0;}batch.recoveryAttempts=0;batch.noResponseCount=0;
          task.activityStatus=batch.activityStatus||'native-background-only';
          phase(batch,effectiveHidden?'background':'foreground',effectiveHidden?'后台扫描类目商品（页面加载可能较慢）':'正在扫描类目商品');
          const pool = await scope.OzonProductPoolDB.lookup((m.products || []).map(raw => raw?.sku));
          const qualifiedSeen = new Set(batch.qualifiedSkuIds || []);
          const beforeQualified=qualifiedSeen.size;
          const decisions=task.diagnosticDecisions ||= {};
          const discovered=new Set(task.discoveredSkus||[]);
          if(m.skuDecisions && typeof m.skuDecisions==='object'&&!Array.isArray(m.skuDecisions)) {
            for(const [sku,outcome] of Object.entries(m.skuDecisions)) if(/^\d{1,24}$/.test(sku)&&discovered.has(sku)&&readerOutcomes.has(outcome)&&!finalOutcomes.has(decisions[sku])) {
              // A later incomplete rendering cannot erase a verified prior decision.
              if(outcome==='erp_pending'&&decisions[sku]&&decisions[sku]!=='erp_pending')continue;
              decisions[sku]=outcome;
            }
          }
          const remaining = Math.max(0, batch.options.targetCount - qualifiedSeen.size);
          const products = [];
          for (const raw of m.products || []) {
            const sku=String(raw?.sku||'').trim();
            if (products.length>=remaining) {if(/^\d{1,24}$/.test(sku)&&!finalOutcomes.has(decisions[sku]))decisions[sku]='target_limit';continue;}
            const product = normalizeSampleProduct(raw, batch);
            let reason='invalid_candidate';
            if(product){if(qualifiedSeen.has(product.sku))reason=decisions[product.sku]==='accepted'||batch.results?.[task.sellerKey]?.products?.[product.sku]?'accepted':'batch_duplicate';else if(pool.products?.[product.sku])reason='pool_duplicate';else if(Object.hasOwn(pool.history||{},product.sku))reason='history_duplicate';else {reason='accepted';qualifiedSeen.add(product.sku);products.push(product);}}
            if(/^\d{1,24}$/.test(sku)&&decisions[sku]!=='accepted')decisions[sku]=reason;
          }
          const title=typeof m.categoryName==='string'?m.categoryName.trim().slice(0,120):'';
          const kind=task.sourceKind||sourceKind(task.url), name=task.label||title||core.keyFromUrl(task.url);
          if(!task.label)task.name=(kind==='china'?'中国专区 · ':'普通类目 · ')+name;
          const output = batch.results[task.sellerKey] ||= { storeName: `类目 · ${kind==='china'?'中国专区 · ':''}${name}`, storeUrl: task.url, products: {}, batchCapture: { batchId: batch.id, skus: [] } };
          for (const p of products) if (!output.products[p.sku]) { output.products[p.sku] = p; output.batchCapture.skus.push(p.sku); }
          batch.qualifiedSkuIds = [...qualifiedSeen];
          task.qualifiedCount = Object.keys(output.products).length;
          if((task.discoveredCount||0)>beforeDiscovered)task.lastDiscoveryAt=batch.lastDiscoveryAt=now();
          if((task.erpReadyCount||0)>beforeErpReady)task.lastErpReadyAt=batch.lastErpReadyAt=now();
          if((task.labelHitCount||0)>beforeHits)task.lastLabelHitAt=batch.lastLabelHitAt=now();
          if(qualifiedSeen.size>beforeQualified){task.lastAcceptedAt=now();batch.lastAcceptedAt=task.lastAcceptedAt;}
          task.diagnosticCounts=diagnosisCounts(task);
          batch.diagnosticBrowser=await browserSnapshot(batch,m.pageReportedHidden,m.pageFocused);
          task.observedSkus = [...new Set([...task.observedSkus, ...Object.keys(output.products)])];
          const stop = finishAtTarget(batch);
          if (stop) {diagnosticEvent(batch,'target_reached');await stopScanner(batch);}
          await save(batch); return { ok: true, stop, pageNativeHidden: batch.backgroundExperiment?await nativePageHidden(batch.tabId):false, ...(m.compactAck?{}:{batch:clone(batch)}) };
        }
        case "categoryWait": {
          const task = assertActive(batch,m,sender);
          if(batch.status!=='running') throw Error('类目批次当前未运行');
          const known = Object.hasOwn(waitLabels,m.reason);
          if(m.reason==='price_filter_loading'&&core.rubRange(batch.options))task.pagePriceStatus='pending';
          if(batch.recentWaitReason!==m.reason)diagnosticEvent(batch,'explicit_wait',known?waitLabels[m.reason]:'等待页面状态');
          task.waitReason = m.reason;batch.recentWaitReason=known?m.reason:'unknown';
          batch.diagnosticBrowser=await browserSnapshot(batch,m.pageReportedHidden,m.pageFocused);
          phase(batch,'waiting',(known ? waitLabels[m.reason] : '正在等待类目页')+'，正在复查…');
          batch.lastProgressAt=now();batch.recoveryAttempts=0;batch.noResponseCount=0;
          if (await effectivePageHidden(batch,m.pageHidden) && known && !['list_ambiguous','price_filter_loading'].includes(m.reason)) {
            task.waitSince ??= Date.now();
            if (Date.now()-task.waitSince >= STALL_MS) {
              task.status = task.revisitCount ? 'partial' : 'deferred';
              task.note = waitLabels[m.reason];
              diagnosticEvent(batch,'stall_rotation',task.note);
              delete task.waitSince;
              await advance(batch);
              return {ok:true,stop:true};
            }
          } else delete task.waitSince;
          await save(batch);
          return {ok:true};
        }
        case "categoryPageDone": {
          const task = assertActive(batch, m, sender);
          if (batch.status !== "running") throw Error("类目批次当前未运行");
          const nextUrl = m.reason === "next_page_available" && m.nextUrl && core.paginationUrl?.(m.nextUrl, pageUrl(task));
          if (nextUrl && Number(new URL(nextUrl).searchParams.get('page'))===Number(new URL(pageUrl(task)).searchParams.get('page')||1)+1 && nextUrl!==pageUrl(task)&&!task.visitedPages.includes(nextUrl)) {
            const oldTab=batch.tabId==null?null:await chrome.tabs.get(batch.tabId).catch(()=>null);
            task.visitedPages.push(pageUrl(task)); task.pageUrl = nextUrl;if(core.rubRange(batch.options))task.pagePriceStatus='pending';task.pendingCount=0;task.pendingSkus=[];task.crashRecoveryCount=0;batch.noResponseCount=0;delete task.waitSince;delete task.waitReason; phase(batch,'waiting','继续扫描下一页'); await stopScanner(batch); diagnosticEvent(batch,'tab_recycled','翻页重建标签页释放内存'); batch.attemptId=uuid();batch.watchdogSince=now();batch.recoveryAttempts=0;const fresh=await replaceTaskTab(batch,nextUrl,oldTab);await enableFocusExperiment(batch);await save(batch);
            const liveTab=await chrome.tabs.get(fresh.id).catch(()=>null);
            if(liveTab?.status==='complete'&&pageMatches(liveTab.url,task)&&!liveTab.pendingUrl&&!liveTab.frozen&&!liveTab.discarded){
              try{await startScanner(batch,task);}catch{await waitStatus(batch,'新采集页等待读取器响应，正在自动检查。');}
            }
            return { ok: true, batch: clone(batch) };
          }
          const effectivelyHidden=batch.backgroundExperiment && (m.pageHidden===true || await nativePageHidden(batch.tabId));
          if (m.complete === true && m.reason === "visible_catalog_end" && effectivelyHidden) {
            await waitStatus(batch,'后台页面报告列表结束，但标签页或窗口仍未获得原生焦点；保留进度并等待可见确认。');
            return {ok:true,batch:clone(batch)};
          }
          if (m.complete === true && m.reason === "visible_catalog_end" && !effectivelyHidden) {
            diagnosticEvent(batch,'category_complete');
            task.status = "completed"; delete task.waitSince; delete task.waitReason;
            await advance(batch);
            return {ok:true,batch:clone(batch)};
          } else { await stopScanner(batch);delete task.waitSince;delete task.waitReason;task.status = "partial";batch.status = "paused";const verificationWhy={http_denied:'检测到站点访问受限（HTTP 状态提示），需人工检查',access_restricted:'检测到站点访问受限，需人工检查',security_prompt:'检测到站点安全验证，需人工完成',login_required:'页面要求登录，请在采集页人工处理'};
            if(core.rubRange(batch.options)&&['price_filter_unconfirmed','next_page_available'].includes(m.reason))task.pagePriceStatus='unconfirmed';
            const why=(m.reason==='manual-verification'&&Object.hasOwn(verificationWhy,m.verificationDetail)?verificationWhy[m.verificationDetail]:null)||{"manual-verification":"需人工完成站点验证或登录","catalog_list_unavailable":"未识别唯一主商品列表","scan_bound_reached":"达到单页扫描上限（非完成）","pending_cards":"仍有商品字段待复查","reader_error":"页面读取失败","sample_not_persisted":"未确认数据已保存","price_filter_unconfirmed":"未确认 Ozon 页面卢布价格区间，未读取本页商品","next_page_available":"下一页未保留已确认的类目和价格条件"}[m.reason]||"未确认扫描完成";task.note=why;batch.message=why+"，已暂停，检查页面后可继续。";diagnosticEvent(batch,m.reason==='manual-verification'?'manual_verification':m.reason==='reader_error'?'reader_failure':'scan_paused',why); }
          await save(batch); return { ok: true, batch: clone(batch) };
        }
        case "categoryAddPool": {
          const selectedId = m.batchId || batch?.id;
          const source = batch?.id === selectedId ? batch : (await snapshotHistory()).find(x => x.id === selectedId);
          if (!source) throw Error("找不到要加入商品池的类目批次");
          if (typeof scope.addCapturedBatchToPool !== "function") throw Error("商品池安全写入接口不可用");
          const result = await scope.addCapturedBatchToPool(source, source.results);
          source.addedCount = result.added;
          if (source === batch) await save(batch);
          else { const archived = await snapshotHistory(); const index = archived.findIndex(x => x.id === source.id); if (index >= 0) { archived[index] = source; await chrome.storage.local.set({ [HISTORY_KEY]: archived }); } }
          return { ok: true, added: result.added, duplicates: result.duplicates, historySkipped: result.historySkipped, riskSkipped: result.riskSkipped, batch: clone(batch) };
        }
        case "categoryExport": {
          const id=m.batchId||batch?.id,source=batch?.id===id?batch:(await snapshotHistory()).find(x=>x.id===id);
          if(!source)throw Error('找不到类目批次');return {ok:true,csv:scanner.buildManualSourcingCsv({batch:source,stores:source.results||{}})};
        }
        case "categoryDiagnostic": {
          const id=m.batchId||batch?.id,source=batch?.id===id?batch:(await snapshotHistory()).find(x=>x.id===id);
          if(!source)throw Error('找不到类目批次');
          const tasks=(source.stores||[]).map(t=>{
            const counts=diagnosisCounts(t),examples={};
            for(const [sku,outcome] of Object.entries(t.diagnosticDecisions||{}))if(/^\d{1,24}$/.test(sku)&&diagnosticOutcomes.has(outcome)){const list=examples[outcome]||=[];if(list.length<5)list.push(sku);}
            return {key:t.sellerKey,status:t.status,pagePriceStatus:t.pagePriceStatus||null,removedFromQueue:t.removedFromQueue===true,counts,examples,observedCount:t.observedCount||0,discoveredCount:t.discoveredCount??null,erpReadyCount:t.erpReadyCount??null,labelHitCount:t.labelHitCount??null,pendingCount:t.pendingCount||0,qualifiedCount:t.qualifiedCount||0,waitReason:waitLabels[t.waitReason]||null,lastDiscoveryAt:t.lastDiscoveryAt||null,lastErpReadyAt:t.lastErpReadyAt||null,lastLabelHitAt:t.lastLabelHitAt||null,lastAcceptedAt:t.lastAcceptedAt||null,unknownDiscoveredCount:counts.unknown||0};
          });
          const browser=source===batch&&source.status==='running'?await browserSnapshot(source):source.diagnosticBrowser||null;
          const totals={};for(const task of tasks)for(const [key,count] of Object.entries(task.counts))totals[key]=(totals[key]||0)+count;
          return {ok:true,diagnostic:{schemaVersion:1,version:'1.50',extensionVersion:chrome.runtime?.getManifest?.().version||'0.6.69',generatedAt:now(),batchId:source.id,status:source.status,currentIndex:source.currentIndex,options:{targetCount:source.options?.targetCount,minPrice:source.options?.minPrice,maxPrice:source.options?.maxPrice,...core.rubRange(source.options)},experimentEnabled:source.backgroundExperiment===true,activityStatus:source.activityStatus||null,pageMode:source.pageMode||null,recentWaitReason:source.recentWaitReason||null,counters:{storeCount:tasks.length,observedCount:tasks.reduce((n,t)=>n+t.observedCount,0),discoveredCount:tasks.reduce((n,t)=>n+(t.discoveredCount||0),0),erpReadyCount:tasks.reduce((n,t)=>n+(t.erpReadyCount||0),0),labelHitCount:tasks.reduce((n,t)=>n+(t.labelHitCount||0),0),acceptedCount:(source.qualifiedSkuIds||[]).length,unknownLegacyCount:totals.unknown||0,decisions:totals},lastProgressAt:source.lastProgressAt||null,lastNewSkuAt:source.lastNewSkuAt||null,lastDiscoveryAt:source.lastDiscoveryAt||null,lastErpReadyAt:source.lastErpReadyAt||null,lastLabelHitAt:source.lastLabelHitAt||null,lastAcceptedAt:source.lastAcceptedAt||null,tasks,browser,events:(source.diagnosticEvents||[]).slice(-120)}};
        }
        case "categoryDeleteBatch": {
          const id=String(m.batchId||"");
          if(!id)throw Error("请选择要删除的类目历史批次");
          if(batch?.id===id){
            if(["running","paused"].includes(batch.status))throw Error("运行中或暂停中的类目批次不能删除，请先结束任务");
            if(!finished(batch))throw Error("只能删除已结束的类目批次");
            await stopScanner(batch);await chrome.storage.local.remove(KEY);batch=null;
          }else{
            const archived=await snapshotHistory(),target=archived.find(x=>x.id===id);
            if(!target)throw Error("找不到要删除的类目历史批次");
            if(["running","paused"].includes(target.status))throw Error("运行中或暂停中的类目批次不能删除");
            if(!finished(target))throw Error("只能删除已结束的类目批次");
            await chrome.storage.local.set({[HISTORY_KEY]:archived.filter(x=>x.id!==id)});
          }
          return {ok:true,batch:clone(batch),history:(await snapshotHistory()).map(historySummary),deletedCount:1,message:"已删除所选本机类目批次；商品池、SKU 历史和工作台云端数据未改动。"};
        }
        case "categoryCleanupEmpty": {
          const archived=await snapshotHistory(),kept=archived.filter(x=>!emptyFinished(x));
          const deletedHistory=archived.length-kept.length;
          if(deletedHistory!==0)await chrome.storage.local.set({[HISTORY_KEY]:kept});
          let deletedCurrent=0;
          if(emptyFinished(batch)){await stopScanner(batch);await chrome.storage.local.remove(KEY);batch=null;deletedCurrent=1;}
          const deletedCount=deletedHistory+deletedCurrent;
          return {ok:true,batch:clone(batch),history:kept.map(historySummary),deletedCount,message:deletedCount?`已清理 ${deletedCount} 个已结束的 0 候选批次；商品池、SKU 历史和工作台云端数据未改动。`:"没有可清理的已结束 0 候选批次。"};
        }
        default: return null;
      }
    });
  }
  async function onUpdated(tabId, info, tab) {
    return queue(async () => {
      const batch = await read();
      if (!batch || batch.tabId !== tabId) return;
      if (info?.url) await releaseFocusExperiment(tabId);
      if (batch.status !== "running") return;
      if (info?.status !== "complete") return;
      const task = currentStore(batch);
      if (!task || !pageMatches(tab?.url || "", task)) { diagnosticEvent(batch,'tab_left_task');batch.status = "paused"; batch.message = navigationMismatch(batch,task); await stopScanner(batch); await save(batch); return; }
      try {
        await protectTab(tabId);
        await enableFocusExperiment(batch);
        await startScanner(batch,task);
      } catch { await waitStatus(batch,'页面读取器暂未响应，正在等待自动恢复。'); }
    });
  }
  async function onRemoved(tabId) {
    return queue(async () => { const batch = await read(); if (!batch || batch.tabId !== tabId) return; await releaseFocusExperiment(tabId);await releaseTab(tabId);if(batch.status !== "running")return;diagnosticEvent(batch,'tab_closed');batch.status = "paused"; batch.tabId = null; batch.message = "类目任务标签页已关闭，已暂停"; await save(batch); });
  }
  chrome.debugger?.onDetach?.addListener?.((source) => {
    if (source?.tabId !== experimentDebuggerTabId) return;
    experimentDebuggerTabId=null;
    void queue(async()=>{const batch=await read();if(!batch||batch.tabId!==source.tabId)return;diagnosticEvent(batch,'detach','焦点模拟已分离');batch.activityStatus='focus-emulation-detached';batch.backgroundExperiment=false;if(batch.status==='running'){await stopScanner(batch);batch.status='paused';batch.message='实验性焦点模拟已被分离，进度已保存并暂停';}await save(batch);});
  });
  async function onRestart() {
    return queue(async () => { const batch = await read(); if (!batch || batch.status !== "running") return; diagnosticEvent(batch,'browser_restart');batch.status = "paused"; batch.message = "浏览器重启后任务已暂停，请人工检查后继续"; await save(batch); });
  }
  async function onAlarm(alarm) {
    if(alarm?.name!==ALARM)return;
    await queue(async()=>{
      const b=await read();if(b?.status!=='running')return;
      const task=currentStore(b);let tab;
      try{tab=await chrome.tabs.get(b.tabId)}catch{await releaseTab(b.tabId);diagnosticEvent(b,'tab_closed');b.tabId=null;b.status='paused';b.message='类目任务标签页已关闭，已暂停';await save(b);return}
      if(!task||(!pageMatches(tab.url,task)&&!(tab.status==='loading'&&pageMatches(tab.pendingUrl,task)))){diagnosticEvent(b,'tab_left_task',tab.discarded?'原任务标签已丢弃':tab.frozen?'原任务标签已冻结':'无法核对任务地址');b.status='paused';b.message=navigationMismatch(b,task);await stopScanner(b);await save(b);return}
      // Browser lifecycle restrictions are not site verification. Do not reload,
      // activate, or change tabs to bypass browser/site restrictions.
      b.diagnosticBrowser=await browserSnapshot(b);
      if(tab.frozen||tab.discarded||tab.status==='loading'){if(tab.frozen||tab.discarded)diagnosticEvent(b,tab.discarded?'tab_discarded':'watchdog_frozen',tab.status||'');await save(b);await waitStatus(b,tab.frozen||tab.discarded?'浏览器暂缓后台页面执行，已保留进度，页面可用后自动检查。':'等待类目页面加载');return}
      const since=Math.max(Date.parse(b.lastProgressAt)||0,Date.parse(b.watchdogSince)||0);
      if(since&&Date.now()-since<STALE_MS){await save(b);return;}
      await protectTab(b.tabId);
      let ack;
      try{ack=await bounded(chrome.tabs.sendMessage(b.tabId,{type:'categoryScanTick',batchId:b.id,attemptId:b.attemptId,pageNativeHidden:b.backgroundExperiment?await nativePageHidden(b.tabId):false}))}catch{ack={missing:true}}
      if(ack===null){
        b.noResponseCount=(Number(b.noResponseCount)||0)+1;
        if(b.diagnosticEvents?.at(-1)?.type!=='watchdog_no_response')diagnosticEvent(b,'watchdog_no_response');
        if(b.noResponseCount>=RECOVERY_LIMIT){
          if(await recoverCrashedTab(b,task,tab,'后台持续无响应自动重建'))return;
        }
        await save(b);await waitStatus(b,'后台页面暂未响应，已保留进度并等待恢复。');return;
      }
      b.noResponseCount=0;
      if(ack?.ok&&ack.running===true){b.diagnosticBrowser=await browserSnapshot(b,ack.pageReportedHidden,ack.pageFocused);await save(b);await waitStatus(b,ack.pageHidden?'后台页面加载较慢，正在等待并检查采集进度。':'等待采集页面上报进度。');return}
      if((Number(b.recoveryAttempts)||0)>=RECOVERY_LIMIT){if(b.diagnosticEvents?.at(-1)?.type!=='watchdog_reader_unavailable')diagnosticEvent(b,'watchdog_reader_unavailable');await save(b);await waitStatus(b,'页面读取器暂未恢复，已保留进度；请检查采集页面。');return}
      delete task.waitSince;
      b.recoveryAttempts=(Number(b.recoveryAttempts)||0)+1;b.attemptId=uuid();b.watchdogSince=now();diagnosticEvent(b,'watchdog_recover',`尝试 ${b.recoveryAttempts}`);phase(b,'recovering','正在从已保存进度恢复同一类目页面。');await save(b);
      try{await startScanner(b,task)}
      catch{
        if((Number(b.recoveryAttempts)||0)>=RECOVERY_LIMIT && await recoverCrashedTab(b,task,tab,'注入失败自动重建'))return;
        await waitStatus(b,'页面读取器暂未响应，正在等待自动恢复。');
      }
    });
  }
  scope.OzonCategoryBackground = Object.freeze({ handle, onUpdated, onRemoved, onAlarm, onRestart, snapshot, snapshotHistory });
})(globalThis);
