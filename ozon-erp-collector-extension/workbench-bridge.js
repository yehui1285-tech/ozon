// Explicit narrow-scope Ozon workbench connection. Never sends cookies or page contents.
const WB_ORIGIN='https://deep-breath-design-desk.yehui1285.chatgpt.site',WB_API=WB_ORIGIN+'/api/ozon/collector',WB_SETTINGS='ozonWorkbenchSettingsV1',WB_PENDING='ozonWorkbenchPendingDetailV1',WB_ALARM='ozonWorkbenchSyncV1',WB_BATCH_BACKLOG='ozonWorkbenchBatchBacklogV1',WB_CLOUD_SKUS='ozonWorkbenchCloudSkusV1',WB_TASKS_SYNC='ozonWorkbenchCategoryTasksSyncV1';
const WB_SKU_THROTTLE_MS=15000;
let wbCloudCache={loaded:false,revision:null,poolSet:new Set(),historySet:new Set(),poolCount:0,historyCount:0,truncated:false,syncedAt:'',error:''},wbCloudLoading=null,wbCloudRefreshing=null,wbTasksSyncing=null,wbLastRefreshAt=0;
async function wbSettings(){return (await chrome.storage.local.get(WB_SETTINGS))[WB_SETTINGS]||{token:'',auto:true}}
async function wbRequest(token,body){if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('请先在插件弹窗连接工作台');const res=await fetch(WB_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(25000)});const data=await res.json().catch(()=>({}));if(!res.ok||!data.ok)throw Error(data.error||'工作台连接失败（'+res.status+'）');return data}
async function wbEnsureCloudLoaded(){
 if(wbCloudCache.loaded)return wbCloudCache;
 if(!wbCloudLoading)wbCloudLoading=(async()=>{
  const stored=(await chrome.storage.local.get(WB_CLOUD_SKUS))[WB_CLOUD_SKUS];
  if(stored&&typeof stored==='object'){
   const poolSet=new Set((Array.isArray(stored.poolSkus)?stored.poolSkus:[]).map(String).filter(s=>/^\d+$/.test(s)));
   const historySet=new Set((Array.isArray(stored.historySkus)?stored.historySkus:[]).map(String).filter(s=>/^\d+$/.test(s)));
   wbCloudCache={loaded:true,revision:Number.isSafeInteger(stored.revision)?stored.revision:null,poolSet,historySet,poolCount:poolSet.size,historyCount:historySet.size,truncated:Boolean(stored.truncated),syncedAt:String(stored.syncedAt||''),error:''};
  }else{wbCloudCache.loaded=true;}
 })().finally(()=>{wbCloudLoading=null;});
 await wbCloudLoading;
 return wbCloudCache;
}
async function wbRefreshCloudSkus(force=false){
 if(wbCloudRefreshing)return wbCloudRefreshing;
 wbCloudRefreshing=(async()=>{
  await wbEnsureCloudLoaded();
  const settings=await wbSettings();
  if(!settings.token)return {ok:true,connected:false,skipped:true};
  if(!force&&wbLastRefreshAt&&Date.now()-wbLastRefreshAt<WB_SKU_THROTTLE_MS){
   return {ok:true,connected:true,cached:true,revision:wbCloudCache.revision,poolCount:wbCloudCache.poolCount,historyCount:wbCloudCache.historyCount};
  }
  wbLastRefreshAt=Date.now();
  try{
   const body={action:'poolSkus',...( !force && Number.isSafeInteger(wbCloudCache.revision) ? {sinceRevision:wbCloudCache.revision} : {} )};
   const data=await wbRequest(settings.token,body);
   const stamp=new Date().toISOString();
   if(!data.unchanged){
    const poolSkus=(Array.isArray(data.poolSkus)?data.poolSkus:[]).map(String).filter(s=>/^\d+$/.test(s));
    const historySkus=(Array.isArray(data.historySkus)?data.historySkus:[]).map(String).filter(s=>/^\d+$/.test(s));
    const poolSet=new Set(poolSkus),historySet=new Set(historySkus);
    const rev=Number.isSafeInteger(data.revision)?data.revision:0;
    wbCloudCache={loaded:true,revision:rev,poolSet,historySet,poolCount:poolSet.size,historyCount:historySet.size,truncated:Boolean(data.truncated),syncedAt:stamp,error:''};
    await chrome.storage.local.set({[WB_CLOUD_SKUS]:{revision:rev,poolSkus,historySkus,truncated:Boolean(data.truncated),syncedAt:stamp}});
   }else{
    wbCloudCache.syncedAt=stamp;wbCloudCache.error='';
   }
   return {ok:true,connected:true,unchanged:Boolean(data.unchanged),revision:wbCloudCache.revision,poolCount:wbCloudCache.poolCount,historyCount:wbCloudCache.historyCount,syncedAt:stamp};
  }catch(e){
   wbCloudCache.error=e.message;
   if(force)throw e;
   return {ok:false,connected:true,error:e.message};
  }
 })();
 try{return await wbCloudRefreshing}finally{wbCloudRefreshing=null}
}
async function wbLookupCloudSkus(skus){
 await wbEnsureCloudLoaded();
 const products={},history={};
 for(const raw of Array.isArray(skus)?skus:[]){
  const sku=String(raw??'').trim();
  if(!/^\d+$/.test(sku))continue;
  if(wbCloudCache.poolSet.has(sku))products[sku]=true;
  if(wbCloudCache.historySet.has(sku))history[sku]=true;
 }
 return {products,history};
}
async function wbSyncCategoryTasks(manual=false){
 if(wbTasksSyncing)return wbTasksSyncing;
 wbTasksSyncing=(async()=>{
  const settings=await wbSettings();
  if(!settings.token){if(manual)throw Error('请先在插件弹窗连接工作台');return {ok:true,skipped:true};}
  if(!manual&&settings.auto===false)return {ok:true,skipped:true};
  if(!globalThis.OzonCategoryBackground?.exportTasksState||!globalThis.OzonCategoryBackground?.applyMergedTasksState)return {ok:true,skipped:true};
  const local=await globalThis.OzonCategoryBackground.exportTasksState();
  const data=await wbRequest(settings.token,{action:'categoryTasksSync',payload:{tasks:local.tasks||[],deletedTasks:local.deletedTasks||{}}});
  await globalThis.OzonCategoryBackground.applyMergedTasksState({tasks:data.tasks||[],deletedTasks:data.deletedTasks||{}});
  const stamp=new Date().toISOString();
  await chrome.storage.local.set({[WB_TASKS_SYNC]:{syncedAt:stamp,updatedAt:data.updatedAt||stamp,taskCount:(data.tasks||[]).length,error:''}});
  return {ok:true,taskCount:(data.tasks||[]).length,syncedAt:stamp,changed:Boolean(data.changed)};
 })().catch(async e=>{
  const prev=(await chrome.storage.local.get(WB_TASKS_SYNC))[WB_TASKS_SYNC]||{};
  await chrome.storage.local.set({[WB_TASKS_SYNC]:{...prev,error:e.message}}).catch(()=>null);
  if(manual)throw e;
  return {ok:false,error:e.message};
 }).finally(()=>{wbTasksSyncing=null;});
 return wbTasksSyncing;
}
async function wbCloudSyncStatus(){
 await wbEnsureCloudLoaded();
 const settings=await wbSettings();
 const taskSync=(await chrome.storage.local.get(WB_TASKS_SYNC))[WB_TASKS_SYNC]||{};
 return {connected:Boolean(settings.token),poolCount:wbCloudCache.poolCount,historyCount:wbCloudCache.historyCount,revision:wbCloudCache.revision,truncated:wbCloudCache.truncated,skusSyncedAt:wbCloudCache.syncedAt||'',taskCount:Number(taskSync.taskCount)||0,tasksSyncedAt:String(taskSync.syncedAt||''),error:wbCloudCache.error||String(taskSync.error||'')};
}
async function wbConnect(message){const old=await wbSettings();const token=String(message.token||'').trim().toLowerCase();await wbRequest(token,{action:'ping'});await chrome.storage.local.set({[WB_SETTINGS]:{...old,token,auto:message.auto!==false}});await chrome.alarms.create(WB_ALARM,{periodInMinutes:1});void wbRefreshCloudSkus(true).catch(()=>null);void wbSyncCategoryTasks(false).catch(()=>null);return {ok:true,connected:true}}
async function wbDisconnect(){await chrome.storage.local.remove([WB_SETTINGS,WB_CLOUD_SKUS,WB_TASKS_SYNC]);wbCloudCache={loaded:true,revision:null,poolSet:new Set(),historySet:new Set(),poolCount:0,historyCount:0,truncated:false,syncedAt:'',error:''};wbLastRefreshAt=0;await chrome.alarms.clear(WB_ALARM);return {ok:true}}
globalThis.OzonWorkbenchCloud=Object.freeze({refreshCloudSkus:wbRefreshCloudSkus,lookupCloudSkus:wbLookupCloudSkus,syncCategoryTasks:wbSyncCategoryTasks,status:wbCloudSyncStatus});
async function wbStatus(){const settings=await wbSettings(),sync=(await chrome.storage.local.get('ozonWorkbenchLastSync'))['ozonWorkbenchLastSync'];return {ok:true,connected:!!settings.token,auto:settings.auto!==false,sync}}
async function wbAuto(enabled){const s=await wbSettings();if(!s.token)throw Error('请先连接工作台');await chrome.storage.local.set({[WB_SETTINGS]:{...s,auto:!!enabled}});return {ok:true}}
const wbDetailQueue=globalThis.OzonStoreScannerCore.createSerializedExecutor();
async function wbDigest(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('')}
function wbProduct(p){const out={sku:String(p.sku||''),link:String(p.link||'')};for(const k of ['greenPrice','blackPrice','commission','freight','lengthCm','widthCm','heightCm','weightKg'])out[k]=Number(p[k])||0;return out}
function wbNotifyOpenPages(sku){
 const targetSku=String(sku||'');
 try{
  chrome.tabs?.query?.({url:[WB_ORIGIN+'/ozon/pool*',WB_ORIGIN+'/ozon',WB_ORIGIN+'/ozon?*']},tabs=>{
   if(chrome.runtime?.lastError||!Array.isArray(tabs))return;
   for(const tab of tabs){
    if(!tab?.id||!chrome.scripting?.executeScript)continue;
    chrome.scripting.executeScript({
     target:{tabId:tab.id},
     func:s=>{window.dispatchEvent(new CustomEvent('ozon-pricing-pushed',{detail:{sku:s}}));},
     args:[targetSku],
    }).catch?.(()=>{});
   }
  });
 }catch{}
}
async function wbSendDetail(product,dest,requestId){if(!['workbench','original','both'].includes(dest))dest='workbench';if(dest==='original'){await sendToPricing(product);return {ok:true,destinations:['原核价表']}}
 return wbDetailQueue(async()=>{const settings=await wbSettings(),p=wbProduct(product);const fingerprint=await wbDigest(JSON.stringify([dest,p]));let map=(await chrome.storage.local.get(WB_PENDING))[WB_PENDING]||{};let pending=map[fingerprint]||{id:requestId||crypto.randomUUID(),wb:false,old:false,at:Date.now()};map[fingerprint]=pending;await chrome.storage.local.set({[WB_PENDING]:map});
 try{if(!pending.wb){await wbRequest(settings.token,{action:'detail',id:pending.id,product:p});pending.wb=true;wbNotifyOpenPages(p.sku);await chrome.storage.local.set({[WB_PENDING]:map})}if(dest==='both'&&!pending.old){await sendToPricing(product);pending.old=true;await chrome.storage.local.set({[WB_PENDING]:map})}delete map[fingerprint];await chrome.storage.local.set({[WB_PENDING]:map});return {ok:true,destinations:dest==='both'?['工作台','原核价表']:['工作台']}}catch(e){return {ok:false,error:(pending.wb?'工作台已保存；原核价表未确认，再点发送只重试未完成目标。':'工作台未确认保存，请重试（不会重复添加已接收记录）。')+' '+e.message,partial:pending.wb}}})
}
async function wbSnapshot(batch){if(!batch?.stores?.length)return null;const {stores}=await getBatchStoreResults({sellerKeys:batch.stores.map(t=>t.sellerKey)});const csv=storeScannerCore.buildManualSourcingCsv({batch,stores});return {id:batch.id,capturedAt:Date.now(),status:batch.status,storeCount:batch.stores.length,completedCount:batch.stores.filter(t=>['completed','partial','failed','skipped'].includes(t.status)).length,observed:batch.stores.reduce((s,t)=>s+(Number(t.observedCount)||0),0),csv}}
async function wbArchiveBeforeReset(batch){const settings=await wbSettings();if(!settings.token||!batch)return;const snap=await wbSnapshot(batch);if(!snap)return;if(["running","paused"].includes(snap.status))snap.status="stopped";const backlog=(await chrome.storage.local.get(WB_BATCH_BACKLOG))[WB_BATCH_BACKLOG]||{};backlog[snap.id]=snap;await chrome.storage.local.set({[WB_BATCH_BACKLOG]:backlog})}
let wbSyncRunning=null;
async function wbSyncBatch(manual=false){if(wbSyncRunning)return wbSyncRunning;wbSyncRunning=(async()=>{const settings=await wbSettings();if(!settings.token){if(manual)throw Error('请先在插件弹窗连接工作台');return {ok:true,skipped:true}}if(!manual&&settings.auto===false)return {ok:true,skipped:true};
 try{const backlog=(await chrome.storage.local.get(WB_BATCH_BACKLOG))[WB_BATCH_BACKLOG]||{};for(const snap of Object.values(backlog)){await wbRequest(settings.token,{action:'batch',batch:snap});const latest=(await chrome.storage.local.get(WB_BATCH_BACKLOG))[WB_BATCH_BACKLOG]||{};if(latest[snap.id]?.capturedAt===snap.capturedAt){delete latest[snap.id];await chrome.storage.local.set({[WB_BATCH_BACKLOG]:latest})}}
 const snap=await batchOperation(async()=>wbSnapshot(await getBatch()));if(!snap)return {ok:true,count:0};const data=await wbRequest(settings.token,{action:'batch',batch:snap});await chrome.storage.local.set({ozonWorkbenchLastSync:{ok:true,id:snap.id,count:data.count,at:new Date().toISOString()}});return data}catch(e){await chrome.storage.local.set({ozonWorkbenchLastSync:{ok:false,error:e.message,at:new Date().toISOString()}});if(manual)throw e;return {ok:false,error:e.message}}
 })();try{return await wbSyncRunning}finally{wbSyncRunning=null}}
function wbSchedule(){chrome.alarms.create(WB_ALARM,{periodInMinutes:1})?.catch?.(()=>{})}

// Independent category batches use the same authenticated append-only batch endpoint.
let wbCategorySyncRunning=null;
async function wbSyncCategory(manual=false){
 if(wbCategorySyncRunning)return wbCategorySyncRunning;
 wbCategorySyncRunning=(async()=>{
  const settings=await wbSettings();if(!settings.token){if(manual)throw Error('请先在插件弹窗连接工作台');return {ok:true,skipped:true}}if(!manual&&settings.auto===false)return {ok:true,skipped:true};
  const current=await OzonCategoryBackground.snapshot(),history=await OzonCategoryBackground.snapshotHistory();
  const batches=[...history.reverse(),...(current?.batch?[current.batch]:[])];
  const key='ozonWorkbenchCategorySyncV1',acks=(await chrome.storage.local.get(key))[key]||{};
  const retained={};let count=0;
  for(const batch of batches){
   if(batch?.sourceMode!=='category'||!batch.stores?.length)continue;
   const csv=storeScannerCore.buildManualSourcingCsv({batch,stores:batch.results||{}}),capturedAt=Date.parse(batch.updatedAt);
   if(!Number.isFinite(capturedAt))continue;
   if(!manual&&acks[batch.id]?.updatedAt===batch.updatedAt){retained[batch.id]=acks[batch.id];if(batch.id===current?.batch?.id)count=retained[batch.id].count;continue;}
   const snap={id:batch.id,capturedAt,status:batch.status,storeCount:batch.stores.length,completedCount:batch.stores.filter(t=>['completed','partial','failed','skipped'].includes(t.status)).length,observed:batch.stores.reduce((s,t)=>s+(Number(t.observedCount)||0),0),csv};
   const result=await wbRequest(settings.token,{action:'batch',batch:snap});retained[batch.id]={updatedAt:batch.updatedAt,count:Number(result.count)||0};if(batch.id===current?.batch?.id)count=retained[batch.id].count;
   await chrome.storage.local.set({[key]:{...acks,...retained}});
  }
  await chrome.storage.local.set({[key]:retained});return {ok:true,count,message:`类目批次已同步 · 当前可交接 ${count} 件，请在工作台类目选品页确认入池。`,batch:current?.batch||null};
 })();try{return await wbCategorySyncRunning}catch(e){if(manual)throw e;return {ok:false,error:e.message}}finally{wbCategorySyncRunning=null}
}

