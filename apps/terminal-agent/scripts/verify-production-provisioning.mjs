import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const installer = fs.readFileSync(path.join(scriptDir, 'install-production-agent.ps1'), 'utf8')
const agentConfigExample = JSON.parse(
  fs.readFileSync(path.join(scriptDir, '../agent-config.example.json'), 'utf8'),
)
const provisioner = fs.readFileSync(
  path.join(scriptDir, '../provisioner/provision-agent-gui.ps1'),
  'utf8',
)
const provisionerBytes = fs.readFileSync(path.join(scriptDir, '../provisioner/provision-agent-gui.ps1'))
const lifecycleScripts = [
  path.join(scriptDir, '../installer/test-msi-lifecycle.ps1'),
  path.join(scriptDir, '../installer/test-exe-lifecycle.ps1'),
  path.join(scriptDir, '../installer/test-exe-upgrade.ps1'),
]

console.log('\n=== verify production Agent provisioning contract ===')

for (const parameter of [
  'PromptForBindCode',
  'BindCodeSecure',
  'ScanWatchFolder',
  'LocalApiAllowedOrigins',
  'ReplaceLocalApiAllowedOrigins',
  'LocalApiPort',
  'PromptForLocalApiBridgeToken',
  'LocalApiBridgeTokenSecure',
]) {
  assert.match(installer, new RegExp(`\\$${parameter}\\b`), `installer must expose ${parameter}`)
}

assert.match(installer, /Read-Host "One-time terminal bind code" -AsSecureString/)
assert.match(installer, /Read-Host "Local bridge token" -AsSecureString/)
assert.match(installer, /ZeroFreeBSTR/, 'secure prompt buffers must be zeroed after conversion')
assert.match(installer, /Use exactly one of -PromptForBindCode, -BindCode, or -BindCodeSecure/)
assert.match(installer, /Use either a BindCode flow or -UseExistingToken, not both/)
assert.match(installer, /\[string\]\$AgentVersion = "0\.3\.4-production"/)
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
assert.match(installer, /function ConvertTo-CanonicalApiBaseUrl/)
assert.match(installer, /\$uri\.Scheme -ne "https"/)
assert.match(installer, /Production ApiBaseUrl must use HTTPS/)
assert.doesNotMatch(installer, /Loopback ApiBaseUrl requires AGENT_PROFILE=local-debug/)
assert.doesNotMatch(installer, /ApiBaseUrl must start with http:\/\/ or https:\/\//)
assert.doesNotMatch(
  installer,
  /Production Agent cannot point to localhost/,
  'legacy localhost guard must not contradict the structured loopback-only HTTP rule',
)
assert.match(
  installer,
  /exchange-bind-code[^\r\n]+-MaximumRedirection 0/,
  'BindCode exchange must not follow an HTTPS-to-HTTP redirect',
)
assert.match(installer, /BindCode exchange failed\. Verify that the one-time code is valid and the HTTPS API is reachable\./)
assert.doesNotMatch(
  installer.match(/function Exchange-BindCode[\s\S]*?\r?\n\}/)?.[0] ?? '',
  /ErrorDetails|BindCode exchange failed: \$detail/,
  'BindCode exchange errors must not expose an API response that could echo the secret',
)
assert.equal(agentConfigExample.apiBaseUrl, 'https://api.example.com/api/v1')
assert.equal(agentConfigExample.agentVersion, '0.3.4')
assert.match(
  installer,
  /\$effectiveLocalApiAllowedOrigins\s*=\s*New-Object "System\.Collections\.Generic\.List\[string\]"/,
  'origin accumulator must not reuse the case-insensitive typed LocalApiAllowedOrigins parameter name',
)
assert.match(installer, /\$effectiveLocalApiAllowedOrigins\.Add\(\$canonicalOrigin\)/)
assert.match(installer, /localApiAllowedOrigins\s+=\s+@\(\$effectiveLocalApiAllowedOrigins\)/)
assert.doesNotMatch(
  installer,
  /\$localApiAllowedOrigins\s*=\s*New-Object/i,
  'PowerShell variables are case-insensitive; assigning a List to the typed array parameter recreates the fixed-size collection bug',
)
assert.match(installer, /\[switch\]\$SelfTestRuntimeAcl/)
assert.match(installer, /if \(\$SelfTestRuntimeAcl\)/)
assert.match(installer, /INSTALLED_RUNTIME_ACL_PASS/)
assert.match(installer, /function Test-TrustedRuntimeOwner/)
assert.match(installer, /S-1-3-0/, 'runtime ACL must tolerate inherited CREATOR OWNER under Program Files')
assert.match(installer, /S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464/, 'runtime owner check must tolerate TrustedInstaller-owned Program Files entries')
assert.match(installer, /config\.scanWatchFolder = \$effectiveScanWatchFolder/)
assert.match(installer, /config\.localApiBridgeToken = \$effectiveBridgeToken/)
assert.doesNotMatch(installer, /ReadAllText\(\$configPath\)/, 'existing config must only be read through the ACL-checked preservation path')
assert.doesNotMatch(installer, /Write-(?:Host|Output)[^\r\n]*(?:effectiveBridgeToken|secureBridgeToken|effectiveBindCode|secureBindCode)/i)

assert.match(installer, /function Resolve-AgentRuntimeLayout/)
assert.match(installer, /Mode = "installed"/)
assert.match(installer, /AppRoot = \$installedAppRoot/)
assert.match(installer, /NodeExecutable = \$installedNode/)
assert.match(installer, /MSI-managed AIJobPrintAgent service is missing/)
assert.match(installer, /\$TerminalId = \(\[string\]\$exchange\.terminalId\)\.Trim\(\)/)
assert.match(installer, /\$TerminalCode = \(\[string\]\$exchange\.terminalCode\)\.Trim\(\)/)
assert.match(installer, /pre-start heartbeat baseline/)
assert.match(installer, /Stop-ExistingAgentRuntime -Reason "before BindCode exchange"/)
assert.ok(
  installer.indexOf('Stop-ExistingAgentRuntime -Reason "before BindCode exchange"') <
    installer.indexOf('$exchange = Exchange-BindCode'),
  'old Agent must be stopped before BindCode exchange invalidates its credential',
)
assert.match(installer, /\$observedHeartbeat -gt \$heartbeatBaseline/)
assert.match(installer, /Remote terminal reported a new heartbeat after this service start/)
assert.doesNotMatch(installer, /if \(\$status\.isOnline -ne \$true\)/, 'online-window alone must not pass activation')

assert.match(provisioner, /param\(\[switch\]\$SelfTest\)/)
assert.match(provisioner, /PROVISIONER_SELF_TEST_PASS/)
assert.match(provisioner, /"-STA"/)
assert.match(provisioner, /MessageBoxButtons\]::RetryCancel/)
assert.match(provisioner, /UseSystemPasswordChar = \$true/)
assert.match(provisioner, /BindCodeSecure = ConvertTo-SecureString/)
assert.match(provisioner, /LocalApiBridgeTokenSecure = ConvertTo-SecureString/)
assert.match(provisioner, /& \$provisionScript @arguments/)
assert.match(provisioner, /\$arguments\.Clear\(\)/)
assert.match(provisioner, /https:\/\/zyidai\.cn\/api\/v1/)
assert.match(provisioner, /function ConvertTo-ValidatedApiBaseUrl/)
assert.match(provisioner, /ConvertTo-ValidatedApiBaseUrl \$apiText\.Text/)
assert.equal(
  provisioner.match(/ConvertTo-ValidatedApiBaseUrl \$apiText\.Text/g)?.length,
  2,
  'GUI connection test and activation must share the secure API validator',
)
for (const insecureApi of [
  'http://localhost:3000/api/v1',
  'http://127.0.0.1:3000/api/v1',
  'http://[::1]:3000/api/v1',
  'http://example.com/api/v1',
]) {
  assert.ok(provisioner.includes(insecureApi), `GUI SelfTest must reject insecure API ${insecureApi}`)
}
assert.match(provisioner, /\$health\.data\.db/)
assert.match(provisioner, /扫描接收目录（可选，仅在打印机面板与 SMB 已配置后填写）/)
assert.match(provisioner, /\$scanDefault = if[^\r\n]+else \{ "" \}/)
assert.doesNotMatch(provisioner, /\$printerCombo\.SelectedIndex = 0/)
assert.match(provisioner, /\$useExistingCheck\.Enabled = \$true[\s\S]+不要重复使用旧绑定码/)
assert.match(provisioner, /function Get-TokenFingerprint/)
assert.match(provisioner, /\$credentialReplacedThisAttempt =/)
assert.match(provisioner, /\$tokenFingerprintAfter -ne \$tokenFingerprintBefore/)
assert.match(provisioner, /使用已保存凭据重新配置失败：\$failureMessage/)
assert.match(provisioner, /& \$diagnoseScript/)
assert.deepEqual([...provisionerBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'GUI must carry a UTF-8 BOM for Windows PowerShell 5.1')
assert.match(provisioner, /uiTextBase64=\$uiTextBase64/)
for (const lifecyclePath of lifecycleScripts) {
  const bytes = fs.readFileSync(lifecyclePath)
  assert.deepEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    `${path.basename(lifecyclePath)} must carry a UTF-8 BOM for Windows PowerShell 5.1`,
  )
}
assert.doesNotMatch(
  provisioner,
  /Start-Process[^\r\n]*(?:BindCode|BridgeToken|bindCodeText|bridgeText)/i,
  'GUI elevation must pass only its own script path, never a credential',
)
assert.doesNotMatch(
  provisioner,
  /Write-(?:Host|Output|Verbose|Debug)[^\r\n]*(?:bindCodeText|bridgeText|BindCodeSecure|LocalApiBridgeTokenSecure)/i,
  'GUI must never log credential controls or secure parameters',
)

console.log('ALL PASS: production Agent provisioning contract')
