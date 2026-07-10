const OzonPricingCore = (() => {
  function number(value) {
    let text = String(value ?? "")
      .replace(/[¥￥₽%]/g, "")
      .replace(/[\u00a0\u202f]/g, " ")
      .trim();
    const match = text.match(/-?[\d\s.,]+/);
    if (!match) return 0;
    text = match[0].replace(/\s+/g, "");
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalMark = lastComma > lastDot ? "," : ".";
      text = text
        .replace(new RegExp(`\\${decimalMark === "," ? "." : ","}`, "g"), "")
        .replace(decimalMark, ".");
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(text)) {
      text = text.replace(/,/g, "");
    } else if (lastComma >= 0) {
      text = text.replace(",", ".");
    }
    const result = Number(text);
    return Number.isFinite(result) ? result : 0;
  }

  function missingRequiredFields(row, requiredKeys) {
    return requiredKeys.filter((key) => String(row[key] ?? "").trim() === "");
  }

  function isCompleteRow(row, requiredKeys) {
    return missingRequiredFields(row, requiredKeys).length === 0;
  }

  function calc(row) {
    const green = number(row.green);
    const black = number(row.black);
    const rate = number(row.commission) / 100;
    const cost = number(row.cost);
    const freight = number(row.freight);
    const trueSale = (black - green) * 2.2 + black;
    const manualFactor = String(row.factorOverride ?? "").trim() === "" ? null : number(row.factorOverride);
    const pricingFactor = manualFactor && manualFactor > 0 ? manualFactor : 0.97;
    const autoQuote = trueSale * pricingFactor;
    const manualQuote = String(row.quoteOverride ?? "").trim() === "" ? null : number(row.quoteOverride);
    const quote = manualQuote && manualQuote > 0 ? manualQuote : autoQuote;
    const autoFee = quote * 0.04;
    const labelFee = 3;
    const platform = quote * rate;
    const profit = quote - cost - freight - labelFee - platform - autoFee;
    const margin = cost + freight > 0 ? profit / (cost + freight) : null;
    return { trueSale, pricingFactor, autoQuote, quote, autoFee, labelFee, platform, profit, margin };
  }

  return { number, missingRequiredFields, isCompleteRow, calc };
})();
