param([Parameter(Mandatory = $true)][string]$KeyPath)
$ErrorActionPreference = 'Stop'
$encrypted = [IO.File]::ReadAllBytes($KeyPath)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
}
finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
}
