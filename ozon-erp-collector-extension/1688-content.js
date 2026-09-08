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
    return [...rootNode.querySelectorAll("a,img,button,[role='button'],[aria-selected],[aria-checked],[data-offer-id]")]
      .filter((node) => node.getClientRects().length > 0)
      .slice(0, 2000)
      .map((node) => ({
        text: String(node.innerText || node.alt || "").replace(/\s+/g, " ").trim().slice(0, 500),
        href: node.href || "",
        imageUrl: node.currentSrc || node.src || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        data: { offerId: node.getAttribute("data-offer-id") || "" },
        visible: true,
      }));
  }

  function unsafeNode(node) {
    let current = node;
    while (current) {
      const fields = ["id", "name", "title", "value", "placeholder", "href", "aria-label", "action"];
      if (UNSAFE_SEMANTICS.test(`${current.innerText || ""} ${fields.map((field) => current.getAttribute?.(field) || "").join(" ")}`)) return true;
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
    const input = [...document.querySelectorAll("input[type='search'][data-1688-keyword-search], input[type='search'][name='keywords']")]
      .find((node) => node.getClientRects().length > 0 && !unsafeNode(node));
    if (!input) throw new Error("未找到已识别的关键词输入框。");
    const form = input.closest("form");
    const button = form && [...form.querySelectorAll("button[type='submit'], [role='button'][data-1688-keyword-submit]")]
      .find((node) => node.getClientRects().length > 0 && !unsafeNode(node));
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
    return { pageUrl: location.href, title: document.title, capturedAt: new Date().toISOString(), nodes };
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
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "ozon-image", { type: mimeType }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { accepted: true };
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
    handleCommand(message).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });

  root.Ozon1688Content = Object.freeze({ ALLOWED_COMMANDS, visibleNodeSnapshot });
})(globalThis);
