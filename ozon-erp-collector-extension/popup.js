const activateButton = document.getElementById("activate");
const batchManagerButton = document.getElementById("batchManager");
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

sourcingEnrichmentButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "openSourcingEnrichment" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setStatus(chrome.runtime.lastError?.message || response?.error || "无法打开找品详情补全页", false);
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
