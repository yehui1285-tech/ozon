$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node tools/sync-freight-rules.mjs --check
  node tools/build-web.mjs --check
  node tools/test-freight-rules.mjs
  node tools/test-commission-rules.mjs
  node tools/test-black-price.mjs
  node tools/test-store-scanner.mjs
  node tools/test-store-background-integration.mjs
  node tools/test-pricing-core.mjs
  node tools/test-worker-security.mjs
  node tools/test-parsing-fixtures.mjs
  node --check ozon-erp-collector-extension/background.js
  node --check ozon-erp-collector-extension/black-price-core.js
  node --check ozon-erp-collector-extension/content.js
  node --check ozon-erp-collector-extension/store-scanner-core.js
  node --check ozon-erp-collector-extension/store-scanner.js
  node --check ozon-erp-collector-extension/batch.js
  node --check ozon-erp-collector-extension/popup.js
  node --check ozon-feishu-sync/worker/worker.js
  node -e "const fs=require('fs');for(const f of ['feishu.html','local-crop-tool/index.html']){const h=fs.readFileSync(f,'utf8');for(const m of h.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)){if(m[1].trim())new Function(m[1])}}"

  $pageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath "feishu.html").Hash
  $siteHash = (Get-FileHash -Algorithm SHA256 -LiteralPath "ozon-feishu-sync/site/index.html").Hash
  if ($pageHash -ne $siteHash) { throw "feishu.html and site/index.html differ" }

  $manifest = Get-Content -LiteralPath "ozon-erp-collector-extension/manifest.json" -Raw | ConvertFrom-Json
  if (-not $manifest.version) { throw "Extension manifest has no version" }

  $backupCount = @(Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -like "_备份_*" }).Count
  if ($backupCount -gt 5) { throw "Regular backup count exceeds 5: $backupCount" }

  Write-Host "Project checks passed: pages, freight rules, syntax, extension version, backup count."
} finally {
  Pop-Location
}
