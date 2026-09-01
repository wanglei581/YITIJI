import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(here, '..')
const read = (relative) => fs.readFileSync(path.join(apiRoot, relative), 'utf8')

const service = read('src/terminals/release-observation.service.ts')
const controller = read('src/terminals/terminals.controller.ts')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260901090000_add_agent_release_observation/migration.sql')
const postgresSchema = read('prisma/postgres/schema.prisma')
const postgresMigration = read('prisma/postgres/migrations/20260901090000_add_agent_release_observation/migration.sql')

for (const required of [
  'AgentReleaseArtifact',
  'AgentReleasePlan',
  'AgentReleaseTarget',
  'ActiveReleaseObservationAssignment',
  'TerminalReleaseObservation',
]) {
  assert.match(schema, new RegExp(`model ${required}\\b`))
  assert.match(migration, new RegExp(`CREATE TABLE \\\"${required}\\\"`))
  assert.match(postgresSchema, new RegExp(`model ${required}\\b`))
  assert.match(postgresMigration, new RegExp(`CREATE TABLE \\\"${required}\\\"`))
}

for (const forbidden of ['downloadUrl', 'installCommand', 'msiexec', 'Start-Process', 'scheduledTask', 'remoteShell']) {
  assert.equal(schema.includes(forbidden), false, `schema must not expose ${forbidden}`)
  assert.equal(service.includes(forbidden), false, `service must not expose ${forbidden}`)
}

assert.match(controller, /release-observation-plan/)
assert.match(controller, /release-observation/)
assert.match(service, /validateTerminalToken\(terminalId, authHeader/)
assert.match(service, /terminal: \{ is: \{ enabled: true, lifecycleStatus: 'active' \} \}/)
assert.match(service, /writeRequired\(tx/)
assert.match(service, /version: dto\.expectedVersion/)
assert.match(service, /signerCertificateThumbprint/)
assert.match(service, /AUTHENTICODE_THUMBPRINT = \/\^\[A-F0-9\]\{40\}\$\//)
assert.equal(schema.includes('expectedAgentVersion'), false)
assert.equal(migration.includes('expectedAgentVersion'), false)
assert.equal(schema.includes('signerFingerprint'), false)
assert.equal(migration.includes('signerFingerprint'), false)
assert.match(service, /runtimeVersion/)
assert.match(service, /identity\.targetPlatform !== 'windows-x64'/)
assert.match(service, /MAX_FUTURE_OBSERVATION_MS = 60_000/)
assert.match(service, /activeReleaseObservationAssignment\.createMany/)
assert.match(service, /activeReleaseObservationAssignment\.findUnique/)
assert.match(schema, /model ActiveReleaseObservationAssignment[\s\S]*terminalId String @id/)
assert.match(schema, /model ActiveReleaseObservationAssignment[\s\S]*targetId\s+String @unique/)
assert.match(service, /dto\.action === 'activate'[\s\S]*tx\.terminal\.findMany\([\s\S]*lifecycleStatus: true[\s\S]*RELEASE_TARGET_INELIGIBLE/)
assert.match(service, /return this\.prisma\.\$transaction\(async \(tx\) => \{\n      \/\/ Re-check eligibility/)
assert.match(service, /existing && existing\.observedAt > observedAt/)
assert.match(service, /code === 'P2034'/)
console.log('RELEASE_OBSERVATION_CONTRACT_PASS')
