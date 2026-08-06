import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const workspace = fs.readFileSync(path.join(root, '../../../pnpm-workspace.yaml'), 'utf8')
const inputs = JSON.parse(read('inputs.json'))
const wix = read('Agent.wxs')
const project = read('AIJobPrintAgent.wixproj')
const staging = read('build-staging.ps1')
const serviceXml = read('bootstrap/aijobprintagent.xml')
const workflow = fs.readFileSync(
  path.join(root, '../../../.github/workflows/windows-agent-installer.yml'),
  'utf8',
)

console.log('\n=== verify Windows Agent installer inputs ===')

assert.equal(inputs.schemaVersion, 1)
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

const lifecycle = read('test-msi-lifecycle.ps1')
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
assert.match(lifecycle, /Get-FileHash -LiteralPath \$fullPath -Algorithm SHA256/)
assert.match(lifecycle, /VersionInfo\.FileVersion/)
assert.match(lifecycle, /& \$nodePath --version/)
assert.match(lifecycle, /Join-Path \$stateRoot "logs"/)
assert.match(lifecycle, /Copy-Item -LiteralPath \$item\.FullName -Destination \$copiedLogRoot -Recurse -Force/)
assert.match(workflow, /artifacts\/msi\/lifecycle-logs\//)
assert.doesNotMatch(workflow, /lifecycle-logs\/\*\.log/)

console.log('ALL PASS: Windows Agent installer inputs')
