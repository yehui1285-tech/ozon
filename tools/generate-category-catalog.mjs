import fs from 'node:fs';
import path from 'node:path';

const ext = path.resolve('ozon-erp-collector-extension');
const [ordinaryPath, chinaPath] = process.argv.slice(2);
if (!ordinaryPath || !chinaPath) throw Error('Usage: node tools/generate-category-catalog.mjs <buyer_categories.json> <china-navigation-seed.json>');
const ordinarySource = JSON.parse(fs.readFileSync(ordinaryPath, 'utf8'));
const chinaSource = JSON.parse(fs.readFileSync(chinaPath, 'utf8'));
const clean = (item, parentId = item.parent_id ?? null) => ({
  id: String(item.id), parentId: parentId == null ? null : String(parentId),
  nameZh: String(item.name_zh || ''), nameRu: String(item.name_ru || ''), url: String(item.url || '')
});
const translatedByName=new Map();
const addTranslation=(ru,zh)=>{if(typeof ru==='string'&&ru.trim()&&typeof zh==='string'&&zh.trim()&&!translatedByName.has(ru.trim().toLowerCase()))translatedByName.set(ru.trim().toLowerCase(),zh.trim())};
for(const node of chinaSource)addTranslation(node.name_ru,node.name_zh);
for(const file of fs.readdirSync(path.dirname(ordinaryPath)).filter(name=>/^china_category_translations(?:_\d+)?\.json$/.test(name)).sort()){
  for(const [ru,zh] of Object.entries(JSON.parse(fs.readFileSync(path.join(path.dirname(ordinaryPath),file),'utf8'))))addTranslation(ru,zh);
}
const ordinary = ordinarySource.items.map(item=>clean(item)).filter(x => x.id && x.url && (x.nameZh || x.nameRu)).map(n=>({...n,nameZh:n.nameZh||translatedByName.get(n.nameRu.trim().toLowerCase())||''}));
const chinaRoot = chinaSource.find(x => x.depth === 0 || x.parent_id == null);
const china = chinaSource.filter(x => x !== chinaRoot).map(x => clean(x, x.parent_id === chinaRoot?.id ? null : x.parent_id))
  .filter(x => x.id && x.url && (x.nameZh || x.nameRu));
const payload = {
  provenance: { snapshotDate: '2026-10-11 / 2026-10-12', note: '公开类目快照（2026-10），未进行实时核验；无中文译名的项目保留俄文。名称与链接可能已变化。' },
  ordinary, china
};
fs.writeFileSync(path.join(ext, 'category-catalog.json'), JSON.stringify(payload));
console.log(`Generated ${ordinary.length} ordinary and ${china.length} China catalog nodes.`);
