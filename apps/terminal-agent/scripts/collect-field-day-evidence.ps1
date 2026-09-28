# AI Job Print Terminal — field test day 1 (P0-9) read-only evidence
#
# 现场测试日一（next-tasks 1.7 / P0-9）的只读取证：系统版本与支持期、锁机手段、Edge 一体机策略、
# 远程工具、断电重启后的残留（扫描目录、_unclaimed、打印临时目录、一体机浏览器配置目录）、单实例锁。
# 拔网线、断电、按键逃逸、插新键盘这些动作要人在现场做；本脚本在动作前后各跑一次，把能机械核对的值
# 写成回执，步骤与判定口径见 docs/device/windows-golden-image-and-install-checklist.md「现场测试日一」。
#
# Windows PowerShell 5.1，管理员运行。除可选 -OutFile 外不写任何东西；不读文件内容，不输出文件名与账户名。
# 它不打进安装包、由 Windows PowerShell 5.1 直接运行，所以仓库里保存为 UTF-8 BOM。
# collect-field-evidence.ps1 已超过 800 行（CLAUDE.md §8 不得再加功能），测试日一的检查单独放在这里。

[CmdletBinding()]
param(
  [string]$ConfigPath,
  [string]$OutFile,
  [string]$KioskOrigin = "https://zyidai.cn"
)

$ErrorActionPreference = "Continue"
$programDataDir = Join-Path $env:ProgramData "AIJobPrintAgent"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $programDataDir "agent-config.json" }
$script:Rows = @()
$now = Get-Date

function Add-Row([string]$Id, [string]$Name, [string]$Value, [string]$Verdict) {
  if (@("PASS", "FAIL", "WARN", "MANUAL", "UNKNOWN") -notcontains $Verdict) { $Verdict = "UNKNOWN" }
  $flat = ([regex]::Replace([string]$Value, "[\r\n]+", " ")).Replace("|", "/").Trim()
  $script:Rows += [pscustomobject]@{ Id = $Id; Name = $Name; Value = $flat; Verdict = $Verdict }
}

function Invoke-Check([string]$Id, [string]$Name, [scriptblock]$Body) {
  try { & $Body } catch {
    $message = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) { $message = [string]$_ }
    Add-Row $Id $Name ("ERROR: " + $message) "UNKNOWN"
  }
}

function Get-RegValue([string]$Path, [string]$Name) {
  try { return (Get-ItemProperty -LiteralPath $Path -Name $Name -ErrorAction Stop).$Name } catch { return $null }
}

function Get-RegListValues([string]$Path) {
  try {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    return @($item.GetValueNames() | ForEach-Object { [string]$item.GetValue($_) })
  } catch { return @() }
}

function Get-FileAgeSummary([string]$Directory, [string]$Filter = "*") {
  $files = @(Get-ChildItem -LiteralPath $Directory -File -Force -Filter $Filter -ErrorAction Stop)
  if ($files.Count -eq 0) { return [pscustomobject]@{ Count = 0; OldestMinutes = 0 } }
  $oldest = ($files | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime
  return [pscustomobject]@{ Count = $files.Count; OldestMinutes = [int]($now - $oldest).TotalMinutes }
}

function Get-OptionalFeatureState([string]$FeatureName) {
  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName -ErrorAction Stop
    if ($null -eq $feature) { return "not_available" }
    return [string]$feature.State
  } catch { return "not_available" }
}

# ── 读配置（只取扫描目录；不输出任何配置内容）──────────────────────────────────
$scanWatchFolder = $null
try {
  $config = [System.IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
  $scanWatchFolder = [string]$config.scanWatchFolder
} catch { $scanWatchFolder = $null }

$agentService = $null
try { $agentService = Get-CimInstance Win32_Service -Filter "Name='aijobprintagent.exe'" -ErrorAction Stop } catch { $agentService = $null }
$agentUptimeMinutes = $null
if ($null -ne $agentService -and [int]$agentService.ProcessId -gt 0) {
  try { $agentUptimeMinutes = [int]($now - (Get-Process -Id ([int]$agentService.ProcessId) -ErrorAction Stop).StartTime).TotalMinutes } catch { $agentUptimeMinutes = $null }
}
$lastBoot = $null
try { $lastBoot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime } catch { $lastBoot = $null }

# ── D1 系统版本、支持期与锁机手段 ───────────────────────────────────────────────
# 支持期取自 learn.microsoft.com 生命周期页（2026-09-29 核对）。只按今天的日期比较：过期自动转 FAIL，
# 表里没有的版本一律 UNKNOWN（去官方页查），绝不当作通过。新版本发布后在这里补一行。
$endOfService = @{
  "19044|iotltsc" = "2032-01-13"; "19044|ltsc" = "2027-01-12"
  "19045|pro" = "2025-10-14"; "19045|ent" = "2025-10-14"
  "22000|pro" = "2023-10-10"; "22000|ent" = "2024-10-08"
  "22621|pro" = "2024-10-08"; "22621|ent" = "2025-10-14"
  "22631|pro" = "2025-11-11"; "22631|ent" = "2026-11-10"
  "26100|pro" = "2026-10-13"; "26100|ent" = "2027-10-12"; "26100|ltsc" = "2029-10-09"; "26100|iotltsc" = "2034-10-10"
  "26200|pro" = "2027-10-12"; "26200|ent" = "2028-10-10"
}

Invoke-Check "D1-1" "系统版本与支持期" {
  $cv = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
  $edition = [string](Get-RegValue $cv "EditionID")
  $build = [string](Get-RegValue $cv "CurrentBuildNumber")
  $display = [string](Get-RegValue $cv "DisplayVersion")
  $class = switch -Regex ($edition) {
    "^IoTEnterpriseS" { "iotltsc"; break }
    "^EnterpriseS" { "ltsc"; break }
    "^(IoTEnterprise|Enterprise|Education)" { "ent"; break }
    "^Professional" { "pro"; break }
    "^Core" { "home"; break }
    "^Server" { "server"; break }
    default { "other" }
  }
  $value = "edition=$edition build=$build displayVersion=$display class=$class"
  if ($class -eq "home") { Add-Row "D1-1" "系统版本与支持期" "$value 家庭版没有分配访问，不能做一体机" "FAIL"; return }
  if ($class -eq "server" -or $class -eq "other") { Add-Row "D1-1" "系统版本与支持期" "$value 不是一体机系统" "UNKNOWN"; return }
  $eos = $endOfService["$build|$class"]
  if ([string]::IsNullOrWhiteSpace($eos)) { Add-Row "D1-1" "系统版本与支持期" "$value 不在已核对的支持期表里，查 learn.microsoft.com 生命周期页" "UNKNOWN"; return }
  $daysLeft = [int]([datetime]::ParseExact($eos, "yyyy-MM-dd", $null) - $now.Date).TotalDays
  $note = switch ($class) {
    "pro" { " 专业版无键盘筛选器与 Shell Launcher，拦不住 Ctrl+Alt+Del；母盘首选 IoT 企业版 LTSC 2024" }
    "ltsc" { " 非 IoT 的 LTSC：授权不可随机转让，母盘不推荐" }
    default { "" }
  }
  $value = "$value endOfService=$eos daysLeft=$daysLeft$note"
  if ($daysLeft -lt 0) { Add-Row "D1-1" "系统版本与支持期" "$value 已停止安全更新" "FAIL" }
  elseif ($daysLeft -lt 90 -or $class -eq "ltsc") { Add-Row "D1-1" "系统版本与支持期" $value "WARN" }
  else { Add-Row "D1-1" "系统版本与支持期" $value "PASS" }
}

Invoke-Check "D1-2" "分配访问与自动登录" {
  $aaKey = Test-Path -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\AssignedAccessConfiguration"
  $aaCmdlet = "cmdlet_unavailable"
  if (Get-Command Get-AssignedAccess -ErrorAction SilentlyContinue) {
    try { $aaCmdlet = "entries=" + @(Get-AssignedAccess -ErrorAction Stop).Count } catch { $aaCmdlet = "unavailable" }
  }
  $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  $autoLogon = [string](Get-RegValue $winlogon "AutoAdminLogon")
  $defaultUserSet = -not [string]::IsNullOrWhiteSpace([string](Get-RegValue $winlogon "DefaultUserName"))
  $consoleUserIsAdmin = "unknown"
  try {
    $consoleUser = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
    if ([string]::IsNullOrWhiteSpace($consoleUser)) { $consoleUserIsAdmin = "no_console_user" }
    else {
      $members = @(Get-LocalGroupMember -SID "S-1-5-32-544" -ErrorAction Stop | ForEach-Object { [string]$_.Name })
      $consoleUserIsAdmin = [string]($members -contains $consoleUser)
    }
  } catch { $consoleUserIsAdmin = "unknown" }
  $value = "assignedAccessConfigKey=$aaKey getAssignedAccess=$aaCmdlet autoAdminLogon=$autoLogon defaultUserNameSet=$defaultUserSet consoleUserIsAdmin=$consoleUserIsAdmin 逃逸键须按清单手测"
  Add-Row "D1-2" "分配访问与自动登录" $value "MANUAL"
}

Invoke-Check "D1-3" "Shell Launcher / 键盘筛选器 / 写入筛选器" {
  $shell = Get-OptionalFeatureState "Client-EmbeddedShellLauncher"
  $keyboard = Get-OptionalFeatureState "Client-KeyboardFilter"
  $uwf = Get-OptionalFeatureState "Client-UnifiedWriteFilter"
  $blocked = "n/a"
  if ($keyboard -eq "Enabled") {
    try {
      $keys = @(Get-CimInstance -Namespace "root\standardcimv2\embedded" -ClassName WEKF_PredefinedKey -ErrorAction Stop | Where-Object { $_.Enabled })
      $blocked = "enabledPredefinedKeys=" + $keys.Count + " ctrlAltDel=" + [string](@($keys | Where-Object { $_.Id -eq "Ctrl+Alt+Del" }).Count -gt 0)
    } catch { $blocked = "unavailable" }
  }
  Add-Row "D1-3" "Shell Launcher / 键盘筛选器 / 写入筛选器" "shellLauncher=$shell keyboardFilter=$keyboard $blocked unifiedWriteFilter=$uwf（专业版上都是 not_available）" "MANUAL"
}

Invoke-Check "D1-4" "阻止新插入的键盘类设备" {
  $root = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\Restrictions"
  $keyboardClass = "{4d36e96b-e325-11ce-bfc1-08002be10318}"
  $hidClass = "{745a17a0-74d3-11d0-b6fe-00a0c90f57da}"
  $denyOn = [string](Get-RegValue $root "DenyDeviceClasses") -eq "1"
  $denied = @(Get-RegListValues (Join-Path $root "DenyDeviceClasses") | ForEach-Object { $_.ToLowerInvariant() })
  $retro = [string](Get-RegValue $root "DenyDeviceClassesRetroactive") -eq "1"
  $layered = [string](Get-RegValue $root "AllowDenyLayered") -eq "1"
  $allowed = @(Get-RegListValues (Join-Path $root "AllowDeviceInstanceIDs")).Count
  $keyboardDenied = $denyOn -and ($denied -contains $keyboardClass)
  $hidDenied = $denyOn -and ($denied -contains $hidClass)
  $value = "keyboardClassDenied=$keyboardDenied hidClassDenied=$hidDenied retroactive=$retro layeredOrder=$layered allowedInstanceIds=$allowed"
  if ($hidDenied) { Add-Row "D1-4" "阻止新插入的键盘类设备" "$value 挡了 HID 类会连触摸屏一起挡掉" "FAIL" }
  elseif ($keyboardDenied -and $retro) { Add-Row "D1-4" "阻止新插入的键盘类设备" "$value 追溯阻止会让已装好的扫码枪失效" "FAIL" }
  elseif ($keyboardDenied -and $layered) { Add-Row "D1-4" "阻止新插入的键盘类设备" "$value 仍须插一把新键盘手测" "PASS" }
  else { Add-Row "D1-4" "阻止新插入的键盘类设备" "$value 正式终端必须配置（见清单）" "WARN" }
}

Invoke-Check "D1-5" "Edge 一体机策略" {
  $edge = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
  $lna = @(Get-RegListValues (Join-Path $edge "LocalNetworkAccessAllowedForUrls"))
  $mic = @(Get-RegListValues (Join-Path $edge "AudioCaptureAllowedUrls"))
  $fileDialogs = Get-RegValue $edge "AllowFileSelectionDialogs"
  $lnaOk = $lna -contains $KioskOrigin
  $micOk = $mic -contains $KioskOrigin
  $value = "localNetworkAccess=$lnaOk audioCapture=$micOk allowFileSelectionDialogs=$fileDialogs origin=$KioskOrigin"
  if (-not $lnaOk -or -not $micOk) { Add-Row "D1-5" "Edge 一体机策略" "$value 缺少时每次浏览器重启都要人点允许" "FAIL" }
  elseif ([string]$fileDialogs -ne "0") { Add-Row "D1-5" "Edge 一体机策略" "$value 专用一体机账号上须禁用文件选择框" "WARN" }
  else { Add-Row "D1-5" "Edge 一体机策略" $value "PASS" }
}

Invoke-Check "D1-6" "远程工具与远程桌面" {
  $pattern = "UU远程|uu.?remote|todesk|sunlogin|oray|teamviewer|anydesk|rustdesk|splashtop|parsec"
  $services = @(Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object { $_.Name -match $pattern -or $_.DisplayName -match $pattern } | ForEach-Object { "$($_.Name)[$($_.State)/$($_.StartMode)]" })
  $processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $pattern } | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)
  $rdpDenied = Get-RegValue "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" "fDenyTSConnections"
  $value = "services=" + ($services -join ",") + " processes=" + ($processes -join ",") + " rdpDisabled=" + ([string]$rdpDenied -eq "1") + " 只许保留经批准的一款，规则见 P1-12"
  Add-Row "D1-6" "远程工具与远程桌面" $value "MANUAL"
}

Invoke-Check "D1-7" "睡眠与来电开机" {
  $sleep = "unknown"
  try {
    $hex = @([regex]::Matches((& powercfg.exe /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Out-String), "0x([0-9a-fA-F]{8})") | ForEach-Object { $_.Groups[1].Value })
    if ($hex.Count -ge 2) { $sleep = [string][Convert]::ToInt32($hex[$hex.Count - 2], 16) }
  } catch { $sleep = "unknown" }
  $value = "acSleepAfterSeconds=$sleep BIOS 来电自动开机须进 BIOS 手查"
  if ($sleep -eq "0") { Add-Row "D1-7" "睡眠与来电开机" $value "MANUAL" }
  elseif ($sleep -eq "unknown") { Add-Row "D1-7" "睡眠与来电开机" $value "UNKNOWN" }
  else { Add-Row "D1-7" "睡眠与来电开机" "$value 接电源时不应自动睡眠" "WARN" }
}

# ── D2 断电重启后的残留与单实例 ─────────────────────────────────────────────────
Invoke-Check "D2-0" "开机与 Agent 运行时长" {
  $bootText = $(if ($null -ne $lastBoot) { $lastBoot.ToString("s") } else { "unknown" })
  $state = $(if ($null -ne $agentService) { "$($agentService.State)/$($agentService.StartMode)" } else { "not_installed" })
  $value = "lastBoot=$bootText agentService=$state agentUptimeMinutes=$agentUptimeMinutes"
  if ($null -eq $agentService) { Add-Row "D2-0" "开机与 Agent 运行时长" $value "UNKNOWN" }
  elseif ($agentService.State -eq "Running" -and $agentService.StartMode -eq "Auto") { Add-Row "D2-0" "开机与 Agent 运行时长" $value "PASS" }
  else { Add-Row "D2-0" "开机与 Agent 运行时长" "$value 断电重启后应为 Running/Auto" "FAIL" }
}

Invoke-Check "D2-1" "扫描目录残留" {
  if ([string]::IsNullOrWhiteSpace($scanWatchFolder) -or -not (Test-Path -LiteralPath $scanWatchFolder -PathType Container)) {
    Add-Row "D2-1" "扫描目录残留" "scanWatchFolder 未配置或不存在" "UNKNOWN"; return
  }
  $root = Get-FileAgeSummary $scanWatchFolder
  $value = "files=$($root.Count) oldestMinutes=$($root.OldestMinutes)（只计数，不列文件名）"
  # 投递失败最多重试 2 小时（scan-watcher.ts），之后应移入 _unclaimed；清扫每 5 分钟一次。
  if ($root.Count -eq 0) { Add-Row "D2-1" "扫描目录残留" $value "PASS" }
  elseif ($root.OldestMinutes -gt 130) { Add-Row "D2-1" "扫描目录残留" "$value 超过 2 小时仍在根目录，扫描监听没在工作" "FAIL" }
  else { Add-Row "D2-1" "扫描目录残留" "$value 可能是刚扫的，2 分钟后重跑" "WARN" }
}

Invoke-Check "D2-2" "_unclaimed 隔离目录" {
  if ([string]::IsNullOrWhiteSpace($scanWatchFolder)) { Add-Row "D2-2" "_unclaimed 隔离目录" "scanWatchFolder 未配置" "UNKNOWN"; return }
  $unclaimed = Join-Path $scanWatchFolder "_unclaimed"
  if (-not (Test-Path -LiteralPath $unclaimed -PathType Container)) { Add-Row "D2-2" "_unclaimed 隔离目录" "目录不存在（从未隔离过）" "PASS"; return }
  $summary = Get-FileAgeSummary $unclaimed
  $value = "files=$($summary.Count) oldestHours=$([math]::Round($summary.OldestMinutes / 60, 1))（只计数，不列文件名）"
  if ($summary.OldestMinutes -gt (24 * 60 + 10)) { Add-Row "D2-2" "_unclaimed 隔离目录" "$value 超过 24 小时未删，身份证与简历类扫描件在本地滞留" "FAIL" }
  else { Add-Row "D2-2" "_unclaimed 隔离目录" $value "PASS" }
}

Invoke-Check "D2-3" "打印临时目录残留" {
  $temp = Join-Path $programDataDir "temp"
  if (-not (Test-Path -LiteralPath $temp -PathType Container)) { Add-Row "D2-3" "打印临时目录残留" "目录不存在" "PASS"; return }
  $summary = Get-FileAgeSummary $temp "task_*"
  $value = "taskFiles=$($summary.Count) oldestMinutes=$($summary.OldestMinutes)（只计数，不列文件名）"
  if ($summary.Count -eq 0) { Add-Row "D2-3" "打印临时目录残留" $value "PASS" }
  elseif ($null -ne $agentUptimeMinutes -and $agentUptimeMinutes -ge 2 -and $summary.OldestMinutes -gt $agentUptimeMinutes) {
    Add-Row "D2-3" "打印临时目录残留" "$value 早于本次 Agent 启动，启动清理没有清掉" "FAIL"
  } else { Add-Row "D2-3" "打印临时目录残留" "$value 若此刻没有在打印，应为 0" "WARN" }
}

Invoke-Check "D2-4" "一体机浏览器配置目录" {
  $usersRoot = Join-Path $env:SystemDrive "Users"
  $skip = @("Public", "Default", "Default User", "All Users")
  $index = 0
  $found = $false
  foreach ($userDir in @(Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction Stop | Where-Object { $skip -notcontains $_.Name })) {
    $profileDir = Join-Path $userDir.FullName "AppData\Local\AIJobPrintKiosk\profile"
    if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) { continue }
    $found = $true
    $index += 1
    $parts = @()
    foreach ($relative in @("Default\Cache", "Default\Code Cache", "Default\Local Storage", "Default\IndexedDB", "Default\Session Storage", "Default\Network\Cookies")) {
      $path = Join-Path $profileDir $relative
      if (-not (Test-Path -LiteralPath $path)) { $parts += "$relative=absent"; continue }
      $item = Get-Item -LiteralPath $path -Force
      if ($item.PSIsContainer) {
        $bytes = (Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      } else {
        $bytes = $item.Length
      }
      $written = $item.LastWriteTime.ToString("s")
      $parts += "$relative=$([math]::Round(([double]$bytes) / 1KB))KB@$written"
    }
    # 账户名不输出（KSK-001 上就是产品负责人本人的账户）。
    Add-Row "D2-4" "一体机浏览器配置目录 #$index" ($parts -join " ") "MANUAL"
  }
  if (-not $found) { Add-Row "D2-4" "一体机浏览器配置目录" "没有找到 AIJobPrintKiosk\profile" "UNKNOWN" }
}

Invoke-Check "D2-5" "单实例锁" {
  $idPath = Join-Path $programDataDir "instance-id"
  if (-not (Test-Path -LiteralPath $idPath -PathType Leaf)) { Add-Row "D2-5" "单实例锁" "instance-id 不存在（首次启动时由 Agent 生成）" "UNKNOWN"; return }
  $id = ([System.IO.File]::ReadAllText($idPath)).Trim()
  # 规则与 apps/terminal-agent/src/agent/instance-lock.ts 的 MACHINE_ID_RE 一致。只列管道名，不连接。
  if ($id -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$') { Add-Row "D2-5" "单实例锁" "instance-id 格式无效，Agent 会拒绝启动" "FAIL"; return }
  $pipes = @([System.IO.Directory]::GetFiles('\\.\pipe\') | ForEach-Object { Split-Path -Leaf $_ })
  $present = $pipes -contains "AIJobPrintAgent-$id"
  $running = ($null -ne $agentService -and $agentService.State -eq "Running")
  $value = "instanceId=valid singletonPipePresent=$present agentRunning=$running agent.pid 只是诊断记录，不需要删除"
  if ($running -and $present) { Add-Row "D2-5" "单实例锁" $value "PASS" }
  elseif ($running -and -not $present) { Add-Row "D2-5" "单实例锁" "$value 服务在跑却没有管道，上报" "FAIL" }
  else { Add-Row "D2-5" "单实例锁" $value "UNKNOWN" }
}

Invoke-Check "D2-6" "最近一次启动诊断" {
  $diagnosticPath = Join-Path $programDataDir "last-startup-diagnostic.json"
  if (-not (Test-Path -LiteralPath $diagnosticPath -PathType Leaf)) { Add-Row "D2-6" "最近一次启动诊断" "没有诊断文件" "UNKNOWN"; return }
  $diagnostic = [System.IO.File]::ReadAllText($diagnosticPath) | ConvertFrom-Json
  $code = [string]$diagnostic.code
  $recorded = [datetime]::Parse([string]$diagnostic.recordedAt)
  $afterBoot = ($null -ne $lastBoot -and $recorded -gt $lastBoot)
  $value = "code=$code recordedAt=$($recorded.ToString('s')) afterLastBoot=$afterBoot"
  if ($code -eq "AGENT_READY" -and $afterBoot) { Add-Row "D2-6" "最近一次启动诊断" $value "PASS" }
  elseif ($code -eq "AGENT_READY") { Add-Row "D2-6" "最近一次启动诊断" "$value 本次开机后还没写过就绪记录" "WARN" }
  else { Add-Row "D2-6" "最近一次启动诊断" $value "FAIL" }
}

$collectedAt = [DateTimeOffset]::Now.ToString("yyyy-MM-ddTHH:mm:ssK")
$builder = New-Object System.Text.StringBuilder
[void]$builder.AppendLine("# 现场测试日一取证 $collectedAt")
[void]$builder.AppendLine("")
[void]$builder.AppendLine("| 清单项 | 项名 | 实测值 | 判定 |")
[void]$builder.AppendLine("| --- | --- | --- | --- |")
foreach ($row in $script:Rows) { [void]$builder.AppendLine("| $($row.Id) | $($row.Name) | $($row.Value) | $($row.Verdict) |") }
[void]$builder.AppendLine("")
[void]$builder.AppendLine("## 需人工在现场做并记录（本脚本在动作前后各跑一次）")
[void]$builder.AppendLine("- 拔网线：顶栏出现离线提示；闲置到时照常清场回首页；插回后自动恢复在线")
[void]$builder.AppendLine("- 断电重启：拔电源再上电，机器自动开机、自动登录、一体机自动全屏；重跑本脚本看 D2 各项")
[void]$builder.AppendLine("- 逃逸键：Win、Alt+Tab、Alt+F4、Ctrl+Shift+Esc、Ctrl+Alt+Del、屏幕边缘滑动，都不能离开一体机界面")
[void]$builder.AppendLine("- 新键盘：插一把没登记过的 USB 键盘，应无法使用；原有扫码枪照常可用")
[void]$builder.AppendLine("- 机箱与打印机位上锁，钥匙由谁保管写进回执")
$markdown = $builder.ToString()
Write-Output $markdown
if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
  try { [System.IO.File]::WriteAllText($OutFile, $markdown, (New-Object System.Text.UTF8Encoding $true)) }
  catch { Write-Error ("ERROR writing OutFile: " + $_.Exception.Message) }
}
exit 0
