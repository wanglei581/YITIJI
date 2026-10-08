const assert = require('node:assert/strict')
const { AdminAlertPushService } = require('../src/admin-ops/admin-alert-push.service')
const { RedisService } = require('../src/common/redis/redis.service')
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
  return new AdminAlertPushService(null, new RedisService(new MemRedis()), async () => ({ alerts: state.alerts }), fetchImpl)
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
console.log('alert push gates passed')
})().catch((error) => { console.error(error); process.exitCode = 1 })
