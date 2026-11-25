import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ozon-workbench-sync-test-'));
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'tools/sync-workbench-core.mjs'), '--workbench', dest, ...args], { encoding: 'utf8' });
const get = p => fs.readFileSync(path.join(dest, p), 'utf8');
const source = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const compare = (to, from, suffix = '') => assert.equal(get(to).replace(/\r\n/g, '\n'), source(from) + suffix);
try {
  for (const p of ['lib/ozon','lib/ozon-pool','app/ozon/pool','db','scripts']) fs.mkdirSync(path.join(dest,p),{recursive:true});
  fs.writeFileSync(path.join(dest,'package.json'), JSON.stringify({name:'site-creator-vinext-starter'}));
  fs.writeFileSync(path.join(dest,'db/schema.ts'), '// Ozon schema fixture');
  const initial = run('--check');
  assert.notEqual(initial.status, 0, 'check must fail on a missing destination');
  assert.match(initial.stderr, /store-scanner-core\.js/, 'report the actual drifting path');
  const sync = run(); assert.equal(sync.status, 0, sync.stderr);
  compare('lib/ozon-pool/store-scanner-core.js','ozon-erp-collector-extension/store-scanner-core.js');
  compare('lib/ozon-pool/category-core.js','ozon-erp-collector-extension/category-core.js');
  compare('lib/ozon-pool/product-pool-core.js','ozon-erp-collector-extension/product-pool-core.js');
  compare('lib/ozon-pool/quick-pricing-core.js','ozon-erp-collector-extension/quick-pricing-core.js');
  compare('lib/ozon-pool/quick-pricing-panel.js','ozon-erp-collector-extension/quick-pricing-panel.js');
  compare('app/ozon/pool/quick-pricing-panel.css','ozon-erp-collector-extension/quick-pricing-panel.css');
  compare('lib/ozon/pricing-core.js','web-src/pricing-core.js');
  compare('lib/ozon-pool/pricing-core.js','web-src/pricing-core.js','\n;globalThis.OzonQuickPricingMath=OzonPricingCore;\n');
  compare('lib/ozon/freight-rules.json','shared/freight-rules.json');
  assert.equal(run('--check').status,0,'synced files must pass');
  const wbCheck=()=>spawnSync(process.execPath,[path.join(dest,'scripts/check-ozon-shared-core.mjs')],{encoding:'utf8',env:{...process.env,OZON_ROOT:root}});
  assert.equal(wbCheck().status,0,'Workbench build gate validates both lock and source');
  const lock='lib/ozon/shared-core-lock.json'; const manifest=JSON.parse(get(lock));
  assert.equal(manifest.entries.length,9);assert.equal(manifest.schemaVersion,1);
  const target='lib/ozon-pool/category-core.js';
  const old=get(target);fs.writeFileSync(path.join(dest,target),old.replace(/\n/g,'\r\n'));
  assert.equal(run('--check').status,0,'CRLF checkout is equivalent');
  const altered=old+'\n// unapproved local drift\n';fs.writeFileSync(path.join(dest,target),altered);
  const drift=run('--check');assert.notEqual(drift.status,0);assert.match(drift.stderr,/category-core\.js/);
  assert.notEqual(wbCheck().status,0,'the Workbench gate rejects modified generated source');
  assert.equal(get(target),altered,'check must be read-only');assert.equal(run().status,0,'sync repairs only declared destinations');
  assert.equal(run('--check').status,0);
  fs.writeFileSync(path.join(dest,lock),'{}');assert.notEqual(run('--check').status,0,'manifest tampering must be detected');
  assert.equal(run().status,0);assert.equal(run('--check').status,0);
  if(process.env.OZON_WORKBENCH_ROOT){
    const actual=spawnSync(process.execPath,[path.join(root,'tools/sync-workbench-core.mjs'),'--workbench',process.env.OZON_WORKBENCH_ROOT,'--check'],{encoding:'utf8'});
    assert.equal(actual.status,0,actual.stderr);console.log(actual.stdout.trim());
  }
  console.log('Workbench core sync: all nine destinations, thin wrapper, CRLF, non-mutating drift check and lock repair passed.');
} finally { fs.rmSync(dest,{recursive:true,force:true}); }
