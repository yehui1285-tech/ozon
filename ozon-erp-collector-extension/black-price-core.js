(function initOzonBlackPriceCore(root, factory) {
  root.OzonBlackPriceCore = factory();
})(globalThis, function createOzonBlackPriceCore() {
  "use strict";

  function number(value) {
    let text = String(value || "")
      .replace(/[¥￥₽%]/g, "")
      .replace(/[\u00a0\u202f]/g, " ")
      .trim();
    const match = text.match(/-?[\d\s.,]+/);
    if (!match) return 0;
    text = match[0].replace(/\s+/g, "");
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : ".";
      text = text.replace(new RegExp(`\\${decimal === "," ? "." : ","}`, "g"), "").replace(decimal, ".");
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(text)) {
      text = text.replace(/,/g, "");
    } else if (comma >= 0) {
      text = text.replace(",", ".");
    }
    const result = Number(text);
    return Number.isFinite(result) ? result : 0;
  }

  function chooseSource(pageGreenPrice, minCompetitorPrice, tolerance = 0.01) {
    const page = number(pageGreenPrice);
    const competitor = number(minCompetitorPrice);
    if (competitor > 0 && (page <= 0 || competitor < page - tolerance)) return "competitor";
    if (page > 0) return "page";
    if (competitor > 0) return "competitor";
    return "none";
  }

  function normalizeProductUrl(value) {
    try {
      const url = new URL(String(value || ""), "https://www.ozon.ru/");
      if (url.protocol !== "https:" || url.hostname !== "www.ozon.ru" || !/^\/product\//i.test(url.pathname)) return "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function chooseCompetitorRow(rows, targetPrice) {
    const target = number(targetPrice);
    const valid = (Array.isArray(rows) ? rows : [])
      .map((row, index) => ({
        index,
        url: normalizeProductUrl(row?.url),
        price: number(row?.price),
      }))
      .filter((row) => row.url && row.price > 0);
    if (!valid.length) return null;
    const matching = target > 0 ? valid.filter((row) => Math.abs(row.price - target) <= 0.05) : valid;
    if (!matching.length) return null;
    matching.sort((a, b) => {
      if (target > 0) {
        const distance = Math.abs(a.price - target) - Math.abs(b.price - target);
        if (Math.abs(distance) > 0.0001) return distance;
      }
      return a.price - b.price || a.index - b.index;
    });
    return matching[0];
  }

  function competitorTriggerScore(candidate) {
    const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
    if (!/(?:等|共)\s*\d+\s*个卖家/.test(text)) return Number.POSITIVE_INFINITY;
    const cursor = String(candidate?.cursor || "").toLowerCase();
    const decoration = String(candidate?.textDecorationLine || "").toLowerCase();
    const isPointer = cursor === "pointer";
    const isUnderlined = decoration.includes("underline");
    if (!isPointer && !isUnderlined) return Number.POSITIVE_INFINITY;
    return text.length - (isPointer ? 200 : 0) - (isUnderlined ? 100 : 0);
  }

  return {
    chooseCompetitorRow,
    chooseSource,
    competitorTriggerScore,
    normalizeProductUrl,
    number,
  };
});
