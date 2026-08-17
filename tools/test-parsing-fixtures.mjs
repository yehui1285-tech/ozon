// 采集解析样本回归测试库
// 用途：把历史上反复修复过的毛子 ERP 字段解析边界案例固化成样本，防止回归。
// 新增样本：直接在 fixtures 数组里加一行即可，无需改测试逻辑。
// 覆盖范围：
//   - content.js 纯函数：num / normalizeText / parsePercents / parseDimensions / parseWeight / saleValue
//   - store-scanner-core.js：competitorState / parseCardText
// 注意：佣金档位 pickCommission 已在 test-commission-rules.mjs 覆盖，此处不再重复。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentSource = fs.readFileSync(
  path.join(root, "ozon-erp-collector-extension", "content.js"),
  "utf8",
);

// 从 content.js 提取顶层纯函数（函数声明均以独占一行的 `}` 结尾，可安全按此边界截取）。
function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`未在 content.js 中找到函数 ${name}`);
  return match[0];
}

const detailFunctionNames = ["num", "first", "normalizeText", "parsePercents", "parseDimensions", "parseWeight", "saleValue"];
const detailSource = detailFunctionNames.map((name) => extractFunction(contentSource, name)).join("\n");
const detailContext = {};
vm.runInNewContext(
  `${detailSource}\nglobalThis.__detail = { ${detailFunctionNames.join(", ")} };`,
  detailContext,
);
const detail = detailContext.__detail;

// 店铺扫描解析核心（IIFE 安装到 globalThis.OzonStoreScannerCore）。
await import(`../ozon-erp-collector-extension/store-scanner-core.js?test=${Date.now()}`);
const core = globalThis.OzonStoreScannerCore;

// ─────────────────────────────────────────────────────────────────────────
// 样本库：{ fn, input, expect, note }
//   fn     解析函数名
//   input  输入（字符串或数值）
//   expect 期望结果；对返回对象的函数只需列出要校验的字段（其余字段忽略）
//   note   一句话说明该样本对应的历史 bug / 边界
// ─────────────────────────────────────────────────────────────────────────
const fixtures = [
  // ── num：数字解析（货币符号 / 千分位 / 俄式小数逗号）──
  { fn: "num", input: "1 234", expect: 1234, note: "普通空格千分位" },
  { fn: "num", input: "1\u202f234", expect: 1234, note: "窄不换行空格千分位" },
  { fn: "num", input: "1 234,56", expect: 1234.56, note: "千分位+俄式小数逗号" },
  { fn: "num", input: "1.234,56", expect: 1234.56, note: "点千分位+逗号小数" },
  { fn: "num", input: "126,44", expect: 126.44, note: "俄式小数逗号" },
  { fn: "num", input: "\u00a5201.65", expect: 201.65, note: "人民币符号" },
  { fn: "num", input: "\uffe51 222,49", expect: 1222.49, note: "全角人民币+空格千分位" },
  { fn: "num", input: "\u20bd 894.14", expect: 894.14, note: "卢布符号" },
  { fn: "num", input: "17%", expect: 17, note: "百分比" },
  { fn: "num", input: "3 000g", expect: 3000, note: "带单位数字" },
  { fn: "num", input: "", expect: 0, note: "空字符串" },
  { fn: "num", input: "abc", expect: 0, note: "非数字" },

  // ── normalizeText：文本归一化 ──
  { fn: "normalizeText", input: "长 宽 高：50 \u00d7 300", expect: "长 宽 高:50 x 300", note: "全角冒号与乘号归一化" },
  { fn: "normalizeText", input: "  a\t b\n c ", expect: "a b c", note: "空白折叠" },

  // ── parsePercents：rFBS 佣金档位 ──
  { fn: "parsePercents", input: "rFBS佣金：\n12%\n14%\n18%", expect: { values: [12, 14, 18] }, note: "三档换行格式" },
  { fn: "parsePercents", input: "rFBS佣金：\n12%\n17%\n17%", expect: { values: [12, 17, 17] }, note: "低价商品三档" },
  { fn: "parsePercents", input: "rFBS 佣金: 12% 17% 17%", expect: { values: [12, 17, 17] }, note: "空格分隔英文冒号" },
  { fn: "parsePercents", input: "没有佣金信息", expect: { values: [] }, note: "无 rFBS" },

  // ── parseDimensions：长宽高（单位换算 + 长边排序）──
  { fn: "parseDimensions", input: "长 宽 高：50 x 300 x 160mm", expect: { lengthCm: 30, widthCm: 16, heightCm: 5 }, note: "mm 转 cm 并按长边排序" },
  { fn: "parseDimensions", input: "尺寸：130 x 28 x 10cm", expect: { lengthCm: 130, widthCm: 28, heightCm: 10 }, note: "cm 原样" },
  { fn: "parseDimensions", input: "包装尺寸：1300 x 280 x 100mm", expect: { lengthCm: 130, widthCm: 28, heightCm: 10 }, note: "包装尺寸 mm 转 cm" },
  { fn: "parseDimensions", input: "规格：50x30x16", expect: { lengthCm: 50, widthCm: 30, heightCm: 16 }, note: "规格无单位" },
  { fn: "parseDimensions", input: "长宽高：1500 x 200 x 100mm", expect: { lengthCm: 150, widthCm: 20, heightCm: 10 }, note: "长宽高 mm" },
  { fn: "parseDimensions", input: "50*30*16毫米", expect: { lengthCm: 5, widthCm: 3, heightCm: 1.6 }, note: "无标签星号+毫米" },
  { fn: "parseDimensions", input: "没有尺寸信息", expect: { lengthCm: 0, widthCm: 0, heightCm: 0 }, note: "无尺寸" },

  // ── parseWeight：重量（克/千克换算）──
  { fn: "parseWeight", input: "重量：1174g", expect: { weightKg: 1.174 }, note: "克转千克" },
  { fn: "parseWeight", input: "重 量：188g", expect: { weightKg: 0.188 }, note: "带空格的\u201c重 量\u201d" },
  { fn: "parseWeight", input: "重量：1.5kg", expect: { weightKg: 1.5 }, note: "千克" },
  { fn: "parseWeight", input: "毛重：3 kg", expect: { weightKg: 3 }, note: "毛重+空格+kg" },
  { fn: "parseWeight", input: "净重：2000克", expect: { weightKg: 2 }, note: "净重+克" },
  { fn: "parseWeight", input: "3000g", expect: { weightKg: 3 }, note: "无标签回退" },
  { fn: "parseWeight", input: "没有重量", expect: { weightKg: 0 }, note: "无重量" },

  // ── saleValue：货值分档 ──
  { fn: "saleValue", input: 134, expect: 200, note: "低于 135" },
  { fn: "saleValue", input: 135, expect: 2000, note: "135 边界" },
  { fn: "saleValue", input: 600, expect: 2000, note: "600 边界" },
  { fn: "saleValue", input: 600.01, expect: 20000, note: "高于 600" },

  // ── competitorState：跟卖最低价（中英文冒号 / 货币 / 无价格）──
  { fn: "competitorState", input: "跟卖最低价：\u00a5201.65", expect: { value: "\u00a5201.65", ready: true }, note: "中文冒号人民币" },
  { fn: "competitorState", input: "跟卖最低价: \u20bd 1 222,49", expect: { value: "\u20bd 1 222,49", ready: true }, note: "英文冒号卢布千分位" },
  { fn: "competitorState", input: "跟卖最低价：\uffe5122.49", expect: { value: "\uffe5122.49", ready: true }, note: "全角人民币" },
  { fn: "competitorState", input: "跟卖最低价：暂无", expect: { value: "暂无", ready: true }, note: "暂无" },
  { fn: "competitorState", input: "跟卖最低价：无", expect: { value: "无", ready: true }, note: "无" },
  { fn: "competitorState", input: "跟卖最低价：没有跟卖", expect: { value: "没有跟卖", ready: true }, note: "没有跟卖" },
  { fn: "competitorState", input: "跟卖最低价：--", expect: { value: "--", ready: true }, note: "破折号占位" },
  { fn: "competitorState", input: "跟卖最低价：", expect: { value: "", ready: false }, note: "有标签但空值" },
  { fn: "competitorState", input: "SKU：123", expect: { value: "", ready: false }, note: "无标签" },

  // ── parseCardText：店铺商品卡片 ──
  {
    fn: "parseCardText",
    input: "符合要求\nrFBS佣金：\n12%\n14%\n18%\nSKU：3258064058\n月销量：3\n发货模式：FBS\n长 宽 高：1300 x 280 x 100mm\n重 量：3000g\n跟卖最低价：\u00a5201.65",
    expect: { qualified: true, sku: "3258064058", commissions: ["12%", "14%", "18%"], monthlySales: "3", fulfillment: "FBS", competitor: "\u00a5201.65", competitorReady: true },
    note: "完整卡片",
  },
  {
    fn: "parseCardText",
    input: "符合要求\nrFBS佣金：\n12% / 17% / 17%\nSKU：4821128720\n跟卖最低价: \u20bd 1 222,49",
    expect: { qualified: true, sku: "4821128720", commissions: ["12%", "17%", "17%"], competitor: "\u20bd 1 222,49", competitorReady: true },
    note: "斜杠分隔佣金+卢布",
  },
  {
    fn: "parseCardText",
    input: "rFBS佣金：\n12%\n17%\n17%\nSKU：2\n跟卖最低价：暂无",
    expect: { qualified: false, sku: "2", competitor: "暂无", competitorReady: true },
    note: "无符合要求标签",
  },
  {
    fn: "parseCardText",
    input: "符合要求\n327,28 \u00a5\nSKU：3258064058",
    expect: { qualified: true, price: "327,28", sku: "3258064058" },
    note: "俄式小数价格",
  },
  {
    fn: "parseCardText",
    input: "符合要求\n1 234,56 \u00a5\nSKU：3258064058",
    expect: { qualified: true, price: "1 234,56", sku: "3258064058" },
    note: "千分位空格+俄式小数价格",
  },
];

function call(fn, input) {
  if (fn in detail) return detail[fn](input);
  if (fn === "competitorState") return core.competitorState(input);
  if (fn === "parseCardText") return core.parseCardText(input);
  throw new Error(`未知解析函数：${fn}`);
}

// vm.runInNewContext 提取出的函数返回的对象/数组来自另一个 realm，其原型与宿主 realm 不同，
// 直接 deepStrictEqual 会因原型不一致而误判为不相等。这里通过 JSON 往返把结果归一化到宿主 realm。
function normalize(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

let passed = 0;
const failures = [];
for (const [index, fixture] of fixtures.entries()) {
  const { fn, input, expect, note } = fixture;
  const actual = normalize(call(fn, input));
  const label = `${fn}(${JSON.stringify(input)})`;
  try {
    if (expect && typeof expect === "object" && !Array.isArray(expect)) {
      const picked = {};
      for (const key of Object.keys(expect)) picked[key] = actual?.[key];
      assert.deepEqual(picked, expect, `${label} ${note || ""}`);
    } else {
      assert.deepEqual(actual, expect, `${label} ${note || ""}`);
    }
    passed += 1;
  } catch (error) {
    failures.push({ index, label, note, expect, actual, message: String(error.message).split("\n")[0] });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`\u2717 ${failure.label} ${failure.note || ""}`);
    console.error(`    期望: ${JSON.stringify(failure.expect)}`);
    console.error(`    实际: ${JSON.stringify(failure.actual)}`);
    console.error(`    ${failure.message}`);
  }
  console.error(`\n解析样本回归：${failures.length}/${fixtures.length} 个样本失败`);
  process.exitCode = 1;
} else {
  console.log(`解析样本回归测试通过：${passed} 个样本`);
}
