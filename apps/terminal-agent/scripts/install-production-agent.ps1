# AI Job Print Terminal — production Agent installer / hardener
#
# Purpose:
#   Pin the Windows Terminal Agent to the commercial production API, protect the
#   terminal token with DPAPI, install/start the Windows service, and verify the
#   remote heartbeat. This script intentionally uses a single cloud task source
#   to avoid local/remote print-task conflicts.
#
# Usage examples:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-production-agent.ps1 `
#     -ApiBaseUrl "https://api.example.com/api/v1" `
#     -TerminalCode "KSK-001" `
#     -TerminalId "t_ksk_001" `
#     -AgentToken "<terminal-token>" `
#     -PrinterName "Pantum CM2800ADN Series"
#
#   # Preferred commercial flow: use an admin-generated one-time bind code.
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-production-agent.ps1 `
#     -ApiBaseUrl "https://api.example.com/api/v1" `
#     -TerminalCode "KSK-001" `
#     -TerminalId "t_ksk_001" `
#     -BindCode "ABCD1234EFGH5678" `
#     -PrinterName "Pantum CM2800ADN Series"
#
#   # If the token was already stored in %ProgramData%\AIJobPrintAgent\agent.token:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-production-agent.ps1 `
#     -ApiBaseUrl "https://api.example.com/api/v1" `
#     -TerminalCode "KSK-001" `
#     -TerminalId "t_ksk_001" `
#     -PrinterName "Pantum CM2800ADN Series" `
#     -UseExistingToken

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ApiBaseUrl,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$TerminalCode,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$TerminalId,

  [Parameter(Mandatory = $false)]
  [string]$AgentToken,

  [Parameter(Mandatory = $false)]
  [string]$BindCode,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$PrinterName,

  [Parameter(Mandatory = $false)]
  [int]$ClaimIntervalMs = 1000,

  [Parameter(Mandatory = $false)]
  [int]$HeartbeatIntervalMs = 30000,

  [Parameter(Mandatory = $false)]
  [string]$AgentVersion = "0.3.0-production",

  [Parameter(Mandatory = $false)]
  [switch]$UseExistingToken,

  [Parameter(Mandatory = $false)]
  [switch]$SkipServiceInstall,

  [Parameter(Mandatory = $false)]
  [switch]$SkipHeartbeatVerify
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Test-GeneratedConfig([System.Collections.IDictionary]$Config) {
  try {
    $configJson = $Config | ConvertTo-Json -Depth 8
    $parsedConfig = $configJson | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Fail "Generated config could not be serialized and parsed as JSON: $($_.Exception.Message)"
  }

  foreach ($field in @("apiBaseUrl", "terminalCode", "terminalId", "printerName", "agentVersion")) {
    if ([string]::IsNullOrWhiteSpace([string]$parsedConfig.$field)) {
      Fail "Generated config requires a non-empty $field"
    }
  }

  foreach ($field in @("heartbeatIntervalMs", "claimIntervalMs", "localApiPort")) {
    $rawValue = $parsedConfig.$field
    if ($null -eq $rawValue -or $rawValue -is [string] -or $rawValue -is [bool]) {
      Fail "Generated config requires $field to be a positive integer"
    }

    try {
      $decimalValue = [decimal]$rawValue
      $integerValue = [int64]$rawValue
    } catch {
      Fail "Generated config requires $field to be a positive integer"
    }

    if ($integerValue -le 0 -or $decimalValue -ne [decimal]$integerValue) {
      Fail "Generated config requires $field to be a positive integer"
    }
  }

  return $configJson
}

function Invoke-Sc([string[]]$Arguments) {
  try {
    $output = & sc.exe @Arguments 2>&1
  } catch {
    Fail "sc.exe $($Arguments -join ' ') failed to start: $($_.Exception.Message)"
  }

  if ($LASTEXITCODE -ne 0) {
    $detail = ($output | Out-String).Trim()
    Fail "sc.exe $($Arguments -join ' ') failed with exit code $LASTEXITCODE: $detail"
  }

  return ($output | Out-String).Trim()
}

function Set-AgentServiceRecovery([string]$ServiceName) {
  Write-Step "Configuring Windows service recovery"
  Invoke-Sc @("failure", $ServiceName, "reset=", "86400", "actions=", 'restart/60000/restart/300000/""/0') | Out-Null
  Invoke-Sc @("failureflag", $ServiceName, "1") | Out-Null
  $policy = Invoke-Sc @("qfailure", $ServiceName)
  Write-Host "SCM failure policy for $ServiceName:"
  Write-Host $policy
}

function Resolve-RepoRoot {
  $scriptDir = Split-Path -Parent $PSCommandPath
  # apps/terminal-agent/scripts -> repo root
  return (Resolve-Path (Join-Path $scriptDir "..\..\..")).Path
}

function ConvertTo-CanonicalApiBaseUrl([string]$Value) {
  $trimmed = $Value.Trim().TrimEnd("/")
  if (-not ($trimmed -match "^https?://")) {
    Fail "ApiBaseUrl must start with http:// or https://"
  }
  if (-not ($trimmed.EndsWith("/api/v1"))) {
    Fail "ApiBaseUrl must include /api/v1, e.g. https://api.example.com/api/v1"
  }
  return $trimmed
}

function Protect-AgentToken([string]$Token, [string]$TokenPath) {
  if ([string]::IsNullOrWhiteSpace($Token)) {
    Fail "AgentToken is required unless -UseExistingToken is passed. Do not use adminSecret on Windows hosts."
  }
  Add-Type -AssemblyName System.Security
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Token.Trim())
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $b64 = [Convert]::ToBase64String($encrypted)
  $dir = Split-Path -Parent $TokenPath
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  [System.IO.File]::WriteAllText($TokenPath, $b64, [System.Text.UTF8Encoding]::new($false))
}

function Test-TokenFile([string]$TokenPath) {
  if (-not (Test-Path $TokenPath)) { return $false }
  $content = [System.IO.File]::ReadAllText($TokenPath).Trim()
  return -not [string]::IsNullOrWhiteSpace($content)
}

function Get-PrimaryMacAddress {
  try {
    $adapter = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" |
      Where-Object { $_.MACAddress } |
      Select-Object -First 1
    return $adapter.MACAddress
  } catch {
    return $null
  }
}

function New-DeviceFingerprint {
  $hostName = [System.Net.Dns]::GetHostName()
  $mac = Get-PrimaryMacAddress
  $raw = "$hostName`:$mac"
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
  $hash = $sha.ComputeHash($bytes)
  return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Exchange-BindCode([string]$ApiBase, [string]$Code) {
  if ([string]::IsNullOrWhiteSpace($Code)) { Fail "BindCode is empty" }
  $body = @{
    bindCode          = $Code.Trim()
    deviceFingerprint = New-DeviceFingerprint
    displayName       = [System.Net.Dns]::GetHostName()
    macAddress        = Get-PrimaryMacAddress
    agentVersion      = $AgentVersion
  } | ConvertTo-Json -Depth 5
  try {
    return Invoke-RestMethod -Uri "$ApiBase/auth/terminal/exchange-bind-code" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
  } catch {
    $detail = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    Fail "BindCode exchange failed: $detail"
  }
}

$repoRoot = Resolve-RepoRoot
$agentRoot = Join-Path $repoRoot "apps\terminal-agent"
$configPath = Join-Path $agentRoot "config\agent-config.json"
$programDataDir = Join-Path $env:ProgramData "AIJobPrintAgent"
$tokenPath = Join-Path $programDataDir "agent.token"
$apiBase = ConvertTo-CanonicalApiBaseUrl $ApiBaseUrl

Write-Step "Production Agent hardening"
Write-Host "Repo root    : $repoRoot"
Write-Host "Agent root   : $agentRoot"
Write-Host "API base     : $apiBase"
Write-Host "Terminal     : $TerminalCode / $TerminalId"
Write-Host "Printer      : $PrinterName"

if ($apiBase -match "localhost|127\.0\.0\.1") {
  Fail "Production Agent cannot point to localhost. Use local-debug profile instead."
}

Write-Step "Checking prerequisites"
if (-not (Test-Path $agentRoot)) { Fail "Agent root not found: $agentRoot" }
if (-not (Test-Path (Join-Path $agentRoot "dist\index.js"))) {
  Fail "Compiled Agent not found: apps/terminal-agent/dist/index.js. Run pnpm --filter ./apps/terminal-agent build first."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "node.exe not found in PATH" }
Write-Ok "Node found: $($node.Source)"

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
  $available = Get-Printer | Select-Object -ExpandProperty Name
  Write-Host "Available printers:" -ForegroundColor Yellow
  $available | ForEach-Object { Write-Host "  - $_" }
  Fail "Printer not found: $PrinterName"
}
Write-Ok "Printer found: $($printer.Name) on $($printer.PortName)"

$config = [ordered]@{
  apiBaseUrl             = $apiBase
  terminalId             = $TerminalId.Trim()
  terminalCode           = $TerminalCode.Trim()
  printerName            = $PrinterName.Trim()
  agentVersion           = $AgentVersion.Trim()
  heartbeatIntervalMs    = $HeartbeatIntervalMs
  claimIntervalMs        = $ClaimIntervalMs
  localApiPort           = 9527
  localApiAllowedOrigins = @(
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  )
}

$configJson = Test-GeneratedConfig -Config $config

Write-Step "Writing production config"
if (Test-Path $configPath) {
  $backup = "$configPath.before-production-hardening-$(Get-Date -Format 'yyyyMMddHHmmss')"
  Copy-Item $configPath $backup -Force
  Write-Ok "Config backup: $backup"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $configPath) -Force | Out-Null
[System.IO.File]::WriteAllText($configPath, $configJson + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Ok "Production config written: $configPath"

Write-Step "Installing token"
if (-not [string]::IsNullOrWhiteSpace($BindCode)) {
  Write-Ok "Exchanging one-time bind code with cloud API"
  $exchange = Exchange-BindCode -ApiBase $apiBase -Code $BindCode
  if ($exchange.terminalId -and $exchange.terminalId -ne $TerminalId) {
    Fail "BindCode belongs to terminalId=$($exchange.terminalId), but script was called with TerminalId=$TerminalId"
  }
  if ($exchange.terminalCode -and $exchange.terminalCode -ne $TerminalCode) {
    Fail "BindCode belongs to terminalCode=$($exchange.terminalCode), but script was called with TerminalCode=$TerminalCode"
  }
  Protect-AgentToken -Token $exchange.terminalToken -TokenPath $tokenPath
  Write-Ok "BindCode exchanged and token protected with DPAPI"
} elseif ($UseExistingToken) {
  if (-not (Test-TokenFile $tokenPath)) { Fail "-UseExistingToken passed, but token file is missing or empty: $tokenPath" }
  Write-Ok "Using existing DPAPI token: $tokenPath"
} else {
  Protect-AgentToken -Token $AgentToken -TokenPath $tokenPath
  Write-Ok "Agent token protected with DPAPI LocalMachine: $tokenPath"
}

Write-Step "Stopping old Agent processes"
$agentProcesses = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
  $_.CommandLine -like '*terminal-agent*index.js agent*' -or
  $_.CommandLine -like '*node-windows*wrapper.js*AIJobPrintAgent*'
}
foreach ($p in $agentProcesses) {
  Write-WarnLine "Stopping stale Agent process PID=$($p.ProcessId)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not $SkipServiceInstall) {
  Write-Step "Installing/starting Windows service"
  Push-Location $agentRoot
  try {
    $service = Get-Service -Name "AIJobPrintAgent" -ErrorAction SilentlyContinue
    if (-not $service) {
      & node "dist\index.js" install-service
      Start-Sleep -Seconds 3
    } else {
      Write-Ok "Service already exists: AIJobPrintAgent"
    }

    $service = Get-Service -Name "AIJobPrintAgent" -ErrorAction SilentlyContinue
    if ($service) {
      Set-Service -Name "AIJobPrintAgent" -StartupType Automatic
      Set-AgentServiceRecovery "AIJobPrintAgent"
      if ($service.Status -ne "Running") {
        Start-Service -Name "AIJobPrintAgent"
      } else {
        Restart-Service -Name "AIJobPrintAgent" -Force
      }
      Write-Ok "Service running with Automatic startup"
    } else {
      Fail "AIJobPrintAgent service was not created"
    }
  } finally {
    Pop-Location
  }
} else {
  Write-WarnLine "Skipping service install/start by request"
}

if (-not $SkipHeartbeatVerify) {
  Write-Step "Verifying remote heartbeat"
  Start-Sleep -Seconds 8
  $statusUrl = "$apiBase/terminals/$TerminalId/printer-status"
  try {
    $status = Invoke-RestMethod -Uri $statusUrl -Method Get -TimeoutSec 15
    $status | ConvertTo-Json -Depth 6
    if ($status.isOnline -ne $true) {
      Fail "Remote terminal is not online yet. Check Agent logs under $programDataDir\logs."
    }
    Write-Ok "Remote terminal is online"
  } catch {
    Fail "Heartbeat verification failed: $($_.Exception.Message)"
  }
}

Write-Step "Done"
Write-Ok "Production Agent is pinned to $apiBase and terminal $TerminalId."
Write-Host "Next: submit a print task from the cloud/Kiosk that points to this same API and terminal."
