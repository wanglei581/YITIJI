# AI Job Print Terminal — Gate 0k local bridge token field configure
#
# Admin-only. Reads the bridge token from a local file (e.g. scp'd from
# /root/ai-job-print-secrets/kiosk-local-bridge-token), writes
# localApiBridgeToken + merges localApiAllowedOrigins into
# %ProgramData%\AIJobPrintAgent\agent-config.json, never prints the token.
#
# Does not contact the cloud API, rewrite agent.token, or claim/print tasks.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TokenFile,

  [string]$ProgramDataDir = (Join-Path $env:ProgramData "AIJobPrintAgent"),

  [string[]]$AllowedOrigins = @(
    "https://zyidai.cn",
    "http://127.0.0.1:5173",
    "http://localhost:5173"
  ),

  [switch]$RestartService,

  [string]$ServiceName = "AIJobPrintAgent",

  [switch]$WhatIfCheck
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}

function Write-Ok([string]$Message) {
  Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Replace-FileAtomically([string]$SourcePath, [string]$DestinationPath) {
  $directory = Split-Path -Parent $DestinationPath
  $fileName = Split-Path -Leaf $DestinationPath
  $backupPath = Join-Path $directory ".${fileName}.${PID}.$([System.Guid]::NewGuid().ToString('N')).replace-backup.tmp"
  $replaceSucceeded = $false

  try {
    [System.IO.File]::Replace($SourcePath, $DestinationPath, $backupPath)
    $replaceSucceeded = $true
  } finally {
    if ($replaceSucceeded -and (Test-Path -LiteralPath $backupPath)) {
      Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Write-TextAtomically([string]$Path, [string]$Text) {
  $directory = Split-Path -Parent $Path
  $fileName = Split-Path -Leaf $Path
  $tempPath = Join-Path $directory ".${fileName}.${PID}.$([System.Guid]::NewGuid().ToString('N')).tmp"
  $encoding = [System.Text.UTF8Encoding]::new($false)

  try {
    $bytes = $encoding.GetBytes($Text)
    $stream = [System.IO.FileStream]::new(
      $tempPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::None
    )
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }

    if ([System.IO.File]::Exists($Path)) {
      Replace-FileAtomically -SourcePath $tempPath -DestinationPath $Path
    } else {
      [System.IO.File]::Move($tempPath, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $tempPath) {
      Remove-Item -LiteralPath $tempPath -Force
    }
  }
}

function Read-BridgeToken([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    Fail "TokenFile is required"
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    Fail "TokenFile not found: $Path"
  }

  $raw = [System.IO.File]::ReadAllText($Path).Trim()
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Fail "TokenFile is empty"
  }
  if ($raw.Length -lt 32) {
    Fail "TokenFile token is too short (need >= 32 chars after trim)"
  }
  if ($raw -match "[\r\n]") {
    Fail "TokenFile must contain a single-line token"
  }
  return $raw
}

function Merge-AllowedOrigins([object]$Existing, [string[]]$Required) {
  $set = New-Object "System.Collections.Generic.List[string]"
  if ($Existing -is [System.Collections.IEnumerable] -and -not ($Existing -is [string])) {
    foreach ($item in $Existing) {
      $value = [string]$item
      if (-not [string]::IsNullOrWhiteSpace($value) -and -not $set.Contains($value.Trim())) {
        $set.Add($value.Trim()) | Out-Null
      }
    }
  }
  foreach ($origin in $Required) {
    if (-not [string]::IsNullOrWhiteSpace($origin) -and -not $set.Contains($origin.Trim())) {
      $set.Add($origin.Trim()) | Out-Null
    }
  }
  return , @($set.ToArray())
}

$configPath = Join-Path $ProgramDataDir "agent-config.json"
Write-Step "Gate 0k local bridge token configure"
Write-Host "ConfigPath: $configPath"
Write-Host "TokenFile:  $TokenFile"
Write-Host "Restart:    $RestartService"
Write-Host "WhatIf:     $WhatIfCheck"

if (-not (Test-Path -LiteralPath $configPath)) {
  Fail "agent-config.json missing at $configPath (install/bind Agent first)"
}

$token = Read-BridgeToken -Path $TokenFile

$configText = [System.IO.File]::ReadAllText($configPath)
try {
  $config = $configText | ConvertFrom-Json
} catch {
  Fail "agent-config.json is not valid JSON"
}

$existingToken = [string]$config.localApiBridgeToken
$existingOrigins = @()
if ($null -ne $config.localApiAllowedOrigins) {
  $existingOrigins = @($config.localApiAllowedOrigins)
}

$hasZyidai = $false
foreach ($o in $existingOrigins) {
  if ([string]$o -eq "https://zyidai.cn") { $hasZyidai = $true }
}

$tokenConfigured = -not [string]::IsNullOrWhiteSpace($existingToken)
$tokenMatches = $tokenConfigured -and ($existingToken.Trim() -eq $token)

Write-Host ("localApiBridgeToken present: {0}" -f ($(if ($tokenConfigured) { "yes" } else { "no" })))
Write-Host ("localApiBridgeToken matches TokenFile: {0}" -f ($(if ($tokenMatches) { "yes" } else { "no" })))
Write-Host ("allowedOrigins contains https://zyidai.cn: {0}" -f ($(if ($hasZyidai) { "yes" } else { "no" })))
Write-Host ("allowedOrigins count: {0}" -f $existingOrigins.Count)

if ($WhatIfCheck) {
  if ($tokenMatches -and $hasZyidai) {
    Write-Ok "WhatIfCheck: bridge token + zyidai.cn origin already configured"
    exit 0
  }
  Fail "WhatIfCheck: configuration incomplete (see flags above; token value never printed)"
}

$mergedOrigins = Merge-AllowedOrigins -Existing $existingOrigins -Required $AllowedOrigins
$config | Add-Member -NotePropertyName localApiBridgeToken -NotePropertyValue $token -Force
$config | Add-Member -NotePropertyName localApiAllowedOrigins -NotePropertyValue $mergedOrigins -Force

# Prefer compact JSON without changing unrelated field semantics.
$newJson = $config | ConvertTo-Json -Depth 8
Write-TextAtomically -Path $configPath -Text ($newJson + "`n")
Write-Ok "Wrote localApiBridgeToken + localApiAllowedOrigins (token not printed)"

# Re-read for confirmation without echoing token
$verify = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$verifyTokenOk = -not [string]::IsNullOrWhiteSpace([string]$verify.localApiBridgeToken) -and `
  ([string]$verify.localApiBridgeToken).Trim() -eq $token
$verifyOriginOk = $false
foreach ($o in @($verify.localApiAllowedOrigins)) {
  if ([string]$o -eq "https://zyidai.cn") { $verifyOriginOk = $true }
}
if (-not $verifyTokenOk) {
  Fail "Post-write verification failed: token not persisted"
}
if (-not $verifyOriginOk) {
  Fail "Post-write verification failed: https://zyidai.cn missing from allowedOrigins"
}
Write-Ok "Post-write verification passed (presence + origin only)"

if ($RestartService) {
  Write-Step "Restarting service $ServiceName"
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) {
    Fail "Service not found: $ServiceName"
  }
  Restart-Service -Name $ServiceName -Force
  Start-Sleep -Seconds 3
  $svc = Get-Service -Name $ServiceName
  Write-Host ("Service Status={0} StartType={1}" -f $svc.Status, $svc.StartType)
  if ($svc.Status -ne "Running") {
    Fail "Service is not Running after restart"
  }
  Write-Ok "Service restarted"
  Write-Host "Expect local bridge on 127.0.0.1:9527 and no 'localApiBridgeToken not configured' spam."
}

Write-Step "Done"
Write-Ok "Next: open https://zyidai.cn/print/upload on this kiosk, insert USB, enumerate + upload one file"
Write-Host "Do not paste the bridge token into chat, Git, or screenshots."
