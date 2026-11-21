(function (scope) {
  'use strict';
  const editable = new Set(['green','black','commission','freight','cost','factorOverride','quoteOverride','source','note']);
  const required = ['green','black','commission','cost','freight'];
  const text = value => String(value ?? '').trim();
  const skuOf = value => /^\d+$/.test(text(value)) ? text(value) : '';

  function rowsForSku(rows, sku) {
    const key = skuOf(sku);
    return key && Array.isArray(rows) ? rows.filter(row => skuOf(row?.sku) === key && text(row?.id)) : [];
  }

  function validNumber(row,key,math) {
    const value = text(row[key]);
    if (!value) return false;
    // Keep the established price parser, but refuse partial/non-numeric or signed values.
    const plain = value.replace(/[¥￥₽%\s\u00a0\u202f]/g,'');
    if (!/^\d+(?:[.,]\d+)?$/.test(plain) && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(plain) && !/^\d{1,3}(?:\.\d{3})+,\d+$/.test(plain)) return false;
    const amount = math.number(value);
    if (!Number.isFinite(amount) || amount < 0) return false;
    if (['green','black','factorOverride','quoteOverride'].includes(key)) return amount > 0;
    return key !== 'commission' || amount <= 100;
  }

  function evaluate(row, math, target=0.18) {
    row = row || {};
    const missing = required.filter(key => !validNumber(row,key,math));
    for (const key of ['factorOverride','quoteOverride']) if (text(row[key]) && !validNumber(row,key,math)) missing.push(key);
    let result=null, maxCost=null;
    // Procurement is the one field that can be absent while displaying the target ceiling.
    if (!missing.some(key => key !== 'cost')) {
      const calc=math.calc(row);
      if (calc.quote > 0 && Number.isFinite(target) && target >= 0) {
        const ceiling=(calc.quote-calc.autoFee-calc.labelFee-calc.platform)/(1+target)-math.number(row.freight);
        maxCost=Math.max(0,Math.floor((ceiling+1e-9)*100)/100);
      }
      if (!missing.length && calc.quote>0 && Number.isFinite(calc.profit) && Number.isFinite(calc.margin)) result=calc;
    }
    return {complete:!!result,missing,result,maxCost,meetsTarget:!!result && result.margin>=target};
  }

  function patchRow(rows, {sku,id,base,patch}) {
    const key=skuOf(sku);
    if (!key || !text(id) || !Array.isArray(rows) || !base || !patch) throw new Error('SKU 或核价记录无效');
    const matches=rows.filter(row=>row?.id===id);
    if (matches.length!==1 || skuOf(matches[0].sku)!==key) throw new Error('核价记录已不存在或 SKU 不匹配');
    const current=matches[0], updates={};
    for (const [field,value] of Object.entries(patch)) {
      if (!editable.has(field) || typeof value!=='string') throw new Error('不可修改的核价字段');
      if (!Object.hasOwn(base,field) || String(current[field]??'')!==String(base[field]??'')) throw new Error('核价字段已发生变化，请重新读取后再编辑（冲突）');
      if (value.length>(field==='source'||field==='note'?4000:240)) throw new Error('核价字段过长');
      updates[field]=value;
    }
    return rows.map(row=>row===current?{...current,...updates}:row);
  }

  scope.OzonQuickPricingCore=Object.freeze({rowsForSku,evaluate,patchRow});
})(globalThis);
