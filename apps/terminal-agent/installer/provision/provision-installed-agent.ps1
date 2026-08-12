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
  -AgentVersion "0.4.3-production" `
  -ReplaceLocalApiAllowedOrigins `
  -LocalApiAllowedOrigins "https://zyidai.cn"
if ($LASTEXITCODE -ne 0) { Fail "设备绑定未完成，错误码 $LASTEXITCODE" }

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
Write-Host "CONFIG SUCCESS - 设备已绑定，可以打开 zyidai.cn" -ForegroundColor Green
Start-Process "http://127.0.0.1:9527/local/panel"
