[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$StagingRoot
)

$ErrorActionPreference = "Stop"

$provisionRoot = Join-Path $StagingRoot "provision"
if (-not (Test-Path -LiteralPath $provisionRoot -PathType Container)) {
  throw "Staged provision directory is missing: $provisionRoot"
}

$scripts = @(Get-ChildItem -LiteralPath $provisionRoot -Filter "*.ps1" -File | Sort-Object Name)
if ($scripts.Count -eq 0) {
  throw "No staged Windows PowerShell scripts were found"
}

foreach ($script in $scripts) {
  $bytes = [System.IO.File]::ReadAllBytes($script.FullName)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    throw "Windows PowerShell 5.1 script must be UTF-8 with BOM: $($script.Name)"
  }

  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $script.FullName,
    [ref]$tokens,
    [ref]$parseErrors
  )
  if ($parseErrors.Count -gt 0) {
    $details = ($parseErrors | ForEach-Object {
      "line $($_.Extent.StartLineNumber): $($_.Message)"
    }) -join "; "
    throw "Windows PowerShell 5.1 parse failed for $($script.Name): $details"
  }
}

Write-Host "STAGED_POWERSHELL_OK scripts=$($scripts.Count) encoding=UTF8-BOM parser=WindowsPowerShell"
