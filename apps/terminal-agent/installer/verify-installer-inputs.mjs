import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const workspace = fs.readFileSync(path.join(root, '../../../pnpm-workspace.yaml'), 'utf8')
const inputs = JSON.parse(read('inputs.json'))
const agentPackage = JSON.parse(fs.readFileSync(path.join(root, '../package.json'), 'utf8'))
const agentEntrypoint = fs.readFileSync(path.join(root, '../src/index.ts'), 'utf8')
const wix = read('Agent.wxs')
const project = read('AIJobPrintAgent.wixproj')
const bundle = read('Bundle.wxs')
const bundleProject = read('AIJobPrintTerminalSetup.wixproj')
const buildExe = read('build-exe.ps1')
const staging = read('build-staging.ps1')
const serviceXml = read('bootstrap/aijobprintagent.xml')
const provisionerGui = fs.readFileSync(path.join(root, '../provisioner/provision-agent-gui.ps1'), 'utf8')
const workflow = fs.readFileSync(
  path.join(root, '../../../.github/workflows/windows-agent-installer.yml'),
  'utf8',
)

console.log('\n=== verify Windows Agent installer inputs ===')

assert.equal(inputs.schemaVersion, 1)
assert.equal(inputs.productVersion, '0.3.3')
assert.equal(agentPackage.version, inputs.productVersion)
assert.match(agentEntrypoint, /\.version\('0\.3\.3'\)/)
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
assert.match(wix, /Id="ProvisionerStartMenuShortcut"/)
assert.match(wix, /StandardDirectory Id="ProgramMenuFolder"/)
assert.match(wix, /Advertise="no"/)
assert.match(wix, /Target="\[System64Folder\]WindowsPowerShell\\v1\.0\\powershell\.exe"/)
assert.match(wix, /Arguments="-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File &quot;\[INSTALLFOLDER\]provisioner\\provision-agent-gui\.ps1&quot;"/)
assert.match(wix, /WorkingDirectory="INSTALLFOLDER"/)
assert.match(
  wix.match(/<Component Id="ProvisionerShortcutComponent"[\s\S]*?<\/Component>/)?.[0] ?? '',
  /<CreateFolder\s*\/>/,
  'Start menu shortcut component must recreate its directory after uninstall',
)
assert.match(wix, /RemoveFolder Id="RemoveAgentProgramMenuFolder" On="uninstall"/)
assert.match(wix, /ComponentRef Id="ProvisionerShortcutComponent"/)
assert.match(
  wix.match(/<Component Id="ProvisionerShortcutComponent"[\s\S]*?<\/Component>/)?.[0] ?? '',
  /RegistryValue\s+Root="HKCU"/,
  'non-advertised ProgramMenu shortcut must use an HKCU component key path for MSI ICE validation',
)
assert.doesNotMatch(
  wix.match(/<Shortcut[\s\S]*?\/>/)?.[0] ?? '',
  /(?:BindCode|AgentToken|BridgeToken|adminSecret)/i,
  'Start menu shortcut must not carry credentials',
)

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
assert.match(staging, /better-sqlite3/)
assert.match(staging, /manifest\.json/)
for (const provisionerFile of [
  'provision-agent-gui.ps1',
  'install-production-agent.ps1',
  'service-identity.ps1',
  'diagnose-production-agent.ps1',
]) {
  assert.match(staging, new RegExp(provisionerFile.replaceAll('.', '\\.')))
}
assert.doesNotMatch(staging, /provision-agent-core\.ps1/)
assert.match(provisionerGui, /param\(\[switch\]\$SelfTest\)/)
assert.match(provisionerGui, /PROVISIONER_SELF_TEST_PASS/)
assert.match(provisionerGui, /function ConvertTo-ValidatedApiBaseUrl/)
assert.match(provisionerGui, /\$uri\.Scheme -ne "https"/)
assert.match(provisionerGui, /云端 API 必须使用 HTTPS/)
assert.doesNotMatch(provisionerGui, /AGENT_PROFILE/, 'installed GUI must not promise a profile it cannot pass to LocalSystem')
assert.doesNotMatch(
  provisionerGui,
  /Start-Process[^\r\n]*(?:BindCode|AgentToken|BridgeToken|adminSecret)/i,
  'Provisioner must not pass credentials to a child process command line',
)

const lifecycle = read('test-msi-lifecycle.ps1')
const exeLifecycle = read('test-exe-lifecycle.ps1')
const exeUpgrade = read('test-exe-upgrade.ps1')
const originCollectionRegression = read('test-provisioning-origin-collection.ps1')
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
assert.match(lifecycle, /provisioner\\provision-agent-gui\.ps1/)
assert.match(lifecycle, /provisioner\\install-production-agent\.ps1/)
assert.match(lifecycle, /provisioner\\service-identity\.ps1/)
assert.match(lifecycle, /provisioner\\diagnose-production-agent\.ps1/)
assert.match(lifecycle, /AI求职打印终端配置\.lnk/)
assert.match(lifecycle, /PROVISIONER_SELF_TEST_PASS/)
assert.match(lifecycle, /Remove-Item -LiteralPath \$provisionerGuiPath -Force/)
assert.match(lifecycle, /Remove-Item -LiteralPath \$shortcutPath -Force/)
assert.match(
  lifecycle,
  /Invoke-Msi -Arguments @\("\/fcmuse", \$resolvedMsi\)/,
  'MSI repair must restore files, registry entries, and Start menu shortcuts',
)
assert.match(lifecycle, /Provisioner Start menu shortcut still exists after MSI uninstall/)
assert.match(lifecycle, /Get-FileHash -LiteralPath \$fullPath -Algorithm SHA256/)
assert.match(lifecycle, /VersionInfo\.FileVersion/)
assert.match(lifecycle, /& \$nodePath --version/)
assert.match(lifecycle, /Join-Path \$stateRoot "logs"/)
assert.match(lifecycle, /Copy-Item -LiteralPath \$item\.FullName -Destination \$copiedLogRoot -Recurse -Force/)
assert.match(workflow, /artifacts\/msi\/lifecycle-logs\//)
assert.doesNotMatch(workflow, /lifecycle-logs\/\*\.log/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/install"/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/repair"/)
assert.match(exeLifecycle, /Invoke-Bundle -Action "\/uninstall"/)
assert.match(exeLifecycle, /Stopped\/Manual service contract/)
assert.match(exeLifecycle, /Remove-Item -LiteralPath \$nodePath -Force/)
assert.match(exeLifecycle, /repair did not restore the managed Node runtime/)
assert.match(exeLifecycle, /Join-Path \$installRoot "provisioner"/)
assert.match(exeLifecycle, /Join-Path \$provisionerRoot "provision-agent-gui\.ps1"/)
assert.match(exeLifecycle, /AI求职打印终端配置\.lnk/)
assert.match(exeLifecycle, /PROVISIONER_SELF_TEST_PASS/)
assert.match(exeLifecycle, /Remove-Item -LiteralPath \$provisionerGuiPath -Force/)
assert.match(exeLifecycle, /Remove-Item -LiteralPath \$shortcutPath -Force/)
assert.match(exeLifecycle, /Provisioner Start menu shortcut still exists after EXE uninstall/)
assert.doesNotMatch(exeLifecycle, /GetFullPath\(\$shortcut\./)
assert.match(exeLifecycle, /finally \{[\s\S]*cleanup-uninstall\.log/)
assert.match(exeLifecycle, /ProgramData state directory must be retained/)
assert.match(exeUpgrade, /EXE_UPGRADE_PASS from=0\.3\.2 to=0\.3\.3/)
assert.match(exeUpgrade, /An unprovisioned upgrade must remain Stopped\/Manual until the GUI succeeds/)
assert.match(exeUpgrade, /ProgramData state was not retained across the 0\.3\.2 to 0\.3\.3 upgrade/)
assert.match(exeUpgrade, /Remove-ItemProperty[^\r\n]+StateDirectoryCreated/)
assert.match(workflow, /Build unsigned WiX Burn EXE/)
assert.match(workflow, /unsigned-msi-candidate:/, 'keep the existing required Windows job identity stable')
assert.match(workflow, /test-exe-lifecycle\.ps1/)
assert.match(workflow, /0aa8dbca77614396965ebb2bb4993ebeb128ab6a/)
assert.match(workflow, /test-exe-upgrade\.ps1/)
assert.ok(
  workflow.indexOf('test-exe-lifecycle.ps1') < workflow.indexOf('test-msi-lifecycle.ps1'),
  'EXE lifecycle must run first on a clean ProgramData root',
)
assert.match(workflow, /artifacts\/exe\/AIJobPrintTerminalSetup\.exe/)
assert.match(workflow, /artifacts\/exe\/lifecycle-logs\//)
assert.match(workflow, /Validate staged Provisioner PowerShell/)
assert.match(workflow, /System\.Management\.Automation\.Language\.Parser/)
assert.match(workflow, /test-provisioning-origin-collection\.ps1/)
assert.match(originCollectionRegression, /\[string\[\]\]\$LocalApiAllowedOrigins/)
assert.match(originCollectionRegression, /\$effectiveLocalApiAllowedOrigins\.Add\(\$origin\)/)
assert.match(originCollectionRegression, /PROVISIONING_ORIGIN_COLLECTION_PASS/)

console.log('ALL PASS: Windows Agent installer inputs')
