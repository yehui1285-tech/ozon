import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const [scannerCore, categoryCore, categoryScanner] = await Promise.all([
  read('../ozon-erp-collector-extension/store-scanner-core.js'),
  read('../ozon-erp-collector-extension/category-core.js'),
  read('../ozon-erp-collector-extension/category-scanner.js'),
]);
const makeEl = ({ text = '', href = '', cls = '', widget = '', children = [], tag = 'DIV', attrs = {} } = {}) => {
  const el = { innerText: text, textContent: text, href, className: cls, tagName: tag, parentElement: null, children, hidden: false,
    getAttribute(name) { return attrs[name] ?? (name === 'data-widget' ? widget : null); },
    getBoundingClientRect() { return { width: 200, height: 100, top: 0, bottom: 100 }; },
    contains(other) { return other === this || this.children.some((child) => child.contains(other)); },
    querySelectorAll(selector) { return this.children.flatMap((c) => [...(selector.includes('a[href') && c.tagName === 'A' ? [c] : []), ...c.querySelectorAll(selector)]); },
    querySelector() { return null; }, closest() { return null; } };
  children.forEach((child) => { child.parentElement = el; }); return el;
};
const card = (sku, name, label = '符合要求', category = '家居') => makeEl({
  text: `${label}\n399.00 ¥\n类目：${category}\nrFBS佣金：10%\nSKU：${sku}\nSKU：${sku}\n月销量：20\n发货模式：FBS\n长宽高：10×10×10\n重量：500g\n跟卖最低价：300`,
  children: [makeEl({ tag: 'A', href: `https://www.ozon.ru/product/${name}-${sku}/`, text: name })],
});
const mainList = makeEl({ widget: 'tileGridDesktop', children: [card('10001', 'valid-item'), card('10002', 'bad-item', '无标签'), card('10003', 'danger-item', '符合要求', '枪支用品'), card('10004', 'wrong-sku') ] });
// The final card deliberately has a SKU/link mismatch.
mainList.children[3].children[0].href = 'https://www.ozon.ru/product/wrong-item-99999/';
const recommendation = makeEl({ widget: 'tileGridDesktop', cls: 'recommendations', children: [card('99901', 'recommended')] });
const context = { URL, location: { href: 'https://www.ozon.ru/category/demo-123/?page=2' }, document: {},
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
context.globalThis = context;
let listener;
context.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } }, sendMessage(_msg, cb) { cb?.({ ok: true }); } } };
for (const src of [scannerCore, categoryCore, categoryScanner]) vm.runInNewContext(src, context);
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList] : [];
context.document.querySelector = () => null;
let ack;
assert.equal(listener({ type: 'categoryScanStart', batchId: 'b', attemptId: 'a', categoryUrl: 'https://www.ozon.ru/category/demo-123/' }, {}, (v) => { ack = v; }), false);
assert.equal(ack?.accepted, true, 'start must be acknowledged immediately');
const reader = context.OzonCategoryScanner.createReader(context.document, context.OzonCategoryCore);
const result = reader.read(context.location.href, {});
assert.deepEqual(Array.from(result.products, (p) => p.sku), ['10001']);
assert.deepEqual(Array.from(result.observedSkus).sort(), ['10001', '10002', '10003']);
assert.equal(result.products[0].link, 'https://www.ozon.ru/product/valid-item-10001/');
assert.equal(context.OzonCategoryCore.paginationUrl(context.location.href, 'https://www.ozon.ru/category/demo-123/'), 'https://www.ozon.ru/category/demo-123/?page=2');
const next = makeEl({ tag: 'A', href: 'https://www.ozon.ru/category/demo-123/?page=3', text: '›', attrs: { 'aria-label': 'Next page' } });
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList] : selector.includes('rel="next"') ? [next] : [];
assert.equal(reader.next(context.location.href), next.href, 'only an explicit same-category next URL is accepted');
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [mainList, makeEl({ widget: 'searchResults' })] : [];
assert.equal(context.OzonCategoryScanner.pickList(context.document), null, 'ambiguous list scope must be rejected');
context.document.querySelectorAll = (selector) => selector.includes('tileGridDesktop') ? [recommendation] : [];
assert.equal(context.OzonCategoryScanner.pickList(context.document), null, 'recommendation list must be rejected');
console.log('category scanner real-core synthetic DOM tests passed');
