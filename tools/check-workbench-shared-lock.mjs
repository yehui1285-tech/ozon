// Copied by Ozon's sync-workbench-core.mjs into Workbench/scripts. This gate
// works on an isolated build machine too, without a second repo checkout.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lockPath=path.join(root,'lib/ozon/shared-core-lock.json');
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const names=['store-scanner-core.js','category-core.js','product-pool-core.js','quick-pricing-core.js','quick-pricing-panel.js'];
const expected=new Map([
  ...names.map(name=>[`lib/ozon-pool/${name}`,{source:`ozon-erp-collector-extension/${name}`,wrapper:null}]),
  ['app/ozon/pool/quick-pricing-panel.css',{source:'ozon-erp-collector-extension/quick-pricing-panel.css',wrapper:null}],
  ['lib/ozon/pricing-core.js',{source:'web-src/pricing-core.js',wrapper:null}],
  ['lib/ozon-pool/pricing-core.js',{source:'web-src/pricing-core.js',wrapper:'OzonQuickPricingMath'}],
  ['lib/ozon/freight-rules.json',{source:'shared/freight-rules.json',wrapper:null}],
]);
const lock=JSON.parse(read(lockPath));
if(lock.schemaVersion!==1||lock.source!=='Ozon'||!Array.isArray(lock.entries)||lock.entries.length!==expected.size)throw Error('Invalid Ozon shared-core lock; synchronize from Ozon.');
const seen=new Set();
for(const entry of lock.entries){
  const declared=expected.get(entry.target);
  if(!declared||seen.has(entry.target)||entry.source!==declared.source||entry.wrapper!==declared.wrapper||!/^[a-f0-9]{64}$/.test(String(entry.sha256))||!/^[a-f0-9]{64}$/.test(String(entry.sourceSha256)))throw Error(`Invalid shared-core entry: ${entry.target}`);
  seen.add(entry.target);
  const text=read(path.join(root,entry.target));
  if(hash(text)!==entry.sha256)throw Error(`Ozon shared-core lock mismatch: ${entry.target}; synchronize from Ozon.`);
  const suffix='\n;globalThis.OzonQuickPricingMath=OzonPricingCore;\n';
  if(entry.wrapper&&(!text.endsWith(suffix)||hash(text.slice(0,-suffix.length))!==entry.sourceSha256))throw Error(`Unexpected pricing wrapper: ${entry.target}`);
  if(!entry.wrapper&&entry.sourceSha256!==entry.sha256)throw Error(`Undeclared adapter: ${entry.target}`);
}
// When the real Ozon repository is present, the lock alone is not enough:
// verify against the current source to detect upstream changes as well.
if(process.env.OZON_ROOT){
  const ozon=path.resolve(process.env.OZON_ROOT);
  const result=spawnSync(process.execPath,[path.join(ozon,'tools/sync-workbench-core.mjs'),'--workbench',root,'--check'],{stdio:'inherit'});
  if(result.status!==0)throw Error('Ozon source checkout comparison failed.');
}
console.log('Ozon shared-core lock check passed (9 destinations).');
