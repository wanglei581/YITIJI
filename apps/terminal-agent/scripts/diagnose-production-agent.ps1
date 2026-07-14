# AI Job Print Terminal — production Agent diagnostics
#
# This script is intentionally read-only. It reports local service/configuration
# status without contacting the API, creating tasks, printing, or exposing secrets.

[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "config\agent-config.json"),

  [string]$ServiceName = "AIJobPrintAgent",

  [string]$ProgramDataDir = (Join-Path $env:ProgramData "AIJobPrintAgent")
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "service-identity.ps1")

$allowedDiagnosticCodes = @(
  "AGENT_CONFIG_NOT_FOUND",
  "AGENT_CONFIG_INVALID_JSON",
  "AGENT_CONFIG_INVALID_SHAPE",
  "AGENT_CONFIG_REQUIRED_FIELD_MISSING",
  "AGENT_CONFIG_INVALID_FIELD",
  "AGENT_TOKEN_DECRYPT_FAILED",
  "AGENT_PROFILE_REJECTED",
  "AGENT_REGISTRATION_FAILED",
  "AGENT_STARTUP_FAILED",
  "AGENT_READY"
)

function Get-Utf8BomState([string]$Path) {
  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite
  )

  try {
    $firstThreeBytes = New-Object byte[] 3
    $bytesRead = $stream.Read($firstThreeBytes, 0, 3)
    return $bytesRead -eq 3 -and
      $firstThreeBytes[0] -eq 0xEF -and
      $firstThreeBytes[1] -eq 0xBB -and
      $firstThreeBytes[2] -eq 0xBF
  } finally {
    $stream.Dispose()
  }
}

function Get-StartupDiagnosticCode([string]$Path) {
  if (-not (Test-Path $Path -PathType Leaf)) {
    return $null
  }

  try {
    $diagnosticText = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
    $diagnostic = $diagnosticText.TrimStart([char]0xFEFF) | ConvertFrom-Json -ErrorAction Stop
    if (
      $diagnostic.schemaVersion -ne 1 -or
      $diagnostic.state -isnot [string] -or
      $diagnostic.state -notin @("ready", "failed") -or
      $diagnostic.code -isnot [string] -or
      [string]::IsNullOrWhiteSpace([string]$diagnostic.code) -or
      $allowedDiagnosticCodes -notcontains $diagnostic.code
    ) {
      return "INVALID_DIAGNOSTIC_FILE"
    }
    return [string]$diagnostic.code
  } catch {
    return "INVALID_DIAGNOSTIC_FILE"
  }
}

$service = $null
$serviceResolution = "not_found"
try {
  $service = Resolve-AgentService -Identity $ServiceName
  if ($null -ne $service) {
    $serviceResolution = "resolved"
  }
} catch {
  if ($_.Exception.Data["agentServiceResolution"] -eq "ambiguous") {
    $serviceResolution = "ambiguous"
  } else {
    $serviceResolution = "unavailable"
  }
}

$serviceExists = $null -ne $service
$serviceAmbiguous = $serviceResolution -eq "ambiguous"
$resolvedServiceName = if ($serviceExists) { [string]$service.Name } else { $null }
$resolvedServiceDisplayName = if ($serviceExists) { [string]$service.DisplayName } else { $null }
$serviceState = if ($serviceExists) { [string]$service.State } else { $null }
$startMode = if ($serviceExists) { [string]$service.StartMode } else { $null }
$processId = if ($serviceExists) { [int]$service.ProcessId } else { $null }

$configExists = Test-Path $ConfigPath -PathType Leaf
$configHasUtf8Bom = $false
$configValidJson = $false
$configFieldStatus = [pscustomobject]@{
  apiBaseUrl = $false
  terminalCode = $false
  terminalId = $false
  printerName = $false
  agentVersion = $false
}

if ($configExists) {
  try {
    $configHasUtf8Bom = Get-Utf8BomState $ConfigPath
    $configText = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.UTF8Encoding]::new($false))
    $config = $configText.TrimStart([char]0xFEFF) | ConvertFrom-Json -ErrorAction Stop
    $configValidJson = $true
    $configFieldStatus = [pscustomobject]@{
      apiBaseUrl = -not [string]::IsNullOrWhiteSpace([string]$config.apiBaseUrl)
      terminalCode = -not [string]::IsNullOrWhiteSpace([string]$config.terminalCode)
      terminalId = -not [string]::IsNullOrWhiteSpace([string]$config.terminalId)
      printerName = -not [string]::IsNullOrWhiteSpace([string]$config.printerName)
      agentVersion = -not [string]::IsNullOrWhiteSpace([string]$config.agentVersion)
    }
  } catch {
    $configValidJson = $false
  }
}

$tokenPath = Join-Path $ProgramDataDir "agent.token"
$encryptedTokenFile = Test-Path -LiteralPath $tokenPath -PathType Leaf
$lastStartupDiagnosticCode = Get-StartupDiagnosticCode (Join-Path $ProgramDataDir "last-startup-diagnostic.json")
$scmFailurePolicy = $null

if ($serviceExists) {
  try {
    $failurePolicyOutput = & sc.exe qfailure $resolvedServiceName 2>&1
    if ($LASTEXITCODE -eq 0) {
      $scmFailurePolicy = ($failurePolicyOutput | Out-String).Trim()
    }
  } catch {
    $scmFailurePolicy = $null
  }
}

[pscustomobject]@{
  serviceExists = $serviceExists
  serviceAmbiguous = $serviceAmbiguous
  serviceResolution = $serviceResolution
  serviceName = $resolvedServiceName
  serviceDisplayName = $resolvedServiceDisplayName
  serviceState = $serviceState
  startMode = $startMode
  processId = $processId
  configExists = $configExists
  configHasUtf8Bom = $configHasUtf8Bom
  configValidJson = $configValidJson
  apiBaseUrl = $configFieldStatus.apiBaseUrl
  terminalCode = $configFieldStatus.terminalCode
  terminalId = $configFieldStatus.terminalId
  printerName = $configFieldStatus.printerName
  agentVersion = $configFieldStatus.agentVersion
  encryptedTokenFile = $encryptedTokenFile
  lastStartupDiagnosticCode = $lastStartupDiagnosticCode
  scmFailurePolicy = $scmFailurePolicy
}
