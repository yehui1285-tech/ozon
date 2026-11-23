(function(scope){
  'use strict';
  const scanner=scope.OzonStoreScannerCore;
  function category(url){
    try{
      const u=new URL(String(url||'').trim());
      if(u.origin!=='https://www.ozon.ru'||u.username||u.password)return null;
      if(u.pathname==='/highlight/tovary-iz-kitaya-935133/' || u.pathname==='/highlight/tovary-iz-kitaya-935133'){
        const params=[...u.searchParams],ids=u.searchParams.getAll('category'),pages=u.searchParams.getAll('page');
        if(u.hash||ids.length!==1||!/^\d{1,16}$/.test(ids[0])||pages.length>1||params.some(([k])=>!['category','page'].includes(k)))return null;
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
  function paginationUrl(url,expected){
    const c=category(url);if(!c||!samePage(url,expected)||c.parsed.hash)return '';
    const params=[...c.parsed.searchParams],pages=c.parsed.searchParams.getAll('page');
    if(params.length!==(c.kind==='china'?2:1)||pages.length!==1||!/^\d{1,4}$/.test(pages[0]))return '';
    const page=Number(pages[0]);return page>=1&&page<=1000?c.url+(c.kind==='china'?'&':'?')+'page='+page:'';
  }
  function exactPageUrl(url){const c=category(url);if(!c||c.parsed.hash)return '';if(c.kind==='normal')return c.parsed.search?paginationUrl(url,c.url):c.parsed.href===c.url?c.url:'';return c.parsed.searchParams.has('page')?paginationUrl(url,c.url):c.url;}
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
    return {targetCount,minPrice,maxPrice};
  }
  function capturedPrice(raw){
    let t=String(raw??'').trim().replace(/^[¥￥]\s*|\s*[¥￥]$/g,'').replace(/[\s\u00a0\u202f]/g,'');
    if(!/^\d+(?:[.,]\d+)*$/.test(t))return null;
    const last=Math.max(t.lastIndexOf(','),t.lastIndexOf('.'));
    if(last>=0){const decimal=t[last],fraction=t.slice(last+1),whole=t.slice(0,last);if(fraction.length>2){if(!/^\d{1,3}(?:[.,]\d{3})+$/.test(t))return null;t=t.replace(/[.,]/g,'')}else{const other=decimal===','?'.':',';if(whole.includes(decimal)||!(new RegExp('^\\d+(?:\\'+other+'\\d{3})*$')).test(whole))return null;t=whole.replace(/[.,]/g,'')+'.'+fraction;}}
    const n=Number(t);return Number.isFinite(n)&&n>=0?n:null;
  }
  function priceAllowed(product,options={}){
    if(options.minPrice==null&&options.maxPrice==null)return true;
    const n=capturedPrice(product?.price);return n!==null&&(options.minPrice==null||n>=options.minPrice)&&(options.maxPrice==null||n<=options.maxPrice);
  }
  function qualifiedProduct(product,options={}){
    if(!product||product.qualified!==true||!/^\d{1,24}$/.test(product.sku||''))return false;
    try{const u=new URL(product.link);const match=u.pathname.match(/^\/product\/(?:[^/]+-)?(\d+)\/?$/);if(u.origin!=='https://www.ozon.ru'||u.username||u.password||match?.[1]!==String(product.sku))return false;}catch{return false}
    if(!['clear','land_only'].includes(product.shippingRisk?.type))return false;
    if(scanner.classifyShippingRisk([product.name,product.category,product.rawRiskText].filter(Boolean).join('\n')).type==='suspected_prohibited')return false;
    return priceAllowed(product,options);
  }
  scope.OzonCategoryCore=Object.freeze({keyFromUrl,normalizeUrl,samePage,paginationUrl,exactPageUrl,parseUrls,validateOptions,priceAllowed,qualifiedProduct,capturedPrice});
})(globalThis);
