import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '../src/agent/release-observation.ts'), 'utf8')

for (const forbidden of [
  'child_process',
  'powershell',
  'msiexec',
  'start-process',
  'scheduledtask',
  'node-windows',
  'download',
  'writeFile',
  'mkdir',
]) {
  assert.equal(source.toLowerCase().includes(forbidden), false, `release observation must not contain ${forbidden}`)
}

assert.match(source, /release-observation-plan/)
assert.match(source, /release-observation/)
assert.match(source, /manifest\.json/)
assert.match(source, /productVersion/)
assert.match(source, /runtimeVersion/)
assert.equal(source.includes('config.agentVersion'), false, 'release observation must not trust persisted config agentVersion')
for (const artifactIdentityField of ['packageSha256', 'runtimeManifestSha256', 'signerTrustLevel', 'signerCertificateThumbprint']) {
  assert.equal(source.includes(artifactIdentityField), false, `Agent must not receive unverified ${artifactIdentityField}`)
}
console.log('RELEASE_OBSERVATION_BOUNDARY_PASS')
