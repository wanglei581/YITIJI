const assert = require('node:assert/strict')
const { AdminAlertPushService } = require('../src/admin-ops/admin-alert-push.service')
const { RedisService } = require('../src/common/redis/redis.service')
const { collectDerivedAlerts, ONLINE_WINDOW_MS } = require('../src/admin-ops/derived-alerts')
const alert = { id: 'a', subjectKey: 'terminal_offline:t1', subjectId: 't1', episodeToken: 'ep1', type: 'terminal_offline', severity: 'error', title: '终端 K-01 离线', detail: 'SENTINEL_DETAIL', terminalCode: 'K-01', occurredAt: new Date().toISOString() }
class MemRedis {
  constructor() { this.values = new Map(); this.keys = new Set() }
  async get(key) { return this.values.get(key) ?? null }
  async set(key, value, ...args) { if (args.includes('NX') && this.keys.has(key)) return null; this.values.set(key, value); if (args.includes('NX')) this.keys.add(key); return 'OK' }
  async setEx(key, _ttl, value) { this.values.set(key, value) }
  async setIfAbsent(key, value) { if (this.keys.has(key)) return false; this.keys.add(key); this.values.set(key, value); return true }
  async del(key) { this.keys.delete(key); this.values.delete(key) }
}
function make(webhook, state, calls = [], fail = false) {
  if (webhook) process.env.ALERT_WEBHOOK_URL = webhook; else delete process.env.ALERT_WEBHOOK_URL
  const fetchImpl = async (_url, init) => { calls.push(init); if (fail) throw new Error('network'); return { ok: true, status: 200 } }
  return new AdminAlertPushService(null, new RedisService(new MemRedis()), async () => ({ ...state }), fetchImpl)
}
// 只替换数据库 I/O，范围判定、扫描仪派生、聚合及推送均走实际实现。
function scanFixture() {
  const terminal = { id: 'scan-t1', terminalCode: 'SCAN-01', enabled: true, lifecycleStatus: 'active', registeredAt: new Date(0),
    heartbeats: [{ createdAt: new Date(), printerStatus: 'ready', scanDeviceHealth: 'error' }] }
  const capability = { terminalId: terminal.id, capabilityKey: 'scan_device', status: 'available' }
  const state = { terminal, capability, deleted: false }
  const prisma = {
    terminal: { findMany: async ({ where }) => {
      if (state.deleted || (where.enabled !== undefined && terminal.enabled !== where.enabled)
        || (where.lifecycleStatus && terminal.lifecycleStatus !== where.lifecycleStatus)
        || (where.id?.in && !where.id.in.includes(terminal.id))) return []
      return [terminal]
    } },
    terminalCapability: { findMany: async ({ where }) => capability.capabilityKey === where.capabilityKey && capability.status === where.status ? [capability] : [] },
    terminalHeartbeat: { groupBy: async () => [] },
    printTask: { findMany: async () => [], count: async () => 0 },
    feedbackTicket: { count: async () => 0, findFirst: async () => null },
    aiUsageRecord: { findMany: async () => [], groupBy: async () => [], count: async () => 0 },
  }
  const calls = []
  const service = make('https://example.invalid', {}, calls)
  service.collectAlerts = (_db, now) => collectDerivedAlerts(prisma, now)
  const messages = () => calls.map((call) => JSON.parse(String(call.body)).text.content).filter((content) => content.includes('扫描仪'))
  return { state, prisma, service, messages }
}
;(async () => {
const noCalls = []; await make(undefined, { alerts: [alert] }, noCalls).pushDerivedAlerts(); assert.equal(noCalls.length, 0)
const state = { alerts: [alert] }; const calls = []; const service = make('https://example.invalid', state, calls)
await service.pushDerivedAlerts(); await service.pushDerivedAlerts(); assert.equal(calls.length, 1)
const firing = JSON.parse(String(calls[0].body)); assert.match(firing.text.content, /终端 K-01 离线/); assert.doesNotMatch(firing.text.content, /SENTINEL_DETAIL/)
state.alerts = []; await service.pushDerivedAlerts(); assert.equal(calls.length, 2); assert.match(JSON.parse(String(calls[1].body)).text.content, /已恢复/)
await service.pushDerivedAlerts(); assert.equal(calls.length, 2)
const retryCalls = []; const retry = make('https://example.invalid', { alerts: [alert] }, retryCalls, true)
await retry.pushDerivedAlerts(); await retry.pushDerivedAlerts(); assert.equal(retryCalls.length, 2)
// 终端被转成计划中 / 退役 / 停用后从告警里消失：不推「已恢复」；仍在考察范围内的真恢复照推。
{
  const scopeState = { alerts: [alert], terminalSubjectKeysInScope: ['terminal_offline:t1', 'printer_issue:t1'] }
  const scopeCalls = []
  const scoped = make('https://example.invalid', scopeState, scopeCalls)
  scoped.collectAlerts = async () => ({ alerts: scopeState.alerts, terminalSubjectKeysInScope: scopeState.terminalSubjectKeysInScope })
  await scoped.pushDerivedAlerts(); assert.equal(scopeCalls.length, 1)
  scopeState.alerts = []; scopeState.terminalSubjectKeysInScope = []
  await scoped.pushDerivedAlerts(); assert.equal(scopeCalls.length, 1, '被筛掉的终端不得推「已恢复」')
  const backCalls = []
  const back = make('https://example.invalid', { alerts: [{ ...alert, episodeToken: 'ep2' }] }, backCalls)
  const backState = { alerts: [{ ...alert, episodeToken: 'ep2' }], terminalSubjectKeysInScope: ['terminal_offline:t1'] }
  back.collectAlerts = async () => ({ alerts: backState.alerts, terminalSubjectKeysInScope: backState.terminalSubjectKeysInScope })
  await back.pushDerivedAlerts(); backState.alerts = []
  await back.pushDerivedAlerts(); assert.equal(backCalls.length, 2, '仍在范围内的终端回到在线要推「已恢复」')
  assert.match(JSON.parse(String(backCalls[1].body)).text.content, /已恢复/)
}

// 原有两类移出再纳入同一回合仍被去重；钉住现状，扫描仪修复不得改变它们。
for (const type of ['terminal_offline', 'printer_issue']) {
  const item = { ...alert, type, subjectKey: `${type}:t1` }
  const state = { alerts: [item], terminalSubjectKeysInScope: [item.subjectKey] }
  const calls = []; const service = make('https://example.invalid', state, calls)
  await service.pushDerivedAlerts()
  state.alerts = []; state.terminalSubjectKeysInScope = []
  await service.pushDerivedAlerts()
  assert.equal(calls.length, 1, `${type} 移出范围不能推恢复`)
  state.alerts = [item]; state.terminalSubjectKeysInScope = [item.subjectKey]
  await service.pushDerivedAlerts()
  assert.equal(calls.length, 1, `${type} 同一回合再纳入保持原去重行为`)
  state.alerts = []
  await service.pushDerivedAlerts()
  assert.equal(calls.length, 2, `${type} 在范围内真恢复仍推送`)
  assert.match(JSON.parse(String(calls[1].body)).text.content, /已恢复/)
}
console.log('PASS 离线 / 打印机：范围、恢复及同回合再纳入行为不变')

for (const [label, leave, reenter] of [
  ['停用', (s) => { s.terminal.enabled = false }, (s) => { s.terminal.enabled = true }],
  ['非 active', (s) => { s.terminal.lifecycleStatus = 'maintenance' }, (s) => { s.terminal.lifecycleStatus = 'active' }],
  ['离线', (s) => { s.terminal.heartbeats[0].createdAt = new Date(Date.now() - ONLINE_WINDOW_MS) }, (s) => { s.terminal.heartbeats[0].createdAt = new Date() }],
  ['能力关闭', (s) => { s.capability.status = 'disabled' }, (s) => { s.capability.status = 'available' }],
  ['能力不可用', (s) => { s.capability.status = 'unavailable' }, (s) => { s.capability.status = 'available' }],
  ['删除', (s) => { s.deleted = true }, (s) => { s.deleted = false }],
  ['缺少扫描状态', (s) => { s.terminal.heartbeats[0].scanDeviceHealth = null }, (s) => { s.terminal.heartbeats[0].scanDeviceHealth = 'error' }],
  ['缺少心跳', (s) => { s.terminal.heartbeats = [] }, (s) => { s.terminal.heartbeats = [{ createdAt: new Date(), printerStatus: 'ready', scanDeviceHealth: 'error' }] }],
]) {
  const { state, prisma, service, messages } = scanFixture()
  const first = (await collectDerivedAlerts(prisma, new Date())).alerts.find((a) => a.type === 'scan_device_issue')
  assert.ok(first)
  await service.pushDerivedAlerts(); await service.pushDerivedAlerts()
  assert.equal(messages().length, 1)
  leave(state)
  await service.pushDerivedAlerts(); await service.pushDerivedAlerts()
  assert.equal(messages().length, 1, `${label}：扫描仪静默移出，不推已恢复`)
  reenter(state)
  const back = (await collectDerivedAlerts(prisma, new Date())).alerts.find((a) => a.type === 'scan_device_issue')
  assert.equal(back?.episodeToken, first.episodeToken, `${label}：模拟同一故障回合`)
  await service.pushDerivedAlerts(); await service.pushDerivedAlerts()
  assert.equal(messages().length, 2, `${label}：重新纳入仍故障，再推一次正在发生`)
  assert.ok(messages().every((content) => content.endsWith('正在发生')), `${label} 不得伪报恢复`)
  console.log(`PASS 扫描仪${label}：不推恢复；同回合再纳入重推一次`)
}

// 最新一次明确的非故障状态才是恢复证据（null / 无心跳已在上面覆盖）。
for (const health of ['ready', 'busy', 'unknown']) {
  const { state, service, messages } = scanFixture()
  await service.pushDerivedAlerts()
  state.terminal.heartbeats[0] = { createdAt: new Date(), printerStatus: 'ready', scanDeviceHealth: health }
  await service.pushDerivedAlerts(); await service.pushDerivedAlerts()
  assert.equal(messages().length, 2, `${health}：真恢复只推一次`)
  assert.match(messages()[1], /已恢复$/)
}
console.log('PASS 扫描仪真恢复：在线、能力可用、最新非故障回报才推一次恢复')
{
  const scan = { ...alert, type: 'scan_device_issue', subjectKey: 'scan_device_issue:t1' }
  const state = { alerts: [scan] }; const calls = []
  const service = make('https://example.invalid', state, calls)
  await service.pushDerivedAlerts(); state.alerts = []
  await service.pushDerivedAlerts()
  assert.equal(calls.length, 1, '旧收集器没有范围证据时，扫描仪也不得凭消失推恢复')
}
console.log('PASS 扫描仪缺少范围证据：不推恢复')

// 新的 AI 告警不是终端类。推送端不按类型过滤：消失时同样推「已恢复」，正文仍不带 detail。
const aiAlert = { id: 'ai', subjectKey: 'ai_provider_unavailable:global', subjectId: 'global', episodeToken: '2026-10-06T06:00:00.000Z', type: 'ai_provider_unavailable', severity: 'error', title: 'AI 服务账户不可用（余额或密钥问题），用户只能用手动方式', detail: 'SENTINEL_DETAIL', terminalCode: null, occurredAt: new Date().toISOString() }
const aiState = { alerts: [aiAlert] }
const aiCalls = []
const aiService = make('https://example.invalid', aiState, aiCalls)
await aiService.pushDerivedAlerts()
aiState.alerts = []
await aiService.pushDerivedAlerts()
assert.equal(aiCalls.length, 2)
const aiRecovered = JSON.parse(String(aiCalls[1].body))
assert.match(aiRecovered.text.content, /已恢复/)
assert.match(aiRecovered.text.content, /AI 服务账户不可用/)
assert.doesNotMatch(aiRecovered.text.content, /SENTINEL_DETAIL/)
console.log('alert push gates passed')
})().catch((error) => { console.error(error); process.exitCode = 1 })
