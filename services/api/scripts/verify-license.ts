/**
 * verify:license（下半）—— 授权管理后端的真行为：真库（SQLite 或 PostgreSQL 都行）、真服务、真 HTTP。
 * 状态推导、契约、路由表扫描在 verify-license-state.ts；本文件管：
 *
 *   A. 管理员接口：增改、校验（信用代码 18 位 + 校验位 / 合同编号必填 / 时间带时区 / 宽限 0–30 / 台数 1–10000）、期限不重叠、审计。
 *   B. 授权方式：none 默认不管控；切到 required 且会锁住终端时必须二次确认。
 *   C. 一体机会话：只拦「新会话签发」（换票、续期），错误码 TERMINAL_LICENSE_INACTIVE；已签发会话照常到自然过期；
 *      createBootTicket（Agent 链路）不拦；别的机构、不管控的机构、没绑机构的终端不受影响；续期后立刻恢复。
 *   D. 绑定终端：只管新增绑定——超台数拒绝、解绑 / 退役立即释放、降台数不自动解绑也不拦已绑终端；
 *      授权不可用拒绝；待生效授权可提前装机；预创建终端同口径；并发抢最后一个名额只有一个成功。
 *   E. 合作机构后台：授权不可用时写操作服务端拒绝（ORG_LICENSE_INACTIVE），查看与导出照常；撤回类放行；不管控的机构、管理员不受影响。
 *   F. 机构只读视图：只看得到自己的，不含备注 / 暂停理由 / 工单号 / 信用代码 / 合同编号。
 *   G. 「今天要处理」清单；到期前 30 / 7 / 1 天与宽限期内的告警推送（注入时钟、假 Redis、假 webhook）。
 *   I. 暂停 / 吊销必须带理由，二次状态冲突被挡，吊销不可恢复，全部审计。
 * （kiosk-profile 带 licenseState 的断言在 verify-branding.ts。）
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:license
 */
import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Controller, Delete, Get, Module, Patch, Post, Put, UseGuards } from '@nestjs/common'
import { APP_INTERCEPTOR, NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { Roles } from '../src/common/decorators/roles.decorator'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { RedisService } from '../src/common/redis/redis.service'
import { LicenseAdminController } from '../src/licenses/license.admin.controller'
import { LicensePartnerController } from '../src/licenses/license.partner.controller'
import { LicenseService } from '../src/licenses/license.service'
import { LicenseExpiryAlertService, planLicenseAlerts } from '../src/licenses/license-expiry-alert.service'
import { setLicenseClock } from '../src/licenses/license-clock'
import { DAY_MS } from '../src/licenses/license-state'
import { PartnerLicenseWriteInterceptor } from '../src/licenses/partner-license-write.interceptor'
import { PrismaService } from '../src/prisma/prisma.service'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { Checker, FakeRedis, installGlobals, makeCaller } from './support/branding-license-support'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const c = new Checker()
const T0 = Date.parse('2026-11-01T00:00:00.000Z')
const CREDIT = '91330100799655058B'
let nowMs = T0
const iso = (days: number) => new Date(T0 + days * DAY_MS).toISOString()
const at = (days: number) => {
  nowMs = T0 + days * DAY_MS
}

// 夹具路由：路径与真实机构后台的路由模板一一对应，用来真跑「写操作拦截器」。
@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
class FixturePartnerController {
  @Get('policies') @Roles('partner') list() { return { ok: 'list' } }
  @Get('policies/export.csv') @Roles('partner') exportCsv() { return { ok: 'export' } }
  @Post('policies') @Roles('partner') create() { return { ok: 'create' } }
  @Patch('policies/:id') @Roles('partner') update() { return { ok: 'update' } }
  @Patch('policies/:id/release') @Roles('partner') release() { return { ok: 'release' } }
  @Patch('policies/:id/publish') @Roles('partner') unpublish() { return { ok: 'unpublish' } }
  @Delete('policies/:id') @Roles('partner') remove() { return { ok: 'delete' } }
  @Post('official-channels') @Roles('partner') createChannel() { return { ok: 'create-channel' } }
  @Delete('official-channels/:id') @Roles('partner') archiveChannel() { return { ok: 'archive-channel' } }
  @Put('profile') @Roles('partner') profile() { return { ok: 'profile' } }
  @Post('first-order/incidents') @Roles('partner') incident() { return { ok: 'incident' } }
  @Post('mixed') @Roles('admin', 'partner') mixed() { return { ok: 'mixed' } }
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  process.env['ADMIN_IP_ALLOWLIST'] = ''
  process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] = 'true'
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const redis = new FakeRedis()
  const webhooks: Array<{ url: string; text: string }> = []
  const fakeFetch = (async (url: string, init?: { body?: string }) => {
    webhooks.push({ url: String(url), text: (JSON.parse(init?.body ?? '{}') as { text?: { content?: string } }).text?.content ?? '' })
    return { ok: true, status: 200 } as Response
  }) as unknown as typeof fetch

  @Module({
    imports: [JwtModule.register({ secret: 'license-verify-secret', signOptions: { expiresIn: '2h' } })],
    controllers: [LicenseAdminController, LicensePartnerController, FixturePartnerController],
    providers: [
      LicenseService, AuditService, JwtAuthGuard, RolesGuard, PrismaService, TerminalSessionService,
      PartnerLicenseWriteInterceptor,
      { provide: APP_INTERCEPTOR, useExisting: PartnerLicenseWriteInterceptor },
      { provide: RedisService, useValue: redis },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() { /* 夹具：不校验终端令牌 */ } } },
    ],
  })
  class FixtureModule {}

  setLicenseClock(() => new Date(nowMs))
  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  installGlobals(app)
  await app.listen(0, '127.0.0.1')
  const call = makeCaller(app)
  const prisma = app.get(PrismaService)
  const jwt = app.get(JwtService)
  const sessions = app.get(TerminalSessionService)

  const orgIds: string[] = []
  const terminalIds: string[] = []
  const userIds: string[] = []
  const newOrg = async (key: string, mode: 'none' | 'required' = 'none') => {
    const id = `org_lic_${key}_${suffix}`
    orgIds.push(id)
    await prisma.organization.create({ data: { id, name: `授权门禁机构${key}${suffix}`, type: 'public_employment_service', licenseMode: mode } })
    return id
  }
  const newTerminal = async (key: string, orgId: string | null, extra: Record<string, unknown> = {}) => {
    const id = `t_lic_${key}_${suffix}`
    terminalIds.push(id)
    await prisma.terminal.create({
      data: { id, terminalCode: `LIC-${key}-${suffix}`, agentToken: `tok-${id}`, deviceFingerprint: `fp-${id}`, orgId, orgBoundAt: orgId ? new Date(T0) : null, ...extra },
    })
    return id
  }
  const newUser = async (key: string, role: 'admin' | 'partner', orgId: string | null) => {
    const id = `user_lic_${key}_${suffix}`
    userIds.push(id)
    await prisma.user.create({ data: { id, username: `lic-${key}-${suffix}`, passwordHash: 'not-used', name: `授权门禁${key}`, role, orgId } })
    return jwt.sign({ sub: id, ver: 0 })
  }
  const adminId = `user_lic_admin_${suffix}`
  const adminToken = await newUser('admin', 'admin', null)
  const sessionOf = async (terminalId: string) => {
    const ticket = await sessions.createBootTicket(terminalId, 'Bearer fixture')
    return (await sessions.exchangeBootTicket(ticket.bootTicket)).sessionToken
  }
  const codeOf = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work()
      return 'ok'
    } catch (error) {
      const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
      return `${(error as { getStatus?: () => number }).getStatus?.() ?? '?'}:${response?.error?.code ?? (error as Error).message}`
    }
  }
  const api = (method: string, path: string, body?: unknown, token = adminToken) => call(method, `/api/v1${path}`, { body, token })
  const detail = async (orgId: string) => (await api('GET', `/admin/orgs/${orgId}/licenses`)).json.data
  const createLicense = async (orgId: string, over: Record<string, unknown> = {}) => {
    const r = await api('POST', `/admin/orgs/${orgId}/licenses`, {
      licenseeName: '青岛某某人力资源有限公司', creditCode: CREDIT, contractNo: `HT-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
      startsAt: iso(0), endsAt: iso(30), terminalQuota: 3, ...over,
    })
    return { status: r.status, id: r.json.data?.licenseId as string, org: r.json.data?.org, error: r.json.error?.code as string | undefined }
  }
  const noAudit = async () => undefined

  try {
    // ── A. 管理员接口、校验、期限不重叠、审计 ───────────────────────────────
    console.log('\n[A] 管理员接口')
    const orgA = await newOrg('a')
    const base = await api('GET', `/admin/orgs/${orgA}/licenses`)
    c.check('新机构默认 none：不管控、状态 ok、没有授权', base.status === 200 && base.json.data.licenseMode === 'none' && base.json.data.managed === false &&
      base.json.data.state === 'ok' && base.json.data.items.length === 0)
    const partnerOfA = await newUser('pa', 'partner', orgA)
    for (const [method, path, body] of [
      ['GET', `/admin/orgs/${orgA}/licenses`, undefined], ['POST', `/admin/orgs/${orgA}/licenses`, {}], ['GET', '/admin/licenses/attention', undefined],
      ['PUT', `/admin/orgs/${orgA}/license-mode`, { licenseMode: 'required' }], ['POST', '/admin/licenses/x/suspend', { reason: '十个字的理由说明' }],
    ] as const) {
      c.check(`非管理员 403：${method} ${path}`, (await api(method, path, body, partnerOfA)).status === 403)
    }
    c.check('不带令牌 401', (await call('GET', `/api/v1/admin/orgs/${orgA}/licenses`)).status === 401)
    c.equal('机构不存在 → 404 ORG_NOT_FOUND', (await api('GET', '/admin/orgs/no-such-org/licenses')).json.error?.code, 'ORG_NOT_FOUND')
    const valid = { licenseeName: '青岛某某人力资源有限公司', creditCode: CREDIT, contractNo: 'HT-2026-001', startsAt: iso(0), endsAt: iso(30), terminalQuota: 3 }
    const badCases: Array<[string, Record<string, unknown>, string]> = [
      ['信用代码少一位', { creditCode: '91330100799655058' }, 'LICENSE_CREDIT_CODE_INVALID'],
      ['信用代码校验位不对', { creditCode: '91330100799655058C' }, 'LICENSE_CREDIT_CODE_INVALID'],
      ['信用代码含禁用字母 O', { creditCode: '91330100799655O58B' }, 'LICENSE_CREDIT_CODE_INVALID'],
      ['合同编号为空白', { contractNo: '   ' }, 'LICENSE_CONTRACT_NO_INVALID'],
      ['被授权企业名称太短', { licenseeName: '甲' }, 'LICENSE_LICENSEE_INVALID'],
      ['生效时间不带时区', { startsAt: '2026-11-01T00:00:00' }, 'LICENSE_PERIOD_INVALID'],
      ['到期时间只有日期', { endsAt: '2027-10-29' }, 'LICENSE_PERIOD_INVALID'],
      ['到期不晚于生效', { endsAt: iso(0) }, 'LICENSE_PERIOD_INVALID'],
      ['期限超过 10 年', { endsAt: iso(4000) }, 'LICENSE_PERIOD_INVALID'],
      ['宽限 31 天', { graceDays: 31 }, 'LICENSE_GRACE_INVALID'],
      ['宽限 -1 天', { graceDays: -1 }, 'LICENSE_GRACE_INVALID'],
      ['台数 0', { terminalQuota: 0 }, 'LICENSE_QUOTA_INVALID'],
      ['台数 10001', { terminalQuota: 10001 }, 'LICENSE_QUOTA_INVALID'],
      ['备注超 500 字', { note: '备'.repeat(501) }, 'LICENSE_NOTE_INVALID'],
    ]
    for (const [label, over, code] of badCases) {
      const r = await api('POST', `/admin/orgs/${orgA}/licenses`, { ...valid, ...over })
      c.equal(`新建被拒：${label}`, `${r.status}:${r.json.error?.code}`, `400:${code}`)
    }
    for (const [label, body] of [['缺合同编号字段', { ...valid, contractNo: undefined }], ['多余字段（岗位数）', { ...valid, jobCount: 10 }], ['台数是字符串', { ...valid, terminalQuota: '3' }]] as const) {
      const r = await api('POST', `/admin/orgs/${orgA}/licenses`, body)
      c.equal(`新建被拒：${label}`, `${r.status}:${r.json.error?.code}`, '400:VALIDATION_FAILED')
    }
    c.equal('机构不存在时新建 → 404', (await api('POST', '/admin/orgs/no-such-org/licenses', valid)).status, 404)
    c.check('被拒的新建没有写库', (await detail(orgA)).items.length === 0)

    at(1)
    const created = await api('POST', `/admin/orgs/${orgA}/licenses`, { ...valid, creditCode: ' 91330100799655058b ', note: ' 首期合同 ' })
    const lic1 = created.json.data?.org?.items?.[0]
    c.check('新建 → 201，返回被改动的编号 + 刷新后的整节', created.status === 201 && created.json.data.licenseId === lic1?.id && created.json.data.org.orgId === orgA)
    c.check('信用代码转大写、备注去空白、宽限默认 7 天、状态 active、阶段 active', lic1.creditCode === CREDIT && lic1.note === '首期合同' && lic1.graceDays === 7 && lic1.status === 'active' && lic1.phase === 'active')
    c.check('graceEndsAt = 到期 + 7 天', lic1.graceEndsAt === iso(37))
    c.check('createdBy 记操作者', lic1.createdBy === adminId)
    c.check('新建写审计 license.create（含授权快照与机构状态前后）', await (async () => {
      const row = await prisma.auditLog.findFirst({ where: { action: 'license.create', targetId: lic1.id } })
      const payload = row ? (JSON.parse(row.payloadJson) as { license: { contractNo: string }; orgState: { before: unknown; after: unknown } }) : null
      return !!row && row.actorId === adminId && payload?.license.contractNo === 'HT-2026-001' && !!payload.orgState
    })())
    const overlap = await createLicense(orgA, { startsAt: iso(10), endsAt: iso(40) })
    c.equal('期限重叠 → 409 LICENSE_PERIOD_OVERLAP', `${overlap.status}:${overlap.error}`, '409:LICENSE_PERIOD_OVERLAP')
    const adjacent = await createLicense(orgA, { startsAt: iso(30), endsAt: iso(60), contractNo: 'HT-2026-002' })
    c.check('首尾相接可以新建（提前录入未来生效的）', adjacent.status === 201 && adjacent.org.items.find((i: { id: string }) => i.id === adjacent.id).phase === 'pending')
    const orgAfter = await detail(orgA)
    c.check('历史新的在前、认定当前那条、待生效的是 upcoming', orgAfter.items[0].id === adjacent.id && orgAfter.upcoming?.id === adjacent.id && orgAfter.current?.id === lic1.id)
    c.check('授权方式仍是 none：不管控，状态 ok，不影响任何终端', orgAfter.licenseMode === 'none' && orgAfter.managed === false && orgAfter.usable === true)

    // ── I. 状态变更：理由、冲突、吊销不可恢复、审计 ──────────────────────────
    console.log('\n[I] 暂停 / 恢复 / 吊销 / 改 / 续期')
    const noReason = await api('POST', `/admin/licenses/${adjacent.id}/suspend`, {})
    c.equal('暂停不带理由字段 → 400', noReason.status, 400)
    const shortReason = await api('POST', `/admin/licenses/${adjacent.id}/suspend`, { reason: '太短了' })
    c.equal('理由少于 8 个字 → 400 LICENSE_REASON_INVALID', `${shortReason.status}:${shortReason.json.error?.code}`, '400:LICENSE_REASON_INVALID')
    c.equal('工单号超长 → 400', (await api('POST', `/admin/licenses/${adjacent.id}/suspend`, { reason: '欠费暂停，工单已建立', ticketNo: 'T'.repeat(65) })).json.error?.code, 'LICENSE_TICKET_INVALID')
    const suspended = await api('POST', `/admin/licenses/${adjacent.id}/suspend`, { reason: '欠费未续，商务确认暂停', ticketNo: 'WO-20261101-7' })
    const sRow = suspended.json.data.org.items.find((i: { id: string }) => i.id === adjacent.id)
    c.check('暂停 → 200、status suspended、记理由与工单号与经办人', suspended.status === 200 && sRow.status === 'suspended' && sRow.statusReason === '欠费未续，商务确认暂停' && sRow.statusTicketNo === 'WO-20261101-7' && sRow.statusChangedBy === adminId)
    const sAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.suspend', targetId: adjacent.id } })
    const sPayload = JSON.parse(sAudit.payloadJson) as { reason: string; ticketNo: string; before: { status: string }; after: { status: string }; orgState: { before: { state: string }; after: { state: string } } }
    c.check('暂停审计：理由、工单号、改前改后状态、机构状态快照', sAudit.actorId === adminId && sPayload.reason === '欠费未续，商务确认暂停' && sPayload.ticketNo === 'WO-20261101-7' &&
      sPayload.before.status === 'active' && sPayload.after.status === 'suspended' && !!sPayload.orgState.before && !!sPayload.orgState.after)
    c.equal('重复暂停 → 409 LICENSE_STATUS_CONFLICT', (await api('POST', `/admin/licenses/${adjacent.id}/suspend`, { reason: '再暂停一次试试看' })).json.error?.code, 'LICENSE_STATUS_CONFLICT')
    c.equal('对生效中的授权恢复 → 409', (await api('POST', `/admin/licenses/${lic1.id}/resume`, {})).json.error?.code, 'LICENSE_STATUS_CONFLICT')
    const resumed = await api('POST', `/admin/licenses/${adjacent.id}/resume`, { reason: '已补缴，恢复' })
    const rRow = resumed.json.data.org.items.find((i: { id: string }) => i.id === adjacent.id)
    c.check('恢复 → active，当前理由与工单号清空（历史在审计里）', resumed.status === 200 && rRow.status === 'active' && rRow.statusReason === null && rRow.statusTicketNo === null)
    c.check('恢复写审计 license.resume', (await prisma.auditLog.count({ where: { action: 'license.resume', targetId: adjacent.id } })) === 1)
    // 更正 / 改期 / 改台数
    const noChange = await api('PATCH', `/admin/licenses/${lic1.id}`, { terminalQuota: 3, contractNo: 'HT-2026-001' })
    c.check('PATCH 一个字没变 → 不写审计', noChange.status === 200 && (await prisma.auditLog.count({ where: { action: 'license.update', targetId: lic1.id } })) === 0)
    const updated = await api('PATCH', `/admin/licenses/${lic1.id}`, { terminalQuota: 5, note: '补充协议：加 2 台', graceDays: 10 })
    c.check('PATCH 改台数 / 宽限 / 备注 → 生效', updated.status === 200 && updated.json.data.org.current.terminalQuota === 5 && updated.json.data.org.current.graceDays === 10)
    const uAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.update', targetId: lic1.id } })
    const uPayload = JSON.parse(uAudit.payloadJson) as { before: Record<string, unknown>; after: Record<string, unknown> }
    c.check('更新审计只记真正变了的字段，改前改后齐全', uPayload.before['terminalQuota'] === 3 && uPayload.after['terminalQuota'] === 5 && uPayload.before['graceDays'] === 7 && !('contractNo' in uPayload.after))
    c.equal('PATCH 改成与后续授权重叠 → 409', (await api('PATCH', `/admin/licenses/${lic1.id}`, { endsAt: iso(45) })).json.error?.code, 'LICENSE_PERIOD_OVERLAP')
    c.equal('PATCH 非法信用代码 → 400', (await api('PATCH', `/admin/licenses/${lic1.id}`, { creditCode: '123' })).json.error?.code, 'LICENSE_CREDIT_CODE_INVALID')
    c.equal('不存在的授权 → 404', (await api('GET', '/admin/licenses/no-such-license')).json.error?.code, 'LICENSE_NOT_FOUND')
    c.equal('GET 单条授权', (await api('GET', `/admin/licenses/${lic1.id}`)).json.data.id, lic1.id)
    // 续期 = 新建首尾相接的后续授权
    const renewBase = await createLicense(await newOrg('renew'), { startsAt: iso(0), endsAt: iso(30), terminalQuota: 4, graceDays: 3 })
    const renewed = await api('POST', `/admin/licenses/${renewBase.id}/renew`, { endsAt: iso(60), contractNo: 'HT-2026-R2' })
    const succ = renewed.json.data.org.items.find((i: { id: string }) => i.id === renewed.json.data.licenseId)
    c.check('续期：新建一条，起点 = 原到期时刻，台数 / 宽限 / 企业 / 信用代码沿用，合同编号用新的', renewed.status === 201 && succ.startsAt === iso(30) && succ.terminalQuota === 4 && succ.graceDays === 3 &&
      succ.creditCode === CREDIT && succ.licenseeName === '青岛某某人力资源有限公司' && succ.contractNo === 'HT-2026-R2')
    c.equal('续期后旧的不动、历史两条', renewed.json.data.org.items.length, 2)
    c.equal('续期不带合同编号 → 400', (await api('POST', `/admin/licenses/${renewBase.id}/renew`, { endsAt: iso(90) })).status, 400)
    c.equal('续期与已有后续授权重叠 → 409', (await api('POST', `/admin/licenses/${renewBase.id}/renew`, { endsAt: iso(90), contractNo: 'HT-2026-R3' })).json.error?.code, 'LICENSE_PERIOD_OVERLAP')
    c.check('续期写审计 license.renew（含前任编号）', JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.renew', targetId: renewed.json.data.licenseId } })).payloadJson).predecessorId === renewBase.id)
    // 吊销
    const forRevoke = await createLicense(await newOrg('revoke'), {})
    const revoked = await api('POST', `/admin/licenses/${forRevoke.id}/revoke`, { reason: '合同解除，书面通知已送达', ticketNo: 'WO-9' })
    c.check('吊销 → revoked', revoked.status === 200 && revoked.json.data.org.items[0].status === 'revoked' && revoked.json.data.org.items[0].phase === 'revoked')
    c.equal('吊销不带理由 → 400', (await api('POST', `/admin/licenses/${(await createLicense(await newOrg('revoke2'), {})).id}/revoke`, { reason: '' })).status, 400)
    for (const [label, path, body, method] of [
      ['再吊销', `/admin/licenses/${forRevoke.id}/revoke`, { reason: '再来一次吊销试试' }, 'POST'], ['恢复', `/admin/licenses/${forRevoke.id}/resume`, {}, 'POST'],
      ['暂停', `/admin/licenses/${forRevoke.id}/suspend`, { reason: '对吊销的暂停试试' }, 'POST'], ['修改', `/admin/licenses/${forRevoke.id}`, { terminalQuota: 9 }, 'PATCH'],
      ['续期', `/admin/licenses/${forRevoke.id}/renew`, { endsAt: iso(90), contractNo: 'X' }, 'POST'],
    ] as const) {
      c.equal(`吊销不可恢复：${label} → 409 LICENSE_REVOKED`, (await api(method, path, body)).json.error?.code, 'LICENSE_REVOKED')
    }
    c.check('吊销写审计（理由、工单号）', JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.revoke', targetId: forRevoke.id } })).payloadJson).ticketNo === 'WO-9')
    const afterRevokeOverlap = await createLicense(forRevoke.org.orgId, { startsAt: iso(0), endsAt: iso(30) })
    c.check('吊销的授权不再占用期限（同一时段可重新录入）', afterRevokeOverlap.status === 201)

    // ── B. 授权方式 ─────────────────────────────────────────────────────────
    console.log('\n[B] 授权方式')
    const orgB = await newOrg('b')
    await newTerminal('b1', orgB)
    const lock = await api('PUT', `/admin/orgs/${orgB}/license-mode`, { licenseMode: 'required' })
    c.check('没有授权的机构有终端，切 required → 409 LICENSE_MODE_WOULD_LOCK_TERMINALS，文案写明受影响的终端数',
      lock.status === 409 && lock.json.error?.code === 'LICENSE_MODE_WOULD_LOCK_TERMINALS' && /名下 1 台终端/.test(lock.json.error?.message ?? ''), JSON.stringify(lock.json))
    c.check('被拒时没有切换', (await detail(orgB)).licenseMode === 'none')
    const forced = await api('PUT', `/admin/orgs/${orgB}/license-mode`, { licenseMode: 'required', confirmLockout: true, reason: '合同到期未续，确认停用' })
    c.check('带 confirmLockout 才切换，状态 unlicensed、不可用', forced.status === 200 && forced.json.data.licenseMode === 'required' && forced.json.data.state === 'unlicensed' && forced.json.data.usable === false)
    const mAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.mode_update', targetId: orgB }, orderBy: { createdAt: 'desc' } })).payloadJson)
    c.check('切换写审计：改前改后、是否二次确认、受影响终端数', mAudit.before === 'none' && mAudit.after === 'required' && mAudit.confirmLockout === true && mAudit.lockout === true && mAudit.terminalCount === 1)
    await api('PUT', `/admin/orgs/${orgB}/license-mode`, { licenseMode: 'required' })
    c.equal('同一模式再切 → 不写审计', await prisma.auditLog.count({ where: { action: 'license.mode_update', targetId: orgB } }), 1)
    c.equal('非法授权方式 → 400', (await api('PUT', `/admin/orgs/${orgB}/license-mode`, { licenseMode: 'free' })).status, 400)
    const orgEmpty = await newOrg('empty')
    c.check('没有终端的机构切 required 不需要二次确认', (await api('PUT', `/admin/orgs/${orgEmpty}/license-mode`, { licenseMode: 'required' })).status === 200)
    const lockedButLicensed = await newOrg('licensedlock')
    await newTerminal('ll1', lockedButLicensed)
    await createLicense(lockedButLicensed, {})
    c.check('已有可用授权的机构切 required 不需要二次确认', (await api('PUT', `/admin/orgs/${lockedButLicensed}/license-mode`, { licenseMode: 'required' })).status === 200)
    c.check('切回 none → 不管控', (await api('PUT', `/admin/orgs/${orgB}/license-mode`, { licenseMode: 'none' })).json.data.managed === false)

    // ── C. 一体机会话签发 ───────────────────────────────────────────────────
    console.log('\n[C] 一体机会话：只拦新签发')
    at(0.5)
    const orgS = await newOrg('s', 'required')
    const orgOther = await newOrg('other', 'required')
    const orgNone = await newOrg('none', 'none')
    const tS = await newTerminal('s1', orgS)
    const tOther = await newTerminal('o1', orgOther)
    const tNoneOrg = await newTerminal('n1', orgNone)
    const tFree = await newTerminal('f1', null)
    const licS = await createLicense(orgS, { startsAt: iso(0), endsAt: iso(30), graceDays: 7, terminalQuota: 5 })
    await createLicense(orgOther, { startsAt: iso(0), endsAt: iso(300), terminalQuota: 5 })
    await createLicense(orgNone, { startsAt: iso(-400), endsAt: iso(-300), terminalQuota: 5 })
    const oldSession = await sessionOf(tS)
    c.check('在期内：换票 / 续期都通过', (await codeOf(() => sessions.refresh(tS, oldSession))) === 'ok')
    at(31)
    c.equal('宽限期内：照常换票', await codeOf(() => sessionOf(tS)), 'ok')
    at(38)
    const boot = await codeOf(() => sessions.createBootTicket(tS, 'Bearer fixture'))
    c.equal('过了宽限：createBootTicket（Agent 链路）不拦', boot, 'ok')
    const ticket = await sessions.createBootTicket(tS, 'Bearer fixture')
    c.equal('过了宽限：换票被拒 403 TERMINAL_LICENSE_INACTIVE', await codeOf(() => sessions.exchangeBootTicket(ticket.bootTicket)), '403:TERMINAL_LICENSE_INACTIVE')
    c.equal('过了宽限：续期被拒 403 TERMINAL_LICENSE_INACTIVE', await codeOf(() => sessions.refresh(tS, oldSession)), '403:TERMINAL_LICENSE_INACTIVE')
    c.equal('已签发的在办会话照常用到自然过期（validate 不看授权）', await codeOf(() => sessions.validate(tS, oldSession)), 'ok')
    const refusal = await sessions.exchangeBootTicket((await sessions.createBootTicket(tS, 'Bearer fixture')).bootTicket).catch((e: { getResponse: () => { error: { message: string } } }) => e.getResponse().error.message)
    c.check('拒绝文案不写「授权」「到期」，不暴露商务信息', typeof refusal === 'string' && !/授权|到期|合同|续费|欠费/.test(refusal), String(refusal))
    c.equal('别的机构的终端不受影响', await codeOf(() => sessionOf(tOther)), 'ok')
    c.equal('不管控的机构（授权早过期）不受影响', await codeOf(() => sessionOf(tNoneOrg)), 'ok')
    c.equal('没绑机构的终端不受影响', await codeOf(() => sessionOf(tFree)), 'ok')
    // 续期后恢复
    const renewedS = await api('POST', `/admin/licenses/${licS.id}/renew`, { endsAt: iso(90), contractNo: 'HT-S-2' })
    c.check('续期（新授权从原到期时刻起，覆盖当前）后立刻恢复', renewedS.status === 201 && (await codeOf(() => sessionOf(tS))) === 'ok')
    const newLicenseId = renewedS.json.data.licenseId as string
    const suspendedS = await api('POST', `/admin/licenses/${newLicenseId}/suspend`, { reason: '欠费暂停，等待补缴' })
    c.equal('暂停 → 换票被拒', `${suspendedS.status}:${await codeOf(() => sessionOf(tS))}`, '200:403:TERMINAL_LICENSE_INACTIVE')
    c.equal('暂停时已签发的会话仍可校验', await codeOf(() => sessions.validate(tS, oldSession)), 'ok')
    await api('POST', `/admin/licenses/${newLicenseId}/resume`, {})
    c.equal('恢复 → 换票恢复', await codeOf(() => sessionOf(tS)), 'ok')
    await api('POST', `/admin/licenses/${newLicenseId}/revoke`, { reason: '合同解除，立即停用' })
    c.equal('吊销 → 换票被拒（旧授权已过宽限）', await codeOf(() => sessionOf(tS)), '403:TERMINAL_LICENSE_INACTIVE')
    const orgU = await newOrg('u', 'required')
    const tU = await newTerminal('u1', orgU)
    c.equal('required 但一条授权都没有 → 换票被拒', await codeOf(() => sessionOf(tU)), '403:TERMINAL_LICENSE_INACTIVE')
    await api('PUT', `/admin/orgs/${orgS}/license-mode`, { licenseMode: 'none' })
    c.equal('改回 none → 换票恢复', await codeOf(() => sessionOf(tS)), 'ok')

    // ── D. 绑定终端：只管新增绑定 ───────────────────────────────────────────
    console.log('\n[D] 绑定终端台数')
    at(1)
    const orgQ = await newOrg('q', 'required')
    const q = await Promise.all(['q1', 'q2', 'q3', 'q4', 'q5'].map((k) => newTerminal(k, null)))
    const licQ = await createLicense(orgQ, { startsAt: iso(0), endsAt: iso(30), terminalQuota: 2 })
    const bind = (terminalId: string, orgId: string | null) => codeOf(() => assignTerminalOrganization(prisma, terminalId, orgId, undefined, noAudit))
    c.equal('第 1 台绑定通过', await bind(q[0]!, orgQ), 'ok')
    c.equal('第 2 台绑定通过', await bind(q[1]!, orgQ), 'ok')
    const third = await assignTerminalOrganization(prisma, q[2]!, orgQ, undefined, noAudit).catch((e: { getStatus: () => number; getResponse: () => { error: { code: string; message: string; details: unknown } } }) => e)
    c.check('第 3 台超台数 → 409 LICENSE_TERMINAL_QUOTA_EXCEEDED，说明已用 / 上限', 'getResponse' in third && third.getStatus() === 409 &&
      third.getResponse().error.code === 'LICENSE_TERMINAL_QUOTA_EXCEEDED' && /已绑定 2 台，授权上限 2 台/.test(third.getResponse().error.message))
    c.check('被拒的绑定没有改库', (await prisma.terminal.findUniqueOrThrow({ where: { id: q[2]! } })).orgId === null)
    c.equal('已绑定的再绑同一机构不算新增', await bind(q[0]!, orgQ), 'ok')
    c.equal('解绑不受限', await bind(q[0]!, null), 'ok')
    c.equal('解绑立即释放名额：第 3 台现在能绑', await bind(q[2]!, orgQ), 'ok')
    // 退役要满足库里的退役不变量（enabled=false、凭证哨兵、凭证代与生命周期版本各 +1），和真实退役流程一致。
    const retiring = await prisma.terminal.findUniqueOrThrow({ where: { id: q[1]! } })
    await prisma.terminal.update({
      where: { id: q[1]! },
      data: {
        lifecycleStatus: 'retired', enabled: false, agentToken: `cred$retired$${suffix}${suffix}`,
        credentialGeneration: retiring.credentialGeneration + 1, lifecycleVersion: retiring.lifecycleVersion + 1,
      },
    })
    c.equal('退役立即释放名额：第 4 台能绑', await bind(q[3]!, orgQ), 'ok')
    c.check('此时已绑 3 台（含 1 台退役），非退役 2 台', (await detail(orgQ)).terminalsBound === 2)
    const cut = await api('PATCH', `/admin/licenses/${licQ.id}`, { terminalQuota: 1 })
    c.check('降低台数：不自动解绑，只提示超额', cut.status === 200 && cut.json.data.org.overQuota === true && (await detail(orgQ)).terminalsBound === 2)
    c.equal('降台数后运行期不拦已绑终端：两台照常换票', `${await codeOf(() => sessionOf(q[2]!))}/${await codeOf(() => sessionOf(q[3]!))}`, 'ok/ok')
    c.equal('降台数后新增绑定被拒', await bind(q[4]!, orgQ), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    await bind(q[3]!, null)
    c.equal('仍占满（1/1）时新增被拒', await bind(q[4]!, orgQ), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    await bind(q[2]!, null)
    c.equal('换机：先解绑旧机，新机立刻能绑', await bind(q[4]!, orgQ), 'ok')
    at(31)
    c.equal('宽限期内新增绑定仍按台数放行（已满 1/1 → 拒）', await bind(q[2]!, orgQ), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    await api('PATCH', `/admin/licenses/${licQ.id}`, { terminalQuota: 3 })
    c.equal('宽限期内台数有余量 → 通过', await bind(q[2]!, orgQ), 'ok')
    at(38)
    c.equal('过期后新增绑定 → 409 LICENSE_NOT_AVAILABLE_FOR_BINDING', await bind(q[3]!, orgQ), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    c.equal('过期后解绑照常', await bind(q[3]!, null), 'ok')
    at(1)
    await api('POST', `/admin/licenses/${licQ.id}/suspend`, { reason: '暂停期间不许再装机' })
    c.equal('暂停 → 新增绑定被拒', await bind(q[3]!, orgQ), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    // 提前装机：只有待生效的授权
    const orgR = await newOrg('r', 'required')
    const r = await Promise.all(['r1', 'r2'].map((k) => newTerminal(k, null)))
    await createLicense(orgR, { startsAt: iso(10), endsAt: iso(40), terminalQuota: 1 })
    c.equal('只有待生效授权：按它的台数提前装机（第 1 台）', await bind(r[0]!, orgR), 'ok')
    c.equal('提前装机超台数被拒（第 2 台）', await bind(r[1]!, orgR), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    c.equal('提前装的终端此时不能开新会话（授权还没生效）', await codeOf(() => sessionOf(r[0]!)), '403:TERMINAL_LICENSE_INACTIVE')
    at(11)
    c.equal('授权生效后这台就能用', await codeOf(() => sessionOf(r[0]!)), 'ok')
    at(1)
    const orgBare = await newOrg('bare', 'required')
    const bare = await newTerminal('bare1', null)
    c.equal('required 但没有任何授权 → 新增绑定被拒', await bind(bare, orgBare), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    const orgFree = await newOrg('free', 'none')
    const free = await Promise.all(['fr1', 'fr2', 'fr3', 'fr4', 'fr5', 'fr6'].map((k) => newTerminal(k, null)))
    const freeResults: string[] = []
    for (const id of free) freeResults.push(await bind(id, orgFree))
    c.check('不管控的机构不限台数（绑 6 台全过）', freeResults.every((x) => x === 'ok'))
    // 预创建终端同口径
    const planned = new TerminalAdminService(prisma, null as never, null as never, null as never)
    const orgPlan = await newOrg('plan', 'required')
    await createLicense(orgPlan, { startsAt: iso(0), endsAt: iso(30), terminalQuota: 1 })
    const code1 = `LICP-${suffix}-1`
    const code2 = `LICP-${suffix}-2`
    const p1 = await planned.createPlannedTerminal({ terminalCode: code1, orgId: orgPlan })
    terminalIds.push(p1.terminalId)
    c.equal('预创建终端（绑机构）第 1 台通过', p1.orgId, orgPlan)
    c.equal('预创建终端第 2 台超台数 → 409', await codeOf(() => planned.createPlannedTerminal({ terminalCode: code2, orgId: orgPlan })), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    c.check('被拒的预创建没有留下终端', (await prisma.terminal.count({ where: { terminalCode: code2 } })) === 0)
    const p3 = await planned.createPlannedTerminal({ terminalCode: `LICP-${suffix}-3` })
    terminalIds.push(p3.terminalId)
    c.check('预创建不绑机构不受限', p3.orgId === null)
    // 并发：抢最后一个名额
    const orgK = await newOrg('k', 'required')
    await createLicense(orgK, { startsAt: iso(0), endsAt: iso(30), terminalQuota: 1 })
    const kt = await Promise.all(['k1', 'k2', 'k3'].map((k) => newTerminal(k, null)))
    const raced = await Promise.all(kt.map((id) => bind(id, orgK)))
    c.check('三台并发抢 1 个名额：恰好一台成功，其余被拒', raced.filter((x) => x === 'ok').length === 1 && raced.filter((x) => x !== 'ok').length === 2, raced.join(' | '))
    c.check('三台并发抢 1 个名额：库里绑定数恰好等于上限', (await prisma.terminal.count({ where: { orgId: orgK, lifecycleStatus: { not: 'retired' } } })) === 1)

    // ── E. 合作机构后台写操作 ───────────────────────────────────────────────
    console.log('\n[E] 合作机构后台写操作')
    at(1)
    const orgE1 = await newOrg('e1', 'required')
    const orgE2 = await newOrg('e2', 'required')
    const orgE3 = await newOrg('e3', 'none')
    const licE1 = await createLicense(orgE1, { startsAt: iso(0), endsAt: iso(30) })
    await createLicense(orgE2, { startsAt: iso(-90), endsAt: iso(-60) })
    const tokenE1 = await newUser('e1', 'partner', orgE1)
    const tokenE2 = await newUser('e2', 'partner', orgE2)
    const tokenE3 = await newUser('e3', 'partner', orgE3)
    const routes: Array<[string, string, boolean]> = [
      ['POST', '/partner/policies', true], ['PATCH', '/partner/policies/p1', true], ['PATCH', '/partner/policies/p1/release', true],
      ['POST', '/partner/official-channels', true], ['PATCH', '/partner/policies/p1/publish', false], ['DELETE', '/partner/policies/p1', false],
      ['DELETE', '/partner/official-channels/c1', false], ['PUT', '/partner/profile', false], ['POST', '/partner/first-order/incidents', false],
      ['GET', '/partner/policies', false], ['GET', '/partner/policies/export.csv', false],
    ]
    const statusOf = async (method: string, path: string, token: string) => {
      const r = await call(method, `/api/v1${path}`, { token, body: method === 'GET' || method === 'DELETE' ? undefined : {} })
      return `${r.status}${r.json.error?.code ? ':' + r.json.error.code : ''}`
    }
    for (const [method, path, blocked] of routes) {
      c.equal(`授权已过期的机构：${method} ${path} ${blocked ? '被拒' : '放行'}`, await statusOf(method, path, tokenE2), blocked ? '403:ORG_LICENSE_INACTIVE' : (method === 'POST' ? '201' : '200'))
    }
    for (const [method, path] of routes) {
      c.check(`授权在期内：${method} ${path} 放行`, ['200', '201'].includes(await statusOf(method, path, tokenE1)))
    }
    for (const [method, path] of routes) {
      c.check(`不管控的机构：${method} ${path} 放行`, ['200', '201'].includes(await statusOf(method, path, tokenE3)))
    }
    at(33)
    c.check('宽限期内照常写（grace 照常服务）', (await statusOf('POST', '/partner/policies', tokenE1)) === '201')
    await api('POST', `/admin/licenses/${licE1.id}/suspend`, { reason: '欠费暂停，写操作冻结' })
    c.equal('暂停 → 写被拒', await statusOf('POST', '/partner/policies', tokenE1), '403:ORG_LICENSE_INACTIVE')
    c.equal('暂停 → 查看与导出照常', `${await statusOf('GET', '/partner/policies', tokenE1)}/${await statusOf('GET', '/partner/policies/export.csv', tokenE1)}`, '200/200')
    c.equal('暂停 → 撤回自己的内容（下架）照常', await statusOf('PATCH', '/partner/policies/p1/publish', tokenE1), '200')
    await api('POST', `/admin/licenses/${licE1.id}/resume`, {})
    c.equal('恢复 → 写操作恢复', await statusOf('POST', '/partner/policies', tokenE1), '201')
    const mixedAdmin = await call('POST', '/api/v1/partner/mixed', { token: adminToken, body: {} })
    c.check('管理员走同一路径不受拦截器影响', mixedAdmin.status === 201)
    c.equal('未登录仍是 401（拦截器在鉴权之后）', (await call('POST', '/api/v1/partner/policies', { body: {} })).status, 401)
    const msg = (await call('POST', '/api/v1/partner/policies', { token: tokenE2, body: {} })).json.error?.message ?? ''
    c.check('拒绝文案告诉机构：写被拒、查看导出不受影响、联系平台', /授权/.test(msg) && /查看与导出不受影响/.test(msg))

    // ── F. 机构只读视图 ─────────────────────────────────────────────────────
    console.log('\n[F] 机构只看得到自己的授权')
    at(1)
    const viewE1 = await call('GET', '/api/v1/partner/license', { token: tokenE1 })
    const viewE2 = await call('GET', '/api/v1/partner/license', { token: tokenE2 })
    const viewE3 = await call('GET', '/api/v1/partner/license', { token: tokenE3 })
    c.check('机构拿到自己的授权：状态、期限、台数、宽限', viewE1.status === 200 && viewE1.json.data.state === 'ok' && viewE1.json.data.current.terminalQuota === 3 && viewE1.json.data.current.licenseeName === '青岛某某人力资源有限公司')
    c.equal('另一个机构（已过期）看到自己的状态', viewE2.json.data.state, 'expired')
    c.check('不管控的机构：managed=false', viewE3.json.data.managed === false && viewE3.json.data.licenseMode === 'none')
    const leak = JSON.stringify([viewE1.json.data, viewE2.json.data, viewE3.json.data])
    c.check('机构视图不含信用代码 / 合同编号 / 备注 / 暂停理由 / 工单号 / 经办人 / 授权编号', !/creditCode|contractNo|note|statusReason|statusTicketNo|createdBy|statusChangedBy|"id"/.test(leak) && !leak.includes(CREDIT))
    c.check('机构接口不接受机构参数：一个机构读不到另一个机构', viewE2.json.data.current.licenseeName !== undefined && JSON.stringify(viewE2.json.data) !== JSON.stringify(viewE1.json.data))
    c.equal('管理员访问机构只读接口 → 403', (await call('GET', '/api/v1/partner/license', { token: adminToken })).status, 403)

    // ── G. 今天要处理 + 告警 ────────────────────────────────────────────────
    console.log('\n[G] 「今天要处理」与到期告警')
    at(100)
    const attn = {
      soon: await newOrg('g_soon', 'required'), grace: await newOrg('g_grace', 'required'), expired: await newOrg('g_exp', 'required'),
      susp: await newOrg('g_susp', 'required'), bare: await newOrg('g_bare', 'required'), far: await newOrg('g_far', 'required'),
      none: await newOrg('g_none', 'none'), chain: await newOrg('g_chain', 'required'),
    }
    await createLicense(attn.soon, { startsAt: iso(70), endsAt: iso(110) })
    await createLicense(attn.grace, { startsAt: iso(70), endsAt: iso(98), graceDays: 7 })
    await createLicense(attn.expired, { startsAt: iso(0), endsAt: iso(50), graceDays: 7 })
    const sus = await createLicense(attn.susp, { startsAt: iso(70), endsAt: iso(300) })
    await api('POST', `/admin/licenses/${sus.id}/suspend`, { reason: '欠费暂停，进入处理清单' })
    await createLicense(attn.far, { startsAt: iso(70), endsAt: iso(400) })
    await createLicense(attn.none, { startsAt: iso(0), endsAt: iso(10) })
    await createLicense(attn.chain, { startsAt: iso(70), endsAt: iso(110), contractNo: 'HT-CH-1' })
    await createLicense(attn.chain, { startsAt: iso(110), endsAt: iso(300), contractNo: 'HT-CH-2' })
    const attention = (await api('GET', '/admin/licenses/attention')).json.data
    const mine = (list: Array<{ orgId: string }>) => list.map((o) => o.orgId).filter((id) => Object.values(attn).includes(id)).sort()
    c.equal('30 天内到期', mine(attention.expiringSoon), [attn.soon])
    c.equal('宽限中', mine(attention.grace), [attn.grace])
    c.equal('已停用（过期 / 暂停 / 没有授权）', mine(attention.inactive), [attn.expired, attn.susp, attn.bare].sort())
    c.check('远期的、不管控的、已录入首尾相接续期的都不在清单里', ![attn.far, attn.none, attn.chain].some((id) => [...attention.expiringSoon, ...attention.grace, ...attention.inactive].some((o: { orgId: string }) => o.orgId === id)))
    c.check('counts 与清单一致', attention.counts.expiringSoon === attention.expiringSoon.length && attention.counts.grace === attention.grace.length && attention.counts.inactive === attention.inactive.length)

    // 告警：注入时钟 + 假 Redis + 假 webhook
    process.env['ALERT_WEBHOOK_URL'] = 'http://alert.invalid/hook'
    const alertService = new LicenseExpiryAlertService(prisma, redis as unknown as RedisService, fakeFetch)
    const alertOrg = await newOrg('al', 'required')
    const alertName = `授权门禁机构al${suffix}`
    const chainOrg = await newOrg('alc', 'required')
    const noneOrg = await newOrg('aln', 'none')
    const revokedOrg = await newOrg('alr', 'required')
    const suspOrg = await newOrg('als', 'required')
    at(200)
    await createLicense(alertOrg, { startsAt: iso(200), endsAt: iso(300), contractNo: 'HT-SECRET-AL', graceDays: 7 })
    await createLicense(chainOrg, { startsAt: iso(200), endsAt: iso(230), contractNo: 'HT-SECRET-C1' })
    await createLicense(chainOrg, { startsAt: iso(230), endsAt: iso(300), contractNo: 'HT-SECRET-C2' })
    await createLicense(noneOrg, { startsAt: iso(200), endsAt: iso(201) })
    const rv = await createLicense(revokedOrg, { startsAt: iso(200), endsAt: iso(201) })
    await api('POST', `/admin/licenses/${rv.id}/revoke`, { reason: '合同解除，不再提醒' })
    const sv = await createLicense(suspOrg, { startsAt: iso(200), endsAt: iso(201) })
    await api('POST', `/admin/licenses/${sv.id}/suspend`, { reason: '已暂停，不再重复提醒' })
    const run = async (days: number) => {
      at(days)
      const before = webhooks.length
      const planned = await alertService.checkNow(new Date(nowMs))
      return {
        planned: planned.filter((a) => a.subjectKey === `license_expiry:${alertOrg}`),
        plannedAll: planned,
        sent: webhooks.slice(before).filter((w) => w.text.includes(alertName)),
        sentAll: webhooks.slice(before),
      }
    }
    c.equal('剩 31 天：不推', (await run(268.9)).sent.length, 0)
    const t30 = await run(270.5)
    c.check('剩不到 30 天：推 1 条（警告）', t30.sent.length === 1 && /还有 30 天到期/.test(t30.sent[0]!.text) && /警告/.test(t30.sent[0]!.text))
    c.equal('同一回合再跑一遍：不重复推（去重）', (await run(270.6)).sent.length, 0)
    c.equal('剩不到 7 天：再推 1 条', (await run(294)).sent.length, 1)
    const t1 = await run(299.5)
    c.check('剩不到 1 天：再推 1 条（严重）', t1.sent.length === 1 && /严重/.test(t1.sent[0]!.text) && /还有 1 天到期/.test(t1.sent[0]!.text))
    const g1 = await run(301)
    c.check('宽限期内每天推：第 1 天', g1.sent.length === 1 && /宽限期到/.test(g1.sent[0]!.text) && /不能开始新会话/.test(g1.sent[0]!.text))
    c.equal('同一天宽限期再跑：不重复', (await run(301.2)).sent.length, 0)
    c.equal('宽限期第 2 天：再推 1 条', (await run(302.2)).sent.length, 1)
    const expired = await run(308)
    c.check('结束宽限：推一次「已停用」', expired.sent.length === 1 && /宽限已结束/.test(expired.sent[0]!.text))
    c.equal('已停用只推一次', (await run(309)).sent.length, 0)
    c.equal('结束宽限超过 30 天不再翻旧账', (await run(400)).planned.length, 0)
    const plainAll = (await run(268.5)).plannedAll.map((a) => a.subjectKey)
    c.check('不管控 / 已吊销 / 已暂停的机构不在告警计划里', ![noneOrg, revokedOrg, suspOrg].some((id) => plainAll.includes(`license_expiry:${id}`)))
    const chainRun = await run(205)
    c.check('已录入首尾相接续期的机构：旧授权快到期也不推（连续覆盖到 300 天）', !chainRun.plannedAll.some((a) => a.subjectKey === `license_expiry:${chainOrg}`))
    const chainSoon = await run(272)
    c.check('续期链的终点剩不到 30 天才推', chainSoon.plannedAll.some((a) => a.subjectKey === `license_expiry:${chainOrg}`))
    const allText = webhooks.map((w) => w.text).join('\n')
    c.check('告警正文只写机构名与日期，不含合同编号 / 信用代码', !/HT-SECRET|91330100799655058B/.test(allText))
    c.check('告警发往配置的 webhook', webhooks.every((w) => w.url === 'http://alert.invalid/hook'))
    const planOnly = planLicenseAlerts([{ id: 'x', name: '纯函数机构', licenses: [] }], new Date(T0))
    c.equal('纯函数：没有授权的机构不计划告警', planOnly.length, 0)
    process.env['ALERT_WEBHOOK_URL'] = ''
    const quiet = new LicenseExpiryAlertService(prisma, redis as unknown as RedisService, fakeFetch)
    const sentBefore = webhooks.length
    at(270)
    await quiet.runDaily()
    c.equal('没配告警地址：定时任务什么都不发', webhooks.length, sentBefore)
  } finally {
    setLicenseClock(null)
    resetRedisCooldownForTests()
    await prisma.license.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined)
    // 已退役的终端是永久墓碑，库里禁止删除——逐台删，删不掉的留着（机构删除时外键会把它的 orgId 置空）。
    const leftovers = await prisma.terminal.findMany({ where: { OR: [{ id: { in: terminalIds } }, { terminalCode: { startsWith: `LICP-${suffix}` } }] }, select: { id: true } }).catch(() => [])
    for (const { id } of leftovers) await prisma.terminal.delete({ where: { id } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => undefined)
    await app.close()
  }
  c.finish('verify:license（行为）')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
