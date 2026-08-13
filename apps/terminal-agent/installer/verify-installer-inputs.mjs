import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
assert.equal(inputs.productVersion, '0.4.10')
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
assert.match(wix, /Account="LocalSystem"/)
assert.match(wix, /Permanent="yes"/)
assert.match(wix, /NeverOverwrite="yes"/)
assert.doesNotMatch(wix, /CustomAction/i, 'MSI must not shell out to node-windows or provisioning code')
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
assert.match(staging, /Copy-WindowsPowerShellScript/)
assert.match(staging, /UTF8Encoding\]::new\(\$true\)/)
assert.match(staging, /provisioning-origin-utils\.ps1/)
assert.match(staging, /provisioning-runtime-security\.ps1/)
assert.match(stagedPowerShellVerify, /0xEF[\s\S]*0xBB[\s\S]*0xBF/)
assert.match(stagedPowerShellVerify, /System\.Management\.Automation\.Language\.Parser\]::ParseFile/)
assert.match(stagedPowerShellVerify, /Merge-LocalApiAllowedOrigins/)
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
  /brace-expansion@2\.1\.1:\s*2\.1\.4/,
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
assert.ok(lifecycle.includes('URL=http://127\\.0\\.0\\.1:9527/local/panel'))
assert.match(lifecycle, /Start Menu shortcut remains after uninstall/)
assert.match(workflow, /artifacts\/msi\/lifecycle-logs\//)
assert.doesNotMatch(workflow, /lifecycle-logs\/\*\.log/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/install"/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/repair"/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/uninstall"/)
assert.match(exeLifecycle, /Stopped\/Manual service contract/)
assert.match(exeLifecycle, /Remove-Item -LiteralPath \$nodePath -Force/)
assert.match(exeLifecycle, /repair did not restore the managed Node runtime/)
assert.match(exeLifecycle, /finally \{[\s\S]*cleanup-uninstall\.log/)
assert.match(exeLifecycle, /ProgramData state directory must be retained/)
assert.match(upgradeLifecycle, /PREDECESSOR_VERSION = "0\.4\.9"/)
assert.match(upgradeLifecycle, /CANDIDATE_VERSION = "0\.4\.10"/)
assert.match(upgradeLifecycle, /Assert-PanelShortcut/)
assert.match(upgradeLifecycle, /Assert-DesktopShortcut/)
assert.match(upgradeLifecycle, /Assert-ControlCenterSmoke -ExpectedVersion \$PREDECESSOR_VERSION/)
assert.match(upgradeLifecycle, /Assert-ControlCenterSmoke/)
assert.match(upgradeLifecycle, /ProgramData sentinel was not preserved through upgrade/)
assert.match(upgradeLifecycle, /EXE_UPGRADE_LIFECYCLE_PASS/)
assert.match(workflow, /Build unsigned WiX Burn EXE/)
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
assert.match(workflow, /ref: bd92cd589e637c25e594919bff0c7f8fb9e919eb/)
assert.match(workflow, /verify-staged-powershell\.ps1/)
assert.match(workflow, /path: predecessor-0\.4\.9/)
assert.match(workflow, /predecessor-0\.4\.9\/apps\/terminal-agent\/installer\/build-staging\.ps1/)
assert.match(workflow, /predecessor-0\.4\.9\/apps\/terminal-agent\/installer\/artifacts\/exe/)
assert.ok(
  workflow.indexOf('test-exe-lifecycle.ps1') < workflow.indexOf('test-msi-lifecycle.ps1'),
  'EXE lifecycle must run first on a clean ProgramData root',
)
assert.match(workflow, /artifacts\/exe\/AIJobPrintTerminalSetup\.exe/)
assert.match(workflow, /artifacts\/exe\/lifecycle-logs\//)

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
