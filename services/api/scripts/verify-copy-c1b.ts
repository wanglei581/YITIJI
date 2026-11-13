// 不验证招聘托管内容：终端管理服务只用于 C1e 的停用 / 维护 / 改绑撤权，按生产配置（托管关闭）跑。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { readFileSync } from 'node:fs'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalCredentialSecurityService } from '../src/terminals/terminal-credential-security.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { CopyJobsController } from '../src/copy-jobs/copy-jobs.controller'
import { CopyAgentController } from '../src/copy-jobs/copy-agent.controller'
import { CopyJobsService } from '../src/copy-jobs/copy-jobs.service'
import { CopyAgentService } from '../src/copy-jobs/copy-agent.service'
import { CopyJobStore, copyDigest } from '../src/copy-jobs/copy-job-store.service'
import { COPY_MAX_PAGES } from '../src/copy-jobs/copy-job.policy'
import { COPY_MAX_COPIES, type CopyJobView, type CopyPermit } from '../src/copy-jobs/copy-job.types'
import { SCAN_DEVICE_OTHER_MAX_PAGES } from '../src/files/file-validation'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { setTerminalUserPrintPrices } from '../src/payment/effective-user-prices'
import { KEY_GUEST_PER_ORDER_SIDES } from '../src/print-jobs/free-print-quota.policy'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { verifyCopyC1c } from './support/copy-c1c-verification'
import { verifyCopyC1e } from './support/copy-c1e-verification'
const pass = (s: string) => console.log(`PASS ${s}`)
type View = CopyJobView & { controlToken: string }
async function main() {
  assertIsolatedVerificationDatabase()
  const prisma = new PrismaService(), suffix = randomUUID(), audit = new AuditService(prisma)
  const orgId = `copy-c1b-org-${suffix}`, userId = `copy-c1b-user-${suffix}`
  const tids = [`copy-c1b-a-${suffix}`, `copy-c1b-b-${suffix}`], agentTokens = [randomUUID(), randomUUID()]
  // 仅 Redis transport 用夹具；真实 HTTP/DTO/终端会话与 Agent 凭证验证/数据库均走实际实现。
  const cache = new Map<string, { value: string; expires: number }>()
  const put = async (key: string, value: string, ttl: number) => { cache.set(key, { value, expires: Date.now() + ttl * 1000 }) }
  const get = async (key: string) => { const row = cache.get(key); return row && row.expires > Date.now() ? row.value : null }
  const redis = { get, set: put, setEx: (key: string, ttl: number, value: string) => put(key, value, ttl),
    getDel: async (key: string) => { const v = await get(key); cache.delete(key); return v } } as unknown as RedisService
  const credentials = new TerminalCredentialSecurityService(prisma, audit)
  const sessions = new TerminalSessionService(redis, prisma, credentials)
  const terminals = Object.assign(Object.create(TerminalsService.prototype), {
    agent: new TerminalAgentService(prisma, audit, credentials),
  }) as TerminalsService
  const store = new CopyJobStore(prisma, redis, audit), jobs = new CopyJobsService(store), agent = new CopyAgentService(store)
  // 复印单价取本机同色打印生效价。全站价目仍临时归零并在结束时恢复；用户实付不读它。
  const priceKeys = ['print_bw_page', 'print_color_page']
  const priorPrices = await prisma.priceConfig.findMany({ where: { serviceKey: { in: priceKeys } } })
  // 复印与打印共用免费额度；本门禁要走 99 份 20 页的边界，临时放宽游客每单上限，额度判定另有 verify:copy-quota。
  const priorGuestLimit = await prisma.platformSetting.findUnique({ where: { key: KEY_GUEST_PER_ORDER_SIDES } })
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined
  const oddSetting = process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY']
  delete process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY']
  try {
    await prisma.organization.create({ data: { id: orgId, name: '隔离复印验证', type: 'test' } })
    await prisma.endUser.create({ data: { id: userId, phoneHash: userId, phoneEnc: userId, enabled: true, status: 'active' } })
    for (let i = 0; i < 2; i++) {
      await prisma.terminal.create({ data: { id: tids[i], terminalCode: tids[i], agentToken: agentTokens[i], deviceFingerprint: tids[i], orgId,
        dailyFreePrintSides: 10_000 } })
      await prisma.terminalCredential.create({ data: { id: randomUUID(), terminalId: tids[i], generation: 0,
        tokenHash: copyDigest(agentTokens[i]), issueSource: 'test', expiresAt: new Date(Date.now() + 300_000) } })
    }
    for (const serviceKey of priceKeys) await prisma.priceConfig.upsert({ where: { serviceKey },
      create: { serviceKey, unitCents: 0, unit: 'page' }, update: { unitCents: 0, unit: 'page', active: true, effectiveFrom: new Date(0) } })
    await prisma.platformSetting.upsert({ where: { key: KEY_GUEST_PER_ORDER_SIDES },
      create: { key: KEY_GUEST_PER_ORDER_SIDES, value: '10000' }, update: { value: '10000' } })
    const screenTokens: string[] = []
    for (let i = 0; i < 2; i++) {
      const ticket = await sessions.createBootTicket(tids[i], `Bearer ${agentTokens[i]}`)
      screenTokens.push((await sessions.exchangeBootTicket(ticket.bootTicket)).sessionToken)
    }
    @Module({ controllers: [CopyJobsController, CopyAgentController], providers: [TerminalIdentityGuard,
      { provide: TerminalSessionService, useValue: sessions }, { provide: CopyJobsService, useValue: jobs },
      { provide: CopyAgentService, useValue: agent }, { provide: TerminalsService, useValue: terminals },
      { provide: JwtService, useValue: new JwtService({ secret: 'copy-c1b-test-only' }) },
      { provide: RedisService, useValue: redis }, { provide: PrismaService, useValue: prisma }] })
    class FixtureModule {}
    app = await NestFactory.create(FixtureModule, { logger: false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    async function request<T = CopyJobView>(method: string, path: string, body?: unknown, index = 0, token?: string,
      expected = 200, authMode: 'screen' | 'agent' | 'none' = path.startsWith('/terminals/') ? 'agent' : 'screen'): Promise<T> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authMode === 'screen') Object.assign(headers, { 'x-terminal-id': tids[index], 'x-terminal-session-token': screenTokens[index] })
      if (authMode === 'agent') headers.authorization = `Bearer ${agentTokens[index]}`
      if (token) headers['x-copy-control'] = token
      const res = await fetch(`${base}/api/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
      const payload = await res.json() as { data: T; error?: { code: string } }
      assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`)
      return (expected === 200 ? payload.data : payload.error?.code) as T
    }
    const input = { terminalId: tids[0], requestKey: randomUUID(), source: 'flatbed', colorMode: 'black_white', duplex: 'simplex', copies: 1 }
    const create = (patch = {}) => request<View>('POST', '/copy/jobs', { ...input, requestKey: randomUUID(), ...patch })
    const pp = (id: string, op: string, i = 0) => `/terminals/${tids[i]}/copy/jobs/${id}/permit?op=${op}`
    const sp = (id: string, i = 0) => `/terminals/${tids[i]}/copy/jobs/${id}/scan-result`
    const rp = (id: string) => `/terminals/${tids[0]}/copy/jobs/${id}/result`
    const cap = (key: string, status: string) => prisma.terminalCapability.upsert({
      where: { terminalId_capabilityKey: { terminalId: tids[0], capabilityKey: key } },
      create: { terminalId: tids[0], capabilityKey: key, status }, update: { status } })
    assert.equal(await request('POST', '/copy/jobs', input, 0, undefined, 401, 'none'), 'TERMINAL_SESSION_INVALID')
    assert.equal(await request('POST', '/copy/jobs', input, 0, undefined, 409), 'COPY_CAPABILITY_REVOKED')
    for (const key of ['copy', 'scan_device', 'color_print', 'duplex_print']) await cap(key, 'available')
    await verifyCopyC1c(store, jobs, agent, tids[0], (id, op) => request<CopyPermit>('GET', pp(id, op)))
    await verifyCopyC1e(store, jobs, agent, tids[0], tids[1], (id, op) => request<CopyPermit>('GET', pp(id, op)))
    const first = await create({ requestKey: input.requestKey }), id = first.copyId
    assert.equal(first.state, 'ready'); assert.ok(first.controlToken)
    const replay = await request('POST', '/copy/jobs', input)
    assert.equal(replay.copyId, id); assert.equal('controlToken' in replay, false)
    assert.equal(await request('POST', '/copy/jobs', { ...input, copies: 2 }, 0, undefined, 409), 'COPY_IDEMPOTENCY_CONFLICT')
    await request('GET', `/copy/jobs/${id}`, undefined, 0, undefined, 403)
    await request('GET', `/copy/jobs/${id}`, undefined, 0, first.controlToken)
    await request('GET', `/copy/jobs/${id}`, undefined, 1, first.controlToken, 404)
    await request('POST', '/copy/jobs', { ...input, requestKey: randomUUID(), copies: 100 }, 0, undefined, 413)
    await request('POST', '/copy/jobs', { ...input, requestKey: randomUUID(), file: 'private' }, 0, undefined, 400)
    pass('建单：游客、能力关拒绝、同参同单且令牌只返一次、异参409、控制/终端隔离、白名单、份数上限')
    assert.equal((await request<CopyPermit>('GET', pp(id, 'print'))).allowed, false, '未确认也给 print 许可')
    await request('GET', pp(id, 'scan'), undefined, 0, undefined, 401, 'none')
    await request('GET', pp(id, 'scan', 1), undefined, 1, undefined, 404)
    const scanPermit = await request<CopyPermit>('GET', pp(id, 'scan'))
    assert.equal(scanPermit.allowed, true); assert.equal(scanPermit.parameters.maxPages, SCAN_DEVICE_OTHER_MAX_PAGES)
    assert.equal(scanPermit.parameters.maxCopies, 99); assert.ok(Date.parse(scanPermit.expiresAt) <= Date.now() + 30_000)
    const scanned = await request('POST', sp(id), { generation: 1, pageCount: 3 })
    assert.equal(scanned.pageCount, 3); assert.equal(scanned.quote?.amountCents, 0)
    assert.equal((await request('POST', sp(id), { generation: 1, pageCount: 3 })).pageCount, 3)
    await request('POST', sp(id), { generation: 1, pageCount: COPY_MAX_PAGES + 1 }, 0, undefined, 413)
    await request('POST', sp(id, 1), { generation: 1, pageCount: 3 }, 1, undefined, 404)
    await request('POST', sp(id), { generation: 1, pageCount: 4 }, 0, undefined, 409)
    const stale = await create()
    await prisma.copyJob.update({ where: { id: stale.copyId }, data: { generation: 2 } })
    await request('POST', sp(stale.copyId), { generation: 1, pageCount: 8 }, 0, undefined, 409)
    assert.equal((await store.find(stale.copyId)).pageCount, 0, '旧代次回报覆盖新值')
    await request('POST', sp(stale.copyId), { generation: 2, pageCount: 5 })
    await request('POST', sp(stale.copyId), { generation: 1, pageCount: 8 }, 0, undefined, 409)
    assert.equal((await store.find(stale.copyId)).pageCount, 5)
    pass('扫描回报：同代同值幂等、同代异值冲突、超页数/跨终端拒绝、旧代次不覆盖')
    const confirmation = { quoteVersion: scanned.quoteVersion }
    await cap('copy', 'disabled')
    await request('POST', `/copy/jobs/${id}/confirm`, confirmation, 0, first.controlToken, 409)
    assert.equal((await request<CopyPermit>('GET', pp(stale.copyId, 'scan'))).allowed, false)
    await cap('copy', 'available')
    const confirmed = await request('POST', `/copy/jobs/${id}/confirm`, confirmation, 0, first.controlToken)
    assert.ok(confirmed.orderId)
    const repeated = await request('POST', `/copy/jobs/${id}/confirm`, confirmation, 0, first.controlToken)
    assert.equal(repeated.orderId, confirmed.orderId, '重复确认再建一张订单')
    assert.equal(await prisma.order.count({ where: { terminalId: tids[0], type: 'copy' } }), 1)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: confirmed.orderId! } })
    assert.equal(order.payStatus, 'paid'); assert.equal(order.paymentSource, 'free'); assert.equal(order.amountCents, 0)
    assert.equal(order.billingPageSource, 'terminal_scan'); assert.equal(order.printTaskId, null)
    assert.equal((await request<CopyPermit>('GET', pp(id, 'print'))).allowed, true)
    await request('GET', pp(id, 'print', 1), undefined, 1, undefined, 404)
    const exp = await create()
    await prisma.copyJob.update({ where: { id: exp.copyId }, data: { expiresAt: new Date(0), state: 'confirmed' } })
    assert.equal((await request<CopyPermit>('GET', pp(exp.copyId, 'print'))).reason, 'COPY_EXPIRED')
    await cap('copy', 'disabled')
    assert.equal((await request<CopyPermit>('GET', pp(id, 'print'))).allowed, false)
    await prisma.copyJob.update({ where: { id }, data: { expiresAt: new Date(0) } })
    await request('POST', rp(id), { generation: 1, eventId: randomUUID(), state: 'handed' })
    await request('POST', rp(id), { generation: 1, eventId: randomUUID(), state: 'failed' })
    assert.equal((await store.find(id)).state, 'handed')
    await request('POST', rp(id), { generation: 2, eventId: randomUUID(), state: 'unconfirmed' }, 0, undefined, 409)
    await cap('copy', 'available')
    pass('确认/许可：唯一0元paid/free订单、重复确认同单、未确认/过期/关能力/跨终端无打印许可')
    pass('打印回报：关能力及过期后可收终态、终态不回退、陈旧代次不覆盖')
    async function scannedJob(patch = {}, pages = 2) {
      const job = await create(patch), v = await request('POST', sp(job.copyId), { generation: 1, pageCount: pages })
      return { ...job, quoteVersion: v.quoteVersion }
    }
    const confirm = (j: View, expected = 200) => request('POST', `/copy/jobs/${j.copyId}/confirm`, { quoteVersion: j.quoteVersion }, 0, j.controlToken, expected)
    const missing = await scannedJob()
    // 非法单价先于「非 0 拒绝」和报价版本核对。超过上限不可报价。
    await setTerminalUserPrintPrices(prisma, tids[0], { print_bw_page: 100001 })
    assert.equal(await confirm(missing, 409), 'COPY_PRICE_INVALID')
    await setTerminalUserPrintPrices(prisma, tids[0], { print_bw_page: 1 })
    assert.equal(await confirm(missing, 409), 'COPY_PAID_NOT_SUPPORTED')
    await setTerminalUserPrintPrices(prisma, tids[0], { print_bw_page: 0 })
    await confirm({ ...missing, quoteVersion: '0'.repeat(64) }, 409)
    const odd = await scannedJob({ copies: 2, duplex: 'duplex_long_edge' }, 3)
    assert.equal(await confirm(odd, 409), 'COPY_ODD_DUPLEX_MULTICOPY_DISABLED')
    process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY'] = 'true'
    await confirm(odd)
    delete process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY']
    assert.equal((await request<CopyPermit>('GET', pp(odd.copyId, 'print'))).allowed, false)
    for (const data of [{ copies: COPY_MAX_COPIES + 1 }, { pageCount: COPY_MAX_PAGES + 1 }]) {
      const broken = await scannedJob()
      await prisma.copyJob.update({ where: { id: broken.copyId }, data })
      await confirm(broken, 413)
    }
    await confirm(await scannedJob({ copies: COPY_MAX_COPIES }, COPY_MAX_PAGES))
    for (const state of ['failed', 'unconfirmed'] as const) {
      const terminal = await scannedJob()
      await confirm(terminal)
      await request('GET', pp(terminal.copyId, 'print'))
      // 派发后取消不承诺停打印，结果仍可回报。
      const afterCancel = await request('POST', `/copy/jobs/${terminal.copyId}/cancel`, { generation: 1 }, 0, terminal.controlToken)
      assert.equal(afterCancel.state, 'dispatching')
      const event = { generation: 1, eventId: randomUUID(), state }
      await request('POST', rp(terminal.copyId), event)
      await request('POST', rp(terminal.copyId), event)
      await request('POST', rp(terminal.copyId), { ...event, eventId: randomUUID(), state: 'handed' })
      assert.equal((await store.find(terminal.copyId)).state, state)
      const order = await prisma.order.findUniqueOrThrow({ where: { id: (await store.find(terminal.copyId)).orderId! } })
      assert.equal(order.taskStatus, state === 'failed' ? 'failed' : 'completed')
    }
    for (const key of ['scan_device', 'color_print', 'duplex_print']) {
      await cap(key, 'testing')
      await request('POST', '/copy/jobs', { ...input, requestKey: randomUUID(), colorMode: 'color', duplex: 'duplex_long_edge' }, 0, undefined, 409)
      await cap(key, 'available')
    }
    pass('确认：非法单价/非零价/旧报价/份数页数越限拒绝；双面多份奇数页默认拒绝及开关；99份20页边界')
    const cancelled = await create()
    for (let i = 0; i < 2; i++) await request('POST', `/copy/jobs/${cancelled.copyId}/cancel`, { generation: 1 }, 0, cancelled.controlToken)
    assert.equal((await request<CopyPermit>('GET', pp(cancelled.copyId, 'scan'))).allowed, false)
    const concurrency = await scannedJob()
    const outcomes = await Promise.all(Array.from({ length: 2 }, () => fetch(`${base}/api/v1/copy/jobs/${concurrency.copyId}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-terminal-id': tids[0],
        'x-terminal-session-token': screenTokens[0], 'x-copy-control': concurrency.controlToken },
      body: JSON.stringify({ quoteVersion: concurrency.quoteVersion }),
    })))
    assert.ok(outcomes.some((r) => r.status === 200))
    for (const res of outcomes) assert.ok([200, 409, 503].includes(res.status), `concurrent ${res.status}: ${await res.text()}`)
    const latest = await store.find(concurrency.copyId)
    assert.ok(latest.orderId)
    const count = await prisma.order.count({ where: { terminalId: tids[0], type: 'copy' } })
    await confirm(concurrency)
    assert.equal(await prisma.order.count({ where: { terminalId: tids[0], type: 'copy' } }), count)
    assert.equal(await prisma.order.count({ where: { terminalId: tids[0], type: 'copy', copyJob: null } }), 0)
    await prisma.order.update({ where: { id: latest.orderId! }, data: { endUserId: userId } })
    assert.equal((await new MemberPrintOrdersService(prisma).list(userId, { pageSize: 20, cursor: null })).total, 0)
    const ids = (await prisma.copyJob.findMany({ where: { terminalId: tids[0] } })).map((j) => j.id)
    const logs = await prisma.auditLog.findMany({ where: { targetType: 'copy_job', targetId: { in: ids } } })
    for (const action of ['copy.create', 'copy.confirm', 'copy.permit', 'copy.scan_result', 'copy.print_result']) assert.ok(logs.some((l) => l.action === action), action)
    assert.ok(logs.every((l) => !l.payloadJson.includes(first.controlToken)))
    assert.equal(readFileSync('../../.github/workflows/ci.yml', 'utf8').split('verify:copy-c1b').length - 1, 2)
    assert.match(readFileSync('src/app.module.ts', 'utf8'), /CopyJobsModule/)
    pass('取消幂等、并发确认无孤单、用户订单隐藏复印、审计无控制令牌、API与双库CI接线')
    console.log('verify-copy-c1b: all passed (HTTP + isolated database; Redis transport fixture)')
  } finally {
    if (oddSetting === undefined) delete process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY']
    else process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY'] = oddSetting
    const ids = (await prisma.copyJob.findMany({ where: { terminalId: { in: tids } } })).map((j) => j.id)
    const orders = (await prisma.order.findMany({ where: { terminalId: { in: tids } } })).map((j) => j.id)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...tids, ...ids, ...orders] } } })
    await prisma.copyJob.deleteMany({ where: { terminalId: { in: tids } } })
    await prisma.order.deleteMany({ where: { terminalId: { in: tids } } })
    await prisma.terminal.deleteMany({ where: { id: { in: tids } } })
    await prisma.organization.delete({ where: { id: orgId } })
    await prisma.endUser.delete({ where: { id: userId } })
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: priceKeys } } })
    for (const row of priorPrices) await prisma.priceConfig.create({ data: row })
    await prisma.platformSetting.deleteMany({ where: { key: KEY_GUEST_PER_ORDER_SIDES } })
    if (priorGuestLimit) await prisma.platformSetting.create({ data: priorGuestLimit })
    if (app) await app.close()
    await prisma.onModuleDestroy()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
