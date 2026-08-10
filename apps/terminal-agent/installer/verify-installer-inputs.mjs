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
const serviceXml = read('bootstrap/aijobprintagent.xml')
const agentCli = fs.readFileSync(path.join(root, '../src/index.ts'), 'utf8')
const runtimeVersion = fs.readFileSync(path.join(root, '../src/runtime-version.ts'), 'utf8')
const heartbeat = fs.readFileSync(path.join(root, '../src/agent/heartbeat.ts'), 'utf8')
const localApi = fs.readFileSync(path.join(root, '../src/local-api/qr-login-server.ts'), 'utf8')
const statusPanel = fs.readFileSync(path.join(root, '../src/local-api/status-panel.ts'), 'utf8')
const agentConfigExample = JSON.parse(
  fs.readFileSync(path.join(root, '../agent-config.example.json'), 'utf8'),
)
const productionInstaller = fs.readFileSync(
  path.join(root, '../scripts/install-production-agent.ps1'),
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
assert.equal(inputs.productVersion, '0.4.0')
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
assert.match(wix, /Id="AgentPanelShortcut"/)
assert.match(wix, /Target="\[SystemFolder\]rundll32\.exe"/)
assert.match(wix, /Arguments="url\.dll,FileProtocolHandler http:\/\/127\.0\.0\.1:9527\/local\/panel"/)
assert.match(wix, /RemoveFolder Id="RemoveAgentProgramMenuFolder" On="uninstall"/)
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
assert.match(bundle, /SuppressOptionsUI="yes"/)
assert.match(bundle, /<MsiPackage[\s\S]*SourceFile="\$\(var\.MsiPath\)"[\s\S]*Compressed="yes"/)
assert.doesNotMatch(bundle, /<(?:Variable|MsiProperty|ExePackage)\b/)
assert.doesNotMatch(bundle, /(?:BindCode|AgentToken|BridgeToken|adminSecret)/i)
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
assert.match(lifecycle, /Get-FileHash -LiteralPath \$fullPath -Algorithm SHA256/)
assert.match(lifecycle, /VersionInfo\.FileVersion/)
assert.match(lifecycle, /& \$nodePath --version/)
assert.match(lifecycle, /Join-Path \$stateRoot "logs"/)
assert.match(lifecycle, /Copy-Item -LiteralPath \$item\.FullName -Destination \$copiedLogRoot -Recurse -Force/)
assert.match(lifecycle, /Assert-PanelShortcut/)
assert.match(lifecycle, /http:\/\/127\.0\.0\.1:9527\/local\/panel/)
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
assert.match(upgradeLifecycle, /PREDECESSOR_VERSION = "0\.3\.9"/)
assert.match(upgradeLifecycle, /CANDIDATE_VERSION = "0\.4\.0"/)
assert.match(upgradeLifecycle, /Assert-PanelShortcut/)
assert.match(upgradeLifecycle, /0\.3\.9 no-panel-shortcut predecessor fixture/)
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
assert.match(workflow, /-ProductVersion 0\.3\.9/)
assert.match(workflow, /artifacts\/upgrade\/predecessor\/exe/)
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
