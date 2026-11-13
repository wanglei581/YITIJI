# AI Job Print Terminal - post-MSI device binding wizard

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Fail([string]$Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

# print-service-operational-log-begin
function Enable-PrintServiceOperationalLog {
  $logName = "Microsoft-Windows-PrintService/Operational"
  Write-Host "==> Enabling print completion event log" -ForegroundColor Cyan
  $previousNative = $PSNativeCommandUseErrorActionPreference
  $PSNativeCommandUseErrorActionPreference = $false
  try {
    & wevtutil.exe sl $logName /e:true
    $enableExit = $LASTEXITCODE
    if ($enableExit -ne 0) {
      Fail "没能启用打印完成事件日志 ${logName}（wevtutil sl 退出码 $enableExit）。安装停在这里，没有静默跳过。不启用的话，打成功的单会被记成结果未确认。"
    }
    $listed = & wevtutil.exe gl $logName 2>&1
    $listExit = $LASTEXITCODE
    $listedText = $listed | Out-String
    if ($listExit -ne 0) {
      Fail "没能核对打印完成事件日志 ${logName}（wevtutil gl 退出码 $listExit）。输出：$listedText"
    }
    if ($listedText -notmatch '(?m)^\s*enabled:\s*true\s*$') {
      Fail "打印完成事件日志 ${logName} 仍未启用。wevtutil gl 输出：$listedText"
    }
  } finally {
    $PSNativeCommandUseErrorActionPreference = $previousNative
  }
  Write-Host "[OK] Print completion event log is enabled: $logName" -ForegroundColor Green
}
# print-service-operational-log-end

if (-not (Test-IsAdministrator)) {
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"{0}"' -f $PSCommandPath)
  )
  $elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $elevated.ExitCode
}

$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$agentRoot = Join-Path $installRoot "app"
$productionScript = Join-Path $PSScriptRoot "install-production-agent.ps1"

Write-Host ""
Write-Host "AI 求职打印服务终端 - 设备绑定向导" -ForegroundColor Cyan
Write-Host "绑定码只用于本次兑换，不会写入日志或安装包。"
Write-Host ""

if (-not (Test-Path -LiteralPath $productionScript -PathType Leaf)) {
  Fail "配置组件缺失，请修复 MSI 安装后重试"
}
if (-not (Test-Path -LiteralPath (Join-Path $agentRoot "dist\index.js") -PathType Leaf)) {
  Fail "Agent 运行文件缺失，请修复 MSI 安装后重试"
}

$printers = @(Get-Printer -ErrorAction Stop | Sort-Object Name)
if ($printers.Count -eq 0) { Fail "没有发现 Windows 打印机，请先安装打印机驱动" }

Write-Host "请选择本终端使用的打印机：" -ForegroundColor Yellow
for ($index = 0; $index -lt $printers.Count; $index++) {
  Write-Host ("  [{0}] {1}" -f ($index + 1), $printers[$index].Name)
}

$selection = Read-Host "输入序号"
$selectedIndex = 0
if (-not [int]::TryParse($selection, [ref]$selectedIndex) -or $selectedIndex -lt 1 -or $selectedIndex -gt $printers.Count) {
  Fail "打印机序号无效"
}
$printerName = [string]$printers[$selectedIndex - 1].Name

& $productionScript `
  -ApiBaseUrl "https://zyidai.cn/api/v1" `
  -PromptForBindCode `
  -PrinterName $printerName `
  -InstalledAgentRoot $agentRoot `
  -AgentVersion "0.4.23-production" `
  -ReplaceLocalApiAllowedOrigins `
  -LocalApiAllowedOrigins "https://zyidai.cn"
if ($LASTEXITCODE -ne 0) { Fail "设备绑定未完成，错误码 $LASTEXITCODE" }

Enable-PrintServiceOperationalLog

Write-Host ""
Write-Host "==> 验证本机二维码登录链路" -ForegroundColor Cyan
Start-Sleep -Seconds 2
$origin = "https://zyidai.cn"
try {
  $sessionResponse = Invoke-RestMethod `
    -Uri "http://127.0.0.1:9527/local/bridge/session" `
    -Method Post `
    -Headers @{ Origin = $origin } `
    -TimeoutSec 10
  $sessionToken = [string]$sessionResponse.data.token
  if ([string]::IsNullOrWhiteSpace($sessionToken)) { throw "local session token missing" }
  $qrResponse = Invoke-RestMethod `
    -Uri "http://127.0.0.1:9527/local/qr-login/create" `
    -Method Post `
    -Headers @{ Origin = $origin; "X-Local-Bridge-Token" = $sessionToken } `
    -ContentType "application/json" `
    -Body '{"returnTo":"/"}' `
    -TimeoutSec 15
  if ([string]::IsNullOrWhiteSpace([string]$qrResponse.data.ticketId)) { throw "QR ticket missing" }
  $sessionToken = $null
  Write-Host "[OK] 9527、本机身份、短期会话和二维码创建均通过" -ForegroundColor Green
} catch {
  $sessionToken = $null
  Fail "本机二维码登录自检失败：$($_.Exception.Message)"
}

Write-Host ""
Write-Host "==> 注册 Kiosk 浏览器看门狗（登录后自动全屏打开 $origin）" -ForegroundColor Cyan
$kioskRegister = Join-Path $installRoot "kiosk\register-kiosk-watchdog.ps1"
if (-not (Test-Path -LiteralPath $kioskRegister -PathType Leaf)) {
  Fail "Kiosk 看门狗组件缺失，请修复 MSI 安装后重试"
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $kioskRegister -Url ($origin + "/") -Browser auto
if ($LASTEXITCODE -ne 0) { Fail "Kiosk 看门狗注册未完成，错误码 $LASTEXITCODE" }
Write-Host "[OK] 计划任务 AIJobPrintKioskWatchdog 已注册：下次登录自动进入全屏，浏览器退出会被自动拉起" -ForegroundColor Green

Write-Host ""
Write-Host "CONFIG SUCCESS - 设备已绑定，可以打开 zyidai.cn" -ForegroundColor Green
Start-Process "http://127.0.0.1:9527/local/panel"
