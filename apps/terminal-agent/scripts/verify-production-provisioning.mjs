import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const installer = fs.readFileSync(path.join(scriptDir, 'install-production-agent.ps1'), 'utf8')

console.log('\n=== verify production Agent provisioning contract ===')

for (const parameter of [
  'PromptForBindCode',
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
assert.match(installer, /Use either -PromptForBindCode or -BindCode, not both/)
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
assert.doesNotMatch(installer, /\$localApiAllowedOrigins\s*=\s*New-Object/, 'parameter names are case-insensitive in PowerShell; do not shadow the fixed string array')
assert.match(installer, /config\.scanWatchFolder = \$effectiveScanWatchFolder/)
assert.match(installer, /config\.localApiBridgeToken = \$effectiveBridgeToken/)
assert.doesNotMatch(installer, /ReadAllText\(\$configPath\)/, 'existing config must only be read through the ACL-checked preservation path')
assert.doesNotMatch(installer, /Write-(?:Host|Output)[^\r\n]*(?:effectiveBridgeToken|secureBridgeToken|effectiveBindCode|secureBindCode)/i)

console.log('ALL PASS: production Agent provisioning contract')
