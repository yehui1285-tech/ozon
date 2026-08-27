[CmdletBinding()]
param(
  [string]$InputPath,
  [string]$OutputDirectory,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$script:FormsLoaded = $false

function Initialize-Forms {
  if ($script:FormsLoaded) { return }
  Add-Type -AssemblyName System.Windows.Forms
  $script:FormsLoaded = $true
}

function Show-ToolMessage {
  param(
    [string]$Text,
    [string]$Title,
    [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
  )
  if ($Quiet) { return }
  Initialize-Forms
  [System.Windows.Forms.MessageBox]::Show(
    $Text,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $Icon
  ) | Out-Null
}

try {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $builderPath = Join-Path $projectRoot "sourcing-agent\build-queue.mjs"
  if (-not (Test-Path -LiteralPath $builderPath -PathType Leaf)) {
    throw "找不到转换核心：$builderPath"
  }

  if ([string]::IsNullOrWhiteSpace($InputPath)) {
    Initialize-Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "选择批量店铺扫描导出的 Markdown 文件"
    $dialog.Filter = "Markdown文件 (*.md)|*.md"
    $dialog.Multiselect = $false
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
    $InputPath = $dialog.FileName
  }

  $resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
  if ([System.IO.Path]::GetExtension($resolvedInput) -ne ".md") {
    throw "请选择批量扫描导出的.md文件。"
  }

  if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Split-Path -Parent $resolvedInput) "Ozon_JSON_转换结果"
  }
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  $rawOutput = & $nodeCommand.Source $builderPath --input $resolvedInput --output $resolvedOutput --limit 10 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw (($rawOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
  }

  $result = (($rawOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine) | ConvertFrom-Json
  $allQueue = Get-Content -LiteralPath $result.outputs.allJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $declared = [int]($allQueue.batch.declaredProductCount)
  $parsed = [int]($result.parsed)
  $countWarning = if ($declared -gt 0 -and $declared -ne $parsed) {
    "`n`n注意：MD声明有$declared件，实际成功转换$parsed件，请检查缺失行。"
  } else { "" }

  $message = @"
转换完成，共$parsed件商品。

正式核价：$([System.IO.Path]::GetFileName($result.outputs.allJson))
10件测试：$([System.IO.Path]::GetFileName($result.outputs.sampleJson))
查看表格：$([System.IO.Path]::GetFileName($result.outputs.sampleCsv))

输出目录：$resolvedOutput

提醒：转换工具不会重新检查商品标签，只能使用批量扫描准确导出的“符合要求”MD。$countWarning
"@
  Show-ToolMessage -Text $message -Title "Ozon MD转JSON完成"
  if (-not $Quiet) { Start-Process explorer.exe -ArgumentList $resolvedOutput }
  Write-Output ($result | ConvertTo-Json -Depth 6)
  exit 0
} catch {
  $errorText = "转换失败：$($_.Exception.Message)"
  Show-ToolMessage -Text $errorText -Title "Ozon MD转JSON" -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
  Write-Error $errorText
  exit 1
}
