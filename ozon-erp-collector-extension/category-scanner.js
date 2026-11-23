(function installOzonCategoryScanner(globalScope) {
  const MAX_SAMPLES = 400;
  const MAX_SCROLLS = 400;
  const LIST_WAIT_POLLS = 30;
  const LIST_WAIT_MS = 1000;
  const MAX_REVIEW_PASSES = 2;
  const SELECTORS = [
    '[data-widget="tileGridDesktop"]', '.tileGridDesktop',
    '[data-widget="infiniteVirtualPaginator"]', '.infiniteVirtualPaginator',
    '[data-widget="searchResultsV2"]', '[data-widget="searchResults"]',
  ];
  const forbidden = /recommend|suggest|similar|related|recommendation|header/i;
  const recommendationHeading = /^(您可能喜欢|猜你喜欢|你可能喜欢|Вам может понравиться|Возможно, вам понравится|Рекомендуем также|You may also like)$/i;
  const headingSelector = 'h1,h2,h3,h4,[role="heading"],.tsHeadline600Large';

  function textOf(el) { return String(el?.innerText || el?.textContent || '').trim(); }
  function verificationDetail(doc) {
    const title=String(doc?.title||'').trim();
    const body=textOf(doc?.body).slice(0,3000);
    const text=`${title}\n${body}`;
    // Keep explicit access and security prompts authoritative, including
    // when a previously rendered catalog is still visible underneath.
    if(/проверка безопасности|captcha/i.test(text))return 'security_prompt';
    if(/доступ ограничен|access denied/i.test(text))return 'access_restricted';
    // A product SKU or currency amount is not an HTTP error. Recognize the
    // numeric status only in page-level or explicit error context.
    const heading=textOf(doc?.querySelector?.('h1'));
    if(/\b403\b/.test(title)||/^403(?:\s+(?:forbidden|access denied))?$/i.test(heading)||/^\s*403\s*(?:\r?\n|$)/.test(body)||/\b(?:http(?:\s+error)?|error|status)\s*[:：]?\s*403\b|\b403\s+forbidden\b|ошибка\s*403\b/i.test(body))return 'http_denied';
    return '';
  }
  function visible(el) {
    if (!el || el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
    const style = globalScope.getComputedStyle?.(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = el.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }
  function isForbidden(el) {
    for (let node = el; node; node = node.parentElement) {
      const identity = `${node.id || ''} ${node.className?.baseVal || node.className || ''} ${node.getAttribute?.('data-widget') || ''}`;
      if (forbidden.test(identity)) return true;
      if (String(node.tagName).toUpperCase() === 'HEADER') return true;
    }
    return false;
  }
  function pickList(doc) {
    const candidates = new Set();
    for (const selector of SELECTORS) for (const el of doc.querySelectorAll(selector)) {
      if (!visible(el) || isForbidden(el)) continue;
      // China-zone recommendations reuse the catalog grid widget. The real
      // page labels a separate island with a headline span before its cards.
      const island = el.closest?.('[data-widget="island"]');
      if (island) {
        const firstProduct = [...island.querySelectorAll('a[href*="/product/"]')].find(visible);
        const heading = [...island.querySelectorAll(headingSelector)].find(h => visible(h) && recommendationHeading.test(textOf(h)));
        if (heading && firstProduct && (heading.compareDocumentPosition(firstProduct) & 4)) continue;
      }
      candidates.add(el);
    }
    // The explicit paginator owns virtual rows even when later rows do not
    // repeat the tileGridDesktop marker. Do not expand to an arbitrary parent.
    const paginators = [...candidates].filter(el => el.getAttribute?.('data-widget') === 'infiniteVirtualPaginator');
    if (paginators.length === 1 && [...candidates].every(el => el.contains(paginators[0]) || paginators[0].contains(el))) return paginators[0];
    const lists = [...candidates].filter((el) => [...candidates].every((other) => other === el || !el.contains(other)));
    if (lists.length === 1) return lists[0];
    // A catalog may virtualize its results into several sibling grids. Only
    // accept them together inside a single explicit catalog/paginator wrapper.
    if(lists.length>1){
      const wrappers=[...candidates].filter(el=>
        /^(searchResultsV2|searchResults|infiniteVirtualPaginator)$/.test(el.getAttribute?.('data-widget')||'')||
        String(el.className||'').split(/\s+/).includes('infiniteVirtualPaginator'));
      const containing=wrappers.filter(el=>lists.every(child=>el.contains(child)));
      const innermost=containing.filter(el=>!containing.some(other=>other!==el&&el.contains(other)));
      if(innermost.length===1)return innermost[0];
    }
    return null;
  }
  function readCards(list, core, categoryUrl, options = {}) {
    if (!list) return { products: [], observedSkus: [], pendingSkus: [], pendingCount: 0, available: false };
    const products = [], observed = new Set(),pending=new Set();
    const boundary=[...(list.querySelectorAll?.(headingSelector)||[])].find(el=>recommendationHeading.test(textOf(el))&&visible(el));
    const productSku=href=>{try{const u=new URL(href);return u.origin==='https://www.ozon.ru'&&!u.username&&!u.password?u.pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/)?.[1]||'':''}catch{return ''}};
    const findCard=(anchor,sku)=>{
      let card=anchor;for(let depth=0;card&&card!==list&&depth<11;depth++,card=card.parentElement){
        const raw=textOf(card);if(raw.length>2400)break;
        const panelSkus=new Set([...raw.matchAll(/SKU\s*[:：]\s*(\d+)/g)].map(m=>m[1]));
        const linkSkus=new Set([sku,...[...(card.querySelectorAll?.('a[href*="/product/"]')||[])].map(a=>productSku(a.href)).filter(Boolean)]);
        if(panelSkus.size>1||linkSkus.size>1)break;
        if(panelSkus.size===1&&panelSkus.has(sku)&&raw.includes('rFBS佣金：')&&raw.length>=40)return {card,raw};
      }return null;
    };
    const anchors = [...list.querySelectorAll('a[href*="/product/"]')];
    for (const anchor of anchors) {
      if (!visible(anchor) || isForbidden(anchor)||(boundary&&boundary.compareDocumentPosition&&(boundary.compareDocumentPosition(anchor)&4))) continue;
      let parsedUrl;
      try { parsedUrl = new URL(anchor.href, globalScope.location?.href); } catch { continue; }
      if (parsedUrl.origin !== 'https://www.ozon.ru' || !/^\/product\//.test(parsedUrl.pathname)) continue;
      const link = globalScope.OzonStoreScannerCore?.canonicalProductLink(anchor.href) || '',sku=productSku(link);
      if(!sku)continue;const scoped=findCard(anchor,sku);if(!scoped){if(!observed.has(sku))pending.add(sku);continue;}
      const {card,raw}=scoped;
      const parsed = globalScope.OzonStoreScannerCore?.parseCardText(raw);
      if (!parsed?.sku || !/\/product\//.test(link)) {if(!observed.has(sku))pending.add(sku);continue;}
      const linkSku = new URL(link, globalScope.location?.href).pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/)?.[1];
      if (linkSku !== String(parsed.sku)) continue;
      if (!(globalScope.OzonCategoryCore.capturedPrice(parsed.price) > 0)||!parsed.competitorReady||!parsed.commissions?.length) {if(!observed.has(sku))pending.add(sku);continue;}
      const name = [anchor,...(card.querySelectorAll?.('a[href*="/product/"]')||[])].filter(a=>productSku(a.href)===sku).map(a=>(textOf(a)||a.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim()).filter(Boolean).sort((a,b)=>b.length-a.length)[0]||'';
      if (!name) { pending.add(sku); continue; }
      observed.add(String(parsed.sku));
      pending.delete(sku);
      const rawRiskText = `${parsed.category}\n${name}\n${raw}`;
      const shippingRisk = globalScope.OzonStoreScannerCore?.classifyShippingRisk(rawRiskText) || {};
      const product = { sku: String(parsed.sku), name, link, qualified: Boolean(parsed.qualified), price: parsed.price,
        commissions: parsed.commissions || [], monthlySales: parsed.monthlySales, fulfillment: parsed.fulfillment,
        dimensions: parsed.dimensions, weight: parsed.weight, competitor: parsed.competitor,
        competitorReady: Boolean(parsed.competitorReady), shippingRisk, category: parsed.category, rawRiskText };
      if (parsed.qualified && core.qualifiedProduct?.(product, options)) products.push(product);
    }
    return { products, observedSkus: [...observed], pendingSkus:[...pending],pendingCount:pending.size, available: anchors.length > 0 };
  }
  function pagination(doc, core, categoryUrl) {
    const links = [...doc.querySelectorAll('a[rel="next"], a[data-testid*="pagination-next"], a[href*="page="]')]
      .filter((a) => visible(a) && !isForbidden(a) && a.getAttribute?.('aria-disabled')!=='true' && (a.getAttribute?.('rel')==='next'||/next|след|далее|вперед|›|→/i.test(`${a.getAttribute?.('aria-label') || ''} ${textOf(a)}`)));
    const page=Number(new URL(categoryUrl).searchParams.get('page')||1);
    const href = links.map((a) => core.paginationUrl?.(a.href, categoryUrl)).find(url=>url&&Number(new URL(url).searchParams.get('page'))===page+1);
    return href || '';
  }
  function createReader(doc, core) { return { read: (url, options, list=pickList(doc)) => readCards(list, core, url, options), next: (url) => pagination(doc, core, url), pickList: () => pickList(doc) }; }
  globalScope.OzonCategoryScanner = Object.freeze({ createReader, readCards, pickList, MAX_SAMPLES, MAX_SCROLLS });

  const core = globalScope.OzonCategoryCore;
  if (!core || !globalScope.chrome?.runtime?.onMessage || !core.exactPageUrl(globalScope.location?.href || '') || globalScope.__ozonCategoryListenerInstalled) return;
  globalScope.__ozonCategoryListenerInstalled = true;
  let activeRun = null;
  globalScope.chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'categoryScanStop') { if(activeRun?.batchId===message.batchId&&activeRun?.attemptId===message.attemptId)activeRun=null; reply?.({ ok: true }); return false; }
    if (message?.type !== 'categoryScanStart') return false;
    if(activeRun?.batchId===message.batchId&&activeRun?.attemptId===message.attemptId){reply?.({ok:true,accepted:true});return false;}
    const run={batchId:message.batchId,attemptId:message.attemptId};activeRun=run;
    reply?.({ ok: true, accepted: true, batchId: message.batchId, attemptId: message.attemptId });
    void scan(message,run).catch(() => {if(activeRun===run)return done(message, false, 'reader_error')}).finally(()=>{if(activeRun===run)activeRun=null});
    return false;
  });
  async function scan(msg,run) {
    const baseUrl = core.normalizeUrl(msg.categoryUrl);
    const url = core.exactPageUrl(globalScope.location.href);
    if (!core.samePage(globalScope.location.href, baseUrl) || !url || url!==msg.categoryUrl) return done(msg, false, 'wrong_category_page');
    const reader = createReader(globalScope.document, core), sent=new Set(),observed = new Set(msg.observedSkus||[]),pending=new Set(msg.pendingSkus||[]);
    let scrolls = 0, stable = 0, bottomStable = 0, lastHeight = -1, noListPolls = 0,reviewPasses=0;
    let recheckFromTop=!!msg.recheckFromTop;
    const wait=ms=>new Promise(resolve=>globalScope.setTimeout(resolve,ms));
    const reportWait=reason=>new Promise(resolve=>globalScope.chrome.runtime.sendMessage({type:'categoryWait',batchId:msg.batchId,attemptId:msg.attemptId,categoryUrl:url,reason},response=>resolve(response||{})));
    for (let sample = 0; sample < MAX_SAMPLES && scrolls <= MAX_SCROLLS; sample++) {
      if (activeRun!==run) return;
      if(core.exactPageUrl(globalScope.location.href)!==url)return done(msg,false,'wrong_category_page');
      const verification=verificationDetail(globalScope.document);
      if(verification)return done(msg,false,'manual-verification','',verification);
      if(recheckFromTop){recheckFromTop=false;globalScope.scrollTo(0,0);}
      let list = reader.pickList();
      const result=reader.read(url,msg.options||{},list);
      const endMarker = list?.querySelector?.('[data-testid*="no-more"], [data-testid="end-of-list"], [data-testid="catalog-list-end"]');
      if(!list||(!result.available&&!visible(endMarker))){
        if(noListPolls>=LIST_WAIT_POLLS)return done(msg,false,'catalog_list_unavailable');
        if(noListPolls%5===0){const ack=await reportWait('catalog_loading');if(ack.ok!==true||activeRun!==run)return;}
        noListPolls++;stable=0;bottomStable=0;lastHeight=-1;
        await wait(LIST_WAIT_MS);sample--;continue;
      }
      noListPolls = 0;
      for(const sku of result.pendingSkus)if(!observed.has(sku))pending.add(sku);
      for(const sku of result.observedSkus){observed.add(sku);pending.delete(sku)}
      const products=result.products.filter(p=>!sent.has(p.sku));
      const categoryName=textOf(globalScope.document.querySelector?.('h1')).slice(0,120);
      const ack = await new Promise((resolve) => globalScope.chrome.runtime.sendMessage({ type: 'categorySample', batchId: msg.batchId, attemptId: msg.attemptId, categoryUrl: url,categoryName,products,observedSkus: result.observedSkus, pendingSkus:[...pending],pendingCount:pending.size }, (response) => resolve(response || {})));
      if (ack.ok !== true) return done(msg, false, 'sample_not_persisted');
      if(ack.stop===true||ack.stopped===true||activeRun!==run)return;
      for(const p of products)sent.add(p.sku);
      const height = globalScope.document.documentElement?.scrollHeight || 0;
      const atBottom = globalScope.innerHeight + globalScope.scrollY >= height - 8;
      if (atBottom && height === lastHeight) { stable++; bottomStable++; } else { stable = 0; bottomStable = 0; }
      lastHeight = height;
      const nextUrl = atBottom && bottomStable >= 3 ? reader.next(url) : '';
      const reachedEnd = atBottom && stable >= 2 && bottomStable >= 3 && visible(endMarker);
      if(nextUrl||reachedEnd){
        if(pending.size&&reviewPasses<MAX_REVIEW_PASSES){
          reviewPasses++;const reviewAck=await reportWait('review_pending');if(reviewAck.ok!==true||activeRun!==run)return;
          globalScope.scrollTo(0,0);stable=0;bottomStable=0;lastHeight=-1;
          await wait(1600);continue;
        }
        if(pending.size)return done(msg,false,'pending_cards');
        return nextUrl?done(msg,false,'next_page_available',nextUrl):done(msg,true,'visible_catalog_end');
      }
      if (sample === MAX_SAMPLES - 1 || scrolls >= MAX_SCROLLS) break;
      globalScope.scrollBy(0, Math.max(200, Math.floor(globalScope.innerHeight * 0.65))); scrolls++;
      await new Promise((resolve) => globalScope.setTimeout(resolve, 1600));
    }
    return done(msg, false, 'scan_bound_reached');
  }
  function done(msg, complete, reason, nextUrl = '', verification = '') {
    const requested = core.exactPageUrl(msg.categoryUrl);
    const result = { type: 'categoryPageDone', batchId: msg.batchId, attemptId: msg.attemptId, categoryUrl: requested, ...(nextUrl ? { nextUrl } : {}), ...(verification?{verificationDetail:verification}:{}), complete, reason };
    return new Promise((resolve) => globalScope.chrome.runtime.sendMessage(result, () => resolve(result)));
  }
})(globalThis);
