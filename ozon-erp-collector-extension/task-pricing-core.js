(function initOzonTaskPricingCore(root, factory) {
  root.OzonTaskPricingCore = factory();
})(globalThis, function createOzonTaskPricingCore() {
  "use strict";

  const routes = [
    {"name":"CEL Economy Extra Small","minValue":0,"maxValue":1500,"minWeightExclusive":0,"maxWeight":0.5,"maxSum":90,"maxSide":60,"usesVolume":false,"rate":28.1,"fixed":3.4},
    {"name":"CEL Economy Budget","minValue":0,"maxValue":1500,"minWeightExclusive":0.5,"maxWeight":25,"maxSum":150,"maxSide":60,"usesVolume":false,"rate":19.1,"fixed":25.9},
    {"name":"CEL Economy Small","minValue":1500,"maxValue":7000,"minWeightExclusive":0,"maxWeight":2,"maxSum":150,"maxSide":60,"usesVolume":false,"rate":28.1,"fixed":18.8},
    {"name":"CEL Economy Premium Small","minValue":7000,"maxValue":250000,"minWeightExclusive":0,"maxWeight":5,"maxSum":250,"maxSide":150,"usesVolume":false,"rate":28.1,"fixed":24.8},
    {"name":"CEL Economy Big","minValue":1500,"maxValue":7000,"minWeightExclusive":2,"maxWeight":30,"maxBillable":31,"maxSum":250,"maxSide":150,"usesVolume":true,"rate":19.1,"fixed":40.5},
    {"name":"CEL Economy Premium Big","minValue":7000,"maxValue":250000,"minWeightExclusive":5,"maxWeight":25,"maxBillable":80,"maxSum":310,"maxSide":150,"usesVolume":true,"rate":25.8,"fixed":69.7}
  ];

  function number(value) {
    let text = String(value ?? "").replace(/[¥￥₽%]/g, "").replace(/[\u00a0\u202f]/g, " ").trim();
    const match = text.match(/-?[\d\s.,]+/);
    if (!match) return 0;
    text = match[0].replace(/\s+/g, "");
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : ".";
      text = text.replace(new RegExp(`\\${decimal === "," ? "." : ","}`, "g"), "").replace(decimal, ".");
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
    else if (comma >= 0) text = text.replace(",", ".");
    const result = Number(text);
    return Number.isFinite(result) ? result : 0;
  }

  function round2(value) {
    return Number(Number(value).toFixed(2));
  }

  function floor2(value) {
    return Math.floor((Number(value) + 1e-9) * 100) / 100;
  }

  function chooseSource(pagePrice, competitorPrice, tolerance = 0.01) {
    const page = number(pagePrice);
    const competitor = number(competitorPrice);
    if (competitor > 0 && (page <= 0 || competitor < page - tolerance)) return "competitor";
    if (page > 0) return "page";
    if (competitor > 0) return "competitor";
    return "none";
  }

  function selectedCommission(greenPrice, commissions) {
    const values = (Array.isArray(commissions) ? commissions : []).map(number).filter((value) => value > 0);
    if (!(number(greenPrice) > 0)) return 0;
    return number(greenPrice) <= 600 ? values[1] || 0 : values[2] || 0;
  }

  function saleValue(greenPrice) {
    const price = number(greenPrice);
    if (price < 135) return 200;
    if (price <= 600) return 2000;
    return 20000;
  }

  function calculateFreight({ greenPrice, weightKg, lengthCm, widthCm, heightCm }) {
    const sale = saleValue(greenPrice);
    const weight = number(weightKg);
    const dimensions = [number(lengthCm), number(widthCm), number(heightCm)];
    if (!(number(greenPrice) > 0) || !(weight > 0) || dimensions.some((value) => !(value > 0))) {
      return { price: 0, route: "", sale, billableWeight: 0 };
    }
    const sides = [...dimensions].sort((a, b) => b - a);
    const sum = dimensions.reduce((total, value) => total + value, 0);
    const volume = dimensions.reduce((total, value) => total * value, 1) / 12000;
    const available = routes.map((route) => {
      const billableWeight = route.usesVolume ? Math.max(weight, volume) : weight;
      const limits = route.maxBox ? [...route.maxBox].sort((a, b) => b - a) : null;
      const ok = sale > route.minValue
        && sale <= route.maxValue
        && weight > route.minWeightExclusive
        && weight <= route.maxWeight
        && (!route.maxBillable || billableWeight <= route.maxBillable)
        && sum <= route.maxSum
        && sides[0] <= route.maxSide
        && (!limits || sides.every((side, index) => side <= limits[index]));
      return ok ? { price: round2(billableWeight * route.rate + route.fixed), route: route.name, sale, billableWeight } : null;
    }).filter(Boolean).sort((a, b) => a.price - b.price);
    return available[0] || { price: 0, route: "", sale, billableWeight: 0 };
  }

  function calculateMaxPurchaseCost({ greenPrice, blackPrice, commission, freight, targetMargin = 0.18 }) {
    const green = number(greenPrice);
    const black = number(blackPrice);
    const commissionRate = number(commission) / 100;
    const freightCost = number(freight);
    const margin = number(targetMargin);
    if (!(green > 0) || !(black > 0) || !(commissionRate > 0) || !(freightCost > 0) || !(margin >= 0)) return null;
    const trueSale = (black - green) * 2.2 + black;
    const pricingFactor = 0.97;
    const quote = trueSale * pricingFactor;
    const autoFee = quote * 0.04;
    const labelFee = 3;
    const platformFee = quote * commissionRate;
    const netBeforePurchaseAndFreight = quote - labelFee - platformFee - autoFee;
    const rawMaxPurchaseCost = netBeforePurchaseAndFreight / (1 + margin) - freightCost;
    return {
      trueSale: round2(trueSale),
      pricingFactor,
      quote: round2(quote),
      autoFee: round2(autoFee),
      labelFee,
      platformFee: round2(platformFee),
      targetMargin: margin,
      maxPurchaseCost: Math.max(0, floor2(rawMaxPurchaseCost)),
    };
  }

  function buildTaskPricing(task, snapshot, originalBlackPrice, blackPriceSourceUrl) {
    const pagePrice = number(snapshot?.pageGreenPrice);
    const competitorPrice = number(snapshot?.minCompetitorPrice);
    const source = snapshot?.source || chooseSource(pagePrice, competitorPrice);
    const effectiveGreenPrice = source === "competitor" ? competitorPrice : source === "page" ? pagePrice : 0;
    const commissionOptions = (snapshot?.product?.commissionOptions || []).map(number);
    const commission = selectedCommission(effectiveGreenPrice, commissionOptions);
    const [lengthCm, widthCm, heightCm] = [snapshot?.product?.lengthCm, snapshot?.product?.widthCm, snapshot?.product?.heightCm].map(number);
    const weightKg = number(snapshot?.product?.weightKg);
    const freight = calculateFreight({ greenPrice: effectiveGreenPrice, weightKg, lengthCm, widthCm, heightCm });
    const missing = [];
    if (snapshot?.product?.selectionQualified !== true) missing.push("产品不合要求");
    if (!(pagePrice > 0)) missing.push("当前页面绿标价");
    if (snapshot?.product?.erpLoaded !== true || snapshot?.product?.competitorPriceResolved !== true) missing.push("当前毛子ERP数据");
    if (source === "none" || !(effectiveGreenPrice > 0)) missing.push("有效绿标价");
    if (!(number(originalBlackPrice) > 0)) missing.push("同源原始黑标价");
    else if (number(originalBlackPrice) < effectiveGreenPrice - 0.01) missing.push("黑标价低于同源绿标价");
    if (!(commission > 0)) missing.push("佣金档位");
    if (!(lengthCm > 0 && widthCm > 0 && heightCm > 0 && weightKg > 0)) missing.push("尺寸重量");
    if (!(freight.price > 0)) missing.push("国际运费");
    if (missing.length) throw new Error(`核价字段不完整：${missing.join("、")}`);
    const calculation = calculateMaxPurchaseCost({
      greenPrice: effectiveGreenPrice,
      blackPrice: originalBlackPrice,
      commission,
      freight: freight.price,
      targetMargin: 0.18,
    });
    if (!calculation) throw new Error("无法计算18%利润率最高采购成本");
    return {
      pagePrice: round2(pagePrice),
      competitorPrice: competitorPrice > 0 ? round2(competitorPrice) : null,
      effectiveGreenPrice: round2(effectiveGreenPrice),
      commissions: commissionOptions,
      selectedCommission: round2(commission),
      lengthMm: round2(lengthCm * 10),
      widthMm: round2(widthCm * 10),
      heightMm: round2(heightCm * 10),
      weightG: round2(weightKg * 1000),
      originalBlackPrice: round2(originalBlackPrice),
      blackPriceSource: source,
      blackPriceSourceUrl: String(blackPriceSourceUrl || snapshot?.sourceUrl || task?.ozon?.productUrl || ""),
      internationalFreight: freight.price,
      freightRoute: freight.route,
      maxPurchaseCostAt18Pct: calculation.maxPurchaseCost,
      calculation,
    };
  }

  return {
    buildTaskPricing,
    calculateFreight,
    calculateMaxPurchaseCost,
    chooseSource,
    number,
    selectedCommission,
  };
});
