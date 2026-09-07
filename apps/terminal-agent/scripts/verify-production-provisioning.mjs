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
