(function(scope){
  'use strict';
  const scanner=scope.OzonStoreScannerCore;
  function category(url){
    try{
      const u=new URL(String(url||'').trim());
      if(u.origin!=='https://www.ozon.ru'||u.username||u.password)return null;
      const match=u.pathname.match(/^\/category\/(?:[a-z0-9-]+-)?(\d{1,16})\/?$/i);
      if(!match)return null;
      return {id:match[1],url:u.origin+u.pathname.replace(/\/+$/,'')+'/',parsed:u};
    }catch{return null}
  }
  const keyFromUrl=url=>{const c=category(url);return c?'category:'+c.id:''};
  const normalizeUrl=url=>category(url)?.url||'';
  const samePage=(url,expected)=>{const key=keyFromUrl(url);return !!key&&key===keyFromUrl(expected)};
  function paginationUrl(url,expected){
    const c=category(url);if(!c||!samePage(url,expected)||c.parsed.hash)return '';
    const params=[...c.parsed.searchParams];if(params.length!==1||params[0][0]!=='page'||!/^\d{1,4}$/.test(params[0][1]))return '';
    const page=Number(params[0][1]);return page>=1&&page<=1000?c.url+'?page='+page:'';
  }
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
  scope.OzonCategoryCore=Object.freeze({keyFromUrl,normalizeUrl,samePage,paginationUrl,parseUrls,validateOptions,priceAllowed,qualifiedProduct,capturedPrice});
})(globalThis);
