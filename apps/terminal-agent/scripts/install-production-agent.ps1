# AI Job Print Terminal — production Agent installer / hardener
#
# Purpose:
#   Pin the Windows Terminal Agent to the commercial production API, protect the
#   terminal token with DPAPI, install/start the Windows service, and verify the
#   remote heartbeat. This script intentionally uses a single cloud task source
#   to avoid local/remote print-task conflicts.
#
# Usage examples:
#   # Preferred commercial flow: use an admin-generated one-time bind code.
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-production-agent.ps1 `
#     -ApiBaseUrl "https://api.example.com/api/v1" `
#     -TerminalCode "KSK-001" `
#     -TerminalId "t_ksk_001" `
#     -PromptForBindCode `
#     -PrinterName "<exact Get-Printer name>" `
#     -LocalApiAllowedOrigins "https://kiosk.example.com" `
#     -ScanWatchFolder "C:\AIJobPrint\scan-inbox"
#
#   # Replace previously preserved cross-origin Kiosk entries. Passing the
#   # switch with no -LocalApiAllowedOrigins removes all historical extra
#   # origins while retaining the API origin and loopback development origins.
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-production-agent.ps1 `
#     -ApiBaseUrl "https://api.example.com/api/v1" `
#     -TerminalCode "KSK-001" `
#     -TerminalId "t_ksk_001" `
#     -PrinterName "<exact Get-Printer name>" `
#     -UseExistingToken `
#     -ReplaceLocalApiAllowedOrigins `
#     -LocalApiAllowedOrigins "https://new-kiosk.example.com"
#
#   # If the token was already stored in %ProgramData%\AIJobPrintAgent\agent.token:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-production-agent.ps1 `
#     -ApiBaseUrl "https://api.example.com/api/v1" `
#     -TerminalCode "KSK-001" `
#     -TerminalId "t_ksk_001" `
#     -PrinterName "<exact Get-Printer name>" `
#     -UseExistingToken
#
# Gate 0.4: long-lived -AgentToken CLI input is intentionally removed. Tokens must
# arrive via BindCode exchange or an existing DPAPI file (not process argv/history).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ApiBaseUrl,

  [Parameter(Mandatory = $false)]
  [string]$TerminalCode,

  [Parameter(Mandatory = $false)]
  [string]$TerminalId,

  [Parameter(Mandatory = $false)]
  [string]$BindCode,

  [Parameter(Mandatory = $false)]
  [switch]$PromptForBindCode,

  [Parameter(Mandatory = $false)]
  [System.Security.SecureString]$BindCodeSecure,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$PrinterName,

  [Parameter(Mandatory = $false)]
  [int]$ClaimIntervalMs = 1000,

  [Parameter(Mandatory = $false)]
  [int]$HeartbeatIntervalMs = 30000,

  [Parameter(Mandatory = $false)]
  [string]$AgentVersion = "0.3.1-production",

  [Parameter(Mandatory = $false)]
  [string]$ScanWatchFolder,

  [Parameter(Mandatory = $false)]
  [Alias("KioskOrigins")]
  [string[]]$LocalApiAllowedOrigins,

  [Parameter(Mandatory = $false)]
  [Alias("ReplaceKioskOrigins")]
  [switch]$ReplaceLocalApiAllowedOrigins,

  [Parameter(Mandatory = $false)]
  [ValidateRange(1, 65535)]
  [int]$LocalApiPort = 9527,

  [Parameter(Mandatory = $false)]
  [switch]$PromptForLocalApiBridgeToken,

  [Parameter(Mandatory = $false)]
  [System.Security.SecureString]$LocalApiBridgeTokenSecure,

  [Parameter(Mandatory = $false)]
  [switch]$UseExistingToken,

  [Parameter(Mandatory = $false)]
  [switch]$SkipServiceInstall,

  [Parameter(Mandatory = $false)]
  [switch]$SkipHeartbeatVerify
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "service-identity.ps1")

$agentServiceIdentity = "AIJobPrintAgent"

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
  throw $Message
}

function ConvertFrom-SecureStringToPlainText([System.Security.SecureString]$Value) {
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
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
      # Replacement is durable at this point. A locked backup is evidence, not a commit failure.
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

function Invoke-Sc([string[]]$Arguments) {
  try {
    $output = & sc.exe @Arguments 2>&1
  } catch {
    Fail "sc.exe $($Arguments -join ' ') failed to start: $($_.Exception.Message)"
  }

  if ($LASTEXITCODE -ne 0) {
    $detail = ($output | Out-String).Trim()
    Fail "sc.exe $($Arguments -join ' ') failed with exit code ${LASTEXITCODE}: $detail"
  }

  return ($output | Out-String).Trim()
}

function Set-AgentServiceRecovery([string]$ServiceName) {
  Write-Step "Configuring Windows service recovery"
  Invoke-Sc @("failure", $ServiceName, "reset=", "86400", "actions=", 'restart/60000/restart/300000/""/0') | Out-Null
  Invoke-Sc @("failureflag", $ServiceName, "1") | Out-Null
  $policy = Invoke-Sc @("qfailure", $ServiceName)
  Write-Host "SCM failure policy for ${ServiceName}:"
  Write-Host $policy
}

function Stop-ExistingAgentRuntime([string]$Reason) {
  $service = Resolve-AgentService -Identity $agentServiceIdentity
  if ($null -ne $service -and $service.State -ne "Stopped") {
    Write-WarnLine "Stopping the existing Agent service $Reason"
    Stop-Service -Name ([string]$service.Name) -Force -ErrorAction Stop
  }

  $agentProcesses = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -like '*terminal-agent*index.js agent*' -or
    $_.CommandLine -like '*AIJobPrintAgent*app*dist*index.js*agent*' -or
    $_.CommandLine -like '*node-windows*wrapper.js*AIJobPrintAgent*'
  }
  foreach ($process in $agentProcesses) {
    Write-WarnLine "Stopping stale Agent process PID=$($process.ProcessId) $Reason"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Resolve-AgentRuntimeLayout {
  $scriptParent = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $installedAppRoot = Join-Path $scriptParent "app"
  $installedNode = Join-Path $scriptParent "node\node.exe"
  if (
    (Test-Path -LiteralPath (Join-Path $installedAppRoot "dist\index.js") -PathType Leaf) -and
    (Test-Path -LiteralPath $installedNode -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $scriptParent "bootstrap\aijobprintagent.exe") -PathType Leaf)
  ) {
    return [pscustomobject]@{
      Mode = "installed"
      RuntimeRoot = $scriptParent
      AppRoot = $installedAppRoot
      NodeExecutable = $installedNode
    }
  }

  if (Test-Path -LiteralPath (Join-Path $scriptParent "dist\index.js") -PathType Leaf) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
      Fail "node.exe not found in PATH"
    }
    return [pscustomobject]@{
      Mode = "source"
      RuntimeRoot = $scriptParent
      AppRoot = $scriptParent
      NodeExecutable = $nodeCommand.Source
    }
  }

  Fail "Agent runtime layout is not recognized. Run the installed Start menu provisioner or use the script from apps\terminal-agent\scripts."
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

function ConvertTo-CanonicalOrigin([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Fail "Local API allowed origin cannot be empty"
  }
  $trimmed = $Value.Trim().TrimEnd("/")
  try {
    $uri = [System.Uri]$trimmed
  } catch {
    Fail "Local API allowed origin is not an absolute URL: $Value"
  }
  if (-not $uri.IsAbsoluteUri -or @("http", "https") -notcontains $uri.Scheme -or -not [string]::IsNullOrEmpty($uri.UserInfo)) {
    Fail "Local API allowed origin must use http/https and must not contain user info"
  }
  $origin = $uri.GetLeftPart([System.UriPartial]::Authority)
  if ($trimmed -ne $origin) {
    Fail "Local API allowed origin must contain only scheme, host, and optional port: $Value"
  }
  return $origin
}

function Get-PreservedLocalSettings(
  [string]$ConfigPath,
  [string]$ProgramDataDir,
  [bool]$SkipOrigins = $false
) {
  $preserved = [ordered]@{}
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return $preserved }

  try {
    Assert-ProgramDataAcl -Path $ProgramDataDir -IsContainer $true
    Assert-ProgramDataAcl -Path $ConfigPath -IsContainer $false
    $existing = Get-Content -Raw -LiteralPath $ConfigPath -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Fail "Existing Agent config is not protected or valid JSON; refusing to overwrite local settings: $($_.Exception.Message)"
  }

  foreach ($field in @("scanWatchFolder", "localApiBridgeToken")) {
    $property = $existing.PSObject.Properties[$field]
    if ($null -eq $property) { continue }
    if ($property.Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
      Fail "Existing Agent config has an invalid $field; refusing to discard or rewrite it"
    }
    $preserved[$field] = [string]$property.Value
  }
  $portProperty = $existing.PSObject.Properties["localApiPort"]
  if ($null -ne $portProperty) {
    if ($portProperty.Value -is [string] -or $portProperty.Value -is [bool]) {
      Fail "Existing Agent config has an invalid localApiPort; refusing to discard or rewrite it"
    }
    try {
      $portDecimal = [decimal]$portProperty.Value
      $port = [int]$portProperty.Value
    } catch {
      Fail "Existing Agent config has an invalid localApiPort; refusing to discard or rewrite it"
    }
    if ($portDecimal -ne [decimal]$port -or $port -lt 1 -or $port -gt 65535) {
      Fail "Existing Agent config has an invalid localApiPort; refusing to discard or rewrite it"
    }
    $preserved["localApiPort"] = $port
  }
  $originProperty = $existing.PSObject.Properties["localApiAllowedOrigins"]
  if (-not $SkipOrigins -and $null -ne $originProperty) {
    if ($originProperty.Value -is [string] -or $originProperty.Value -isnot [System.Collections.IEnumerable]) {
      Fail "Existing Agent config has invalid localApiAllowedOrigins; refusing to discard or rewrite it"
    }
    $preservedOrigins = New-Object "System.Collections.Generic.List[string]"
    foreach ($origin in @($originProperty.Value)) {
      if ($origin -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$origin)) {
        Fail "Existing Agent config has invalid localApiAllowedOrigins; refusing to discard or rewrite it"
      }
      $canonicalOrigin = ConvertTo-CanonicalOrigin ([string]$origin)
      if (-not $preservedOrigins.Contains($canonicalOrigin)) { $preservedOrigins.Add($canonicalOrigin) }
    }
    $preserved["localApiAllowedOrigins"] = @($preservedOrigins)
  }
  return $preserved
}

function ConvertTo-SidValue([object]$IdentityReference) {
  if ($IdentityReference -is [System.Security.Principal.SecurityIdentifier]) {
    return [string]$IdentityReference.Value
  }

  $account = if ($IdentityReference -is [System.Security.Principal.NTAccount]) {
    $IdentityReference
  } else {
    New-Object System.Security.Principal.NTAccount([string]$IdentityReference)
  }
  return [string]$account.Translate(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
}

function Assert-NotReparsePoint([System.IO.FileSystemInfo]$Item) {
  if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing filesystem reparse point: $($Item.FullName)"
  }
}

function Assert-ProgramDataAcl([string]$Path, [bool]$IsContainer) {
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $ownerSid = ConvertTo-SidValue $acl.Owner
  if ($ownerSid -ne "S-1-5-32-544") {
    throw "ProgramData ACL owner is not Administrators: $Path"
  }
  if (-not $acl.AreAccessRulesProtected) {
    throw "ProgramData ACL inheritance is not disabled: $Path"
  }

  $expectedInheritance = if ($IsContainer) {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  $rules = @($acl.Access)
  if ($rules.Count -ne 2) {
    throw "ProgramData ACL must contain exactly two access rules: $Path"
  }

  $requiredSids = @("S-1-5-18", "S-1-5-32-544")
  $seenSids = New-Object "System.Collections.Generic.HashSet[string]"
  foreach ($rule in $rules) {
    $sid = ConvertTo-SidValue $rule.IdentityReference
    if (
      $rule.IsInherited -or
      $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      $requiredSids -notcontains $sid -or
      $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
      $rule.InheritanceFlags -ne $expectedInheritance -or
      $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None
    ) {
      throw "ProgramData ACL contains an inherited, denied, extra, or incorrectly scoped rule: $Path"
    }
    if (-not $seenSids.Add($sid)) {
      throw "ProgramData ACL contains a duplicate access rule: $Path"
    }
  }

  foreach ($sid in $requiredSids) {
    if (-not $seenSids.Contains($sid)) {
      throw "ProgramData ACL is missing a required principal: $Path"
    }
  }
}

function Set-ProgramDataAcl([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Set-ProgramDataAcl requires a non-empty path"
  }

  $item = Get-Item -Force -LiteralPath $Path -ErrorAction Stop
  Assert-NotReparsePoint $item
  $isContainer = [bool]$item.PSIsContainer
  if ($isContainer) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $inherit = [System.Security.AccessControl.InheritanceFlags]::None
  }

  $acl.SetAccessRuleProtection($true, $false)
  $administratorsSid = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
  $acl.SetOwner($administratorsSid)
  $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  foreach ($sidValue in @("S-1-5-18", "S-1-5-32-544")) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $sid,
      $rights,
      $inherit,
      $propagation,
      $allow
    )
    $acl.AddAccessRule($rule)
  }

  Set-Acl -LiteralPath $Path -AclObject $acl
  Assert-ProgramDataAcl -Path $Path -IsContainer $isContainer
}

function Assert-RestrictedRuntime([string]$Root) {
  if ([string]::IsNullOrWhiteSpace($Root)) {
    throw "Restricted runtime check requires a non-empty path"
  }

  $rootItem = Get-Item -Force -LiteralPath $Root -ErrorAction Stop
  $pending = New-Object "System.Collections.Generic.Queue[System.IO.FileSystemInfo]"
  $pending.Enqueue($rootItem)
  $allowedSids = @("S-1-5-18", "S-1-5-32-544")
  $dangerousRights = [System.Security.AccessControl.FileSystemRights]::Write -bor `
    [System.Security.AccessControl.FileSystemRights]::Modify -bor `
    [System.Security.AccessControl.FileSystemRights]::Delete -bor `
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor `
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor `
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership

  while ($pending.Count -gt 0) {
    $item = $pending.Dequeue()
    Assert-NotReparsePoint $item

    $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
    $ownerSid = ConvertTo-SidValue $acl.Owner
    if ($allowedSids -notcontains $ownerSid) {
      throw "Runtime owner must be SYSTEM or Administrators: $($item.FullName)"
    }

    foreach ($rule in @($acl.Access)) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
        continue
      }
      $sid = ConvertTo-SidValue $rule.IdentityReference
      if (
        $allowedSids -notcontains $sid -and
        (($rule.FileSystemRights -band $dangerousRights) -ne 0)
      ) {
        throw "Runtime grants write-like access to a non-privileged principal: $($item.FullName)"
      }
    }

    if ($item.PSIsContainer) {
      foreach ($child in @(Get-ChildItem -Force -LiteralPath $item.FullName -ErrorAction Stop)) {
        $pending.Enqueue($child)
      }
    }
  }
}

function Get-NodeModuleRoots([string]$StartPath) {
  $roots = New-Object "System.Collections.Generic.List[string]"
  $current = Get-Item -Force -LiteralPath $StartPath -ErrorAction Stop
  if (-not $current.PSIsContainer) { $current = $current.Directory }

  while ($null -ne $current) {
    $candidate = Join-Path $current.FullName "node_modules"
    if (Test-Path -LiteralPath $candidate -PathType Container) {
      $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
      if (-not $roots.Contains($resolved)) { $roots.Add($resolved) }
    }
    $current = $current.Parent
  }

  return $roots.ToArray()
}

function Set-ProgramDataTreeAcl([string]$Root) {
  Set-ProgramDataAcl -Path $Root
  foreach ($item in @(Get-ChildItem -Force -Recurse -LiteralPath $Root -ErrorAction Stop)) {
    Assert-NotReparsePoint $item
    Set-ProgramDataAcl -Path $item.FullName
  }
}

function Get-ServiceExecutablePath([object]$Service) {
  $rawPath = ([string]$Service.PathName).Trim()
  if ([string]::IsNullOrWhiteSpace($rawPath)) {
    throw "Windows service PathName is empty"
  }

  if ($rawPath.StartsWith('"')) {
    $closingQuote = $rawPath.IndexOf('"', 1)
    if ($closingQuote -le 1) {
      throw "Windows service PathName has invalid quoting"
    }
    $candidate = $rawPath.Substring(1, $closingQuote - 1)
    if (-not [string]::IsNullOrWhiteSpace($rawPath.Substring($closingQuote + 1))) {
      throw "Windows service PathName must not include arguments outside the verified runtime executable"
    }
  } else {
    $pathParts = @($rawPath -split "\s+", 2)
    if ($pathParts.Count -ne 1) {
      throw "Windows service PathName with spaces must quote the executable and must not include arguments"
    }
    $candidate = $pathParts[0]
  }

  return (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
}

function Assert-AgentServiceSecurity([object]$Service, [string]$AgentRoot) {
  if ([string]$Service.StartName -ne "LocalSystem") {
    throw "AIJobPrintAgent must run as LocalSystem"
  }

  $resolvedRoot = (Resolve-Path -LiteralPath $AgentRoot -ErrorAction Stop).Path.TrimEnd("\")
  $rootPrefix = $resolvedRoot + "\"
  $serviceExecutable = Get-ServiceExecutablePath $Service
  if (-not $serviceExecutable.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "AIJobPrintAgent PathName is outside the verified Agent runtime"
  }
}

function Protect-AgentToken([string]$Token, [string]$TokenPath) {
  if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "A terminal token is required for DPAPI persistence. Use -BindCode or -UseExistingToken."
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
  Set-ProgramDataAcl -Path $dir
  if (Test-Path -LiteralPath $TokenPath) {
    $existingToken = Get-Item -Force -LiteralPath $TokenPath -ErrorAction Stop
    Assert-NotReparsePoint $existingToken
  }
  Write-TextAtomically -Path $TokenPath -Text $b64
  Set-ProgramDataAcl -Path $TokenPath
}

function Test-TokenFile([string]$TokenPath) {
  if (-not (Test-Path $TokenPath)) { return $false }
  $item = Get-Item -Force -LiteralPath $TokenPath -ErrorAction Stop
  Assert-NotReparsePoint $item
  $content = [System.IO.File]::ReadAllText($TokenPath).Trim()
  return -not [string]::IsNullOrWhiteSpace($content)
}

function Commit-ProductionConfigAndToken(
  [string]$ConfigPath,
  [string]$ConfigText,
  [string]$TokenPath,
  [AllowNull()][string]$TokenToPersist
) {
  $shouldWriteToken = $null -ne $TokenToPersist
  $hadExistingToken = $false
  $tokenRollbackPath = $null
  $commitFailed = $false
  $rollbackFailed = $false

  try {
    if ($shouldWriteToken) {
      $hadExistingToken = Test-Path -LiteralPath $TokenPath -PathType Leaf
      $tokenDirectory = Split-Path -Parent $TokenPath
      New-Item -ItemType Directory -Path $tokenDirectory -Force | Out-Null

      if ($hadExistingToken) {
        $existingToken = Get-Item -Force -LiteralPath $TokenPath -ErrorAction Stop
        Assert-NotReparsePoint $existingToken
        $tokenRollbackPath = Join-Path $tokenDirectory ".agent.token.rollback.${PID}.$([System.Guid]::NewGuid().ToString('N')).tmp"
        Copy-Item -LiteralPath $TokenPath -Destination $tokenRollbackPath -Force
        Set-ProgramDataAcl -Path $tokenRollbackPath
      }

      Protect-AgentToken -Token $TokenToPersist -TokenPath $TokenPath
    }

    Write-TextAtomically -Path $ConfigPath -Text $ConfigText
  } catch {
    $commitFailed = $true

    try {
      if ($shouldWriteToken) {
        if ($hadExistingToken -and $null -ne $tokenRollbackPath -and (Test-Path -LiteralPath $tokenRollbackPath -PathType Leaf)) {
          if ([System.IO.File]::Exists($TokenPath)) {
            Replace-FileAtomically -SourcePath $tokenRollbackPath -DestinationPath $TokenPath
          } else {
            [System.IO.File]::Move($tokenRollbackPath, $TokenPath)
          }
          Set-ProgramDataAcl -Path $TokenPath
        } elseif (-not $hadExistingToken -and (Test-Path -LiteralPath $TokenPath -PathType Leaf)) {
          Remove-Item -LiteralPath $TokenPath -Force
        }
      }
    } catch {
      $rollbackFailed = $true
    }
  } finally {
    if ($null -ne $tokenRollbackPath -and (Test-Path -LiteralPath $tokenRollbackPath -PathType Leaf)) {
      Remove-Item -LiteralPath $tokenRollbackPath -Force -ErrorAction SilentlyContinue
    }
  }

  if ($commitFailed) {
    if ($rollbackFailed) {
      Fail "Could not commit production config and terminal token locally. Local token rollback could not be confirmed; do not start the Agent and investigate the local files."
    }
    Fail "Could not commit production config and terminal token locally. If a bind code was used, it may have been consumed; obtain a new bind code and retry."
  }
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

$runtimeLayout = Resolve-AgentRuntimeLayout
$runtimeRoot = [string]$runtimeLayout.RuntimeRoot
$agentAppRoot = [string]$runtimeLayout.AppRoot
$nodeExecutable = [string]$runtimeLayout.NodeExecutable
$installedMode = [string]$runtimeLayout.Mode -eq "installed"
$programDataDir = Join-Path $env:ProgramData "AIJobPrintAgent"
$configPath = Join-Path $programDataDir "agent-config.json"
$tokenPath = Join-Path $programDataDir "agent.token"
$unauthorizedMarkerPath = Join-Path $programDataDir "agent.unauthorized"
$apiBase = ConvertTo-CanonicalApiBaseUrl $ApiBaseUrl
$apiOrigin = ([System.Uri]$apiBase).GetLeftPart([System.UriPartial]::Authority)
$preservedLocalSettings = Get-PreservedLocalSettings `
  -ConfigPath $configPath `
  -ProgramDataDir $programDataDir `
  -SkipOrigins ([bool]$ReplaceLocalApiAllowedOrigins)
$localApiAllowedOrigins = New-Object "System.Collections.Generic.List[string]"
$preservedOrigins = if (-not $ReplaceLocalApiAllowedOrigins -and $preservedLocalSettings.Contains("localApiAllowedOrigins")) {
  @($preservedLocalSettings["localApiAllowedOrigins"])
} else {
  @()
}
foreach ($origin in @($apiOrigin) + @($LocalApiAllowedOrigins) + $preservedOrigins + @("http://localhost:5173", "http://127.0.0.1:5173")) {
  $canonicalOrigin = ConvertTo-CanonicalOrigin $origin
  if (-not $localApiAllowedOrigins.Contains($canonicalOrigin)) { $localApiAllowedOrigins.Add($canonicalOrigin) }
}

Write-Step "Production Agent hardening"
Write-Host "Runtime mode : $($runtimeLayout.Mode)"
Write-Host "Runtime root : $runtimeRoot"
Write-Host "Agent app    : $agentAppRoot"
Write-Host "API base     : $apiBase"
Write-Host "Printer      : $PrinterName"

if ($apiBase -match "localhost|127\.0\.0\.1") {
  Fail "Production Agent cannot point to localhost. Use local-debug profile instead."
}

Write-Step "Checking prerequisites"
if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) { Fail "Agent runtime root not found: $runtimeRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $agentAppRoot "dist\index.js") -PathType Leaf)) {
  Fail "Compiled Agent not found under the resolved runtime: $agentAppRoot\dist\index.js"
}
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { Fail "node.exe not found: $nodeExecutable" }
Write-Ok "Node found: $nodeExecutable"

Write-Step "Verifying restricted Agent runtime"
try {
  Assert-RestrictedRuntime -Root $runtimeRoot
  Assert-RestrictedRuntime -Root $nodeExecutable
  $nodeModuleRoots = @(Get-NodeModuleRoots -StartPath $agentAppRoot)
  if ($nodeModuleRoots.Count -eq 0) {
    throw "No node_modules dependency root is available to the Agent runtime"
  }
  foreach ($nodeModuleRoot in $nodeModuleRoots) {
    Assert-RestrictedRuntime -Root $nodeModuleRoot
  }
} catch {
  Fail "Agent runtime, dependency tree, or node.exe is not restricted to SYSTEM/Administrators: $($_.Exception.Message)"
}
Write-Ok "Agent runtime, dependency tree, and node.exe permissions are restricted"

$preflightService = $null
try {
  $preflightService = Resolve-AgentService -Identity $agentServiceIdentity
  if ($null -ne $preflightService) {
    Assert-AgentServiceSecurity -Service $preflightService -AgentRoot $runtimeRoot
  } elseif ($installedMode) {
    Fail "The MSI-managed AIJobPrintAgent service is missing. Run the installer Repair action before provisioning."
  }
} catch {
  Fail "Existing Windows service failed the LocalSystem/runtime-path security check: $($_.Exception.Message)"
}

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
  $available = Get-Printer | Select-Object -ExpandProperty Name
  Write-Host "Available printers:" -ForegroundColor Yellow
  $available | ForEach-Object { Write-Host "  - $_" }
  Fail "Printer not found: $PrinterName"
}
Write-Ok "Printer found: $($printer.Name) on $($printer.PortName)"

$effectiveScanWatchFolder = $null
if ($PSBoundParameters.ContainsKey("ScanWatchFolder")) {
  if ([string]::IsNullOrWhiteSpace($ScanWatchFolder)) {
    Fail "ScanWatchFolder cannot be empty when explicitly provided"
  }
  $scanFolderItem = Get-Item -Force -LiteralPath $ScanWatchFolder -ErrorAction Stop
  Assert-NotReparsePoint $scanFolderItem
  if (-not $scanFolderItem.PSIsContainer) {
    Fail "ScanWatchFolder must be an existing directory"
  }
  $effectiveScanWatchFolder = $scanFolderItem.FullName
} elseif ($preservedLocalSettings.Contains("scanWatchFolder")) {
  $effectiveScanWatchFolder = $preservedLocalSettings["scanWatchFolder"]
}

$effectiveBridgeToken = $null
if ($PromptForLocalApiBridgeToken -and $null -ne $LocalApiBridgeTokenSecure) {
  Fail "Use either -PromptForLocalApiBridgeToken or -LocalApiBridgeTokenSecure, not both"
}
if ($PromptForLocalApiBridgeToken -or $null -ne $LocalApiBridgeTokenSecure) {
  $secureBridgeToken = if ($PromptForLocalApiBridgeToken) {
    Read-Host "Local bridge token" -AsSecureString
  } else {
    $LocalApiBridgeTokenSecure
  }
  $effectiveBridgeToken = ConvertFrom-SecureStringToPlainText $secureBridgeToken
  $secureBridgeToken = $null
  $LocalApiBridgeTokenSecure = $null
  if ([string]::IsNullOrWhiteSpace($effectiveBridgeToken)) {
    Fail "Local bridge token cannot be empty"
  }
} elseif ($preservedLocalSettings.Contains("localApiBridgeToken")) {
  $effectiveBridgeToken = $preservedLocalSettings["localApiBridgeToken"]
}

$effectiveLocalApiPort = $LocalApiPort
if (-not $PSBoundParameters.ContainsKey("LocalApiPort") -and $preservedLocalSettings.Contains("localApiPort")) {
  $effectiveLocalApiPort = $preservedLocalSettings["localApiPort"]
}

$preflightTerminalId = if ([string]::IsNullOrWhiteSpace($TerminalId)) { "__FROM_BIND_CODE__" } else { $TerminalId.Trim() }
$preflightTerminalCode = if ([string]::IsNullOrWhiteSpace($TerminalCode)) { "__FROM_BIND_CODE__" } else { $TerminalCode.Trim() }
$config = [ordered]@{
  apiBaseUrl             = $apiBase
  terminalId             = $preflightTerminalId
  terminalCode           = $preflightTerminalCode
  printerName            = $PrinterName.Trim()
  agentVersion           = $AgentVersion.Trim()
  heartbeatIntervalMs    = $HeartbeatIntervalMs
  claimIntervalMs        = $ClaimIntervalMs
  localApiPort           = $effectiveLocalApiPort
  localApiAllowedOrigins = @($localApiAllowedOrigins)
}
if ($null -ne $effectiveScanWatchFolder) {
  $config.scanWatchFolder = $effectiveScanWatchFolder
}
if ($null -ne $effectiveBridgeToken) {
  $config.localApiBridgeToken = $effectiveBridgeToken
}
[void](Test-GeneratedConfig -Config $config)

Write-Step "Hardening ProgramData ACL"
New-Item -ItemType Directory -Path $programDataDir -Force | Out-Null
Set-ProgramDataTreeAcl -Root $programDataDir
Write-Ok "ProgramData ACL restricted to SYSTEM + Administrators: $programDataDir"

Write-Step "Preparing token"
$tokenToPersist = $null
$bindInputCount = 0
if ($PromptForBindCode) { $bindInputCount++ }
if (-not [string]::IsNullOrWhiteSpace($BindCode)) { $bindInputCount++ }
if ($null -ne $BindCodeSecure) { $bindInputCount++ }
if ($bindInputCount -gt 1) {
  Fail "Use exactly one of -PromptForBindCode, -BindCode, or -BindCodeSecure"
}
if ($UseExistingToken -and $bindInputCount -gt 0) {
  Fail "Use either a BindCode flow or -UseExistingToken, not both"
}
$secureBindCode = $BindCodeSecure
$effectiveBindCode = $BindCode
if ($PromptForBindCode -or $null -ne $secureBindCode) {
  if ($PromptForBindCode) {
    $secureBindCode = Read-Host "One-time terminal bind code" -AsSecureString
  }
  $effectiveBindCode = ConvertFrom-SecureStringToPlainText $secureBindCode
}
if (-not [string]::IsNullOrWhiteSpace($effectiveBindCode)) {
  # The old token holder must be quiet before exchange invalidates its token and
  # before this flow clears the persistent unauthorized latch.
  Stop-ExistingAgentRuntime -Reason "before BindCode exchange"
  Write-Ok "Exchanging one-time bind code with cloud API"
  $exchange = Exchange-BindCode -ApiBase $apiBase -Code $effectiveBindCode
  $effectiveBindCode = $null
  $secureBindCode = $null
  $BindCode = $null
  $BindCodeSecure = $null
  if ([string]::IsNullOrWhiteSpace([string]$exchange.terminalId)) {
    Fail "BindCode exchange did not return a terminalId"
  }
  if (-not [string]::IsNullOrWhiteSpace($TerminalId) -and [string]$exchange.terminalId -ne $TerminalId.Trim()) {
    Fail "BindCode exchange terminalId does not match the requested TerminalId"
  }
  if ([string]::IsNullOrWhiteSpace([string]$exchange.terminalCode)) {
    Fail "BindCode exchange did not return a terminalCode"
  }
  if (-not [string]::IsNullOrWhiteSpace($TerminalCode) -and [string]$exchange.terminalCode -ne $TerminalCode.Trim()) {
    Fail "BindCode exchange terminalCode does not match the requested TerminalCode"
  }
  if ([string]::IsNullOrWhiteSpace([string]$exchange.terminalToken)) {
    Fail "BindCode exchange did not return a terminal token"
  }
  $TerminalId = ([string]$exchange.terminalId).Trim()
  $TerminalCode = ([string]$exchange.terminalCode).Trim()
  $tokenToPersist = ([string]$exchange.terminalToken).Trim()
} elseif ($UseExistingToken) {
  if ([string]::IsNullOrWhiteSpace($TerminalId) -or [string]::IsNullOrWhiteSpace($TerminalCode)) {
    Fail "-UseExistingToken requires the existing TerminalId and TerminalCode"
  }
  $TerminalId = $TerminalId.Trim()
  $TerminalCode = $TerminalCode.Trim()
  if (-not (Test-TokenFile $tokenPath)) { Fail "-UseExistingToken passed, but token file is missing or empty: $tokenPath" }
  Write-Ok "Using existing DPAPI token: $tokenPath"
  Set-ProgramDataAcl -Path $tokenPath
} else {
  Fail "Provide -PromptForBindCode, -BindCodeSecure (GUI), -BindCode (legacy), or -UseExistingToken. Long-lived -AgentToken CLI input is not accepted."
}

Write-Host "Terminal     : $TerminalCode / $TerminalId"
$config.terminalId = $TerminalId
$config.terminalCode = $TerminalCode
$configJson = Test-GeneratedConfig -Config $config

Write-Step "Writing production config and token"
New-Item -ItemType Directory -Path (Split-Path -Parent $configPath) -Force | Out-Null
$credentialReplaced = $null -ne $tokenToPersist
Commit-ProductionConfigAndToken -ConfigPath $configPath -ConfigText ($configJson + "`n") -TokenPath $tokenPath -TokenToPersist $tokenToPersist
$tokenToPersist = $null
try {
  Assert-RestrictedRuntime -Root $configPath
} catch {
  Fail "Production config was written but its runtime permissions are unsafe; service will not be started: $($_.Exception.Message)"
}
Write-Ok "Production config written: $configPath"
if ($credentialReplaced) {
  Write-Ok "BindCode exchanged; token protected with DPAPI + ProgramData ACL"
  try {
    if (Test-Path -LiteralPath $unauthorizedMarkerPath) {
      $markerItem = Get-Item -Force -LiteralPath $unauthorizedMarkerPath -ErrorAction Stop
      Assert-NotReparsePoint $markerItem
      Remove-Item -LiteralPath $unauthorizedMarkerPath -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $unauthorizedMarkerPath) {
      throw "Persistent unauthorized latch still exists after removal"
    }
    Write-Ok "Persistent unauthorized latch cleared after successful credential replacement"
  } catch {
    Fail "Replacement credential was persisted, but unauthorized latch could not be cleared: $($_.Exception.Message)"
  }
} elseif ($UseExistingToken) {
  Write-Ok "Existing DPAPI token retained; ProgramData ACL reapplied"
}

Write-Step "Stopping old Agent processes"
Stop-ExistingAgentRuntime -Reason "before recording the heartbeat baseline"

$statusUrl = "$apiBase/terminals/$TerminalId/printer-status"
$heartbeatBaselineCaptured = $false
$heartbeatBaseline = $null
if (-not $SkipHeartbeatVerify) {
  try {
    $baselineStatus = Invoke-RestMethod -Uri $statusUrl -Method Get -TimeoutSec 15
    if (-not [string]::IsNullOrWhiteSpace([string]$baselineStatus.lastSeenAt)) {
      $heartbeatBaseline = [DateTimeOffset]::Parse(
        [string]$baselineStatus.lastSeenAt,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind
      )
    }
    $heartbeatBaselineCaptured = $true
  } catch {
    Write-WarnLine "Could not record the pre-start heartbeat baseline; remote verification will fail closed: $($_.Exception.Message)"
  }
}

if (-not $SkipServiceInstall) {
  Write-Step "Installing/starting Windows service"
  Push-Location $agentAppRoot
  try {
    try {
      $service = Resolve-AgentService -Identity $agentServiceIdentity
    } catch {
      Fail "Could not resolve Windows service '$agentServiceIdentity': $($_.Exception.Message)"
    }

    if ($null -eq $service) {
      if ($installedMode) {
        Fail "The MSI-managed AIJobPrintAgent service is missing. Run the installer Repair action before provisioning."
      }
      & $nodeExecutable "dist\index.js" install-service
      Start-Sleep -Seconds 3
    } else {
      Write-Ok "Service already exists: $($service.Name) ($($service.DisplayName))"
    }

    try {
      $service = Resolve-AgentService -Identity $agentServiceIdentity
    } catch {
      Fail "Could not resolve Windows service '$agentServiceIdentity': $($_.Exception.Message)"
    }

    if ($null -ne $service) {
      try {
        Assert-RestrictedRuntime -Root $runtimeRoot
        Assert-AgentServiceSecurity -Service $service -AgentRoot $runtimeRoot
      } catch {
        Stop-Service -Name ([string]$service.Name) -Force -ErrorAction SilentlyContinue
        Fail "Windows service failed the LocalSystem/runtime-path security check and was stopped: $($_.Exception.Message)"
      }
      $serviceName = [string]$service.Name
      Set-Service -Name $serviceName -StartupType Automatic
      Set-AgentServiceRecovery $serviceName
      if ($service.State -ne "Running") {
        Start-Service -Name $serviceName
      } else {
        Restart-Service -Name $serviceName -Force
      }
      try {
        $service = Resolve-AgentService -Identity $agentServiceIdentity
        if ($null -eq $service) {
          throw "AIJobPrintAgent disappeared after start"
        }
        Assert-AgentServiceSecurity -Service $service -AgentRoot $runtimeRoot
      } catch {
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        Fail "Windows service failed its post-start security check and was stopped: $($_.Exception.Message)"
      }
      Write-Ok "Service running with Automatic startup: $serviceName"
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
  Write-Step "Verifying a new remote heartbeat from this service start"
  if (-not $heartbeatBaselineCaptured) {
    Fail "Heartbeat verification failed closed because the pre-start heartbeat baseline could not be read. Check API connectivity, then retry with the saved credential."
  }

  $heartbeatVerified = $false
  $lastHeartbeatError = $null
  $verificationDeadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    try {
      $status = Invoke-RestMethod -Uri $statusUrl -Method Get -TimeoutSec 15
      $lastHeartbeatError = $null
      if ($status.isOnline -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$status.lastSeenAt)) {
        $observedHeartbeat = [DateTimeOffset]::Parse(
          [string]$status.lastSeenAt,
          [System.Globalization.CultureInfo]::InvariantCulture,
          [System.Globalization.DateTimeStyles]::RoundtripKind
        )
        if ($null -eq $heartbeatBaseline -or $observedHeartbeat -gt $heartbeatBaseline) {
          $heartbeatVerified = $true
          break
        }
      }
    } catch {
      $lastHeartbeatError = $_.Exception.Message
    }
    Start-Sleep -Seconds 3
  } while ([DateTime]::UtcNow -lt $verificationDeadline)

  if (-not $heartbeatVerified) {
    $detail = if ([string]::IsNullOrWhiteSpace($lastHeartbeatError)) {
      "No heartbeat newer than the pre-start baseline was observed."
    } else {
      $lastHeartbeatError
    }
    Fail "Heartbeat verification failed: $detail Check Agent logs under $programDataDir\logs."
  }
  Write-Ok "Remote terminal reported a new heartbeat after this service start"
}

Write-Step "Done"
Write-Ok "Production Agent is pinned to $apiBase and terminal $TerminalId."
Write-Host "Next: submit a print task from the cloud/Kiosk that points to this same API and terminal."
