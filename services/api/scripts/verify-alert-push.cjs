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
