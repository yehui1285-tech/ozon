(function installOzonCategoryScanner(globalScope) {
  const MAX_SAMPLES = 1200;
  const MAX_SCROLLS = 1200;
  const PROACTIVE_NEXT_PAGE_SCROLLS = 45;
  const PROACTIVE_NEXT_PAGE_SKUS = 120;
  const FORCE_NEXT_PAGE_SCROLLS = 65;
  const FORCE_NEXT_PAGE_SKUS = 180;
  const MEMORY_RECYCLE_RATIO = 0.85;
  const MEMORY_RECYCLE_BYTES = 1800 * 1024 * 1024;
  const FAST_SKIP_SETTLE_MS = 700;
  const FAST_SKIP_SCROLL_RATIO = 0.75;
  const NORMAL_SCROLL_RATIO = 0.60;
  const VIEWPORT_POLL_MS = 500;
  const VIEWPORT_ERP_MAX_WAIT_MS = 8000;
  const BACKGROUND_VIEWPORT_ERP_MAX_WAIT_MS = 16000;
  const STALE_NO_NEW_SKU_MS = 120000;
  const BLANK_IMAGE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
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
  // Confirm only the page's own visible price group: two editable numeric
  // inputs, exact localized heading, and explicit ruble evidence (in the filter
  // group itself, or across main catalog cards when sidebar presets render blank).
  function listCurrencyEvidence(doc) {
    const list = pickList(doc);
    if (!list) return { rub: false, cny: false, other: false, nonRub: false };
    const collect = (node, depth = 0) => {
      const own = textOf(node);
      if (own || depth > 2 || !node?.children?.length) return own;
      return [...node.children].slice(0, 12).map(c => collect(c, depth + 1)).join('\n');
    };
    const raw = collect(list).replace(/跟卖最低价[^\n]*/g, '');
    const rub = /\d[\d\s\u00a0\u202f]*(?:[,.]\d{1,2})?\s*₽/.test(raw);
    const cny = /\d[\d\s\u00a0\u202f]*(?:[,.]\d{1,2})?\s*[¥￥]/.test(raw);
    const other = /\d[\d\s\u00a0\u202f]*(?:[,.]\d{1,2})?\s*[$€]/.test(raw);
    return { rub, cny, other, nonRub: cny || other };
  }
  function resolvedPagePriceRange(options = {}) {
    if (globalScope.OzonCategoryCore?.pagePriceRange) return globalScope.OzonCategoryCore.pagePriceRange(options);
    const r = globalScope.OzonCategoryCore?.rubRange?.(options);
    return r ? { currency: 'RUB', min: r.pageMinRub, max: r.pageMaxRub } : null;
  }
  function confirmPagePrice(doc, options={}) {
    const range=resolvedPagePriceRange(options);if(!range)return true;
    const inputSelector='input[type="text"],input[type="number"]';
    const controls=Array.from(doc.querySelectorAll?.(inputSelector)||[]).filter(el=>visible(el)&&!el.disabled&&!el.readOnly&&!isForbidden(el));
    const groups=new Set();
    let listEvidence=null;
    for(const input of controls){
      for(let group=input.parentElement,depth=0;group&&depth<9;group=group.parentElement,depth++){
        if(!visible(group)||isForbidden(group))continue;
        const fields=controls.filter(el=>group.contains?.(el));if(fields.length>2)break;
        const content=textOf(group),heading=content.split(/\r?\n/).map(s=>s.trim()).find(Boolean);
        if(fields.length!==2||!/^(?:价格|Цена|Price)(?:\s*[ⓘi])?$/i.test(heading||''))continue;
        if(range.currency==='RUB'){
          if(/[¥￥$€]/.test(content))continue;
          const hasGroupRub=/(?:₽|\bRUB\b|руб\.?)/i.test(content);
          const hasRadio=Array.from(group.querySelectorAll?.('input[type="radio"],[role="radio"]')||[]).some(r=>visible(r)||visible(r.closest?.('label')||r.parentElement));
          if(hasGroupRub){if(!hasRadio)continue;}
          else{
            listEvidence ??= listCurrencyEvidence(doc);
            if(!listEvidence.rub||listEvidence.nonRub)continue;
          }
        }else{
          if(/(?:₽|\bRUB\b|руб\.?|[$€])/i.test(content))continue;
          const hasGroupCny=/(?:[¥￥]|\bCNY\b)/i.test(content);
          if(!hasGroupCny){
            listEvidence ??= listCurrencyEvidence(doc);
            if(!listEvidence.cny||listEvidence.rub||listEvidence.other)continue;
          }
        }
        groups.add(group);break;
      }
    }
    if(groups.size!==1)return false;
    const group=[...groups][0],fields=Array.from(group.querySelectorAll(inputSelector)).filter(el=>controls.includes(el));
    const value=el=>{const raw=String(el?.value??'').trim().replace(/[\s\u00a0\u202f]/g,'');return /^\d{1,8}$/.test(raw)?Number(raw):null;};
    return fields.length===2&&value(fields[0])===range.min&&value(fields[1])===range.max;
  }
  function confirmRubPrice(doc, options={}) { return confirmPagePrice(doc, options); }
  function detectCurrencyMismatch(doc, options={}) {
    const range = resolvedPagePriceRange(options);
    const expected = range?.currency || 'RUB';
    const inputSelector = 'input[type="text"],input[type="number"]';
    const controls = Array.from(doc.querySelectorAll?.(inputSelector) || []).filter(el => visible(el) && !el.disabled && !el.readOnly && !isForbidden(el));
    let ev = null;
    for (const input of controls) {
      for (let group = input.parentElement, depth = 0; group && depth < 9; group = group.parentElement, depth++) {
        if (!visible(group) || isForbidden(group)) continue;
        const fields = controls.filter(el => group.contains?.(el)); if (fields.length > 2) break;
        const content = textOf(group), heading = content.split(/\r?\n/).map(s => s.trim()).find(Boolean);
        if (fields.length !== 2 || !/^(?:价格|Цена|Price)(?:\s*[ⓘi])?$/i.test(heading || '')) continue;
        if (expected === 'RUB') {
          if (/(?:₽|\bRUB\b|руб\.?)/i.test(content)) continue;
          if (/[¥￥$€]/.test(content)) return true;
          ev ??= listCurrencyEvidence(doc);
          if (ev.nonRub && !ev.rub) return true;
        } else {
          if (/(?:[¥￥]|\bCNY\b)/i.test(content)) continue;
          if (/(?:₽|\bRUB\b|руб\.?|[$€])/i.test(content)) return true;
          ev ??= listCurrencyEvidence(doc);
          if ((ev.rub || ev.other) && !ev.cny) return true;
        }
      }
    }
    return false;
  }
  function detectNonRubCurrency(doc) { return detectCurrencyMismatch(doc, { pageMinRub: 0, pageMaxRub: 1 }); }
  function isMemoryHigh() {
    const mem = globalScope.performance?.memory;
    if (!mem || !Number.isFinite(mem.usedJSHeapSize) || !Number.isFinite(mem.jsHeapSizeLimit) || !mem.jsHeapSizeLimit) return false;
    return mem.usedJSHeapSize >= MEMORY_RECYCLE_BYTES || (mem.usedJSHeapSize / mem.jsHeapSizeLimit) >= MEMORY_RECYCLE_RATIO;
  }
  function pruneScrolledCards(list, observed, pending) {
    if (!list?.querySelectorAll || typeof observed?.has !== 'function' || !observed.size) return 0;
    const thresholdTop = -Math.max(1200, (Number(globalScope.innerHeight) || 800) * 2);
    const productSku = href => { try { const u = new URL(href); return u.origin === 'https://www.ozon.ru' && !u.username && !u.password ? u.pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/)?.[1] || '' : ''; } catch { return ''; } };
    const anchors = [...list.querySelectorAll('a[href*="/product/"]')];
    const seenCards = new Set();
    let pruned = 0;
    for (const anchor of anchors) {
      if (anchor.closest?.('[data-ozon-pruned="1"]')) continue;
      let sku = '';
      try { sku = productSku(anchor.href); } catch {}
      if (!sku || !observed.has(sku) || pending?.has?.(sku)) continue;
      let card = anchor, matchedCard = null;
      for (let depth = 0; card && card !== list && depth < 11; depth++, card = card.parentElement) {
        if (seenCards.has(card)) break;
        const linkSkus = new Set([...(card.querySelectorAll?.('a[href*="/product/"]') || [])].map(a => productSku(a.href)).filter(Boolean));
        if (linkSkus.size > 1) break;
        if (linkSkus.size === 1 && linkSkus.has(sku)) matchedCard = card;
      }
      const target = matchedCard || anchor.parentElement;
      if (!target || target === list || seenCards.has(target) || target.getAttribute?.('data-ozon-pruned') === '1') continue;
      seenCards.add(target);
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.bottom >= thresholdTop) continue;
      const h = Math.max(0, Math.round(rect.height || 0));
      if (target.style) {
        if (h > 0) target.style.containIntrinsicSize = `auto ${h}px`;
        target.style.contentVisibility = 'hidden';
      }
      target.setAttribute?.('data-ozon-pruned', '1');
      for (const img of target.querySelectorAll?.('img') || []) {
        img.removeAttribute?.('srcset');
        img.removeAttribute?.('data-src');
        img.setAttribute?.('src', BLANK_IMAGE_DATA_URL);
        try { img.src = BLANK_IMAGE_DATA_URL; } catch {}
      }
      pruned++;
    }
    return pruned;
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
  function readCards(list, core, categoryUrl, options = {}, skipSkus = null) {
    if (!list) return { products: [], observedSkus: [], discoverSkus:[], erpReadySkus:[], labelHitSkus:[], pendingSkus: [], pendingCount: 0, viewportSkus: [], viewportPendingSkus: [], viewportUnobservedSkus: [], skuDecisions:{}, available: false };
    const products = [], observed = new Set(), discovered = new Set(), erpReady = new Set(), labelHit = new Set(), pending=new Set(), viewportSkus=new Set(), skuDecisions={}, decisionRank={erp_pending:0,no_label:1,data_pending:2,price_outside:3,transport_blocked:3,eligible:4};
    const seenCardSkus = new Set();
    const viewportHeight = Number(globalScope.innerHeight) || 800;
    const inViewport = (el) => {
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return true;
      return rect.bottom > 0 && rect.top < viewportHeight;
    };
    const decide=(sku,reason)=>{if(!(sku in skuDecisions)||(decisionRank[reason]??0)>(decisionRank[skuDecisions[sku]]??0))skuDecisions[sku]=reason};
    const boundary=[...(list.querySelectorAll?.(headingSelector)||[])].find(el=>recommendationHeading.test(textOf(el))&&visible(el));
    const productSku=href=>{try{const u=new URL(href);return u.origin==='https://www.ozon.ru'&&!u.username&&!u.password?u.pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/)?.[1]||'':''}catch{return ''}};
    const extractCardImageUrl=(card,sku)=>{
      const normalize=globalScope.OzonStoreScannerCore?.normalizeImageUrl;
      if(!normalize||!card?.querySelectorAll)return '';
      const imgs=[...card.querySelectorAll('img')].filter(visible);
      const preferred=imgs.filter(img=>{const a=img.closest?.('a[href*="/product/"]');return a&&productSku(a.href)===sku;});
      const ordered=[...preferred,...imgs.filter(img=>!preferred.includes(img))];
      for(const img of ordered){
        const w=Number(img.naturalWidth||img.width||0),h=Number(img.naturalHeight||img.height||0);
        if((w>0&&w<32)||(h>0&&h<32))continue;
        const srcsetFirst=String(img.getAttribute?.('srcset')||'').split(',')[0]?.trim().split(/\s+/)[0]||'';
        const rawUrl=img.currentSrc||img.getAttribute?.('src')||img.getAttribute?.('data-src')||srcsetFirst||'';
        const url=normalize(rawUrl);
        if(url)return url;
      }
      return '';
    };
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
      if (anchor.closest?.('[data-ozon-pruned="1"]') || !visible(anchor) || isForbidden(anchor)||(boundary&&boundary.compareDocumentPosition&&(boundary.compareDocumentPosition(anchor)&4))) continue;
      let parsedUrl;
      try { parsedUrl = new URL(anchor.href, globalScope.location?.href); } catch { continue; }
      if (parsedUrl.origin !== 'https://www.ozon.ru' || !/^\/product\//.test(parsedUrl.pathname)) continue;
      const link = globalScope.OzonStoreScannerCore?.canonicalProductLink(anchor.href) || '',sku=productSku(link);
      if(!sku)continue;
      discovered.add(sku);
      if(inViewport(anchor))viewportSkus.add(sku);
      if(skipSkus&&skipSkus.has(sku)){observed.add(sku);continue;}
      if(seenCardSkus.has(sku))continue;
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
      seenCardSkus.add(sku);
      if(parsed.qualified)labelHit.add(sku);
      if(!panelReady){if(!observed.has(sku))pending.add(sku);continue;}
      erpReady.add(sku);
      const name = [anchor,...(card.querySelectorAll?.('a[href*="/product/"]')||[])].filter(a=>productSku(a.href)===sku).map(a=>(textOf(a)||a.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim()).filter(Boolean).sort((a,b)=>b.length-a.length)[0]||'';
      if(!parsed.qualified){decide(sku,'no_label');observed.add(sku);pending.delete(sku);continue;}
      decide(sku,'data_pending');
      if (!name) { pending.add(sku); continue; }
      const rawRiskText = `${parsed.category}\n${name}\n${raw}`;
      const shippingRisk = globalScope.OzonStoreScannerCore?.classifyShippingRisk(rawRiskText) || {};
      const product = { sku, name, link, imageUrl: extractCardImageUrl(card, sku), qualified: Boolean(parsed.qualified), price: parsed.price,
        commissions: parsed.commissions || [], monthlySales: parsed.monthlySales, fulfillment: parsed.fulfillment,
        dimensions: parsed.dimensions, weight: parsed.weight, competitor: parsed.competitor,
        competitorReady: Boolean(parsed.competitorReady), shippingRisk, category: parsed.category, rawRiskText };
      const dimensionCount=[...String(parsed.dimensions||'').matchAll(/\d+(?:[.,]\d+)?/g)].length;
      const weightValue=String(parsed.weight||'');
      const priceVal=globalScope.OzonCategoryCore.capturedAnyPrice?.(parsed.price)??globalScope.OzonCategoryCore.capturedPrice(parsed.price);
      const complete=priceVal>0&&parsed.commissions?.length>0&&parsed.monthlySales&&parsed.fulfillment&&dimensionCount>=3&&/\d/.test(weightValue)&&!/(?:加载中|暂无|--|—|-)/i.test(`${parsed.dimensions} ${weightValue}`)&&name;
      if(!complete){if(!observed.has(sku))pending.add(sku);continue;}
      observed.add(sku);pending.delete(sku);
      if(parsed.qualified){
        if(core.qualifiedProduct?.(product,options)){decide(sku,'eligible');products.push(product);}
        else if(!['clear','land_only'].includes(shippingRisk?.type)||globalScope.OzonStoreScannerCore?.classifyShippingRisk([product.name,product.category,product.rawRiskText].filter(Boolean).join('\n'))?.type==='suspected_prohibited')decide(sku,'transport_blocked');
        else if(!globalScope.OzonCategoryCore.priceAllowed(product,options))decide(sku,'price_outside');
      }
    }
    const viewportPendingSkus = [...viewportSkus].filter(sku => pending.has(sku));
    const viewportUnobservedSkus = [...viewportSkus].filter(sku => !observed.has(sku));
    return { products, observedSkus: [...observed], discoverSkus:[...discovered], erpReadySkus:[...erpReady], labelHitSkus:[...labelHit], pendingSkus:[...pending],pendingCount:pending.size, viewportSkus:[...viewportSkus], viewportPendingSkus, viewportUnobservedSkus, skuDecisions, available: anchors.length > 0 };
  }
  function pagination(doc, core, categoryUrl) {
    const page=Number(new URL(categoryUrl).searchParams.get('page')||1);
    const nextNum=String(page+1);
    const links = [...doc.querySelectorAll('a[rel="next"], a[data-testid*="pagination-next"], a[href*="page="]')]
      .filter((a) => {
        if (!visible(a) || isForbidden(a) || a.getAttribute?.('aria-disabled')==='true') return false;
        const rel=a.getAttribute?.('rel')||'';
        const testId=a.getAttribute?.('data-testid')||'';
        const text=textOf(a).trim();
        const label=`${a.getAttribute?.('aria-label') || ''} ${text}`;
        return rel==='next'
          || /pagination-next/i.test(testId)
          || /下一页|下页|next|след|далее|дальше|вперед|›|→/i.test(label)
          || text===nextNum;
      });
    const href = links.map((a) => core.paginationUrl?.(a.href, categoryUrl)).find(url=>url&&Number(new URL(url).searchParams.get('page'))===page+1);
    return href || '';
  }
  function createReader(doc, core) { return { read: (url, options, list=pickList(doc), skipSkus=null) => readCards(list, core, url, options, skipSkus), next: (url) => pagination(doc, core, url), pickList: () => pickList(doc) }; }
  globalScope.OzonCategoryScanner = Object.freeze({ createReader, readCards, pickList, confirmPagePrice, confirmRubPrice, detectCurrencyMismatch, detectNonRubCurrency, pruneScrolledCards, MAX_SAMPLES, MAX_SCROLLS, PROACTIVE_NEXT_PAGE_SCROLLS, PROACTIVE_NEXT_PAGE_SKUS, FORCE_NEXT_PAGE_SCROLLS, FORCE_NEXT_PAGE_SKUS, FAST_SKIP_SETTLE_MS, FAST_SKIP_SCROLL_RATIO, NORMAL_SCROLL_RATIO, VIEWPORT_POLL_MS, VIEWPORT_ERP_MAX_WAIT_MS, STALE_NO_NEW_SKU_MS });

  const core = globalScope.OzonCategoryCore;
  if (!core || !globalScope.chrome?.runtime?.onMessage || !core.exactPageUrl(globalScope.location?.href || '') || globalScope.__ozonCategoryListenerInstalled) return;
  globalScope.__ozonCategoryListenerInstalled = true;
  let activeRun = null;
  let nativeHidden=false;
  let hudState=null;
  let hudBusy=false;
  const HUD_POS_KEY='ozonCategoryHudPosV1';
  const HUD_COLLAPSED_KEY='ozonCategoryHudCollapsedV1';
  const canMountHud=()=>typeof globalScope.document?.createElement==='function'&&typeof globalScope.document?.documentElement?.appendChild==='function';
  function createCategoryHud(){
    if(!canMountHud())return null;
    const existing=globalScope.document.getElementById?.('ozon-category-hud-host');
    if(existing&&existing.__hudApi)return existing.__hudApi;
    if(existing)existing.remove?.();
    const host=globalScope.document.createElement('div');
    host.id='ozon-category-hud-host';
    host.style.cssText='position:fixed;left:18px;bottom:18px;z-index:2147483647;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;font-size:12px;';
    const root=typeof host.attachShadow==='function'?host.attachShadow({mode:'open'}):host;
    const box=globalScope.document.createElement('section');
    box.className='chud-box';
    box.innerHTML=`
      <style>
        *{box-sizing:border-box}
        .chud-box{width:304px;border:1px solid #d9def4;border-radius:15px;background:rgba(248,250,255,.97);box-shadow:0 16px 38px rgba(36,48,98,.2);color:#1f2b46;overflow:hidden;padding:11px}
        .chud-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:11px;color:#fff;background:linear-gradient(135deg,#245be9,#7a72dc);font-weight:800;cursor:move;user-select:none}
        .chud-head-left{display:flex;align-items:center;gap:6px;min-width:0}
        .chud-ver{opacity:.8;font-size:11px;font-weight:600}
        .chud-head-right{display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:11px;font-weight:700}
        .chud-icon-btn{width:22px;height:22px;min-height:0;padding:0;border:0;border-radius:6px;background:rgba(255,255,255,.2);color:#fff;font-size:14px;line-height:1;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
        .chud-icon-btn:hover{background:rgba(255,255,255,.32)}
        .chud-cat{margin-top:8px;padding:0 2px;font-size:12px;font-weight:700;color:#2c3a59;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .chud-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
        .chud-stat{padding:7px 8px;border-radius:9px;background:#eef2ff;font-size:11px;color:#4a587a}
        .chud-stat strong{display:block;margin-top:2px;font-size:17px;font-variant-numeric:tabular-nums;color:#1b2847}
        .chud-stat.hit{background:#fff0f2;color:#a82b45}.chud-stat.hit strong{color:#a82b45}
        .chud-stat.wait{background:#fff8e7;color:#986b11}.chud-stat.wait strong{color:#986b11}
        .chud-actions{display:flex;gap:6px;margin-top:8px}
        .chud-actions button{flex:1;min-height:31px;border:1px solid #dce2f4;border-radius:8px;background:#fff;color:#38486b;font:inherit;font-size:12px;font-weight:800;cursor:pointer;padding:0 8px;white-space:nowrap}
        .chud-actions button:hover:not(:disabled){border-color:#7d8ee6;color:#245be9}
        .chud-actions button:disabled{opacity:.5;cursor:not-allowed}
        .chud-actions .chud-primary{color:#fff;border:0;background:linear-gradient(135deg,#245be9,#746fd9)}
        .chud-actions .chud-warn{color:#8a5800;background:#fff7df;border-color:#f0cf7b}
        .chud-actions .chud-stop{color:#a82b45;background:#fff0f2;border-color:#ffd5de}
        .chud-status{margin-top:8px;padding:6px 8px;border-radius:8px;background:#eef1f8;color:#556380;font-size:11px;line-height:1.4;overflow-wrap:anywhere}
        .chud-status.warn{background:#fff7df;color:#8a5800;border:1px solid #f0cf7b}
        .chud-foot{margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#6b7a94;padding:0 2px}
        .chud-link{color:#3559d6;font-weight:700;text-decoration:none;cursor:pointer;background:none;border:0;padding:0;font:inherit}
        .chud-link:hover{text-decoration:underline}
        .chud-pill{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;color:#fff;background:linear-gradient(135deg,#245be9,#7a72dc);box-shadow:0 12px 28px rgba(36,48,98,.24);font-weight:800;cursor:move;user-select:none;white-space:nowrap}
        .chud-pill span{font-size:12px;font-variant-numeric:tabular-nums}
        [hidden]{display:none!important}
      </style>
      <div class="chud-pill" data-chud="pill" hidden>
        <span data-chud="pillText">OZON 类目选品</span>
        <button type="button" class="chud-icon-btn" data-chud="expand" title="展开小窗">+</button>
      </div>
      <div data-chud="full">
        <div class="chud-head" data-chud="head" title="按住可拖动位置">
          <span class="chud-head-left">OZON 类目选品 <span class="chud-ver" data-chud="ver"></span></span>
          <span class="chud-head-right"><span data-chud="pos">类目 -/-</span><button type="button" class="chud-icon-btn" data-chud="collapse" title="收起为小条">−</button></span>
        </div>
        <div class="chud-cat" data-chud="catName">准备类目…</div>
        <div class="chud-stats">
          <div class="chud-stat">已查看<strong data-chud="observed">0</strong></div>
          <div class="chud-stat hit">本批新采<strong data-chud="qualified">0</strong></div>
          <div class="chud-stat wait">待复查<strong data-chud="pending">0</strong></div>
        </div>
        <div class="chud-actions">
          <button type="button" class="chud-primary" data-chud="pauseResume">暂停</button>
          <button type="button" class="chud-warn" data-chud="skip">跳过类目</button>
          <button type="button" class="chud-stop" data-chud="stop">停止</button>
        </div>
        <div class="chud-status" data-chud="status">准备扫描…</div>
        <div class="chud-foot">
          <span data-chud="saved">进度已保存</span>
          <button type="button" class="chud-link" data-chud="manager">返回管理页 ↗</button>
        </div>
      </div>
    `;
    root.appendChild(box);
    globalScope.document.documentElement.appendChild(host);
    const q=k=>box.querySelector(`[data-chud="${k}"]`);
    let collapsed=false;try{collapsed=globalScope.localStorage?.getItem(HUD_COLLAPSED_KEY)==='1'}catch{}
    const applyPos=(left,top)=>{
      const maxX=Math.max(8,(globalScope.innerWidth||1200)-host.offsetWidth-8);
      const maxY=Math.max(8,(globalScope.innerHeight||800)-host.offsetHeight-8);
      host.style.left=`${Math.round(Math.max(8,Math.min(left,maxX)))}px`;
      host.style.top=`${Math.round(Math.max(8,Math.min(top,maxY)))}px`;
      host.style.bottom='auto';
      return {left:parseInt(host.style.left,10),top:parseInt(host.style.top,10)};
    };
    const restorePos=()=>{
      try{
        const raw=globalScope.localStorage?.getItem(HUD_POS_KEY);
        if(!raw)return;
        const pos=JSON.parse(raw);
        if(Number.isFinite(pos?.left)&&Number.isFinite(pos?.top))applyPos(pos.left,pos.top);
      }catch{}
    };
    restorePos();
    const bindDrag=handle=>{
      handle?.addEventListener?.('pointerdown',e=>{
        if(e.button!==0||e.target?.closest?.('button,a'))return;
        const rect=host.getBoundingClientRect();
        const offX=e.clientX-rect.left,offY=e.clientY-rect.top;
        e.preventDefault();
        const move=ev=>{const p=applyPos(ev.clientX-offX,ev.clientY-offY);try{globalScope.localStorage?.setItem(HUD_POS_KEY,JSON.stringify(p))}catch{}};
        const up=()=>{globalScope.removeEventListener('pointermove',move);globalScope.removeEventListener('pointerup',up)};
        globalScope.addEventListener('pointermove',move);
        globalScope.addEventListener('pointerup',up);
      });
    };
    bindDrag(q('head'));bindDrag(q('pill'));
    const setCollapsed=next=>{collapsed=Boolean(next);try{globalScope.localStorage?.setItem(HUD_COLLAPSED_KEY,collapsed?'1':'0')}catch{};q('full').hidden=collapsed;q('pill').hidden=!collapsed;if(host.style.top&&host.style.top!=='auto')applyPos(parseInt(host.style.left,10)||18,parseInt(host.style.top,10)||18);};
    q('collapse').addEventListener('click',()=>setCollapsed(true));
    q('expand').addEventListener('click',()=>setCollapsed(false));
    setCollapsed(collapsed);
    const sendAction=(type,extra={})=>{
      if(hudBusy)return;
      hudBusy=true;renderHud(hudState||{});
      globalScope.chrome.runtime.sendMessage({type,batchId:hudState?.batchId,...extra},res=>{
        hudBusy=false;
        if(res?.hud)hudState=res.hud;
        else if(res?.ok===false&&res?.error)hudState={...(hudState||{}),statusText:res.error};
        renderHud(hudState||{});
      });
    };
    q('pauseResume').addEventListener('click',()=>sendAction(hudState?.status==='paused'?'categoryResume':'categoryPause'));
    q('skip').addEventListener('click',()=>sendAction('categorySkipCurrent'));
    q('stop').addEventListener('click',()=>sendAction('categoryStop'));
    q('manager').addEventListener('click',()=>globalScope.chrome.runtime.sendMessage({type:'categoryOpenManager'}));
    function renderHud(state){
      const s=state||{};
      const done=['completed','stopped','failed'].includes(s.status);
      const targetText=Number(s.targetCount)>0?`${s.qualified||0}/${s.targetCount}`:String(s.qualified||0);
      const staleMins=!done&&Number(s.noNewSkuMinutes)>=2?Math.floor(Number(s.noNewSkuMinutes)):0;
      const unresolved=Number(s.unresolvedErpCount??s.pending??0);
      q('ver').textContent=s.version?`v${s.version}`:'';
      q('pos').textContent=`类目 ${s.categoryIndex||1}/${s.categoryTotal||1} · 第${s.pageNum||1}页`;
      q('catName').textContent=s.categoryName||'类目扫描中';
      q('observed').textContent=String(s.observed||0);
      q('qualified').textContent=targetText;
      q('pending').textContent=String(s.pending||0);
      q('pillText').textContent=staleMins>=2?`OZON 类目 · ${targetText} · 第${s.pageNum||1}页 · ${staleMins}分无新增`:`OZON 类目 · ${targetText} · 第${s.pageNum||1}页`;
      const pauseBtn=q('pauseResume'),skipBtn=q('skip'),stopBtn=q('stop');
      pauseBtn.textContent=s.status==='paused'?'继续':'暂停';
      pauseBtn.hidden=done;skipBtn.hidden=done;stopBtn.hidden=done;
      pauseBtn.disabled=hudBusy;skipBtn.disabled=hudBusy;stopBtn.disabled=hudBusy;
      const statusEl=q('status');
      statusEl.classList.toggle('warn',staleMins>=2||(done&&unresolved>0));
      statusEl.textContent=s.statusText||(staleMins>=2?`采集页仍有响应，已 ${staleMins} 分钟未发现新商品${s.pageHidden?'（后台可能被限流，建议切回前台）':''}`:done&&unresolved>0?`已结束 · 有 ${unresolved} 件 ERP 未就绪`:s.message||(s.status==='paused'?'已暂停，点击继续可恢复扫描':'扫描中…'));
      if(s.savedAt)q('saved').textContent=`已保存 ${s.savedAt}`;
    }
    const api={update(next){hudState={...(hudState||{}),...(next||{})};renderHud(hudState);}};
    host.__hudApi=api;
    return api;
  }
  function updateCategoryHud(next){
    const hud=createCategoryHud();
    if(hud)hud.update(next);
  }
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
    if (message?.type === 'categoryHudUpdate') { if (message.hud) updateCategoryHud(message.hud); reply?.({ ok: true }); return false; }
    if (message?.type === 'categoryScanStop') { if(activeRun?.batchId===message.batchId&&activeRun?.attemptId===message.attemptId)cancelRun(); if(message.hud)updateCategoryHud(message.hud); reply?.({ ok: true }); return false; }
    if(message?.type==='categoryScanTick'){
      const running=!!activeRun&&activeRun.batchId===message.batchId&&activeRun.attemptId===message.attemptId;
      if(running&&typeof message.pageNativeHidden==='boolean')nativeHidden=message.pageNativeHidden;
      reply?.({ok:true,running,...pageState()});if(running)activeRun.wait?.wake();return false;
    }
    if (message?.type !== 'categoryScanStart') return false;
    if(activeRun?.batchId===message.batchId&&activeRun?.attemptId===message.attemptId){if(message.hud)updateCategoryHud(message.hud);reply?.({ok:true,accepted:true});return false;}
    cancelRun();nativeHidden=message.pageNativeHidden===true;const run={batchId:message.batchId,attemptId:message.attemptId,wait:null};activeRun=run;
    if(message.hud||canMountHud())updateCategoryHud(message.hud||{batchId:message.batchId,status:'running',observed:(message.observedSkus||[]).length,pending:(message.pendingSkus||[]).length,statusText:'正在启动类目扫描…'});
    reply?.({ ok: true, accepted: true, batchId: message.batchId, attemptId: message.attemptId });
    void scan(message,run).catch(() => {if(activeRun===run)return done(message, false, 'reader_error')}).finally(()=>{if(activeRun===run)activeRun=null});
    return false;
  });
  async function scan(msg,run) {
    const baseUrl = core.normalizeUrl(msg.categoryUrl);
    const url = core.exactPageUrl(globalScope.location.href);
    if (!core.samePage(globalScope.location.href, baseUrl) || !url || url!==msg.categoryUrl) return done(msg, false, 'wrong_category_page');
    const reader = createReader(globalScope.document, core), sent=new Set(),observed = new Set(msg.observedSkus||[]),pending=new Set(msg.pendingSkus||[]);
    const sentObserved = new Set(msg.observedSkus||[]), sentDiscovered = new Set(), sentErpReady = new Set(), sentLabelHit = new Set(), sentDecisions = new Map();
    let scrolls = 0, stable = 0, bottomStable = 0, lastHeight = -1, noListPolls = 0,ambiguousPolls=0,reviewPasses=0,bottomSince=0,previousHidden=hidden(),zeroNewObserved=0,pageNewObserved=0;
    let recheckFromTop=!!msg.recheckFromTop;
    const revisitPendingOnly=msg.revisitPendingOnly===true;
    let viewportWaitSince=0,lastSampleSentAt=0,lastNewSkuAt=Date.now(),lastAck=null,viewportWaitPolls=0;
    const MAX_VIEWPORT_WAIT_POLLS=600,viewportTimedOutSkus=new Set();
    const rubRange=resolvedPagePriceRange(msg.options);let pagePriceConfirmed=!rubRange,pricePolls=0;
    const wait=ms=>waitForRun(run,ms);
    const settle=()=>hidden()?BACKGROUND_SETTLE_MS:FOREGROUND_SETTLE_MS;
    const reportWait=reason=>new Promise(resolve=>globalScope.chrome.runtime.sendMessage({type:'categoryWait',batchId:msg.batchId,attemptId:msg.attemptId,categoryUrl:url,reason,...pageState()},response=>{if(response?.hud)updateCategoryHud({...response.hud,statusText:response.hud.message||'等待页面状态…'});resolve(response||{});}));
    const waitStopped=ack=>ack.ok!==true||ack.stop===true||ack.stopped===true||activeRun!==run;
    for (let sample = 0; sample < MAX_SAMPLES && scrolls <= MAX_SCROLLS; sample++) {
      if (activeRun!==run) return;
      if(core.exactPageUrl(globalScope.location.href)!==url)return done(msg,false,'wrong_category_page','','',[...pending]);
      const pageHidden=hidden();if(previousHidden&&!pageHidden){noListPolls=0;stable=0;bottomStable=0;bottomSince=0;reviewPasses=0;viewportWaitSince=0;}previousHidden=pageHidden;
      const verification=verificationDetail(globalScope.document);
      if(verification)return done(msg,false,'manual-verification','',verification,[...pending]);
      if(!pagePriceConfirmed){
        if(confirmPagePrice(globalScope.document,msg.options))pagePriceConfirmed=true;
        else {
          if(++pricePolls>=3 && detectCurrencyMismatch(globalScope.document,msg.options))return done(msg,false,'price_currency_mismatch','','',[...pending]);
          if(pricePolls>=LIST_WAIT_POLLS)return done(msg,false,'price_filter_unconfirmed','','',[...pending]);
          if(pricePolls===1||pricePolls%5===0){const ack=await reportWait('price_filter_loading');if(waitStopped(ack))return;}
          await wait(pageHidden?BACKGROUND_SETTLE_MS:LIST_WAIT_MS);sample--;continue;
        }
      }
      if(recheckFromTop){recheckFromTop=false;viewportWaitSince=0;viewportTimedOutSkus.clear();globalScope.scrollTo(0,0);}
      const candidates = mainCandidates(globalScope.document);
      const list = pickList(globalScope.document,candidates);
      if(!list&&candidates.size>1){
        noListPolls=0;ambiguousPolls++;stable=0;bottomStable=0;lastHeight=-1;
        if(ambiguousPolls>=LIST_WAIT_POLLS)return done(msg,false,'catalog_list_unavailable','','',[...pending]);
        const ack=await reportWait('list_ambiguous');if(waitStopped(ack))return;
        await wait(pageHidden?BACKGROUND_RETRY_MS:LIST_WAIT_MS);sample--;continue;
      }
      ambiguousPolls=0;
      const result=reader.read(url,msg.options||{},list,observed);
      const endMarker = list?.querySelector?.('[data-testid*="no-more"], [data-testid="end-of-list"], [data-testid="catalog-list-end"]');
      if(!list||(!result.available&&!visible(endMarker))){
        if(noListPolls>=LIST_WAIT_POLLS&&!pageHidden)return done(msg,false,'catalog_list_unavailable','','',[...pending]);
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
      const deltaObserved=result.observedSkus.filter(sku=>!sentObserved.has(sku));
      const deltaDiscover=result.discoverSkus.filter(sku=>!sentDiscovered.has(sku));
      const deltaErpReady=result.erpReadySkus.filter(sku=>!sentErpReady.has(sku));
      const deltaLabelHit=result.labelHitSkus.filter(sku=>!sentLabelHit.has(sku));
      const deltaDecisions={};
      for(const [sku,outcome] of Object.entries(result.skuDecisions||{}))if(sentDecisions.get(sku)!==outcome)deltaDecisions[sku]=outcome;
      if(deltaDiscover.length>0||deltaObserved.length>0)lastNewSkuAt=Date.now();
      const unwaitedViewportPending=(result.viewportPendingSkus||[]).filter(sku=>!viewportTimedOutSkus.has(sku));
      const maxViewportWait=pageHidden?BACKGROUND_VIEWPORT_ERP_MAX_WAIT_MS:VIEWPORT_ERP_MAX_WAIT_MS;
      let waitingForViewportErp=false;
      if(unwaitedViewportPending.length>0&&viewportWaitPolls<MAX_VIEWPORT_WAIT_POLLS){
        if(!viewportWaitSince)viewportWaitSince=Date.now();
        if(Date.now()-viewportWaitSince<maxViewportWait)waitingForViewportErp=true;
        else {for(const sku of unwaitedViewportPending)viewportTimedOutSkus.add(sku);viewportWaitSince=0;}
      }else viewportWaitSince=0;
      const hasDelta=products.length>0||deltaObserved.length>0||deltaDiscover.length>0||deltaErpReady.length>0||deltaLabelHit.length>0||Object.keys(deltaDecisions).length>0;
      const shouldSendSample=!waitingForViewportErp||lastSampleSentAt===0||hasDelta||(Date.now()-lastSampleSentAt>=2500);
      const categoryName=textOf(globalScope.document.querySelector?.('h1')).slice(0,120);
      let ack=lastAck||{ok:true,hud:hudState||{}};
      if(shouldSendSample){
        ack = await new Promise((resolve) => globalScope.chrome.runtime.sendMessage({ type: 'categorySample', batchId: msg.batchId, attemptId: msg.attemptId, categoryUrl: url,categoryName,products,observedSkus: deltaObserved,discoverSkus:deltaDiscover,erpReadySkus:deltaErpReady,labelHitSkus:deltaLabelHit,pendingSkus:[...pending],pendingCount:pending.size,skuDecisions:deltaDecisions,compactAck:true,...(rubRange?{pagePriceConfirmed}:{}),...pageState() }, (response) => resolve(response || {})));
        if(activeRun!==run)return;
        if (ack.ok !== true) return done(msg, false, 'sample_not_persisted','','',[...pending]);
        if(ack.stop===true||ack.stopped===true||activeRun!==run)return;
        if(typeof ack.pageNativeHidden==='boolean')nativeHidden=ack.pageNativeHidden;
        lastSampleSentAt=Date.now();
        lastAck=ack;
        for(const p of products)sent.add(p.sku);
        for(const s of deltaObserved)sentObserved.add(s);
        for(const s of deltaDiscover)sentDiscovered.add(s);
        for(const s of deltaErpReady)sentErpReady.add(s);
        for(const s of deltaLabelHit)sentLabelHit.add(s);
        for(const [s,o] of Object.entries(deltaDecisions))sentDecisions.set(s,o);
        pageNewObserved+=deltaObserved.length;
        if(pageHidden&&result.available){if(newObserved)zeroNewObserved=0;else zeroNewObserved++;}
      }
      if(revisitPendingOnly&&pending.size===0)return done(msg,true,'pending_revisit_done','','',[]);
      if(pageHidden&&zeroNewObserved>=8){zeroNewObserved=0;const waiting=await reportWait('no_new_sku');if(waitStopped(waiting))return;await wait(BACKGROUND_RETRY_MS);sample--;continue;}
      const staleMinutes=Math.max(Number(ack.hud?.noNewSkuMinutes)||0,(Date.now()-lastNewSkuAt>=STALE_NO_NEW_SKU_MS)?Math.floor((Date.now()-lastNewSkuAt)/60000):0);
      if(waitingForViewportErp){
        viewportWaitPolls++;
        if(ack.hud||canMountHud()){
          const nowTime=new Date().toLocaleTimeString('zh-CN',{hour12:false});
          const baseHud=ack.hud||{};
          const waitSec=Math.max(1,Math.ceil((Date.now()-viewportWaitSince)/1000));
          const maxSec=Math.round(maxViewportWait/1000);
          const statusText=staleMinutes>=2
            ?`采集页仍有响应，已 ${staleMinutes} 分钟未发现新商品${pageHidden?'（后台可能被限流，建议切回前台）':''}`
            :`等待本屏毛子 ERP 加载（${unwaitedViewportPending.length} 件待出卡 · ${waitSec}/${maxSec}s）`;
          updateCategoryHud({...baseHud,pending:pending.size,observed:baseHud.observed??observed.size,noNewSkuMinutes:staleMinutes,pageHidden,savedAt:nowTime,statusText});
        }
        await wait(pageHidden?BACKGROUND_SETTLE_MS:VIEWPORT_POLL_MS);sample--;continue;
      }
      pruneScrolledCards(list, observed, pending);
      const height = globalScope.document.documentElement?.scrollHeight || 0;
      const atBottom = globalScope.innerHeight + globalScope.scrollY >= height - 8;
      if (atBottom && height === lastHeight) { stable++; bottomStable++;if(!bottomSince)bottomSince=Date.now(); } else { stable = 0; bottomStable = 0;bottomSince=0; }
      lastHeight = height;
      const confirmedBottom=atBottom&&bottomStable>=(pageHidden?BACKGROUND_BOUNDARY_POLLS:3)&&(!pageHidden||Date.now()-bottomSince>=BACKGROUND_BOUNDARY_MS);
      const nextUrl = confirmedBottom ? reader.next(url) : '';
      const reachedEnd = confirmedBottom && stable >= 2 && visible(endMarker);
      if(revisitPendingOnly&&(nextUrl||reachedEnd||scrolls>=PROACTIVE_NEXT_PAGE_SCROLLS||isMemoryHigh())){
        if(pending.size&&reviewPasses<1){
          reviewPasses++;viewportWaitSince=0;viewportTimedOutSkus.clear();
          globalScope.scrollTo(0,0);stable=0;bottomStable=0;bottomSince=0;lastHeight=-1;
          await wait(settle());continue;
        }
        return done(msg,pending.size===0,'pending_revisit_done','','',[...pending]);
      }
      if(nextUrl||reachedEnd){
        if(pending.size&&reviewPasses<MAX_REVIEW_PASSES){
          reviewPasses++;const reviewAck=await reportWait('review_pending');if(waitStopped(reviewAck))return;
          viewportWaitSince=0;viewportTimedOutSkus.clear();
          globalScope.scrollTo(0,0);stable=0;bottomStable=0;bottomSince=0;lastHeight=-1;
          await wait(settle());continue;
        }
        if(pending.size&&pageHidden){const waiting=await reportWait('review_pending');if(waitStopped(waiting))return;await wait(BACKGROUND_RETRY_MS);sample--;continue;}
        if(pending.size)return done(msg,false,'pending_cards','','',[...pending]);
        return nextUrl?done(msg,false,'next_page_available',nextUrl,'',[...pending]):done(msg,true,'visible_catalog_end','','',[...pending]);
      }
      const softPaginate = !revisitPendingOnly && pending.size===0 && (scrolls>=PROACTIVE_NEXT_PAGE_SCROLLS || pageNewObserved>=PROACTIVE_NEXT_PAGE_SKUS);
      const highMemory = isMemoryHigh();
      const forcePaginate = !revisitPendingOnly && (scrolls>=FORCE_NEXT_PAGE_SCROLLS || pageNewObserved>=FORCE_NEXT_PAGE_SKUS || highMemory);
      if(softPaginate || forcePaginate){
        const earlyNextUrl=reader.next(url);
        if(earlyNextUrl)return done(msg,false,'next_page_available',earlyNextUrl,'',[...pending]);
        if(highMemory)return done(msg,false,'memory_recycle','','',[...pending]);
      }
      // Hidden lazy-loaded lists can stop briefly at the current document end.
      // Wait for layout/explicit pagination evidence instead of exhausting
      // the scan budget on repeated scrolls against the same bottom.
      if(pageHidden&&atBottom){if(confirmedBottom){const waiting=await reportWait('hidden_bottom');if(waitStopped(waiting))return;}await wait(confirmedBottom?BACKGROUND_RETRY_MS:BACKGROUND_SETTLE_MS);sample--;continue;}
      if (sample === MAX_SAMPLES - 1 || scrolls >= MAX_SCROLLS) break;
      const fastSkip = !pageHidden && !revisitPendingOnly && result.available && (result.viewportSkus?.length||0) > 0 && (result.viewportPendingSkus?.length||0) === 0 && (result.viewportUnobservedSkus?.length||0) === 0 && deltaObserved.length === 0 && products.length === 0 && pending.size === 0 && !confirmedBottom && !atBottom;
      if(ack.hud||canMountHud()){
        const nowTime=new Date().toLocaleTimeString('zh-CN',{hour12:false});
        const baseHud=ack.hud||{};
        const statusText=ack.stop
          ?(baseHud.message||'已达到采集目标')
          :staleMinutes>=2
            ?`采集页仍有响应，已 ${staleMinutes} 分钟未发现新商品${pageHidden?'（后台可能被限流，建议切回前台）':''}`
            :revisitPendingOnly
              ?`正在回查原页未就绪 ERP（待复查 ${pending.size} 件）`
              :fastSkip
                ?`快进跳过已查商品（第${baseHud.pageNum||1}页）`
                :pageHidden
                  ?'后台扫描中…'
                  :`正在扫描第${baseHud.pageNum||1}页 · 待复查 ${pending.size}`;
        updateCategoryHud({...baseHud,pending:pending.size,observed:baseHud.observed??observed.size,noNewSkuMinutes:staleMinutes,pageHidden,savedAt:nowTime,statusText});
      }
      const scrollStep = fastSkip ? Math.max(320, Math.floor((globalScope.innerHeight||800) * FAST_SKIP_SCROLL_RATIO)) : Math.max(200, Math.floor((globalScope.innerHeight||800) * NORMAL_SCROLL_RATIO));
      const beforeScroll=globalScope.scrollY;globalScope.scrollBy(0, scrollStep);
      if(pageHidden&&Math.abs(globalScope.scrollY-beforeScroll)<5){const waiting=await reportWait('scroll_stalled');if(waitStopped(waiting))return;await wait(BACKGROUND_RETRY_MS);sample--;continue;}
      scrolls++;
      await wait(fastSkip ? FAST_SKIP_SETTLE_MS : settle());
    }
    return done(msg, false, 'scan_bound_reached','','',[...pending]);
  }
  function done(msg, complete, reason, nextUrl = '', verification = '', pendingSkus = null) {
    const requested = core.exactPageUrl(msg.categoryUrl);
    const doneNote=reason==='next_page_available'?'正在翻至下一页…':reason==='pending_revisit_done'?(complete?'原页待复查商品已完成':'原页回查结束，仍有 ERP 未就绪'):complete?'本类目已扫到底':'扫描已暂停';
    updateCategoryHud({statusText:doneNote});
    const result = { type: 'categoryPageDone', batchId: msg.batchId, attemptId: msg.attemptId, categoryUrl: requested, ...(nextUrl ? { nextUrl } : {}), ...(verification?{verificationDetail:verification}:{}), ...(Array.isArray(pendingSkus)?{pendingSkus}:{}), complete, reason };
    return new Promise((resolve) => globalScope.chrome.runtime.sendMessage(result, (res) => { if(res?.hud)updateCategoryHud(res.hud); resolve(result); }));
  }
})(globalThis);
