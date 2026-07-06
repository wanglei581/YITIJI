import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}
const pass = (message) => console.log(`PASS ${message}`)

const index = read('src/index.ts')
const guard = read('src/agent/profile-guard.ts')

console.log('\n=== verify terminal-agent profile guard ===')

if (
  index.includes("import { assertAgentProfileAllowsApiBaseUrl } from './agent/profile-guard'") &&
  index.includes('assertAgentProfileAllowsApiBaseUrl(config)') &&
  index.includes('process.exit(1)')
) {
  pass('agent entrypoint calls profile guard after config load and fails closed')
} else {
  fail('src/index.ts must call assertAgentProfileAllowsApiBaseUrl(config) before registration/claim loops')
}

if (
  guard.includes('AGENT_PROFILE') &&
  guard.includes('local-debug') &&
  guard.includes('production Agent cannot point to localhost')
) {
  pass('profile guard requires AGENT_PROFILE=local-debug for local API')
} else {
  fail('profile guard must require AGENT_PROFILE=local-debug for localhost API base URLs')
}

for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']) {
  if (guard.includes(host)) pass(`profile guard treats ${host} as local API`)
  else fail(`profile guard must treat ${host} as local API`)
}

if (
  guard.includes('Set AGENT_PROFILE=${LOCAL_DEBUG_PROFILE}') &&
  guard.includes('install-production-agent.ps1')
) {
  pass('profile guard error message points operators to local-debug or production installer')
} else {
  fail('profile guard error message must be operator-actionable')
}

if (process.exitCode) {
  console.error('\nAgent profile guard verification failed.')
  process.exit(process.exitCode)
}

console.log('ALL PASS: terminal-agent profile guard')
