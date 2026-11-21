(function(scope){
  'use strict';
  const fields=[['green','绿标价格'],['black','黑标价格'],['commission','佣金%'],['freight','国际运费'],['cost','采购成本'],['factorOverride','手动系数'],['quoteOverride','手动定价'],['source','货源链接 / 说明'],['note','核价备注']];
  const core=scope.OzonQuickPricingCore;
  const money=n=>Number.isFinite(n)?'¥'+n.toFixed(2):'—';
  function create(root,adapter){
    root.classList.add('qp-panel');
    root.innerHTML='<div class="qp-header"><h2>单品快速核价</h2><button type="button" data-qp="refresh">刷新核价</button></div><div class="qp-current" data-qp="title">请在左侧选择商品</div><a data-qp="link" target="_blank" rel="noopener noreferrer" hidden>打开 Ozon 商品页</a><p data-qp="message" role="status" class="qp-message">请选择待处理商品</p><label class="qp-choice">核价记录<select data-qp="row" aria-label="核价记录"></select></label><div class="qp-fields"></div><div class="qp-result" data-qp="result"></div><p class="qp-hint">使用原核价规则；调整定价或系数后，请重新确认运费。实际采购成本和货源由人工核实。</p><div class="qp-actions"><button data-qp="save" type="button">保存核价</button><button data-qp="approve" type="button" class="qp-primary">保存并标记已复核</button><button data-qp="reject" type="button" class="qp-reject">淘汰</button><button data-qp="next" type="button">下一件</button></div>';
    const q=key=>root.querySelector(`[data-qp="${key}"]`), inputs={};
    for(const [key,label] of fields){const l=document.createElement('label');l.textContent=label;const el=document.createElement(key==='note'?'textarea':'input');el.dataset.field=key;el.setAttribute('aria-label',label);el.maxLength=key==='source'||key==='note'?4000:240;if(key!=='source'&&key!=='note')el.inputMode='decimal';l.append(el);root.querySelector('.qp-fields').append(l);inputs[key]=el;el.addEventListener('input',updateResult);if(key==='quoteOverride'){const box=document.createElement('div');box.className='qp-price';box.dataset.qp='price';box.setAttribute('aria-live','polite');root.querySelector('.qp-fields').append(box)}}
    let product=null,base=null,rows=[],busy=false,seq=0,disposed=false;
    const draft=()=>Object.fromEntries(fields.map(([key])=>[key,inputs[key].value]));
    const patch=()=>base?Object.fromEntries(Object.entries(draft()).filter(([k,v])=>v!==String(base[k]??''))):{};
    const dirty=()=>Object.keys(patch()).length>0;
    function notify(text,error=false){q('message').textContent=text;q('message').classList.toggle('qp-error',error)}
    function updateResult(){
      const value=base?core.evaluate({...base,...draft()},adapter.math):null;
      const price=q('price'),summary=value?.price;
      const label=document.createElement('span');label.className='qp-price-label';label.textContent='定价';
      const amount=document.createElement('strong');amount.className='qp-price-amount';amount.textContent=summary?money(summary.quote):'—';
      const details=document.createElement('div');details.className='qp-price-detail';details.textContent=summary?'真实售价 '+money(summary.trueSale):'待补齐有效绿标、黑标及定价参数';
      const badge=document.createElement('span');badge.className='qp-price-badge';badge.textContent=summary?({below:'低于真实售价',equal:'等于真实售价',above:'高于真实售价'})[summary.relation]:'待计算';
      price.dataset.relation=summary?.relation||'unknown';price.replaceChildren(label,amount,badge,details);
      const parts=[];if(value?.maxCost!==null&&value?.maxCost!==undefined)parts.push('18% 目标采购上限 '+money(value.maxCost));
      if(value?.complete){parts.push('利润 '+money(value.result.profit));parts.push('利润率 '+(value.result.margin*100).toFixed(2)+'% '+(value.meetsTarget?'✓ 达标':'· 未达标'))}
      else if(base)parts.push('待补齐有效核价字段');else parts.push('等待插件推送本 SKU 核价数据');
      q('result').replaceChildren(...parts.map(part=>{const el=document.createElement('div');el.textContent=part;return el}));q('result').classList.toggle('qp-pass',!!value?.meetsTarget);
      q('save').disabled=busy||!base;q('approve').disabled=busy||!base||!value?.complete||!!product?.blocked;q('reject').disabled=busy||!product;q('next').disabled=busy||!product;q('refresh').disabled=busy||!product;q('row').disabled=busy||rows.length<2;
      for(const input of Object.values(inputs))input.disabled=busy||!base;
    }
    function setBase(row){base=row?{...row}:null;for(const [key] of fields)inputs[key].value=String(row?.[key]??'');updateResult()}
    function updateChoices(matches,preferred){rows=matches;const list=q('row');list.replaceChildren();if(matches.length!==1){const o=document.createElement('option');o.value='';o.textContent=matches.length?'请选择具体核价记录':'未找到匹配核价记录';list.append(o)}for(const row of matches){const o=document.createElement('option');o.value=row.id;o.textContent=`绿标 ${row.green||'—'} / 黑标 ${row.black||'—'} · ${row.id.slice(0,10)}`;list.append(o)}list.value=matches.some(r=>r.id===preferred)?preferred:matches.length===1?matches[0].id:'';}
    function showProduct(){q('title').textContent=product?`${product.sku} · ${product.title||'商品'}`:'请点击左侧商品名称';const link=q('link');link.hidden=true;link.removeAttribute('href');try{const u=new URL(product?.link||'');if(u.protocol==='https:'&&u.hostname==='www.ozon.ru'&&u.pathname.startsWith('/product/')&&!u.username&&!u.password){link.href=u.href;link.hidden=false}}catch{};updateResult()}
    async function refresh(manual=false){
      if(!product||busy||disposed)return;if(dirty()){if(manual)notify('有未保存修改，先保存或切换后重新读取。',true);return}
      const token=++seq,sku=product.sku,previous=base?.id;
      if(manual)notify('正在读取对应 SKU 的核价记录…');
      try{const data=await adapter.load(sku);if(disposed||token!==seq||product?.sku!==sku||dirty())return;const matches=core.rowsForSku(data,sku);updateChoices(matches,previous);setBase(matches.find(row=>row.id===q('row').value));notify(!matches.length?'暂无核价记录。打开商品页，用插件推送到对应核价表。':!base?'同一 SKU 有多条核价记录，请明确选择。':'已读取本 SKU 核价记录；修改后请保存。')}
      catch(e){if(token===seq&&product?.sku===sku&&!disposed)notify('读取未确认：'+(e.message||e),true)}
    }
    function select(next){if(disposed||busy)return false;if(product?.sku===next?.sku&&next){product=next;showProduct();return true}if(dirty()&&!confirm('当前核价有未保存修改，确认放弃后切换商品？'))return false;seq++;product=next||null;rows=[];updateChoices([],null);setBase(null);showProduct();adapter.selection?.(product);if(product)void refresh(true);else notify('请选择商品');return true}
    q('row').addEventListener('change',()=>{if(dirty()&&!confirm('当前核价有未保存修改，确认切换核价记录？')){q('row').value=base.id;return}setBase(rows.find(r=>r.id===q('row').value));notify(base?'已选择核价记录。':'请选择核价记录。')});
    async function persist(approve){if(busy||!base||!product)return;const value=core.evaluate({...base,...draft()},adapter.math);if(approve&&(!value.complete||product.blocked))return;const selected=product,savedBase=base;busy=true;seq++;updateResult();notify('正在保存核价…');let pricingSaved=false;
      try{const saved=await adapter.save({sku:selected.sku,id:savedBase.id,base:savedBase,patch:patch()});if(!saved||saved.id!==savedBase.id||String(saved.sku)!==String(selected.sku))throw Error('未确认核价记录身份');pricingSaved=true;setBase(saved);if(approve){if(!core.evaluate(saved,adapter.math).complete||selected.blocked)throw Error('核价数据不全或运输待复核');await adapter.status(selected,'approved');notify('核价已保存，商品已标记人工已复核。');busy=false;updateResult();adapter.advance(selected);return}notify('✓ 核价已保存');}
      catch(e){notify((pricingSaved?'核价已保存，处理状态未确认：':'保存未确认：')+(e.message||e),true)}finally{busy=false;updateResult()}}
    async function reject(){if(!product||busy)return;const selected=product;if(!confirm(`确认淘汰 SKU ${selected.sku}？商品仍保留历史记录。${dirty()?' 未保存的核价修改将放弃。':''}`))return;busy=true;seq++;updateResult();try{await adapter.status(selected,'rejected');setBase(base);notify('已标记淘汰。');busy=false;updateResult();adapter.advance(selected)}catch(e){notify('淘汰未确认：'+(e.message||e),true)}finally{busy=false;updateResult()}}
    q('refresh').addEventListener('click',()=>void refresh(true));q('save').addEventListener('click',()=>void persist(false));q('approve').addEventListener('click',()=>void persist(true));q('reject').addEventListener('click',()=>void reject());q('next').addEventListener('click',()=>adapter.advance(product));
    const focus=()=>{if(document.visibilityState==='visible')void refresh()};window.addEventListener('focus',focus);window.addEventListener('storage',focus);document.addEventListener('visibilitychange',focus);const timer=setInterval(focus,12000);showProduct();
    return {select,refresh,get selectedSku(){return product?.sku||''},dispose(){disposed=true;seq++;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('storage',focus);document.removeEventListener('visibilitychange',focus)}};
  }
  scope.OzonQuickPricingPanel=Object.freeze({create});
})(globalThis);
