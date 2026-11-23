const activateButton = document.getElementById("activate");
const batchManagerButton = document.getElementById("batchManager");
const categoryManagerButton = document.getElementById("categoryManager");
const sourcingEnrichmentButton = document.getElementById("sourcingEnrichment");
const autoStartButton = document.getElementById("autoStart");
const autoStopButton = document.getElementById("autoStop");
const statusEl = document.getElementById("status");

function setStatus(message, ok = true) {
  statusEl.textContent = message;
  statusEl.dataset.state = ok ? "success" : "error";
  statusEl.style.color = ok ? "#067647" : "#b42318";
}

function renderAutoButtons(enabled) {
  autoStartButton.hidden = enabled;
  autoStopButton.hidden = !enabled;
}

function refreshAutoState() {
  chrome.runtime.sendMessage({ type: "getAutoInject" }, (response) => {
    renderAutoButtons(Boolean(response?.enabled));
  });
}

activateButton.addEventListener("click", () => {
  setStatus("正在启动...", true);
  chrome.runtime.sendMessage({ type: "activateOnCurrentOzonTab" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, false);
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || "启动失败", false);
      return;
    }
    setStatus("已启动，回到页面左侧查看采集面板。");
  });
});

batchManagerButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "openBatchManager" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setStatus(chrome.runtime.lastError?.message || response?.error || "无法打开批量扫描页", false);
      return;
    }
    window.close();
  });
});

categoryManagerButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("category.html") });
  window.close();
});

sourcingEnrichmentButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "openSourcingEnrichment" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setStatus(chrome.runtime.lastError?.message || response?.error || "无法打开任务批量核价补全页", false);
      return;
    }
    window.close();
  });
});

autoStartButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "setAutoInject", enabled: true }, (response) => {
    if (!response?.ok) {
      setStatus(response?.error || "开启失败", false);
      return;
    }
    renderAutoButtons(true);
    setStatus("本轮自动启动已开启。后续新打开的 OZON 页面会自动出现采集面板。");
  });
});

autoStopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "setAutoInject", enabled: false }, (response) => {
    if (!response?.ok) {
      setStatus(response?.error || "关闭失败", false);
      return;
    }
    renderAutoButtons(false);
    setStatus("本轮自动启动已关闭。");
  });
});

refreshAutoState();

const wbEl=id=>document.getElementById(id);
function wbMsg(message){return new Promise((resolve,reject)=>chrome.runtime.sendMessage(message,r=>chrome.runtime.lastError||!r?.ok?reject(Error(chrome.runtime.lastError?.message||r?.error||'连接失败')):resolve(r)))}
async function wbRefresh(){try{const r=await wbMsg({type:'wbStatus'});wbEl('wbState').textContent=r.connected?'已连接工作台'+(r.sync?.at?' · 上次同步 '+new Date(r.sync.at).toLocaleString():''):'尚未连接';wbEl('wbAuto').checked=r.auto;wbEl('wbAuto').disabled=!r.connected;wbEl('wbDisconnect').disabled=!r.connected;}catch(e){wbEl('wbState').textContent=e.message}}
wbEl('wbConnect').onclick=async()=>{try{wbEl('wbConnect').disabled=true;await wbMsg({type:'wbConnect',token:wbEl('wbToken').value,auto:wbEl('wbAuto').checked});wbEl('wbToken').value='';await wbRefresh()}catch(e){wbEl('wbState').textContent=e.message}finally{wbEl('wbConnect').disabled=false}};
wbEl('wbDisconnect').onclick=async()=>{try{await wbMsg({type:'wbDisconnect'});await wbRefresh()}catch(e){wbEl('wbState').textContent=e.message}};
wbEl('wbAuto').onchange=async()=>{try{await wbMsg({type:'wbAuto',enabled:wbEl('wbAuto').checked});await wbRefresh()}catch(e){wbEl('wbState').textContent=e.message}};
wbRefresh();
