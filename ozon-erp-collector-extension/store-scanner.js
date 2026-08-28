(function installOzonStoreScanner() {
  const core = globalThis.OzonStoreScannerCore;
  const sellerKey = core?.sellerKeyFromUrl(location.href);
  if (!core || !sellerKey || document.getElementById("ozon-store-scanner-panel")) return;

  const PANEL_ID = "ozon-store-scanner-panel";
  const STORAGE_KEY = core.storeResultStorageKey(sellerKey);
  const SETTLE_DELAY_MS = 1500;
  const BACKGROUND_SETTLE_DELAY_MS = 4000;
  const POLL_INTERVAL_MS = 500;
  const MAX_VIEWPORT_WAIT_MS = 10000;
  const BACKGROUND_MAX_VIEWPORT_WAIT_MS = 20000;
  const STABLE_POLLS_REQUIRED = 2;
  const BACKGROUND_STABLE_POLLS_REQUIRED = 3;
  const SCROLL_RATIO = 0.45;
  const MAX_FORWARD_STEPS = 500;
  const BOUNDARY_CONFIRM_MS = 12000;
  const BACKGROUND_BOUNDARY_CONFIRM_MS = 30000;
  const BOUNDARY_STABLE_REQUIRED = 3;
  const BACKGROUND_BOUNDARY_STABLE_REQUIRED = 5;
  const WATCHDOG_STALE_MS = 20000;
  const version = chrome.runtime.getManifest().version;
  const storeUrl = `${location.origin}/seller/${sellerKey}/`;
  const records = new Map();
  const observedSkus = new Set();
  const attemptObservedSkus = new Set();
  const acknowledgedAttemptSkus = new Set();
  const pendingLinks = new Set();
  const productAnchors = new Set();
  const nearbyProductAnchors = new Set();
  const discoveredStoreLinks = new Set();
  const cardParseCache = new WeakMap();
  const recommendationElements = new Set();
  let scanTimer = null;
  let autoTimer = null;
  let batchCooldownTimer = null;
  let productIntersectionObserver = null;
  let autoScanning = false;
  let scanComplete = false;
  let scanDirection = 1;
  let viewportWaitStartedAt = 0;
  let stablePollCount = 0;
  let lastViewportSignature = "";
  let lastAdvanceScrollY = -1;
  let noProgressCount = 0;
  let forwardStepCount = 0;
  let forwardReachedBoundary = false;
  let boundaryVerificationStartedAt = 0;
  let boundaryVerificationSource = "";
  let boundaryVerificationTop = 0;
  let boundaryStableCount = 0;
  let lastBoundarySignature = "";
  let lastPollAt = 0;
  let activeBatchId = "";
  let activeAttemptId = "";
  let lastProgressAt = 0;
  let pendingSaveRequest = null;
  let saveInFlight = false;
  let saveRetryTimer = null;
  let saveSequence = 0;
  let lastSavedAt = 0;
  let lastSaveError = "";
  let persistenceFailureHandled = false;
  let stateHydrated = false;
  let pendingStartOptions = null;
  let viewportNewSkuCount = 0;
  let consecutiveNoNewSkuScreens = 0;
  let lastNewSkuAt = Date.now();
  const STALL_NO_NEW_SCREENS = 12;
  const STALL_NO_NEW_MS = 90000;
  const BOTTOM_FALLBACK_NO_NEW_SCREENS = 3;

  function setScanProtection(active) {
    try {
      chrome.runtime.sendMessage({ type: "setStoreScanProtection", active: Boolean(active) }, () => void chrome.runtime.lastError);
    } catch {
      // Older Chromium builds may reject messages while the page is unloading.
    }
  }

  function armBatchCooldown(batchId, dueAt) {
    if (batchCooldownTimer) clearTimeout(batchCooldownTimer);
    const target = Number(dueAt) || 0;
    if (!batchId || !target) return;
    batchCooldownTimer = setTimeout(() => {
      batchCooldownTimer = null;
      try {
        chrome.runtime.sendMessage({ type: "batchCooldownElapsed", batchId: String(batchId), dueAt: target, source: "store-page-timer" }, () => void chrome.runtime.lastError);
      } catch {
        // 页面刚好卸载时由后台计时器和闹钟兜底。
      }
    }, Math.max(0, target - Date.now()));
  }

  function storeName() {
    const title = String(document.title || "").split("——")[0].trim();
    return title || sellerKey;
  }

  function registerRecommendationElements(root) {
    if (!(root instanceof Element)) return;
    const visit = (element) => {
      const tag = element.tagName;
      const label = (element.textContent || "").trim();
      if (["H1", "H2", "H3", "H4", "DIV", "SPAN"].includes(tag) && /^(您可能喜欢|Вам может понравиться|You may also like|You might like)$/i.test(label)) recommendationElements.add(element);
    };
    visit(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) visit(walker.currentNode);
  }

  function registerProductAnchors(root) {
    if (!(root instanceof Element)) return;
    const register = (anchor) => {
      if (productAnchors.has(anchor)) return;
      productAnchors.add(anchor);
      if (productIntersectionObserver) productIntersectionObserver.observe(anchor);
      else nearbyProductAnchors.add(anchor);
    };
    if (root.matches?.('a[href*="/product/"]')) register(root);
    root.querySelectorAll?.('a[href*="/product/"]').forEach(register);
    registerRecommendationElements(root);
  }

  function unregisterProductAnchors(root) {
    if (!(root instanceof Element)) return;
    const unregister = (anchor) => {
      productAnchors.delete(anchor);
      nearbyProductAnchors.delete(anchor);
      productIntersectionObserver?.unobserve(anchor);
    };
    if (root.matches?.('a[href*="/product/"]')) unregister(root);
    root.querySelectorAll?.('a[href*="/product/"]').forEach(unregister);
  }

  function installProductIntersectionObserver() {
    if (!("IntersectionObserver" in window)) return;
    productIntersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.target.isConnected) {
          productAnchors.delete(entry.target);
          nearbyProductAnchors.delete(entry.target);
          productIntersectionObserver.unobserve(entry.target);
        } else if (entry.isIntersecting) nearbyProductAnchors.add(entry.target);
        else nearbyProductAnchors.delete(entry.target);
      });
      scheduleScan();
    }, { root: null, rootMargin: "90% 0px 90% 0px", threshold: 0 });
  }

  function recommendationTop() {
    const candidates = [];
    recommendationElements.forEach((element) => {
      if (!element.isConnected) {
        recommendationElements.delete(element);
        return;
      }
      if (!/^(您可能喜欢|Вам может понравиться|You may also like|You might like)$/i.test((element.textContent || "").trim())) return;
      const top = element.getBoundingClientRect().top + window.scrollY;
      if (Number.isFinite(top) && top > 0) candidates.push(top);
    });
    return candidates.length ? Math.min(...candidates) : Number.POSITIVE_INFINITY;
  }

  function productCardForAnchor(anchor) {
    let element = anchor;
    for (let depth = 0; depth < 11 && element; depth += 1, element = element.parentElement) {
      const text = element.innerText || "";
      if (text.length > 2400) return null;
      if (text.length >= 70 && text.includes("SKU：") && text.includes("rFBS佣金：")) return element;
    }
    return null;
  }

  function productName(links, canonicalLink) {
    return links
      .filter((link) => core.canonicalProductLink(link.href) === canonicalLink)
      .map((link) => (link.innerText || link.getAttribute("aria-label") || "").trim())
      .filter((value) => value && !/^(大促销|新品|就是这个价|本周折扣)$/.test(value))
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function visibleProductLinks(boundary) {
    const topGuard = Math.min(100, window.innerHeight * 0.12);
    const bottomGuard = window.innerHeight - topGuard;
    const links = new Set();
    for (const anchor of nearbyProductAnchors) {
      if (!anchor.isConnected) {
        productAnchors.delete(anchor);
        nearbyProductAnchors.delete(anchor);
        continue;
      }
      const rect = anchor.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < topGuard || rect.top > bottomGuard) continue;
      const pageTop = rect.top + window.scrollY;
      if (pageTop >= boundary) continue;
      const link = core.canonicalProductLink(anchor.href);
      if (link) {
        links.add(link);
        discoveredStoreLinks.add(link);
      }
    }
    return [...links];
  }

  function storeProductLinkCount() {
    return discoveredStoreLinks.size;
  }

  function cardTextSignature(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${hash >>> 0}`;
  }

  function collectVisibleStoreCards() {
    const boundary = recommendationTop();
    const found = [];
    const loadedByLink = new Map();
    const cards = new Set();
    const buffer = window.innerHeight * 0.8;
    for (const anchor of nearbyProductAnchors) {
      if (!anchor.isConnected) {
        productAnchors.delete(anchor);
        nearbyProductAnchors.delete(anchor);
        continue;
      }
      const rect = anchor.getBoundingClientRect();
      const pageTop = rect.top + window.scrollY;
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < -buffer || rect.top > window.innerHeight + buffer || pageTop >= boundary) continue;
      const card = productCardForAnchor(anchor);
      if (card) cards.add(card);
    }
    for (const element of cards) {
      const text = element.innerText || "";
      if (!text.includes("SKU：") || !text.includes("rFBS佣金：") || text.length < 70 || text.length > 2200) continue;
      const cardTop = element.getBoundingClientRect().top + window.scrollY;
      if (cardTop >= boundary) continue;
      const signature = cardTextSignature(text);
      let cached = cardParseCache.get(element);
      if (!cached || cached.signature !== signature) {
        const parsed = core.parseCardText(text);
        if (!parsed.sku) continue;
        const links = [...element.querySelectorAll('a[href*="/product/"]')];
        const target = links.find((link) => String(link.href || "").includes(parsed.sku)) || links[0];
        if (!target?.href) continue;
        const link = core.canonicalProductLink(target.href);
        const loaded = {
          ready: parsed.competitorReady,
          sku: parsed.sku,
          qualified: parsed.qualified,
          commissions: parsed.commissions,
          dimensions: parsed.dimensions,
          weight: parsed.weight,
          competitor: parsed.competitor,
        };
        const name = productName(links, link);
        const product = parsed.qualified ? {
          ...parsed,
          name,
          link,
          shippingRisk: core.classifyShippingRisk(`${parsed.category}\n${name}\n${text}`),
          foundAt: new Date().toISOString(),
        } : null;
        cached = { signature, link, loaded, product };
        cardParseCache.set(element, cached);
      }
      loadedByLink.set(cached.link, cached.loaded);
      discoveredStoreLinks.add(cached.link);
      if (cached.loaded.ready) pendingLinks.delete(cached.link);
      observedSkus.add(cached.loaded.sku);
      if (activeBatchId) attemptObservedSkus.add(cached.loaded.sku);
      if (cached.product) found.push(cached.product);
    }
    return { boundary, boundarySource: Number.isFinite(boundary) ? "recommendation" : "unknown", found, loadedByLink };
  }

  function storeState() {
    return {
        storeName: storeName(),
        storeUrl,
        observedCount: observedSkus.size,
        scanComplete,
        updatedAt: new Date().toISOString(),
        observedSkus: [...observedSkus],
        pendingLinks: [...pendingLinks],
        products: Object.fromEntries([...records].map(([sku, product]) => [sku, product])),
    };
  }

  function updatePersistenceStatus() {
    const element = document.getElementById("ozon-store-persistence");
    if (!element) return;
    if (lastSaveError) {
      element.textContent = `本地保存失败：${lastSaveError}`;
      element.style.color = "#b42318";
      element.style.background = "#fff0f0";
      return;
    }
    element.style.color = "#476078";
    element.style.background = "#edf7f2";
    if (saveInFlight || pendingSaveRequest) element.textContent = "正在保存扫描记录……";
    else if (lastSavedAt) element.textContent = `记录已安全保存（${new Date(lastSavedAt).toLocaleTimeString("zh-CN", { hour12: false })}）`;
    else element.textContent = "正在读取本店历史记录……";
  }

  function sendStoreState(request) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: "saveStoreScanState", sellerKey, state: request.state, mode: request.mode }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (!response?.ok) reject(new Error(response?.error || "扩展后台未确认保存"));
          else resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function pumpSaveQueue() {
    if (saveInFlight) return;
    saveInFlight = true;
    updatePersistenceStatus();
    try {
      while (pendingSaveRequest) {
        const request = pendingSaveRequest;
        pendingSaveRequest = null;
        try {
          await sendStoreState(request);
          lastSavedAt = Date.now();
          lastSaveError = "";
          request.waiters.forEach(({ resolve }) => resolve({ ok: true, sequence: request.sequence }));
        } catch (error) {
          lastSaveError = error?.message || String(error);
          request.waiters.forEach(({ reject }) => reject(error));
          if (!saveRetryTimer) {
            saveRetryTimer = setTimeout(() => {
              saveRetryTimer = null;
              saveRecords().catch(handlePersistenceFailure);
            }, 3000);
          }
          break;
        }
      }
    } finally {
      saveInFlight = false;
      updatePersistenceStatus();
      if (pendingSaveRequest && !lastSaveError) void pumpSaveQueue();
    }
  }

  function saveRecords(mode = "merge") {
    const sequence = ++saveSequence;
    const snapshot = storeState();
    const promise = new Promise((resolve, reject) => {
      if (pendingSaveRequest) {
        pendingSaveRequest.state = snapshot;
        pendingSaveRequest.sequence = sequence;
        if (mode === "replace") pendingSaveRequest.mode = "replace";
        pendingSaveRequest.waiters.push({ resolve, reject });
      } else {
        pendingSaveRequest = { state: snapshot, mode, sequence, waiters: [{ resolve, reject }] };
      }
    });
    lastSaveError = "";
    updatePersistenceStatus();
    void pumpSaveQueue();
    return promise;
  }

  function handlePersistenceFailure(error) {
    if (persistenceFailureHandled) return;
    persistenceFailureHandled = true;
    autoScanning = false;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    setScanProtection(false);
    const message = `本地保存失败，扫描已安全暂停：${error?.message || String(error)}。刷新扩展后可从最后一次成功保存处继续。`;
    render();
    const status = document.getElementById("ozon-store-status");
    if (status) status.textContent = message;
    const failedBatchId = activeBatchId;
    reportBatchFinished(failedBatchId, message, false, "persistence-error");
    activeBatchId = "";
    activeAttemptId = "";
  }

  function statusMessage(message = "") {
    const status = document.getElementById("ozon-store-status");
    if (!status) return;
    status.textContent = message || `已查看 ${observedSkus.size} 个，符合要求 ${records.size} 个，待复查 ${pendingLinks.size} 个`;
    reportBatchProgress(status.textContent);
  }

  function scanPhase() {
    if (!autoScanning) return scanComplete ? "completed" : "idle";
    if (boundaryVerificationStartedAt) return "boundary-check";
    return scanDirection < 0 ? "reviewing" : "scanning";
  }

  function scanLooksStalled() {
    return autoScanning
      && consecutiveNoNewSkuScreens >= STALL_NO_NEW_SCREENS
      && Date.now() - lastNewSkuAt >= STALL_NO_NEW_MS;
  }

  function reportBatchProgress(message, force = false) {
    if (!activeBatchId || (!force && Date.now() - lastProgressAt < 1000)) return;
    lastProgressAt = Date.now();
    const attemptObservedSkuDelta = [...attemptObservedSkus].filter((sku) => !acknowledgedAttemptSkus.has(sku));
    try {
      chrome.runtime.sendMessage({
        type: "storeScanProgress",
        batchId: activeBatchId,
        attemptId: activeAttemptId,
        sellerKey,
        observedCount: observedSkus.size,
        attemptObservedSkuDelta,
        qualifiedCount: records.size,
        pendingCount: pendingLinks.size,
        phase: scanPhase(),
        noNewSkuScreens: consecutiveNoNewSkuScreens,
        lastNewSkuAt: new Date(lastNewSkuAt).toISOString(),
        stalled: scanLooksStalled(),
        message,
      }, (response) => {
        if (!chrome.runtime.lastError && response?.ok) attemptObservedSkuDelta.forEach((sku) => acknowledgedAttemptSkus.add(sku));
      });
    } catch {
      // 页面卸载时忽略消息失败，后台仍保留最后一次进度。
    }
  }

  function reportBatchFinished(batchId, message, complete, reason = "") {
    if (!batchId) return;
    const attemptObservedSkuDelta = [...attemptObservedSkus].filter((sku) => !acknowledgedAttemptSkus.has(sku));
    try {
      chrome.runtime.sendMessage({
        type: "storeScanFinished",
        batchId,
        attemptId: activeAttemptId,
        sellerKey,
        observedCount: observedSkus.size,
        attemptObservedSkuDelta,
        qualifiedCount: records.size,
        pendingCount: pendingLinks.size,
        message,
        complete: Boolean(complete),
        reason,
      }, () => void chrome.runtime.lastError);
    } catch {
      // 页面卸载时由后台恢复机制接管。
    }
  }

  function render() {
    document.getElementById("ozon-store-observed").textContent = String(observedSkus.size);
    document.getElementById("ozon-store-qualified").textContent = String(records.size);
    document.getElementById("ozon-store-pending").textContent = String(pendingLinks.size);
    document.getElementById("ozon-store-start").hidden = autoScanning;
    document.getElementById("ozon-store-stop").hidden = !autoScanning;
    document.getElementById("ozon-store-skip").hidden = !(autoScanning && activeBatchId);
    document.getElementById("ozon-store-export").disabled = false;
    if (!autoScanning) {
      if (scanComplete) statusMessage("准确扫描和回查已完成，可以导出。");
      else if (pendingLinks.size) statusMessage(`当前有 ${pendingLinks.size} 个商品等待复查，可继续扫描。`);
      else statusMessage("正在监听页面，手动滚动也会自动记录。 ");
    }
  }

  function applyFoundProducts(found) {
    let changed = false;
    found.forEach((product) => {
      const previous = records.get(product.sku);
      const next = { ...previous, ...product, foundAt: previous?.foundAt || product.foundAt };
      if (!product.competitor && previous?.competitor) {
        next.competitor = previous.competitor;
        next.competitorReady = previous.competitorReady;
      }
      if (JSON.stringify(previous) !== JSON.stringify(next)) changed = true;
      records.set(product.sku, next);
    });
    return changed;
  }

  function scanNow() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    const previousObservedCount = observedSkus.size;
    const previousPendingCount = pendingLinks.size;
    const result = collectVisibleStoreCards();
    const changed = applyFoundProducts(result.found);
    result.newSkuCount = Math.max(0, observedSkus.size - previousObservedCount);
    if (result.newSkuCount > 0) lastNewSkuAt = Date.now();
    if (changed || observedSkus.size !== previousObservedCount || pendingLinks.size !== previousPendingCount) saveRecords().catch(handlePersistenceFailure);
    render();
    return result;
  }

  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanNow, 500);
  }

  function scheduleAuto(delayMs) {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => void pollViewport(), delayMs);
  }

  function beginViewportWait(delayMs = SETTLE_DELAY_MS) {
    viewportWaitStartedAt = Date.now();
    viewportNewSkuCount = 0;
    stablePollCount = 0;
    lastViewportSignature = "";
    scheduleAuto(Math.max(delayMs, document.hidden ? BACKGROUND_SETTLE_DELAY_MS : SETTLE_DELAY_MS));
  }

  async function stopAutoScan(message, complete = false, options = {}) {
    const finishedBatchId = activeBatchId;
    autoScanning = false;
    scanComplete = Boolean(complete);
    setScanProtection(false);
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    lastProgressAt = Date.now();
    scanNow();
    try {
      await saveRecords();
    } catch (error) {
      handlePersistenceFailure(error);
      return false;
    }
    activeBatchId = "";
    render();
    statusMessage(message);
    if (!options.silent) reportBatchFinished(finishedBatchId, message, complete, options.reason || "");
    activeAttemptId = "";
    attemptObservedSkus.clear();
    acknowledgedAttemptSkus.clear();
    return true;
  }

  function resetBoundaryVerification() {
    boundaryVerificationStartedAt = 0;
    boundaryVerificationSource = "";
    boundaryVerificationTop = 0;
    boundaryStableCount = 0;
    lastBoundarySignature = "";
  }

  function verifyStoreBoundary(result) {
    const now = Date.now();
    const source = result.boundarySource || "recommendation";
    if (boundaryVerificationSource && boundaryVerificationSource !== source) resetBoundaryVerification();
    const boundary = Number.isFinite(result.boundary) ? result.boundary : boundaryVerificationTop;
    if (!Number.isFinite(boundary) || boundary <= 0) {
      resetBoundaryVerification();
      return;
    }
    if (!boundaryVerificationStartedAt) boundaryVerificationStartedAt = now;
    boundaryVerificationSource = source;
    boundaryVerificationTop = boundary;
    const nativeProductCount = storeProductLinkCount();
    const signature = [
      source,
      Math.round(boundary),
      document.documentElement.scrollHeight,
      nativeProductCount,
      observedSkus.size,
    ].join("|");
    if (signature === lastBoundarySignature) boundaryStableCount += 1;
    else boundaryStableCount = 1;
    lastBoundarySignature = signature;

    const elapsed = now - boundaryVerificationStartedAt;
    const requiredMs = document.hidden ? BACKGROUND_BOUNDARY_CONFIRM_MS : BOUNDARY_CONFIRM_MS;
    const requiredStable = document.hidden ? BACKGROUND_BOUNDARY_STABLE_REQUIRED : BOUNDARY_STABLE_REQUIRED;
    const phase = source === "page-bottom"
      ? (document.hidden ? "后台页面底部确认" : "页面底部确认")
      : (document.hidden ? "后台末尾确认" : "店铺末尾确认");
    statusMessage(`${phase}：页面稳定 ${boundaryStableCount}/${requiredStable}，已确认 ${Math.floor(elapsed / 1000)}/${Math.floor(requiredMs / 1000)} 秒`);

    if (elapsed >= requiredMs && boundaryStableCount >= requiredStable) {
      forwardReachedBoundary = true;
      resetBoundaryVerification();
      if (pendingLinks.size === 0) {
        void stopAutoScan("扫描完成：店铺末尾已稳定，且没有待复查商品，已省略整页反向复查。", true);
      } else {
        startReviewPass(`已确认到达店铺末尾，正在复查 ${pendingLinks.size} 个待确认商品。`);
      }
      return;
    }

    const probeTop = Math.max(0, boundary - window.innerHeight * 0.78);
    window.scrollTo({ top: probeTop, left: 0, behavior: "auto" });
    beginViewportWait(document.hidden ? BACKGROUND_SETTLE_DELAY_MS : SETTLE_DELAY_MS);
  }

  function startReviewPass(reason) {
    resetBoundaryVerification();
    scanDirection = -1;
    noProgressCount = 0;
    lastAdvanceScrollY = window.scrollY;
    statusMessage(`${reason} 正在从底部向上复查遗漏商品……`);
    if (window.scrollY <= 10) {
      const complete = forwardReachedBoundary && pendingLinks.size === 0;
      void stopAutoScan(complete ? "扫描完成：所有商品已稳定加载并完成回查。" : `回查结束，仍有 ${pendingLinks.size} 个商品未确认。`, complete);
      return;
    }
    window.scrollBy({ top: -Math.max(360, window.innerHeight * SCROLL_RATIO), left: 0, behavior: "auto" });
    beginViewportWait();
  }

  function finishReviewPass() {
    const complete = forwardReachedBoundary && pendingLinks.size === 0;
    const message = complete
      ? "扫描完成：已到达店铺末尾并反向复查，没有待确认商品。"
      : `回查结束：仍有 ${pendingLinks.size} 个商品加载超时，建议保持页面打开后再次扫描。`;
    void stopAutoScan(message, complete);
  }

  async function advanceAfterStableViewport(result, readiness, timedOut) {
    if (timedOut) readiness.missingLinks.forEach((link) => pendingLinks.add(link));
    else readiness.missingLinks.forEach((link) => pendingLinks.delete(link));
    try {
      await saveRecords();
    } catch (error) {
      handlePersistenceFailure(error);
      return;
    }
    render();

    if (scanDirection < 0) {
      if (window.scrollY <= 10) {
        finishReviewPass();
        return;
      }
      const nextTop = Math.max(0, window.scrollY - Math.max(360, window.innerHeight * SCROLL_RATIO));
      window.scrollTo({ top: nextTop, left: 0, behavior: "auto" });
      statusMessage(`反向复查中：待复查 ${pendingLinks.size} 个，符合要求 ${records.size} 个`);
      beginViewportWait();
      return;
    }

    if (viewportNewSkuCount > 0) consecutiveNoNewSkuScreens = 0;
    else consecutiveNoNewSkuScreens += 1;

    forwardStepCount += 1;
    const viewportBottom = window.scrollY + window.innerHeight;
    if (boundaryVerificationStartedAt) {
      const verificationResult = boundaryVerificationSource === "page-bottom"
        ? { ...result, boundary: document.documentElement.scrollHeight, boundarySource: "page-bottom" }
        : { ...result, boundary: Number.isFinite(result.boundary) ? result.boundary : boundaryVerificationTop, boundarySource: "recommendation" };
      verifyStoreBoundary(verificationResult);
      return;
    }
    const remaining = result.boundary - viewportBottom;
    const nearBoundary = Number.isFinite(result.boundary) && remaining <= Math.max(180, window.innerHeight * 0.22);
    if (nearBoundary) {
      verifyStoreBoundary(result);
      return;
    }
    const pageBottomRemaining = document.documentElement.scrollHeight - viewportBottom;
    const nearPageBottom = !Number.isFinite(result.boundary) && pageBottomRemaining <= Math.max(240, window.innerHeight * 0.25);
    if (nearPageBottom && consecutiveNoNewSkuScreens >= BOTTOM_FALLBACK_NO_NEW_SCREENS) {
      verifyStoreBoundary({ ...result, boundary: document.documentElement.scrollHeight, boundarySource: "page-bottom" });
      return;
    }
    resetBoundaryVerification();

    if (forwardStepCount >= MAX_FORWARD_STEPS) {
      startReviewPass("已达到安全扫描上限。");
      return;
    }

    if (lastAdvanceScrollY >= 0 && Math.abs(window.scrollY - lastAdvanceScrollY) < 5) noProgressCount += 1;
    else noProgressCount = 0;
    lastAdvanceScrollY = window.scrollY;
    if (noProgressCount >= 3) {
      startReviewPass("页面已连续三次无法继续下移。");
      return;
    }

    const step = Math.max(360, window.innerHeight * SCROLL_RATIO);
    window.scrollBy({ top: Math.round(step), left: 0, behavior: "auto" });
    const stalled = scanLooksStalled() ? "，疑似长时间无进展" : "";
    statusMessage(`准确扫描中：本屏已加载 ${readiness.loadedCount}/${readiness.visibleCount}，连续无新增 ${consecutiveNoNewSkuScreens} 屏，待复查 ${pendingLinks.size}${stalled}`);
    beginViewportWait();
  }

  async function pollViewport() {
    if (!autoScanning) return;
    lastPollAt = Date.now();
    const result = scanNow();
    viewportNewSkuCount += result.newSkuCount || 0;
    const visibleLinks = visibleProductLinks(result.boundary);
    const readiness = core.assessViewportReadiness(visibleLinks, result.loadedByLink);
    const boundaryVisibleWithoutProducts = readiness.visibleCount === 0
      && Number.isFinite(result.boundary)
      && result.boundary <= window.scrollY + window.innerHeight + 120;
    const fullyLoaded = readiness.missingLinks.length === 0 && (readiness.visibleCount > 0 || boundaryVisibleWithoutProducts);

    if (fullyLoaded && readiness.signature === lastViewportSignature) stablePollCount += 1;
    else stablePollCount = fullyLoaded ? 1 : 0;
    lastViewportSignature = readiness.signature;

    const elapsed = Date.now() - viewportWaitStartedAt;
    const requiredStable = document.hidden ? BACKGROUND_STABLE_POLLS_REQUIRED : STABLE_POLLS_REQUIRED;
    const maxWait = document.hidden ? BACKGROUND_MAX_VIEWPORT_WAIT_MS : MAX_VIEWPORT_WAIT_MS;
    const stable = stablePollCount >= requiredStable;
    const timedOut = elapsed >= maxWait;
    const phase = scanDirection > 0 ? (document.hidden ? "后台准确扫描" : "准确扫描") : (document.hidden ? "后台反向复查" : "反向复查");
    const stalled = scanLooksStalled() ? "，疑似卡住，可结束当前店后继续下一家" : "";
    statusMessage(`${phase}：本屏已加载 ${readiness.loadedCount}/${readiness.visibleCount}，稳定 ${stablePollCount}/${requiredStable}，连续无新增 ${consecutiveNoNewSkuScreens} 屏，待复查 ${pendingLinks.size}${stalled}`);

    if (stable || timedOut) {
      await advanceAfterStableViewport(result, readiness, timedOut);
      return;
    }
    scheduleAuto(POLL_INTERVAL_MS);
  }

  function startAutoScan(options = {}) {
    if (!stateHydrated) {
      pendingStartOptions = options;
      const status = document.getElementById("ozon-store-status");
      if (status) status.textContent = "正在恢复上次已保存的扫描记录，完成后自动续扫……";
      return;
    }
    if (autoTimer) clearTimeout(autoTimer);
    if (options.batchId) {
      activeBatchId = String(options.batchId);
      activeAttemptId = String(options.attemptId || "");
      attemptObservedSkus.clear();
      acknowledgedAttemptSkus.clear();
      (options.attemptObservedSkus || []).forEach((sku) => {
        attemptObservedSkus.add(String(sku));
        acknowledgedAttemptSkus.add(String(sku));
      });
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } else {
      activeAttemptId = "";
      attemptObservedSkus.clear();
      acknowledgedAttemptSkus.clear();
    }
    autoScanning = true;
    persistenceFailureHandled = false;
    scanComplete = false;
    scanDirection = 1;
    noProgressCount = 0;
    consecutiveNoNewSkuScreens = 0;
    viewportNewSkuCount = 0;
    lastNewSkuAt = Date.now();
    forwardStepCount = 0;
    forwardReachedBoundary = false;
    lastAdvanceScrollY = -1;
    resetBoundaryVerification();
    lastPollAt = Date.now();
    setScanProtection(true);
    render();
    statusMessage("准确扫描已开始，正在等待当前区域的毛子 ERP 信息稳定。 ");
    reportBatchProgress("批量任务已启动当前店铺扫描。", true);
    beginViewportWait(800);
  }

  function exportMarkdown() {
    scanNow();
    const exportedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const markdown = core.buildMarkdown({
      storeName: storeName(),
      storeUrl,
      exportedAt,
      products: [...records.values()],
      observedCount: observedSkus.size,
      scanComplete,
    });
    const blob = new Blob(["\ufeff", markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${core.safeFilePart(storeName())}_符合要求商品_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    statusMessage(`已导出 ${records.size} 个符合要求商品。`);
  }

  function clearStoreRecords() {
    if (!confirm(`确认清空 ${storeName()} 已记录的 ${records.size} 个商品吗？`)) return;
    records.clear();
    observedSkus.clear();
    pendingLinks.clear();
    attemptObservedSkus.clear();
    acknowledgedAttemptSkus.clear();
    scanComplete = false;
    saveRecords("replace").catch(handlePersistenceFailure);
    render();
    statusMessage("本店记录已清空，可以重新扫描。 ");
  }

  async function finishCurrentBatchStore() {
    if (!activeBatchId || !autoScanning) return;
    const button = document.getElementById("ozon-store-skip");
    button.disabled = true;
    document.getElementById("ozon-store-status").textContent = "正在结束当前店；系统会根据扫描阶段记录完成状态，稍后进入下一家……";
    try {
      await saveRecords();
    } catch (error) {
      button.disabled = false;
      handlePersistenceFailure(error);
      return;
    }
    chrome.runtime.sendMessage({
      type: "skipStoreBatchCurrent",
      source: "store-panel",
      sellerKey,
      attemptId: activeAttemptId,
      observedCount: observedSkus.size,
      attemptObservedSkus: [...attemptObservedSkus],
      qualifiedCount: records.size,
      pendingCount: pendingLinks.size,
      reviewing: scanDirection < 0,
      forwardReachedBoundary,
    }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        button.disabled = false;
        statusMessage(chrome.runtime.lastError?.message || response?.error || "结束当前店失败，请到批量管理页重试。");
      }
    });
  }

  function installPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.style.cssText = "position:fixed;left:18px;bottom:150px;z-index:2147483647;width:330px;padding:13px;border:1px solid #d9def4;border-radius:16px;background:rgba(248,250,255,.96);box-shadow:0 16px 38px rgba(36,48,98,.18);font-family:Microsoft YaHei,system-ui,sans-serif;color:#1f2b46;font-size:12px;";
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:12px;color:#fff;background:linear-gradient(135deg,#245be9,#7a72dc);font-weight:800;">
        <span>OZON 店铺扫描 <small style="opacity:.75;font-weight:600;">v${version}</small></span>
        <span>${storeName()}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:10px;">
        <div style="padding:9px;border-radius:10px;background:#eef2ff;">已查看<br><strong id="ozon-store-observed" style="font-size:19px;">0</strong></div>
        <div style="padding:9px;border-radius:10px;background:#fff0f2;color:#a82b45;">符合要求<br><strong id="ozon-store-qualified" style="font-size:19px;">0</strong></div>
        <div style="padding:9px;border-radius:10px;background:#fff8e7;color:#986b11;">待复查<br><strong id="ozon-store-pending" style="font-size:19px;">0</strong></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px;">
        <button id="ozon-store-start" type="button">开始准确扫描</button>
        <button id="ozon-store-stop" type="button" hidden>停止扫描</button>
        <button id="ozon-store-export" type="button">导出 Markdown</button>
        <button id="ozon-store-clear" type="button">清空本店记录</button>
        <button id="ozon-store-skip" type="button" hidden style="grid-column:1/-1;">结束当前店，扫描下一家</button>
      </div>
      <div id="ozon-store-status" style="margin-top:9px;padding:8px;border-radius:9px;background:#eef1f8;color:#5f6d88;line-height:1.45;"></div>
      <div id="ozon-store-persistence" style="margin-top:6px;padding:7px;border-radius:9px;background:#edf7f2;color:#476078;line-height:1.4;">正在读取本店历史记录……</div>
      <style>
        #${PANEL_ID} *{box-sizing:border-box}#${PANEL_ID} button{min-height:34px;border:1px solid #dce2f4;border-radius:9px;background:#fff;color:#3e4e72;font:inherit;font-weight:800;cursor:pointer}#${PANEL_ID} button:hover{border-color:#8796e5;color:#274fc4}#${PANEL_ID} button:disabled{opacity:.55;cursor:not-allowed}#${PANEL_ID} #ozon-store-start,#${PANEL_ID} #ozon-store-export{color:#fff;border:0;background:linear-gradient(135deg,#245be9,#746fd9)}#${PANEL_ID} #ozon-store-stop{color:#a82b45;background:#fff0f2;border-color:#ffd7df}#${PANEL_ID} #ozon-store-skip{color:#8a5800;background:#fff7df;border-color:#f3d58a}
      </style>
    `;
    document.body.appendChild(panel);
    document.getElementById("ozon-store-start").addEventListener("click", startAutoScan);
    document.getElementById("ozon-store-stop").addEventListener("click", () => void stopAutoScan("扫描已停止，可导出当前结果或稍后继续。", false, { reason: "manual-stop" }));
    document.getElementById("ozon-store-export").addEventListener("click", exportMarkdown);
    document.getElementById("ozon-store-clear").addEventListener("click", clearStoreRecords);
    document.getElementById("ozon-store-skip").addEventListener("click", () => void finishCurrentBatchStore());
  }

  function hydrateStoredState(attempt = 0) {
    chrome.runtime.sendMessage({ type: "getStoreScanState", sellerKey }, (response) => {
      const errorMessage = chrome.runtime.lastError?.message || (!response?.ok ? response?.error || "扩展后台未确认读取" : "");
      if (errorMessage) {
        lastSaveError = `历史记录读取失败：${errorMessage}`;
        updatePersistenceStatus();
        const status = document.getElementById("ozon-store-status");
        if (status) status.textContent = attempt < 2 ? `历史记录读取失败，正在自动重试（${attempt + 1}/3）……` : "历史记录读取失败，扫描未启动，避免覆盖已有数据。";
        if (attempt < 2) {
          setTimeout(() => hydrateStoredState(attempt + 1), 1200);
          return;
        }
        if (pendingStartOptions?.batchId) {
          activeBatchId = String(pendingStartOptions.batchId);
          activeAttemptId = String(pendingStartOptions.attemptId || "");
          reportBatchFinished(activeBatchId, `历史记录读取失败，扫描未启动：${errorMessage}`, false, "persistence-error");
          activeBatchId = "";
          activeAttemptId = "";
        }
        pendingStartOptions = null;
        return;
      }
      const state = response?.state || { storeName: storeName(), storeUrl, products: {} };
      (state.observedSkus || []).forEach((sku) => observedSkus.add(String(sku)));
      (state.pendingLinks || []).forEach((link) => pendingLinks.add(core.canonicalProductLink(link)));
      Object.entries(state.products || {}).forEach(([sku, product]) => records.set(sku, product));
      scanComplete = Boolean(state.scanComplete);
      stateHydrated = true;
      lastSaveError = "";
      lastSavedAt = state.updatedAt ? Date.parse(state.updatedAt) || Date.now() : 0;
      updatePersistenceStatus();
      scanNow();
      if (pendingStartOptions) {
        const options = pendingStartOptions;
        pendingStartOptions = null;
        startAutoScan(options);
      }
    });
  }

  installPanel();
  installProductIntersectionObserver();
  registerProductAnchors(document.body);
  hydrateStoredState();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]?.newValue) return;
    const state = changes[STORAGE_KEY].newValue;
    if (!state?.products) return;
    let changed = false;
    Object.entries(state.products).forEach(([sku, product]) => {
      const previous = records.get(sku);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(product)) {
        records.set(sku, { ...previous, ...product });
        changed = true;
      }
    });
    if (changed) render();
  });
  const observer = new MutationObserver((mutations) => {
    const panel = document.getElementById(PANEL_ID);
    let changed = false;
    mutations.forEach((mutation) => {
      if (panel?.contains(mutation.target)) return;
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) registerProductAnchors(node);
      });
      mutation.removedNodes.forEach((node) => {
        if (node instanceof Element) unregisterProductAnchors(node);
      });
      changed = true;
    });
    if (changed) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", scheduleScan, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!autoScanning) return;
    statusMessage(document.hidden ? "已切换到后台，扫描继续运行并启用延长等待。" : "已回到店铺页，正在加速恢复扫描。 ");
    beginViewportWait(document.hidden ? BACKGROUND_SETTLE_DELAY_MS : 500);
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "armBatchCooldown") {
      armBatchCooldown(message.batchId, message.dueAt);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "startStoreScan") {
      startAutoScan({ batchId: message.batchId || "", attemptId: message.attemptId || "", attemptObservedSkus: message.attemptObservedSkus || [] });
      sendResponse({ ok: true, sellerKey });
      return false;
    }
    if (message?.type === "stopStoreScan") {
      stopAutoScan(message.complete ? "正向扫描已完成，已省略剩余反向复查。" : "扫描已由批量任务控制器结束。", Boolean(message.complete), { silent: Boolean(message.silent), reason: "controller-stop" })
        .then((ok) => sendResponse({ ok: ok !== false }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === "getStoreScanStatus") {
      sendResponse({ ok: true, sellerKey, attemptId: activeAttemptId, attemptObservedSkus: [...attemptObservedSkus], autoScanning, scanComplete, observedCount: observedSkus.size, qualifiedCount: records.size, pendingCount: pendingLinks.size, reviewing: scanDirection < 0, forwardReachedBoundary });
      return false;
    }
    if (message?.type !== "storeScanWatchdogTick" || !autoScanning) return false;
    if (Date.now() - lastPollAt >= WATCHDOG_STALE_MS) scheduleAuto(0);
    return false;
  });
  window.addEventListener("pagehide", () => {
    if (batchCooldownTimer) clearTimeout(batchCooldownTimer);
    saveRecords().catch(() => null);
    setScanProtection(false);
  }, { once: true });
  scheduleScan();
})();
