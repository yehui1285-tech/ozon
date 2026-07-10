const routes = [
  {"name":"CEL Economy Extra Small","cn":"经济超级轻小件","delivery":"21-26 天","feeText":"26元/kg + 3.12元/票","weightText":"0-0.5KG","valueText":"0-1500卢布","minValue":0,"maxValue":1500,"minWeightExclusive":0,"maxWeight":0.5,"maxSum":90,"maxSide":60,"usesVolume":false,"rate":26,"fixed":3.12},
  {"name":"CEL Economy Budget","cn":"经济低客单价轻小件","delivery":"16-21 天","feeText":"17.68元/kg + 23.92元/票","weightText":"0.5-25KG","valueText":"0-1500卢布","minValue":0,"maxValue":1500,"minWeightExclusive":0.5,"maxWeight":25,"maxSum":150,"maxSide":60,"usesVolume":false,"rate":17.68,"fixed":23.92},
  {"name":"CEL Economy Small","cn":"经济轻小件","delivery":"16-21 天","feeText":"26元/kg + 16.64元/票","weightText":"0-2KG","valueText":"1501-7000卢布","minValue":1500,"maxValue":7000,"minWeightExclusive":0,"maxWeight":2,"maxSum":150,"maxSide":60,"usesVolume":false,"rate":26,"fixed":16.64},
  {"name":"CEL Economy Premium Small","cn":"经济高客单轻小件","delivery":"16-21 天","feeText":"26元/kg + 22.88元/票","weightText":"0-5KG","valueText":"7001-250000卢布","minValue":7000,"maxValue":250000,"minWeightExclusive":0,"maxWeight":5,"maxSum":250,"maxSide":150,"usesVolume":false,"rate":26,"fixed":22.88},
  {"name":"CEL Economy Big","cn":"经济大件","delivery":"21-26 天","feeText":"17.68元/kg + 37.44元/票","weightText":"2.001-30KG","valueText":"1501-7000卢布","minValue":1500,"maxValue":7000,"minWeightExclusive":2,"maxWeight":30,"maxBillable":31,"maxSum":250,"maxSide":150,"usesVolume":true,"rate":17.68,"fixed":37.44},
  {"name":"CEL Economy Premium Big","cn":"经济高客单大件","delivery":"21-26 天","feeText":"23.92元/kg + 64.48元/票","weightText":"5.001-25KG","valueText":"7001-250000卢布","minValue":7000,"maxValue":250000,"minWeightExclusive":5,"maxWeight":25,"maxBillable":80,"maxSum":310,"maxSide":150,"usesVolume":true,"rate":23.92,"fixed":64.48}
];

    const $ = (id) => document.getElementById(id);
    const FEISHU_DETAIL_TABLE_URL = "https://www.feishu.cn/base/MnB1bj0OqaRYDAsHOQ5cW0SZnDe?table=tblrQj7Ux7DH6poQ";
    const PRICING_DRAFT_KEY = "ozon_pricing_draft_v1";
    const PRICING_DRAFT_VERSION = 1;
    const APP_VERSION = "2026.07.10-p0p2";
    const MAX_DRAFT_ROWS = 1000;
    const MAX_DRAFT_CHARS = 4_000_000;
    const PRICING_ROW_KEYS = ["green", "black", "commission", "factorOverride", "quoteOverride", "cost", "freight", "sku", "link", "source", "note"];
    const REQUIRED_PRICING_KEYS = ["green", "black", "commission", "cost", "freight"];
    const REQUIRED_PRICING_LABELS = { green: "绿标价格", black: "黑标价格", commission: "佣金", cost: "采购成本", freight: "国际运费" };
    let rows = Array.from({ length: 1 }, (_, index) => emptyRow(index + 1));
    let bestFreight = null;
    const yellowNavKeys = ["green", "black", "commission", "cost", "freight"];
    let pendingYellowFocus = null;
    let pricingDraftSaveTimer = null;

    function emptyRow(index) {
      return {
        id: window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        index,
        green: "",
        black: "",
        commission: "",
        factorOverride: "",
        quoteOverride: "",
        cost: "",
        freight: "",
        sku: "",
        link: "",
        source: "",
        note: ""
      };
    }

    function savePricingDraft() {
      if (pricingDraftSaveTimer) {
        clearTimeout(pricingDraftSaveTimer);
        pricingDraftSaveTimer = null;
      }
      try {
        if (rows.length > MAX_DRAFT_ROWS) throw new Error(`核价记录超过 ${MAX_DRAFT_ROWS} 行，请先导出 CSV 并清理旧记录。`);
        const serialized = JSON.stringify({
          version: PRICING_DRAFT_VERSION,
          savedAt: new Date().toISOString(),
          rows: rows.map((row, index) => {
            const saved = { id: row.id, index: index + 1 };
            PRICING_ROW_KEYS.forEach((key) => {
              saved[key] = String(row[key] ?? "");
            });
            return saved;
          }),
        });
        if (serialized.length > MAX_DRAFT_CHARS) throw new Error("自动保存内容过大，请立即导出 CSV 并清理旧记录。");
        localStorage.setItem(PRICING_DRAFT_KEY, serialized);
      } catch (error) {
        console.warn("核价明细自动保存失败：", error);
        if ($("syncStatus")) {
          $("syncStatus").textContent = `自动保存失败：${error.message || error}`;
          $("syncStatus").className = "sync-status bad";
        }
      }
    }

    function schedulePricingDraftSave() {
      if (pricingDraftSaveTimer) clearTimeout(pricingDraftSaveTimer);
      pricingDraftSaveTimer = setTimeout(savePricingDraft, 200);
    }

    function restorePricingDraft() {
      try {
        const payload = JSON.parse(localStorage.getItem(PRICING_DRAFT_KEY) || "null");
        if (!payload || payload.version !== PRICING_DRAFT_VERSION || !Array.isArray(payload.rows) || !payload.rows.length) {
          return null;
        }
        const usedIds = new Set();
        const restoredRows = payload.rows.slice(0, 1000).map((savedRow, index) => {
          const row = emptyRow(index + 1);
          const savedId = String(savedRow?.id || "");
          if (savedId && !usedIds.has(savedId)) row.id = savedId;
          usedIds.add(row.id);
          PRICING_ROW_KEYS.forEach((key) => {
            row[key] = String(savedRow?.[key] ?? "");
          });
          return row;
        });
        rows = restoredRows.length ? restoredRows : [emptyRow(1)];
        if (rows.length === 1 && isBlankOrLegacyDefaultRow(rows[0])) rows[0].freight = "";
        const contentRows = rows.filter((row) => PRICING_ROW_KEYS.some((key) => String(row[key]).trim() !== "")).length;
        return { savedAt: payload.savedAt, contentRows };
      } catch (error) {
        console.warn("核价明细自动恢复失败：", error);
        return null;
      }
    }

    function formatDraftSavedAt(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
    }

    const { number, calc } = OzonPricingCore;

    function hasRequired(row) {
      return REQUIRED_PRICING_KEYS.some((key) => String(row[key]).trim() !== "");
    }

    function missingRequiredFields(row) {
      return OzonPricingCore.missingRequiredFields(row, REQUIRED_PRICING_KEYS);
    }

    function isCompleteRow(row) {
      return OzonPricingCore.isCompleteRow(row, REQUIRED_PRICING_KEYS);
    }

    function isBlankOrLegacyDefaultRow(row) {
      const meaningfulKeys = PRICING_ROW_KEYS.filter((key) => key !== "freight");
      if (meaningfulKeys.some((key) => String(row[key]).trim() !== "")) return false;
      const freight = String(row.freight ?? "").trim();
      return freight === "" || Math.abs(number(freight) - 37.44) < 0.005;
    }

    function hasPricingInput(row) {
      return ["green", "black", "commission", "factorOverride", "quoteOverride", "cost", "freight"]
        .some((key) => String(row[key]).trim() !== "");
    }

    function money(value) {
      if (!Number.isFinite(value)) return "-";
      return `¥${value.toFixed(2)}`;
    }

    function pct(value) {
      if (!Number.isFinite(value)) return "-";
      return `${(value * 100).toFixed(1)}%`;
    }

    function displayValue(row, key) {
      if (key === "commission" && String(row[key]).trim() !== "") {
        return `${number(row[key])}%`;
      }
      return row[key] ?? "";
    }

    function inputCell(row, key, type = "number", cls = "manual") {
      const value = row[key] ?? "";
      if (key === "link") {
        return `<td class="${cls}">
          <div class="copy-cell">
            <textarea data-id="${row.id}" data-key="${key}" placeholder="粘贴页面地址">${escapeHtml(value)}</textarea>
            <button type="button" class="copy-btn" data-copy-id="${row.id}">复制</button>
            <button type="button" class="copy-btn" data-open-id="${row.id}">浏览</button>
          </div>
        </td>`;
      }
      if (type === "textarea") {
        return `<td class="${cls}"><textarea data-id="${row.id}" data-key="${key}">${escapeHtml(value)}</textarea></td>`;
      }
      const yellowNav = cls.includes("manual compact") && yellowNavKeys.includes(key);
      const inputType = key === "commission" || yellowNav ? "text" : type;
      const yellowNavAttr = yellowNav ? 'data-yellow-nav="true" inputmode="decimal"' : "";
      return `<td class="${cls}"><input class="${type === "number" ? "money" : ""}" data-id="${row.id}" data-key="${key}" ${yellowNavAttr} type="${inputType}" value="${escapeAttr(displayValue(row, key))}"></td>`;
    }

    function renderRows() {
      $("rows").innerHTML = rows.map((row, i) => {
        row.index = i + 1;
        const c = calc(row);
        const showCalculated = hasPricingInput(row);
        const marginClass = !showCalculated ? "" : c.margin === null ? "warn" : c.margin >= 0.18 ? "good" : "bad";
        const profitClass = !showCalculated ? "" : c.profit >= 0 ? "good" : "bad";
        return `
          <tr>
            <td class="index">${row.index}</td>
            <td class="fixed"><button type="button" class="delete-row-btn" data-delete-id="${row.id}">删除</button></td>
            ${inputCell(row, "green", "number", "manual compact")}
            ${inputCell(row, "black", "number", "manual compact")}
            ${inputCell(row, "commission", "number", "manual compact")}
            <td class="calc money">${showCalculated ? money(c.trueSale) : ""}</td>
            <td class="calc money">${showCalculated ? money(c.autoFee) : ""}</td>
            <td class="calc money price-cell">${showCalculated ? money(c.quote) : ""}</td>
            ${inputCell(row, "quoteOverride", "number", "soft-manual compact")}
            <td class="calc percent">${showCalculated ? c.pricingFactor.toFixed(2) : ""}</td>
            ${inputCell(row, "factorOverride", "number", "soft-manual")}
            ${inputCell(row, "cost", "number", "manual compact")}
            ${inputCell(row, "freight", "number", "manual compact")}
            <td class="fixed money">${showCalculated ? money(c.labelFee) : ""}</td>
            <td class="calc money">${showCalculated ? money(c.platform) : ""}</td>
            <td class="calc money ${profitClass}">${showCalculated ? money(c.profit) : ""}</td>
            <td class="calc percent ${marginClass}">${showCalculated ? pct(c.margin) : ""}</td>
            ${inputCell(row, "sku", "text", "optional")}
            ${inputCell(row, "link", "textarea", "optional link")}
            ${inputCell(row, "source", "text", "optional")}
            ${inputCell(row, "note", "textarea", "optional wide")}
          </tr>
        `;
      }).join("");
      bindRowInputs();
      renderActiveRowOptions();
      renderSummary();
      restorePendingYellowFocus();
      schedulePricingDraftSave();
    }

    function bindRowInputs() {
      document.querySelectorAll("[data-id][data-key]").forEach((el) => {
        el.addEventListener("input", () => {
          const row = rows.find((item) => item.id === el.dataset.id);
          if (!row) return;
          row[el.dataset.key] = el.dataset.key === "commission" ? String(number(el.value) || "") : el.value;
          renderSummary();
          schedulePricingDraftSave();
        });
        el.addEventListener("change", () => {
          const row = rows.find((item) => item.id === el.dataset.id);
          if (!row) return;
          row[el.dataset.key] = el.dataset.key === "commission" ? String(number(el.value) || "") : el.value;
          const shouldRestoreFocus = Boolean(pendingYellowFocus);
          renderRows();
          if (row.id === $("activeRow").value && ["green", "black", "factorOverride", "quoteOverride"].includes(el.dataset.key)) {
            syncSaleRubFromActiveRow(!shouldRestoreFocus);
          }
        });
      });
      document.querySelectorAll("[data-copy-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          const row = rows.find((item) => item.id === button.dataset.copyId);
          const text = row?.link?.trim() || "";
          if (!text) return;
          const ok = await copyText(text);
          button.textContent = ok ? "已复制" : "失败";
          button.classList.toggle("copied", ok);
          setTimeout(() => {
            button.textContent = "复制";
            button.classList.remove("copied");
          }, 1200);
        });
      });
      document.querySelectorAll("[data-open-id]").forEach((button) => {
        button.addEventListener("click", () => {
          const row = rows.find((item) => item.id === button.dataset.openId);
          const ok = openRowLink(row?.link);
          if (!ok) {
            button.textContent = "无效";
            setTimeout(() => {
              button.textContent = "浏览";
            }, 1200);
          }
        });
      });
      document.querySelectorAll("[data-delete-id]").forEach((button) => {
        button.addEventListener("click", () => {
          rows = rows.filter((item) => item.id !== button.dataset.deleteId);
          if (!rows.length) rows.push(emptyRow(1));
          renderRows();
        });
      });
    }

    function moveYellowCellFocus(current, direction) {
      const index = yellowNavKeys.indexOf(current.dataset.key);
      if (index === -1) return;
      const nextKey = yellowNavKeys[index + direction];
      if (!nextKey) return;
      const next = document.querySelector(`[data-id="${current.dataset.id}"][data-key="${nextKey}"]`);
      if (!next) return;
      next.focus();
      if (typeof next.select === "function") next.select();
    }

    function moveYellowRowFocus(current, direction) {
      const rowIndex = rows.findIndex((row) => row.id === current.dataset.id);
      const targetRow = rows[rowIndex + direction];
      if (!targetRow) return;
      const next = document.querySelector(`[data-id="${targetRow.id}"][data-key="${current.dataset.key}"]`);
      if (!next) return;
      next.focus();
      if (typeof next.select === "function") next.select();
    }

    function getYellowNavTarget(current, direction) {
      if (direction.left || direction.right) {
        const index = yellowNavKeys.indexOf(current.dataset.key);
        if (index === -1) return null;
        const key = yellowNavKeys[index + (direction.right ? 1 : -1)];
        return key ? { id: current.dataset.id, key } : null;
      }
      const rowIndex = rows.findIndex((row) => row.id === current.dataset.id);
      const row = rows[rowIndex + (direction.down ? 1 : -1)];
      return row ? { id: row.id, key: current.dataset.key } : null;
    }

    function restorePendingYellowFocus() {
      if (!pendingYellowFocus) return;
      const target = document.querySelector(`[data-id="${pendingYellowFocus.id}"][data-key="${pendingYellowFocus.key}"]`);
      pendingYellowFocus = null;
      if (!target) return;
      target.focus();
      if (typeof target.select === "function") target.select();
    }

    function handleYellowNavKey(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.yellowNav) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const next = getYellowNavTarget(target, {
        left: event.key === "ArrowLeft",
        right: event.key === "ArrowRight",
        up: event.key === "ArrowUp",
        down: event.key === "ArrowDown"
      });
      if (!next) return;
      const row = rows.find((item) => item.id === target.dataset.id);
      if (row) {
        row[target.dataset.key] = target.dataset.key === "commission" ? String(number(target.value) || "") : target.value;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingYellowFocus = next;
      if (event.key === "ArrowLeft") moveYellowCellFocus(target, -1);
      if (event.key === "ArrowRight") moveYellowCellFocus(target, 1);
      if (event.key === "ArrowUp") moveYellowRowFocus(target, -1);
      if (event.key === "ArrowDown") moveYellowRowFocus(target, 1);
    }

    async function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (error) {}
      }
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }

    function openRowLink(text) {
      const url = String(text || "").trim();
      if (!/^https?:\/\//i.test(url)) return false;
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    }

    function renderActiveRowOptions() {
      const current = $("activeRow").value || rows[rows.length - 1]?.id;
      $("activeRow").innerHTML = rows.map((row) => `<option value="${row.id}">第 ${row.index} 行${row.sku ? ` - ${escapeHtml(row.sku)}` : ""}</option>`).join("");
      if (rows.some((row) => row.id === current)) $("activeRow").value = current;
      else if (rows.length) $("activeRow").value = rows[rows.length - 1].id;
    }

    function saleRubForQuote(quote) {
      if (quote < 135) return 200;
      if (quote <= 600) return 2000;
      return 20000;
    }

    function syncSaleRubFromActiveRow(shouldRenderFreight = false) {
      const row = rows.find((item) => item.id === $("activeRow").value) || rows[rows.length - 1];
      if (!row) return;
      const quote = calc(row).quote;
      const saleRub = saleRubForQuote(quote);
      if (String($("saleRub").value) !== String(saleRub)) {
        $("saleRub").value = String(saleRub);
        if (shouldRenderFreight) renderFreight();
      }
    }

    function fillBestFreight(rowId = $("activeRow").value, shouldRender = true) {
      const targetId = rowId || rows[rows.length - 1]?.id;
      const row = rows.find((item) => item.id === targetId);
      if (!row) return false;
      const value = bestFreight ? bestFreight.price.toFixed(2) : "";
      if (row.freight === value) return false;
      row.freight = value;
      if (shouldRender) renderRows();
      return true;
    }

    function scrollPricingTableToBottom() {
      const wrapper = document.querySelector(".pricing-table-wrap");
      if (!wrapper) return;
      requestAnimationFrame(() => {
        wrapper.scrollTop = wrapper.scrollHeight;
      });
    }

    function renderSummary() {
      const filled = rows.filter(isCompleteRow);
      const calcs = filled.map(calc);
      const validMargins = calcs.filter((item) => item.margin !== null);
      const ok = validMargins.filter((item) => item.margin >= 0.18).length;
      const totalProfit = calcs.reduce((sum, item) => sum + item.profit, 0);
      const avgMargin = validMargins.length ? validMargins.reduce((sum, item) => sum + item.margin, 0) / validMargins.length : null;
      $("filledRows").textContent = String(filled.length);
      $("okRows").textContent = String(ok);
      $("totalProfit").textContent = money(totalProfit);
      $("totalProfit").className = totalProfit >= 0 ? "good" : "bad";
      $("avgMargin").textContent = pct(avgMargin);
      $("avgMargin").className = avgMargin === null ? "" : avgMargin >= 0.18 ? "good" : "bad";
    }

    function freightInputs() {
      const length = number($("length").value);
      const width = number($("width").value);
      const height = number($("height").value);
      const sides = [length, width, height].sort((a, b) => b - a);
      return {
        sale: number($("saleRub").value),
        weight: number($("weight").value),
        length,
        width,
        height,
        sum: length + width + height,
        sides,
        volume12000: length * width * height / 12000
      };
    }

    function checkRoute(route, input) {
      const reasons = [];
      const billableWeight = route.usesVolume ? Math.max(input.weight, input.volume12000) : input.weight;
      if (!(input.sale > route.minValue && input.sale <= route.maxValue)) reasons.push(`货值需为 ${route.valueText}`);
      if (!(input.weight > route.minWeightExclusive && input.weight <= route.maxWeight)) reasons.push(`实重需为 ${route.weightText}`);
      if (route.maxBillable && billableWeight > route.maxBillable) reasons.push(`计费重量需不超过 ${route.maxBillable}KG`);
      if (input.sum > route.maxSum) reasons.push(`三边和需不超过 ${route.maxSum}CM`);
      if (Math.max(...input.sides) > route.maxSide) reasons.push(`单边最大尺寸需不超过 ${route.maxSide}CM`);
      const ok = reasons.length === 0;
      return { ...route, ok, reasons, billableWeight, price: ok ? billableWeight * route.rate + route.fixed : null };
    }

    function renderFreight(shouldFillRow = true) {
      const input = freightInputs();
      const checked = routes.map((route) => checkRoute(route, input));
      const available = checked.filter((route) => route.ok).sort((a, b) => a.price - b.price);
      bestFreight = available[0] || null;
      $("freightSummary").innerHTML = `三边和：<b>${input.sum.toFixed(1)} cm</b>，体积重：<b>${input.volume12000.toFixed(3)} kg</b>，最低可用运费：<b class="${bestFreight ? "good" : "bad"}">${bestFreight ? money(bestFreight.price) : "无"}</b>`;
      const ordered = [...available, ...checked.filter((route) => !route.ok)];
      $("routes").innerHTML = ordered.map((route) => `
        <article class="route ${route.ok ? "" : "unavailable"} ${bestFreight && route.name === bestFreight.name ? "best" : ""}">
          <h3>${route.name}</h3>
          <p class="meta">${route.cn}｜${route.delivery}<br>${route.feeText}<br>计费重：${route.billableWeight.toFixed(3)} kg</p>
          <div class="price">${route.ok ? money(route.price) : "不可用"}</div>
          ${route.ok ? "" : `<p class="reason">${route.reasons.join("；")}</p>`}
        </article>
      `).join("");
      if (shouldFillRow) fillBestFreight($("activeRow").value || rows[rows.length - 1]?.id);
    }

    function parseOzonText() {
      const text = $("ozonText").value.replace(/\s+/g, " ").trim();
      if (!text) {
        $("parseStatus").textContent = "请先粘贴包含长宽高和重量的文字。";
        return;
      }
      const dimMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:x|X|×|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:x|X|×|\*)\s*(\d+(?:[.,]\d+)?)\s*(mm|毫米|cm|厘米)?/i);
      const weightMatch = text.match(/重量[^0-9]*(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|g|克)?/i) || text.match(/(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|g|克)/i);
      const found = [];
      if (dimMatch) {
        let dims = [normalizeNumber(dimMatch[1]), normalizeNumber(dimMatch[2]), normalizeNumber(dimMatch[3])];
        const unit = (dimMatch[4] || "").toLowerCase();
        if (unit.includes("mm") || unit.includes("毫米") || (!unit && Math.max(...dims) > 150)) dims = dims.map((value) => value / 10);
        dims = dims.sort((a, b) => b - a);
        $("length").value = trimNumber(dims[0], 2);
        $("width").value = trimNumber(dims[1], 2);
        $("height").value = trimNumber(dims[2], 2);
        found.push(`尺寸 ${$("length").value} x ${$("width").value} x ${$("height").value} cm`);
      }
      if (weightMatch) {
        let weight = normalizeNumber(weightMatch[1]);
        const unit = (weightMatch[2] || "").toLowerCase();
        if (unit === "g" || unit.includes("克") || (!unit && weight > 50)) weight = weight / 1000;
        $("weight").value = trimNumber(weight, 3);
        found.push(`重量 ${$("weight").value} kg`);
      }
      $("parseStatus").textContent = found.length ? `已填入：${found.join("；")}` : "没有识别到长宽高或重量。";
      renderFreight();
    }

    function normalizeNumber(text) {
      return Number(String(text).replace(",", "."));
    }

    function trimNumber(value, digits) {
      return value.toFixed(digits).replace(/\.?0+$/, "");
    }

    function exportCsv() {
      const headers = ["序号","绿标价格*","黑标价格*","佣金*","真实售价","自动生成不用填","定价低于真实售价","手动定价","系数","手动系数","采购成本*","国际运费*","贴单费","平台佣金","利润","利润率 ≥18%","SKU","跟卖链接","货源","备注"];
      const body = rows.map((row) => {
        const c = calc(row);
        return [
          row.index, row.green, row.black, row.commission === "" ? "" : `${row.commission}%`, c.trueSale, c.autoFee, c.quote, row.quoteOverride, c.pricingFactor, row.factorOverride,
          row.cost, row.freight, c.labelFee, c.platform, c.profit, c.margin === null ? "" : c.margin,
          row.sku, row.link, row.source, row.note
        ];
      });
      const csv = [headers, ...body].map((line) => line.map(csvCell).join(",")).join("\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "OZON本地核价表.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function normalizeHeader(value) {
      return String(value ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, "").replace(/\*/g, "").trim();
    }

    function cleanImportedNumber(value) {
      let text = String(value ?? "").replace("%", "").replace(/[¥￥]/g, "").trim();
      if (text === "" || text === "-") return "";
      text = text.replace(/[\u00a0\u202f]/g, " ");
      if (/^-?\d{1,3}(\s\d{3})+([,.]\d+)?$/.test(text)) text = text.replace(/\s/g, "").replace(",", ".");
      if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
      else if (/^-?\d+,\d+$/.test(text)) text = text.replace(",", ".");
      const n = Number(text);
      return Number.isFinite(n) ? trimNumber(n, 4) : text;
    }

    function parseCsv(text) {
      const rowsOut = [];
      let row = [];
      let cell = "";
      let quoted = false;
      const source = String(text ?? "").replace(/^\uFEFF/, "");
      for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        const next = source[i + 1];
        if (quoted) {
          if (ch === '"' && next === '"') {
            cell += '"';
            i += 1;
          } else if (ch === '"') {
            quoted = false;
          } else {
            cell += ch;
          }
          continue;
        }
        if (ch === '"') {
          quoted = true;
        } else if (ch === ",") {
          row.push(cell);
          cell = "";
        } else if (ch === "\n") {
          row.push(cell);
          rowsOut.push(row);
          row = [];
          cell = "";
        } else if (ch !== "\r") {
          cell += ch;
        }
      }
      if (cell !== "" || row.length) {
        row.push(cell);
        rowsOut.push(row);
      }
      return rowsOut.filter((line) => line.some((value) => String(value).trim() !== ""));
    }

    function rowFromCsvRecord(record, index) {
      const row = emptyRow(index);
      row.green = cleanImportedNumber(record["绿标价格"] ?? record["绿标价格*"]);
      row.black = cleanImportedNumber(record["黑标价格"] ?? record["黑标价格*"]);
      row.commission = cleanImportedNumber(record["佣金"] ?? record["佣金*"]);
      row.quoteOverride = cleanImportedNumber(record["手动定价"]);
      row.factorOverride = cleanImportedNumber(record["手动系数"]);
      row.cost = cleanImportedNumber(record["采购成本"] ?? record["采购成本*"]);
      row.freight = cleanImportedNumber(record["国际运费"] ?? record["国际运费*"]);
      row.sku = String(record["SKU"] ?? "").trim();
      row.link = String(record["跟卖链接"] ?? "").trim();
      row.source = String(record["货源"] ?? "").trim();
      row.note = String(record["备注"] ?? "").trim();
      return row;
    }

    function importCsvText(text) {
      const table = parseCsv(text);
      if (table.length < 2) throw new Error("CSV 没有可导入的数据。");
      const headers = table[0].map(normalizeHeader);
      const imported = table.slice(1).map((line, index) => {
        const record = {};
        headers.forEach((header, colIndex) => {
          record[header] = line[colIndex] ?? "";
        });
        return rowFromCsvRecord(record, index + 1);
      }).filter((row) => hasRequired(row) || row.sku || row.link || row.source || row.note);
      if (!imported.length) throw new Error("CSV 里没有识别到核价明细。");
      const replacingBlank = rows.length === 1 && isBlankOrLegacyDefaultRow(rows[0]);
      const nextCount = replacingBlank ? imported.length : rows.length + imported.length;
      if (nextCount > MAX_DRAFT_ROWS) throw new Error(`导入后将超过 ${MAX_DRAFT_ROWS} 行，请拆分 CSV。`);
      if (replacingBlank) {
        rows = imported;
      } else {
        rows = [...rows, ...imported];
      }
      renderRows();
      $("activeRow").value = rows[rows.length - 1]?.id || "";
      syncSaleRubFromActiveRow(true);
      scrollPricingTableToBottom();
      $("syncStatus").textContent = `已导入 CSV：${imported.length} 行。`;
      $("syncStatus").className = "sync-status good";
    }

    async function importCsvFile(file) {
      if (!file) return;
      const text = await file.text();
      importCsvText(text);
    }

    function currentSummary() {
      const filled = rows.filter(isCompleteRow);
      const calcs = filled.map(calc);
      const validMargins = calcs.filter((item) => item.margin !== null);
      return {
        filledRows: filled.length,
        okRows: validMargins.filter((item) => item.margin >= 0.18).length,
        totalProfit: calcs.reduce((sum, item) => sum + item.profit, 0),
        avgMargin: validMargins.length ? validMargins.reduce((sum, item) => sum + item.margin, 0) / validMargins.length : 0,
      };
    }

    function newRequestId() {
      return window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    function buildSyncPayload(requestId) {
      const submitter = $("submitter").value.trim();
      const endpoint = $("syncEndpoint").value.trim();
      const token = $("syncToken").value.trim();
      if (!submitter) throw new Error("请先填写提交人。");
      if (!endpoint) throw new Error("请先填写同步接口地址。");
      if (!token) throw new Error("请先填写同步令牌。");
      const startedRows = rows.filter(hasRequired);
      if (!startedRows.length) throw new Error("没有可同步的已填写行。");
      const incompleteRows = startedRows.filter((row) => !isCompleteRow(row));
      if (incompleteRows.length) {
        const detail = incompleteRows.slice(0, 8).map((row) => {
          const missing = missingRequiredFields(row).map((key) => REQUIRED_PRICING_LABELS[key]).join("、");
          return `第 ${row.index} 行缺少：${missing}`;
        }).join("；");
        throw new Error(`存在 ${incompleteRows.length} 行未填写完整，已阻止同步。${detail}`);
      }
      const filledRows = startedRows;
      return {
        endpoint,
        token,
        body: {
          requestId,
          submitter,
          note: $("syncNote").value.trim(),
          summary: currentSummary(),
          rows: filledRows.map((row, index) => {
            const c = calc(row);
            return {
              filled: true,
              index: index + 1,
              green: number(row.green),
              black: number(row.black),
              commission: number(row.commission),
              trueSale: c.trueSale,
              quote: c.quote,
              cost: number(row.cost),
              freight: number(row.freight),
              labelFee: c.labelFee,
              platform: c.platform,
              profit: c.profit,
              margin: c.margin ?? 0,
              sku: row.sku,
              link: row.link,
              source: row.source,
              note: row.note,
            };
          }),
        },
      };
    }

    function saveSyncSettings() {
      localStorage.setItem("ozon_sync_submitter", $("submitter").value.trim());
      localStorage.setItem("ozon_sync_endpoint", $("syncEndpoint").value.trim());
      localStorage.setItem("ozon_sync_token", $("syncToken").value.trim());
      $("syncStatus").textContent = "同步设置已保存到本机浏览器。";
      $("syncStatus").className = "sync-status good";
    }

    function loadSyncSettings() {
      $("submitter").value = localStorage.getItem("ozon_sync_submitter") || "";
      $("syncEndpoint").value = localStorage.getItem("ozon_sync_endpoint") || "";
      $("syncToken").value = localStorage.getItem("ozon_sync_token") || "";
    }

    function openFeishuBase() {
      window.open(FEISHU_DETAIL_TABLE_URL, "_blank", "noopener,noreferrer");
    }

    async function syncToCloud() {
      const button = $("syncCloud");
      const pendingKey = "ozon_pending_sync_request_id";
      try {
        saveSyncSettings();
        const requestId = sessionStorage.getItem(pendingKey) || newRequestId();
        sessionStorage.setItem(pendingKey, requestId);
        const payload = buildSyncPayload(requestId);
        button.disabled = true;
        button.textContent = "同步中...";
        $("syncStatus").textContent = "正在同步到飞书多维表格，请稍候。";
        $("syncStatus").className = "sync-status";

        const response = await fetch(payload.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Ozon-Sync-Token": payload.token },
          body: JSON.stringify(payload.body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `同步失败：HTTP ${response.status}`);
        }
        const skippedText = data.skippedRows ? `，跳过重复 ${data.skippedRows} 行` : "";
        $("syncStatus").textContent = data.syncedRows > 0
          ? `同步成功：批次 ${data.batchId}，新增明细 ${data.syncedRows} 行${skippedText}。`
          : `没有新增明细：${data.skippedRows || 0} 行已存在或本次重复。`;
        $("syncStatus").className = "sync-status good";
        sessionStorage.removeItem(pendingKey);
      } catch (error) {
        $("syncStatus").textContent = error.message || String(error);
        $("syncStatus").className = "sync-status bad";
      } finally {
        button.disabled = false;
        button.textContent = "同步到飞书多维表格";
      }
    }

    async function enrichFeishuLinks() {
      const button = $("enrichLinks");
      const endpoint = $("syncEndpoint").value.trim();
      const token = $("syncToken").value.trim();
      if (!endpoint) {
        $("syncStatus").textContent = "请先填写同步接口地址。";
        $("syncStatus").className = "sync-status bad";
        return;
      }
      if (!token) {
        $("syncStatus").textContent = "请先填写同步令牌。";
        $("syncStatus").className = "sync-status bad";
        return;
      }
      try {
        saveSyncSettings();
        const pendingKey = "ozon_pending_enrich_request_id";
        const requestId = sessionStorage.getItem(pendingKey) || newRequestId();
        sessionStorage.setItem(pendingKey, requestId);
        button.disabled = true;
        button.textContent = "补全中...";
        $("syncStatus").textContent = "正在读取飞书“核价明细”里的跟卖链接，并回填商品参数。";
        $("syncStatus").className = "sync-status";

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Ozon-Sync-Token": token },
          body: JSON.stringify({
            requestId,
            action: "enrichLinks",
            submitter: $("submitter").value.trim(),
            note: $("syncNote").value.trim(),
            limit: 20,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `补全失败：HTTP ${response.status}`);
        }
        $("syncStatus").textContent = `补全完成：找到 ${data.matchedRows} 条链接，成功 ${data.successRows} 条，失败 ${data.failedRows} 条。`;
        $("syncStatus").className = data.failedRows ? "sync-status bad" : "sync-status good";
        sessionStorage.removeItem(pendingKey);
      } catch (error) {
        $("syncStatus").textContent = error.message || String(error);
        $("syncStatus").className = "sync-status bad";
      } finally {
        button.disabled = false;
        button.textContent = "批量补全飞书链接";
      }
    }

    async function rebuildDedupeIndex() {
      const endpoint = $("syncEndpoint").value.trim();
      const token = $("syncToken").value.trim();
      if (!endpoint || !token) {
        $("syncStatus").textContent = "请先填写同步接口地址和同步令牌。";
        $("syncStatus").className = "sync-status bad";
        return;
      }
      if (!window.confirm("确定扫描现有飞书明细并重建去重索引吗？数据较多时可能需要等待。")) return;
      const button = $("rebuildDedupe");
      try {
        button.disabled = true;
        button.textContent = "重建中...";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Ozon-Sync-Token": token },
          body: JSON.stringify({ requestId: newRequestId(), action: "rebuildDedupeIndex" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || `重建失败：HTTP ${response.status}`);
        $("syncStatus").textContent = `去重索引重建完成：扫描 ${data.scannedRows} 行，建立 ${data.indexedKeys} 个索引。`;
        $("syncStatus").className = "sync-status good";
      } catch (error) {
        $("syncStatus").textContent = error.message || String(error);
        $("syncStatus").className = "sync-status bad";
      } finally {
        button.disabled = false;
        button.textContent = "重建去重索引";
      }
    }

    function csvCell(value) {
      const text = String(value ?? "");
      const dangerous = /^[=+@]/.test(text) || /^-(?!\d+(?:[.,]\d+)?$)/.test(text);
      const safe = dangerous ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#096;");
    }

    function parseProductDimensions(product) {
      let dims = [number(product.lengthCm), number(product.widthCm), number(product.heightCm)].filter((value) => value > 0);
      if (dims.length === 3) return dims.sort((a, b) => b - a);
      const text = `${product.dimensionsText || ""} ${product.rawText || ""}`.replace(/[：]/g, ":").replace(/[×]/g, "x").replace(/\s+/g, " ");
      const match = text.match(/(?:长\s*宽\s*高|长宽高|尺寸|包装尺寸|规格)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:x|X|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:x|X|\*)\s*(\d+(?:[.,]\d+)?)\s*(mm|毫米|cm|厘米)?/i)
        || text.match(/(\d+(?:[.,]\d+)?)\s*(?:x|X|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:x|X|\*)\s*(\d+(?:[.,]\d+)?)\s*(mm|毫米|cm|厘米)/i);
      if (!match) return [];
      dims = [normalizeNumber(match[1]), normalizeNumber(match[2]), normalizeNumber(match[3])];
      const unit = String(match[4] || "").toLowerCase();
      if (unit.includes("mm") || unit.includes("毫米") || (!unit && Math.max(...dims) > 150)) dims = dims.map((value) => value / 10);
      return dims.sort((a, b) => b - a);
    }

    function parseProductWeight(product) {
      const direct = number(product.weightKg);
      if (direct > 0) return direct;
      const text = `${product.weightText || ""} ${product.rawText || ""}`.replace(/[：]/g, ":").replace(/\s+/g, " ");
      const match = text.match(/(?:重量|实重|毛重|净重)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|g|克)?/i)
        || text.match(/(\d+(?:[.,]\d+)?)\s*(kg|千克|公斤|g|克)/i);
      if (!match) return 0;
      let weight = normalizeNumber(match[1]);
      const unit = String(match[2] || "").toLowerCase();
      if (unit === "g" || unit.includes("克")) weight /= 1000;
      return weight;
    }

    function freightInputFromProduct(product, quote) {
      const dims = parseProductDimensions(product);
      const weight = parseProductWeight(product);
      const freightQuote = number(quote);
      if (dims.length !== 3 || !weight || !freightQuote) return null;
      return {
        sale: saleRubForQuote(freightQuote),
        weight,
        length: dims[0],
        width: dims[1],
        height: dims[2],
        sides: dims,
        sum: dims[0] + dims[1] + dims[2],
        volume12000: dims[0] * dims[1] * dims[2] / 12000,
      };
    }

    function bestFreightForProduct(product, quote) {
      const input = freightInputFromProduct(product, quote);
      if (!input) return null;
      const best = routes
        .map((route) => checkRoute(route, input))
        .filter((route) => route.ok)
        .sort((a, b) => a.price - b.price)[0] || null;
      return best ? { best, input } : { best: null, input };
    }

    function applyErpDetailToRow(product) {
      if (rows.length === 1 && isBlankOrLegacyDefaultRow(rows[0])) {
        rows = [];
      }
      if (rows.length >= MAX_DRAFT_ROWS) {
        $("syncStatus").textContent = `已达到 ${MAX_DRAFT_ROWS} 行上限，请先导出 CSV 并清理旧记录。`;
        $("syncStatus").className = "sync-status bad";
        return;
      }
      const row = emptyRow(rows.length + 1);
      rows.push(row);
      if (product.greenPrice) row.green = trimNumber(number(product.greenPrice), 2);
      if (product.blackPrice) row.black = trimNumber(number(product.blackPrice), 2);
      if (product.sku) row.sku = String(product.sku);
      if (product.commission) row.commission = trimNumber(number(product.commission), 2);
      const productFreight = bestFreightForProduct(product, calc(row).quote);
      if (productFreight?.best) row.freight = trimNumber(productFreight.best.price, 2);
      else if (!productFreight?.input && product.freight) row.freight = trimNumber(number(product.freight), 2);
      if (product.link) row.link = String(product.link);
      renderRows();
      $("activeRow").value = row.id;
      if (productFreight?.input) {
        $("saleRub").value = String(productFreight.input.sale);
        $("weight").value = trimNumber(productFreight.input.weight, 3);
        $("length").value = trimNumber(productFreight.input.length, 2);
        $("width").value = trimNumber(productFreight.input.width, 2);
        $("height").value = trimNumber(productFreight.input.height, 2);
        renderFreight();
      }
      scrollPricingTableToBottom();
      $("syncStatus").textContent = `已从详情页填入：SKU ${row.sku || "-"}，绿标 ${row.green || "-"}，佣金 ${row.commission || "-"}%，运费 ${row.freight || "-"}`;
      $("syncStatus").className = "sync-status good";
    }

    window.addEventListener("message", (event) => {
      if (!["https://www.ozon.ru", "https://yehui1285-tech.github.io"].includes(event.origin)) return;
      const data = event.data || {};
      if (data.type !== "OZON_ERP_DETAIL") return;
      applyErpDetailToRow(data.product || {});
    });

    $("addRow").addEventListener("click", () => {
      if (rows.length >= MAX_DRAFT_ROWS) {
        $("syncStatus").textContent = `已达到 ${MAX_DRAFT_ROWS} 行上限，请先导出 CSV 并清理旧记录。`;
        $("syncStatus").className = "sync-status bad";
        return;
      }
      const row = emptyRow(rows.length + 1);
      rows.push(row);
      renderRows();
      $("activeRow").value = row.id;
      syncSaleRubFromActiveRow(false);
      scrollPricingTableToBottom();
    });

    $("deleteBlankRows").addEventListener("click", () => {
      rows = rows.filter(hasRequired);
      if (!rows.length) rows.push(emptyRow(1));
      renderRows();
    });

    $("clearAllRows").addEventListener("click", () => {
      const contentRows = rows.filter((row) => PRICING_ROW_KEYS.some((key) => String(row[key]).trim() !== "")).length;
      if (!contentRows) {
        $("syncStatus").textContent = "当前没有需要清空的核价记录。";
        $("syncStatus").className = "sync-status";
        return;
      }
      if (!window.confirm(`确定清空当前 ${contentRows} 行核价记录吗？清空后自动保存的记录也会被覆盖。`)) return;
      rows = [emptyRow(1)];
      savePricingDraft();
      renderRows();
      $("syncStatus").textContent = "核价记录已清空。";
      $("syncStatus").className = "sync-status good";
    });

    $("exportCsv").addEventListener("click", exportCsv);
    $("importCsv").addEventListener("click", () => $("csvFile").click());
    $("csvFile").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      try {
        await importCsvFile(file);
      } catch (error) {
        $("syncStatus").textContent = `CSV 导入失败：${error.message || error}`;
        $("syncStatus").className = "sync-status bad";
      } finally {
        event.target.value = "";
      }
    });
    $("saveSyncSettings").addEventListener("click", saveSyncSettings);
    $("syncCloud").addEventListener("click", syncToCloud);
    $("openFeishuBase").addEventListener("click", openFeishuBase);
    $("rebuildDedupe").addEventListener("click", rebuildDedupeIndex);
    if ($("enrichLinks")) $("enrichLinks").addEventListener("click", enrichFeishuLinks);

    $("fillFreight").addEventListener("click", () => {
      fillBestFreight();
    });

    $("activeRow").addEventListener("change", () => {
      syncSaleRubFromActiveRow(true);
    });

    $("pricingTable").addEventListener("keydown", handleYellowNavKey, true);
    ["saleRub", "weight", "length", "width", "height"].forEach((id) => $(id).addEventListener("input", renderFreight));
    $("parseOzon").addEventListener("click", parseOzonText);
    $("clearOzon").addEventListener("click", () => {
      $("ozonText").value = "";
      $("parseStatus").textContent = "";
    });
    $("ozonText").addEventListener("paste", () => setTimeout(parseOzonText, 0));

    window.addEventListener("pagehide", savePricingDraft);

    $("appVersion").textContent = APP_VERSION;
    loadSyncSettings();
    const restoredDraft = restorePricingDraft();
    renderRows();
    renderFreight(false);
    if (restoredDraft?.contentRows) {
      const savedAt = formatDraftSavedAt(restoredDraft.savedAt);
      $("syncStatus").textContent = `已自动恢复上次的 ${restoredDraft.contentRows} 行核价记录${savedAt ? `（保存于 ${savedAt}）` : ""}。`;
      $("syncStatus").className = "sync-status good";
    }
