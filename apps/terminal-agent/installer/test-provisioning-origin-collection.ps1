[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

# Windows PowerShell variables are case-insensitive. The production parameter is
# intentionally kept in this probe so the accumulator must use a distinct name.
[string[]]$LocalApiAllowedOrigins = @("https://zyidai.cn")
$effectiveLocalApiAllowedOrigins = New-Object "System.Collections.Generic.List[string]"

foreach ($origin in @("https://zyidai.cn") + @($LocalApiAllowedOrigins) + @("http://localhost:5173")) {
  if (-not $effectiveLocalApiAllowedOrigins.Contains($origin)) {
    [void]$effectiveLocalApiAllowedOrigins.Add($origin)
  }
}

if ($effectiveLocalApiAllowedOrigins.Count -ne 2) {
  throw "Origin collection merge returned an unexpected count"
}
if (-not $effectiveLocalApiAllowedOrigins.Contains("https://zyidai.cn")) {
  throw "Origin collection merge dropped the production origin"
}
if (-not $effectiveLocalApiAllowedOrigins.Contains("http://localhost:5173")) {
  throw "Origin collection merge dropped the loopback development origin"
}

Write-Host "PROVISIONING_ORIGIN_COLLECTION_PASS distinctAccumulator=true deduplicated=true"
