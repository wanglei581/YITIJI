[CmdletBinding()]
param(
  [switch]$SmokeTest,
  [string]$SmokeTestOutput
)

$ErrorActionPreference = "Stop"
$serviceName = "aijobprintagent.exe"
$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$agentRoot = Join-Path $installRoot "app"
$productionScript = Join-Path $PSScriptRoot "install-production-agent.ps1"
$configRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$configPath = Join-Path $configRoot "agent-config.json"
$tokenPath = Join-Path $configRoot "agent.token"
$logsRoot = Join-Path $configRoot "logs"
$panelUrl = "http://127.0.0.1:9527/local/panel"
$siteUrl = "https://zyidai.cn"
$apiBase = "https://zyidai.cn/api/v1"
$agentVersion = "0.4.8-production"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-ProcessArgument([string]$Value) {
  if ($null -eq $Value) { return '""' }
  if ($Value -match '["\r\n]') { throw "配置值包含不受支持的控制字符" }
  return '"' + $Value + '"'
}

function Get-AgentService {
  return Get-Service -Name $serviceName -ErrorAction SilentlyContinue
}

function Read-AgentConfig {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $null }
  try {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-ControlCenterSnapshot {
  $service = Get-AgentService
  $config = Read-AgentConfig
  $printers = @()
  try { $printers = @(Get-Printer -ErrorAction Stop | Sort-Object Name | Select-Object -ExpandProperty Name) } catch {}
  return [ordered]@{
    version = $agentVersion.Replace("-production", "")
    installed = Test-Path -LiteralPath (Join-Path $agentRoot "dist\index.js") -PathType Leaf
    configured = $null -ne $config -and (Test-Path -LiteralPath $tokenPath -PathType Leaf)
    terminalCode = if ($null -ne $config) { [string]$config.terminalCode } else { "" }
    printerName = if ($null -ne $config) { [string]$config.printerName } else { "" }
    scanWatchFolder = if ($null -ne $config) { [string]$config.scanWatchFolder } else { "" }
    bridgeConfigured = $null -ne $config -and -not [string]::IsNullOrWhiteSpace([string]$config.localApiBridgeToken)
    serviceInstalled = $null -ne $service
    serviceStatus = if ($null -ne $service) { [string]$service.Status } else { "NotInstalled" }
    printers = @($printers)
  }
}

if ($SmokeTest) {
  $snapshot = Get-ControlCenterSnapshot
  $json = ($snapshot | ConvertTo-Json -Depth 4) + "`n"
  if (-not [string]::IsNullOrWhiteSpace($SmokeTestOutput)) {
    [System.IO.File]::WriteAllText($SmokeTestOutput, $json, [System.Text.UTF8Encoding]::new($false))
  }
  Write-Host "CONTROL_CENTER_SMOKE_PASS installed=$($snapshot.installed) service=$($snapshot.serviceStatus)"
  exit 0
}

if (-not (Test-IsAdministrator)) {
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", (Quote-ProcessArgument $PSCommandPath)
  ) -join " "
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments | Out-Null
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function New-Label([string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height = 24) {
  $control = New-Object System.Windows.Forms.Label
  $control.Text = $Text
  $control.Location = New-Object System.Drawing.Point($X, $Y)
  $control.Size = New-Object System.Drawing.Size($Width, $Height)
  $control.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)
  $control.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#334155")
  return $control
}

function New-Button([string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height = 38) {
  $control = New-Object System.Windows.Forms.Button
  $control.Text = $Text
  $control.Location = New-Object System.Drawing.Point($X, $Y)
  $control.Size = New-Object System.Drawing.Size($Width, $Height)
  $control.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $control.FlatAppearance.BorderColor = [System.Drawing.ColorTranslator]::FromHtml("#CBD5E1")
  $control.BackColor = [System.Drawing.Color]::White
  $control.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9.5)
  $control.Cursor = [System.Windows.Forms.Cursors]::Hand
  return $control
}

function Add-Log([string]$Message) {
  $time = [DateTime]::Now.ToString("HH:mm:ss")
  $logBox.AppendText("[$time] $Message`r`n")
  $logBox.SelectionStart = $logBox.TextLength
  $logBox.ScrollToCaret()
  [System.Windows.Forms.Application]::DoEvents()
}

function Set-Busy([bool]$Busy, [string]$Message = "") {
  foreach ($control in @($bindButton, $saveButton, $startButton, $restartButton, $refreshButton, $qrButton)) {
    $control.Enabled = -not $Busy
  }
  $form.UseWaitCursor = $Busy
  if (-not [string]::IsNullOrWhiteSpace($Message)) { $statusText.Text = $Message }
  [System.Windows.Forms.Application]::DoEvents()
}

function Invoke-Provisioning([bool]$ReplaceCredential) {
  if (-not (Test-Path -LiteralPath $productionScript -PathType Leaf)) {
    throw "安装包配置组件缺失，请先修复安装"
  }
  if ([string]::IsNullOrWhiteSpace([string]$printerCombo.SelectedItem)) {
    throw "请先选择打印机"
  }

  $arguments = New-Object "System.Collections.Generic.List[string]"
  foreach ($value in @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $productionScript,
    "-ApiBaseUrl", $apiBase,
    "-PrinterName", [string]$printerCombo.SelectedItem,
    "-InstalledAgentRoot", $agentRoot,
    "-AgentVersion", $agentVersion,
    "-ReplaceLocalApiAllowedOrigins",
    "-LocalApiAllowedOrigins", $siteUrl
  )) { $arguments.Add((Quote-ProcessArgument ([string]$value))) }

  $config = Read-AgentConfig
  if ($ReplaceCredential) {
    if ([string]::IsNullOrWhiteSpace($bindCodeBox.Text)) { throw "请输入后台生成的一次性设备绑定码" }
    $arguments.Add("-BindCodeFromStandardInput")
  } else {
    if ($null -eq $config -or -not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
      throw "本机尚未绑定，请先输入一次性绑定码"
    }
    $arguments.Add("-UseExistingToken")
    foreach ($pair in @(
      @("-TerminalId", [string]$config.terminalId),
      @("-TerminalCode", [string]$config.terminalCode)
    )) {
      $arguments.Add($pair[0])
      $arguments.Add((Quote-ProcessArgument $pair[1]))
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($scanFolderBox.Text)) {
    $arguments.Add("-ScanWatchFolder")
    $arguments.Add((Quote-ProcessArgument $scanFolderBox.Text.Trim()))
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = "powershell.exe"
  $startInfo.Arguments = ($arguments -join " ")
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = $ReplaceCredential
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  if ($ReplaceCredential) {
    $oneTimeCode = $bindCodeBox.Text
    $bindCodeBox.Clear()
    $process.StandardInput.WriteLine($oneTimeCode)
    $process.StandardInput.Close()
    $oneTimeCode = $null
  }
  $outputTask = $process.StandardOutput.ReadToEndAsync()
  $errorTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $output = $outputTask.Result
  $errorOutput = $errorTask.Result
  if ($process.ExitCode -ne 0) {
    $detail = (($output + "`n" + $errorOutput) -split "`r?`n" | Where-Object { $_ -match "\[FAIL\]|Exception|error" } | Select-Object -Last 3) -join " "
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = "错误码 $($process.ExitCode)" }
    throw "配置未完成：$detail"
  }
}

function Test-QrBridge {
  $origin = $siteUrl
  $sessionResponse = Invoke-RestMethod -Uri "http://127.0.0.1:9527/local/bridge/session" -Method Post -Headers @{ Origin = $origin } -TimeoutSec 10
  $sessionToken = [string]$sessionResponse.data.token
  if ([string]::IsNullOrWhiteSpace($sessionToken)) { throw "本机会话令牌缺失" }
  try {
    $qrResponse = Invoke-RestMethod -Uri "http://127.0.0.1:9527/local/qr-login/create" -Method Post -Headers @{ Origin = $origin; "X-Local-Bridge-Token" = $sessionToken } -ContentType "application/json" -Body '{"returnTo":"/"}' -TimeoutSec 15
    if ([string]::IsNullOrWhiteSpace([string]$qrResponse.data.ticketId)) { throw "二维码票据缺失" }
  } finally {
    $sessionToken = $null
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "AI 求职打印服务终端 - 控制中心"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(940, 720)
$form.MinimumSize = New-Object System.Drawing.Size(940, 720)
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#F1F5F9")
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(940, 92)
$header.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#0F3D91")
$title = New-Label "AI 求职打印服务终端" 30 18 520 34
$title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 20, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$subtitle = New-Label "设备绑定、打印机与本机服务统一维护" 32 56 520 24
$subtitle.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#DCE8FF")
$header.Controls.AddRange(@($title, $subtitle))
$form.Controls.Add($header)

$summary = New-Object System.Windows.Forms.Panel
$summary.Location = New-Object System.Drawing.Point(24, 112)
$summary.Size = New-Object System.Drawing.Size(884, 82)
$summary.BackColor = [System.Drawing.Color]::White
$summary.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$terminalText = New-Label "终端：尚未绑定" 22 14 280 26
$terminalText.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 11, [System.Drawing.FontStyle]::Bold)
$serviceText = New-Label "服务：正在检查" 316 14 250 26
$versionText = New-Label "版本：0.4.8" 588 14 180 26
$statusText = New-Label "正在读取本机状态…" 22 46 820 24
$statusText.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#64748B")
$summary.Controls.AddRange(@($terminalText, $serviceText, $versionText, $statusText))
$form.Controls.Add($summary)

$settings = New-Object System.Windows.Forms.GroupBox
$settings.Text = "设备配置"
$settings.Location = New-Object System.Drawing.Point(24, 212)
$settings.Size = New-Object System.Drawing.Size(884, 198)
$settings.BackColor = [System.Drawing.Color]::White
$settings.Controls.Add((New-Label "打印机" 22 34 120))
$printerCombo = New-Object System.Windows.Forms.ComboBox
$printerCombo.Location = New-Object System.Drawing.Point(145, 30)
$printerCombo.Size = New-Object System.Drawing.Size(690, 30)
$printerCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$settings.Controls.Add($printerCombo)
$settings.Controls.Add((New-Label "扫描目录" 22 79 120))
$scanFolderBox = New-Object System.Windows.Forms.TextBox
$scanFolderBox.Location = New-Object System.Drawing.Point(145, 75)
$scanFolderBox.Size = New-Object System.Drawing.Size(575, 30)
$browseButton = New-Button "选择目录" 730 72 105 34
$settings.Controls.AddRange(@($scanFolderBox, $browseButton))
$settings.Controls.Add((New-Label "一次性绑定码" 22 124 120))
$bindCodeBox = New-Object System.Windows.Forms.TextBox
$bindCodeBox.Location = New-Object System.Drawing.Point(145, 120)
$bindCodeBox.Size = New-Object System.Drawing.Size(390, 30)
$bindCodeBox.UseSystemPasswordChar = $true
$bindButton = New-Button "绑定 / 更换设备" 550 116 140 38
$bindButton.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#2563EB")
$bindButton.ForeColor = [System.Drawing.Color]::White
$saveButton = New-Button "保存打印配置" 700 116 135 38
$settings.Controls.AddRange(@($bindCodeBox, $bindButton, $saveButton))
$hint = New-Label "绑定码仅经本机进程管道使用，不写入命令行、日志、配置或安装包。" 145 158 690 24
$hint.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#64748B")
$settings.Controls.Add($hint)
$form.Controls.Add($settings)

$actions = New-Object System.Windows.Forms.GroupBox
$actions.Text = "运行与维护"
$actions.Location = New-Object System.Drawing.Point(24, 426)
$actions.Size = New-Object System.Drawing.Size(884, 98)
$actions.BackColor = [System.Drawing.Color]::White
$startButton = New-Button "启动服务" 20 34 120
$restartButton = New-Button "重启服务" 150 34 120
$refreshButton = New-Button "刷新检测" 280 34 120
$panelButton = New-Button "打开运行状态" 410 34 130
$qrButton = New-Button "二维码链路自检" 550 34 140
$logsButton = New-Button "打开日志目录" 700 34 140
$actions.Controls.AddRange(@($startButton, $restartButton, $refreshButton, $panelButton, $qrButton, $logsButton))
$form.Controls.Add($actions)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(24, 542)
$logBox.Size = New-Object System.Drawing.Size(884, 112)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$logBox.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#0F172A")
$logBox.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#D7E3F4")
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$form.Controls.Add($logBox)

function Refresh-View {
  $snapshot = Get-ControlCenterSnapshot
  $currentPrinter = [string]$printerCombo.SelectedItem
  $printerCombo.Items.Clear()
  foreach ($printer in $snapshot.printers) { [void]$printerCombo.Items.Add($printer) }
  $preferredPrinter = if (-not [string]::IsNullOrWhiteSpace($currentPrinter)) { $currentPrinter } else { $snapshot.printerName }
  if (-not [string]::IsNullOrWhiteSpace($preferredPrinter) -and $printerCombo.Items.Contains($preferredPrinter)) {
    $printerCombo.SelectedItem = $preferredPrinter
  } elseif ($printerCombo.Items.Count -gt 0) {
    $printerCombo.SelectedIndex = 0
  }
  if ([string]::IsNullOrWhiteSpace($scanFolderBox.Text)) { $scanFolderBox.Text = $snapshot.scanWatchFolder }
  $terminalText.Text = if ($snapshot.configured) { "终端：$($snapshot.terminalCode)" } else { "终端：尚未绑定" }
  $serviceText.Text = "服务：$($snapshot.serviceStatus)"
  $serviceText.ForeColor = if ($snapshot.serviceStatus -eq "Running") { [System.Drawing.ColorTranslator]::FromHtml("#15803D") } else { [System.Drawing.ColorTranslator]::FromHtml("#B45309") }
  $statusText.Text = if (-not $snapshot.installed) {
    "运行组件缺失，请修复安装"
  } elseif (-not $snapshot.configured) {
    "请选择打印机并输入后台生成的一次性绑定码"
  } elseif ($snapshot.serviceStatus -ne "Running") {
    "设备已配置，服务当前未运行"
  } else {
    "设备已配置并运行；桥接凭据：$(if ($snapshot.bridgeConfigured) { '已配置' } else { '动态本机会话' })"
  }
  $panelButton.Enabled = $snapshot.serviceStatus -eq "Running"
  $qrButton.Enabled = $snapshot.serviceStatus -eq "Running"
  $saveButton.Enabled = $snapshot.configured
  $startButton.Enabled = $snapshot.configured -and $snapshot.serviceInstalled -and $snapshot.serviceStatus -ne "Running"
  $restartButton.Enabled = $snapshot.configured -and $snapshot.serviceStatus -eq "Running"
  return $snapshot
}

$browseButton.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "选择扫描文件输入目录"
  if (-not [string]::IsNullOrWhiteSpace($scanFolderBox.Text)) { $dialog.SelectedPath = $scanFolderBox.Text }
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $scanFolderBox.Text = $dialog.SelectedPath }
})

$refreshButton.Add_Click({
  try { [void](Refresh-View); Add-Log "本机状态已刷新" } catch { Add-Log "刷新失败：$($_.Exception.Message)" }
})

$bindButton.Add_Click({
  try {
    Set-Busy $true "正在安全兑换绑定码并配置服务，请稍候…"
    Add-Log "开始设备绑定/更换绑定"
    Invoke-Provisioning $true
    [void](Refresh-View)
    Add-Log "设备绑定完成，服务已启动"
    [System.Windows.Forms.MessageBox]::Show("设备绑定完成。建议继续执行二维码链路自检。", "绑定成功", "OK", "Information") | Out-Null
  } catch {
    Add-Log $_.Exception.Message
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "绑定失败", "OK", "Error") | Out-Null
  } finally { Set-Busy $false; [void](Refresh-View) }
})

$saveButton.Add_Click({
  try {
    Set-Busy $true "正在保存打印与扫描配置…"
    Add-Log "开始更新本机打印配置"
    Invoke-Provisioning $false
    Add-Log "打印配置已保存，服务已重启"
  } catch {
    Add-Log $_.Exception.Message
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "保存失败", "OK", "Error") | Out-Null
  } finally { Set-Busy $false; [void](Refresh-View) }
})

$startButton.Add_Click({
  try { Start-Service -Name $serviceName; Add-Log "服务已启动" } catch { Add-Log "启动失败：$($_.Exception.Message)" } finally { [void](Refresh-View) }
})
$restartButton.Add_Click({
  try { Restart-Service -Name $serviceName -Force; Add-Log "服务已重启" } catch { Add-Log "重启失败：$($_.Exception.Message)" } finally { [void](Refresh-View) }
})
$panelButton.Add_Click({ Start-Process $panelUrl })
$logsButton.Add_Click({
  if (-not (Test-Path -LiteralPath $logsRoot)) { New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null }
  Start-Process "explorer.exe" -ArgumentList (Quote-ProcessArgument $logsRoot)
})
$qrButton.Add_Click({
  try {
    Set-Busy $true "正在检查二维码登录链路…"
    Test-QrBridge
    Add-Log "二维码登录链路正常"
    [System.Windows.Forms.MessageBox]::Show("本机端口、动态会话与云端二维码票据创建均正常。", "自检通过", "OK", "Information") | Out-Null
  } catch {
    Add-Log "二维码自检失败：$($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "自检失败", "OK", "Error") | Out-Null
  } finally { Set-Busy $false; [void](Refresh-View) }
})

$form.Add_Shown({
  try { $snapshot = Refresh-View; Add-Log "控制中心已就绪，检测到 $($snapshot.printers.Count) 台打印机" } catch { Add-Log "初始检测失败：$($_.Exception.Message)" }
})

[void][System.Windows.Forms.Application]::Run($form)
