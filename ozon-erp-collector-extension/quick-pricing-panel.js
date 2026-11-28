(function(scope){
  'use strict';
  const fields=[['green','绿标价格'],['black','黑标价格'],['commission','佣金%'],['freight','国际运费'],['cost','采购成本'],['factorOverride','手动系数'],['quoteOverride','手动定价'],['source','货源链接 / 备注']];
  const core=scope.OzonQuickPricingCore;
  const money=n=>Number.isFinite(n)?'¥'+n.toFixed(2):'—';
  const safeOzonUrl=raw=>{try{const u=new URL(raw||'');return u.protocol==='https:'&&u.hostname==='www.ozon.ru'&&u.pathname.startsWith('/product/')&&!u.username&&!u.password?u.href:''}catch{return ''}};
  function create(root,adapter){
    root.classList.add('qp-panel');
    root.innerHTML='<div class="qp-header"><h2>单品快速核价</h2><button type="button" data-qp="refresh">刷新核价</button></div><div class="qp-head-card"><button type="button" class="qp-thumb-btn" data-qp="thumb" title="点击放大主图扫码找同款" hidden></button><div class="qp-current" data-qp="title">请在左侧选择商品</div></div><div class="qp-link-row"><a data-qp="link" target="_blank" rel="noopener noreferrer" hidden>打开 Ozon 商品页</a><button type="button" class="qp-test-btn" data-qp="fetchBlack" hidden>读取同源黑标价（测试）</button></div><div class="qp-prefill" data-qp="prefill" hidden></div><p data-qp="message" role="status" class="qp-message">请选择待处理商品</p><label class="qp-choice">核价记录<select data-qp="row" aria-label="核价记录"></select></label><div class="qp-fields"></div><div class="qp-result" data-qp="result"></div><div class="qp-margin" data-qp="margin" aria-live="polite"></div><p class="qp-hint">使用原核价规则；调整定价或系数后，请重新确认运费。实际采购成本和货源由人工核实。</p><div class="qp-actions"><button data-qp="save" type="button">保存核价</button><button data-qp="approve" type="button" class="qp-primary">保存并标记已复核</button><button data-qp="reject" type="button" class="qp-reject">淘汰</button><button data-qp="next" type="button">下一件</button></div>';
    const q=key=>root.querySelector(`[data-qp="${key}"]`), inputs={};
    for(const [key,label] of fields){const l=document.createElement('label');l.textContent=label;const el=document.createElement(key==='note'?'textarea':'input');el.dataset.field=key;el.setAttribute('aria-label',label);el.maxLength=key==='source'||key==='note'?4000:240;if(key!=='source'&&key!=='note')el.inputMode='decimal';l.append(el);root.querySelector('.qp-fields').append(l);inputs[key]=el;el.addEventListener('input',updateResult);if(key==='quoteOverride'){const box=document.createElement('div');box.className='qp-price';box.dataset.qp='price';box.setAttribute('aria-live','polite');root.querySelector('.qp-fields').append(box)}}
    let product=null,base=null,rows=[],busy=false,seq=0,fetchSeq=0,disposed=false,timer=null,inFlight=null,isDraft=false,prefillInfo=null,fetchingBlack=false,sourceUrlNote='';
    const scheduleTimer=(...args)=>typeof scope.setTimeout==='function'?scope.setTimeout(...args):typeof setTimeout==='function'?setTimeout(...args):0;
    const cancelTimer=id=>typeof scope.clearTimeout==='function'?scope.clearTimeout(id):typeof clearTimeout==='function'?clearTimeout(id):undefined;
    function schedulePoll(){if(timer!==null){cancelTimer(timer);timer=null}if(disposed||!product)return;const delay=base&&!isDraft?15000:2000;timer=scheduleTimer(()=>{timer=null;if(!disposed&&document.visibilityState==='visible')void refresh();else schedulePoll()},delay)}
    const draft=()=>Object.fromEntries(fields.map(([key])=>[key,inputs[key].value]));
    const patch=()=>base?Object.fromEntries(Object.entries(draft()).filter(([k,v])=>v!==String(base[k]??''))):{};
    const dirty=()=>Object.keys(patch()).length>0;
    function notify(text,error=false){q('message').textContent=text;q('message').classList.toggle('qp-error',error)}
    function renderPrefillBanner(){
      const el=q('prefill');if(!el)return;
      const children=[];
      if(isDraft&&prefillInfo?.available){
        const srcText=prefillInfo.source==='competitor'
          ?`预填：跟卖最低价 ¥${prefillInfo.competitorPrice}${prefillInfo.pagePrice?`（卡片 ¥${prefillInfo.pagePrice}）`:''}`
          :`预填：卡片价 ¥${prefillInfo.pagePrice}`;
        const routeText=prefillInfo.freightRoute?` · ${prefillInfo.freightRoute}`:'';
        const span=document.createElement('span');span.textContent=srcText+routeText;children.push(span);
      }else if(isDraft&&prefillInfo?.currencyBlocked){
        const span=document.createElement('span');span.textContent='原价非人民币，已跳过自动预填';children.push(span);
      }
      const safeSource=safeOzonUrl(sourceUrlNote);
      if(safeSource){
        const a=document.createElement('a');a.href=safeSource;a.target='_blank';a.rel='noopener noreferrer';a.textContent='同源黑标商品页 ↗';
        children.push(a);
      }
      el.hidden=!children.length;
      el.replaceChildren(...children);
    }
    function updateResult(){
      const value=base?core.evaluate({...base,...draft()},adapter.math):null;
      const price=q('price'),summary=value?.price;
      const label=document.createElement('span');label.className='qp-price-label';label.textContent='定价';
      const amount=document.createElement('strong');amount.className='qp-price-amount';amount.textContent=summary?money(summary.quote):'—';
      const details=document.createElement('div');details.className='qp-price-detail';details.textContent=summary?'真实售价 '+money(summary.trueSale):isDraft&&prefillInfo?.available?'已预填绿标/佣金/运费，待补真实黑标价':'待补齐有效绿标、黑标及定价参数';
      const badge=document.createElement('span');badge.className='qp-price-badge';badge.textContent=summary?({below:'低于真实售价',equal:'等于真实售价',above:'高于真实售价'})[summary.relation]:'待计算';
      price.dataset.relation=summary?.relation||'unknown';price.replaceChildren(label,amount,badge,details);
      const parts=[];
      if(value?.maxCost!==null&&value?.maxCost!==undefined)parts.push('18% 目标采购上限 '+money(value.maxCost));
      else if(isDraft&&prefillInfo?.floorMaxCost!==null&&prefillInfo?.floorMaxCost!==undefined)parts.push('保底参考（黑标=绿标）18% 上限 '+money(prefillInfo.floorMaxCost));
      if(value?.complete){parts.push('利润 '+money(value.result.profit))}
      else if(base)parts.push(isDraft&&prefillInfo?.floorMaxCost!=null?'待补真实黑标价（保底仅初筛参考，不作正式核价）':'待补齐有效核价字段');
      else parts.push('等待插件推送本 SKU 核价数据');
      q('result').replaceChildren(...parts.map(part=>{const el=document.createElement('div');el.textContent=part;return el}));q('result').classList.toggle('qp-pass',!!value?.meetsTarget);
      const margin=q('margin'),marginLabel=document.createElement('span'),marginValue=document.createElement('strong'),marginBadge=document.createElement('span');
      marginLabel.className='qp-margin-label';marginLabel.textContent='利润率';marginValue.className='qp-margin-value';marginValue.textContent=value?.complete?(value.result.margin*100).toFixed(2)+'%':'—';marginBadge.className='qp-margin-badge';marginBadge.textContent=value?.complete?(value.meetsTarget?'✓ 达标':'未达标'):'待计算';margin.dataset.tone=value?.complete?(value.meetsTarget?'pass':'under'):'pending';margin.replaceChildren(marginLabel,marginValue,marginBadge);
      renderPrefillBanner();
      const canCreate=typeof adapter.create==='function';
      const saveBtn=q('save'),fetchBtn=q('fetchBlack');
      saveBtn.textContent=isDraft?'新建保存核价':'保存核价';
      saveBtn.disabled=busy||fetchingBlack||!base||(isDraft&&(!canCreate||!value?.price));
      q('approve').disabled=busy||fetchingBlack||!base||(isDraft&&!canCreate)||!value?.complete||!!product?.blocked;
      q('reject').disabled=busy||fetchingBlack||!product;q('next').disabled=busy||fetchingBlack||!product;q('refresh').disabled=busy||fetchingBlack||!product;q('row').disabled=busy||fetchingBlack||rows.length<2;
      if(fetchBtn){
        const canFetch=typeof adapter.fetchBlackPrice==='function'&&Boolean(safeOzonUrl(product?.link));
        fetchBtn.hidden=!canFetch;
        fetchBtn.textContent=fetchingBlack?'读取中…':'读取同源黑标价（测试）';
        fetchBtn.disabled=busy||fetchingBlack||!canFetch;
      }
      for(const input of Object.values(inputs))input.disabled=busy||fetchingBlack||!base;
    }
    function setBase(row,draftMode=false){isDraft=Boolean(draftMode&&row);base=row?{...row}:null;for(const [key] of fields)inputs[key].value=String(row?.[key]??'');updateResult();schedulePoll()}
    function updateChoices(matches,preferred){rows=matches;const list=q('row');list.replaceChildren();if(matches.length!==1){const o=document.createElement('option');o.value='';o.textContent=matches.length?'请选择具体核价记录':isDraft?'商品池预填草稿（尚未入核价表）':'未找到匹配核价记录';list.append(o)}for(const row of matches){const o=document.createElement('option');o.value=row.id;o.textContent=`绿标 ${row.green||'—'} / 黑标 ${row.black||'—'} · ${row.id.slice(0,10)}`;list.append(o)}list.value=matches.some(r=>r.id===preferred)?preferred:matches.length===1?matches[0].id:'';}
    function showProduct(){
      q('title').textContent=product?`${product.sku} · ${product.title||'商品'}`:'请点击左侧商品名称';
      const link=q('link'),href=safeOzonUrl(product?.link);
      link.hidden=!href;if(href)link.href=href;else link.removeAttribute('href');
      const thumb=q('thumb');
      if(thumb){
        const norm=adapter.normalizeImageUrl||scope.OzonProductPoolCore?.normalizeImageUrl;
        const imgUrl=norm?norm(product?.imageUrl):'';
        if(imgUrl){
          const img=document.createElement('img');
          img.alt=product?.title||product?.sku||'商品主图';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.src=imgUrl;
          thumb.replaceChildren(img);thumb.hidden=false;
        }else{thumb.hidden=true;thumb.replaceChildren()}
      }
      updateResult();
    }
    function buildDraftFromProduct(item){
      prefillInfo=core.prefillFromPoolItem(item,adapter.taskPricing||scope.OzonTaskPricingCore);
      return {id:'',sku:item.sku,link:item.link||'',green:prefillInfo.green,black:'',commission:prefillInfo.commission,freight:prefillInfo.freight,cost:'',factorOverride:'',quoteOverride:'',source:'',note:''};
    }
    async function refresh(manual=false,force=false){
      if(!product||busy||fetchingBlack||disposed)return;if(dirty()){if(manual)notify('有未保存修改，先保存或切换后重新读取。',true);return}
      if(!manual&&!force&&inFlight&&inFlight.sku===product.sku&&Date.now()-inFlight.at<800)return;
      const token=++seq,sku=product.sku,previous=base?.id;
      inFlight={sku,at:Date.now()};
      if(manual)notify('正在读取对应 SKU 的核价记录…');
      try{
        const data=await adapter.load(sku);
        if(disposed||token!==seq||product?.sku!==sku||dirty())return;
        const matches=core.rowsForSku(data,sku);
        if(!matches.length){
          const draftRow=buildDraftFromProduct(product);
          isDraft=true;updateChoices([],null);setBase(draftRow,true);
          notify(prefillInfo.currencyBlocked?'非人民币售价，已跳过自动预填；可手填或打开商品页用插件推送。':prefillInfo.available?'已从商品池预填绿标/佣金/运费。可点「读取同源黑标价（测试）」或打开商品页推送。':'暂无核价记录。可补齐字段后保存，或打开商品页用插件推送。');
          return;
        }
        prefillInfo=null;isDraft=false;updateChoices(matches,previous);setBase(matches.find(row=>row.id===q('row').value),false);
        notify(!base?'同一 SKU 有多条核价记录，请明确选择。':'已读取本 SKU 核价记录；修改后请保存。');
      }
      catch(e){if(token===seq&&product?.sku===sku&&!disposed)notify('读取未确认：'+(e.message||e),true)}
      finally{if(inFlight&&token===seq)inFlight=null;if(token===seq)schedulePoll()}
    }
    function select(next){
      if(disposed||busy||fetchingBlack)return false;
      if(product?.sku===next?.sku&&next){product=next;showProduct();return true}
      if(dirty()&&!confirm('当前核价有未保存修改，确认放弃后切换商品？'))return false;
      seq++;fetchSeq++;product=next||null;rows=[];isDraft=false;prefillInfo=null;sourceUrlNote='';updateChoices([],null);setBase(null,false);showProduct();adapter.selection?.(product);
      if(product)void refresh(true);else notify('请选择商品');return true;
    }
    q('row').addEventListener('change',()=>{if(dirty()&&!confirm('当前核价有未保存修改，确认切换核价记录？')){q('row').value=base.id;return}setBase(rows.find(r=>r.id===q('row').value),false);notify(base?'已选择核价记录。':'请选择核价记录。')});
    async function fetchBlackPrice(){
      if(!product||busy||fetchingBlack||typeof adapter.fetchBlackPrice!=='function')return;
      const target=product,token=++fetchSeq;fetchingBlack=true;updateResult();
      notify('正在后台读取同源黑标价（有更低跟卖时将自动跳转跟卖页，可能短暂切屏 1–3 秒）…');
      try{
        const res=await adapter.fetchBlackPrice(target);
        if(disposed||token!==fetchSeq||product?.sku!==target.sku)return;
        if(res?.disqualified)throw new Error(res.disqualificationReason||'商品页显示不符合要求');
        const black=Number(res?.originalBlackPrice||0);
        if(res?.partial||!(black>0)){
          if(Number(res?.effectiveGreenPrice||0)>0)inputs.green.value=Number(res.effectiveGreenPrice).toFixed(2);
          if(Number(res?.selectedCommission||0)>0)inputs.commission.value=String(res.selectedCommission);
          if(Number(res?.internationalFreight||0)>0)inputs.freight.value=Number(res.internationalFreight).toFixed(2);
          if(res?.sourceProductUrl||res?.blackPriceSourceUrl)sourceUrlNote=res.sourceProductUrl||res.blackPriceSourceUrl;
          updateResult();
          notify('未读到同源黑标价：'+(res?.partialError||'请点击「打开 Ozon 商品页」人工查看'),true);
          return;
        }
        inputs.black.value=black.toFixed(2);
        if(Number(res.effectiveGreenPrice||0)>0)inputs.green.value=Number(res.effectiveGreenPrice).toFixed(2);
        if(Number(res.selectedCommission||0)>0)inputs.commission.value=String(res.selectedCommission);
        if(Number(res.internationalFreight||0)>0)inputs.freight.value=Number(res.internationalFreight).toFixed(2);
        sourceUrlNote=res.sourceProductUrl||res.blackPriceSourceUrl||'';
        updateResult();
        const originLabel=res.blackPriceSource==='competitor'?'最低价跟卖页':'本品页';
        notify(`✓ 已读取同源黑标价 ¥${black.toFixed(2)}（${originLabel}${res.freightRoute?' · '+res.freightRoute:''}），核对后请点保存。`);
      }catch(e){
        if(!disposed&&token===fetchSeq&&product?.sku===target.sku)notify('读取同源黑标价失败：'+(e.message||e),true);
      }finally{if(token===fetchSeq){fetchingBlack=false;updateResult()}}
    }
    async function persist(approve){
      if(busy||fetchingBlack||!base||!product)return;
      const values=draft(),value=core.evaluate({...base,...values},adapter.math);
      if(approve&&(!value.complete||product.blocked))return;
      if(isDraft&&(!value.price||typeof adapter.create!=='function'))return;
      const selected=product,savedBase=base,wasDraft=isDraft,startedAt=typeof performance!=='undefined'?performance.now():Date.now();busy=true;seq++;updateResult();notify(wasDraft?'正在新建并保存核价…':'正在保存核价…');let pricingSaved=false;
      try{
        const saved=wasDraft
          ?await adapter.create({sku:selected.sku,link:selected.link||'',values})
          :await adapter.save({sku:selected.sku,id:savedBase.id,base:savedBase,patch:patch()});
        if(!saved||(!wasDraft&&saved.id!==savedBase.id)||!saved.id||String(saved.sku)!==String(selected.sku))throw Error('未确认核价记录身份');
        pricingSaved=true;prefillInfo=null;
        const nextRows=wasDraft?[...rows,saved]:rows.map(r=>r.id===saved.id?saved:r);
        isDraft=false;updateChoices(nextRows,saved.id);setBase(saved,false);
        const elapsedMs=Math.max(1,Math.round((typeof performance!=='undefined'?performance.now():Date.now())-startedAt));
        if(approve){if(!core.evaluate(saved,adapter.math).complete||selected.blocked)throw Error('核价数据不全或运输待复核');await adapter.status(selected,'approved');const totalMs=Math.max(1,Math.round((typeof performance!=='undefined'?performance.now():Date.now())-startedAt));notify(`核价已保存，商品已标记人工已复核（${totalMs}ms）。`);busy=false;updateResult();adapter.advance(selected);return}
        notify(wasDraft?`✓ 已新建并保存到核价表（${elapsedMs}ms）`:`✓ 核价已保存（${elapsedMs}ms）`);
      }
      catch(e){notify((pricingSaved?'核价已保存，处理状态未确认：':'保存未确认：')+(e.message||e),true)}finally{busy=false;updateResult()}
    }
    async function reject(){if(!product||busy||fetchingBlack)return;const selected=product;if(!confirm(`确认淘汰 SKU ${selected.sku}？商品仍保留历史记录。${dirty()?' 未保存的核价修改将放弃。':''}`))return;busy=true;seq++;updateResult();try{await adapter.status(selected,'rejected');setBase(base,isDraft);notify('已标记淘汰。');busy=false;updateResult();adapter.advance(selected)}catch(e){notify('淘汰未确认：'+(e.message||e),true)}finally{busy=false;updateResult()}}
    q('refresh').addEventListener('click',()=>void refresh(true));q('save').addEventListener('click',()=>void persist(false));q('approve').addEventListener('click',()=>void persist(true));q('reject').addEventListener('click',()=>void reject());q('next').addEventListener('click',()=>adapter.advance(product));q('fetchBlack')?.addEventListener('click',()=>void fetchBlackPrice());q('thumb')?.addEventListener('click',()=>{if(product)adapter.openImage?.(product)});
    const focus=()=>{if(document.visibilityState==='visible')void refresh()};const onPushed=e=>{if(disposed||!product)return;const pushedSku=e?.detail?.sku;if(pushedSku&&String(pushedSku)!==String(product.sku))return;void refresh(false,true)};window.addEventListener('focus',focus);window.addEventListener('storage',focus);window.addEventListener('ozon-pricing-pushed',onPushed);document.addEventListener('visibilitychange',focus);showProduct();
    return {select,refresh,get selectedSku(){return product?.sku||''},dispose(){disposed=true;seq++;fetchSeq++;if(timer!==null){cancelTimer(timer);timer=null}window.removeEventListener('focus',focus);window.removeEventListener('storage',focus);window.removeEventListener('ozon-pricing-pushed',onPushed);document.removeEventListener('visibilitychange',focus)}};
  }
  scope.OzonQuickPricingPanel=Object.freeze({create});
})(globalThis);
