(function installOzonCategoryScanner(globalScope) {
  const MAX_SAMPLES = 400;
  const MAX_SCROLLS = 400;
  const LIST_WAIT_POLLS = 30;
  const LIST_WAIT_MS = 1000;
  const BACKGROUND_SETTLE_MS=4000, FOREGROUND_SETTLE_MS=1600, BACKGROUND_BOUNDARY_MS=20000, BACKGROUND_BOUNDARY_POLLS=5, BACKGROUND_RETRY_MS=10000;
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
    const loginHeading=/^(?:登录(?:\s*Ozon|账号)?|请先登录|sign in(?: to Ozon)?|log in(?: to Ozon)?|войти(?: в Ozon)?|вход(?: в Ozon)?)$/i;
    if(loginHeading.test(heading)) return 'login_required';
    for(const dialog of doc.querySelectorAll?.('[role="dialog"],dialog[open]')||[]){
      if(visible(dialog) && loginHeading.test(textOf(dialog.querySelector?.('h1,h2,h3,[role="heading"]')))) return 'login_required';
    }
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
  function mainCandidates(doc) {
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
    return candidates;
  }
  function pickList(doc, candidates=mainCandidates(doc)) {
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
    if (!list) return { products: [], observedSkus: [], discoverSkus:[], erpReadySkus:[], labelHitSkus:[], pendingSkus: [], pendingCount: 0, skuDecisions:{}, available: false };
    const products = [], observed = new Set(), discovered = new Set(), erpReady = new Set(), labelHit = new Set(),pending=new Set(),skuDecisions={},decisionRank={erp_pending:0,no_label:1,data_pending:2,price_outside:3,transport_blocked:3,eligible:4};
    const decide=(sku,reason)=>{if(!(sku in skuDecisions)||(decisionRank[reason]??0)>(decisionRank[skuDecisions[sku]]??0))skuDecisions[sku]=reason};
    const boundary=[...(list.querySelectorAll?.(headingSelector)||[])].find(el=>recommendationHeading.test(textOf(el))&&visible(el));
    const productSku=href=>{try{const u=new URL(href);return u.origin==='https://www.ozon.ru'&&!u.username&&!u.password?u.pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/)?.[1]||'':''}catch{return ''}};
    const findCard=(anchor,sku)=>{
      let card=anchor;for(let depth=0;card&&card!==list&&depth<11;depth++,card=card.parentElement){
        if(!visible(card))continue;
        const raw=textOf(card);if(raw.length>3200)break;
        const productAnchors=[...(card.querySelectorAll?.('a[href*="/product/"]')||[])].filter(visible);
        const linkSkus=new Set(productAnchors.map(a=>productSku(a.href)).filter(Boolean));
        // Never let a stale SKU or ERP fields from an adjacent product become
        // evidence for this link. A candidate boundary owns exactly one link.
        if(linkSkus.size>1)break;
        if(linkSkus.size!==1||!linkSkus.has(sku))continue;
        const panelSkus=new Set([...raw.matchAll(/SKU\s*[:：]\s*(\d+)/g)].map(m=>m[1]));
        if(panelSkus.size>1||(panelSkus.size===1&&!panelSkus.has(sku)))continue;
        const brandCount=[...raw.matchAll(/毛子\s*ERP/ig)].length;
        if(brandCount>1)continue;
        const legacyExplicitSku=brandCount===0&&panelSkus.size===1&&panelSkus.has(sku)&&/rFBS佣金\s*[:：]/.test(raw);
        if(brandCount!==1&&!legacyExplicitSku)continue;
        const fieldLine=(label)=>raw.match(new RegExp(`(?:^|\\n)[ \\t]*${label}[ \\t]*[:：]?[ \\t]*([^\\n]*)`,'i'))?.[1]?.trim()||'';
        const monthly=fieldLine('月销量');
        const fulfillment=fieldLine('发货模式');
        const loading=/(?:加载中|正在加载|loading|загрузка)/i.test(raw);
        const realValue=value=>!!value&&!/^(?:暂无数据|暂无|无|--|—|-)$/i.test(value);
        const supportedFulfillment=/(?:^|[\s,，/])(?:FBO|FBS|rFBS)(?:$|[\s,，/])/i.test(fulfillment);
        const panelReady=realValue(monthly)&&/\d/.test(monthly)&&supportedFulfillment&&!loading;
        const descendants=[];const visit=node=>{for(const child of node?.children||[]){descendants.push(child);visit(child)}};visit(card);
        const exactRows=descendants.filter(node=>visible(node)&&/^选品标签\s*[:：]\s*符合要求$/.test(textOf(node).replace(/\s+/g,' ').trim()));
        const exactBadge=exactRows.some(row=>{
          for(let panel=row.parentElement;panel&&panel!==card;panel=panel.parentElement){
            if(!visible(panel))return false;
            if(!/毛子\s*ERP/i.test(textOf(panel)))continue;
            const panelRows=exactRows.filter(other=>panel.contains?.(other));
            return panelRows.length===1&&[...textOf(panel).matchAll(/毛子\s*ERP/ig)].length===1;
          }
          return false;
        });
        const legacyRows=descendants.filter(node=>visible(node)&&/^符合要求$/.test(textOf(node).trim())&&!/^选品标签/.test(textOf(node).trim()));
        const legacyBadge=legacyExplicitSku&&legacyRows.some(row=>{
          for(let parent=row.parentElement;parent&&parent!==card;parent=parent.parentElement)if(String(parent.tagName||'').toUpperCase()==='A')return false;
          return true;
        });
        return {card,raw,panelReady,qualified:exactBadge||Boolean(legacyBadge)};
      }return null;
    };
    const anchors = [...list.querySelectorAll('a[href*="/product/"]')];
    for (const anchor of anchors) {
      if (!visible(anchor) || isForbidden(anchor)||(boundary&&boundary.compareDocumentPosition&&(boundary.compareDocumentPosition(anchor)&4))) continue;
      let parsedUrl;
      try { parsedUrl = new URL(anchor.href, globalScope.location?.href); } catch { continue; }
      if (parsedUrl.origin !== 'https://www.ozon.ru' || !/^\/product\//.test(parsedUrl.pathname)) continue;
      const link = globalScope.OzonStoreScannerCore?.canonicalProductLink(anchor.href) || '',sku=productSku(link);
      if(!sku)continue;
      discovered.add(sku);
      decide(sku,'erp_pending');
      const scoped=findCard(anchor,sku);if(!scoped){if(!observed.has(sku))pending.add(sku);continue;}
      const {card,raw,panelReady,qualified}=scoped;
      const parsed = globalScope.OzonStoreScannerCore?.parseCardText(raw);
      if (!parsed || !/\/product\//.test(link)) {if(!observed.has(sku))pending.add(sku);continue;}
      // Category tiles often render the ERP fields without a colon. Keep this
      // fallback local to the already isolated panel and each labeled line.
      const lineValue=(label)=>raw.match(new RegExp(`(?:^|\\n)[ \\t]*${label}[ \\t]*[:：]?[ \\t]*([^\\n]+)`, 'i'))?.[1]?.trim()||'';
      const commissionLine=raw.match(/(?:^|\n)[ \t]*rFBS佣金[ \t]*[:：]?[ \t]*([^\n]+)/i)?.[1]||'';
      const commissions=[...commissionLine.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m=>`${m[1]}%`).slice(0,3);
      parsed.qualified=qualified;
      parsed.monthlySales ||= lineValue('月销量');
      parsed.fulfillment ||= lineValue('发货模式');
      parsed.dimensions ||= lineValue('长\\s*宽\\s*高');
      parsed.weight ||= lineValue('重\\s*量');
      if(!parsed.commissions?.length)parsed.commissions=commissions;
      const linkSku = new URL(link, globalScope.location?.href).pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/)?.[1];
      if(linkSku!==sku||(parsed.sku&&linkSku!==String(parsed.sku)))continue;
      if(parsed.qualified)labelHit.add(sku);
      if(!panelReady){if(!observed.has(sku))pending.add(sku);continue;}
      erpReady.add(sku);
      const name = [anchor,...(card.querySelectorAll?.('a[href*="/product/"]')||[])].filter(a=>productSku(a.href)===sku).map(a=>(textOf(a)||a.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim()).filter(Boolean).sort((a,b)=>b.length-a.length)[0]||'';
      if(!parsed.qualified){decide(sku,'no_label');observed.add(sku);pending.delete(sku);continue;}
      decide(sku,'data_pending');
      if (!name) { pending.add(sku); continue; }
      const rawRiskText = `${parsed.category}\n${name}\n${raw}`;
      const shippingRisk = globalScope.OzonStoreScannerCore?.classifyShippingRisk(rawRiskText) || {};
      const product = { sku, name, link, qualified: Boolean(parsed.qualified), price: parsed.price,
        commissions: parsed.commissions || [], monthlySales: parsed.monthlySales, fulfillment: parsed.fulfillment,
        dimensions: parsed.dimensions, weight: parsed.weight, competitor: parsed.competitor,
        competitorReady: Boolean(parsed.competitorReady), shippingRisk, category: parsed.category, rawRiskText };
      const dimensionCount=[...String(parsed.dimensions||'').matchAll(/\d+(?:[.,]\d+)?/g)].length;
      const weightValue=String(parsed.weight||'');
      const complete=globalScope.OzonCategoryCore.capturedPrice(parsed.price)>0&&parsed.commissions?.length>0&&parsed.monthlySales&&parsed.fulfillment&&dimensionCount>=3&&/\d/.test(weightValue)&&!/(?:加载中|暂无|--|—|-)/i.test(`${parsed.dimensions} ${weightValue}`)&&name;
      if(!complete){if(!observed.has(sku))pending.add(sku);continue;}
      observed.add(sku);pending.delete(sku);
      if(parsed.qualified){
        if(core.qualifiedProduct?.(product,options)){decide(sku,'eligible');products.push(product);}
        else if(!['clear','land_only'].includes(shippingRisk?.type)||globalScope.OzonStoreScannerCore?.classifyShippingRisk([product.name,product.category,product.rawRiskText].filter(Boolean).join('\n'))?.type==='suspected_prohibited')decide(sku,'transport_blocked');
        else if(!globalScope.OzonCategoryCore.priceAllowed(product,options))decide(sku,'price_outside');
      }
    }
    return { products, observedSkus: [...observed], discoverSkus:[...discovered], erpReadySkus:[...erpReady], labelHitSkus:[...labelHit], pendingSkus:[...pending],pendingCount:pending.size, skuDecisions, available: anchors.length > 0 };
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
  let nativeHidden=false;
  const pageReportedHidden=()=>globalScope.document?.hidden===true;
  const pageFocused=()=>typeof globalScope.document?.hasFocus==='function'?Boolean(globalScope.document.hasFocus()):undefined;
  const hidden=()=>pageReportedHidden()||nativeHidden;
  const pageState=()=>({pageHidden:hidden(),pageReportedHidden:pageReportedHidden(),...(pageFocused()===undefined?{}:{pageFocused:pageFocused()})});
  function waitForRun(run,ms){return new Promise(resolve=>{
    const readyAt=Date.now()+ms;let timer;
    const finish=()=>{if(run.wait?.finish!==finish)return;globalScope.clearTimeout?.(timer);run.wait=null;resolve()};
    run.wait={finish,wake:()=>{if(Date.now()>=readyAt)finish()}};timer=globalScope.setTimeout(finish,ms);
  })}
  function cancelRun(){const run=activeRun;activeRun=null;run?.wait?.finish()}
  globalScope.document?.addEventListener?.('visibilitychange',()=>activeRun?.wait?.wake());
  globalScope.document?.addEventListener?.('resume',()=>activeRun?.wait?.wake());
  globalScope.chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'categoryScanStop') { if(activeRun?.batchId===message.batchId&&activeRun?.attemptId===message.attemptId)cancelRun(); reply?.({ ok: true }); return false; }
    if(message?.type==='categoryScanTick'){
      const running=!!activeRun&&activeRun.batchId===message.batchId&&activeRun.attemptId===message.attemptId;
      if(running&&typeof message.pageNativeHidden==='boolean')nativeHidden=message.pageNativeHidden;
      reply?.({ok:true,running,...pageState()});if(running)activeRun.wait?.wake();return false;
    }
    if (message?.type !== 'categoryScanStart') return false;
    if(activeRun?.batchId===message.batchId&&activeRun?.attemptId===message.attemptId){reply?.({ok:true,accepted:true});return false;}
    cancelRun();nativeHidden=message.pageNativeHidden===true;const run={batchId:message.batchId,attemptId:message.attemptId,wait:null};activeRun=run;
    reply?.({ ok: true, accepted: true, batchId: message.batchId, attemptId: message.attemptId });
    void scan(message,run).catch(() => {if(activeRun===run)return done(message, false, 'reader_error')}).finally(()=>{if(activeRun===run)activeRun=null});
    return false;
  });
  async function scan(msg,run) {
    const baseUrl = core.normalizeUrl(msg.categoryUrl);
    const url = core.exactPageUrl(globalScope.location.href);
    if (!core.samePage(globalScope.location.href, baseUrl) || !url || url!==msg.categoryUrl) return done(msg, false, 'wrong_category_page');
    const reader = createReader(globalScope.document, core), sent=new Set(),observed = new Set(msg.observedSkus||[]),pending=new Set(msg.pendingSkus||[]);
    let scrolls = 0, stable = 0, bottomStable = 0, lastHeight = -1, noListPolls = 0,ambiguousPolls=0,reviewPasses=0,bottomSince=0,previousHidden=hidden(),zeroNewObserved=0;
    let recheckFromTop=!!msg.recheckFromTop;
    const wait=ms=>waitForRun(run,ms);
    const settle=()=>hidden()?BACKGROUND_SETTLE_MS:FOREGROUND_SETTLE_MS;
    const reportWait=reason=>new Promise(resolve=>globalScope.chrome.runtime.sendMessage({type:'categoryWait',batchId:msg.batchId,attemptId:msg.attemptId,categoryUrl:url,reason,...pageState()},response=>resolve(response||{})));
    const waitStopped=ack=>ack.ok!==true||ack.stop===true||ack.stopped===true||activeRun!==run;
    for (let sample = 0; sample < MAX_SAMPLES && scrolls <= MAX_SCROLLS; sample++) {
      if (activeRun!==run) return;
      if(core.exactPageUrl(globalScope.location.href)!==url)return done(msg,false,'wrong_category_page');
      const pageHidden=hidden();if(previousHidden&&!pageHidden){noListPolls=0;stable=0;bottomStable=0;bottomSince=0;reviewPasses=0}previousHidden=pageHidden;
      const verification=verificationDetail(globalScope.document);
      if(verification)return done(msg,false,'manual-verification','',verification);
      if(recheckFromTop){recheckFromTop=false;globalScope.scrollTo(0,0);}
      const candidates = mainCandidates(globalScope.document);
      const list = pickList(globalScope.document,candidates);
      if(!list&&candidates.size>1){
        noListPolls=0;ambiguousPolls++;stable=0;bottomStable=0;lastHeight=-1;
        if(ambiguousPolls>=LIST_WAIT_POLLS)return done(msg,false,'catalog_list_unavailable');
        const ack=await reportWait('list_ambiguous');if(waitStopped(ack))return;
        await wait(pageHidden?BACKGROUND_RETRY_MS:LIST_WAIT_MS);sample--;continue;
      }
      ambiguousPolls=0;
      const result=reader.read(url,msg.options||{},list);
      const endMarker = list?.querySelector?.('[data-testid*="no-more"], [data-testid="end-of-list"], [data-testid="catalog-list-end"]');
      if(!list||(!result.available&&!visible(endMarker))){
        if(noListPolls>=LIST_WAIT_POLLS&&!pageHidden)return done(msg,false,'catalog_list_unavailable');
        if(noListPolls>=LIST_WAIT_POLLS)noListPolls=0;
        if(noListPolls%5===0){const ack=await reportWait('catalog_loading');if(waitStopped(ack))return;}
        noListPolls++;stable=0;bottomStable=0;lastHeight=-1;
        await wait(pageHidden?BACKGROUND_SETTLE_MS:LIST_WAIT_MS);sample--;continue;
      }
      noListPolls = 0;
      const newObserved=result.observedSkus.some(sku=>!observed.has(sku));
      for(const sku of result.pendingSkus)if(!observed.has(sku))pending.add(sku);
      for(const sku of result.observedSkus){observed.add(sku);pending.delete(sku)}
      const products=result.products.filter(p=>!sent.has(p.sku));
      const categoryName=textOf(globalScope.document.querySelector?.('h1')).slice(0,120);
      const ack = await new Promise((resolve) => globalScope.chrome.runtime.sendMessage({ type: 'categorySample', batchId: msg.batchId, attemptId: msg.attemptId, categoryUrl: url,categoryName,products,observedSkus: result.observedSkus,discoverSkus:result.discoverSkus,erpReadySkus:result.erpReadySkus,labelHitSkus:result.labelHitSkus,pendingSkus:[...pending],pendingCount:pending.size,skuDecisions:result.skuDecisions,...pageState() }, (response) => resolve(response || {})));
      if(activeRun!==run)return;
      if (ack.ok !== true) return done(msg, false, 'sample_not_persisted');
      if(ack.stop===true||ack.stopped===true||activeRun!==run)return;
      if(typeof ack.pageNativeHidden==='boolean')nativeHidden=ack.pageNativeHidden;
      for(const p of products)sent.add(p.sku);
      if(pageHidden&&result.available){if(newObserved)zeroNewObserved=0;else zeroNewObserved++;}
      const height = globalScope.document.documentElement?.scrollHeight || 0;
      const atBottom = globalScope.innerHeight + globalScope.scrollY >= height - 8;
      if (atBottom && height === lastHeight) { stable++; bottomStable++;if(!bottomSince)bottomSince=Date.now(); } else { stable = 0; bottomStable = 0;bottomSince=0; }
      lastHeight = height;
      const confirmedBottom=atBottom&&bottomStable>=(pageHidden?BACKGROUND_BOUNDARY_POLLS:3)&&(!pageHidden||Date.now()-bottomSince>=BACKGROUND_BOUNDARY_MS);
      const nextUrl = confirmedBottom ? reader.next(url) : '';
      const reachedEnd = confirmedBottom && stable >= 2 && visible(endMarker);
      if(nextUrl||reachedEnd){
        if(pending.size&&reviewPasses<MAX_REVIEW_PASSES){
          reviewPasses++;const reviewAck=await reportWait('review_pending');if(waitStopped(reviewAck))return;
          globalScope.scrollTo(0,0);stable=0;bottomStable=0;bottomSince=0;lastHeight=-1;
          await wait(settle());continue;
        }
        if(pending.size&&pageHidden){const waiting=await reportWait('review_pending');if(waitStopped(waiting))return;await wait(BACKGROUND_RETRY_MS);sample--;continue;}
        if(pending.size)return done(msg,false,'pending_cards');
        return nextUrl?done(msg,false,'next_page_available',nextUrl):done(msg,true,'visible_catalog_end');
      }
      // Hidden lazy-loaded lists can stop briefly at the current document end.
      // Wait for layout/explicit pagination evidence instead of exhausting
      // the scan budget on repeated scrolls against the same bottom.
      if(pageHidden&&atBottom){if(confirmedBottom){const waiting=await reportWait('hidden_bottom');if(waitStopped(waiting))return;}await wait(confirmedBottom?BACKGROUND_RETRY_MS:BACKGROUND_SETTLE_MS);sample--;continue;}
      if (sample === MAX_SAMPLES - 1 || scrolls >= MAX_SCROLLS) break;
      const beforeScroll=globalScope.scrollY;globalScope.scrollBy(0, Math.max(200, Math.floor(globalScope.innerHeight * 0.65)));
      if(pageHidden&&Math.abs(globalScope.scrollY-beforeScroll)<5){const waiting=await reportWait('scroll_stalled');if(waitStopped(waiting))return;await wait(BACKGROUND_RETRY_MS);sample--;continue;}
      scrolls++;
      if(pageHidden&&zeroNewObserved>=8){zeroNewObserved=0;const waiting=await reportWait('no_new_sku');if(waitStopped(waiting))return;await wait(BACKGROUND_RETRY_MS);sample--;continue;}
      await wait(settle());
    }
    return done(msg, false, 'scan_bound_reached');
  }
  function done(msg, complete, reason, nextUrl = '', verification = '') {
    const requested = core.exactPageUrl(msg.categoryUrl);
    const result = { type: 'categoryPageDone', batchId: msg.batchId, attemptId: msg.attemptId, categoryUrl: requested, ...(nextUrl ? { nextUrl } : {}), ...(verification?{verificationDetail:verification}:{}), complete, reason };
    return new Promise((resolve) => globalScope.chrome.runtime.sendMessage(result, () => resolve(result)));
  }
})(globalThis);
