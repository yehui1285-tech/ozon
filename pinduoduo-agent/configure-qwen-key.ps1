$ErrorActionPreference = 'Stop'

$runtimePath = Join-Path $PSScriptRoot 'runtime'
$keyPath = Join-Path $runtimePath 'qwen-api-key.dpapi'
$secureKey = Read-Host '请输入阿里云百炼 API Key（输入内容不会显示）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plainKey)) { throw 'API Key不能为空。' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($plainKey.Trim())
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    [IO.File]::WriteAllBytes($keyPath, $encrypted)
    Write-Host '配置成功：密钥已使用当前Windows账户加密，仅保存在本机。' -ForegroundColor Green
}
finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plainKey = $null
}
