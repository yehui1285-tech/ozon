(function(root) {
  "use strict";

  const P = "ozon1688Job:";
  const A = "ozon1688ActiveJobV1";
  const S = "ozon1688SessionOwnerV1:";
  const M = 15 * 1024 * 1024;
  const E = 1024 * 1024;
  const T = new Set(["completed", "failed", "cancelled"]);
  const K = new Set(["image", "keyword", "similar_supplier", "verify_sku"]);
  const X = /(?:下单|订单|支付|付款|联系|客服|聊天|优惠券|购买|立即购买|buy\s*now|payment|contact|chat|coupon|order)/i;
  const CANCELLED = "__CANCELLED__";
  const STALE = "__STALE_GENERATION__";
  const OWNERSHIP_LOST = "__OWNERSHIP_LOST__";
  const SEARCH_URL = "https://s.1688.com/";
  const IMAGE_SEARCH_URL = "https://air.1688.com/kapp/1688-search/pc-image-search/";

  let q = Promise.resolve();
  const runners = new Map();
  const controllers = new Map();
  const owners = new Map();
  const pendingOwners = new Map();

  const s = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const key = (id) => P + s(id);
  const sessionKey = (id) => S + s(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const serial = (operation) => {
    const next = q.then(operation, operation);
    q = next.catch(() => null);
    return next;
  };
  const revisionOf = (job) => Number.isFinite(Number(job?.revision)) ? Number(job.revision) : 0;
  const hasOwnerToken = (value) => s(value).length > 0;
  const generation = (job) => ({
    jobId: s(job?.jobId),
    ownerToken: s(job?.ownerToken),
    revision: revisionOf(job),
  });
  const sameGeneration = (left, right) => Boolean(left && right)
    && s(left.jobId) === s(right.jobId)
    && s(left.ownerToken) === s(right.ownerToken)
    && revisionOf(left) === revisionOf(right);
  const activeId = (value) => typeof value === "string" ? s(value) : s(value?.jobId);
  const activeRecord = (job) => ({
    jobId: s(job.jobId),
    ownerToken: s(job.ownerToken),
    revision: revisionOf(job),
  });
  const activeMatches = (value, job) => Boolean(value && typeof value === "object" && job)
    && s(value.jobId) === s(job.jobId)
    && s(value.ownerToken) === s(job.ownerToken)
    && revisionOf(value) === revisionOf(job);
  const isTerminal = (job) => T.has(job?.status);
  const initialSearchUrl = (strategyType) => strategyType === "image" || strategyType === "similar_supplier"
    ? IMAGE_SEARCH_URL
    : SEARCH_URL;

  function randomOwnerToken() {
    const cryptoApi = root.crypto;
    if (!cryptoApi?.getRandomValues) throw Error("安全随机源不可用。");
    const bytes = new Uint8Array(24);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function is1688Url(value) {
    try {
      const url = new URL(s(value));
      return url.protocol === "https:" && (url.hostname === "1688.com" || url.hostname.endsWith(".1688.com"));
    } catch {
      return false;
    }
  }

  function host(value, supplier = false) {
    try {
      const url = new URL(s(value));
      return url.protocol === "https:" && (supplier ? /(^|\.)alicdn\.com$/i : /(^|\.)ozone\.ru$/i).test(url.hostname);
    } catch {
      return false;
    }
  }

  function offer(value) {
    return root.Ozon1688Core?.canonicalOfferUrl(value) || "";
  }

  function strategy(value = {}) {
    const type = s(value.type);
    const query = s(value.query);
    const sourceUrl = s(value.sourceUrl);
    const optionId = s(value.optionId);
    const optionLabel = s(value.optionLabel);
    if (!K.has(type) || X.test(query) || X.test(optionLabel)) throw Error("不允许的 1688 任务参数。");
    if (type === "keyword" && !query) throw Error("关键词策略缺少查询词。");
    if ((type === "image" && !host(sourceUrl)) || (type === "similar_supplier" && !host(sourceUrl, true))) throw Error("图片不在允许主机。");
    if (type === "verify_sku" && (!offer(sourceUrl) || (!optionId && !optionLabel))) throw Error("SKU 核验必须提供详情页和精确选项。");
    return {
      type,
      query,
      sourceUrl,
      optionId,
      optionLabel,
      expectedPrice: Number.isFinite(Number(value.expectedPrice)) ? Number(value.expectedPrice) : null,
    };
  }

  async function load(id) {
    const data = await chrome.storage.local.get(key(id));
    return data[key(id)] ? clone(data[key(id)]) : null;
  }

  async function put(job, active = !isTerminal(job), previous = null) {
    job.updatedAt = new Date().toISOString();
    const values = { [key(job.jobId)]: clone(job) };
    if (active) {
      values[A] = activeRecord(job);
    } else {
      const currentActive = (await chrome.storage.local.get(A))[A];
      if (activeMatches(currentActive, previous || job)) values[A] = null;
    }
    await chrome.storage.local.set(values);
    return job;
  }

  async function change(id, transform, expected = null) {
    return serial(async () => {
      const old = await load(id);
      if (!old) throw Error("1688 任务不存在。");
      if (expected && !sameGeneration(old, expected)) throw Error(STALE);
      const next = await transform(clone(old));
      if (old.status === "cancelled" && next.status !== "cancelled") return old;
      next.revision = revisionOf(old) + 1;
      if (isTerminal(next)) next.completedAt = next.completedAt || new Date().toISOString();
      return put(next, !isTerminal(next), old);
    });
  }

  async function mutate(generationRef, transform) {
    const next = await change(generationRef.jobId, transform, generationRef);
    generationRef.ownerToken = s(next.ownerToken);
    generationRef.revision = revisionOf(next);
    return next;
  }

  async function transition(generationRef, status, more = {}) {
    return mutate(generationRef, (job) => ({ ...job, ...more, status, phase: status }));
  }

  async function live(generationRef, phase = "") {
    let job = await load(generationRef.jobId);
    if (!job || !sameGeneration(job, generationRef)) throw Error(STALE);
    if (job.status === "cancelled") throw Error(CANCELLED);
    if (isTerminal(job)) throw Error(STALE);
    if (phase && job.phase !== phase) job = await mutate(generationRef, (current) => ({ ...current, phase }));
    return job;
  }

  function sessionArea() {
    const area = chrome.storage?.session;
    return area?.get && area?.set ? area : null;
  }

  async function readSessionOwner(jobId) {
    const area = sessionArea();
    if (!area) return null;
    try {
      const data = await area.get(sessionKey(jobId));
      return data[sessionKey(jobId)] ? clone(data[sessionKey(jobId)]) : null;
    } catch {
      return null;
    }
  }

  function proofMatches(job, proof) {
    return Boolean(job && proof)
      && hasOwnerToken(job.ownerToken)
      && proof.jobId === job.jobId
      && Number.isInteger(proof.tabId)
      && proof.tabId === job.tabId
      && proof.tabId === job.ownedTabId
      && proof.ownerToken === job.ownerToken;
  }

  async function writeSessionOwner(job) {
    const area = sessionArea();
    if (!area || !hasOwnerToken(job.ownerToken) || !Number.isInteger(job.tabId) || job.tabId !== job.ownedTabId) return false;
    try {
      await area.set({
        [sessionKey(job.jobId)]: {
          jobId: job.jobId,
          tabId: job.tabId,
          ownerToken: job.ownerToken,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async function clearSessionOwner(job) {
    const area = sessionArea();
    if (!area) return false;
    try {
      const proof = await readSessionOwner(job.jobId);
      if (!proofMatches(job, proof)) return false;
      if (typeof area.remove === "function") await area.remove(sessionKey(job.jobId));
      else await area.set({ [sessionKey(job.jobId)]: null });
      return true;
    } catch {
      return false;
    }
  }

  async function tabClaim(job) {
    if (!hasOwnerToken(job?.ownerToken) || !Number.isInteger(job?.tabId) || job.tabId !== job.ownedTabId) {
      return { tab: null, proof: null, sessionMatches: false };
    }
    const memoryMatches = owners.get(job.jobId) === job.ownerToken;
    const proof = await readSessionOwner(job.jobId);
    const sessionMatches = proofMatches(job, proof);
    if ((owners.has(job.jobId) && !memoryMatches) || (!memoryMatches && !sessionMatches)) {
      return { tab: null, proof, sessionMatches };
    }
    try {
      const tab = await chrome.tabs.get(job.ownedTabId);
      if (!is1688Url(tab?.url)) return { tab: null, proof, sessionMatches, invalidUrl: true };
      if (!memoryMatches) owners.set(job.jobId, job.ownerToken);
      return { tab, proof, sessionMatches };
    } catch {
      return { tab: null, proof, sessionMatches };
    }
  }

  async function ensureOwnedTab(generationRef) {
    let job = await live(generationRef);
    if (!hasOwnerToken(job.ownerToken)) {
      owners.delete(job.jobId);
      job = await mutate(generationRef, (current) => ({
        ...current,
        ownerToken: randomOwnerToken(),
        tabId: null,
        ownedTabId: null,
      }));
    } else {
      const claim = await tabClaim(job);
      if (claim.tab) return { job, tab: claim.tab, created: false };
      if (claim.sessionMatches) await clearSessionOwner(job);
      owners.delete(job.jobId);
      if (Number.isInteger(job.tabId) || Number.isInteger(job.ownedTabId)) {
        job = await mutate(generationRef, (current) => ({ ...current, tabId: null, ownedTabId: null }));
      }
    }

    await live(generationRef, "creating_tab");
    const tab = await chrome.tabs.create({ url: initialSearchUrl(job.strategy?.type), active: false });
    const pending = { jobId: generationRef.jobId, ownerToken: generationRef.ownerToken, tabId: tab.id };
    pendingOwners.set(generationRef.jobId, pending);
    try {
      job = await mutate(generationRef, (current) => ({
        ...current,
        tabId: tab.id,
        ownedTabId: tab.id,
        phase: "waiting_tab",
      }));
      pendingOwners.delete(job.jobId);
      owners.set(job.jobId, job.ownerToken);
      await writeSessionOwner(job);
      return { job, tab, created: true };
    } catch (error) {
      await closeFreshPendingTab(await load(generationRef.jobId), pending);
      if (pendingOwners.get(generationRef.jobId) === pending) pendingOwners.delete(generationRef.jobId);
      throw error;
    }
  }

  async function ownedForUse(generationRef, phase = "") {
    const job = await live(generationRef, phase);
    const claim = await tabClaim(job);
    if (!claim.tab) throw Error(OWNERSHIP_LOST);
    return { job, tab: claim.tab };
  }

  async function closeOwnedTab(job, generationRef) {
    if (!sameGeneration(job, generationRef) || !hasOwnerToken(job.ownerToken)) return false;
    const claim = await tabClaim(job);
    if (!claim.tab) return false;
    await chrome.tabs.remove(job.ownedTabId).catch(() => null);
    return true;
  }

  async function closeFreshPendingTab(job, pending) {
    if (!job || !pending || !hasOwnerToken(job.ownerToken)
      || job.jobId !== pending.jobId || job.ownerToken !== pending.ownerToken || !Number.isInteger(pending.tabId)) {
      return false;
    }
    let tab;
    try {
      tab = await chrome.tabs.get(pending.tabId);
    } catch {
      return false;
    }
    if (!is1688Url(tab?.url)) return false;
    await chrome.tabs.remove(pending.tabId).catch(() => null);
    return true;
  }

  function b64(bytes) {
    let text = "";
    for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
    return btoa(text);
  }

  async function downloadTrustedImage(url, supplier = false, signal) {
    if (!host(url, supplier)) throw Error("图片不在允许主机。");
    const response = await fetch(url, { signal });
    const finalUrl = s(response.url || url);
    const contentType = s(response.headers?.get("content-type")).toLowerCase();
    const length = s(response.headers?.get("content-length"));
    if (!response.ok || !host(finalUrl, supplier) || !/^image\/(jpeg|png|webp|gif)(;|$)/.test(contentType)
      || (length && (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > M))) {
      throw Error("图片响应无效。");
    }

    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > M) {
          await reader.cancel?.();
          throw Error("图片过大。");
        }
        chunks.push(chunk.value);
      }
      if (!total) throw Error("空图片。");
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > M) throw Error("图片大小无效。");
    }
    return { imageBase64: b64(bytes), mimeType: contentType.split(";")[0] };
  }

  function snap(value) {
    const nodes = Array.isArray(value?.nodes) ? value.nodes : [];
    return {
      pageUrl: s(value?.pageUrl),
      title: s(value?.title),
      capturedAt: s(value?.capturedAt) || new Date().toISOString(),
      nodes: nodes.filter((node) => node && node.visible !== false && !X.test(String(node.text || "") + " " + String(node.ariaLabel || ""))).slice(0, 2000),
    };
  }

  function verify(value) {
    return /登录|验证码|滑块|人机验证|captcha|sign in|log in/i.test([value.title, ...value.nodes.map((node) => node.text)].join(" "));
  }

  async function command(generationRef, name, payload = {}) {
    const deadline = Date.now() + 15000;
    let lastError;
    while (Date.now() < deadline) {
      const claim = await ownedForUse(generationRef);
      try {
        const response = await chrome.tabs.sendMessage(claim.tab.id, {
          type: "OZON_1688_PAGE_COMMAND_V1",
          command: name,
          payload,
        });
        await live(generationRef);
        if (response?.ok) return response.result;
        throw Error(s(response?.error) || "页面命令失败");
      } catch (error) {
        lastError = error;
        if (!/Receiving end does not exist|Could not establish connection/i.test(s(error.message))) throw error;
        await sleep(100);
      }
    }
    throw lastError || Error("页面命令超时");
  }

  async function waitForTabComplete(generationRef, requiredUrl = "", phase = "waiting_tab") {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const claim = await ownedForUse(generationRef, phase);
      const tab = claim.tab;
      if ((!tab.status || tab.status === "complete") && (!requiredUrl || s(tab.url).startsWith(requiredUrl))) return tab;
      if (chrome.tabs.onUpdated?.addListener) {
        await new Promise((resolve) => {
          const listener = (tabId, info, updatedTab) => {
            if (tabId === tab.id && info.status === "complete" && (!requiredUrl || s(updatedTab?.url).startsWith(requiredUrl))) {
              chrome.tabs.onUpdated.removeListener?.(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener?.(listener);
            resolve();
          }, 100);
        });
      } else {
        await sleep(100);
      }
    }
    throw Error("页面加载超时");
  }

  async function updateOwnedTab(generationRef, update) {
    if (update?.url && !is1688Url(update.url)) throw Error("拒绝导航到非 1688 页面。");
    const claim = await ownedForUse(generationRef);
    return chrome.tabs.update(claim.tab.id, update);
  }

  function fallback(candidate, page) {
    return {
      capturedAt: new Date().toISOString(),
      text: [page.title, ...page.nodes.map((node) => node.text)].map(s).filter(Boolean).join(" ").slice(0, 2000),
      imageUrl: s(candidate.imageUrl),
      sourceUrl: s(candidate.sourceUrl),
      screenshotStatus: "capture_failed",
    };
  }

  async function evidence(generationRef, candidate, page, signal) {
    try {
      const claim = await ownedForUse(generationRef);
      if (!claim.tab.active) return fallback(candidate, page);
      const dataUrl = await chrome.tabs.captureVisibleTab(claim.tab.windowId, { format: "jpeg", quality: 60 });
      await live(generationRef);
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(s(dataUrl));
      if (!match) return fallback(candidate, page);
      const raw = atob(match[1]);
      if (!raw || raw.length > E) return fallback(candidate, page);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      const response = await fetch(
        "http://127.0.0.1:17628/api/evidence/1688?taskId=" + encodeURIComponent(claim.job.taskId) + "&candidateId=" + encodeURIComponent(candidate.candidateId),
        {
          method: "POST",
          headers: { "x-ozon-agent": "local-ui-v1", "content-type": "image/jpeg" },
          body: bytes,
          signal,
        },
      );
      await live(generationRef);
      const localRef = s(response.ok ? (await response.json())?.localRef : "");
      return /^\/api\/evidence\/1688\/[a-f0-9]{32}$/i.test(localRef)
        ? { capturedAt: new Date().toISOString(), localRef }
        : fallback(candidate, page);
    } catch (error) {
      if (s(error.message) === CANCELLED || s(error.message) === STALE) throw error;
      return fallback(candidate, page);
    }
  }

  async function stable(generationRef) {
    let previous = "";
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const page = snap(await command(generationRef, "read_search_results"));
      const signature = JSON.stringify(page.nodes.slice(0, 12).map((node) => [node.href, node.text, node.imageUrl]));
      if (signature && signature === previous) return page;
      previous = signature;
      await sleep(50);
    }
    throw Error("搜索结果未稳定");
  }

  async function finishRun(generationRef, entry) {
    try {
      const job = await load(generationRef.jobId);
      if (job && sameGeneration(job, generationRef) && isTerminal(job)) {
        await closeOwnedTab(job, generationRef);
        await clearSessionOwner(job);
        const cleared = await change(job.jobId, (current) => ({
          ...current,
          tabId: null,
          ownedTabId: null,
        }), generationRef);
        generationRef.ownerToken = s(cleared.ownerToken);
        generationRef.revision = revisionOf(cleared);
        if (owners.get(job.jobId) === job.ownerToken) owners.delete(job.jobId);
      }
    } finally {
      if (controllers.get(generationRef.jobId) === entry.controller) controllers.delete(generationRef.jobId);
      if (runners.get(generationRef.jobId) === entry) runners.delete(generationRef.jobId);
    }
  }

  async function run(generationRef, entry) {
    try {
      const initial = await load(generationRef.jobId);
      if (!initial || !sameGeneration(initial, generationRef) || isTerminal(initial)) return initial;

      await transition(generationRef, "running");
      const owned = await ensureOwnedTab(generationRef);
      await waitForTabComplete(generationRef, owned.created ? initialSearchUrl(owned.job.strategy?.type) : "");
      let job = await live(generationRef);

      if (job.strategy.type === "verify_sku") {
        const url = offer(job.strategy.sourceUrl);
        await updateOwnedTab(generationRef, { url });
        await waitForTabComplete(generationRef, url);
        const page = snap(await command(generationRef, "probe"));
        if (offer(page.pageUrl) !== url) throw Error("SKU 页面身份不匹配");
        const result = await command(generationRef, "select_sku_option", { ...job.strategy, ...job.selection });
        if (!result?.selected) throw Error("SKU 未稳定选中");
        return transition(generationRef, "completed", { diagnostics: { code: "sku_verified" } });
      }

      const probe = snap(await command(generationRef, "probe"));
      if (verify(probe)) return transition(generationRef, "paused_platform_verification");

      if (job.strategy.type === "image" || job.strategy.type === "similar_supplier") {
        await mutate(generationRef, (current) => ({ ...current, phase: "downloading_image" }));
        const image = await downloadTrustedImage(job.strategy.sourceUrl, job.strategy.type === "similar_supplier", entry.controller?.signal);
        await live(generationRef);
        await command(generationRef, "submit_image_search", image);
      } else {
        await command(generationRef, "submit_keyword_search", { query: job.strategy.query });
      }

      const page = await stable(generationRef);
      if (verify(page)) return transition(generationRef, "paused_platform_verification");
      const candidates = root.Ozon1688Core.parseSearchSnapshot(page).filter((candidate) => !X.test(candidate.title)).slice(0, 12);
      if (!candidates.length) return transition(generationRef, "failed", { diagnostics: { code: "search_parser_failed" } });
      await mutate(generationRef, (current) => ({
        ...current,
        candidates,
        phase: "inspect_details",
        phaseStartedAt: new Date().toISOString(),
        currentDetailIndex: 0,
      }));

      const details = [];
      const detailCandidates = candidates.slice(0, 5);
      for (let detailIndex = 0; detailIndex < detailCandidates.length; detailIndex += 1) {
        const candidate = detailCandidates[detailIndex];
        await mutate(generationRef, (current) => ({
          ...current,
          phase: "inspect_details",
          phaseStartedAt: new Date().toISOString(),
          currentDetailIndex: detailIndex,
        }));
        await live(generationRef);
        await updateOwnedTab(generationRef, { url: candidate.sourceUrl });
        await waitForTabComplete(generationRef, candidate.sourceUrl, "");
        const detail = snap(await command(generationRef, "read_product_detail"));
        const capturedEvidence = await evidence(generationRef, candidate, detail, entry.controller?.signal);
        const parsed = root.Ozon1688Core.parseDetailSnapshot(detail);
        if (parsed.identityValid) details.push({ ...parsed, evidence: capturedEvidence });
        await mutate(generationRef, (current) => ({ ...current, detailCandidates: details }));
      }

      job = await live(generationRef);
      return details.length
        ? transition(generationRef, "completed")
        : transition(generationRef, "failed", { diagnostics: { code: "detail_parser_failed" } });
    } catch (error) {
      if (s(error.message) === CANCELLED || s(error.message) === STALE) return load(generationRef.jobId);
      const job = await load(generationRef.jobId);
      if (!job || !sameGeneration(job, generationRef) || isTerminal(job)) return job;
      try {
        return await transition(generationRef, "failed", {
          error: s(error.message),
          diagnostics: { code: "driver_error", message: s(error.message) },
        });
      } catch (transitionError) {
        if (s(transitionError.message) === STALE || s(transitionError.message) === CANCELLED) return load(generationRef.jobId);
        throw transitionError;
      }
    } finally {
      await finishRun(generationRef, entry);
    }
  }

  function schedule(job) {
    if (!job || isTerminal(job)) return Promise.resolve(job);
    const generationRef = generation(job);
    const existing = runners.get(generationRef.jobId);
    if (existing && sameGeneration(existing.generation, generationRef)) return existing.promise;
    const entry = {
      generation: generationRef,
      controller: typeof AbortController !== "undefined" ? new AbortController() : null,
      promise: null,
    };
    controllers.set(generationRef.jobId, entry.controller);
    runners.set(generationRef.jobId, entry);
    entry.promise = run(generationRef, entry);
    return entry.promise;
  }

  async function startJob(request = {}) {
    const created = await serial(async () => {
      const requestId = s(request.requestId).replace(/[^A-Za-z0-9._-]/g, "");
      const jobId = "1688-" + (requestId || Date.now());
      const existing = await load(jobId);
      if (existing) return { job: existing, shouldSchedule: false };

      const currentActive = (await chrome.storage.local.get(A))[A];
      const currentId = activeId(currentActive);
      const activeJob = currentId ? await load(currentId) : null;
      if (activeJob && !isTerminal(activeJob)) throw Error("已有一个 1688 找品任务正在运行。");

      const normalized = strategy(request.strategy);
      const sku = s(request.sku || s(request.taskId).replace(/^ozon-/, ""));
      if (!sku) throw Error("缺少 Ozon SKU。");
      const job = {
        jobId,
        ownerToken: randomOwnerToken(),
        taskId: "ozon-" + sku,
        strategy: { type: normalized.type, query: normalized.query, sourceUrl: normalized.sourceUrl },
        selection: {
          optionId: normalized.optionId,
          optionLabel: normalized.optionLabel,
          expectedPrice: normalized.expectedPrice,
        },
        status: "queued",
        phase: "queued",
        revision: 1,
        cancellationToken: 0,
        tabId: null,
        ownedTabId: null,
        candidates: [],
        detailCandidates: [],
        phaseStartedAt: null,
        currentDetailIndex: null,
        error: "",
        diagnostics: null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: "",
      };
      await put(job, true);
      return { job, shouldSchedule: true };
    });
    if (created.shouldSchedule) schedule(created.job);
    return clone(created.job);
  }

  async function cancelJob(id) {
    const result = await serial(async () => {
      const old = await load(id);
      if (!old) throw Error("1688 任务不存在。");
      if (isTerminal(old)) return { job: old, cancelled: false };
      const job = {
        ...old,
        status: "cancelled",
        phase: "cancelled",
        cancellationToken: Date.now(),
        error: "",
        revision: revisionOf(old) + 1,
        completedAt: new Date().toISOString(),
      };
      await put(job, false, old);
      return { job, cancelled: true };
    });
    if (!result.cancelled) return clone(result.job);

    controllers.get(result.job.jobId)?.abort();
    const generationRef = generation(result.job);
    await closeOwnedTab(result.job, generationRef);
    await clearSessionOwner(result.job);
    try {
      const cleared = await change(result.job.jobId, (current) => ({
        ...current,
        tabId: null,
        ownedTabId: null,
      }), generationRef);
      if (owners.get(result.job.jobId) === result.job.ownerToken) owners.delete(result.job.jobId);
      return clone(cleared);
    } catch (error) {
      if (s(error.message) !== STALE) throw error;
      return load(result.job.jobId);
    }
  }

  async function resumeJob(id) {
    const result = await serial(async () => {
      const job = await load(id);
      if (!job) throw Error("1688 任务不存在。");
      if (job.status !== "paused_platform_verification") return { job, shouldSchedule: false };

      const currentActive = (await chrome.storage.local.get(A))[A];
      const currentId = activeId(currentActive);
      const activeJob = currentId ? await load(currentId) : null;
      if (activeJob && !isTerminal(activeJob) && activeJob.jobId !== job.jobId) throw Error("已有一个 1688 找品任务正在运行。");

      const next = {
        ...job,
        status: "queued",
        phase: "queued",
        revision: revisionOf(job) + 1,
      };
      await put(next, true, job);
      return { job: next, shouldSchedule: true };
    });
    if (result.shouldSchedule) schedule(result.job);
    return clone(result.job);
  }

  async function restoreJobs() {
    const chosen = await serial(async () => {
      const all = await chrome.storage.local.get(null);
      const jobs = Object.entries(all)
        .filter(([storageKey, value]) => storageKey.startsWith(P) && value && ["queued", "running"].includes(value.status))
        .map(([, value]) => clone(value));
      const active = activeId(all[A]);
      let pick = jobs.find((job) => job.jobId === active);
      if (!pick) {
        pick = jobs.sort((left, right) => s(left.startedAt).localeCompare(s(right.startedAt))
          || s(left.updatedAt).localeCompare(s(right.updatedAt))
          || left.jobId.localeCompare(right.jobId))[0];
      }
      for (const job of jobs) {
        if (job === pick) continue;
        const previous = clone(job);
        job.status = "paused_platform_verification";
        job.phase = "paused_platform_verification";
        job.diagnostics = { code: "restore_conflict" };
        job.revision = revisionOf(job) + 1;
        await put(job, false, previous);
      }
      return pick ? await put(pick, true) : null;
    });
    if (chosen) schedule(chosen);
  }

  chrome.runtime.onStartup?.addListener(() => void restoreJobs());
  chrome.runtime.onInstalled?.addListener(() => void restoreJobs());
  void restoreJobs();

  root.Ozon1688Background = Object.freeze({
    startJob,
    getJob: load,
    cancelJob,
    resumeJob,
    __test: Object.freeze({
      downloadTrustedImage,
      restoreJobs,
      MAX_SEARCH_CANDIDATES: 12,
      MAX_DETAIL_CANDIDATES: 5,
    }),
  });
})(globalThis);
