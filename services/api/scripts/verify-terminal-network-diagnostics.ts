import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  adminPaperStatus,
  describePrinterFault,
  normalizeDiskFreeGb,
  toAdminPrinterStatus,
} from '../src/terminals/admin-printer-status'

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
  assert.match(model, /scanInputHealth\s+String\?/)
  assert.match(model, /scanInputAction\s+String\?/)
  assert.match(model, /scanInputReason\s+String\?/)
  assert.match(model, /scanInputObservedAt\s+DateTime\?/)
}
assert.match(dto, /WIRED_NETWORK_STATUSES = \['connected', 'disconnected', 'unknown'\]/)
assert.match(dto, /PRINTER_NETWORK_STATUSES = \['reachable', 'unreachable', 'not_network_printer', 'unknown'\]/)
assert.match(dto, /@IsIn\(WIRED_NETWORK_STATUSES\)/)
assert.match(dto, /@IsIn\(PRINTER_NETWORK_STATUSES\)/)
assert.match(dto, /SCAN_INPUT_HEALTHS = \['healthy', 'locked_out', 'unknown'\]/)
assert.match(dto, /SCAN_INPUT_ACTIONS = \['none', 'restart_required'\]/)
assert.match(dto, /@IsIn\(SCAN_INPUT_HEALTHS\)/)
assert.match(dto, /@IsIn\(SCAN_INPUT_ACTIONS\)/)
assert.match(dto, /@IsIn\(SCAN_INPUT_REASONS\)/)
assert.match(dto, /@IsDateString\(\{ strict: true \}\)/)
assert.match(agentService, /wiredNetworkStatus: dto\.wiredNetworkStatus \?\? null/)
assert.match(agentService, /printerNetworkStatus: dto\.printerNetworkStatus \?\? null/)
assert.match(agentService, /scanInputHealth: dto\.scanInputHealth \?\? null/)
assert.match(agentService, /scanInputAction: dto\.scanInputAction \?\? null/)
assert.match(agentService, /scanInputReason: dto\.scanInputReason \?\? null/)
assert.match(agentService, /scanInputObservedAt: dto\.scanInputObservedAt \? new Date\(dto\.scanInputObservedAt\) : null/)
assert.match(adminService, /wiredNetworkStatus: true/)
assert.match(adminService, /printerNetworkStatus: true/)
assert.match(adminService, /wiredNetworkStatus: hb\?\.wiredNetworkStatus \?\? null/)
assert.match(adminService, /printerNetworkStatus: hb\?\.printerNetworkStatus \?\? null/)
assert.match(adminService, /scanInputHealth: hb\?\.scanInputHealth \?\? null/)
assert.match(adminService, /scanInputAction: hb\?\.scanInputAction \?\? null/)
assert.match(adminService, /scanInputReason: hb\?\.scanInputReason \?\? null/)
assert.match(adminService, /scanInputObservedAt: hb\?\.scanInputObservedAt\?\.toISOString\(\) \?\? null/)
assert.match(heartbeatRetention, /DEFAULT_TERMINAL_HEARTBEAT_RETENTION_DAYS = 90/)
assert.match(heartbeatRetention, /TERMINAL_HEARTBEAT_RETENTION_DAYS/)
assert.match(heartbeatRetention, /terminalHeartbeat\.deleteMany\(\{ where: \{ createdAt: \{ lt: cutoff \} \} \}\)/)
assert.match(heartbeatRetention, /CronExpression\.EVERY_DAY_AT_3AM/)
assert.match(terminalsModule, /TerminalHeartbeatRetentionTask/)

for (const forbidden of ['ssid', 'password', 'gateway', 'printerHostAddress', 'agentToken', 'bindCode']) {
  assert.equal(dto.toLowerCase().includes(forbidden.toLowerCase()), false, `DTO must not contain ${forbidden}`)
  assert.equal(agentService.slice(agentService.indexOf('async heartbeat'), agentService.indexOf('// ── 3. Claim tasks')).toLowerCase().includes(forbidden.toLowerCase()), false, `heartbeat persistence must not contain ${forbidden}`)
}

// ── 心跳 → 管理员终端 / 打印机视图：打印机状态词表与磁盘 ─────────────────────
// Agent 真实上报 ready / offline / error / low_paper / unknown（apps/terminal-agent/src/agent/types.ts）。
// 正常必须不出故障说明（页面据此不标红）；纸张不足是可打印的提醒，不算故障；
// 未上报与驱动返回 unknown 分开说；认不出的原值不得被当成正常吞掉。
for (const healthy of ['ready', 'ok', 'idle']) {
  assert.equal(toAdminPrinterStatus(true, healthy), 'online', `${healthy} must be online`)
  assert.equal(describePrinterFault(true, healthy), null, `${healthy} must not carry a fault`)
}
assert.equal(toAdminPrinterStatus(true, 'low_paper'), 'online')
assert.equal(describePrinterFault(true, 'low_paper'), '纸张不足，可打印、需补纸')
assert.equal(adminPaperStatus('low_paper'), 'low')
assert.equal(adminPaperStatus('paper_empty'), 'empty')
assert.equal(adminPaperStatus('ready'), null)
assert.equal(toAdminPrinterStatus(true, 'error'), 'error')
assert.equal(describePrinterFault(true, 'error'), '打印机故障，需人工处理')
assert.equal(describePrinterFault(true, 'offline'), '打印机离线')
assert.equal(toAdminPrinterStatus(true, 'unknown'), 'offline')
assert.equal(describePrinterFault(true, 'unknown'), '打印机状态未知，驱动未返回可用状态')
assert.equal(describePrinterFault(true, null), '打印机状态未上报')
assert.equal(toAdminPrinterStatus(true, 'toner_low'), 'error')
assert.notEqual(describePrinterFault(true, 'toner_low'), null, 'an unrecognised status must never read as healthy')
assert.equal(toAdminPrinterStatus(false, 'ready'), 'offline')
assert.equal(describePrinterFault(false, 'ready'), '终端离线，打印机状态未知')
assert.equal(normalizeDiskFreeGb(-1), null, 'Agent reports -1 when the disk query fails')
assert.equal(normalizeDiskFreeGb(Number.NaN), null)
assert.equal(normalizeDiskFreeGb(null), null)
assert.equal(normalizeDiskFreeGb(0), 0)
assert.equal(normalizeDiskFreeGb(182.4), 182.4)
assert.match(adminService, /diskFreeGb: normalizeDiskFreeGb\(hb\?\.diskFreeGb\)/)
assert.match(adminService, /paperStatus: adminPaperStatus\(printerStatus\)/)
assert.match(adminService, /fault: describePrinterFault\(online, printerStatus\)/)
assert.doesNotMatch(adminService, /function describePrinterFault|function toAdminPrinterStatus/, 'one printer vocabulary, not a second copy in the service')

console.log('ALL PASS: printer status vocabulary (ready / low_paper / unknown) and negative disk readings map to honest admin views')
console.log('ALL PASS: network diagnostics are dual-schema, enum-only heartbeat fields with no credential or identifier persistence; heartbeat retention is registered and deletes records older than the configured period')
