import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCandidateProvenance } from './verify-candidate-provenance.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const workspace = fs.readFileSync(path.join(root, '../../../pnpm-workspace.yaml'), 'utf8')
const agentPackage = JSON.parse(fs.readFileSync(path.join(root, '../package.json'), 'utf8'))
const inputs = JSON.parse(read('inputs.json'))
const wix = read('Agent.wxs')
const project = read('AIJobPrintAgent.wixproj')
const bundle = read('Bundle.wxs')
const bundleProject = read('AIJobPrintTerminalSetup.wixproj')
const buildMsi = read('build-msi.ps1')
const buildExe = read('build-exe.ps1')
const staging = read('build-staging.ps1')
const provisionWizard = read('provision/provision-installed-agent.ps1')
const provisionLauncher = read('provision/provision-terminal.cmd')
const controlCenter = read('provision/terminal-control-center.ps1')
const controlCenterLauncher = read('provision/launch-control-center.vbs')
const stagedPowerShellVerify = read('verify-staged-powershell.ps1')
const printServiceCompletionVerify = read('verify-printservice-completion.mjs')
const serviceXml = read('bootstrap/aijobprintagent.xml')
const agentCli = fs.readFileSync(path.join(root, '../src/index.ts'), 'utf8')
const runtimeVersion = fs.readFileSync(path.join(root, '../src/runtime-version.ts'), 'utf8')
const heartbeat = fs.readFileSync(path.join(root, '../src/agent/heartbeat.ts'), 'utf8')
const localApi = fs.readFileSync(path.join(root, '../src/local-api/qr-login-server.ts'), 'utf8')
const statusPanel = fs.readFileSync(path.join(root, '../src/local-api/status-panel.ts'), 'utf8')
const panelShortcut = read('assets/AI Job Print Terminal.url')
const agentConfigExample = JSON.parse(
  fs.readFileSync(path.join(root, '../agent-config.example.json'), 'utf8'),
)
const productionInstaller = fs.readFileSync(
  path.join(root, '../scripts/install-production-agent.ps1'),
  'utf8',
)
const runtimeSecurity = fs.readFileSync(
  path.join(root, '../scripts/provisioning-runtime-security.ps1'),
  'utf8',
)
const workflow = fs.readFileSync(
  path.join(root, '../../../.github/workflows/windows-agent-installer.yml'),
  'utf8',
)
const secureScanReaderVerify = read('verify-secure-scan-reader.ps1')
const secureScanReader = [
  '../native/secure-scan-reader.c',
  '../native/secure-scan-protocol.h',
].map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
const secureScanMutation = fs.readFileSync(path.join(root, '../native/secure-scan-mutation.c'), 'utf8')
const secureScanPath = fs.readFileSync(path.join(root, '../native/secure-scan-path.c'), 'utf8')
const windowsScanAdapter = fs.readFileSync(path.join(root, '../src/agent/scan-input/windows-secure-reader.ts'), 'utf8')
const scanWatcher = fs.readFileSync(path.join(root, '../src/agent/scan-watcher.ts'), 'utf8')

console.log('\n=== verify Windows Agent installer inputs ===')

assert.equal(inputs.schemaVersion, 1)
assert.equal(inputs.productVersion, '0.4.14')
assert.equal(
  inputs.productVersion,
  agentPackage.version,
  'installer and Agent package versions must advance together',
)
assert.match(runtimeVersion, /AGENT_RUNTIME_VERSION\s*=\s*agentPackage\.version/)
assert.match(agentCli, /\.version\(AGENT_RUNTIME_VERSION\)/)
assert.match(heartbeat, /agentVersion:\s*AGENT_RUNTIME_VERSION/)
assert.doesNotMatch(heartbeat, /agentVersion:\s*config\.agentVersion/)
assert.equal(agentConfigExample.agentVersion, inputs.productVersion)
assert.ok(productionInstaller.includes(`AgentVersion = "${inputs.productVersion}-production"`))
assert.equal(inputs.node.version, '22.23.1')
assert.match(inputs.node.url, /^https:\/\/nodejs\.org\//)
assert.match(inputs.serviceWrapper.url, /^https:\/\/github\.com\/winsw\/winsw\/releases\//)
for (const hash of [
  inputs.node.archiveSha256,
  inputs.node.executableSha256,
  inputs.serviceWrapper.sha256,
  inputs.sumatraPdf.sha256,
]) {
  assert.match(hash, /^[A-F0-9]{64}$/)
}
assert.match(inputs.wix.sdkVersion, /^4\./)
assert.ok(!/(token|password|secret|bindcode)/i.test(JSON.stringify(inputs)), 'input lock must not contain credentials')

assert.match(project, /WixToolset\.Sdk\/4\.0\.6/)
assert.match(wix, /Scope="perMachine"/)
assert.match(wix, /Name="aijobprintagent\.exe"/)
assert.match(wix, /Start="demand"/, 'unprovisioned service must remain Manual and stopped')
assert.match(wix, /AllowSameVersionUpgrades="yes"/, 'same-version reinstall must be a MajorUpgrade')
// 真机审查 2026-09-28：MSI 在安装时启动服务（ServiceControl Start="install"）会让启动失败拖垮整个安装
// （CI 实测 Error 1920 → 1603 回滚）。已绑定终端升级后自启另立任务，用「失败则忽略」的尽力启动实现并在 Windows 上验证。
assert.doesNotMatch(wix, /Start="install"/, 'MSI must not start the service during install: a start failure rolls back the whole install')
assert.match(wix, /Account="LocalSystem"/)
assert.match(wix, /Permanent="yes"/)
assert.match(wix, /NeverOverwrite="yes"/)
const customActionElements = wix.match(/<CustomAction\b[^>]*\/>/g) ?? []
// 数全所有写法：带内容的 <CustomAction>…</CustomAction>（内联脚本）不是自闭合，上面的匹配数不到，必须单独拦下。
assert.equal((wix.match(/<CustomAction\b/g) ?? []).length, customActionElements.length, 'every CustomAction must be a self-closing element covered by the fixed-action rules')
const customActionAttributes = (element) => {
  const attributes = new Map()
  for (const match of element.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g)) attributes.set(match[1], match[2])
  return attributes
}
const customActions = customActionElements.map(customActionAttributes)
const serviceRecoveryActionIds = [
  'AgentServiceRestoreAutoStart',
  'AgentServiceRestoreRecovery',
  'AgentServiceRestoreFailureFlag',
  'AgentServiceBestEffortStart',
]
const spoolerUninstallActionIds = [
  'RemoveBootSpoolGuardTask',
  'RemoveDailyRebootTask',
  'RestoreSpoolerAutomatic',
  'StartSpoolerService',
]
const spoolerUninstallCommands = new Map([
  ['RemoveBootSpoolGuardTask', '&quot;[System64Folder]schtasks.exe&quot; /Delete /TN &quot;AIJobPrintBootSpoolGuard&quot; /F'],
  ['RemoveDailyRebootTask', '&quot;[System64Folder]schtasks.exe&quot; /Delete /TN &quot;AIJobPrintDailyReboot&quot; /F'],
  ['RestoreSpoolerAutomatic', '&quot;[System64Folder]sc.exe&quot; config Spooler start= auto'],
  ['StartSpoolerService', '&quot;[System64Folder]sc.exe&quot; start Spooler'],
])
const expectedCustomActionIds = [...serviceRecoveryActionIds, ...spoolerUninstallActionIds]
assert.deepEqual(
  customActions.map((attributes) => attributes.get('Id')),
  expectedCustomActionIds,
  'MSI CustomAction set must be the four service recovery actions followed by the four spooler-guard uninstall actions',
)
for (const attributes of customActions) {
  assert.deepEqual(
    [...attributes.keys()].sort(),
    ['Directory', 'ExeCommand', 'Execute', 'Id', 'Impersonate', 'Return'].sort(),
    `CustomAction ${attributes.get('Id')} contains an unapproved attribute; MSI must not run provisioning code`,
  )
  assert.equal(attributes.get('Execute'), 'deferred', `CustomAction ${attributes.get('Id')} must be deferred`)
  assert.equal(attributes.get('Impersonate'), 'no', `CustomAction ${attributes.get('Id')} must run elevated`)
  assert.equal(attributes.get('Return'), 'ignore', `CustomAction ${attributes.get('Id')} must not make install fail on start error`)
  const command = attributes.get('ExeCommand')
  assert.doesNotMatch(command, /node|powershell|pwsh|\.ps1|\.js|\.cmd|\.bat|\.vbs|provision|cmd\.exe|msiexec/i, `CustomAction ${attributes.get('Id')} must not shell out to provisioning code`)
  if (serviceRecoveryActionIds.includes(attributes.get('Id'))) {
    assert.match(command, /^&quot;\[System64Folder\]sc\.exe&quot; /, `CustomAction ${attributes.get('Id')} must call system sc.exe`)
    assert.match(command, /\baijobprintagent\.exe\b/i, `CustomAction ${attributes.get('Id')} must target the Agent service`)
  } else {
    assert.equal(
      command,
      spoolerUninstallCommands.get(attributes.get('Id')),
      `CustomAction ${attributes.get('Id')} must use the fixed uninstall command`,
    )
  }
}
const actionSchedules = [...wix.matchAll(/<Custom\s+Action="([^"]+)"\s+After="([^"]+)"\s+Condition="([^"]+)"\s*\/>/g)]
// 同理：Before 写法、扩展里现成的动作（如 QuietExec）的调度也是 <Custom>，都必须落在上面的固定格式里。
assert.equal((wix.match(/<Custom\s/g) ?? []).length, actionSchedules.length, 'every <Custom> scheduling element must use the fixed After/Condition form checked below')
assert.equal(actionSchedules.length, expectedCustomActionIds.length, 'all fixed CustomActions must be scheduled exactly once')
for (let index = 0; index < serviceRecoveryActionIds.length; index += 1) {
  const [id, after, condition] = actionSchedules[index].slice(1)
  assert.equal(id, serviceRecoveryActionIds[index], `CustomAction ${serviceRecoveryActionIds[index]} must be scheduled in order`)
  assert.equal(after, index === 0 ? 'StartServices' : serviceRecoveryActionIds[index - 1], `CustomAction ${id} has the wrong sequence predecessor`)
  assert.match(condition, /AGENTBOUND = &quot;#1&quot;/, `CustomAction ${id} must require the bound marker`)
  assert.match(condition, /NOT \(REMOVE~=&quot;ALL&quot;\)/, `CustomAction ${id} must be excluded during uninstall`)
}
for (let index = 0; index < spoolerUninstallActionIds.length; index += 1) {
  const [id, after, condition] = actionSchedules[serviceRecoveryActionIds.length + index].slice(1)
  assert.equal(id, spoolerUninstallActionIds[index], `CustomAction ${spoolerUninstallActionIds[index]} must be scheduled in order`)
  assert.equal(after, index === 0 ? 'StopServices' : spoolerUninstallActionIds[index - 1], `CustomAction ${id} has the wrong sequence predecessor`)
  assert.match(condition, /REMOVE~=&quot;ALL&quot;/, `CustomAction ${id} must run only when removing the product`)
  assert.match(condition, /NOT UPGRADINGPRODUCTCODE/, `CustomAction ${id} must not run when a major upgrade removes the old product`)
}
const boundProperty = wix.match(/<Property\s+Id="AGENTBOUND"[\s\S]*?<\/Property>/)?.[0]
assert.ok(boundProperty, 'AGENTBOUND property must search the binding marker')
const boundSearch = boundProperty.match(/<RegistrySearch\b[^>]*\/>/)?.[0]
assert.ok(boundSearch, 'AGENTBOUND property must contain a RegistrySearch')
const boundSearchAttributes = customActionAttributes(boundSearch)
for (const [name, value] of [['Root', 'HKLM'], ['Type', 'raw'], ['Bitness', 'always64'], ['Key', 'SOFTWARE\\AIJobPrint\\Agent'], ['Name', 'Bound']]) {
  assert.equal(boundSearchAttributes.get(name), value, `AGENTBOUND RegistrySearch ${name} must match the production marker`)
}
const boundRegistryPath = productionInstaller.match(/\$boundRegistryPath\s*=\s*"HKLM:\\([^"\r\n]+)"/)?.[1]
const boundName = productionInstaller.match(/New-ItemProperty\s+-LiteralPath\s+\$boundRegistryPath\s+-Name\s+"([^"]+)"\s+-Value\s+1\s+-PropertyType\s+DWord/)?.[1]
assert.equal(boundRegistryPath, 'SOFTWARE\\AIJobPrint\\Agent', 'production binding marker path must remain parseable')
assert.equal(boundSearchAttributes.get('Key'), boundRegistryPath, 'MSI marker key must match install-production-agent.ps1')
assert.equal(boundName, 'Bound', 'production binding marker name must remain parseable')
assert.equal(boundSearchAttributes.get('Name'), boundName, 'MSI marker value name must match install-production-agent.ps1')
const autoStartCommand = customActions.find((attributes) => attributes.get('Id') === 'AgentServiceRestoreAutoStart').get('ExeCommand').replaceAll('&quot;', '"')
assert.match(productionInstaller, /Set-Service[\s\S]*?-StartupType\s+Automatic/, 'binding must set the service to Automatic')
assert.match(autoStartCommand, /\bconfig\s+aijobprintagent\.exe\s+start=\s+auto$/i, 'MSI must restore the same Automatic startup mode as binding')
const recoveryCommand = customActions.find((attributes) => attributes.get('Id') === 'AgentServiceRestoreRecovery').get('ExeCommand').replaceAll('&quot;', '"')
const failureFlagCommand = customActions.find((attributes) => attributes.get('Id') === 'AgentServiceRestoreFailureFlag').get('ExeCommand').replaceAll('&quot;', '"')
const recoveryReset = productionInstaller.match(/Invoke-Sc\s+@\("failure",\s*\$ServiceName,\s*"reset=",\s*"([^"]+)"/)?.[1]
const recoveryActions = productionInstaller.match(/"restart\/60000\/restart\/300000\/restart\/1800000"/)?.[0]
assert.equal(recoveryReset, '86400', 'MSI recovery reset period must match install-production-agent.ps1')
assert.equal(recoveryActions, '"restart/60000/restart/300000/restart/1800000"', 'MSI recovery actions must match install-production-agent.ps1')
assert.match(recoveryCommand, new RegExp(`reset=\\s+${recoveryReset}\\s+actions=\\s+${recoveryActions.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), 'MSI recovery command must match binding recovery policy')
const failureFlag = productionInstaller.match(/Invoke-Sc\s+@\("failureflag",\s*\$ServiceName,\s*"([01])"/)?.[1]
assert.equal(failureFlag, '1', 'binding failureflag value must remain parseable')
assert.match(failureFlagCommand, new RegExp(`failureflag\\s+aijobprintagent\\.exe\\s+${failureFlag}$`, 'i'), 'MSI failureflag command must match binding policy')
assert.match(project, /InstallerSourceRoot=\$\(MSBuildProjectDirectory\)/)
assert.match(wix, /StandardDirectory Id="CommonAppDataFolder"/)
assert.match(wix, /Name="Microsoft"[\s\S]*Name="Windows"[\s\S]*Name="Start Menu"[\s\S]*Name="Programs"/)
assert.match(wix, /Id="AgentPanelInternetShortcut"/)
assert.match(wix, /Source="\$\(var\.InstallerSourceRoot\)\\assets\\AI Job Print Terminal\.url" KeyPath="yes"/)
assert.match(wix, /RemoveFolder Id="RemoveAgentProgramMenuFolder" On="uninstall"/)
assert.match(wix, /ComponentRef Id="AgentPanelShortcutComponent"/)
assert.equal(
  panelShortcut.replace(/\r\n/g, '\n').trim(),
  '[InternetShortcut]\nURL=http://127.0.0.1:9527/local/panel',
)
assert.match(localApi, /url\.pathname === '\/local\/panel'/)
assert.ok(
  localApi.indexOf("url.pathname === '/local/panel'") < localApi.indexOf('if (!isOriginAllowed(origin, origins))'),
  'top-level panel navigation must be handled before browser Origin enforcement',
)
assert.match(statusPanel, /Cache-Control': 'no-store'/)
assert.match(statusPanel, /Content-Security-Policy/)
assert.match(statusPanel, /frame-ancestors 'none'/)
assert.doesNotMatch(statusPanel, /agentToken|terminalId|apiBaseUrl|printerName|scanWatchFolder/)

assert.match(bundleProject, /<OutputType>Bundle<\/OutputType>/)
assert.match(bundleProject, /<InstallerPlatform>x64<\/InstallerPlatform>/)
assert.match(bundleProject, /<OutputName>AIJobPrintTerminalSetup<\/OutputName>/)
assert.match(bundleProject, /WixToolset\.Bal\.wixext" Version="4\.0\.6"/)
assert.match(bundle, /Name="AI Job Print Terminal Setup"/)
assert.match(bundle, /UpgradeCode="79F2B121-7AA0-452D-A932-BDC6F501F701"/)
assert.match(bundle, /WixStandardBootstrapperApplication/)
assert.match(
  bundle,
  /LaunchTarget="\[ProgramFiles64Folder\]AIJobPrintAgent\\provision\\launch-control-center\.vbs"/,
)
assert.match(bundle, /SuppressOptionsUI="yes"/)
assert.match(bundle, /<MsiPackage[\s\S]*SourceFile="\$\(var\.MsiPath\)"[\s\S]*Compressed="yes"/)
assert.doesNotMatch(bundle, /<(?:Variable|MsiProperty|ExePackage)\b/)
assert.doesNotMatch(bundle, /(?:BindCode|AgentToken|BridgeToken|adminSecret)/i)
assert.doesNotMatch(wix, /ProvisioningWizardShortcut/)
assert.doesNotMatch(wix, /设备绑定向导/)
assert.doesNotMatch(wix, /AgentPanelDesktopInternetShortcut/)
assert.doesNotMatch(wix, /Component Id="AgentPanelDesktopShortcutComponent"/)
assert.match(wix, /Id="ControlCenterScript"/)
assert.match(wix, /Id="ControlCenterLauncher"[^>]*KeyPath="yes"/)
assert.match(wix, /Id="ControlCenterStartMenuShortcut"/)
assert.match(wix, /Id="ControlCenterDesktopShortcut"/)
assert.match(wix, /Id="ControlCenterDesktopShortcut"[\s\S]*Directory="DesktopFolder"[\s\S]*Advertise="yes"/)
assert.match(wix, /Name="终端控制中心"/)
assert.match(wix, /Name="AI 求职打印服务终端"/)
assert.match(wix, /RemoveProvisioningProgramMenuFolder[\s\S]*Directory="AgentProgramMenuFolder"/)
assert.doesNotMatch(wix, /StandardDirectory Id="ProgramMenuFolder"/)
assert.match(staging, /provision-installed-agent\.ps1/)
assert.match(staging, /terminal-control-center\.ps1/)
assert.match(staging, /launch-control-center\.vbs/)
assert.match(fs.readFileSync(path.join(root, 'generate-wix-fragment.ps1'), 'utf8'), /provision\/terminal-control-center\.ps1/)
assert.match(fs.readFileSync(path.join(root, 'generate-wix-fragment.ps1'), 'utf8'), /provision\/launch-control-center\.vbs/)

// Kiosk browser launcher + watchdog: shipped as MSI files, registered as a logon
// task by the elevated provisioning flow. The kiosk task is not an MSI CustomAction.
const kioskWatchdog = read('kiosk/kiosk-watchdog.ps1')
const kioskRegister = read('kiosk/register-kiosk-watchdog.ps1')
const kioskLauncher = read('kiosk/launch-kiosk.cmd')
const wixFragment = fs.readFileSync(path.join(root, 'generate-wix-fragment.ps1'), 'utf8')
assert.match(wix, /Directory Id="KIOSKDIR" Name="kiosk"/)
assert.match(wix, /Id="KioskWatchdogScript"[^>]*kiosk\\kiosk-watchdog\.ps1"[^>]*KeyPath="yes"/)
assert.match(wix, /Id="KioskWatchdogRegister"[^>]*kiosk\\register-kiosk-watchdog\.ps1"/)
assert.match(wix, /Id="KioskLauncher"[^>]*kiosk\\launch-kiosk\.cmd"/)
assert.match(wix, /ComponentRef Id="KioskWatchdogComponent"/)
for (const staged of ['kiosk/kiosk-watchdog.ps1', 'kiosk/register-kiosk-watchdog.ps1', 'kiosk/launch-kiosk.cmd']) {
  assert.match(wixFragment, new RegExp(staged.replace(/[./]/g, '\\$&')), `${staged} must be excluded from the auto-generated payload fragment`)
  assert.match(staging, new RegExp(staged.split('/')[1].replace(/\./g, '\\.')), `${staged} must be staged`)
}
for (const staged of [
  'provision/boot-spool-guard.ps1',
  'provision/boot-spool-guard-task.ps1',
  'provision/daily-reboot.ps1',
  'provision/daily-reboot-task.ps1',
]) {
  assert.match(wixFragment, new RegExp(staged.replace(/[./]/g, '\\$&')), `${staged} must be excluded from the auto-generated payload fragment`)
  assert.match(staging, new RegExp(staged.split('/')[1].replace(/\./g, '\\.')), `${staged} must be staged`)
  assert.match(wix, new RegExp(staged.split('/')[1].replace(/[.]/g, '\\.')), `${staged} must ship in the provision component`)
}
assert.match(staging, /\$kioskRoot = Join-Path \$stagingRoot "kiosk"/)
assert.match(stagedPowerShellVerify, /Join-Path \$StagingRoot "kiosk"/, 'staged kiosk scripts must be BOM + parse checked')
assert.match(kioskWatchdog, /"--kiosk", \$LaunchUrl/)
assert.match(kioskWatchdog, /\/local\/terminal-boot-ticket/)
assert.doesNotMatch(kioskWatchdog, /\/local\/terminal-identity/, 'watchdog readiness must use the Origin-free boot-ticket endpoint')
assert.match(kioskWatchdog, /local Agent is reachable again; restarting ticketless kiosk browser with a boot ticket/)
assert.match(kioskWatchdog, /\$selfHealBootTicket = Test-AgentIdentityReady[\s\S]*\$bootTicket = \$selfHealBootTicket[\s\S]*Get-BootTicketUrl -BootTicket \$bootTicket/, 'self-heal must reuse the readiness ticket')
assert.match(kioskWatchdog, /boot_ticket=/)
assert.match(kioskWatchdog, /\$delays = @\(2, 5, 10, 20, 20\)/)
assert.match(kioskWatchdog, /kiosk_launch=1/)
assert.match(kioskWatchdog, /-TimeoutSec 4/)
assert.match(kioskWatchdog, /return \$launchUrl/, 'boot-ticket failure must launch the kiosk fail-closed page without a ticket')
assert.doesNotMatch(kioskWatchdog, /agent\.token|agent-config\.json|BindCode|AgentToken/i)
assert.match(kioskWatchdog, /--edge-kiosk-type=fullscreen/)
assert.match(kioskWatchdog, /--no-first-run/)
assert.match(kioskWatchdog, /--user-data-dir=\$profileRoot/)
assert.match(kioskWatchdog, /\$kioskMarker = "--aijobprint-kiosk=1"/, 'watchdog must only track browsers it launched')
assert.match(kioskWatchdog, /'\^https:\/\/\[A-Za-z0-9\.-\]\+/, 'kiosk URL must be https')
assert.match(kioskRegister, /'\^https:\/\/\[A-Za-z0-9\.-\]\+/, 'registered kiosk URL must be https')
assert.match(kioskWatchdog, /while \(\$true\)[\s\S]*Start-Sleep -Seconds \$PollSeconds/)
assert.match(kioskWatchdog, /\[Math\]::Min\(60, \$backoffSeconds \* 2\)/, 'crash loop must back off')
assert.match(kioskWatchdog, /Join-Path \$env:LOCALAPPDATA "AIJobPrintKiosk"/, 'watchdog state must live in the kiosk user profile, not the ACL-protected ProgramData root')
assert.doesNotMatch(kioskWatchdog, /agent\.token|agent-config\.json|BindCode|AgentToken/i)
assert.match(kioskRegister, /\$taskName = "AIJobPrintKioskWatchdog"/)
assert.match(kioskRegister, /New-ScheduledTaskTrigger -AtLogOn/)
assert.match(kioskRegister, /New-ScheduledTaskPrincipal -GroupId "BUILTIN\\Users" -RunLevel Limited/)
assert.match(kioskRegister, /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/)
assert.match(kioskRegister, /-MultipleInstances IgnoreNew/)
assert.match(kioskRegister, /Unregister-ScheduledTask -TaskName \$taskName -Confirm:\$false/)
assert.match(kioskRegister, /Registering the kiosk watchdog requires an elevated session/)
assert.doesNotMatch(kioskRegister, /BindCode|AgentToken|BridgeToken|adminSecret/i)
assert.match(kioskLauncher, /kiosk-watchdog\.ps1" -Url "https:\/\/zyidai\.cn\/" -Once/)
assert.match(provisionWizard, /kiosk\\register-kiosk-watchdog\.ps1/)
assert.match(provisionWizard, /-Url \(\$origin \+ "\/"\)/)
assert.match(controlCenter, /kioskWatchdogRegistered = \$null -ne \(Get-ScheduledTask -TaskName \$kioskTaskName/)
assert.match(controlCenter, /\$kioskRegisterButton\.Add_Click/)
assert.match(controlCenter, /\$kioskUnregisterButton\.Add_Click/)
assert.match(controlCenter, /MessageBoxButtons\]::OKCancel/, 'unregistering the watchdog must ask for confirmation')
assert.match(read('test-msi-lifecycle.ps1'), /"kiosk\\kiosk-watchdog\.ps1"/)
assert.match(staging, /Copy-WindowsPowerShellScript/)
assert.match(staging, /UTF8Encoding\]::new\(\$true\)/)
assert.match(staging, /provisioning-origin-utils\.ps1/)
assert.match(staging, /provisioning-runtime-security\.ps1/)
assert.match(stagedPowerShellVerify, /0xEF[\s\S]*0xBB[\s\S]*0xBF/)
assert.match(stagedPowerShellVerify, /System\.Management\.Automation\.Language\.Parser\]::ParseFile/)
assert.match(stagedPowerShellVerify, /Merge-LocalApiAllowedOrigins/)
assert.doesNotMatch(stagedPowerShellVerify, /localhost:5173|127\.0\.0\.1:5173/, 'staged production origin gate must not default to development origins')
assert.match(stagedPowerShellVerify, /originMerge=executed/)
assert.match(stagedPowerShellVerify, /aclRights=positive-negative/)
assert.match(stagedPowerShellVerify, /ReadAndExecute/)
assert.match(stagedPowerShellVerify, /Modify/)
assert.match(stagedPowerShellVerify, /PropagationFlags\]::InheritOnly/)
assert.match(stagedPowerShellVerify, /Test-FileSystemAccessRuleAppliesToItem/)
assert.match(runtimeSecurity, /PropagationFlags\]::InheritOnly/)
assert.match(runtimeSecurity, /Test-FileSystemAccessRuleAppliesToItem/)
assert.match(runtimeSecurity, /Test-IsPrivilegedRuntimeSid/)
assert.match(runtimeSecurity, /S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464/)
assert.match(runtimeSecurity, /if \(-not \(Test-WriteLikeFileSystemRights \$rule\.FileSystemRights\)\)[\s\S]*continue[\s\S]*ConvertTo-SidValue \$rule\.IdentityReference/)
assert.match(stagedPowerShellVerify, /BUILTIN Users must not be treated as privileged/)
assert.match(staging, /install-production-agent\.ps1/)
assert.match(
  staging,
  /-Destination \(Join-Path \$provisionRoot "collect-field-evidence\.ps1"\)/,
  'collect-field-evidence.ps1 must be staged into provision',
)
assert.match(
  stagedPowerShellVerify,
  /foreach \(\$required in @\([^)]*collect-field-evidence\.ps1[^)]*\)\) \{\s*if \(-not \(Test-Path -LiteralPath \(Join-Path \$provisionRoot \$required\)/,
  'collect-field-evidence.ps1 must be listed in the provision required list',
)
assert.match(provisionWizard, /-PromptForBindCode/)
assert.match(provisionWizard, /-InstalledAgentRoot\s+\$agentRoot/)
assert.match(provisionWizard, /https:\/\/zyidai\.cn\/api\/v1/)
assert.match(provisionWizard, /\/local\/bridge\/session/)
assert.match(provisionWizard, /\/local\/qr-login\/create/)
assert.match(provisionWizard, /Start-Process "http:\/\/127\.0\.0\.1:9527\/local\/panel"/)
assert.doesNotMatch(provisionWizard, /Start-Process "https:\/\/zyidai\.cn\/login"/)
assert.doesNotMatch(provisionWizard, /(?:terminalToken|agentToken)\s*=/i)
assert.doesNotMatch(provisionLauncher, /(?:BindCode|AgentToken|BridgeToken|adminSecret)/i)
assert.match(controlCenter, /System\.Windows\.Forms/)
assert.match(controlCenter, /Get-Printer/)
assert.match(controlCenter, /-BindCodeFromStandardInput/)
assert.match(controlCenter, /RedirectStandardInput = \$ReplaceCredential/)
assert.match(controlCenter, /UseSystemPasswordChar = \$true/)
assert.match(controlCenter, /Restart-Service -Name \$serviceName -Force/)
assert.match(controlCenter, /Set-Service -Name \$serviceName -StartupType Automatic/)
assert.match(controlCenter, /StartType：\$\(\$snapshot\.serviceStartType\)/)
assert.match(controlCenter, /-UseExistingToken/)
assert.match(controlCenter, /\/local\/qr-login\/create/)
assert.match(controlCenter, /SmokeTest/)
assert.doesNotMatch(controlCenter, /Write-(?:Host|Output)[^\r\n]*(?:bindCodeBox|oneTimeCode)/i)
assert.doesNotMatch(controlCenterLauncher, /(?:BindCode|AgentToken|BridgeToken|adminSecret)/i)
assert.match(productionInstaller, /BindCodeFromStandardInput/)
assert.match(productionInstaller, /\[Console\]::In\.ReadLine\(\)/)
for (const buildScript of [buildMsi, buildExe]) {
  assert.match(buildScript, /\[string\]\$ProductVersion/)
  assert.match(buildScript, /three-part numeric/)
  assert.match(buildScript, /Windows Installer bounds/)
  assert.match(buildScript, /-p:ProductVersion=\$ProductVersion/)
  assert.match(buildScript, /\$resolvedOutputDirectory = \(Resolve-Path -LiteralPath \$OutputDirectory\)\.Path/)
}
assert.match(buildExe, /Expected exactly one MSI input/)
assert.match(buildExe, /AIJobPrintTerminalSetup\.exe/)
assert.match(buildExe, /unsigned CI candidate/)

assert.match(serviceXml, /<executable>%BASE%\\\.\.\\node\\node\.exe<\/executable>/)
assert.match(
  serviceXml,
  /<arguments>"%BASE%\\\.\.\\app\\dist\\index\.js" agent<\/arguments>/,
  'WinSW must quote the Agent entrypoint under Program Files',
)
assert.match(serviceXml, /delay="60 sec"/)
assert.match(serviceXml, /delay="300 sec"/)
assert.match(serviceXml, /<onfailure action="restart" delay="1800 sec" \/>/)
assert.doesNotMatch(serviceXml, /action="none"/)

assert.match(staging, /--frozen-lockfile/)
assert.match(staging, /SecurityProtocolType\]::Tls12/, 'Windows PowerShell 5.1 downloads must allow TLS 1.2')
assert.match(staging, /--config\.node-linker=hoisted/)
assert.match(
  staging,
  /--config\.allowUnusedPatches=true/,
  'isolated deploy must tolerate root patches that are unused by the Agent dependency graph',
)
assert.equal(
  staging.match(/--config\.allowUnusedPatches=true/g)?.length,
  1,
  'allowUnusedPatches must remain scoped to one deploy invocation',
)
assert.match(workspace, /overrides:/, 'workspace security overrides must remain enabled')
assert.match(
  workspace,
  /brace-expansion@2\.1\.1:\s*2\.1\.6/,
  'brace-expansion security fix must remain pinned',
)
assert.match(staging, /node-windows must not be present in the MSI runtime/)
assert.match(staging, /Unexpected executable in staging/)
assert.match(staging, /Microsoft\.VisualStudio\.Component\.VC\.Tools\.x86\.x64/)
assert.match(staging, /secure-scan-reader\.c/)
assert.match(staging, /secure-scan-path\.c/, 'native helper path boundary must compile as a separate auditable source')
assert.match(staging, /secure-scan-mutation\.c/, 'native helper mutation boundary must compile as a separate auditable source')
assert.match(staging, /\$quotedNativeSources\s*=/, 'native source arguments must be composed before the command array')
assert.match(staging, /\$compileCommand\s*=/, 'the complete cl command must remain one cmd.exe line')
assert.match(staging, /\$compileLines\s*=\s*@\([\s\S]*\$compileCommand,/, 'the command array must contain the precomposed cl command')
assert.match(staging, /\/guard:cf/)
assert.match(staging, /\/Brepro/)
assert.match(staging, /\$nativeExecutable,/)
assert.match(staging, /better-sqlite3/)
assert.match(staging, /manifest\.json/)

const lifecycle = read('test-msi-lifecycle.ps1')
const exeLifecycle = read('test-exe-lifecycle.ps1')
const upgradeLifecycle = read('test-exe-upgrade-lifecycle.ps1')
assert.match(lifecycle, /Start-Service -Name \$serviceName/)
assert.match(lifecycle, /Remove-Item -LiteralPath \$diagnosticPath -Force/)
assert.match(lifecycle, /\$startServiceError = \$null/)
assert.match(lifecycle, /catch \{\s*# An unprovisioned Agent[\s\S]*\$startServiceError = \$_\.Exception\.Message/)
assert.match(lifecycle, /AGENT_CONFIG_NOT_FOUND/)
assert.match(lifecycle, /LocalSystem service launch did not produce a startup diagnostic/)
assert.match(lifecycle, /Unprovisioned service did not return to Stopped/)
assert.match(lifecycle, /finally \{\s*Export-LifecycleEvidence -Phase "final"/)
assert.match(lifecycle, /Export-LifecycleEvidence -Phase "post-install"/)
assert.match(lifecycle, /Export-LifecycleEvidence -Phase "post-start"/)
assert.match(lifecycle, /sc\.exe" \$verb \$serviceName/)
assert.match(lifecycle, /@\("qc", "queryex"\)/)
assert.match(lifecycle, /Get-WinEvent -FilterHashtable/)
assert.match(lifecycle, /ProviderName = "Service Control Manager"/)
assert.match(lifecycle, /Copy-Item -LiteralPath \$diagnosticPath -Destination/)
assert.match(lifecycle, /bootstrap\\aijobprintagent\.exe/)
assert.match(lifecycle, /bootstrap\\aijobprintagent\.xml/)
assert.match(lifecycle, /node\\node\.exe/)
assert.match(lifecycle, /app\\dist\\index\.js/)
assert.match(lifecycle, /app\\native\\secure-scan-reader\.exe/)
assert.match(lifecycle, /provision\\provision-installed-agent\.ps1/)
assert.match(lifecycle, /terminal-control-center\.ps1/)
assert.match(lifecycle, /Assert-ControlCenterSmoke/)
assert.match(lifecycle, /CONTROL_CENTER_SMOKE_PASS|SmokeTest/)
assert.match(lifecycle, /Provisioning payload is missing after install/)
assert.match(lifecycle, /Get-FileHash -LiteralPath \$fullPath -Algorithm SHA256/)
assert.match(lifecycle, /VersionInfo\.FileVersion/)
assert.match(lifecycle, /& \$nodePath --version/)
assert.match(lifecycle, /Join-Path \$stateRoot "logs"/)
assert.match(lifecycle, /Copy-Item -LiteralPath \$item\.FullName -Destination \$copiedLogRoot -Recurse -Force/)
assert.match(lifecycle, /Assert-PanelShortcut/)
assert.match(lifecycle, /Assert-DesktopShortcut/)
assert.match(lifecycle, /desktop link is an MSI advertised shortcut/)
assert.match(lifecycle, /Terminal control center desktop shortcut remains after uninstall/)
assert.match(lifecycle, /Install-BootSpoolGuard -GuardScriptPath/)
assert.match(lifecycle, /Install-DailyRebootTask -At/)
assert.match(lifecycle, /DEMAND_START/)
assert.match(lifecycle, /Stop-Service -Name "Spooler"/)
assert.match(lifecycle, /Boot spool guard task remains after uninstall/)
assert.match(lifecycle, /Daily reboot task remains after uninstall/)
assert.match(lifecycle, /Spooler was not Automatic after uninstall/)
assert.match(lifecycle, /Spooler was not Running after uninstall/)
assert.match(lifecycle, /Restore-LifecycleSpooler/)
assert.ok(lifecycle.includes('URL=http://127\\.0\\.0\\.1:9527/local/panel'))
assert.match(lifecycle, /Start Menu shortcut remains after uninstall/)
assert.match(workflow, /artifacts\/evidence\/fresh-msi-lifecycle-logs\//)
assert.doesNotMatch(workflow, /lifecycle-logs\/\*\.log/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/install"/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/repair"/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/uninstall"/)
assert.match(exeLifecycle, /Stopped\/Manual service contract/)
assert.match(exeLifecycle, /Remove-Item -LiteralPath \$nodePath -Force/)
assert.match(exeLifecycle, /repair did not restore the managed Node runtime/)
assert.match(exeLifecycle, /finally \{[\s\S]*cleanup-uninstall\.log/)
assert.match(exeLifecycle, /ProgramData state directory must be retained/)
assert.match(upgradeLifecycle, /PREDECESSOR_VERSION = "0\.4\.10"/)
assert.match(upgradeLifecycle, /CANDIDATE_VERSION = "0\.4\.14"/)
assert.match(upgradeLifecycle, /EXE upgrade lifecycle requires an unused ProgramData root/)
assert.doesNotMatch(upgradeLifecycle, /Remove-Item -LiteralPath \$stateRoot/)
const unusedStateGuard = upgradeLifecycle.indexOf('EXE upgrade lifecycle requires an unused ProgramData root')
const fixtureOwnership = upgradeLifecycle.indexOf('$ownsFixtureState = $true')
const predecessorInstall = upgradeLifecycle.indexOf('Invoke-Bundle -ExePath $resolvedPredecessor -Action "/install"')
assert.ok(unusedStateGuard < fixtureOwnership && fixtureOwnership < predecessorInstall)
assert.match(
  upgradeLifecycle,
  /if \(\$ownsFixtureState\) \{\s*foreach \(\$fixturePath in @\(\$configPath, \$tokenPath, \$databasePath, \$scanFixturePath\)\)/,
  'fixture cleanup must be disabled when the initial ProgramData guard rejects the runner',
)
assert.match(upgradeLifecycle, /Assert-PanelShortcut/)
assert.match(upgradeLifecycle, /Assert-DesktopShortcut/)
assert.match(upgradeLifecycle, /Assert-ControlCenterSmoke -ExpectedVersion \$PREDECESSOR_VERSION/)
assert.match(upgradeLifecycle, /Assert-ControlCenterSmoke/)
// 真机审查 2026-09-28：生产安装默认只放行一体机站点；Edge 整机策略放行本机访问与麦克风、禁用系统文件框。
assert.match(productionInstaller, /AllowLocalDevelopmentOrigins/, 'development origins must be an explicit opt-in')
assert.doesNotMatch(productionInstaller, /\+ @\("http:\/\/localhost:5173", "http:\/\/127\.0\.0\.1:5173"\)/, 'production install must not append development origins by default')
for (const policy of ['LocalNetworkAccessAllowedForUrls', 'AudioCaptureAllowedUrls', 'AllowFileSelectionDialogs']) {
  assert.ok(productionInstaller.includes(policy), `Edge kiosk policy ${policy} must be provisioned`)
}
assert.match(productionInstaller, /RemoveEdgeKioskPolicies/, 'Edge kiosk policies must be removable')
// 2026-09-29：测试兼工作机（如 KSK-001）可显式不禁用文件选择框（整机策略会让那台电脑的普通 Edge 也选不了文件）；
// 默认（专用一体机）必须照旧禁用，开关分支只许删除该值并打印警告。
assert.match(productionInstaller, /\[switch\]\$KeepFileSelectionDialogs/, 'keeping file dialogs must be an explicit opt-in switch')
assert.match(productionInstaller, /-KeepFileDialogs:\$KeepFileSelectionDialogs/, 'the opt-out switch must reach Set-EdgeKioskPolicies')
assert.match(
  productionInstaller,
  /if \(\$KeepFileDialogs\) \{[\s\S]*?Remove-ItemProperty -LiteralPath \$edgePolicyPath -Name "AllowFileSelectionDialogs"[\s\S]*?Write-WarnLine "[^"\r\n]*never a dedicated kiosk"\s*\} else \{\s*New-ItemProperty -LiteralPath \$edgePolicyPath -Name "AllowFileSelectionDialogs" -Value 0 -PropertyType DWord/,
  'the default (dedicated kiosk) must still disable file selection dialogs; the opt-out only removes the value, with a warning',
)
assert.match(productionInstaller, /\$listKey = Join-Path \$edgePolicyPath \$policyName[\s\S]*-Name \(\[string\]\(\$index \+ 1\)\)/, 'Edge list policies are a subkey with numbered values, not suffixed values on the Edge key')
assert.doesNotMatch(productionInstaller, /"\$policyName" \+ \(\$index \+ 1\)/, 'suffixed values such as AudioCaptureAllowedUrls1 are ignored by Edge')
assert.match(productionInstaller, /Bound" -Value 1/, 'binding must record the upgrade marker the MSI searches for')
assert.match(upgradeLifecycle, /localApiBridgeToken = "fixture-bridge-token-not-a-real-secret"/)
assert.match(upgradeLifecycle, /WriteAllBytes\(\$tokenPath/)
assert.match(upgradeLifecycle, /SQLite format 3/)
assert.match(upgradeLifecycle, /upgrade-preservation-fixture\.pdf/)
assert.match(upgradeLifecycle, /Get-FileHash -LiteralPath \$path -Algorithm SHA256/)
assert.match(upgradeLifecycle, /Assert-StateFixture -Expected \$stateFixtureSnapshot -Phase "upgrade"/)
assert.match(upgradeLifecycle, /Assert-StateFixture -Expected \$stateFixtureSnapshot -Phase "repair"/)
assert.match(upgradeLifecycle, /Assert-StateFixture -Expected \$stateFixtureSnapshot -Phase "uninstall"/)
assert.match(upgradeLifecycle, /EXE_UPGRADE_LIFECYCLE_PASS/)
assert.match(workflow, /Verify staged secure scan reader boundary/)
assert.match(workflow, /verify-secure-scan-reader\.ps1 -InstallRoot apps\/terminal-agent\/installer\/artifacts\/staging/)
assert.match(secureScanReaderVerify, /SECURE_SCAN_READER_PASS/)
assert.match(secureScanReaderVerify, /New-Junction/)
assert.match(secureScanReaderVerify, /SymbolicLink/)
assert.match(secureScanReaderVerify, /HardLink/)
assert.match(secureScanReaderVerify, /same metadata replacement/, 'Windows dynamic verification must reject a same-size\/mtime different-file-id replacement')
assert.match(secureScanReaderVerify, /mode = "finalize-delete"/, 'Windows dynamic verification must cover handle-bound success deletion')
assert.match(secureScanReaderVerify, /mode = "finalize-quarantine"/, 'Windows dynamic verification must cover handle-relative quarantine')
assert.match(secureScanReaderVerify, /mode = "sweep"/, 'Windows dynamic verification must cover secure _unclaimed TTL mutation')
assert.match(secureScanReaderVerify, /replace\(\/\^\\uFEFF\//, 'Windows PowerShell stdin BOM must be removed before JSON parsing')
assert.match(secureScanReaderVerify, /FileAttributes\]::ReparsePoint/, 'cleanup must never treat an ordinary non-empty scan directory as a link')
assert.match(lifecycle, /Installed secure scan reader boundary verification failed/)
assert.match(workflow, /unsigned-msi-candidate:/, 'keep the existing required Windows job identity stable')
assert.match(workflow, /unsigned-exe-upgrade:/, 'run upgrade lifecycle on an isolated Windows runner')
assert.match(
  workflow,
  /unsigned-msi-candidate:\s*needs: \[unsigned-exe-upgrade, internal-signing-validation\]\s*if: \$\{\{ always\(\) \}\}/,
  'the existing required Windows job must depend on the isolated upgrade lifecycle and internal signing validation',
)
assert.match(
  workflow,
  /if \("\$\{\{ needs\.unsigned-exe-upgrade\.result \}\}" -ne "success"\) \{\s*throw "Isolated EXE upgrade lifecycle did not pass"/,
  'the existing required Windows job must fail rather than skip when the isolated upgrade job fails',
)
assert.match(
  workflow,
  /if \("\$\{\{ needs\.internal-signing-validation\.result \}\}" -ne "success"\) \{\s*throw "Internal signing validation did not pass"/,
  'the existing required Windows job must fail rather than skip when internal signing validation fails',
)
assert.match(
  workflow,
  /actions\/checkout@v4[\s\S]*?ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  'installer artifacts must record the exact PR head instead of an ephemeral pull-request merge ref',
)
assert.match(workflow, /test-exe-lifecycle\.ps1/)
assert.match(workflow, /test-exe-upgrade-lifecycle\.ps1/)
assert.match(
  workflow,
  /working-directory: apps\/terminal-agent[\s\S]*?node installer\/verify-printservice-completion\.mjs/,
)
assert.match(printServiceCompletionVerify, /require\('\.\.\/dist\/agent\/wmi\.js'\)/)
assert.match(printServiceCompletionVerify, /Pantum USB001/)
assert.match(printServiceCompletionVerify, /print_other_task_fixture\.pdf/)
assert.match(workflow, /ref: 75e0711561f74eed0e76ed956e4b1b5fcd2c54d4/)
assert.match(workflow, /verify-staged-powershell\.ps1/)
assert.match(workflow, /path: predecessor-0\.4\.10/)
assert.match(workflow, /predecessor-0\.4\.10\/apps\/terminal-agent\/installer\/build-staging\.ps1/)
assert.match(workflow, /predecessor-0\.4\.10\/apps\/terminal-agent\/installer\/artifacts\/exe/)
assert.match(workflow, /artifacts\/exe\/AIJobPrintTerminalSetup\.exe/)
assert.match(workflow, /artifacts\/evidence\/fresh-exe-lifecycle-logs\//)
assert.match(workflow, /artifacts\/evidence\/upgrade-lifecycle-logs\//)
verifyCandidateProvenance({
  workflow,
  candidateIdentity: read('candidate-identity.ps1'),
  productVersion: inputs.productVersion,
})

assert.match(windowsScanAdapter, /AJPSR002/, 'Node must require secure-reader protocol v2')
assert.match(windowsScanAdapter, /rootIdentity/, 'READ must return the pinned root identity token')
assert.match(windowsScanAdapter, /candidateIdentity/, 'READ must return the candidate file identity token')
assert.match(windowsScanAdapter, /finalizeTrustedWindowsCandidate/, 'success-delete and quarantine must cross the native mutation boundary')
assert.match(windowsScanAdapter, /sweepTrustedWindowsUnclaimed/, 'TTL deletion must cross the native mutation boundary')
assert.match(secureScanReader, /AJPSR002/, 'native helper must parse protocol v2')
assert.match(secureScanMutation, /RootDirectory\s*=\s*unclaimed/, 'quarantine rename must be relative to the pinned _unclaimed handle')
assert.match(secureScanMutation, /NtSetInformationFile/, 'relative quarantine must use the native handle-relative rename API')
assert.match(secureScanMutation, /AJPS_FILE_RENAME_INFORMATION_CLASS\s+10u/, 'native rename must remain FileRenameInformation')
assert.doesNotMatch(
  secureScanMutation,
  /SetFileInformationByHandle\s*\(\s*candidate\s*,\s*FileRenameInfo/,
  'relative quarantine must not regress to the Win32 wrapper rejected by Windows Server 2022',
)
assert.match(secureScanPath, /FILE_TRAVERSE/, 'pinned directory handles must support relative rename traversal')
assert.match(secureScanMutation, /FileDispositionInfo/, 'deletion must target an already verified handle')
assert.match(scanWatcher, /if \(process\.platform === 'win32'\) \{[\s\S]*?finalizeTrustedWindowsCandidate[\s\S]*?return\s*\}/, 'Windows finalize must return after the native boundary without Node fallback')
assert.match(scanWatcher, /if \(process\.platform === 'win32'\) \{[\s\S]*?sweepTrustedWindowsUnclaimed[\s\S]*?return\s*\}/, 'Windows sweep must return after the native boundary without Node fallback')

console.log('ALL PASS: Windows Agent installer inputs')
