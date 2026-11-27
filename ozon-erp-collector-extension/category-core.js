(function(scope){
  'use strict';
  const scanner=scope.OzonStoreScannerCore;
  function category(url){
    try{
      const u=new URL(String(url||'').trim());
      if(u.origin!=='https://www.ozon.ru'||u.username||u.password)return null;
      if(u.pathname==='/highlight/tovary-iz-kitaya-935133/' || u.pathname==='/highlight/tovary-iz-kitaya-935133'){
        const params=[...u.searchParams],ids=u.searchParams.getAll('category'),pages=u.searchParams.getAll('page');
        if(u.hash||ids.length!==1||!/^\d{1,16}$/.test(ids[0])||pages.length>1||params.some(([k])=>!['category','page','currency_price','__rr','abt_att'].includes(k))||!validPageParams(u,true))return null;
        if(pages.length&&(!/^\d{1,4}$/.test(pages[0])||Number(pages[0])<1||Number(pages[0])>1000))return null;
        return {id:ids[0],kind:'china',url:u.origin+'/highlight/tovary-iz-kitaya-935133/?category='+ids[0],parsed:u};
      }
      const match=u.pathname.match(/^\/category\/(?:[a-z0-9-]+-)?(\d{1,16})\/?$/i);
      if(!match)return null;
      return {id:match[1],kind:'normal',url:u.origin+u.pathname.replace(/\/+$/,'')+'/',parsed:u};
    }catch{return null}
  }
  const keyFromUrl=url=>{const c=category(url);return c?(c.kind==='china'?'china-category:':'category:')+c.id:''};
  const normalizeUrl=url=>category(url)?.url||'';
  const samePage=(url,expected)=>{const key=keyFromUrl(url);return !!key&&key===keyFromUrl(expected)};
  function rubBound(value){
    if(value===null||value===undefined||String(value).trim()==='')return null;
    const raw=String(value).trim();if(!/^\d{1,8}$/.test(raw)||Number(raw)>10000000)throw Error('卢布预筛选请输入 0–10,000,000 的整数');return Number(raw);
  }
  function rubRange(raw={}){
    const pageMinRub=rubBound(raw.pageMinRub),pageMaxRub=rubBound(raw.pageMaxRub);
    if(pageMinRub===null&&pageMaxRub===null)return null;
    if(pageMinRub===null||pageMaxRub===null||pageMinRub>pageMaxRub)throw Error('卢布预筛选需同时填写有效最低价与最高价，最低价不能高于最高价');
    return {pageMinRub,pageMaxRub};
  }
  function urlRange(u){
    const vals=u.searchParams.getAll('currency_price');if(!vals.length)return '';
    const m=vals.length===1&&vals[0].match(/^(\d{1,8})(?:\.0{1,3})?;(\d{1,8})(?:\.0{1,3})?$/);if(!m)return null;
    try{const r=rubRange({pageMinRub:m[1],pageMaxRub:m[2]});return `${r.pageMinRub}.000;${r.pageMaxRub}.000`;}catch{return null}
  }
  function validPageParams(u,china){
    const allowed=['page','currency_price','__rr','abt_att',...(china?['category']:[])];
    return [...u.searchParams].every(([key,val])=>allowed.includes(key)&&u.searchParams.getAll(key).length===1&&(!['__rr','abt_att'].includes(key)||val==='1'))&&urlRange(u)!==null;
  }
  function canonicalPage(c){
    if(!c||c.parsed.hash||!validPageParams(c.parsed,c.kind==='china'))return '';
    const u=new URL(c.url),price=urlRange(c.parsed),page=c.parsed.searchParams.get('page');
    if(price)u.searchParams.set('currency_price',price);
    if(page!==null){if(!/^\d{1,4}$/.test(page)||Number(page)<1||Number(page)>1000)return '';u.searchParams.set('page',String(Number(page)));}
    return u.href;
  }
  function pricePageUrl(url,options={}){
    const c=category(url);if(!c)return '';const r=rubRange(options);if(!r)return c.url;
    const u=new URL(c.url);u.searchParams.set('currency_price',`${r.pageMinRub}.000;${r.pageMaxRub}.000`);return u.href;
  }
  function paginationUrl(url,expected){
    const c=category(url),e=category(expected),canonical=canonicalPage(c);if(!canonical||!canonicalPage(e)||!samePage(url,expected)||!c.parsed.searchParams.has('page')||urlRange(c.parsed)!==urlRange(e.parsed))return '';
    return canonical;
  }
  function exactPageUrl(url){return canonicalPage(category(url));}
  function parseUrls(raw,max=20){
    const urls=[],invalid=[],seen=new Set();let duplicateCount=0,overflowCount=0;
    for(const value of (Array.isArray(raw)?raw.map(String):String(raw||'').split(/\r?\n/)).map(s=>s.trim()).filter(Boolean)){
      const url=normalizeUrl(value);if(!url){invalid.push(value);continue;}
      const key=keyFromUrl(url);if(seen.has(key)){duplicateCount++;continue}seen.add(key);
      if(urls.length>=max){overflowCount++;continue}urls.push(url);
    }
    return {urls,invalid,duplicateCount,overflowCount};
  }
  function validateOptions(raw={}){
    const targetCount=Number(raw.targetCount);
    if(!Number.isInteger(targetCount)||targetCount<1||targetCount>500)throw Error('目标新增商品数量须为1–500的整数');
    const limit=(value)=>{if(value===null||value===undefined||String(value).trim()==='')return null;if(!/^\d+(?:\.\d{1,2})?$/.test(String(value).trim()))throw Error('请输入有效人民币金额');const n=Number(value);if(!Number.isFinite(n)||n<0||n>1000000)throw Error('人民币价格区间无效');return n};
    const minPrice=limit(raw.minPrice),maxPrice=limit(raw.maxPrice);
    if(minPrice!==null&&maxPrice!==null&&minPrice>maxPrice)throw Error('最低价不能高于最高价');
    const fxRateRaw=raw.fxRate;
    let fxExtra={};
    if(fxRateRaw!==null&&fxRateRaw!==undefined&&String(fxRateRaw).trim()!==''){
      const fx=Number(fxRateRaw);
      if(!Number.isFinite(fx)||fx<0.1||fx>1000)throw Error('参考汇率无效');
      fxExtra={fxRate:fx};
    }
    return {targetCount,minPrice,maxPrice,...rubRange(raw),...fxExtra};
  }
  function parseAmountDigits(t){
    if(!/^\d+(?:[.,]\d+)*$/.test(t))return null;
    const last=Math.max(t.lastIndexOf(','),t.lastIndexOf('.'));
    if(last>=0){const decimal=t[last],fraction=t.slice(last+1),whole=t.slice(0,last);if(fraction.length>2){if(!/^\d{1,3}(?:[.,]\d{3})+$/.test(t))return null;t=t.replace(/[.,]/g,'')}else{const other=decimal===','?'.':',';if(whole.includes(decimal)||!(new RegExp('^\\d+(?:\\'+other+'\\d{3})*$')).test(whole))return null;t=whole.replace(/[.,]/g,'')+'.'+fraction;}}
    const n=Number(t);return Number.isFinite(n)&&n>=0?n:null;
  }
  function capturedPrice(raw){
    const t=String(raw??'').trim().replace(/^[¥￥]\s*|\s*[¥￥]$/g,'').replace(/[\s\u00a0\u202f]/g,'');
    return parseAmountDigits(t);
  }
  function capturedRubPrice(raw){
    const str=String(raw??'').trim();
    if(!/(?:₽|\bRUB\b|руб\.?)/i.test(str)||/[¥￥$€]/.test(str))return null;
    const t=str.replace(/^(?:₽|RUB|руб\.?)\s*|\s*(?:₽|RUB|руб\.?)$/gi,'').replace(/[\s\u00a0\u202f]/g,'');
    return parseAmountDigits(t);
  }
  function capturedAnyPrice(raw){return capturedPrice(raw)??capturedRubPrice(raw);}
  function priceAllowed(product,options={}){
    if(options.minPrice==null&&options.maxPrice==null)return true;
    const cny=capturedPrice(product?.price);
    if(cny!==null)return (options.minPrice==null||cny>=options.minPrice)&&(options.maxPrice==null||cny<=options.maxPrice);
    const rub=capturedRubPrice(product?.price),fx=Number(options.fxRate);
    if(rub!==null&&Number.isFinite(fx)&&fx>=0.1&&fx<=1000){
      const equiv=rub/fx;
      return (options.minPrice==null||equiv>=options.minPrice)&&(options.maxPrice==null||equiv<=options.maxPrice);
    }
    return false;
  }
  function qualifiedProduct(product,options={}){
    if(!product||product.qualified!==true||!/^\d{1,24}$/.test(product.sku||''))return false;
    try{const u=new URL(product.link);const match=u.pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/);if(u.origin!=='https://www.ozon.ru'||u.username||u.password||match?.[1]!==String(product.sku))return false;}catch{return false}
    if(!['clear','land_only'].includes(product.shippingRisk?.type))return false;
    if(scanner.classifyShippingRisk([product.name,product.category,product.rawRiskText].filter(Boolean).join('\n')).type==='suspected_prohibited')return false;
    return priceAllowed(product,options);
  }
  scope.OzonCategoryCore=Object.freeze({keyFromUrl,normalizeUrl,samePage,paginationUrl,exactPageUrl,pricePageUrl,rubRange,parseUrls,validateOptions,priceAllowed,qualifiedProduct,capturedPrice,capturedRubPrice,capturedAnyPrice});
})(globalThis);
