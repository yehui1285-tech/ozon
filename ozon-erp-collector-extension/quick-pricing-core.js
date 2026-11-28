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
    let result=null, maxCost=null,price=null;
    if(!missing.some(key=>['green','black','factorOverride','quoteOverride'].includes(key))){
      const {quote,trueSale}=math.calc(row);
      if(Number.isFinite(quote)&&Number.isFinite(trueSale)&&quote>0&&trueSale>0){
        const centsQuote=Number(quote.toFixed(2)),centsSale=Number(trueSale.toFixed(2));
        price={quote,trueSale,relation:centsQuote<centsSale?'below':centsQuote>centsSale?'above':'equal'};
      }
    }
    // Procurement is the one field that can be absent while displaying the target ceiling.
    if (!missing.some(key => key !== 'cost')) {
      const calc=math.calc(row);
      if (calc.quote > 0 && Number.isFinite(target) && target >= 0) {
        const ceiling=(calc.quote-calc.autoFee-calc.labelFee-calc.platform)/(1+target)-math.number(row.freight);
        maxCost=Math.max(0,Math.floor((ceiling+1e-9)*100)/100);
      }
      if (!missing.length && calc.quote>0 && Number.isFinite(calc.profit) && Number.isFinite(calc.margin)) result=calc;
    }
    return {complete:!!result,missing,result,maxCost,price,meetsTarget:!!result && result.margin>=target};
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

  function selectBeforeOpen(event,select){
    if(event.button!==undefined&&event.button!==0&&event.button!==1)return true;
    if(select()===true)return true;
    event.preventDefault();return false;
  }

  function parseNumber(value) {
    let textValue = String(value ?? '').replace(/[¥￥₽%]/g, '').replace(/[\u00a0\u202f]/g, ' ').trim();
    const match = textValue.match(/-?[\d\s.,]+/);
    if (!match) return 0;
    textValue = match[0].replace(/\s+/g, '');
    const comma = textValue.lastIndexOf(','), dot = textValue.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const dec = comma > dot ? ',' : '.';
      textValue = textValue.replace(new RegExp(`\\${dec === ',' ? '.' : ','}`, 'g'), '').replace(dec, '.');
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(textValue)) textValue = textValue.replace(/,/g, '');
    else if (comma >= 0) textValue = textValue.replace(',', '.');
    const result = Number(textValue);
    return Number.isFinite(result) ? result : 0;
  }

  function parseCommissionsList(raw) {
    if (Array.isArray(raw)) return raw.map(parseNumber).filter(v => v > 0).slice(0, 3);
    const str = String(raw ?? '').trim();
    if (!str) return [];
    const withPercent = [...str.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m => parseNumber(m[1])).filter(v => v > 0);
    if (withPercent.length) return withPercent.slice(0, 3);
    return [...str.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => parseNumber(m[0])).filter(v => v > 0).slice(0, 3);
  }

  function parseDimensionsSpec(raw) {
    const norm = String(raw ?? '').replace(/[×]/g, 'x').replace(/\s+/g, ' ').trim();
    const match = norm.match(/(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*(mm|毫米|cm|厘米)?/i);
    if (!match) return { lengthCm: 0, widthCm: 0, heightCm: 0, lengthMm: 0, widthMm: 0, heightMm: 0 };
    const vals = [parseNumber(match[1]), parseNumber(match[2]), parseNumber(match[3])];
    if (vals.some(v => !(v > 0))) return { lengthCm: 0, widthCm: 0, heightCm: 0, lengthMm: 0, widthMm: 0, heightMm: 0 };
    const unit = String(match[4] || '').toLowerCase();
    const isMm = unit.includes('mm') || unit.includes('毫米') || (!unit && Math.max(...vals) > 150);
    const cm = isMm ? vals.map(v => v / 10) : vals;
    const mm = isMm ? vals : vals.map(v => Math.round(v * 1000) / 100);
    return { lengthCm: cm[0], widthCm: cm[1], heightCm: cm[2], lengthMm: mm[0], widthMm: mm[1], heightMm: mm[2] };
  }

  function parseWeightSpec(raw) {
    const str = String(raw ?? '').trim();
    const match = str.match(/(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|кг|g|克)?/i);
    if (!match) return { weightKg: 0, weightG: 0 };
    const val = parseNumber(match[1]);
    if (!(val > 0)) return { weightKg: 0, weightG: 0 };
    const unit = String(match[2] || '').toLowerCase();
    const isKg = /^(?:kg|千克|公斤|кг)$/i.test(unit);
    const weightKg = isKg ? val : val / 1000;
    const weightG = isKg ? Math.round(val * 1000) : val;
    return { weightKg, weightG };
  }

  function prefillFromPoolItem(product, taskPricing = scope.OzonTaskPricingCore) {
    const empty = (extra = {}) => ({
      available: false, currencyBlocked: false, green: '', commission: '', freight: '', freightRoute: '',
      source: 'none', pagePrice: '', competitorPrice: '', floorMaxCost: null, missing: [],
      snapshot: { sku: skuOf(product?.sku), commissions: [], lengthMm: 0, widthMm: 0, heightMm: 0, weightG: 0 },
      ...extra,
    });
    if (!product || typeof product !== 'object') return empty();
    const rawPrice = text(product.price);
    if (rawPrice && /[₽$€]|\bRUB\b|руб\.?/i.test(rawPrice)) return empty({ currencyBlocked: true });
    const numFn = taskPricing?.number || parseNumber;
    const pagePrice = numFn(rawPrice);
    const rawComp = text(product.competitor);
    const competitorPrice = rawComp && !/[₽$€]|\bRUB\b|руб\.?/i.test(rawComp) ? numFn(rawComp) : 0;
    const source = taskPricing?.chooseSource
      ? taskPricing.chooseSource(pagePrice, competitorPrice)
      : (competitorPrice > 0 && (pagePrice <= 0 || competitorPrice < pagePrice - 0.01) ? 'competitor' : pagePrice > 0 ? 'page' : 'none');
    const effectiveGreen = source === 'competitor' ? competitorPrice : source === 'page' ? pagePrice : 0;
    const commissions = parseCommissionsList(product.commissions);
    const commission = effectiveGreen > 0 && taskPricing?.selectedCommission ? taskPricing.selectedCommission(effectiveGreen, commissions) : 0;
    const dims = parseDimensionsSpec(product.dimensions);
    const weight = parseWeightSpec(product.weight);
    const freight = effectiveGreen > 0 && taskPricing?.calculateFreight
      ? taskPricing.calculateFreight({ greenPrice: effectiveGreen, weightKg: weight.weightKg, lengthCm: dims.lengthCm, widthCm: dims.widthCm, heightCm: dims.heightCm })
      : { price: 0, route: '' };
    const missing = [];
    if (!(effectiveGreen > 0)) missing.push('绿标价格');
    if (!(commission > 0)) missing.push('佣金档位');
    if (!(freight.price > 0)) missing.push('国际运费');
    let floorMaxCost = null;
    if (effectiveGreen > 0 && commission > 0 && freight.price > 0 && taskPricing?.calculateMaxPurchaseCost) {
      const calc = taskPricing.calculateMaxPurchaseCost({ greenPrice: effectiveGreen, blackPrice: effectiveGreen, commission, freight: freight.price, targetMargin: 0.18 });
      if (calc) floorMaxCost = calc.maxPurchaseCost;
    }
    return {
      available: effectiveGreen > 0,
      currencyBlocked: false,
      green: effectiveGreen > 0 ? effectiveGreen.toFixed(2) : '',
      commission: commission > 0 ? String(commission) : '',
      freight: freight.price > 0 ? freight.price.toFixed(2) : '',
      freightRoute: String(freight.route || ''),
      source,
      pagePrice: pagePrice > 0 ? pagePrice.toFixed(2) : '',
      competitorPrice: competitorPrice > 0 ? competitorPrice.toFixed(2) : '',
      floorMaxCost,
      missing,
      snapshot: {
        sku: skuOf(product.sku),
        commissions,
        lengthMm: dims.lengthMm,
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
        weightG: weight.weightG,
      },
    };
  }

  function buildTaskPricingPayload(product, taskPricing = scope.OzonTaskPricingCore) {
    const sku = skuOf(product?.sku);
    if (!sku) throw new Error('商品 SKU 无效');
    let productUrl = '';
    try {
      const u = new URL(String(product?.link || ''));
      if (u.protocol === 'https:' && u.hostname === 'www.ozon.ru' && /^\/product\//i.test(u.pathname) && !u.username && !u.password) {
        u.search = ''; u.hash = ''; productUrl = u.href;
      }
    } catch {}
    if (!productUrl) throw new Error('缺少有效的 Ozon 商品链接');
    const prefill = prefillFromPoolItem(product, taskPricing);
    const snap = prefill.snapshot;
    const poolFastLane = prefill.source === 'page' && prefill.available && snap.commissions.length >= 3 && snap.lengthMm > 0 && snap.widthMm > 0 && snap.heightMm > 0 && snap.weightG > 0;
    return {
      qualification: { status: 'qualified', source: 'batch_store_scan' },
      fastMode: true,
      poolFastLane,
      ozon: { sku, productUrl, batchScanSnapshot: snap },
    };
  }

  function createRow(rows, { sku, link = '', values = {}, id = '' }, maxRows = 1000) {
    const key = skuOf(sku);
    if (!key || !Array.isArray(rows)) throw new Error('SKU 或核价记录列表无效');
    if (rows.length >= maxRows) throw new Error(`核价表已达到 ${maxRows} 行上限`);
    const rowId = text(id) || ('qp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(rowId) || rows.some(r => r?.id === rowId)) throw new Error('新建核价记录编号无效或已存在');
    const row = { id: rowId, sku: key, link: String(link ?? '') };
    if (row.link.length > 4000) throw new Error('商品链接过长');
    for (const field of editable) {
      const rawVal = String(values?.[field] ?? '');
      if (rawVal.length > (field === 'source' || field === 'note' ? 4000 : 240)) throw new Error('核价字段过长：' + field);
      row[field] = rawVal;
    }
    const defaultMath = { number: parseNumber };
    if (!validNumber(row, 'green', defaultMath) || !validNumber(row, 'black', defaultMath)) {
      throw new Error('新建核价记录需先补齐有效的绿标价格与黑标价格');
    }
    return { rows: [...rows, row], row };
  }

  scope.OzonQuickPricingCore=Object.freeze({rowsForSku,evaluate,patchRow,createRow,prefillFromPoolItem,buildTaskPricingPayload,selectBeforeOpen});
})(globalThis);
