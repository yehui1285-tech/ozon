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
    if (command === "probe" || command === "read_search_results" || command === "read_product_detail") return snapshot();
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
