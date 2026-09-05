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

$kioskRoot = Join-Path $StagingRoot "kiosk"
if (-not (Test-Path -LiteralPath $kioskRoot -PathType Container)) {
  throw "Staged kiosk directory is missing: $kioskRoot"
}

$scripts = @(Get-ChildItem -LiteralPath $provisionRoot -Filter "*.ps1" -File | Sort-Object Name) +
  @(Get-ChildItem -LiteralPath $kioskRoot -Filter "*.ps1" -File | Sort-Object Name)
if ($scripts.Count -eq 0) {
  throw "No staged Windows PowerShell scripts were found"
}
foreach ($required in @("kiosk-watchdog.ps1", "register-kiosk-watchdog.ps1")) {
  if (-not (Test-Path -LiteralPath (Join-Path $kioskRoot $required) -PathType Leaf)) {
    throw "Staged kiosk script is missing: $required"
  }
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

$originUtilities = Join-Path $provisionRoot "provisioning-origin-utils.ps1"
. $originUtilities
$mergedOrigins = @(Merge-LocalApiAllowedOrigins `
  -Origins @(
    "https://zyidai.cn",
    "https://zyidai.cn",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ) `
  -CanonicalizeOrigin { param($originCandidate) ([System.Uri]$originCandidate).GetLeftPart([System.UriPartial]::Authority) })
$expectedOrigins = @("https://zyidai.cn", "http://localhost:5173", "http://127.0.0.1:5173")
if ($mergedOrigins.Count -ne $expectedOrigins.Count) {
  throw "Origin merge returned $($mergedOrigins.Count) entries; expected $($expectedOrigins.Count)"
}
for ($index = 0; $index -lt $expectedOrigins.Count; $index++) {
  if ($mergedOrigins[$index] -ne $expectedOrigins[$index]) {
    throw "Origin merge mismatch at index ${index}: $($mergedOrigins[$index])"
  }
}

$runtimeSecurity = Join-Path $provisionRoot "provisioning-runtime-security.ps1"
. $runtimeSecurity
if (Test-WriteLikeFileSystemRights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)) {
  throw "ReadAndExecute must not be classified as write-like access"
}
if (-not (Test-WriteLikeFileSystemRights ([System.Security.AccessControl.FileSystemRights]::Modify))) {
  throw "Modify must be classified as write-like access"
}
if (-not (Test-WriteLikeFileSystemRights ([System.Security.AccessControl.FileSystemRights]::WriteData))) {
  throw "WriteData must be classified as write-like access"
}
$inheritOnlyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  (New-Object System.Security.Principal.SecurityIdentifier("S-1-3-0")),
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
  [System.Security.AccessControl.PropagationFlags]::InheritOnly,
  [System.Security.AccessControl.AccessControlType]::Allow
)
if (Test-FileSystemAccessRuleAppliesToItem $inheritOnlyRule) {
  throw "InheritOnly access rules must not be treated as effective on the current item"
}
$effectiveRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-545")),
  [System.Security.AccessControl.FileSystemRights]::WriteData,
  [System.Security.AccessControl.AccessControlType]::Allow
)
if (-not (Test-FileSystemAccessRuleAppliesToItem $effectiveRule)) {
  throw "Effective access rules must be evaluated on the current item"
}
if (-not (Test-IsPrivilegedRuntimeSid "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")) {
  throw "The exact TrustedInstaller service SID must be treated as privileged"
}
if (Test-IsPrivilegedRuntimeSid "S-1-5-32-545") {
  throw "BUILTIN Users must not be treated as privileged"
}

Write-Host "STAGED_POWERSHELL_OK scripts=$($scripts.Count) encoding=UTF8-BOM parser=WindowsPowerShell originMerge=executed aclRights=positive-negative-inherit-only-trustedinstaller"
