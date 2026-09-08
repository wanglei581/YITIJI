# AI Job Print Terminal — read-only field evidence collector
#
# Collects mechanically verifiable Windows kiosk checklist values into Markdown
# that can be pasted into an acceptance receipt. Windows PowerShell 5.1.
# Run elevated. Writes nothing except an optional -OutFile.
#
# Staging re-encodes this file as UTF-8 BOM. Keep this copy UTF-8 BOM + CRLF.

[CmdletBinding()]
param(
  [string]$ConfigPath,

  [string]$OutFile,

  [string]$KioskOrigin = "https://zyidai.cn",

  [string]$PrinterName,

  [switch]$IncludeBridgeProbe
)

$ErrorActionPreference = "Continue"

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $env:ProgramData "AIJobPrintAgent\agent-config.json"
}
if ([string]::IsNullOrWhiteSpace($KioskOrigin)) {
  $KioskOrigin = "https://zyidai.cn"
}

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot) -and $MyInvocation.MyCommand.Path) {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$script:Rows = @()
$script:Config = $null
$script:ConfigError = $null
$script:EffectivePrinterName = $PrinterName
$script:LocalApiPort = 9527
$script:ServiceName = "aijobprintagent.exe"
$script:ServiceCim = $null
$script:TerminalCode = "UNKNOWN"

function Add-EvidenceRow {
  param(
    [string]$Id,
    [string]$Name,
    [string]$Value,
    [string]$Verdict
  )
  if ($Verdict -ne "PASS" -and $Verdict -ne "FAIL" -and $Verdict -ne "UNKNOWN") {
    $Verdict = "UNKNOWN"
  }
  $flat = [regex]::Replace([string]$Value, "[\r\n]+", " ")
  $flat = $flat.Replace("|", "/")
  $script:Rows += [pscustomobject]@{
    Id = $Id
    Name = $Name
    Value = $flat.Trim()
    Verdict = $Verdict
  }
}

function Invoke-CheckedItem {
  param(
    [string]$Id,
    [string]$Name,
    [scriptblock]$Body
  )
  try {
    & $Body
  } catch {
    $message = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) { $message = [string]$_ }
    Add-EvidenceRow -Id $Id -Name $Name -Value ("ERROR: " + $message) -Verdict "FAIL"
  }
}

function Format-ConfigScalar($Value) {
  if ($null -eq $Value) { return "(null)" }
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return "(empty)" }
  return $text
}

function Format-ConfigList($Value) {
  if ($null -eq $Value) { return "(empty)" }
  $items = @($Value | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($items.Count -eq 0) { return "(empty)" }
  return ($items -join ",")
}

function Get-JsonNode($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-UnexpectedIdentityLeak([string]$Text) {
  $found = New-Object System.Collections.Generic.List[string]
  if ($Text -like "*apiBaseUrl*") { [void]$found.Add("apiBaseUrl") }
  if ($Text -like "*printerName*") { [void]$found.Add("printerName") }
  if ($Text -match '(?i)(^|[^A-Za-z0-9_])token([^A-Za-z0-9_]|$)') { [void]$found.Add("token") }
  if ($Text -match '(?i)([A-Za-z]:\\|\\\\[A-Za-z0-9._-]|%ProgramData%|%LOCALAPPDATA%)') {
    [void]$found.Add("local-path")
  }
  return @($found.ToArray())
}

function Invoke-LocalHttp {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [string]$Origin,
    [string]$BridgeToken,
    [int]$TimeoutMs = 8000
  )
  $request = [System.Net.WebRequest]::Create($Uri)
  $request.Method = $Method
  $request.Timeout = $TimeoutMs
  $request.ReadWriteTimeout = $TimeoutMs
  $request.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy()
  if ($request -is [System.Net.HttpWebRequest]) {
    $request.AllowAutoRedirect = $false
    $request.KeepAlive = $false
    $request.ServicePoint.Expect100Continue = $false
  }
  if (-not [string]::IsNullOrWhiteSpace($Origin)) {
    [void]$request.Headers.Add("Origin", $Origin)
  }
  if (-not [string]::IsNullOrWhiteSpace($BridgeToken)) {
    [void]$request.Headers.Add("X-Local-Bridge-Token", $BridgeToken)
  }
  if ($Method -eq "POST") {
    $request.ContentLength = 0
  }

  $response = $null
  try {
    $response = $request.GetResponse()
  } catch [System.Net.WebException] {
    $response = $_.Exception.Response
    if ($null -eq $response) { throw }
  }

  $status = [int]$response.StatusCode
  $stream = $response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
  try {
    $content = $reader.ReadToEnd()
  } finally {
    $reader.Close()
    $response.Close()
  }
  return [pscustomobject]@{ StatusCode = $status; Content = $content }
}

# Copied from diagnose-production-agent.ps1 (Get-PathPresenceStatus /
# ConvertTo-SidValue / Get-ProgramDataAclStatus). That script has top-level
# side effects, so it cannot be safely dot-sourced from this collector.
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

if (-not [string]::IsNullOrWhiteSpace($scriptRoot)) {
  $serviceIdentityPath = Join-Path $scriptRoot "service-identity.ps1"
  if (Test-Path -LiteralPath $serviceIdentityPath -PathType Leaf) {
    try { . $serviceIdentityPath } catch { }
  }
}

try {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    $script:ConfigError = "missing $ConfigPath"
  } else {
    $configText = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.UTF8Encoding]::new($false))
    $script:Config = $configText.TrimStart([char]0xFEFF) | ConvertFrom-Json -ErrorAction Stop
    $code = [string](Get-JsonNode $script:Config "terminalCode")
    if (-not [string]::IsNullOrWhiteSpace($code)) { $script:TerminalCode = $code }
    if ([string]::IsNullOrWhiteSpace($script:EffectivePrinterName)) {
      $script:EffectivePrinterName = [string](Get-JsonNode $script:Config "printerName")
    }
    $portValue = Get-JsonNode $script:Config "localApiPort"
    if ($null -ne $portValue -and [string]$portValue -match '^\d+$') {
      $script:LocalApiPort = [int]$portValue
    }
  }
} catch {
  $script:ConfigError = $_.Exception.Message
  $script:Config = $null
}

# --- 5.1 environment ---

Invoke-CheckedItem -Id "5.1-1" -Name "Windows 版本" -Body {
  $value = $null
  try {
    $info = Get-ComputerInfo -Property OsName, OsVersion, OsBuildNumber -ErrorAction Stop
    $value = "OsName=$($info.OsName) OsVersion=$($info.OsVersion) OsBuildNumber=$($info.OsBuildNumber)"
  } catch {
    $cv = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction Stop
    $os = [System.Environment]::OSVersion
    $value = "OsName=$($cv.ProductName) DisplayVersion=$($cv.DisplayVersion) OsVersion=$($os.Version) OsBuildNumber=$($cv.CurrentBuild).$($cv.UBR)"
  }
  $verdict = "FAIL"
  if ($value -match "Windows 10" -or $value -match "Windows 11") { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.1-1" -Name "Windows 版本" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.1-2" -Name "时区" -Body {
  $tz = Get-TimeZone -ErrorAction Stop
  $value = "Id=$($tz.Id) DisplayName=$($tz.DisplayName)"
  $verdict = "FAIL"
  if ($tz.Id -eq "China Standard Time") { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.1-2" -Name "时区" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.1-3" -Name "自动登录策略" -Body {
  $item = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "AutoAdminLogon" -ErrorAction Stop
  $raw = [string]$item.AutoAdminLogon
  $reported = "0"
  $verdict = "UNKNOWN"
  if ($raw -eq "1") {
    $reported = "1"
    $verdict = "PASS"
  }
  Add-EvidenceRow -Id "5.1-3" -Name "自动登录策略" -Value $reported -Verdict $verdict
}

Invoke-CheckedItem -Id "5.1-4" -Name "Edge/Chrome 安装与版本" -Body {
  $pf = $env:ProgramFiles
  $pf86 = ${env:ProgramFiles(x86)}
  $edgeCandidates = @()
  $chromeCandidates = @()
  if (-not [string]::IsNullOrWhiteSpace($pf86)) {
    $edgeCandidates += Join-Path $pf86 "Microsoft\Edge\Application\msedge.exe"
    $chromeCandidates += Join-Path $pf86 "Google\Chrome\Application\chrome.exe"
  }
  if (-not [string]::IsNullOrWhiteSpace($pf)) {
    $edgeCandidates += Join-Path $pf "Microsoft\Edge\Application\msedge.exe"
    $chromeCandidates += Join-Path $pf "Google\Chrome\Application\chrome.exe"
  }
  $browserSpecs = @(
    [pscustomobject]@{ Label = "Edge"; Candidates = @($edgeCandidates) },
    [pscustomobject]@{ Label = "Chrome"; Candidates = @($chromeCandidates) }
  )
  $parts = @()
  $installed = $false
  foreach ($spec in $browserSpecs) {
    $found = $null
    foreach ($candidate in @($spec.Candidates)) {
      if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $found = $candidate
        break
      }
    }
    if ($null -eq $found) {
      $parts += "$($spec.Label)=missing"
    } else {
      $version = [string](Get-Item -LiteralPath $found).VersionInfo.ProductVersion
      if ([string]::IsNullOrWhiteSpace($version)) {
        $version = [string](Get-Item -LiteralPath $found).VersionInfo.FileVersion
      }
      $parts += "$($spec.Label)=installed ProductVersion=$version"
      $installed = $true
    }
  }
  $verdict = "FAIL"
  if ($installed) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.1-4" -Name "Edge/Chrome 安装与版本" -Value ($parts -join "; ") -Verdict $verdict
}

Invoke-CheckedItem -Id "5.1-5" -Name "Windows Update 活动时段" -Body {
  $ux = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -Name "ActiveHoursStart", "ActiveHoursEnd" -ErrorAction Stop
  $start = $ux.ActiveHoursStart
  $end = $ux.ActiveHoursEnd
  $value = "ActiveHoursStart=$start ActiveHoursEnd=$end"
  $verdict = "UNKNOWN"
  if ($null -ne $start -and $null -ne $end) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.1-5" -Name "Windows Update 活动时段" -Value $value -Verdict $verdict
}

# --- 5.3 Agent ---

Invoke-CheckedItem -Id "5.3-6" -Name "Agent 服务状态" -Body {
  $resolvedName = $script:ServiceName
  if (Get-Command Resolve-AgentService -ErrorAction SilentlyContinue) {
    $resolved = Resolve-AgentService -Identity "aijobprintagent.exe"
    if ($null -eq $resolved) {
      $resolved = Resolve-AgentService -Identity "AIJobPrintAgent"
    }
    if ($null -ne $resolved) {
      $resolvedName = [string]$resolved.Name
      $script:ServiceCim = $resolved
    }
  }
  $script:ServiceName = $resolvedName
  $controller = Get-Service -Name $resolvedName -ErrorAction Stop
  if ($null -eq $script:ServiceCim) {
    $filter = "Name='" + $resolvedName.Replace("'", "''") + "'"
    $script:ServiceCim = Get-CimInstance Win32_Service -Filter $filter -ErrorAction Stop
  }
  $status = [string]$controller.Status
  $startMode = if ($null -ne $script:ServiceCim) { [string]$script:ServiceCim.StartMode } else { "unknown" }
  $startType = $startMode
  if ($startMode -eq "Auto") { $startType = "Automatic" }
  $value = "Name=$resolvedName Status=$status StartType=$startType"
  $verdict = "FAIL"
  if ($status -eq "Running" -and ($startType -eq "Automatic" -or $startMode -eq "Auto")) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.3-6" -Name "Agent 服务状态" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.3-7" -Name "服务路径与运行账户" -Body {
  if ($null -eq $script:ServiceCim) {
    $filter = "Name='" + $script:ServiceName.Replace("'", "''") + "'"
    $script:ServiceCim = Get-CimInstance Win32_Service -Filter $filter -ErrorAction Stop
  }
  $pathName = [string]$script:ServiceCim.PathName
  $startName = [string]$script:ServiceCim.StartName
  $value = "PathName=$pathName StartName=$startName"
  $verdict = "FAIL"
  if ($startName -eq "LocalSystem" -or $startName -eq "NT AUTHORITY\SYSTEM") { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.3-7" -Name "服务路径与运行账户" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.3-8" -Name "Agent 配置关键字段" -Body {
  if ($null -eq $script:Config) {
    throw $(if ($script:ConfigError) { $script:ConfigError } else { "agent-config.json not loaded" })
  }
  $bridgeTokenStatus = "未配置"
  if ([string]::IsNullOrWhiteSpace([string]$script:Config.localApiBridgeToken)) {
    $bridgeTokenStatus = "未配置"
  } else {
    $bridgeTokenStatus = "已配置(长度 " + ([string]$script:Config.localApiBridgeToken).Length + ")"
  }
  $parts = @(
    ("terminalId=" + (Format-ConfigScalar (Get-JsonNode $script:Config "terminalId"))),
    ("terminalCode=" + (Format-ConfigScalar (Get-JsonNode $script:Config "terminalCode"))),
    ("printerName=" + (Format-ConfigScalar (Get-JsonNode $script:Config "printerName"))),
    ("apiBaseUrl=" + (Format-ConfigScalar (Get-JsonNode $script:Config "apiBaseUrl"))),
    ("claimIntervalMs=" + (Format-ConfigScalar (Get-JsonNode $script:Config "claimIntervalMs"))),
    ("heartbeatIntervalMs=" + (Format-ConfigScalar (Get-JsonNode $script:Config "heartbeatIntervalMs"))),
    ("localApiPort=" + (Format-ConfigScalar (Get-JsonNode $script:Config "localApiPort"))),
    ("scanWatchFolder=" + (Format-ConfigScalar (Get-JsonNode $script:Config "scanWatchFolder"))),
    ("localApiAllowedOrigins=" + (Format-ConfigList (Get-JsonNode $script:Config "localApiAllowedOrigins"))),
    ("localApiBridgeToken=" + $bridgeTokenStatus)
  )
  $requiredOk = $true
  foreach ($key in @("terminalId", "terminalCode", "printerName", "apiBaseUrl", "claimIntervalMs", "heartbeatIntervalMs", "localApiPort")) {
    $item = Format-ConfigScalar (Get-JsonNode $script:Config $key)
    if ($item -eq "(null)" -or $item -eq "(empty)") { $requiredOk = $false }
  }
  $origins = Format-ConfigList (Get-JsonNode $script:Config "localApiAllowedOrigins")
  $verdict = "FAIL"
  if ($requiredOk -and $origins -ne "(empty)") { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.3-8" -Name "Agent 配置关键字段" -Value ($parts -join "; ") -Verdict $verdict
}

Invoke-CheckedItem -Id "5.3-9" -Name "DPAPI token 文件" -Body {
  $tokenPath = Join-Path $env:ProgramData "AIJobPrintAgent\agent.token"
  $presence = Get-PathPresenceStatus $tokenPath "Leaf"
  if ($presence -ne "present") {
    Add-EvidenceRow -Id "5.3-9" -Name "DPAPI token 文件" -Value "exists=false presence=$presence" -Verdict "FAIL"
    return
  }
  $item = Get-Item -LiteralPath $tokenPath -Force -ErrorAction Stop
  $value = "exists=true size=$($item.Length) lastWriteTime=$($item.LastWriteTime.ToString('o'))"
  $verdict = "FAIL"
  if ($item.Length -gt 0) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.3-9" -Name "DPAPI token 文件" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.3-10" -Name "ProgramData/token ACL" -Body {
  $programDataDir = Join-Path $env:ProgramData "AIJobPrintAgent"
  $tokenPath = Join-Path $programDataDir "agent.token"
  $dirStatus = Get-ProgramDataAclStatus $programDataDir
  $tokenStatus = Get-ProgramDataAclStatus $tokenPath
  $value = "programData=$dirStatus tokenFile=$tokenStatus (copied Get-ProgramDataAclStatus from diagnose-production-agent.ps1)"
  $verdict = "FAIL"
  if ($dirStatus -eq "ok" -and $tokenStatus -eq "ok") {
    $verdict = "PASS"
  } elseif ($dirStatus -eq "unavailable" -or $tokenStatus -eq "unavailable") {
    $verdict = "UNKNOWN"
  }
  Add-EvidenceRow -Id "5.3-10" -Name "ProgramData/token ACL" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.3-11" -Name "单实例进程数" -Body {
  $processes = @(Get-Process -ErrorAction Stop | Where-Object { $_.Name -like "*aijobprintagent*" })
  $names = @($processes | ForEach-Object { $_.Name + "/" + $_.Id })
  $count = $processes.Count
  $nameList = if ($names.Count -gt 0) { $names -join "," } else { "(none)" }
  $value = "count=$count names=$nameList"
  $verdict = "FAIL"
  if ($count -eq 1) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.3-11" -Name "单实例进程数" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.3-12" -Name "日志目录" -Body {
  $logDir = Join-Path $env:ProgramData "AIJobPrintAgent\logs"
  if (-not (Test-Path -LiteralPath $logDir -PathType Container)) {
    Add-EvidenceRow -Id "5.3-12" -Name "日志目录" -Value "missing $logDir" -Verdict "FAIL"
    return
  }
  $latest = Get-ChildItem -LiteralPath $logDir -File -ErrorAction Stop |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $latest) {
    Add-EvidenceRow -Id "5.3-12" -Name "日志目录" -Value "exists=true latest=(none)" -Verdict "FAIL"
    return
  }
  $value = "exists=true latest=$($latest.Name) lastWriteTime=$($latest.LastWriteTime.ToString('o'))"
  Add-EvidenceRow -Id "5.3-12" -Name "日志目录" -Value $value -Verdict "PASS"
}

# --- 5.5 local communication ---

Invoke-CheckedItem -Id "5.5-13" -Name "回环端口监听" -Body {
  $netstatExe = Join-Path $env:SystemRoot "System32\netstat.exe"
  $findstrExe = Join-Path $env:SystemRoot "System32\findstr.exe"
  $listening = & $netstatExe -ano | & $findstrExe "LISTENING"
  $port = [int]$script:LocalApiPort
  $escapedPort = [regex]::Escape([string]$port)
  $pattern = "^\s*TCP\s+(\S+):$escapedPort\s+"
  $addresses = @()
  $wildcard = $false
  foreach ($line in @($listening)) {
    $text = [string]$line
    if ($text -match $pattern) {
      $addr = $Matches[1]
      $addresses += $addr
      if ($addr -eq "0.0.0.0" -or $addr -eq "::" -or $addr -eq "[::]" -or $addr -eq "[::0]") {
        $wildcard = $true
      }
    }
  }
  $addrList = if ($addresses.Count -gt 0) { ($addresses | Select-Object -Unique) -join "," } else { "(none)" }
  $value = "port=$port localAddresses=$addrList wildcardBind=$wildcard"
  $verdict = "FAIL"
  $loopback = $false
  foreach ($addr in $addresses) {
    if ($addr -eq "127.0.0.1" -or $addr -eq "[::1]" -or $addr -eq "::1") { $loopback = $true }
  }
  if ($loopback -and -not $wildcard) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.5-13" -Name "回环端口监听" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.5-14" -Name "终端启动票" -Body {
  $uri = "http://127.0.0.1:$($script:LocalApiPort)/local/terminal-boot-ticket"
  $probe = Invoke-LocalHttp -Method POST -Uri $uri
  $ticketLength = 0
  $shapeOk = $false
  $expires = $null
  $parsed = $null
  try { $parsed = $probe.Content | ConvertFrom-Json -ErrorAction Stop } catch { $parsed = $null }
  $data = Get-JsonNode $parsed "data"
  if ($null -eq $data) { $data = $parsed }
  $ticket = [string](Get-JsonNode $data "bootTicket")
  $ticketLength = $ticket.Length
  $shapeOk = [bool]($ticket -match '^[A-Za-z0-9_-]{32,128}$')
  $expires = Get-JsonNode $data "expiresInSeconds"
  $ticket = $null
  $expiresOk = $false
  try { if ([int]$expires -eq 60) { $expiresOk = $true } } catch { $expiresOk = $false }
  $value = "status=$($probe.StatusCode) expiresInSeconds=$expires bootTicketLength=$ticketLength regexMatch=$shapeOk"
  $verdict = "FAIL"
  if ([int]$probe.StatusCode -eq 200 -and $expiresOk -and $shapeOk) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.5-14" -Name "终端启动票" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.5-15" -Name "终端身份 Origin 隔离" -Body {
  $uri = "http://127.0.0.1:$($script:LocalApiPort)/local/terminal-identity"
  $good = Invoke-LocalHttp -Method GET -Uri $uri -Origin $KioskOrigin
  $evil = Invoke-LocalHttp -Method GET -Uri $uri -Origin "https://evil.example"
  $goodLeak = Get-UnexpectedIdentityLeak $good.Content
  $evilLeak = Get-UnexpectedIdentityLeak $evil.Content
  $identityKeys = @()
  $terminalId = $null
  $terminalCode = $null
  try {
    $parsed = $good.Content | ConvertFrom-Json -ErrorAction Stop
    $data = Get-JsonNode $parsed "data"
    if ($null -eq $data) { $data = $parsed }
    $identityKeys = @($data.PSObject.Properties.Name)
    $terminalId = Get-JsonNode $data "terminalId"
    $terminalCode = Get-JsonNode $data "terminalCode"
  } catch { }
  $extraKeys = @($identityKeys | Where-Object { $_ -ne "terminalId" -and $_ -ne "terminalCode" })
  $goodLeakText = if ($goodLeak.Count -gt 0) { $goodLeak -join "," } else { "none" }
  $evilLeakText = if ($evilLeak.Count -gt 0) { $evilLeak -join "," } else { "none" }
  $extraText = if ($extraKeys.Count -gt 0) { $extraKeys -join "," } else { "none" }
  $value = "allowOrigin=$KioskOrigin status=$($good.StatusCode) terminalId=$terminalId terminalCode=$terminalCode extraKeys=$extraText leak=$goodLeakText; denyOrigin=https://evil.example status=$($evil.StatusCode) leak=$evilLeakText"
  $verdict = "FAIL"
  $goodOk = [int]$good.StatusCode -eq 200 -and $goodLeak.Count -eq 0 -and $extraKeys.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$terminalId) -and -not [string]::IsNullOrWhiteSpace([string]$terminalCode)
  $evilOk = [int]$evil.StatusCode -eq 403 -and $evilLeak.Count -eq 0
  if ($goodOk -and $evilOk) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.5-15" -Name "终端身份 Origin 隔离" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.5-16" -Name "Kiosk 看门狗计划任务" -Body {
  $task = Get-ScheduledTask -TaskName "AIJobPrintKioskWatchdog" -ErrorAction Stop
  $filePaths = @()
  foreach ($action in @($task.Actions)) {
    $argument = [string]$action.Arguments
    if ($argument -match '-File\s+"([^"]+)"') {
      $filePaths += $Matches[1]
    } elseif ($argument -match '-File\s+(\S+)') {
      $filePaths += $Matches[1].Trim('"')
    }
  }
  $fileList = if ($filePaths.Count -gt 0) { $filePaths -join "," } else { "(none)" }
  $value = "State=$($task.State) File=$fileList"
  Add-EvidenceRow -Id "5.5-16" -Name "Kiosk 看门狗计划任务" -Value $value -Verdict "PASS"
}

Invoke-CheckedItem -Id "5.5-17" -Name "看门狗日志 bootTicket" -Body {
  $logPath = Join-Path $env:LOCALAPPDATA "AIJobPrintKiosk\watchdog.log"
  if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
    Add-EvidenceRow -Id "5.5-17" -Name "看门狗日志 bootTicket" -Value "missing $logPath" -Verdict "UNKNOWN"
    return
  }
  $last = Get-Content -LiteralPath $logPath -Tail 1 -ErrorAction Stop
  $safeLast = [string]$last
  if ($safeLast -match "boot_ticket=") {
    $safeLast = [regex]::Replace($safeLast, "boot_ticket=[^&\s]+", "boot_ticket=<redacted>")
  }
  $hasFlag = $safeLast -like "*bootTicket=True*"
  $verdict = "FAIL"
  if ($hasFlag) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.5-17" -Name "看门狗日志 bootTicket" -Value ("lastLineContainsBootTicketTrue=$hasFlag lastLine=" + $safeLast) -Verdict $verdict
}

Invoke-CheckedItem -Id "5.5-18" -Name "错误桥接令牌 USB 探测" -Body {
  if (-not $IncludeBridgeProbe) {
    Add-EvidenceRow -Id "5.5-18" -Name "错误桥接令牌 USB 探测" -Value "未执行（需 -IncludeBridgeProbe）" -Verdict "UNKNOWN"
    return
  }
  $uri = "http://127.0.0.1:$($script:LocalApiPort)/local/usb/status"
  $probe = Invoke-LocalHttp -Method GET -Uri $uri -Origin $KioskOrigin -BridgeToken "field-evidence-invalid"
  $code = $null
  try {
    $parsed = $probe.Content | ConvertFrom-Json -ErrorAction Stop
    $errorObject = Get-JsonNode $parsed "error"
    $code = Get-JsonNode $errorObject "code"
  } catch { }
  $value = "status=$($probe.StatusCode) code=$code"
  $verdict = "FAIL"
  if ([int]$probe.StatusCode -eq 403 -and [string]$code -eq "LOCAL_USB_BRIDGE_TOKEN_INVALID") { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.5-18" -Name "错误桥接令牌 USB 探测" -Value $value -Verdict $verdict
}

# --- 5.6 printer ---

Invoke-CheckedItem -Id "5.6-19" -Name "打印机队列存在" -Body {
  if ([string]::IsNullOrWhiteSpace($script:EffectivePrinterName)) {
    throw "printerName is not set in config or -PrinterName"
  }
  $printer = Get-Printer | Where-Object { $_.Name -eq $script:EffectivePrinterName } | Select-Object -First 1
  if ($null -eq $printer) {
    Add-EvidenceRow -Id "5.6-19" -Name "打印机队列存在" -Value "missing printerName=$($script:EffectivePrinterName)" -Verdict "FAIL"
    return
  }
  $value = "Name=$($printer.Name) DriverName=$($printer.DriverName) PortName=$($printer.PortName) PrinterStatus=$($printer.PrinterStatus)"
  Add-EvidenceRow -Id "5.6-19" -Name "打印机队列存在" -Value $value -Verdict "PASS"
}

Invoke-CheckedItem -Id "5.6-20" -Name "Win32_Printer 原始状态" -Body {
  if ([string]::IsNullOrWhiteSpace($script:EffectivePrinterName)) {
    throw "printerName is not set in config or -PrinterName"
  }
  $printer = Get-CimInstance Win32_Printer -ErrorAction Stop | Where-Object { $_.Name -eq $script:EffectivePrinterName } | Select-Object -First 1
  if ($null -eq $printer) {
    Add-EvidenceRow -Id "5.6-20" -Name "Win32_Printer 原始状态" -Value "not_found printerName=$($script:EffectivePrinterName)" -Verdict "FAIL"
    return
  }
  $printerStatus = $printer.PrinterStatus
  $detectedErrorState = $printer.DetectedErrorState
  $workOffline = $printer.WorkOffline
  $value = "PrinterStatus=$printerStatus DetectedErrorState=$detectedErrorState WorkOffline=$workOffline"
  $verdict = "PASS"
  if ([string]$workOffline -eq "True" -or $workOffline -eq $true) { $verdict = "FAIL" }
  Add-EvidenceRow -Id "5.6-20" -Name "Win32_Printer 原始状态" -Value $value -Verdict $verdict
}

Invoke-CheckedItem -Id "5.6-21" -Name "打印队列作业数" -Body {
  if ([string]::IsNullOrWhiteSpace($script:EffectivePrinterName)) {
    throw "printerName is not set in config or -PrinterName"
  }
  $jobs = @(Get-PrintJob -PrinterName $script:EffectivePrinterName -ErrorAction Stop)
  $count = $jobs.Count
  $verdict = "FAIL"
  if ($count -eq 0) { $verdict = "PASS" }
  Add-EvidenceRow -Id "5.6-21" -Name "打印队列作业数" -Value "count=$count" -Verdict $verdict
}

$collectedAt = [DateTimeOffset]::Now.ToString("yyyy-MM-ddTHH:mm:ssK")
$builder = New-Object System.Text.StringBuilder
[void]$builder.AppendLine("# 现场取证 $collectedAt 终端 $($script:TerminalCode)")
[void]$builder.AppendLine("")
[void]$builder.AppendLine("| 清单项 | 项名 | 实测值 | 判定 |")
[void]$builder.AppendLine("| --- | --- | --- | --- |")
foreach ($row in $script:Rows) {
  [void]$builder.AppendLine("| $($row.Id) | $($row.Name) | $($row.Value) | $($row.Verdict) |")
}
[void]$builder.AppendLine("")
[void]$builder.AppendLine("## 需人工确认")
[void]$builder.AppendLine("- 打印确认页按钮可用，主流程全屏无系统弹窗阻断")
[void]$builder.AppendLine("- Edge/Chrome 实际进入全屏 Kiosk / Assigned Access 的观感与触控")
[void]$builder.AppendLine("- 彩色 / 双面 / 份数 / 测试 PDF 真实出纸，以及订单 completed/failed 回传")
[void]$builder.AppendLine("- 断网恢复、停用即拒、两台终端交叉领取")
[void]$builder.AppendLine("- 扫描、U 盘插入识别、扫码器输入不串扰")
[void]$builder.AppendLine("- HTTPS Kiosk 是否被 mixed content / Private Network Access 阻断 127.0.0.1")
[void]$builder.AppendLine("- Agent 日志正文是否含用户文件或密钥（本脚本不读日志内容）")
[void]$builder.AppendLine("- 活动时段是否覆盖营业时间（本脚本只读注册表起止小时）")
[void]$builder.AppendLine("- 看门狗 -File 路径是否指向当前安装目录而非旧 worktree/旧盘符")

$markdown = $builder.ToString()
Write-Output $markdown

if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
  try {
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($OutFile, $markdown, $utf8Bom)
  } catch {
    Write-Error ("ERROR writing OutFile: " + $_.Exception.Message)
  }
}
