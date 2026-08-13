import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(__dirname, '..')
const installerPath = path.join(__dirname, 'install-production-agent.ps1')
const diagnosisPath = path.join(__dirname, 'diagnose-production-agent.ps1')
const serviceIdentityPath = path.join(__dirname, 'service-identity.ps1')
const runtimeSecurityPath = path.join(__dirname, 'provisioning-runtime-security.ps1')

const installer = fs.readFileSync(installerPath, 'utf8')
const diagnosis = fs.readFileSync(diagnosisPath, 'utf8')
const serviceIdentity = fs.readFileSync(serviceIdentityPath, 'utf8')
const runtimeSecurity = fs.readFileSync(runtimeSecurityPath, 'utf8')

const diagnosisParamBlock = sourceBetween(diagnosis, /param\(/, /\n\)/)
assert.doesNotMatch(
  diagnosisParamBlock,
  /\$PSScriptRoot/,
  'diagnosis parameter defaults must not read PSScriptRoot before Windows PowerShell 5.1 starts the script',
)
assert.match(
  diagnosis,
  /if \(\[string\]::IsNullOrWhiteSpace\(\$ConfigPath\)\) \{\s*\$ConfigPath = Join-Path \$ProgramDataDir "agent-config\.json"\s*\}/,
  'diagnosis must resolve its default config path under ProgramData after script startup',
)
assert.match(diagnosis, /legacy_pending_migration/, 'diagnosis must report a legacy config that awaits first-start migration')

function sourceBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern)
  assert.notEqual(start, -1, `missing ${startPattern}`)
  const end = source.slice(start).search(endPattern)
  assert.notEqual(end, -1, `missing ${endPattern} after ${startPattern}`)
  return source.slice(start, start + end)
}

function assertIncludes(source, expected, message) {
  assert.ok(source.includes(expected), message)
}

console.log('\n=== verify terminal-agent Windows service recovery ===')

assert.match(serviceIdentity, /function Resolve-AgentService\b/, 'service identity helper must expose Resolve-AgentService')
assert.match(serviceIdentity, /Get-CimInstance\s+Win32_Service/, 'service identity helper must query Windows services through Win32_Service')
assert.match(serviceIdentity, /\$_\.Name\s+-eq\s+\$Identity/, 'service identity helper must match the SCM service Name')
assert.match(serviceIdentity, /\$_\.DisplayName\s+-eq\s+\$Identity/, 'service identity helper must match the service DisplayName')
assert.match(serviceIdentity, /\$candidates\.Count\s+-gt\s+1/, 'service identity helper must reject ambiguous service matches')
assert.match(serviceIdentity, /"Multiple Windows services match '\$Identity'; refusing to choose one\."/, 'service identity helper must describe ambiguous service matches')
assert.match(serviceIdentity, /throw\s+\$exception/, 'service identity helper must fail closed for ambiguous service matches')
assert.match(serviceIdentity, /agentServiceResolution\"]\s*=\s*"ambiguous"/, 'service identity helper must classify ambiguous service matches')
assert.match(installer, /service-identity\.ps1/, 'installer must use the shared service identity helper')
assert.match(diagnosis, /service-identity\.ps1/, 'diagnosis must use the shared service identity helper')
assert.doesNotMatch(installer, /Get-Service\s+-Name\s+"AIJobPrintAgent"/, 'installer must not assume the display name is the SCM service Name')
assert.doesNotMatch(diagnosis, /Win32_Service\s+-Filter\s+"Name\s*=\s+'\$serviceNameForFilter'/, 'diagnosis must not query only the SCM service Name')
assert.match(installer, /\$apiOrigin\s*=\s*\(\[System\.Uri\]\$apiBase\)\.GetLeftPart/, 'installer must derive the same-origin production Kiosk Origin')
assert.match(installer, /\[Alias\("KioskOrigins"\)\][\s\S]{0,80}?\[string\[\]\]\$LocalApiAllowedOrigins/, 'installer must expose one canonical origins parameter with the legacy KioskOrigins alias')
assert.match(installer, /\[Alias\("ReplaceKioskOrigins"\)\][\s\S]{0,80}?\[switch\]\$ReplaceLocalApiAllowedOrigins/, 'installer must expose one canonical replacement switch with the legacy alias')
assert.match(installer, /ConvertTo-CanonicalOrigin/, 'installer must validate every local API origin')
assert.match(installer, /localApiAllowedOrigins\s*=\s*@\(\$effectiveLocalApiAllowedOrigins\)/, 'installer must persist the production Kiosk origins')
assert.match(installer, /Get-PreservedLocalSettings/, 'installer upgrades must inspect existing local-only settings')
assert.match(installer, /@\("scanWatchFolder", "localApiBridgeToken", "localUpdateControlToken"\)/, 'installer upgrades must preserve scan, bridge, and updater handshake settings')
assert.match(installer, /RandomNumberGenerator\]::Create\(\)/, 'installer must generate the updater handshake token with a CSPRNG')
assert.match(installer, /localUpdateControlToken\s*=\s*\$effectiveUpdateControlToken/, 'installer must persist the protected updater handshake token')
assert.match(
  installer,
  /Get-PreservedLocalSettings[\s\S]{0,220}?-SkipOrigins \(\[bool\]\$ReplaceLocalApiAllowedOrigins\)/,
  'origin replacement must skip invalid historical origins while retaining other protected local settings',
)
assert.match(
  installer,
  /if \(-not \$SkipOrigins -and \$null -ne \$originProperty\)/,
  'preserved settings reader must bypass historical origin parsing in replacement mode',
)
assert.match(installer, /\$preservedOrigins/, 'installer must merge protected existing origins with explicit Kiosk origins')
assert.match(
  installer,
  /-not \$ReplaceLocalApiAllowedOrigins -and \$preservedLocalSettings\.Contains\("localApiAllowedOrigins"\)/,
  'installer must ignore preserved origins when the operator requests replacement',
)
assert.match(installer, /Assert-ProgramDataAcl -Path \$ConfigPath -IsContainer \$false/, 'installer must only preserve settings from protected config')

const generatedConfig = sourceBetween(
  installer,
  /function Test-GeneratedConfig\(/,
  /\nfunction /,
)
assert.match(
  generatedConfig,
  /\[System\.Collections\.IDictionary\]\$Config/,
  'Test-GeneratedConfig must accept an IDictionary',
)
for (const field of ['apiBaseUrl', 'terminalCode', 'terminalId', 'printerName', 'agentVersion']) {
  assertIncludes(generatedConfig, field, `Test-GeneratedConfig must include ${field} in its required field checks`)
}
for (const field of ['heartbeatIntervalMs', 'claimIntervalMs', 'localApiPort']) {
  assertIncludes(generatedConfig, field, `Test-GeneratedConfig must include ${field} in its positive integer checks`)
}
assert.match(generatedConfig, /ConvertTo-Json/, 'Test-GeneratedConfig must serialize generated config')
assert.match(generatedConfig, /ConvertFrom-Json/, 'Test-GeneratedConfig must parse generated config')
assert.match(generatedConfig, /Fail /, 'Test-GeneratedConfig must use the installer failure path')

const configValidationCall = installer.indexOf('Test-GeneratedConfig -Config $config')
const runtimeSecurityStep = installer.indexOf('Write-Step "Verifying restricted Agent runtime"')
const programDataAclStep = installer.indexOf('Write-Step "Hardening ProgramData ACL"')
const tokenPreparation = installer.indexOf('Write-Step "Preparing token"')
const bindCodeExchange = installer.indexOf('$exchange = Exchange-BindCode -ApiBase $apiBase -Code $effectiveBindCode')
const existingTokenCheck = installer.indexOf('Test-TokenFile $tokenPath')
const failClosedTokenSource = installer.indexOf(
  'Fail "Provide -PromptForBindCode, -BindCodeFromStandardInput (GUI), -BindCode (legacy), or -UseExistingToken. Long-lived -AgentToken CLI input is not accepted."',
)
const configCommit = installer.indexOf('Commit-ProductionConfigAndToken -ConfigPath $configPath -ConfigText ($configJson + "`n") -TokenPath $tokenPath -TokenToPersist $tokenToPersist')
const processStop = installer.indexOf('Stop-Process -Id $p.ProcessId')
const resolvedServiceName = installer.indexOf('$serviceName = [string]$service.Name')
const serviceStart = installer.indexOf('Start-Service -Name $serviceName')
const serviceRestart = installer.indexOf('Restart-Service -Name $serviceName -Force')
assert.notEqual(configValidationCall, -1, 'installer must validate the generated config')
for (const [label, index] of [
  ['ProgramData ACL hardening', programDataAclStep],
  ['token preparation', tokenPreparation],
  ['BindCode exchange', bindCodeExchange],
  ['existing token validation', existingTokenCheck],
  ['fail-closed token source', failClosedTokenSource],
  ['restricted runtime preflight', runtimeSecurityStep],
  ['config/token commit', configCommit],
  ['stale process stop', processStop],
  ['resolved SCM service name', resolvedServiceName],
  ['service start', serviceStart],
  ['service restart', serviceRestart],
]) {
  assert.notEqual(index, -1, `installer must retain ${label}`)
}
assert.doesNotMatch(installer, /\[string\]\$AgentToken\b/, 'installer must not accept a long-lived -AgentToken CLI parameter')
assert.doesNotMatch(installer, /\$tokenToPersist\s*=\s*\$AgentToken\.Trim\(\)/, 'installer must not persist tokens from CLI argv')
assert.doesNotMatch(installer, /Copy-Item\s+\$configPath\s+\$backup/, 'installer must not copy an unknown legacy config that may contain plaintext credentials')
assert.ok(runtimeSecurityStep < bindCodeExchange, 'restricted runtime verification must happen before BindCode exchange')
assert.ok(programDataAclStep < tokenPreparation, 'ProgramData ACL hardening must happen before token preparation')
assert.ok(tokenPreparation < bindCodeExchange, 'BindCode exchange must happen during token preparation')
assert.ok(bindCodeExchange < configValidationCall, 'BindCode identity must populate generated config before validation')
assert.ok(configValidationCall < configCommit, 'generated config validation must finish before the local commit')
assert.ok(bindCodeExchange < configCommit, 'BindCode exchange must finish before the local commit')
assert.ok(existingTokenCheck < configCommit, 'existing token validation must finish before the local commit')
assert.ok(failClosedTokenSource < configCommit, 'fail-closed token source must finish before the local commit')
assert.ok(configCommit < processStop, 'the local commit must finish before stopping Agent processes')
assert.ok(resolvedServiceName < serviceStart, 'installer must resolve the SCM service name before starting it')
assert.ok(resolvedServiceName < serviceRestart, 'installer must resolve the SCM service name before restarting it')
assert.ok(configCommit < serviceStart, 'the local commit must finish before starting the service')
assert.ok(configCommit < serviceRestart, 'the local commit must finish before restarting the service')
assert.match(installer, /if\s*\(\$service\.State\s+-ne\s+"Running"\)/, 'installer must use the CIM service State when deciding whether to start or restart')
assert.doesNotMatch(installer, /\$service\.Status/, 'installer must not read the unsupported CIM Status property')
assert.ok(
  (installer.match(/Resolve-AgentService\s+-Identity\s+\$agentServiceIdentity/g) ?? []).length >= 4,
  'installer must resolve the service during preflight, install, and post-start verification',
)

const atomicFileReplacer = sourceBetween(installer, /function Replace-FileAtomically\(/, /\nfunction /)
assert.match(atomicFileReplacer, /File\]::Replace\(\$SourcePath,\s*\$DestinationPath,\s*\$backupPath\)/, 'atomic replacement must use an explicit backup path for Windows PowerShell 5.1')
assert.match(atomicFileReplacer, /replace-backup\.tmp/, 'atomic replacement backup must be a scoped temporary file')
assert.match(atomicFileReplacer, /\$replaceSucceeded\s*=\s*\$true/, 'atomic replacement must track successful replacement before cleanup')
assert.match(atomicFileReplacer, /Remove-Item\s+-LiteralPath\s+\$backupPath\s+-Force\s+-ErrorAction\s+SilentlyContinue/, 'atomic replacement must clean up a successful replacement backup without converting cleanup failure into a commit failure')

const atomicConfigWriter = sourceBetween(installer, /function Write-TextAtomically\(/, /\nfunction /)
assert.match(atomicConfigWriter, /UTF8Encoding\]::new\(\$false\)/, 'config atomic writer must use UTF-8 without a BOM')
assert.match(atomicConfigWriter, /FileStream/, 'config atomic writer must use FileStream')
assert.match(atomicConfigWriter, /CreateNew/, 'config atomic writer must create its temporary file exclusively')
assert.match(atomicConfigWriter, /\.GetBytes\(/, 'config atomic writer must encode the complete text before writing')
assert.match(atomicConfigWriter, /\.Write\(/, 'config atomic writer must write encoded bytes')
assert.match(atomicConfigWriter, /\.Flush\(\$true\)/, 'config atomic writer must flush file content to disk')
assert.match(atomicConfigWriter, /Replace-FileAtomically\s+-SourcePath\s+\$tempPath\s+-DestinationPath\s+\$Path/, 'config atomic writer must replace an existing config through the explicit-backup helper')
assert.match(atomicConfigWriter, /File\]::Move/, 'config atomic writer must move a new config into place atomically')
assert.match(atomicConfigWriter, /finally/, 'config atomic writer must clean up temporary files')
assert.match(atomicConfigWriter, /Remove-Item\s+-LiteralPath\s+\$tempPath\s+-Force/, 'config atomic writer must remove its temporary file in finally cleanup')
assertIncludes(
  atomicConfigWriter,
  '.${fileName}.${PID}.',
  'config atomic temp name must brace-delimit $fileName and $PID before trailing dots',
)
assert.doesNotMatch(installer, /\[System\.IO\.File\]::WriteAllText\(\$configPath/, 'config writes must not use WriteAllText directly')
assert.doesNotMatch(
  installer,
  /File\]::Replace\([^)\n]*,\s*\$null\s*\)/,
  'installer must not pass bare $null to File.Replace (PowerShell 5.1 rejects it)',
)
assert.doesNotMatch(installer, /\[NullString\]::Value/, 'installer must use an explicit backup path rather than an implicit null backup path')
const programDataAcl = sourceBetween(installer, /function Set-ProgramDataAcl\(/, /\nfunction /)
assert.match(programDataAcl, /SetAccessRuleProtection\(\$true,\s*\$false\)/, 'ProgramData ACL must disable inheritance without copying inherited ACEs')
assert.match(programDataAcl, /SetOwner\(\$administratorsSid\)/, 'ProgramData ACL must set a trusted owner')
assert.match(programDataAcl, /S-1-5-18/, 'ProgramData ACL must grant SYSTEM')
assert.match(programDataAcl, /S-1-5-32-544/, 'ProgramData ACL must grant Administrators')
assert.match(programDataAcl, /Set-Acl\s+-LiteralPath\s+\$Path\s+-AclObject\s+\$acl/, 'ProgramData ACL must apply via Set-Acl')
assert.match(programDataAcl, /Assert-ProgramDataAcl/, 'ProgramData ACL must be read back and validated')
assert.match(programDataAcl, /Assert-NotReparsePoint/, 'ProgramData ACL must reject reparse points')
assert.doesNotMatch(programDataAcl, /Everyone|Authenticated Users|BUILTIN\\Users|S-1-5-11|S-1-1-0/i, 'ProgramData ACL must not grant broad interactive users')

const programDataAclVerifier = sourceBetween(installer, /function Assert-ProgramDataAcl\(/, /\nfunction /)
assert.match(programDataAclVerifier, /S-1-5-32-544/, 'ACL verifier must require Administrators owner')
assert.match(programDataAclVerifier, /\$rules\.Count\s+-ne\s+2/, 'ACL verifier must require exactly two rules')
assert.match(programDataAclVerifier, /FileSystemRights\]::FullControl/, 'ACL verifier must require FullControl')
assert.match(programDataAclVerifier, /InheritanceFlags/, 'ACL verifier must validate inheritance scope')
assert.match(programDataAclVerifier, /PropagationFlags/, 'ACL verifier must validate propagation scope')

assert.match(installer, /provisioning-runtime-security\.ps1/, 'installer must load the shared runtime ACL helper')
const runtimeVerifier = sourceBetween(runtimeSecurity, /function Assert-RestrictedRuntime\(/, /\n}/)
assert.match(runtimeVerifier, /Get-ChildItem\s+-Force\s+-LiteralPath/, 'runtime verifier must recurse through loaded files')
assert.match(runtimeVerifier, /Assert-NotReparsePoint/, 'runtime verifier must reject reparse points')
assert.match(runtimeVerifier, /Test-WriteLikeFileSystemRights/, 'runtime verifier must use the atomic write-right classifier')
assert.match(runtimeSecurity, /ChangePermissions/, 'runtime verifier must reject WRITE_DAC-like rights')
assert.match(runtimeSecurity, /TakeOwnership/, 'runtime verifier must reject WRITE_OWNER-like rights')
assert.match(runtimeSecurity, /WriteData/, 'runtime verifier must reject file or directory creation rights')
assert.doesNotMatch(runtimeSecurity, /FileSystemRights\]::Modify\s+-bor/, 'runtime verifier must not classify ReadAndExecute as unsafe through the composite Modify value')
assert.match(installer, /Get-NodeModuleRoots/, 'installer must discover Node dependency roots')
assert.match(installer, /Assert-RestrictedRuntime\s+-Root\s+\$nodeModuleRoot/, 'installer must verify Node dependency trees')
assert.match(installer, /Set-ProgramDataTreeAcl\s+-Root\s+\$programDataDir/, 'installer must harden existing ProgramData descendants')

const serviceSecurity = sourceBetween(installer, /function Assert-AgentServiceSecurity\(/, /\nfunction /)
assert.match(serviceSecurity, /StartName/, 'service security must validate the service account')
assert.match(serviceSecurity, /LocalSystem/, 'service security must require LocalSystem')
assert.match(serviceSecurity, /PathName/, 'service security must validate the service executable path')

const protectToken = sourceBetween(installer, /function Protect-AgentToken\(/, /\nfunction /)
assert.match(protectToken, /Set-ProgramDataAcl\s+-Path\s+\$dir/, 'DPAPI token writes must harden the ProgramData directory ACL')
assert.match(protectToken, /Write-TextAtomically\s+-Path\s+\$TokenPath\s+-Text\s+\$b64/, 'DPAPI token writes must use the atomic writer')
assert.match(protectToken, /Set-ProgramDataAcl\s+-Path\s+\$TokenPath/, 'DPAPI token writes must harden the token file ACL')
assert.doesNotMatch(protectToken, /WriteAllText/, 'DPAPI token writes must not use WriteAllText directly')

const productionCommit = sourceBetween(installer, /function Commit-ProductionConfigAndToken\(/, /\nfunction /)
assert.match(productionCommit, /\$hadExistingToken\s*=\s*Test-Path\s+-LiteralPath\s+\$TokenPath/, 'local commit must record whether a token already exists')
assert.match(productionCommit, /Join-Path\s+\$tokenDirectory/, 'local commit rollback file must live beside the token')
assert.match(productionCommit, /Copy-Item\s+-LiteralPath\s+\$TokenPath\s+-Destination\s+\$tokenRollbackPath\s+-Force/, 'local commit must copy an existing token before overwriting it')
assert.match(productionCommit, /Protect-AgentToken\s+-Token\s+\$TokenToPersist\s+-TokenPath\s+\$TokenPath/, 'local commit must atomically persist a newly sourced token first')
assert.match(productionCommit, /Write-TextAtomically\s+-Path\s+\$ConfigPath\s+-Text\s+\$ConfigText/, 'local commit must atomically persist config after token')
assert.ok(
  productionCommit.indexOf('Protect-AgentToken -Token $TokenToPersist -TokenPath $TokenPath') < productionCommit.indexOf('Write-TextAtomically -Path $ConfigPath -Text $ConfigText'),
  'local commit must write token before config',
)
assert.match(
  productionCommit,
  /Replace-FileAtomically\s+-SourcePath\s+\$tokenRollbackPath\s+-DestinationPath\s+\$TokenPath/,
  'local commit must restore an existing token via the explicit-backup helper',
)
assert.match(productionCommit, /File\]::Move\(\$tokenRollbackPath,\s*\$TokenPath\)/, 'local commit must restore when the token destination is absent')
assert.match(productionCommit, /Remove-Item\s+-LiteralPath\s+\$tokenRollbackPath\s+-Force/, 'local commit must clean up its rollback temporary file')
assertIncludes(
  productionCommit,
  '.agent.token.rollback.${PID}.',
  'token rollback temp name must brace-delimit $PID before the trailing dot',
)
assert.match(productionCommit, /Could not commit production config and terminal token locally/, 'local commit failures must use a fixed non-secret recovery message')
const invokeSc = sourceBetween(installer, /function Invoke-Sc\(/, /\nfunction /)
assertIncludes(invokeSc, '& sc.exe @Arguments 2>&1', 'Invoke-Sc must execute sc.exe through its argument array')
assert.match(invokeSc, /\$LASTEXITCODE/, 'Invoke-Sc must check sc.exe exit status')
assert.match(invokeSc, /\$\{LASTEXITCODE\}:/, 'Invoke-Sc failure text must parse in Windows PowerShell 5.1')
assert.match(invokeSc, /Fail /, 'Invoke-Sc must fail on a non-zero sc.exe exit status')

const serviceRecovery = sourceBetween(installer, /function Set-AgentServiceRecovery\(/, /\n\$repoRoot/)
assert.match(serviceRecovery, /failure/, 'service recovery must configure sc.exe failure actions')
assert.match(serviceRecovery, /reset=/, 'service recovery must set a reset period')
assert.match(serviceRecovery, /86400/, 'service recovery reset period must be one day')
assert.match(serviceRecovery, /actions=/, 'service recovery must configure actions')
assertIncludes(serviceRecovery, 'restart/60000/restart/300000/""/0', 'service recovery must use two finite restarts and a no-action third failure')
assert.match(serviceRecovery, /failureflag/, 'service recovery must enable failure handling for non-crash failures')
assert.match(serviceRecovery, /qfailure/, 'service recovery must read back the configured policy')
assert.match(serviceRecovery, /\$\{ServiceName\}:/, 'service recovery status text must parse in Windows PowerShell 5.1')
assert.match(serviceRecovery, /Write-Host/, 'service recovery must display the qfailure output to the operator')

const automaticStartup = installer.indexOf('Set-Service -Name $serviceName -StartupType Automatic')
const recoverySetup = installer.indexOf('Set-AgentServiceRecovery $serviceName')
assert.notEqual(automaticStartup, -1, 'service must use Automatic startup')
assert.notEqual(recoverySetup, -1, 'installer must configure service recovery')
assert.ok(automaticStartup < recoverySetup, 'service recovery must be configured after Automatic startup')
assert.ok(recoverySetup < serviceStart, 'service recovery must be configured before starting the service')
assert.ok(recoverySetup < serviceRestart, 'service recovery must be configured before restarting the service')

assert.doesNotMatch(installer, /(?:node|pnpm|npm|ts-node)[^\r\n]*\bprint\b/i, 'installer must not run a print command')
assert.doesNotMatch(installer, /\/(?:api\/v1\/)?print(?:\/jobs)?\b/i, 'installer must not call a print or task-creation endpoint')
assert.doesNotMatch(installer, /Write-Output\s+\$config\b/, 'installer must not output the generated config')
assert.doesNotMatch(installer, /\$config\.agentToken\b/, 'installer must not access a token from generated config')

assert.match(diagnosis, /service-identity\.ps1/, 'diagnosis must source the shared service identity helper')
assert.match(diagnosis, /Resolve-AgentService\s+-Identity\s+\$ServiceName/, 'diagnosis must resolve a service by Name or DisplayName')
assert.match(diagnosis, /\$serviceResolution\s*=\s*"ambiguous"/, 'diagnosis must distinguish an ambiguous service match from a missing service')
assert.match(diagnosis, /\$serviceAmbiguous\s*=\s*\$serviceResolution\s+-eq\s+"ambiguous"/, 'diagnosis must calculate the ambiguity flag from the closed resolution state')
assert.match(diagnosis, /UTF8Encoding/, 'diagnosis must use UTF-8 encoding to inspect the config')
assert.match(diagnosis, /0xEF/, 'diagnosis must detect a UTF-8 BOM from the first three bytes')
assert.match(diagnosis, /TrimStart\(\[char\]0xFEFF\)/, 'diagnosis must accept a config that starts with a UTF-8 BOM')
assert.match(diagnosis, /ConvertFrom-Json/, 'diagnosis must validate JSON without outputting config content')
assert.match(diagnosis, /INVALID_DIAGNOSTIC_FILE/, 'diagnosis must return a closed code for an invalid startup diagnostic file')
assert.match(diagnosis, /sc\.exe\s+qfailure/, 'diagnosis must read the configured SCM failure policy')
assert.match(diagnosis, /Get-PathPresenceStatus\s+\$tokenPath\s+"Leaf"/, 'diagnosis must inspect token presence through the closed AccessDenied-safe helper')
const pathPresence = sourceBetween(diagnosis, /function Get-PathPresenceStatus\(/, /\nfunction /)
assert.match(pathPresence, /-ErrorAction\s+Stop/, 'path presence checks must make AccessDenied catchable')
assert.match(pathPresence, /"present"/, 'path presence vocabulary must include present')
assert.match(pathPresence, /"missing"/, 'path presence vocabulary must include missing')
assert.match(pathPresence, /"unavailable"/, 'path presence vocabulary must include unavailable')

const allowedDiagnosticCodes = [
  'AGENT_CONFIG_NOT_FOUND',
  'AGENT_CONFIG_INVALID_JSON',
  'AGENT_CONFIG_INVALID_SHAPE',
  'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
  'AGENT_CONFIG_INVALID_FIELD',
  'AGENT_TOKEN_DECRYPT_FAILED',
  'AGENT_PROFILE_REJECTED',
  'AGENT_REGISTRATION_FAILED',
  'AGENT_STARTUP_FAILED',
  'AGENT_UNAUTHORIZED',
  'AGENT_READY',
]
assert.match(diagnosis, /\$allowedDiagnosticCodes\s*=\s*@\(/, 'diagnosis must define an explicit startup diagnostic code whitelist')
for (const code of allowedDiagnosticCodes) {
  assertIncludes(diagnosis, code, `diagnosis whitelist must include ${code}`)
}
const startupDiagnosticReader = sourceBetween(diagnosis, /function Get-StartupDiagnosticCode\(/, /\nfunction Get-ProgramDataAclStatus\(/)
assert.match(startupDiagnosticReader, /\$diagnostic\.schemaVersion\s+-ne\s+1/, 'diagnosis must validate diagnostic schemaVersion')
assert.match(startupDiagnosticReader, /\$diagnostic\.state\s+-isnot\s+\[string\]/, 'diagnosis must validate diagnostic state type')
assert.match(startupDiagnosticReader, /\$diagnostic\.state\s+-notin\s+@\("ready",\s*"failed"\)/, 'diagnosis must validate diagnostic state')
assert.match(startupDiagnosticReader, /\$diagnostic\.code\s+-isnot\s+\[string\]/, 'diagnosis must validate diagnostic code type')
assert.match(startupDiagnosticReader, /IsNullOrWhiteSpace\(\[string\]\$diagnostic\.code\)/, 'diagnosis must reject empty diagnostic codes')
assert.match(startupDiagnosticReader, /\$allowedDiagnosticCodes\s+-notcontains\s+\$diagnostic\.code/, 'diagnosis must reject codes outside the whitelist')

assert.match(diagnosis, /function Get-ProgramDataAclStatus\(/, 'diagnosis must expose a closed ProgramData ACL inspector')
const aclInspector = sourceBetween(diagnosis, /function Get-ProgramDataAclStatus\(/, /\n\$service\s*=/)
assert.match(aclInspector, /Get-Acl\s+-LiteralPath/, 'ACL inspector must use Get-Acl')
assert.match(aclInspector, /AreAccessRulesProtected/, 'ACL inspector must require inheritance disabled')
assert.match(aclInspector, /ConvertTo-SidValue\s+\$acl\.Owner/, 'ACL inspector must validate owner by SID')
assert.match(aclInspector, /FileSystemRights\]::FullControl/, 'ACL inspector must require FullControl')
assert.match(aclInspector, /InheritanceFlags/, 'ACL inspector must validate inheritance scope')
assert.match(aclInspector, /PropagationFlags/, 'ACL inspector must validate propagation scope')
assert.match(aclInspector, /ReparsePoint/, 'ACL inspector must reject reparse points')
assert.match(aclInspector, /S-1-5-18/, 'ACL inspector must require SYSTEM')
assert.match(aclInspector, /S-1-5-32-544/, 'ACL inspector must require Administrators')
assert.match(aclInspector, /S-1-1-0/, 'ACL inspector must detect Everyone')
assert.match(aclInspector, /S-1-5-11/, 'ACL inspector must detect Authenticated Users')
assert.match(aclInspector, /S-1-5-32-545/, 'ACL inspector must detect BUILTIN\\Users')
for (const status of ['missing', 'ok', 'too_permissive', 'unexpected', 'unavailable']) {
  assertIncludes(aclInspector, `"${status}"`, `ACL inspector vocabulary must include ${status}`)
}
assert.doesNotMatch(aclInspector, /Set-Acl|SetAccessRuleProtection|AddAccessRule/, 'ACL inspector must remain read-only')

const configStatusStart = diagnosis.lastIndexOf('$configFieldStatus = [pscustomobject]@{')
assert.notEqual(configStatusStart, -1, 'diagnosis must calculate field status through a PSCustomObject')
const configStatusEnd = diagnosis.indexOf('\n}', configStatusStart)
assert.notEqual(configStatusEnd, -1, 'diagnosis field status block must be closed')
const configStatus = diagnosis.slice(configStatusStart, configStatusEnd + 2)
for (const field of ['apiBaseUrl', 'terminalCode', 'terminalId', 'printerName', 'agentVersion']) {
  assert.match(
    configStatus,
    new RegExp(`^\\s*${field}\\s*=\\s*-not \\[string\\]::IsNullOrWhiteSpace\\(\\[string\\]\\$config\\.${field}\\)\\s*$`, 'm'),
    `diagnosis must calculate ${field} as an explicit boolean`,
  )
}

const diagnosisOutput = diagnosis.slice(diagnosis.lastIndexOf('[pscustomobject]@{'))
assert.notEqual(diagnosisOutput, diagnosis, 'diagnosis must output a PSCustomObject')
for (const field of ['apiBaseUrl', 'terminalCode', 'terminalId', 'printerName', 'agentVersion']) {
  assert.match(
    diagnosisOutput,
    new RegExp(`^\\s*${field}\\s*=\\s*\\$configFieldStatus\\.${field}\\s*$`, 'm'),
    `diagnosis output must map ${field} from its precomputed safe status`,
  )
}
assert.match(diagnosisOutput, /^\s*encryptedTokenFile\s*=\s*\$encryptedTokenFile\s*$/m, 'diagnosis output must map encryptedTokenFile from its safe path check')
assert.match(diagnosisOutput, /^\s*tokenFilePresenceStatus\s*=\s*\$tokenFilePresenceStatus\s*$/m, 'diagnosis output must distinguish token missing from inaccessible')
assert.match(diagnosisOutput, /^\s*lastStartupDiagnosticCode\s*=\s*\$lastStartupDiagnosticCode\s*$/m, 'diagnosis output must map the closed startup diagnostic code')
assert.match(diagnosisOutput, /^\s*startupDiagnosticFileStatus\s*=\s*\$startupDiagnosticFileStatus\s*$/m, 'diagnosis output must distinguish an inaccessible startup diagnostic')
assert.match(diagnosisOutput, /^\s*programDataAclStatus\s*=\s*\$programDataAclStatus\s*$/m, 'diagnosis output must map ProgramData ACL status')
assert.match(diagnosisOutput, /^\s*tokenFileAclStatus\s*=\s*\$tokenFileAclStatus\s*$/m, 'diagnosis output must map token file ACL status')
assert.match(diagnosisOutput, /^\s*runtimeRootAclStatus\s*=\s*\$runtimeRootAclStatus\s*$/m, 'diagnosis output must map runtime root ACL status')
assert.match(diagnosisOutput, /^\s*serviceStartName\s*=\s*\$serviceStartName\s*$/m, 'diagnosis must report the service account')
assert.match(diagnosisOutput, /^\s*serviceIdentityStatus\s*=\s*\$serviceIdentityStatus\s*$/m, 'diagnosis must report the closed service account status')
assert.match(diagnosisOutput, /^\s*serviceName\s*=\s*\$resolvedServiceName\s*$/m, 'diagnosis must report the resolved SCM service Name')
assert.match(diagnosisOutput, /^\s*serviceDisplayName\s*=\s*\$resolvedServiceDisplayName\s*$/m, 'diagnosis must report the resolved service DisplayName')
assert.match(diagnosisOutput, /^\s*serviceAmbiguous\s*=\s*\$serviceAmbiguous\s*$/m, 'diagnosis must report whether service resolution was ambiguous')
assert.match(diagnosisOutput, /^\s*serviceResolution\s*=\s*\$serviceResolution\s*$/m, 'diagnosis must report the closed service resolution state')
assert.doesNotMatch(diagnosisOutput, /\$config\b/, 'diagnosis summary must not reference the full config object')
assert.doesNotMatch(diagnosisOutput, /agentToken/i, 'diagnosis summary must not expose agentToken')
assert.doesNotMatch(diagnosisOutput, /adminSecret/i, 'diagnosis summary must not expose adminSecret')
assert.doesNotMatch(diagnosisOutput, /bindCode/i, 'diagnosis summary must not expose bindCode')
assert.doesNotMatch(diagnosisOutput, /Authorization/i, 'diagnosis summary must not expose Authorization data')

assert.doesNotMatch(diagnosis, /Write-(?:Host|Output)\s+\$config\b/, 'diagnosis must not output config content')
assert.doesNotMatch(diagnosis, /\$config\.agentToken\b/, 'diagnosis must not expose agentToken')
assert.doesNotMatch(diagnosis, /\$config\.adminSecret\b/, 'diagnosis must not expose adminSecret')
assert.doesNotMatch(diagnosis, /\$config\.bindCode\b/, 'diagnosis must not expose bindCode')
assert.doesNotMatch(diagnosis, /ConvertTo-Json\s+\$config\b/, 'diagnosis must not serialize config content')
assert.doesNotMatch(diagnosis, /\$config\s*\|\s*ConvertTo-Json/i, 'diagnosis must not serialize config through a PowerShell pipeline')
assert.doesNotMatch(diagnosis, /Authorization/i, 'diagnosis must not emit Authorization data')
assert.doesNotMatch(
  diagnosis,
  /Invoke-RestMethod|Invoke-WebRequest|Test-Connection|\bcurl(?:\.exe)?\b|Start-BitsTransfer|WebClient|HttpClient|System\.Net\.WebRequest|Start-Process|\/print|POST/i,
  'diagnosis must not make network, process, or print calls',
)

assert.match(diagnosis, /\$scriptRoot\s*=\s*\$PSScriptRoot/, 'diagnosis must capture PSScriptRoot after startup')
assert.match(diagnosis, /MyInvocation\.MyCommand\.Path/, 'diagnosis must fall back to MyInvocation when PSScriptRoot is empty')
assert.match(diagnosis, /Join-Path\s+\$scriptRoot\s+"service-identity\.ps1"/, 'diagnosis must load helpers from resolved scriptRoot')

const bridgeConfigurePath = path.join(__dirname, 'configure-local-bridge-token.ps1')
const bridgeConfigure = fs.readFileSync(bridgeConfigurePath, 'utf8')
assert.match(bridgeConfigure, /param\(/, 'Gate 0k bridge configure script must declare parameters')
assert.match(bridgeConfigure, /\$TokenFile/, 'Gate 0k bridge configure must require TokenFile')
assert.match(bridgeConfigure, /\$ConfigDir/, 'Gate 0k bridge configure must accept ConfigDir for repo-directory installs')
assert.match(bridgeConfigure, /localApiBridgeToken/, 'Gate 0k bridge configure must write localApiBridgeToken')
assert.match(bridgeConfigure, /https:\/\/zyidai\.cn/, 'Gate 0k bridge configure must allow the production Kiosk origin')
assert.match(bridgeConfigure, /Write-TextAtomically/, 'Gate 0k bridge configure must persist config atomically')
assert.match(bridgeConfigure, /WhatIfCheck/, 'Gate 0k bridge configure must support a no-write presence check')
assert.match(bridgeConfigure, /Resolve-AgentService/, 'Gate 0k bridge configure must resolve SCM Name or DisplayName via service-identity helper')
assert.match(bridgeConfigure, /service-identity\.ps1/, 'Gate 0k bridge configure must load service-identity.ps1')
assert.match(bridgeConfigure, /aijobprintagent\.exe/, 'Gate 0k bridge configure docs must mention node-windows SCM Name aijobprintagent.exe')
assert.doesNotMatch(
  bridgeConfigure,
  /Write-Host\s+\$token\b|Write-Output\s+\$token\b|Write-Host\s+\$existingToken\b/,
  'Gate 0k bridge configure must never print the bridge token value',
)
assert.doesNotMatch(
  bridgeConfigure,
  /Invoke-RestMethod|Invoke-WebRequest|Test-Connection|\bcurl(?:\.exe)?\b|Start-BitsTransfer|WebClient|HttpClient|System\.Net\.WebRequest/,
  'Gate 0k bridge configure must not contact the network',
)

console.log('ALL PASS: terminal-agent Windows service recovery')
