[CmdletBinding()]
param([switch]$SelfTest)

$ErrorActionPreference = "Stop"
$productName = "AI求职打印终端配置"
$serviceIdentity = "AIJobPrintAgent"
$programDataRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$configPath = Join-Path $programDataRoot "agent-config.json"
$tokenPath = Join-Path $programDataRoot "agent.token"
$provisionScript = Join-Path $PSScriptRoot "install-production-agent.ps1"
$serviceHelper = Join-Path $PSScriptRoot "service-identity.ps1"
$diagnoseScript = Join-Path $PSScriptRoot "diagnose-production-agent.ps1"
$defaultApiBase = "https://zyidai.cn/api/v1"
$defaultKioskOrigin = "https://zyidai.cn"

function Test-IsAdministrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-ElevatedProvisioner {
  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-STA",
    "-WindowStyle", "Hidden",
    "-File", ('"' + $PSCommandPath + '"')
  )
  Start-Process -FilePath $powershell -Verb RunAs -ArgumentList $arguments | Out-Null
}

function Get-ExistingConfig {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $null }
  try {
    return Get-Content -Raw -LiteralPath $configPath -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-TokenFingerprint {
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { return $null }
  try {
    return [string](Get-FileHash -LiteralPath $tokenPath -Algorithm SHA256 -ErrorAction Stop).Hash
  } catch {
    return $null
  }
}

function ConvertTo-ValidatedApiBaseUrl([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "云端 API 地址不能为空。"
  }
  $trimmed = $Value.Trim().TrimEnd("/")
  try {
    $uri = [System.Uri]$trimmed
  } catch {
    throw "云端 API 地址必须是完整网址。"
  }
  if (-not $uri.IsAbsoluteUri -or @("http", "https") -notcontains $uri.Scheme -or -not [string]::IsNullOrEmpty($uri.UserInfo)) {
    throw "云端 API 地址必须使用 HTTPS，且不能包含用户信息。"
  }
  if ($uri.AbsolutePath.TrimEnd("/") -ne "/api/v1" -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw "云端 API 地址必须以 /api/v1 结尾，且不能包含查询参数或片段。"
  }
  if ($uri.Scheme -ne "https") {
    throw "云端 API 必须使用 HTTPS。本机网页访问打印机请配置网页来源地址，不要把云端 API 改为 localhost。"
  }
  return $uri.GetLeftPart([System.UriPartial]::Authority) + "/api/v1"
}

function Get-AgentStatus {
  $service = Resolve-AgentService -Identity $serviceIdentity
  $config = Get-ExistingConfig
  return [pscustomobject]@{
    ServiceExists = $null -ne $service
    State = if ($null -eq $service) { "Missing" } else { [string]$service.State }
    StartMode = if ($null -eq $service) { "Unknown" } else { [string]$service.StartMode }
    Configured = $null -ne $config -and (Test-Path -LiteralPath $tokenPath -PathType Leaf)
    TerminalCode = if ($null -eq $config) { $null } else { [string]$config.terminalCode }
    PrinterName = if ($null -eq $config) { $null } else { [string]$config.printerName }
  }
}

foreach ($required in @($provisionScript, $serviceHelper, $diagnoseScript)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "配置向导缺少安装文件：$(Split-Path -Leaf $required)。请重新运行安装程序并选择修复。"
  }
}

. $serviceHelper

if ($SelfTest) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $runtimeRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  foreach ($relative in @("app\dist\index.js", "node\node.exe", "bootstrap\aijobprintagent.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot $relative) -PathType Leaf)) {
      throw "Provisioner self-test missing installed runtime file: $relative"
    }
  }
  $status = Get-AgentStatus
  if (-not $status.ServiceExists) { throw "Provisioner self-test could not resolve AIJobPrintAgent" }
  $uiTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($productName))
  if ($uiTextBase64 -ne "QUnmsYLogYzmiZPljbDnu4jnq6/phY3nva4=") {
    throw "Provisioner self-test detected a Windows PowerShell UI text encoding failure"
  }
  if ((ConvertTo-ValidatedApiBaseUrl "https://zyidai.cn/api/v1") -ne "https://zyidai.cn/api/v1") {
    throw "Provisioner self-test rejected a valid HTTPS API"
  }
  foreach ($insecureApi in @(
    "http://localhost:3000/api/v1",
    "http://127.0.0.1:3000/api/v1",
    "http://[::1]:3000/api/v1",
    "http://example.com/api/v1"
  )) {
    try {
      ConvertTo-ValidatedApiBaseUrl $insecureApi | Out-Null
      throw "Provisioner self-test accepted an insecure API: $insecureApi"
    } catch {
      if ($_.Exception.Message -eq "Provisioner self-test accepted an insecure API: $insecureApi") { throw }
    }
  }
  Write-Host "PROVISIONER_SELF_TEST_PASS serviceState=$($status.State) startMode=$($status.StartMode) uiTextBase64=$uiTextBase64"
  exit 0
}

if (-not [System.Environment]::UserInteractive) {
  throw "The provisioner requires an interactive Windows desktop session."
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not (Test-IsAdministrator)) {
  while ($true) {
    try {
      Start-ElevatedProvisioner
      exit 0
    } catch {
      $choice = [System.Windows.Forms.MessageBox]::Show(
        "管理员授权已取消或无法启动。配置终端服务需要管理员权限。可以重试授权，或取消并稍后从开始菜单重新打开。",
        $productName,
        [System.Windows.Forms.MessageBoxButtons]::RetryCancel,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      )
      if ($choice -ne [System.Windows.Forms.DialogResult]::Retry) { exit 1 }
    }
  }
}

[System.Windows.Forms.Application]::EnableVisualStyles()

$existingConfig = Get-ExistingConfig
$existingCredentialAvailable = $null -ne $existingConfig -and (Test-Path -LiteralPath $tokenPath -PathType Leaf)

$form = New-Object System.Windows.Forms.Form
$form.Text = $productName
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(760, 720)
$form.MinimumSize = New-Object System.Drawing.Size(780, 760)
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 250)
$form.MaximizeBox = $false

function New-Label([string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height = 24) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($Width, $Height)
  $label.AutoEllipsis = $true
  $form.Controls.Add($label)
  return $label
}

function New-TextBox([int]$X, [int]$Y, [int]$Width, [string]$Text = "") {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($X, $Y)
  $box.Size = New-Object System.Drawing.Size($Width, 32)
  $box.Text = $Text
  $form.Controls.Add($box)
  return $box
}

function New-Button([string]$Text, [int]$X, [int]$Y, [int]$Width) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($Width, 36)
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::System
  $form.Controls.Add($button)
  return $button
}

$title = New-Label -Text "AI求职打印终端" -X 28 -Y 22 -Width 500 -Height 36
$title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 18, [System.Drawing.FontStyle]::Bold)
$subtitle = New-Label -Text "完成一次激活后，终端服务将开机自动运行并接收云端打印任务。" -X 30 -Y 62 -Width 690
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(90, 96, 104)

New-Label -Text "云端 API 地址" -X 30 -Y 104 -Width 200 | Out-Null
$apiText = New-TextBox -X 30 -Y 130 -Width 540 -Text $(if ($null -ne $existingConfig) { [string]$existingConfig.apiBaseUrl } else { $defaultApiBase })
$testApiButton = New-Button -Text "测试连接" -X 584 -Y 127 -Width 140

New-Label -Text "一次性绑定码" -X 30 -Y 176 -Width 200 | Out-Null
$bindCodeText = New-TextBox -X 30 -Y 202 -Width 694
$bindCodeText.UseSystemPasswordChar = $true
$bindCodeText.MaxLength = 128

$useExistingCheck = New-Object System.Windows.Forms.CheckBox
$useExistingCheck.Text = "使用这台电脑已保存的设备凭据重新配置"
$useExistingCheck.Location = New-Object System.Drawing.Point(30, 239)
$useExistingCheck.Size = New-Object System.Drawing.Size(500, 28)
$useExistingCheck.Checked = $existingCredentialAvailable
$useExistingCheck.Enabled = $existingCredentialAvailable
$form.Controls.Add($useExistingCheck)

New-Label -Text "Windows 打印机" -X 30 -Y 276 -Width 200 | Out-Null
$printerCombo = New-Object System.Windows.Forms.ComboBox
$printerCombo.Location = New-Object System.Drawing.Point(30, 302)
$printerCombo.Size = New-Object System.Drawing.Size(694, 32)
$printerCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$form.Controls.Add($printerCombo)

try {
  $printers = @(Get-Printer -ErrorAction Stop | Sort-Object Name)
  foreach ($printer in $printers) { [void]$printerCombo.Items.Add([string]$printer.Name) }
  $preferredPrinter = if ($null -ne $existingConfig) { [string]$existingConfig.printerName } else { "" }
  if (-not [string]::IsNullOrWhiteSpace($preferredPrinter) -and $printerCombo.Items.Contains($preferredPrinter)) {
    $printerCombo.SelectedItem = $preferredPrinter
  }
} catch {
  [System.Windows.Forms.MessageBox]::Show("无法读取 Windows 打印机列表：$($_.Exception.Message)", $productName, "OK", "Error") | Out-Null
}

New-Label -Text "网页来源地址" -X 30 -Y 348 -Width 200 | Out-Null
$originDefault = $defaultKioskOrigin
if ($null -ne $existingConfig -and $null -ne $existingConfig.localApiAllowedOrigins) {
  $savedOrigin = @($existingConfig.localApiAllowedOrigins | Where-Object { $_ -notmatch "localhost|127\.0\.0\.1" } | Select-Object -First 1)
  if ($savedOrigin.Count -gt 0) { $originDefault = [string]$savedOrigin[0] }
}
$originText = New-TextBox -X 30 -Y 374 -Width 694 -Text $originDefault

New-Label -Text "扫描接收目录（可选，仅在打印机面板与 SMB 已配置后填写）" -X 30 -Y 420 -Width 600 | Out-Null
$scanDefault = if ($null -ne $existingConfig -and $existingConfig.scanWatchFolder) { [string]$existingConfig.scanWatchFolder } else { "" }
$scanText = New-TextBox -X 30 -Y 446 -Width 540 -Text $scanDefault
$browseButton = New-Button -Text "选择目录" -X 584 -Y 443 -Width 140

New-Label -Text "本地桥接令牌（可选，启用手机/U盘本地桥接时填写）" -X 30 -Y 492 -Width 600 | Out-Null
$bridgeText = New-TextBox -X 30 -Y 518 -Width 694
$bridgeText.UseSystemPasswordChar = $true
$bridgeText.MaxLength = 512

$statusLabel = New-Label -Text "" -X 30 -Y 563 -Width 694 -Height 46
$statusLabel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$statusLabel.Padding = New-Object System.Windows.Forms.Padding(8)
$statusLabel.BackColor = [System.Drawing.Color]::White

$refreshButton = New-Button -Text "刷新状态" -X 30 -Y 628 -Width 130
$diagnoseButton = New-Button -Text "诊断详情" -X 174 -Y 628 -Width 130
$printerSelfTestButton = New-Button -Text "打印机自检" -X 318 -Y 628 -Width 150
$activateButton = New-Button -Text "激活并启动" -X 484 -Y 628 -Width 240
$activateButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Bold)

function Set-Status([string]$Text, [System.Drawing.Color]$Color) {
  $statusLabel.Text = $Text
  $statusLabel.ForeColor = $Color
  [System.Windows.Forms.Application]::DoEvents()
}

function Get-PrintablePortState([string]$PrinterName) {
  $printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
  if ($null -eq $printer) { return @{ Found = $false; PortType = "not_found"; NetworkState = "n/a"; DriverState = "not_found" } }
  $port = Get-PrinterPort -Name $printer.PortName -ErrorAction SilentlyContinue
  $portType = "other"
  $networkState = "n/a"
  if ($null -ne $port) {
    if (-not [string]::IsNullOrWhiteSpace([string]$port.PrinterHostAddress)) {
      $portType = "network"
      $hostAddress = [string]$port.PrinterHostAddress
      $portNumber = [int]$port.PortNumber
      if ($portNumber -lt 1) { $portNumber = 9100 }
      $client = New-Object System.Net.Sockets.TcpClient
      try {
        $connect = $client.BeginConnect($hostAddress, $portNumber, $null, $null)
        if ($connect.AsyncWaitHandle.WaitOne(3000)) {
          $client.EndConnect($connect)
          $networkState = "reachable"
        } else {
          $networkState = "unreachable"
        }
      } catch {
        $networkState = "unreachable"
      } finally {
        $client.Close()
      }
    } elseif ([string]$port.Name -match "^(?i)usb") {
      $portType = "usb"
    }
  }

  $wmiFilter = "Name='" + $PrinterName.Replace("'", "''") + "'"
  $wmi = Get-CimInstance -ClassName Win32_Printer -Filter $wmiFilter -ErrorAction SilentlyContinue
  $driverState = "unknown"
  if ($null -ne $wmi) {
    $statusCode = [int]$wmi.PrinterStatus
    $errorState = [int]$wmi.DetectedErrorState
    $workOffline = [string]$wmi.WorkOffline
    if ($workOffline -eq "True" -or $statusCode -eq 7 -or $errorState -eq 9) {
      $driverState = "offline"
    } elseif ($errorState -in @(4, 6, 7, 8)) {
      $driverState = "error"
    } elseif ($errorState -in @(0, 2)) {
      $driverState = "ready"
    }
  }
  return @{ Found = $true; PortType = $portType; NetworkState = $networkState; DriverState = $driverState }
}

function Invoke-PrintTestPage([string]$PrinterName) {
  $agentRoot = Split-Path -Parent $PSScriptRoot
  $nodePath = Join-Path $agentRoot "node\node.exe"
  $appRoot = Join-Path $agentRoot "app"
  $distPath = Join-Path $appRoot "dist\index.js"
  $testPdf = Join-Path ([System.IO.Path]::GetTempPath()) ("aijobprint-test-" + [guid]::NewGuid().ToString("N") + ".pdf")
  try {
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "未找到随包 Node 运行时：$nodePath" }
    if (-not (Test-Path -LiteralPath $distPath -PathType Leaf)) { throw "未找到 Agent 程序：$distPath" }
    $generateScript = @"
const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument({ size: 'A4' });
const out = fs.createWriteStream(process.argv[1]);
doc.pipe(out);
doc.fontSize(30).text('AI Job Print Terminal - Test Page', 72, 120);
doc.moveDown().fontSize(16).text('Generated at ' + new Date().toISOString());
doc.end();
"@
    Push-Location $appRoot
    try {
      & $nodePath -e $generateScript $testPdf
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $testPdf -PathType Leaf)) {
        throw "测试页 PDF 生成失败（退出码 $LASTEXITCODE）"
      }
    } finally {
      Pop-Location
    }
    $output = @(& $nodePath $distPath print --file $testPdf --printer $PrinterName 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0 -and (($output -join "`n") -match "PRINT SUCCESS")) {
      return @{ Success = $true; Detail = "测试页已提交到打印机（PRINT SUCCESS）" }
    }
    $errorLine = ($output | Where-Object { $_ -match "PRINT_FAILED|errorCode|Error" } | Select-Object -First 1)
    return @{
      Success = $false
      Detail = "测试页打印失败（退出码 $exitCode）：$([string]$errorLine)"
    }
  } catch {
    return @{ Success = $false; Detail = "测试页打印失败：$($_.Exception.Message)" }
  } finally {
    if (Test-Path -LiteralPath $testPdf -PathType Leaf) {
      Remove-Item -LiteralPath $testPdf -Force -ErrorAction SilentlyContinue
    }
  }
}

function Refresh-AgentStatus {
  try {
    $status = Get-AgentStatus
    if (-not $status.ServiceExists) {
      Set-Status "未找到终端服务。请关闭本窗口并运行安装程序的“修复”。" ([System.Drawing.Color]::Firebrick)
    } elseif ($status.State -eq "Running" -and $status.StartMode -eq "Auto") {
      Set-Status "服务正在运行｜开机自动启动｜终端 $($status.TerminalCode)｜打印机 $($status.PrinterName)" ([System.Drawing.Color]::FromArgb(26, 112, 76))
    } elseif ($status.Configured) {
      Set-Status "设备已有配置，但服务当前为 $($status.State) / $($status.StartMode)。可使用已有凭据重新配置并启动。" ([System.Drawing.Color]::FromArgb(166, 92, 0))
    } else {
      Set-Status "程序已安装，尚未激活。请输入后台生成的一次性绑定码。" ([System.Drawing.Color]::FromArgb(86, 91, 98))
    }
  } catch {
    Set-Status "状态检查失败：$($_.Exception.Message)" ([System.Drawing.Color]::Firebrick)
  }
}

$useExistingCheck.Add_CheckedChanged({
  $bindCodeText.Enabled = -not $useExistingCheck.Checked
  if ($useExistingCheck.Checked) { $bindCodeText.Clear() }
})
$bindCodeText.Enabled = -not $useExistingCheck.Checked

$browseButton.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "选择打印机扫描到 SMB 后，本机实际接收文件的目录"
  $dialog.ShowNewFolderButton = $true
  if (Test-Path -LiteralPath $scanText.Text -PathType Container) { $dialog.SelectedPath = $scanText.Text }
  if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { $scanText.Text = $dialog.SelectedPath }
  $dialog.Dispose()
})

$testApiButton.Add_Click({
  try {
    $base = ConvertTo-ValidatedApiBaseUrl $apiText.Text
    Set-Status "正在测试云端连接..." ([System.Drawing.Color]::FromArgb(86, 91, 98))
    $health = Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 15
    $db = if ($health.data -and $health.data.db) { "，数据库 $($health.data.db)" } else { "" }
    Set-Status "云端连接正常$db。" ([System.Drawing.Color]::FromArgb(26, 112, 76))
  } catch {
    Set-Status "云端连接失败：$($_.Exception.Message)" ([System.Drawing.Color]::Firebrick)
  }
})

$refreshButton.Add_Click({ Refresh-AgentStatus })

$diagnoseButton.Add_Click({
  try {
    $diagnostic = & $diagnoseScript
    $details = @(
      "服务：$($diagnostic.serviceState) / $($diagnostic.startMode)",
      "服务身份：$($diagnostic.serviceIdentityStatus)",
      "配置 JSON：$($diagnostic.configValidJson)",
      "加密凭据：$($diagnostic.tokenFilePresenceStatus)",
      "ProgramData ACL：$($diagnostic.programDataAclStatus)",
      "配置 ACL：$($diagnostic.configFileAclStatus)",
      "Token ACL：$($diagnostic.tokenFileAclStatus)",
      "运行时 ACL：$($diagnostic.runtimeRootAclStatus)",
      "本机接口 127.0.0.1:$($diagnostic.localApiPort)：$($diagnostic.localApiStatus)",
      "最近启动诊断：$($diagnostic.lastStartupDiagnosticCode)"
    ) -join "`r`n"
    [System.Windows.Forms.MessageBox]::Show($details, "终端诊断详情", "OK", "Information") | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show("诊断失败：$($_.Exception.Message)", $productName, "OK", "Error") | Out-Null
  }
})

$printerSelfTestButton.Add_Click({
  try {
    if ($printerCombo.SelectedIndex -lt 0) {
      [System.Windows.Forms.MessageBox]::Show("请先在 Windows 打印机下拉框中选择打印机。", $productName, "OK", "Warning") | Out-Null
      return
    }
    $printerName = [string]$printerCombo.SelectedItem
    Set-Status "正在检查打印机链路..." ([System.Drawing.Color]::FromArgb(86, 91, 98))
    $state = Get-PrintablePortState $printerName
    if (-not $state.Found) {
      Set-Status "未找到打印机：$printerName" ([System.Drawing.Color]::Firebrick)
      [System.Windows.Forms.MessageBox]::Show("Windows 中未找到打印机 $printerName，请检查驱动安装。", $productName, "OK", "Error") | Out-Null
      return
    }
    $portLabel = switch ($state.PortType) {
      "network" { "网络端口（TCP 探测：$($state.NetworkState)）" }
      "usb" { "USB 端口" }
      "other" { "其他端口（非网络、非 USB）" }
      default { "未知" }
    }
    $driverLabel = switch ($state.DriverState) {
      "ready" { "就绪" }
      "offline" { "离线（Windows 驱动层）" }
      "error" { "异常（缺纸/卡纸/开盖等）" }
      default { "未知" }
    }
    $details = @(
      "打印机：$printerName",
      "端口类型：$portLabel",
      "驱动状态：$driverLabel"
    ) -join "`r`n"
    $runTest = [System.Windows.Forms.MessageBox]::Show(
      $details + "`r`n`r`n是否同时打印一页测试页？",
      "打印机自检",
      "YesNo",
      "Question"
    )
    if ($runTest -eq [System.Windows.Forms.DialogResult]::Yes) {
      Set-Status "正在生成并打印测试页，请稍候..." ([System.Drawing.Color]::FromArgb(86, 91, 98))
      $testResult = Invoke-PrintTestPage $printerName
      $details += "`r`n`r`n测试页：$($testResult.Detail)"
      if ($testResult.Success) {
        Set-Status "打印机自检完成：$portLabel；驱动 $driverLabel；测试页已提交。" ([System.Drawing.Color]::FromArgb(26, 112, 76))
      } else {
        Set-Status "打印机自检完成：$portLabel；驱动 $driverLabel；测试页失败，请检查打印机电源与连接。" ([System.Drawing.Color]::Firebrick)
      }
    } else {
      Set-Status "打印机自检完成：$portLabel；驱动 $driverLabel。" ([System.Drawing.Color]::FromArgb(26, 112, 76))
    }
    [System.Windows.Forms.MessageBox]::Show($details, "打印机自检", "OK", "Information") | Out-Null
  } catch {
    Set-Status "打印机自检失败：$($_.Exception.Message)" ([System.Drawing.Color]::Firebrick)
    [System.Windows.Forms.MessageBox]::Show("打印机自检失败：$($_.Exception.Message)", $productName, "OK", "Error") | Out-Null
  }
})

$activateButton.Add_Click({
  $activateButton.Enabled = $false
  $testApiButton.Enabled = $false
  $arguments = $null
  $usedExistingCredential = $false
  $tokenFingerprintBefore = $null
  try {
    $apiBase = ConvertTo-ValidatedApiBaseUrl $apiText.Text
    if ($printerCombo.SelectedIndex -lt 0) { throw "请先安装打印机驱动并选择一台 Windows 打印机。" }
    if ([string]::IsNullOrWhiteSpace($originText.Text)) { throw "网页来源地址不能为空。" }
    if (-not $useExistingCheck.Checked -and [string]::IsNullOrWhiteSpace($bindCodeText.Text)) { throw "请输入后台生成的一次性绑定码。" }

    $scanFolder = $scanText.Text.Trim()
    if (-not [string]::IsNullOrWhiteSpace($scanFolder) -and -not (Test-Path -LiteralPath $scanFolder -PathType Container)) {
      New-Item -ItemType Directory -Path $scanFolder -Force | Out-Null
    }

    $arguments = @{
      ApiBaseUrl = $apiBase
      PrinterName = [string]$printerCombo.SelectedItem
      LocalApiAllowedOrigins = @($originText.Text.Trim())
      ReplaceLocalApiAllowedOrigins = $true
      RepairProgramDataAcl = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($scanFolder)) { $arguments.ScanWatchFolder = $scanFolder }

    $usedExistingCredential = $useExistingCheck.Checked
    $tokenFingerprintBefore = Get-TokenFingerprint
    if ($usedExistingCredential) {
      $current = Get-ExistingConfig
      if ($null -eq $current -or [string]::IsNullOrWhiteSpace([string]$current.terminalId) -or [string]::IsNullOrWhiteSpace([string]$current.terminalCode)) {
        throw "没有找到可复用的受保护设备配置，请生成新绑定码。"
      }
      $arguments.UseExistingToken = $true
      $arguments.TerminalId = [string]$current.terminalId
      $arguments.TerminalCode = [string]$current.terminalCode
    } else {
      $arguments.BindCodeSecure = ConvertTo-SecureString $bindCodeText.Text -AsPlainText -Force
    }
    if (-not [string]::IsNullOrWhiteSpace($bridgeText.Text)) {
      $arguments.LocalApiBridgeTokenSecure = ConvertTo-SecureString $bridgeText.Text -AsPlainText -Force
    }

    $bindCodeText.Clear()
    $bridgeText.Clear()
    Set-Status "正在加固配置、启动服务并验证云端心跳，请稍候..." ([System.Drawing.Color]::FromArgb(86, 91, 98))
    $output = & $provisionScript @arguments 6>&1 5>&1 4>&1 3>&1 2>&1 | Out-String
    $arguments.Clear()
    $arguments = $null
    $output = $null
    $existingCredentialAvailable = $true
    $useExistingCheck.Enabled = $true
    $useExistingCheck.Checked = $true
    $bindCodeText.Enabled = $false
    Refresh-AgentStatus
    [System.Windows.Forms.MessageBox]::Show("终端激活完成。请到管理后台确认最近心跳和打印机状态，然后使用一页测试 PDF 验证真实出纸。", $productName, "OK", "Information") | Out-Null
  } catch {
    $failureMessage = $_.Exception.Message
    $bindCodeText.Clear()
    $bridgeText.Clear()
    $status = try { Get-AgentStatus } catch { $null }
    $tokenFingerprintAfter = Get-TokenFingerprint
    $credentialReplacedThisAttempt = (
      -not $usedExistingCredential -and
      -not [string]::IsNullOrWhiteSpace($tokenFingerprintAfter) -and
      $tokenFingerprintAfter -ne $tokenFingerprintBefore
    )
    if ($credentialReplacedThisAttempt -and $null -ne $status -and $status.Configured) {
      $existingCredentialAvailable = $true
      $useExistingCheck.Enabled = $true
      $useExistingCheck.Checked = $true
      $bindCodeText.Enabled = $false
      if ($status.State -eq "Running") {
        Set-Status "绑定凭据已保存，服务正在运行，但本次云端新心跳验证失败：$failureMessage。请测试连接并刷新状态；不要重复使用旧绑定码。" ([System.Drawing.Color]::FromArgb(166, 92, 0))
      } else {
        Set-Status "绑定凭据已保存，但服务当前为 $($status.State)：$failureMessage。不要重复使用旧绑定码；保留“使用已保存凭据”并再次点击“激活并启动”。" ([System.Drawing.Color]::FromArgb(166, 92, 0))
      }
    } elseif ($usedExistingCredential -and $null -ne $status -and $status.Configured) {
      Set-Status "使用已保存凭据重新配置失败：$failureMessage" ([System.Drawing.Color]::Firebrick)
    } else {
      Set-Status "激活失败：$failureMessage" ([System.Drawing.Color]::Firebrick)
    }
  } finally {
    if ($null -ne $arguments) {
      $arguments.Clear()
      $arguments = $null
    }
    $activateButton.Enabled = $true
    $testApiButton.Enabled = $true
  }
})

Refresh-AgentStatus
[void]$form.ShowDialog()
$form.Dispose()
