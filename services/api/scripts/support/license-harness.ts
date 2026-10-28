/**
 * 授权行为门禁共用的装配：真库（SQLite 或 PostgreSQL）、真服务、真 HTTP，注入时钟、假 Redis、假 webhook。
 * verify-license.ts（管理员接口与状态变更）、verify-license-writes.ts（版本 / 并发 / 理由 / 日期 / 审计）、
 * verify-license-runtime.ts（会话 / 绑定 / 机构写操作 / 只读视图 / 告警）都从这里起一个应用。
 *
 * 时间口径：T0 取北京时间 2026-11-01 00:00（= 2026-10-31T16:00:00Z），所以 T0 + n 天正好是北京时间第 n 天的 0 点，
 * 与服务端「含到期日、次日北京 0 点」的存法对得上：from / to 以天数给，授权是 [T0+from, T0+to) ，
 * 即 startsOn = dateOf(from)、endsOn = dateOf(to - 1)。
 *
 * 夹具路由：控制器类名、处理函数名、路径模板与真实机构后台一一对应，用来真跑「写操作拦截器」；
 * 拦截器登记表按「控制器类名.处理函数名」核对，所以这里的类名必须与登记表一致。
 */
import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Controller, Delete, Get, Module, Patch, Post, Put, UseGuards } from '@nestjs/common'
import { APP_INTERCEPTOR, NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { AuditService } from '../../src/audit/audit.service'
import { Roles } from '../../src/common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../../src/common/guards/roles.guard'
import { resetRedisCooldownForTests } from '../../src/common/redis/redis-degradation'
import { RedisService } from '../../src/common/redis/redis.service'
import { LicenseAdminController } from '../../src/licenses/license.admin.controller'
import { LicensePartnerController } from '../../src/licenses/license.partner.controller'
import { LicenseService } from '../../src/licenses/license.service'
import { setLicenseClock } from '../../src/licenses/license-clock'
import { DAY_MS } from '../../src/licenses/license-state'
import { PartnerLicenseWriteInterceptor } from '../../src/licenses/partner-license-write.interceptor'
import { PrismaService } from '../../src/prisma/prisma.service'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../../src/terminals/terminal-session.service'
import { Checker, FakeRedis, installGlobals, makeCaller } from './branding-license-support'
import { assertIsolatedVerificationDatabase } from './isolated-verification-database'

export const T0 = Date.parse('2026-10-31T16:00:00.000Z')
export const CREDIT = '91330100799655058B'
/** 另一个校验位正确的统一社会信用代码（续期 / 更正换企业时用）。 */
export const CREDIT_B = '91440300708461136T'

/** T0 + days 天那一刻（北京时间第 days 天 0 点）的 ISO。 */
export const iso = (days: number): string => new Date(T0 + days * DAY_MS).toISOString()
/** T0 + days 天那一天的北京日期 YYYY-MM-DD。独立于被测代码另算一遍。 */
export const dateOf = (days: number): string => new Date(T0 + days * DAY_MS + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

// 夹具路由。真实的机构后台在别的控制器里，这里只复刻「类名.处理函数名 + 方法 + 路径」。
@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
class PoliciesController {
  @Get('policies') @Roles('partner') list() { return { ok: 'list' } }
  @Get('policies/export.csv') @Roles('partner') exportCsv() { return { ok: 'export' } }
  @Post('policies') @Roles('partner') createPartnerPolicy() { return { ok: 'create' } }
  @Patch('policies/:id') @Roles('partner') updatePartnerPolicy() { return { ok: 'update' } }
  @Patch('policies/:id/release') @Roles('partner') releasePartnerPolicy() { return { ok: 'release' } }
  @Patch('policies/:id/publish') @Roles('partner') unpublishPartnerPolicy() { return { ok: 'unpublish' } }
  @Delete('policies/:id') @Roles('partner') deletePartnerPolicy() { return { ok: 'delete' } }
  @Post('policies/:id/eligibility-preview') @Roles('partner') previewPartnerEligibility() { return { ok: 'preview' } }
}

@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
class OfficialChannelsController {
  @Post('official-channels') @Roles('partner') create() { return { ok: 'create-channel' } }
  @Delete('official-channels/:id') @Roles('partner') archive() { return { ok: 'archive-channel' } }
}

@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
class PartnerOrgController {
  @Put('profile') @Roles('partner') updateProfile() { return { ok: 'profile' } }
}

@Controller('partner/first-order')
@UseGuards(JwtAuthGuard, RolesGuard)
class PartnerFirstOrderIncidentsController {
  @Post('incidents') @Roles('partner') create() { return { ok: 'incident' } }
  @Patch('incidents/:id') @Roles('partner') update() { return { ok: 'incident-update' } }
}

@Controller('partner/first-order')
@UseGuards(JwtAuthGuard, RolesGuard)
class PartnerFirstOrderController {
  @Post('projects/:id/reports') @Roles('partner') createReport() { return { ok: 'report' } }
  @Post('reports/:id/acknowledge') @Roles('partner') acknowledge() { return { ok: 'ack' } }
  /** 首单前缀下以后新增的写接口：没登记就必须被拦（旧版前缀通配会把它自动放行）。 */
  @Post('brand-new-write') @Roles('partner') brandNewWrite() { return { ok: 'new-write' } }
}

@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
class RecruitmentIntegrationController {
  @Post('data-sources/preflight/jobs') @Roles('partner') preflightJobs() { return { ok: 'preflight-jobs' } }
  @Post('data-sources/preflight/fairs') @Roles('partner') preflightFairs() { return { ok: 'preflight-fairs' } }
}

@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
class FixtureMixedController {
  @Post('mixed') @Roles('admin', 'partner') mixed() { return { ok: 'mixed' } }
}

export interface Harness {
  c: Checker
  suffix: string
  prisma: PrismaService
  redis: FakeRedis
  sessions: TerminalSessionService
  call: ReturnType<typeof makeCaller>
  adminId: string
  adminToken: string
  webhooks: Array<{ url: string; text: string }>
  fakeFetch: typeof fetch
  orgIds: string[]
  terminalIds: string[]
  /** 把注入时钟拨到 T0 + days 天。 */
  at(days: number): void
  nowMs(): number
  newOrg(key: string, mode?: 'none' | 'required'): Promise<string>
  newTerminal(key: string, orgId: string | null, extra?: Record<string, unknown>): Promise<string>
  newUser(key: string, role: 'admin' | 'partner', orgId: string | null): Promise<string>
  sessionOf(terminalId: string): Promise<string>
  codeOf(work: () => Promise<unknown>): Promise<string>
  api(method: string, path: string, body?: unknown, token?: string): Promise<Awaited<ReturnType<ReturnType<typeof makeCaller>>>>
  detail(orgId: string): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  /**
   * 新建一条授权。from / to 以天数给（授权是 [T0+from, T0+to)）；也可以直接给 startsOn / endsOn 覆盖。
   * 默认 [0, 30)、3 台、宽限 7 天、合同编号随机。
   */
  createLicense(orgId: string, over?: Record<string, unknown> & { from?: number; to?: number }): Promise<{ status: number; id: string; org: any; error?: string; message?: string }> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** 带上授权当前版本发请求体：从详情里读 version。 */
  versionOf(orgId: string, licenseId: string): Promise<number>
  close(): Promise<void>
}

export async function createLicenseHarness(): Promise<Harness> {
  assertIsolatedVerificationDatabase()
  process.env['ADMIN_IP_ALLOWLIST'] = ''
  process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] = 'true'
  const c = new Checker()
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const redis = new FakeRedis()
  const webhooks: Array<{ url: string; text: string }> = []
  const fakeFetch = (async (url: string, init?: { body?: string }) => {
    webhooks.push({ url: String(url), text: (JSON.parse(init?.body ?? '{}') as { text?: { content?: string } }).text?.content ?? '' })
    return { ok: true, status: 200 } as Response
  }) as unknown as typeof fetch

  @Module({
    imports: [JwtModule.register({ secret: 'license-verify-secret', signOptions: { expiresIn: '2h' } })],
    controllers: [
      LicenseAdminController, LicensePartnerController,
      PoliciesController, OfficialChannelsController, PartnerOrgController, PartnerFirstOrderIncidentsController,
      PartnerFirstOrderController, RecruitmentIntegrationController, FixtureMixedController,
    ],
    providers: [
      LicenseService, AuditService, JwtAuthGuard, RolesGuard, PrismaService, TerminalSessionService,
      PartnerLicenseWriteInterceptor,
      { provide: APP_INTERCEPTOR, useExisting: PartnerLicenseWriteInterceptor },
      { provide: RedisService, useValue: redis },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() { /* 夹具：不校验终端令牌 */ } } },
    ],
  })
  class FixtureModule {}

  let nowMs = T0
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
  const newOrg: Harness['newOrg'] = async (key, mode = 'none') => {
    const id = `org_lic_${key}_${suffix}`
    orgIds.push(id)
    await prisma.organization.create({ data: { id, name: `授权门禁机构${key}${suffix}`, type: 'public_employment_service', licenseMode: mode } })
    return id
  }
  const newTerminal: Harness['newTerminal'] = async (key, orgId, extra = {}) => {
    const id = `t_lic_${key}_${suffix}`
    terminalIds.push(id)
    await prisma.terminal.create({
      data: { id, terminalCode: `LIC-${key}-${suffix}`, agentToken: `tok-${id}`, deviceFingerprint: `fp-${id}`, orgId, orgBoundAt: orgId ? new Date(T0) : null, ...extra },
    })
    return id
  }
  const newUser: Harness['newUser'] = async (key, role, orgId) => {
    const id = `user_lic_${key}_${suffix}`
    userIds.push(id)
    await prisma.user.create({ data: { id, username: `lic-${key}-${suffix}`, passwordHash: 'not-used', name: `授权门禁${key}`, role, orgId } })
    return jwt.sign({ sub: id, ver: 0 })
  }
  const adminId = `user_lic_admin_${suffix}`
  const adminToken = await newUser('admin', 'admin', null)
  const api: Harness['api'] = (method, path, body, token = adminToken) => call(method, `/api/v1${path}`, { body, token })
  const detail: Harness['detail'] = async (orgId) => (await api('GET', `/admin/orgs/${orgId}/licenses`)).json.data
  let contractSeq = 0

  return {
    c, suffix, prisma, redis, sessions, call, adminId, adminToken, webhooks, fakeFetch, orgIds, terminalIds,
    at(days) { nowMs = T0 + days * DAY_MS },
    nowMs: () => nowMs,
    newOrg, newTerminal, newUser, api, detail,
    async sessionOf(terminalId) {
      const ticket = await sessions.createBootTicket(terminalId, 'Bearer fixture')
      return (await sessions.exchangeBootTicket(ticket.bootTicket)).sessionToken
    },
    async codeOf(work) {
      try {
        await work()
        return 'ok'
      } catch (error) {
        const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
        return `${(error as { getStatus?: () => number }).getStatus?.() ?? '?'}:${response?.error?.code ?? (error as Error).message}`
      }
    },
    async createLicense(orgId, over = {}) {
      const { from = 0, to = 30, ...rest } = over
      contractSeq += 1
      const r = await api('POST', `/admin/orgs/${orgId}/licenses`, {
        licenseeName: '青岛某某人力资源有限公司', creditCode: CREDIT, contractNo: `HT-${suffix}-${contractSeq}`,
        startsOn: dateOf(from), endsOn: dateOf(to - 1), terminalQuota: 3, ...rest,
      })
      return { status: r.status, id: r.json.data?.licenseId as string, org: r.json.data?.org, error: r.json.error?.code as string | undefined, message: r.json.error?.message as string | undefined }
    },
    async versionOf(orgId, licenseId) {
      const org = await detail(orgId)
      return org.items.find((item: { id: string }) => item.id === licenseId).version as number
    },
    async close() {
      setLicenseClock(null)
      resetRedisCooldownForTests()
      await prisma.license.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined)
      // 已退役的终端是永久墓碑，库里禁止删除——逐台删，删不掉的留着（机构删除时外键会把它的 orgId 置空）。
      const leftovers = await prisma.terminal.findMany({ where: { OR: [{ id: { in: terminalIds } }, { terminalCode: { startsWith: `LICP-${suffix}` } }] }, select: { id: true } }).catch(() => [])
      for (const { id } of leftovers) await prisma.terminal.delete({ where: { id } }).catch(() => undefined)
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined)
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => undefined)
      await app.close()
    },
  }
}
