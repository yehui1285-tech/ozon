// Ozon is the sole source of these shared implementations. Never edit the
// generated Workbench copies by hand; run this command in the Ozon checkout.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const rootArg = args.indexOf('--workbench');
const requested = rootArg >= 0 ? args[rootArg+1] : process.env.OZON_WORKBENCH_ROOT;
if (!requested || requested.startsWith('--') || args.some((arg,i)=>arg!=='--check'&&arg!=='--workbench'&&i!==rootArg+1)) {
  console.error('Usage: node tools/sync-workbench-core.mjs --workbench <Workbench checkout> [--check]');
  process.exit(2);
}
const wb = fs.realpathSync(path.resolve(requested));
if (wb === fs.realpathSync(root) || !fs.existsSync(path.join(wb,'db/schema.ts')) || !fs.existsSync(path.join(wb,'lib/ozon-pool')) || !fs.existsSync(path.join(wb,'app/ozon/pool'))) {
  throw new Error('The supplied path is not a Workbench checkout.');
}
const extension = 'ozon-erp-collector-extension/';
const pool = 'lib/ozon-pool/';
const mapping = [
  ...['store-scanner-core.js','category-core.js','product-pool-core.js','quick-pricing-core.js','quick-pricing-panel.js'].map(name=>({source:extension+name,target:pool+name})),
  {source:extension+'quick-pricing-panel.css',target:'app/ozon/pool/quick-pricing-panel.css'},
  {source:'web-src/pricing-core.js',target:'lib/ozon/pricing-core.js'},
  {source:'web-src/pricing-core.js',target:pool+'pricing-core.js',wrapper:'OzonQuickPricingMath',suffix:'\n;globalThis.OzonQuickPricingMath=OzonPricingCore;\n'},
  {source:'shared/freight-rules.json',target:'lib/ozon/freight-rules.json'},
];
const normalize = text=>text.replace(/\r\n/g,'\n');
const read = file=>normalize(fs.readFileSync(file,'utf8'));
const hash = text=>createHash('sha256').update(text,'utf8').digest('hex');
function destination(relative) {
  const absolute = path.join(wb,relative);
  const parent = fs.realpathSync(path.dirname(absolute));
  const within = p=>p===wb||(!path.relative(wb,p).startsWith('..')&&!path.isAbsolute(path.relative(wb,p)));
  if(!within(parent)||(fs.existsSync(absolute)&&!within(fs.realpathSync(absolute))))throw new Error(`Unsafe destination: ${relative}`);
  return absolute;
}
const manifest = {schemaVersion:1,source:'Ozon',entries:[]};
const expected = new Map();
for (const {source,target,suffix='',wrapper=null} of mapping) {
  const text=read(path.join(root,source)), output=text+suffix;
  expected.set(target,output);
  manifest.entries.push({source,target,wrapper,sourceSha256:hash(text),sha256:hash(output)});
}
expected.set('lib/ozon/shared-core-lock.json',JSON.stringify(manifest,null,2)+'\n');
expected.set('scripts/check-ozon-shared-core.mjs',read(path.join(root,'tools/check-workbench-shared-lock.mjs')));
const changes=[];
for (const [target,text] of expected) {
  const file=destination(target);
  if (fs.existsSync(file)&&read(file)===text) continue;
  changes.push(target);
  if(!check) fs.writeFileSync(file,text,'utf8');
}
if(check&&changes.length){console.error(`Ozon → Workbench shared core drift:\n${changes.map(x=>`  ${x}`).join('\n')}\nRun the sync command without --check.`);process.exitCode=1;}
else console.log(check?'Workbench shared core --check passed.':`Workbench shared core synced (${changes.length} files updated).`);
