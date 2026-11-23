(function installOzonCategoryBackground(scope) {
  "use strict";
  const KEY = "ozonCategoryBatchV1";
  const HISTORY_KEY = "ozonCategoryBatchHistoryV1";
  const HISTORY_LIMIT = 5;
  const core = scope.OzonCategoryCore;
  const scanner = scope.OzonStoreScannerCore;
  const storeCore = scope.OzonProductPoolCore;
  let serial = Promise.resolve();
  const queue = (fn) => { const p = serial.then(fn, fn); serial = p.catch(() => null); return p; };
  const now = () => new Date().toISOString();
  const uuid = () => scope.crypto.randomUUID();
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  async function read() { return (await chrome.storage.local.get(KEY))[KEY] || null; }
  async function save(batch) { batch.updatedAt = now(); await chrome.storage.local.set({ [KEY]: batch });if(batch.status==='running')await chrome.alarms?.create?.('ozon-category-runner',{periodInMinutes:1});else await chrome.alarms?.clear?.('ozon-category-runner');return batch; }
  function currentStore(batch) { return batch?.stores?.[batch.currentIndex] || null; }
  function pageUrl(task) { return task?.pageUrl || task?.url || ""; }
  function pageMatches(actual, task) {
    return !!task && core.samePage(actual || "", task.url) && core.exactPageUrl(actual)===pageUrl(task);
  }
  const sourceKind=url=>core.keyFromUrl(url).startsWith('china-category:')?'china':'normal';
  function qualifiedTotal(batch) { return (batch.qualifiedSkuIds || []).length; }
  function finishAtTarget(batch) {
    if (qualifiedTotal(batch) < batch.options.targetCount) return false;
    batch.status = "completed"; batch.message = "已达到批次目标有效商品数";
    for (const task of batch.stores) if (task.status === "pending" || task.status === "scanning") {
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
    if (!batch.attemptId || batch.attemptId !== m.attemptId) throw Error("类目扫描尝试已失效");
    if (!batch.tabId || sender?.tab?.id !== batch.tabId) throw Error(`消息来自非类目任务标签页 (${sender?.tab?.id ?? "missing"}/${batch.tabId ?? "missing"})`);
    const task = currentStore(batch);
    if (!task || !pageMatches(m.categoryUrl, task)) throw Error("类目页面与当前任务不匹配");
    if (requirePage && !pageMatches(sender?.tab?.url || "", task)) throw Error("标签页当前页面不属于此类目任务");
    return task;
  }
  async function stopScanner(batch) {
    if (batch?.tabId) await chrome.tabs.sendMessage(batch.tabId, { type: "categoryScanStop", batchId: batch.id, attemptId: batch.attemptId }).catch(() => null);
  }
  async function startScanner(batch,task){
    await chrome.scripting.executeScript({target:{tabId:batch.tabId},files:['store-scanner-core.js','category-core.js','category-scanner.js']});
    const ack=await chrome.tabs.sendMessage(batch.tabId,{type:'categoryScanStart',batchId:batch.id,attemptId:batch.attemptId,categoryUrl:pageUrl(task),options:batch.options,observedSkus:task.observedSkus||[],pendingSkus:task.pendingSkus||[],recheckFromTop:!!task.pendingCount&&!task.pendingSkus?.length});
    if(!ack?.ok)throw Error('扫描器未确认启动');
  }
  async function openCurrent(batch, create = false) {
    const task = currentStore(batch);
    if (!task) return;
    batch.lastProgressAt=now();
    if (batch.tabId && !create) {
      try {
        const existing = await chrome.tabs.get(batch.tabId);
        if (pageMatches(existing?.url, task)) {
          batch.attemptId = uuid(); await save(batch);
          if(existing.status!=='loading'){
            try{await startScanner(batch,task)}catch{batch.status='paused';batch.message='当前页面读取器未确认启动，检查页面后继续';await save(batch)}
          }
          return;
        }
      } catch { batch.tabId = null; }
      // Do not navigate away from a login/verification screen or another page
      // on behalf of the user. Resume only after the original page is ready.
      if(batch.tabId){batch.status='paused';batch.message='当前标签页已离开本批类目，请完成页面检查并返回原类目后继续';await save(batch);return;}
    }
    batch.attemptId = uuid();batch.lastProgressAt=now();
    if (!batch.tabId || create) {
      const tab = await chrome.tabs.create({ url: pageUrl(task), active: false });
      batch.tabId = tab.id;
    } else await chrome.tabs.update(batch.tabId, { url: pageUrl(task) });
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
          const options = core.validateOptions({ targetCount: m.targetCount, minPrice: m.minPrice, maxPrice: m.maxPrice });
          if (batch) {
            const archived = await snapshotHistory();
            if (archived.length >= HISTORY_LIMIT && !m.confirmArchiveOverflow) throw Error("类目历史已满，请先导出或入池，再明确确认轮换最旧批次");
            archived.unshift(clone(batch));
            await chrome.storage.local.set({ [HISTORY_KEY]: archived.slice(0,HISTORY_LIMIT) });
          }
          const id = `category-${uuid()}`;
          const stores = urls.map((url, i) => {const kind=sourceKind(url),label=m.categoryLabels&&Object.hasOwn(m.categoryLabels,url)&&typeof m.categoryLabels[url]==='string'?m.categoryLabels[url].trim().slice(0,120):'';return { sellerKey: core.keyFromUrl(url), url, pageUrl: url, sourceKind:kind, ...(label?{label,name:(kind==='china'?'中国专区 · ':'普通类目 · ')+label}:{}), status: i === 0 ? "scanning" : "pending", observedCount: 0, qualifiedCount: 0, pendingCount: 0, observedSkus: [], visitedPages: [] }});
          batch = { id, sourceMode: "category", status: "running", currentIndex: 0, tabId: null, attemptId: null, options, stores, results: {}, updatedAt: now(), message: "类目扫描已开始", addedCount: 0 };
          await openCurrent(batch, true);
          return { ok: true, batch: clone(batch) };
        }
        case "categoryPause":
        case "categoryStop": {
          if (!batch) return { ok: true, batch: null };
          await stopScanner(batch);
          batch.status = m.type === "categoryStop" ? "stopped" : "paused";
          batch.message = m.type === "categoryStop" ? "已停止" : "已暂停";
          await save(batch); return { ok: true, batch: clone(batch) };
        }
        case "categoryResume":
          if (!batch || batch.status !== "paused") throw Error("没有可继续的暂停类目批次");
          if (currentStore(batch)) {currentStore(batch).status = "scanning";delete currentStore(batch).note;}
          batch.status = "running"; batch.message = "继续扫描"; await openCurrent(batch); return { ok: true, batch: clone(batch) };
        case "categorySample": {
          const task = assertActive(batch, m, sender);
          if (batch.status !== "running") throw Error("类目批次当前未运行");
          const observed = new Set(task.observedSkus || []);
          for (const sku of m.observedSkus || []) if (/^\d+$/.test(String(sku))) observed.add(String(sku));
          task.observedSkus = [...observed]; task.observedCount = observed.size;
          task.pendingCount = Math.max(0, Number(m.pendingCount) || 0);
          if(Array.isArray(m.pendingSkus))task.pendingSkus=[...new Set(m.pendingSkus.map(String).filter(s=>/^\d+$/.test(s)&&!observed.has(s)))];
          batch.lastProgressAt=now();batch.message='正在扫描类目商品';
          const poolStored = await chrome.storage.local.get("ozonProductPoolV1");
          const pool = poolStored.ozonProductPoolV1 || storeCore.emptyPool();
          const qualifiedSeen = new Set(batch.qualifiedSkuIds || []);
          const remaining = Math.max(0, batch.options.targetCount - qualifiedSeen.size);
          const products = [];
          for (const raw of m.products || []) {
            if (products.length >= remaining) break;
            const product = normalizeSampleProduct(raw, batch);
            if (!product || qualifiedSeen.has(product.sku) || pool.products?.[product.sku] || Object.hasOwn(pool.history || {}, product.sku)) continue;
            qualifiedSeen.add(product.sku); products.push(product);
          }
          const title=typeof m.categoryName==='string'?m.categoryName.trim().slice(0,120):'';
          const kind=task.sourceKind||sourceKind(task.url), name=task.label||title||core.keyFromUrl(task.url);
          if(!task.label)task.name=(kind==='china'?'中国专区 · ':'普通类目 · ')+name;
          const output = batch.results[task.sellerKey] ||= { storeName: `类目 · ${kind==='china'?'中国专区 · ':''}${name}`, storeUrl: task.url, products: {}, batchCapture: { batchId: batch.id, skus: [] } };
          for (const p of products) if (!output.products[p.sku]) { output.products[p.sku] = p; output.batchCapture.skus.push(p.sku); }
          batch.qualifiedSkuIds = [...qualifiedSeen];
          task.qualifiedCount = Object.keys(output.products).length;
          task.observedSkus = [...new Set([...task.observedSkus, ...Object.keys(output.products)])];
          const stop = finishAtTarget(batch);
          if (stop) await stopScanner(batch);
          await save(batch); return { ok: true, stop, batch: clone(batch) };
        }
        case "categoryWait": {
          assertActive(batch,m,sender);if(batch.status!=='running')throw Error('类目批次当前未运行');
          batch.message=m.reason==='review_pending'?'自动复查未加载完整的商品…':'商品列表加载中，正在自动等待并重试…';
          batch.lastProgressAt=now();await save(batch);return {ok:true};
        }
        case "categoryPageDone": {
          const task = assertActive(batch, m, sender);
          if (batch.status !== "running") throw Error("类目批次当前未运行");
          const nextUrl = m.reason === "next_page_available" && m.nextUrl && core.paginationUrl?.(m.nextUrl, task.url);
          if (nextUrl && Number(new URL(nextUrl).searchParams.get('page'))===Number(new URL(pageUrl(task)).searchParams.get('page')||1)+1 && nextUrl!==pageUrl(task)&&!task.visitedPages.includes(nextUrl)) {
            task.visitedPages.push(pageUrl(task)); task.pageUrl = nextUrl;task.pendingCount=0;task.pendingSkus=[]; batch.message = "继续扫描下一页"; await stopScanner(batch); batch.attemptId=uuid();batch.lastProgressAt=now();await save(batch);await chrome.tabs.update(batch.tabId,{url:nextUrl});return { ok: true, batch: clone(batch) };
          }
          await stopScanner(batch);
          if (m.complete === true && m.reason === "visible_catalog_end") {
            task.status = "completed"; batch.message = "当前类目已完成";
            batch.currentIndex++;
            if (currentStore(batch)) { currentStore(batch).status = "scanning";batch.attemptId=uuid();batch.lastProgressAt=now();await save(batch);await chrome.tabs.update(batch.tabId,{url:pageUrl(currentStore(batch))}); } else batch.status = "completed";
          } else { task.status = "partial";batch.status = "paused";const verificationWhy={http_denied:'检测到站点访问受限（HTTP 状态提示），需人工检查',access_restricted:'检测到站点访问受限，需人工检查',security_prompt:'检测到站点安全验证，需人工完成'};
            const why=(m.reason==='manual-verification'&&Object.hasOwn(verificationWhy,m.verificationDetail)?verificationWhy[m.verificationDetail]:null)||{"manual-verification":"需人工完成站点验证或登录","catalog_list_unavailable":"未识别唯一主商品列表","scan_bound_reached":"达到单页扫描上限（非完成）","pending_cards":"仍有商品字段待复查","reader_error":"页面读取失败","sample_not_persisted":"未确认数据已保存"}[m.reason]||"未确认扫描完成";task.note=why;batch.message=why+"，已暂停，检查页面后可继续。"; }
          await save(batch); return { ok: true, batch: clone(batch) };
        }
        case "categoryAddPool": {
          const selectedId = m.batchId || batch?.id;
          const source = batch?.id === selectedId ? batch : (await snapshotHistory()).find(x => x.id === selectedId);
          if (!source) throw Error("找不到要加入商品池的类目批次");
          if (typeof scope.changeProductPool !== "function") throw Error("商品池安全写入接口不可用");
          const result = await scope.changeProductPool(pool => storeCore.addBatch(pool, { batch: source, stores: source.results }));
          source.addedCount = result.added;
          if (source === batch) await save(batch);
          else { const archived = await snapshotHistory(); const index = archived.findIndex(x => x.id === source.id); if (index >= 0) { archived[index] = source; await chrome.storage.local.set({ [HISTORY_KEY]: archived }); } }
          return { ok: true, added: result.added, duplicates: result.duplicates, historySkipped: result.historySkipped, riskSkipped: result.riskSkipped, batch: clone(batch) };
        }
        case "categoryExport": {
          const id=m.batchId||batch?.id,source=batch?.id===id?batch:(await snapshotHistory()).find(x=>x.id===id);
          if(!source)throw Error('找不到类目批次');return {ok:true,csv:scanner.buildManualSourcingCsv({batch:source,stores:source.results||{}})};
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
      if (!batch || batch.tabId !== tabId || batch.status !== "running") return;
      if (info?.status !== "complete") return;
      const task = currentStore(batch);
      if (!task || !pageMatches(tab?.url || "", task)) { batch.status = "paused"; batch.message = "任务标签页导航离开类目范围，已暂停"; await stopScanner(batch); await save(batch); return; }
      try {
        await startScanner(batch,task);
      } catch { batch.status = "paused"; batch.message = "类目扫描页面不可用，已暂停供检查"; await save(batch); }
    });
  }
  async function onRemoved(tabId) {
    return queue(async () => { const batch = await read(); if (!batch || batch.tabId !== tabId || batch.status !== "running") return; batch.status = "paused"; batch.tabId = null; batch.message = "类目任务标签页已关闭，已暂停"; await save(batch); });
  }
  async function onRestart() {
    return queue(async () => { const batch = await read(); if (!batch || batch.status !== "running") return; batch.status = "paused"; batch.message = "浏览器重启后任务已暂停，请人工检查后继续"; await save(batch); });
  }
  async function onAlarm(alarm) { if (alarm?.name !== "ozon-category-runner") return;await queue(async()=>{const b=await read();if(b?.status==='running'&&Date.now()-Date.parse(b.lastProgressAt||b.updatedAt)>120000){await stopScanner(b);b.status='paused';b.message='超过 2 分钟没有确认采集进度，已暂停，请检查页面后继续。';await save(b)}}); }
  scope.OzonCategoryBackground = Object.freeze({ handle, onUpdated, onRemoved, onAlarm, onRestart, snapshot, snapshotHistory });
})(globalThis);
