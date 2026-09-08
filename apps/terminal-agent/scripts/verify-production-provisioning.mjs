import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const installer = fs.readFileSync(path.join(scriptDir, 'install-production-agent.ps1'), 'utf8')

console.log('\n=== verify production Agent provisioning contract ===')

assert.match(
  installer,
  /\[int\]\$ClaimIntervalMs\s*=\s*5000/,
  'production installer must default claim polling to the server rate-limit budget',
)

// -UseExistingToken 不换 token：$tokenToPersist 保持 $null，但 PowerShell 绑定到 [string] 形参会转成
// 空字符串，用 `$null -ne` 判断会误判为「要写 token」并在 Protect-AgentToken 抛错（现场实证）。
assert.match(
  installer,
  /\$shouldWriteToken\s*=\s*-not \[string\]::IsNullOrWhiteSpace\(\$TokenToPersist\)/,
  'token persistence must be decided by content, not by $null comparison against a [string] parameter',
)
assert.doesNotMatch(
  installer,
  /\$shouldWriteToken\s*=\s*\$null -ne \$TokenToPersist/,
  'a [string] parameter is never $null; -UseExistingToken would always fail to commit',
)
assert.doesNotMatch(
  installer,
  /\$credentialReplaced\s*=\s*\$null -ne \$tokenToPersist/,
  'credential-replaced reporting must use the same content check',
)

for (const parameter of [
  'PromptForBindCode',
  'BindCodeFromStandardInput',
  'ScanWatchFolder',
  'LocalApiAllowedOrigins',
  'ReplaceLocalApiAllowedOrigins',
  'LocalApiPort',
  'PromptForLocalApiBridgeToken',
  'InstalledAgentRoot',
]) {
  assert.match(installer, new RegExp(`\\$${parameter}\\b`), `installer must expose ${parameter}`)
}

assert.match(installer, /Read-Host "One-time terminal bind code" -AsSecureString/)
assert.match(installer, /Read-Host "Local bridge token" -AsSecureString/)
assert.match(installer, /ZeroFreeBSTR/, 'secure prompt buffers must be zeroed after conversion')
assert.match(installer, /Use only one BindCode input flow/)
assert.match(installer, /\[Console\]::In\.ReadLine\(\)/, 'GUI bind code must enter through redirected stdin, not argv')
assert.match(installer, /Use either a BindCode flow or -UseExistingToken, not both/)
assert.match(installer, /BindCode exchange did not return a terminalId/)
assert.match(installer, /BindCode exchange did not return a terminalCode/)
assert.match(installer, /-UseExistingToken requires -TerminalId and -TerminalCode/)
assert.match(installer, /MSI-installed Windows service is missing; repair the MSI before provisioning/)
assert.match(installer, /\$effectiveBindCode = \$null/)
assert.match(installer, /\[Alias\("KioskOrigins"\)\]/)
assert.match(installer, /\[Alias\("ReplaceKioskOrigins"\)\]/)
assert.match(installer, /Get-PreservedLocalSettings/)
assert.match(installer, /\[bool\]\$SkipOrigins\s*=\s*\$false/)
assert.match(installer, /if \(-not \$SkipOrigins -and \$null -ne \$originProperty\)/)
assert.match(installer, /-SkipOrigins \(\[bool\]\$ReplaceLocalApiAllowedOrigins\)/)
assert.match(installer, /Assert-ProgramDataAcl -Path \$ConfigPath -IsContainer \$false/)
assert.match(installer, /\$preservedLocalSettings\.Contains\("scanWatchFolder"\)/)
assert.match(installer, /\$preservedLocalSettings\.Contains\("localApiAllowedOrigins"\)/)
assert.match(installer, /\$preservedLocalSettings\.Contains\("localApiBridgeToken"\)/)
assert.match(installer, /PSBoundParameters\.ContainsKey\("LocalApiPort"\)/)
assert.match(installer, /\$preservedLocalSettings\.Contains\("localApiPort"\)/)
assert.match(installer, /localApiPort\s+=\s+\$effectiveLocalApiPort/)
assert.match(installer, /Assert-NotReparsePoint \$scanFolderItem/)
assert.match(installer, /GetLeftPart\(\[System\.UriPartial\]::Authority\)/)
assert.match(installer, /localApiAllowedOrigins\s+=\s+@\(\$effectiveLocalApiAllowedOrigins\)/)
assert.match(installer, /Merge-LocalApiAllowedOrigins/)
assert.match(
  installer,
  /\$originCandidates[\s\S]{0,500}Where-Object\s*\{\s*-not \[string\]::IsNullOrWhiteSpace\(\$_\)\s*\}[\s\S]{0,300}Merge-LocalApiAllowedOrigins/,
  'origin candidates must drop null and blank values before merging',
)
assert.match(installer, /\[FAIL\] commit stage=\$commitStage reason=\$\(\$_\.Exception\.Message\)/)
assert.doesNotMatch(installer, /\$localApiAllowedOrigins\s*=\s*New-Object/, 'parameter names are case-insensitive in PowerShell; do not shadow the fixed string array')
assert.match(installer, /provisioning-runtime-security\.ps1/)
assert.doesNotMatch(installer, /FileSystemRights\]::Modify\s+-bor/, 'composite Modify includes read bits and must not be used as a dangerous-rights mask')
assert.match(installer, /config\.scanWatchFolder = \$effectiveScanWatchFolder/)
assert.match(installer, /config\.localApiBridgeToken = \$effectiveBridgeToken/)
assert.doesNotMatch(installer, /ReadAllText\(\$configPath\)/, 'existing config must only be read through the ACL-checked preservation path')
assert.doesNotMatch(installer, /Write-(?:Host|Output)[^\r\n]*(?:effectiveBridgeToken|secureBridgeToken|effectiveBindCode|secureBindCode)/i)

console.log('ALL PASS: production Agent provisioning contract')

const fieldEvidence = fs.readFileSync(path.join(scriptDir, 'collect-field-evidence.ps1'), 'utf8')

console.log('\n=== verify field evidence collector contract ===')

assert.doesNotMatch(
  fieldEvidence,
  /Get-Content.*agent\.token/,
  'field evidence collector must not read agent.token contents',
)
assert.match(
  fieldEvidence,
  /IsNullOrWhiteSpace.*localApiBridgeToken/,
  'field evidence collector must report localApiBridgeToken only as configured/length',
)
assert.doesNotMatch(
  fieldEvidence,
  /Write-(?:Host|Output)[^\r\n]*localApiBridgeToken/,
  'field evidence collector must not print localApiBridgeToken value',
)
assert.doesNotMatch(
  fieldEvidence,
  /DefaultPassword/,
  'field evidence collector must not read Winlogon DefaultPassword',
)
assert.doesNotMatch(
  fieldEvidence,
  /Pantum/,
  'field evidence collector must not hard-code a printer model',
)
assert.match(
  fieldEvidence,
  /PrinterStatus/,
  'field evidence collector must capture Win32 PrinterStatus',
)
assert.match(
  fieldEvidence,
  /DetectedErrorState/,
  'field evidence collector must capture Win32 DetectedErrorState',
)
assert.match(
  fieldEvidence,
  /WorkOffline/,
  'field evidence collector must capture Win32 WorkOffline',
)

// 闭合准入：配置字段只能逐个白名单回显（见 5.3-8 的 $parts 列表），
// 任何形式的整对象序列化都会把 localApiBridgeToken 一并打出来。
// 今天在服务器取证脚本上已经栽过一次同类问题：黑名单式掩码漏掉了
// 名字里不含关键词的密钥键。
assert.doesNotMatch(
  fieldEvidence,
  /ConvertTo-Json/,
  'field evidence collector must never serialize whole objects; echo only allow-listed config keys',
)
assert.doesNotMatch(
  fieldEvidence,
  /\$script:Config\s*\|/,
  'field evidence collector must not pipe the whole config object anywhere',
)

console.log('ALL PASS: field evidence collector contract')
