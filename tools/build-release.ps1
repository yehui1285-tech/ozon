$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node tools/sync-freight-rules.mjs
  node tools/build-web.mjs
  & "$PSScriptRoot\verify-project.ps1"

  $extensionZip = Join-Path $root "ozon-erp-collector-extension.zip"
  $extensionFiles = (Get-ChildItem -LiteralPath "ozon-erp-collector-extension" -File).FullName
  Compress-Archive -LiteralPath $extensionFiles -DestinationPath $extensionZip -Force

  $cropZip = Join-Path $root "local-crop-tool.zip"
  Compress-Archive -LiteralPath @(
    "local-crop-tool/index.html",
    "local-crop-tool/README.md",
    "local-crop-tool/start-local-crop-tool.bat"
  ) -DestinationPath $cropZip -Force

  Write-Host "Release artifacts generated: feishu.html, extension zip, crop-tool zip."
} finally {
  Pop-Location
}
