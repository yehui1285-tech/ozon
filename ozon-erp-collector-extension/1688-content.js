(function install1688Content(root) {
  "use strict";

  const ALLOWED_COMMANDS = new Set([
    "probe",
    "submit_image_search",
    "submit_keyword_search",
    "read_search_results",
    "read_product_detail",
    "read_sku_options",
    "select_sku_option",
  ]);
  const UNSAFE_SEMANTICS = /(?:下单|订单|支付|付款|联系|客服|聊天|优惠券|购买|立即购买|buy\s*now|payment|contact|chat|coupon|order)/i;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function visibleNodeSnapshot(rootNode = document) {
    return [...rootNode.querySelectorAll("a,img,button,[role='button'],[aria-selected],[aria-checked],[data-offer-id],[data-offer-expose-id]")]
      .filter((node) => node.getClientRects().length > 0)
      .slice(0, 2000)
      .map((node) => {
        const productAnchor = node.querySelector?.("a[href*='detail.m.1688.com/page/index.html'], a[href*='detail.1688.com/offer/']");
        const productImage = node.querySelector?.("img");
        return {
          text: String(node.innerText || node.alt || "").replace(/\s+/g, " ").trim().slice(0, 500),
          href: node.href || productAnchor?.href || "",
          imageUrl: node.currentSrc || node.src || productImage?.currentSrc || productImage?.src || "",
          ariaLabel: node.getAttribute("aria-label") || "",
          data: { offerId: node.getAttribute("data-offer-id") || node.getAttribute("data-offer-expose-id") || "" },
          visible: true,
        };
      });
  }

  function visibleControlSnapshot() {
    return [...document.querySelectorAll("input,button,form")]
      .slice(0, 200)
      .map((node) => ({
        tag: clean(node.tagName || "input").toLowerCase(),
        id: clean(node.id || node.getAttribute?.("id")).slice(0, 120),
        type: clean(node.type || node.getAttribute?.("type")).toLowerCase().slice(0, 40),
        name: clean(node.name || node.getAttribute?.("name")).slice(0, 120),
        placeholder: clean(node.placeholder || node.getAttribute?.("placeholder")).slice(0, 200),
        role: clean(node.getAttribute?.("role")).slice(0, 80),
        visible: node.getClientRects?.().length > 0,
      }));
  }

  function unsafeOwnNode(node) {
    const fields = ["id", "name", "title", "value", "placeholder", "href", "aria-label", "action"];
    return UNSAFE_SEMANTICS.test(`${node?.innerText || ""} ${fields.map((field) => node?.getAttribute?.(field) || "").join(" ")}`);
  }

  function unsafeNode(node) {
    let current = node;
    while (current) {
      if (unsafeOwnNode(current)) return true;
      if (current === document.documentElement || current.getAttribute?.("data-1688-safe-container") === "true") break;
      current = current.parentElement;
    }
    return false;
  }

  function verifiedUploadInput() {
    const input = [...document.querySelectorAll("input[type='file']#img-search-upload, input[type='file'][accept*='image'], input[type='file'][data-1688-image-search]")]
      .find((node) => node.getClientRects().length > 0 && !unsafeNode(node));
    if (!input) throw new Error("未找到已识别的图片上传控件。");
    return input;
  }

  function verifiedSearchControl() {
    const input = [...document.querySelectorAll("input[type='search'][data-1688-keyword-search], input[type='search'][name='keywords'], input#alisearch-input[name='keywords']")]
      .find((node) => node.getClientRects().length > 0 && (node.id !== "alisearch-input" || node.type === "text") && !unsafeOwnNode(node));
    if (!input) throw new Error("未找到已识别的关键词输入框。");
    const form = input.closest("form");
    let button = form && [...form.querySelectorAll("button[type='submit'], [role='button'][data-1688-keyword-submit]")]
      .find((node) => node.getClientRects().length > 0 && !unsafeOwnNode(node));
    if (!button && form?.id === "alisearch-from") {
      button = [...form.querySelectorAll(".ali-search-box > .input-button")]
        .find((node) => node.getClientRects().length > 0 && clean(node.innerText).replace(/\s+/g, "") === "搜索" && !unsafeOwnNode(node));
    }
    if (!button) throw new Error("未找到已识别的搜索控件。");
    return { input, button };
  }

  function snapshot() {
    const nodes = visibleNodeSnapshot();
    const bodyText = clean(document.body?.innerText);
    const emptyMatch = bodyText.match(/(?:哎呦喂[^。！？\n]{0,40}空空如也|没有相关商品|未找到相关(?:商品|货源)|暂无相关(?:商品|货源))/i);
    if (emptyMatch) nodes.unshift({
      tag: "status",
      text: clean(emptyMatch[0]),
      href: "",
      imageUrl: "",
      ariaLabel: "",
      visible: true,
      data: { searchStatus: "empty" },
    });
    return { pageUrl: location.href, title: document.title, capturedAt: new Date().toISOString(), nodes, controls: visibleControlSnapshot() };
  }

  // Read-only adapter for the observed industry-pro product page. Scope every
  // field to the primary product modules; never infer a selected SKU or cost.
  function detailSnapshot() {
    const page = snapshot();
    if (!/^https:\/\/detail\.1688\.com\/offer\/\d+\.html(?:[?#]|$)/.test(location.href)) return page;
    const visible = node => Boolean(node?.getClientRects?.().length);
    const one = (parent, selector) => {
      const matches = [...parent.querySelectorAll(selector)].filter(visible);
      return matches.length === 1 ? matches[0] : null;
    };
    const value = node => clean(node?.innerText || node?.textContent).slice(0, 500);
    const add = (field, text, data = {}) => page.nodes.unshift({ visible:true, text, data:{...data, field} });
    const shop = one(document, '#shopNavigation .shop-company-name h1');
    if (shop) add('supplier', value(shop));
    const priceModule = one(document, '#mainPrice .module-od-main-price');
    let condition = '';
    if (priceModule) {
      const priceText = one(priceModule, '.price-component:not(.onhand-price)');
      condition = value(priceText);
      const moq = one(priceModule, '.price-component:not(.onhand-price) > p');
      const match = value(moq).match(/^(\d+)\s*(件|套|个|把)起批/);
      if (match && Number(match[1]) > 0) add('moq', match[0], {value:Number(match[1]), unit:match[2]});
    }
    const shipping = one(document, '#shippingServices .module-od-shipping-services');
    if (shipping) {
      const services = [...shipping.querySelectorAll('.service-item.split-border')].filter(visible).map(value);
      if (services.includes('包邮')) add('shipping', '包邮');
    }
    const skuModule = one(document, '#skuSelection');
    if (skuModule) {
      const rows = [...skuModule.querySelectorAll('.gyp-pro-table .ant-table-tbody > tr.ant-table-row[data-row-key]')].filter(visible);
      const countMatch = value(one(skuModule, '.industry-pro-sku-selection-count')).match(/^匹配到\s*(\d+)\s*个规格型号$/);
      const optionCount = countMatch ? Number(countMatch[1]) : null;
      const options = [];
      const quotes = [];
      const seen = new Set();
      let validRows = rows.length > 0 && rows.length <= 200;
      for (const row of rows.slice(0, 200)) {
        const id = clean(row.getAttribute('data-row-key'));
        const label = value(one(row, '.gyp-pro-table-title p'));
        const amount = value(one(row, '.gyp-pro-table-price > span:first-child')).match(/^[¥￥]\s*(\d+(?:\.\d{1,2})?)$/);
        if (!/^\d{1,30}$/.test(id) || !label || !amount || Number(amount[1]) <= 0 || seen.has(id)) { validRows = false; continue; }
        seen.add(id);
        options.push({id, label});
        quotes.push({id, label, displayedPrice:Number(amount[1])});
      }
      const activeFilters = [...skuModule.querySelectorAll('.sku-filter-button.active')].filter(visible).map(value);
      const allFilter = activeFilters.length > 0 && activeFilters.every(text => text === '全部');
      const complete = validRows && allFilter && optionCount > 0 && optionCount === rows.length && options.length === optionCount;
      add('sku', '规格表（只读，未确认选择）', { options, optionCount, optionsComplete:complete,
        singleSpec:false, selectedOptionId:null, selectionVerified:false });
      if (quotes.length) {
        add('priceTiers', '¥' + Math.min(...quotes.map(q => q.displayedPrice)), {source:'displayed'});
        add('detailEvidence', ('页面价格条件：' + (condition || '未明确，需复核') + '；只读规格展示价：' + JSON.stringify(quotes)).slice(0, 12000));
      }
    }
    return page;
  }

  async function submitImageSearch(payload = {}) {
    const imageBase64 = clean(payload.imageBase64);
    const mimeType = clean(payload.mimeType);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) || !/^image\/(?:jpeg|png|webp|gif)$/i.test(mimeType)) {
      throw new Error("图片搜索数据无效。");
    }
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (!bytes.byteLength || bytes.byteLength > 15 * 1024 * 1024) throw new Error("图片搜索数据无效。");
    const input = verifiedUploadInput();
    const initialUrl = location.href;
    const expectedPreview = `data:${mimeType};base64,${imageBase64}`;
    const previousPreview = [...document.querySelectorAll(".copy-image-container")]
      .some((node) => node.getClientRects().length > 0 && node.querySelector("img")?.src === expectedPreview);
    const uploadDiagnostics = {
      stage: "assigning_file", mimeType, byteLength: bytes.byteLength,
      selectedFileCount: 0, changeDispatched: false, previewConfirmed: false, searchSubmitted: false,
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "ozon-image", { type: mimeType }));
    input.files = transfer.files;
    uploadDiagnostics.selectedFileCount = input.files?.length || 0;
    if (uploadDiagnostics.selectedFileCount !== 1) {
      const error = new Error("图片文件未稳定写入上传控件。");
      error.uploadDiagnostics = uploadDiagnostics;
      throw error;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    uploadDiagnostics.changeDispatched = true;
    uploadDiagnostics.stage = "awaiting_preview";
    // The current 1688 uploader first prepares IDs and a matching preview.
    // A file change alone does not submit the search. Never click an old
    // preview for the same image until the new upload has shown a transition.
    let sawTransition = !previousPreview, previousButton = null;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (location.href !== initialUrl) {
        const next = new URL(location.href), before = new URL(initialUrl);
        const imageId = next.searchParams.get("imageId") || "";
        if (next.protocol === "https:" && next.hostname === "air.1688.com"
          && next.pathname === "/kapp/1688-search/pc-image-search/"
          && /^\d{1,100}$/.test(imageId) && imageId !== before.searchParams.get("imageId")) {
          uploadDiagnostics.stage = "page_transition";
          return { accepted: true, uploadDiagnostics };
        }
        uploadDiagnostics.stage = "unexpected_page_transition";
        const error = new Error("上传期间页面发生未绑定本次图片的跳转。");
        error.uploadDiagnostics = uploadDiagnostics;
        throw error;
      }
      const previews = [...document.querySelectorAll(".copy-image-container")]
        .filter((node) => node.getClientRects().length > 0);
      const uploading = document.querySelectorAll(".image-upload-button-loading").length > 0
        || previews.some((node) => /上传中/.test(clean(node.innerText)));
      if (!previews.some((node) => node.querySelector("img")?.src === expectedPreview) || uploading) sawTransition = true;
      const matches = previews.filter((node) => node.querySelector("img")?.src === expectedPreview && !unsafeOwnNode(node))
        .flatMap((node) => [...node.querySelectorAll(".search-btn")])
        .filter((node) => node?.getClientRects().length > 0);
      const button = !uploading && matches.length === 1 && sawTransition
        && clean(matches[0].innerText) === "搜索图片" && !unsafeOwnNode(matches[0]) ? matches[0] : null;
      if (button && button === previousButton) {
        uploadDiagnostics.previewConfirmed = true;
        uploadDiagnostics.stage = "submitting_preview";
        button.click();
        uploadDiagnostics.searchSubmitted = true;
        uploadDiagnostics.stage = "preview_submitted";
        return { accepted: true, uploadDiagnostics };
      }
      previousButton = button;
      await sleep(50);
    }
    const error = new Error("图片已选入，但未出现与本次主图匹配的可提交搜索预览。");
    error.uploadDiagnostics = uploadDiagnostics;
    throw error;
  }

  function submitKeywordSearch(payload = {}) {
    const query = clean(payload.query);
    if (!query || UNSAFE_SEMANTICS.test(query)) throw new Error("关键词不允许包含交易语义。");
    const { input, button } = verifiedSearchControl();
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    button.click();
    return { accepted: true };
  }

  function readSkuOptions() {
    const options = [...document.querySelectorAll("[data-sku-option-id], [data-option-id]")]
      .filter((node) => node.getClientRects().length > 0 && !unsafeNode(node))
      .slice(0, 200)
      .map((node) => ({ id: clean(node.getAttribute("data-sku-option-id") || node.getAttribute("data-option-id")), label: clean(node.innerText || node.getAttribute("aria-label")) }))
      .filter((option) => option.id || option.label);
    return { options };
  }

  function selectedOption(node) {
    const className = typeof node.className === "string" ? node.className : "";
    return node.getAttribute("aria-selected") === "true"
      || node.getAttribute("aria-checked") === "true"
      || /(?:^|\s)(?:selected|is-selected|active)(?:\s|$)/i.test(className)
      || /已选/.test(clean(node.innerText));
  }

  function normalPrice() {
    const node = document.querySelector("[data-sku-price], [data-normal-price]");
    const text = clean(node?.getAttribute("data-sku-price") || node?.getAttribute("data-normal-price") || node?.innerText);
    const number = Number((text.match(/[¥￥]?\s*(\d+(?:\.\d+)?)/) || [])[1]);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  async function selectSkuOption(payload = {}) {
    const optionId = clean(payload.optionId);
    const optionLabel = clean(payload.optionLabel);
    const expectedPrice = Number(payload.expectedPrice);
    if (!optionId && !optionLabel) throw new Error("缺少精确 SKU 选项。");
    const matches = [...document.querySelectorAll("[data-sku-option-id], [data-option-id]")]
      .filter((node) => node.getClientRects().length > 0 && !unsafeNode(node))
      .filter((node) => {
        const id = clean(node.getAttribute("data-sku-option-id") || node.getAttribute("data-option-id"));
        const label = clean(node.innerText || node.getAttribute("aria-label"));
        return (!optionId || id === optionId) && (!optionLabel || label === optionLabel);
      });
    if (matches.length !== 1) throw new Error("未找到唯一且精确的 SKU 选项。");
    const option = matches[0];
    option.click();
    if (!selectedOption(option)) await sleep(180);
    if (!selectedOption(option)) throw new Error("SKU 选项未稳定选中。");
    const firstPrice = normalPrice();
    await sleep(180);
    if (!selectedOption(option)) throw new Error("SKU 选项未稳定选中。");
    const secondPrice = normalPrice();
    if (!selectedOption(option) || firstPrice === null || firstPrice !== secondPrice || (Number.isFinite(expectedPrice) && firstPrice !== expectedPrice)) {
      throw new Error("SKU 选择状态或正常价格未通过确认。");
    }
    return { optionId, optionLabel, selected: true, price: firstPrice };
  }

  async function handleCommand(message) {
    const command = clean(message?.command);
    if (!ALLOWED_COMMANDS.has(command)) throw new Error("不允许的 1688 页面命令。");
    if (command === "read_product_detail") return detailSnapshot();
    if (command === "probe" || command === "read_search_results") return snapshot();
    if (command === "submit_image_search") return submitImageSearch(message.payload);
    if (command === "submit_keyword_search") return submitKeywordSearch(message.payload);
    if (command === "read_sku_options") return readSkuOptions();
    return selectSkuOption(message.payload);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "OZON_1688_PAGE_COMMAND_V1") return false;
    handleCommand(message).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message || String(error), ...(error.uploadDiagnostics ? { uploadDiagnostics: error.uploadDiagnostics } : {}) }));
    return true;
  });

  root.Ozon1688Content = Object.freeze({ ALLOWED_COMMANDS, visibleNodeSnapshot });
})(globalThis);
