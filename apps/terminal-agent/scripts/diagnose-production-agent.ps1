# AI Job Print Terminal — production Agent diagnostics
#
# This script is intentionally read-only. It reports local service/configuration
# status without contacting the API, creating tasks, printing, or exposing secrets.

[CmdletBinding()]
param(
  [string]$ConfigPath,

  [string]$LegacyConfigPath,

  [string]$AgentRoot,

  [string]$ServiceName = "AIJobPrintAgent",

  [string]$ProgramDataDir = (Join-Path $env:ProgramData "AIJobPrintAgent")
)

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 does not reliably expose $PSScriptRoot while binding
# parameter defaults. Resolve the repository-relative defaults after startup.
$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($scriptRoot)) {
  throw "Unable to resolve diagnose script directory; run with powershell -File <path-to-diagnose-production-agent.ps1>"
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $ProgramDataDir "agent-config.json"
}
if ([string]::IsNullOrWhiteSpace($AgentRoot)) {
  $AgentRoot = Split-Path -Parent $scriptRoot
}
if ([string]::IsNullOrWhiteSpace($LegacyConfigPath)) {
  $LegacyConfigPath = Join-Path $AgentRoot "config\agent-config.json"
}

. (Join-Path $scriptRoot "service-identity.ps1")

$allowedDiagnosticCodes = @(
  "AGENT_CONFIG_NOT_FOUND",
  "AGENT_CONFIG_INVALID_JSON",
  "AGENT_CONFIG_INVALID_SHAPE",
  "AGENT_CONFIG_REQUIRED_FIELD_MISSING",
  "AGENT_CONFIG_INVALID_FIELD",
  "AGENT_CONFIG_MIGRATION_REQUIRES_REBIND",
  "AGENT_CONFIG_PROGRAM_DATA_ACL_UNSAFE",
  "AGENT_TOKEN_DECRYPT_FAILED",
  "AGENT_PROFILE_REJECTED",
  "AGENT_REGISTRATION_FAILED",
  "AGENT_UNAUTHORIZED",
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

function Get-PathPresenceStatus([string]$Path, [string]$PathType = "Any") {
  try {
    $exists = if ($PathType -eq "Leaf") {
      Test-Path -LiteralPath $Path -PathType Leaf -ErrorAction Stop
    } elseif ($PathType -eq "Container") {
      Test-Path -LiteralPath $Path -PathType Container -ErrorAction Stop
    } else {
      Test-Path -LiteralPath $Path -ErrorAction Stop
    }
    return $(if ($exists) { "present" } else { "missing" })
  } catch {
    return "unavailable"
  }
}

function ConvertTo-SidValue([object]$IdentityReference) {
  if ($IdentityReference -is [System.Security.Principal.SecurityIdentifier]) {
    return [string]$IdentityReference.Value
  }
  $value = [string]$IdentityReference
  if ($value -match '^S-\d-(?:\d+-)+\d+$') { return $value }
  return [string]([System.Security.Principal.NTAccount]$value).Translate(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
}

function Test-TrustedRuntimeOwner([string]$OwnerSid) {
  $known = @(
    "S-1-5-18",
    "S-1-5-32-544",
    "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
  )
  if ($known -contains $OwnerSid) { return $true }

  try {
    $identity = New-Object System.Security.Principal.WindowsIdentity($OwnerSid)
    try {
      $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
      return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    } finally {
      $identity.Dispose()
    }
  } catch {
    return $false
  }
}

function Get-StartupDiagnosticCode([string]$Path) {
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

function Get-ProgramDataAclStatus([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return "unavailable"
  }

  $presence = Get-PathPresenceStatus $Path
  if ($presence -eq "missing") {
    return "missing"
  }
  if ($presence -ne "present") { return "unavailable" }

  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      return "unexpected"
    }

    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
      return "too_permissive"
    }

    $required = @("S-1-5-18", "S-1-5-32-544")
    $forbidden = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")
    $allowSids = New-Object "System.Collections.Generic.HashSet[string]"
    $ownerSid = ConvertTo-SidValue $acl.Owner
    if ($required -notcontains $ownerSid) { return "unexpected" }

    $expectedInheritance = if ($item.PSIsContainer) {
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
      [System.Security.AccessControl.InheritanceFlags]::None
    }

    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
        return "unexpected"
      }

      try {
        $sid = ([System.Security.Principal.NTAccount]$rule.IdentityReference).Translate(
          [System.Security.Principal.SecurityIdentifier]
        ).Value
      } catch {
        if ($rule.IdentityReference -is [System.Security.Principal.SecurityIdentifier]) {
          $sid = [string]$rule.IdentityReference.Value
        } else {
          return "unexpected"
        }
      }

      [void]$allowSids.Add($sid)
      if ($forbidden -contains $sid) {
        return "too_permissive"
      }
      if ($required -notcontains $sid) { return "too_permissive" }
      if ($rule.IsInherited) { return "unexpected" }
      if ($rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
        return "unexpected"
      }
      if ($rule.InheritanceFlags -ne $expectedInheritance) { return "unexpected" }
      if ($rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None) {
        return "unexpected"
      }
    }

    foreach ($sid in $required) {
      if (-not $allowSids.Contains($sid)) {
        return "unexpected"
      }
    }

    foreach ($sid in $allowSids) {
      if ($required -notcontains $sid) {
        return "unexpected"
      }
    }

    return "ok"
  } catch {
    return "unavailable"
  }
}

function Get-RuntimeRootAclStatus([string]$Path) {
  $presence = Get-PathPresenceStatus $Path "Container"
  if ($presence -ne "present") { return $presence }

  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      return "unexpected"
    }
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    $allowedWriteSids = @(
      "S-1-5-18",
      "S-1-5-32-544",
      "S-1-3-0",
      "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
    )
    $writeMask = [System.Security.AccessControl.FileSystemRights]::Write -bor `
      [System.Security.AccessControl.FileSystemRights]::WriteData -bor `
      [System.Security.AccessControl.FileSystemRights]::AppendData -bor `
      [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor `
      [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor `
      [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor `
      [System.Security.AccessControl.FileSystemRights]::Delete -bor `
      [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor `
      [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor `
      [System.Security.AccessControl.FileSystemRights]::GenericWrite -bor `
      [System.Security.AccessControl.FileSystemRights]::GenericAll
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
      $sid = ConvertTo-SidValue $rule.IdentityReference
      $ownerSid = ConvertTo-SidValue $acl.Owner
      $trustedOwner = Test-TrustedRuntimeOwner $ownerSid
      if (
        $allowedWriteSids -notcontains $sid -and
        -not ($trustedOwner -and $sid -eq $ownerSid) -and
        ($rule.FileSystemRights -band $writeMask) -ne 0
      ) {
        return "too_permissive"
      }
    }
    if (-not (Test-TrustedRuntimeOwner (ConvertTo-SidValue $acl.Owner))) { return "unexpected" }
    return "ok"
  } catch {
    return "unavailable"
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
$serviceStartName = if ($serviceExists) { [string]$service.StartName } else { $null }
$serviceIdentityStatus = if (-not $serviceExists) {
  "missing"
} elseif ($serviceStartName -in @("LocalSystem", "NT AUTHORITY\SYSTEM")) {
  "ok"
} else {
  "unexpected"
}

$configuredConfigPath = $ConfigPath
$legacyConfigFilePresenceStatus = Get-PathPresenceStatus $LegacyConfigPath "Leaf"
$configFilePresenceStatus = Get-PathPresenceStatus $configuredConfigPath "Leaf"
$configSource = "program_data"
if ($configFilePresenceStatus -ne "present" -and $legacyConfigFilePresenceStatus -eq "present") {
  $ConfigPath = $LegacyConfigPath
  $configFilePresenceStatus = $legacyConfigFilePresenceStatus
  $configSource = "legacy_pending_migration"
}
$configExists = $configFilePresenceStatus -eq "present"
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
$tokenFilePresenceStatus = Get-PathPresenceStatus $tokenPath "Leaf"
$encryptedTokenFile = $tokenFilePresenceStatus -eq "present"
$startupDiagnosticPath = Join-Path $ProgramDataDir "last-startup-diagnostic.json"
$startupDiagnosticFileStatus = Get-PathPresenceStatus $startupDiagnosticPath "Leaf"
$lastStartupDiagnosticCode = if ($startupDiagnosticFileStatus -eq "present") {
  Get-StartupDiagnosticCode $startupDiagnosticPath
} else {
  $null
}
$programDataAclStatus = Get-ProgramDataAclStatus $ProgramDataDir
$tokenFileAclStatus = if ($tokenFilePresenceStatus -eq "present") {
  Get-ProgramDataAclStatus $tokenPath
} else {
  $tokenFilePresenceStatus
}
$runtimeRootAclStatus = Get-RuntimeRootAclStatus $AgentRoot
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
  serviceStartName = $serviceStartName
  serviceIdentityStatus = $serviceIdentityStatus
  configExists = $configExists
  configPath = $ConfigPath
  configuredProgramDataConfigPath = $configuredConfigPath
  configSource = $configSource
  configFilePresenceStatus = $configFilePresenceStatus
  legacyConfigFilePresenceStatus = $legacyConfigFilePresenceStatus
  configHasUtf8Bom = $configHasUtf8Bom
  configValidJson = $configValidJson
  apiBaseUrl = $configFieldStatus.apiBaseUrl
  terminalCode = $configFieldStatus.terminalCode
  terminalId = $configFieldStatus.terminalId
  printerName = $configFieldStatus.printerName
  agentVersion = $configFieldStatus.agentVersion
  encryptedTokenFile = $encryptedTokenFile
  tokenFilePresenceStatus = $tokenFilePresenceStatus
  lastStartupDiagnosticCode = $lastStartupDiagnosticCode
  startupDiagnosticFileStatus = $startupDiagnosticFileStatus
  programDataAclStatus = $programDataAclStatus
  tokenFileAclStatus = $tokenFileAclStatus
  runtimeRootAclStatus = $runtimeRootAclStatus
  scmFailurePolicy = $scmFailurePolicy
}
