import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 现场测试日一取证脚本（P0-9）的静态约束。它由 Windows PowerShell 5.1 在一体机上直接运行，
// 只读、不输出文件名与账户名；Windows CI 另有一步真跑（windows-agent-installer 工作流）。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.join(__dirname, 'collect-field-day-evidence.ps1')
const bytes = fs.readFileSync(scriptPath)
const script = bytes.toString('utf8')
const installer = fs.readFileSync(path.join(__dirname, 'install-production-agent.ps1'), 'utf8')
const lockSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'instance-lock.ts'), 'utf8')
const scanWatcher = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'scan-watcher.ts'), 'utf8')

assert.ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'Windows PowerShell 5.1 runs this outside the installer payload; it must be UTF-8 with BOM')

// 只读：唯一允许的写入是可选的 -OutFile 回执。
assert.doesNotMatch(
  script,
  /\b(Remove-Item|Remove-ItemProperty|Set-Item|Set-ItemProperty|New-Item|New-ItemProperty|Rename-Item|Move-Item|Copy-Item|Clear-Item|Set-Service|Stop-Service|Start-Service|Restart-Service|Stop-Process|Enable-WindowsOptionalFeature|Disable-WindowsOptionalFeature|Set-AssignedAccess|Clear-AssignedAccess)\b/,
  'field-day evidence must be read-only',
)
assert.doesNotMatch(script, /\breg(\.exe)?\s+(add|delete|import)\b|\bsc(\.exe)?\s+(config|stop|start|delete|failure)\b|\bnet\s+(stop|start)\b|powercfg(\.exe)?\s+\/(change|set)/i, 'field-day evidence must not change system configuration')
assert.doesNotMatch(script, /Invoke-WebRequest|Invoke-RestMethod|Start-Process|WebClient|HttpClient|Test-NetConnection/i, 'field-day evidence must not make network calls or start processes')
const writes = [...script.matchAll(/WriteAll(Text|Bytes|Lines)\(/g)]
assert.equal(writes.length, 1, 'the only write allowed is the optional -OutFile receipt')
assert.match(script, /\[System\.IO\.File\]::WriteAllText\(\$OutFile,/, 'the only write must target -OutFile')

// 隐私：扫描件、打印件只计数不列名；账户名不进回执（KSK-001 上就是产品负责人本人的账户）。
assert.match(script, /function Get-FileAgeSummary/, 'residue checks must go through the count-only summary')
assert.doesNotMatch(script, /Add-Row[^\n]*\$(consoleUser|userDir|files|id)\b/, 'receipt rows must not carry user names, file lists, or the raw instance id')
assert.doesNotMatch(script, /\$env:USERNAME/, 'receipt must not print the running account name')

// 单实例：规则与 Agent 逐字一致；只列管道，不连接运行中的 Agent。
const agentPattern = lockSource.match(/const MACHINE_ID_RE = \/(.+)\/\n/)?.[1]
assert.ok(agentPattern, 'instance-lock.ts must still define MACHINE_ID_RE')
assert.ok(script.includes(`'${agentPattern}'`), 'instance-id rule must match the Agent MACHINE_ID_RE exactly')
assert.match(script, /GetFiles\('\\\\\.\\pipe\\'\)/, 'singleton check must list \\\\.\\pipe\\')
assert.match(script, /"AIJobPrintAgent-\$id"/, 'pipe name must be derived the way the Agent derives it')
assert.doesNotMatch(script, /NamedPipeClientStream|\.Connect\(|System\.IO\.Pipes/, 'field-day evidence must never connect to the Agent singleton')
assert.match(script, /agent\.pid 只是诊断记录，不需要删除/, 'singleton row must not invite deleting agent.pid')

// Edge 策略名与生产安装脚本写入的一致（写错名字 Edge 会静默忽略）。
for (const policy of ['LocalNetworkAccessAllowedForUrls', 'AudioCaptureAllowedUrls', 'AllowFileSelectionDialogs']) {
  assert.ok(installer.includes(`"${policy}"`), `install-production-agent.ps1 must still write ${policy}`)
  assert.ok(script.includes(`"${policy}"`), `field-day evidence must check ${policy}`)
}

// 新键盘阻止：键盘类要挡，HID 类不能挡（触摸屏属于 HID），追溯阻止会让现有扫码枪失效。
assert.match(script, /\{4d36e96b-e325-11ce-bfc1-08002be10318\}/, 'keyboard device setup class GUID')
assert.match(script, /\{745a17a0-74d3-11d0-b6fe-00a0c90f57da\}/, 'HID device setup class GUID')
assert.match(script, /if \(\$hidDenied\) \{ Add-Row "D1-4"[^\n]*"FAIL" \}/, 'denying the HID class must be a FAIL')
assert.match(script, /elseif \(\$keyboardDenied -and \$retro\) \{ Add-Row "D1-4"[^\n]*"FAIL" \}/, 'retroactive keyboard deny must be a FAIL')
assert.match(script, /"AllowDenyLayered"/, 'layered evaluation policy value name')
assert.match(script, /"DenyDeviceClassesRetroactive"/, 'retroactive deny value name')

// 以下三条来自 KSK-001 真机首跑（2026-09-29）：
// 分配访问：AssignedAccessConfiguration 及其子键装完系统就在，看键在不在会把未配置报成已配置，必须数子键下的配置项。
assert.doesNotMatch(script, /Test-Path[^\n]*AssignedAccessConfiguration/, 'D1-2 must not treat the always-present AssignedAccessConfiguration key as configured')
assert.match(script, /Get-ChildItem -LiteralPath \(Join-Path \$aaRoot "Profiles"\)/, 'D1-2 must count assigned-access profiles')
assert.match(script, /Get-ChildItem -LiteralPath \(Join-Path \$aaRoot "Configs"\)/, 'D1-2 must count assigned-access account configs')
assert.match(script, /if \(\$aaProfiles -eq 0 -and \$aaConfigs -eq 0\) \{ Add-Row "D1-2"[^\n]*"WARN" \}/, 'no assigned-access config must be a WARN, not a silent MANUAL')
// 远程工具：网易 UU 远程的进程与服务叫 GameViewer*，名字里没有 UU。
assert.match(script, /\$pattern = "[^"]*\bgameviewer\b[^"]*"/, 'D1-6 must detect NetEase UU Remote (GameViewer)')
// 功能状态：Disabled 与 not_available 是两回事，不能写成「专业版上都是 not_available」。
assert.doesNotMatch(script, /专业版上都是 not_available/, 'D1-3 note must not claim Pro always reports not_available (KSK-001 reports Disabled)')

// 系统版本：家庭版 FAIL；支持期表里没有的版本只能 UNKNOWN，绝不当通过；过期按今天日期自动转 FAIL。
assert.match(script, /if \(\$class -eq "home"\) \{ Add-Row "D1-1"[^\n]*"FAIL"/, 'Home edition must fail')
assert.match(script, /不在已核对的支持期表里[^\n]*"UNKNOWN"/, 'unknown builds must be UNKNOWN, never PASS')
assert.match(script, /if \(\$daysLeft -lt 0\) \{ Add-Row "D1-1"[^\n]*"FAIL" \}/, 'past end of service must fail')
for (const [key, date] of [
  ['19045|pro', '2025-10-14'],
  ['19044|iotltsc', '2032-01-13'],
  ['22621|pro', '2024-10-08'],
  ['26100|pro', '2026-10-13'],
  ['26100|iotltsc', '2034-10-10'],
  ['26200|pro', '2027-10-12'],
]) {
  assert.ok(script.includes(`"${key}" = "${date}"`), `end-of-service table must carry the verified date for ${key}`)
}

// 残留判定与 Agent 的真实时限一致：隔离区 24 小时删除、根目录投递重试 2 小时。
assert.match(scanWatcher, /UNCLAIMED_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/, 'scan-watcher unclaimed TTL changed; update the D2-2 threshold')
assert.match(script, /\(24 \* 60 \+ 10\)/, 'D2-2 must allow the 24h TTL plus one sweep interval')
assert.match(script, /"_unclaimed"/, 'D2-2 must look at the _unclaimed quarantine directory')
assert.match(script, /Join-Path \$programDataDir "temp"/, 'D2-3 must look at the Agent print temp directory')
assert.match(script, /"task_\*"/, 'D2-3 must only count Agent print task files')
assert.match(script, /AppData\\Local\\AIJobPrintKiosk\\profile/, 'D2-4 must look at the kiosk browser profile the watchdog uses')

for (const id of ['D1-1', 'D1-2', 'D1-3', 'D1-4', 'D1-5', 'D1-6', 'D1-7', 'D2-0', 'D2-1', 'D2-2', 'D2-3', 'D2-4', 'D2-5', 'D2-6']) {
  assert.ok(script.includes(`Invoke-Check "${id}"`), `field-day evidence must keep check ${id}`)
}

console.log('verify-field-day-evidence: ok')
