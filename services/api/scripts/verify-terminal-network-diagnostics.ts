import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const schema = read('prisma/schema.prisma')
const postgresSchema = read('prisma/postgres/schema.prisma')
const dto = read('src/terminals/dto/heartbeat.dto.ts')
const agentService = read('src/terminals/terminals-agent.service.ts')
const adminService = read('src/terminals/terminals-admin.service.ts')
const heartbeatRetention = read('src/terminals/terminal-heartbeat-retention.task.ts')
const terminalsModule = read('src/terminals/terminals.module.ts')

for (const source of [schema, postgresSchema]) {
  const model = source.slice(source.indexOf('model TerminalHeartbeat'), source.indexOf('// ── PrintTaskStatusLog'))
  assert.match(model, /wiredNetworkStatus\s+String\?/)
  assert.match(model, /printerNetworkStatus\s+String\?/)
}
assert.match(dto, /WIRED_NETWORK_STATUSES = \['connected', 'disconnected', 'unknown'\]/)
assert.match(dto, /PRINTER_NETWORK_STATUSES = \['reachable', 'unreachable', 'not_network_printer', 'unknown'\]/)
assert.match(dto, /@IsIn\(WIRED_NETWORK_STATUSES\)/)
assert.match(dto, /@IsIn\(PRINTER_NETWORK_STATUSES\)/)
assert.match(agentService, /wiredNetworkStatus: dto\.wiredNetworkStatus \?\? null/)
assert.match(agentService, /printerNetworkStatus: dto\.printerNetworkStatus \?\? null/)
assert.match(adminService, /wiredNetworkStatus: true/)
assert.match(adminService, /printerNetworkStatus: true/)
assert.match(adminService, /wiredNetworkStatus: hb\?\.wiredNetworkStatus \?\? null/)
assert.match(adminService, /printerNetworkStatus: hb\?\.printerNetworkStatus \?\? null/)
assert.match(heartbeatRetention, /DEFAULT_TERMINAL_HEARTBEAT_RETENTION_DAYS = 90/)
assert.match(heartbeatRetention, /TERMINAL_HEARTBEAT_RETENTION_DAYS/)
assert.match(heartbeatRetention, /terminalHeartbeat\.deleteMany\(\{ where: \{ createdAt: \{ lt: cutoff \} \} \}\)/)
assert.match(heartbeatRetention, /CronExpression\.EVERY_DAY_AT_3AM/)
assert.match(terminalsModule, /TerminalHeartbeatRetentionTask/)

for (const forbidden of ['ssid', 'password', 'gateway', 'printerHostAddress', 'agentToken', 'bindCode']) {
  assert.equal(dto.toLowerCase().includes(forbidden.toLowerCase()), false, `DTO must not contain ${forbidden}`)
  assert.equal(agentService.slice(agentService.indexOf('async heartbeat'), agentService.indexOf('// ── 3. Claim tasks')).toLowerCase().includes(forbidden.toLowerCase()), false, `heartbeat persistence must not contain ${forbidden}`)
}
console.log('ALL PASS: network diagnostics are dual-schema, enum-only heartbeat fields with no credential or identifier persistence; heartbeat retention is registered and deletes records older than the configured period')
