/**
 * 机构设备告警通知：地址白名单、不跟随重定向、机构隔离、测试消息、
 * 告警产生与恢复各推一次、未配置不报错、报障只进平台总通知。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { printerStatusLabel, printerStatusSummary } from '../../../apps/partner/src/lib/printerStatusLabel'
import { AdminAlertPushService } from '../src/admin-ops/admin-alert-push.service'
import { collectDerivedAlerts, resolveDerivedAlert } from '../src/admin-ops/derived-alerts'
import {
  assertDeviceAlertWebhookUrl,
  DeviceAlertWebhookError,
  maskWebhookUrl,
  postGroupRobot,
} from '../src/admin-ops/device-alert-webhook'
import { collectPartnerIncidents } from '../src/admin-ops/derived-partner-incidents'
import { DEVICE_ALERT_TEST_MESSAGE } from '../src/admin-ops/org-device-alert-push'
import { OrgDeviceAlertWebhookService } from '../src/admin-ops/org-device-alert-webhook.service'
import { AuditService } from '../src/audit/audit.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { encryptSecret } from '../src/common/crypto/secret-cipher'
import { PrismaService } from '../src/prisma/prisma.service'
import { countOpenDeviceAlerts, isOpenScanDeviceFault } from '../src/orgs/partner-terminal-ops'
import { RedisService } from '../src/common/redis/redis.service'

const API_ROOT = join(__dirname, '..')
const KEY_A = 'partner-a-!secret!'
const KEY_B = 'partner-b-!secret!'
const URL_A = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${KEY_A}`
const URL_B = `https://oapi.dingtalk.com/robot/send?access_token=${KEY_B}`
const PLATFORM = 'http://alert.invalid/hook'

class MemRedis {
  values = new Map<string, string>()
  keys = new Set<string>()
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && this.keys.has(key)) return null
    this.values.set(key, value)
    if (args.includes('NX')) this.keys.add(key)
    return 'OK'
  }
  async setEx(key: string, _ttl: number, value: string) { this.values.set(key, value) }
  async setIfAbsent(key: string, value: string) {
    if (this.keys.has(key)) return false
    this.keys.add(key)
    this.values.set(key, value)
    return true
  }
  async del(key: string) {
    this.keys.delete(key)
    this.values.delete(key)
    return 1
  }
}

function messageOf(error: unknown): string {
  // swc 编译后跨文件 instanceof HttpException 可能为 false，改读响应体。
  const response = error && typeof error === 'object' && 'getResponse' in error
    && typeof (error as { getResponse?: unknown }).getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : error && typeof error === 'object' && 'response' in error
      ? (error as { response?: unknown }).response
      : undefined
  if (response && typeof response === 'object') {
    const nested = (response as { error?: { message?: unknown }; message?: unknown }).error?.message
      ?? (response as { message?: unknown }).message
    if (typeof nested === 'string' && nested.length > 0) return nested
  }
  if (typeof response === 'string' && response.length > 0) return response
  return error instanceof Error ? error.message : String(error)
}

function pushSchema(url: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })
}

function user(orgId: string | null, role: AuthedUser['role'] = 'partner'): AuthedUser {
  return { userId: `user-${orgId ?? 'none'}`, role, orgId }
}

async function main(): Promise<void> {
  if (!process.env['SECRET_ENCRYPTION_KEY'] || process.env['SECRET_ENCRYPTION_KEY'].length < 32) {
    process.env['SECRET_ENCRYPTION_KEY'] = 'org-device-alert-verify-key-32chars-min'
  }
  const savedWebhook = process.env['ALERT_WEBHOOK_URL']
  const savedDb = process.env['DATABASE_URL']
  const dir = mkdtempSync(join(tmpdir(), 'org-device-alert-'))
  const databaseUrl = `file:${join(dir, 'alert.db')}`
  closeSync(openSync(join(dir, 'alert.db'), 'a'))
  let prisma: PrismaService | null = null
  try {
    assertWhitelist()
    assertLabels()
    await assertRedirect()
    await assertIncidents()
    pushSchema(databaseUrl)
    process.env['DATABASE_URL'] = databaseUrl
    prisma = new PrismaService()
    await prisma.onModuleInit()
    await assertIsolation(prisma)
    await assertPush(prisma)
    console.log('PASS 机构设备告警通知')
  } finally {
    await prisma?.onModuleDestroy().catch(() => undefined)
    if (savedWebhook === undefined) delete process.env['ALERT_WEBHOOK_URL']
    else process.env['ALERT_WEBHOOK_URL'] = savedWebhook
    if (savedDb === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = savedDb
    rmSync(dir, { recursive: true, force: true })
  }
}

function assertWhitelist(): void {
  assert.equal(assertDeviceAlertWebhookUrl(URL_A), URL_A)
  assert.throws(() => assertDeviceAlertWebhookUrl('https://example.com/hook'), (error: unknown) =>
    error instanceof DeviceAlertWebhookError && error.message === '通知地址只接受企业微信、钉钉或飞书的群机器人')
  assert.throws(() => assertDeviceAlertWebhookUrl('http://qyapi.weixin.qq.com/hook'), (error: unknown) =>
    error instanceof DeviceAlertWebhookError && error.message === '通知地址只能使用 https')
  assert.throws(() => assertDeviceAlertWebhookUrl('https://user:pass@qyapi.weixin.qq.com/hook'), (error: unknown) =>
    error instanceof DeviceAlertWebhookError && error.message === '通知地址不能带账号或密码')
  assert.throws(() => assertDeviceAlertWebhookUrl('https://qyapi.weixin.qq.com.evil.com/hook'), (error: unknown) =>
    error instanceof DeviceAlertWebhookError && /只接受/.test(error.message))
  assert.throws(() => assertDeviceAlertWebhookUrl(maskWebhookUrl(URL_A)), (error: unknown) =>
    error instanceof DeviceAlertWebhookError && error.message.includes('打码后的地址不能再次保存'))
  const masked = maskWebhookUrl(URL_A)
  assert.equal(masked.includes(KEY_A), false)
  assert.equal(masked.includes('qyapi.weixin.qq.com'), true)
  const source = readFileSync(join(API_ROOT, 'src/admin-ops/device-alert-webhook.ts'), 'utf8')
  assert.match(source, /redirect:\s*'manual'/)
  assert.match(source, /AbortSignal\.timeout\(5000\)/)
}

function assertLabels(): void {
  assert.equal(printerStatusLabel('low_paper'), '纸张或墨粉不足')
  assert.equal(printerStatusLabel('paper_empty'), '缺纸')
  assert.equal(printerStatusLabel('paper_out'), '缺纸')
  assert.equal(printerStatusLabel('paper_jam'), '卡纸')
  assert.equal(printerStatusLabel('ok'), '就绪')
  assert.equal(printerStatusLabel(null), '尚未上报')
  assert.equal(printerStatusLabel('made_up'), '暂不能识别，请现场核对')
  assert.equal(printerStatusLabel('queue_cleanup_failed').includes('Agent'), false)
  assert.equal(printerStatusSummary('low_paper', 1, true), '纸张或墨粉不足，未恢复 1 条')
  assert.equal(printerStatusSummary('ready', 1, false), '当前不能确认，未恢复 1 条', '离线时不能拿最后一次上报的「就绪」当现在')
  assert.equal(countOpenDeviceAlerts({ enabled: false, lifecycleStatus: 'active', online: false, printerStatus: 'error', scanDeviceFault: true }), 0)
  assert.equal(countOpenDeviceAlerts({ enabled: true, lifecycleStatus: 'planned', online: false, printerStatus: null, scanDeviceFault: false }), 0)
  assert.equal(countOpenDeviceAlerts({ enabled: true, lifecycleStatus: 'active', online: false, printerStatus: 'error', scanDeviceFault: true }), 1)
  assert.equal(countOpenDeviceAlerts({ enabled: true, lifecycleStatus: 'active', online: true, printerStatus: 'ready', scanDeviceFault: false }), 0)
  assert.equal(countOpenDeviceAlerts({ enabled: true, lifecycleStatus: 'active', online: true, printerStatus: 'low_paper', scanDeviceFault: false }), 1)
  assert.equal(countOpenDeviceAlerts({
    enabled: true, lifecycleStatus: 'active', online: true, printerStatus: 'error',
    scanDeviceFault: isOpenScanDeviceFault(true, true, 'not_found'),
  }), 2)
  assert.equal(isOpenScanDeviceFault(true, true, 'unknown'), false)
}

async function assertRedirect(): Promise<void> {
  let calls = 0
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls += 1
    assert.equal(init?.redirect, 'manual')
    assert.ok(init?.signal instanceof AbortSignal)
    return { ok: false, status: 302, headers: { get: () => 'https://evil.example/next' }, json: async () => ({}) } as unknown as Response
  }
  await assert.rejects(() => postGroupRobot(URL_A, 'hi', fetchImpl), (error: unknown) =>
    error instanceof DeviceAlertWebhookError && error.message === '测试消息没有发出去，请核对地址后重试' && !String(error).includes(KEY_A))
  assert.equal(calls, 1)
}

async function assertIncidents(): Promise<void> {
  const note = '备注里有手机号 13800138000 和订单'
  const createdAt = new Date('2026-11-11T01:00:00.000Z')
  const reopenedAt = new Date('2026-11-11T05:00:00.000Z')
  const rows = [
    { id: 'inc-open', orgId: 'org-a', terminalCode: 'K-01', issueCode: 'paper', status: 'open', createdAt, note },
    { id: 'inc-done', orgId: 'org-a', terminalCode: 'K-01', issueCode: 'jam', status: 'resolved', createdAt, note },
  ]
  const prisma = {
    serviceIncident: {
      findMany: async ({ where }: { where: { status: { in: string[] } } }) =>
        rows.filter((row) => where.status.in.includes(row.status)),
      findFirst: async ({ where }: { where: { id: string; status: { in: string[] } } }) =>
        rows.find((row) => row.id === where.id && where.status.in.includes(row.status)) ?? null,
    },
    serviceIncidentEvent: {
      findMany: async () => [{ incidentId: 'inc-open', createdAt: reopenedAt, action: 'reopen' }],
    },
    organization: { findMany: async () => [{ id: 'org-a', name: '市南中心' }] },
    terminal: { findUnique: async () => { throw new Error('报障不应落到终端查询') } },
  }
  const alerts = await collectPartnerIncidents(prisma as never, new Date())
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]?.type, 'partner_incident')
  assert.equal(alerts[0]?.episodeToken, reopenedAt.toISOString())
  assert.equal(alerts[0]?.title.includes('市南中心的K-01'), true)
  assert.equal(alerts[0]?.title.includes('缺纸'), true)
  assert.equal(`${alerts[0]?.title} ${alerts[0]?.detail}`.includes('13800138000'), false)
  assert.equal(`${alerts[0]?.title} ${alerts[0]?.detail}`.includes('订单'), false)
  const resolved = await resolveDerivedAlert(prisma as never, 'partner_incident', 'inc-open', new Date())
  assert.equal(resolved?.subjectKey, 'partner_incident:inc-open')
  assert.equal(await resolveDerivedAlert(prisma as never, 'partner_incident', 'inc-done', new Date()), null)
  assert.deepEqual(await collectPartnerIncidents({} as never, new Date()), [])
  const scanTerminal = {
    id: 'scan-t1', terminalCode: 'SCAN-01', enabled: true, lifecycleStatus: 'active', registeredAt: new Date(0),
    heartbeats: [{ createdAt: new Date(), printerStatus: 'ready', scanDeviceHealth: 'ready' }],
  }
  const derived = await collectDerivedAlerts({
    terminal: { findMany: async () => [scanTerminal] },
    terminalCapability: { findMany: async () => [] },
    terminalHeartbeat: { groupBy: async () => [] },
    printTask: { findMany: async () => [], count: async () => 0 },
    feedbackTicket: { count: async () => 0, findFirst: async () => null },
    aiUsageRecord: { findMany: async () => [], groupBy: async () => [], count: async () => 0 },
    serviceIncident: prisma.serviceIncident,
    serviceIncidentEvent: prisma.serviceIncidentEvent,
    organization: prisma.organization,
  } as never, new Date())
  assert.equal(derived.alerts.some((alert) => alert.type === 'partner_incident' && !alert.detail.includes(note)), true)
  assert.equal(derived.firingTotal >= 1, true)
}

async function assertIsolation(prisma: PrismaService): Promise<void> {
  await prisma.organization.create({ data: { id: 'org-a', name: '市南中心', type: 'public_service' } })
  await prisma.organization.create({ data: { id: 'org-b', name: '即墨中心', type: 'public_service' } })
  await prisma.user.create({ data: { id: 'user-org-a', username: 'org-a', passwordHash: 'x', name: '甲', role: 'partner', orgId: 'org-a' } })
  await prisma.user.create({ data: { id: 'user-org-b', username: 'org-b', passwordHash: 'x', name: '乙', role: 'partner', orgId: 'org-b' } })
  await prisma.user.create({ data: { id: 'user-platform', username: 'platform', passwordHash: 'x', name: '平台', role: 'admin' } })
  const audit = new AuditService(prisma)
  const calls: Array<{ url: string; body: string }> = []
  const service = new OrgDeviceAlertWebhookService(prisma, audit)
  service.useFetchForTest(async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) } as Response
  })
  const viewA = await service.saveForPartner(user('org-a'), URL_A, {})
  const viewB = await service.saveForPartner(user('org-b'), URL_B, {})
  assert.equal(viewA.maskedUrl?.includes(KEY_A), false)
  assert.equal(viewB.maskedUrl?.includes(KEY_B), false)
  assert.equal((await service.viewForPartner(user('org-b'))).maskedUrl, viewB.maskedUrl)
  assert.notEqual((await service.viewForPartner(user('org-a'))).maskedUrl, viewB.maskedUrl)
  await assert.rejects(() => service.saveForPartner(user('org-a'), maskWebhookUrl(URL_A), {}), (error: unknown) =>
    messageOf(error).includes('打码后的地址不能再次保存'))
  assert.equal((await service.viewForPartner(user('org-a'))).maskedUrl, viewA.maskedUrl)
  await service.testForPartner(user('org-a'), {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, URL_A)
  assert.equal(calls[0]?.body.includes(DEVICE_ALERT_TEST_MESSAGE), true)
  assert.equal(calls[0]?.body.includes(KEY_A), false)
  assert.equal(calls[0]?.body.includes('订单'), false)
  await assert.rejects(() => service.testForPartner(user('org-missing'), {}), (error: unknown) =>
    messageOf(error) === '当前账号未绑定机构' || messageOf(error) === '机构不存在')
  const unbound = user(null)
  await assert.rejects(async () => service.viewForPartner(unbound), (error: unknown) =>
    messageOf(error) === '当前账号未绑定机构')
  await service.saveForAdmin(user('platform', 'admin'), 'org-b', '  ', {})
  assert.equal((await service.viewForAdmin('org-b')).configured, false)
  assert.equal((await service.viewForAdmin('org-a')).configured, true)
  await assert.rejects(() => service.testForAdmin(user('platform', 'admin'), 'org-b', {}), (error: unknown) =>
    messageOf(error) === '请先保存通知地址，再发送测试消息')
  const audits = await prisma.auditLog.findMany({ where: { action: 'organization.device_alert_webhook' } })
  const packed = JSON.stringify(audits.map((row) => row.payloadJson))
  assert.equal(packed.includes(KEY_A), false)
  assert.equal(packed.includes(KEY_B), false)
  assert.equal(packed.includes('qyapi.weixin.qq.com'), true)
}

function terminalAlert(episode = 'ep1') {
  return {
    id: 'terminal_offline:t1',
    subjectKey: 'terminal_offline:t1',
    subjectId: 't1',
    episodeToken: episode,
    type: 'terminal_offline' as const,
    severity: 'error' as const,
    title: '终端 K-01 离线',
    detail: 'SENTINEL_DETAIL 订单 13800138000',
    terminalCode: 'K-01',
    occurredAt: '2026-11-11T02:00:00.000Z',
  }
}

function incidentAlert() {
  return {
    id: 'partner_incident:inc1',
    subjectKey: 'partner_incident:inc1',
    subjectId: 'inc1',
    episodeToken: '2026-11-11T01:00:00.000Z',
    type: 'partner_incident' as const,
    severity: 'error' as const,
    title: '机构报障未关闭：市南中心的K-01（缺纸）',
    detail: '备注 13800138000',
    terminalCode: 'K-01',
    occurredAt: '2026-11-11T01:00:00.000Z',
  }
}

async function assertPush(prisma: PrismaService): Promise<void> {
  await prisma.terminal.create({
    data: {
      id: 't1', terminalCode: 'K-01', agentToken: 'token-t1', deviceFingerprint: 'fp-t1',
      displayName: '图书馆一层', locationLabel: '一楼大厅', orgId: 'org-a', orgBoundAt: new Date('2026-11-01T00:00:00.000Z'),
    },
  })
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} })
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) } as Response
  }
  const redis = new RedisService(new MemRedis() as never)
  delete process.env['ALERT_WEBHOOK_URL']
  const idle = new AdminAlertPushService(null, redis, async () => { throw new Error('不该收集') }, fetchImpl)
  await idle.pushDerivedAlerts()
  assert.equal(calls.length, 0, '平台和机构都没配时不发、也不报错')

  const state: { alerts: Array<ReturnType<typeof terminalAlert> | ReturnType<typeof incidentAlert>>; scope: string[] } = {
    alerts: [terminalAlert(), incidentAlert()],
    scope: ['terminal_offline:t1', 'printer_issue:t1'],
  }
  process.env['ALERT_WEBHOOK_URL'] = PLATFORM
  const service = new AdminAlertPushService(prisma, redis, async () => ({
    alerts: state.alerts,
    terminalSubjectKeysInScope: state.scope,
  }), fetchImpl)
  await service.pushDerivedAlerts()
  const orgCalls = () => calls.filter((call) => call.url === URL_A)
  const platformCalls = () => calls.filter((call) => call.url === PLATFORM)
  assert.equal(orgCalls().length, 1)
  assert.equal(platformCalls().length, 2)
  const orgBody = JSON.parse(String(orgCalls()[0]?.init.body)).text.content as string
  assert.match(orgBody, /图书馆一层（一楼大厅）/)
  assert.match(orgBody, /问题：离线/)
  assert.match(orgBody, /开始：2026-11-11 10:00/)
  assert.match(orgBody, /补纸：请打开纸盒，放入 A4 纸。/)
  assert.match(orgBody, /清卡纸：请打开打印机盖板，取出卡住的纸张后关好。/)
  assert.match(orgBody, /检查电源和网络：请确认电源已插好，网线或网络已经连通。/)
  assert.equal(orgBody.includes(KEY_A), false)
  assert.equal(orgBody.includes('13800138000'), false)
  assert.equal(orgBody.includes('订单'), false)
  assert.equal(platformCalls().some((call) => String(call.init.body).includes('机构报障未关闭')), true)
  assert.equal(platformCalls().every((call) => !String(call.init.body).includes('13800138000')), true)
  await service.pushDerivedAlerts()
  assert.equal(calls.length, 3, '同一场故障不重复推')
  state.alerts = []
  await service.pushDerivedAlerts()
  assert.equal(orgCalls().length, 2)
  assert.equal(platformCalls().length, 4)
  const recovered = JSON.parse(String(orgCalls()[1]?.init.body)).text.content as string
  assert.match(recovered, /已恢复/)
  assert.equal(recovered.includes('补纸'), false)
  await service.pushDerivedAlerts()
  assert.equal(calls.length, 6)

  const scoped = [terminalAlert('ep-scope')]
  const scopeState = { alerts: scoped, scope: ['terminal_offline:t1'] }
  const scopeService = new AdminAlertPushService(prisma, new RedisService(new MemRedis() as never), async () => ({
    alerts: scopeState.alerts, terminalSubjectKeysInScope: scopeState.scope,
  }), fetchImpl)
  const before = calls.length
  await scopeService.pushDerivedAlerts()
  scopeState.alerts = []
  scopeState.scope = []
  await scopeService.pushDerivedAlerts()
  assert.equal(orgCalls().length, 3, '离开考察范围不再发已恢复')
  assert.equal(calls.length, before + 2, '平台同样不发已恢复，机构只发了正在发生')

  // 打印失败类（含打印可靠性那一包的「排队超时未领取」）只进平台总通知，不进机构群。
  const queueTimeout = {
    id: 'print_failed:task-q1', subjectKey: 'print_failed:task-q1', subjectId: 'task-q1', episodeToken: 'ep-q1',
    type: 'print_failed' as const, severity: 'error' as const, title: '打印任务失败：排队超时未领取',
    detail: '任务 task-q1 · 终端 K-01 · 错误码 PRINT_QUEUE_TIMEOUT', terminalCode: 'K-01', occurredAt: '2026-11-11T03:00:00.000Z',
  }
  const failedService = new AdminAlertPushService(prisma, new RedisService(new MemRedis() as never), async () => ({
    alerts: [queueTimeout], terminalSubjectKeysInScope: ['terminal_offline:t1', 'printer_issue:t1'],
  }), fetchImpl)
  const beforeFailed = calls.length
  const orgBeforeFailed = orgCalls().length
  await failedService.pushDerivedAlerts()
  assert.equal(orgCalls().length, orgBeforeFailed, '打印失败（含排队超时未领取）不能推到机构群')
  assert.equal(calls.length, beforeFailed + 1, '打印失败照旧只推平台总地址')

  // 机构群发不出去：不抛错、平台照发、快照照写（下一轮才能判恢复），日志不带密钥。
  const brokenRedis = new MemRedis()
  const brokenCalls: string[] = []
  const brokenFetch: typeof fetch = async (url) => {
    brokenCalls.push(String(url))
    if (String(url) === URL_A) throw new Error(`connect ECONNREFUSED ${String(url)}`)
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) } as Response
  }
  const brokenService = new AdminAlertPushService(prisma, new RedisService(brokenRedis as never), async () => ({
    alerts: [terminalAlert('ep-broken')], terminalSubjectKeysInScope: ['terminal_offline:t1'],
  }), brokenFetch)
  const logged: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  const writeErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((chunk: unknown) => { logged.push(String(chunk)); return true }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => { logged.push(String(chunk)); return true }) as typeof process.stderr.write
  try {
    await brokenService.pushDerivedAlerts()
  } finally {
    process.stdout.write = write
    process.stderr.write = writeErr
  }
  assert.deepEqual([...brokenCalls].sort(), [PLATFORM, URL_A].sort(), '机构群失败不能挡住平台总通知')
  assert.equal(brokenRedis.values.has('admin-alert-push:previous'), true, '机构群发送失败也要写快照')
  assert.equal([...brokenRedis.keys].some((key) => key.startsWith('admin-alert-push:org:')), false, '发送失败要删去重标记，下一轮可以再试')
  assert.equal(logged.join('').includes('ORG_ALERT_PUSH_FAILED'), true, '机构群发送失败要留一行日志')
  assert.equal(logged.join('').includes(KEY_A), false, '日志里出现了机器人密钥')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
