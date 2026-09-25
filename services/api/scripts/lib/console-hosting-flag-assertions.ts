/**
 * 两个后台读取招聘内容托管开关（3.13）。
 * 挂在 verify:partner-source-capabilities 上，CI 的 build-and-verify 与 postgres-readiness 都跑这条门禁。
 *
 * 期望：
 * - GET /api/v1/admin/system/recruitment-hosting
 *   只给 admin：无 token 401，partner token 403 AUTH_ROLE_FORBIDDEN。
 *   信封恰好是 { success: true, data: { recruitmentHosting: { enabled, deploymentEnabled } } }，
 *   两个布尔都等于 isRecruitmentContentHostingEnabled()；查询参数改不了它。
 * - GET /api/v1/partner/data-sources/capabilities
 *   recruitmentHosting 同部署开关。关闭时 canImportJobs / canImportFairs / canManageCompanies
 *   一律为 false，其余字段（含 canManagePolicies）与机构类型矩阵逐字段相同；
 *   打开时整份等于矩阵原值加 recruitmentHosting=true。
 * - 变量未设置按关闭处理（我们云上的默认）。
 *
 * 环境变量在每个用例里显式设置，结束后恢复，不依赖 CI job 的全局值。
 */
import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../../src/common/guards/roles.guard'
import { RedisService } from '../../src/common/redis/redis.service'
import { PrismaService } from '../../src/prisma/prisma.service'
import { AdminFairsService } from '../../src/jobs/admin-fairs.service'
import { FairCompanyPrintService } from '../../src/jobs/fair-company-print.service'
import { JobRequirementStatsService } from '../../src/jobs/job-requirement-stats.service'
import { JobsController } from '../../src/jobs/jobs.controller'
import { JobsPartnerService } from '../../src/jobs/jobs-partner.service'
import { JobsService } from '../../src/jobs/jobs.service'
import { getPartnerCapabilities } from '../../src/jobs/partner-capabilities'
import { JobQualityService } from '../../src/job-ai/job-quality.service'
import { AdminRecruitmentHostingController } from '../../src/recruitment-hosting/admin-recruitment-hosting.controller'
import { RECRUITMENT_CONTENT_HOSTING_ENV } from '../../src/recruitment-hosting/recruitment-hosting'
import { KioskJobBoardService } from '../../src/terminals/kiosk-job-board.service'

type HostingEnvValue = string | undefined

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(`FAIL ${message}`)
}

/** 键排序后的 JSON，用来做整份对象的逐字段比较。 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return v
  })
}

/** 按矩阵原值 + 托管叠加算出的期望能力。关闭时只动三个招聘内容位。 */
function expectedCapabilities(orgType: string, hosting: boolean): Record<string, unknown> {
  const base = getPartnerCapabilities(orgType)
  if (hosting) return { ...base, recruitmentHosting: true }
  return { ...base, recruitmentHosting: false, canImportJobs: false, canImportFairs: false, canManageCompanies: false }
}

async function withHosting(value: HostingEnvValue, run: () => Promise<void>): Promise<void> {
  const previous = process.env[RECRUITMENT_CONTENT_HOSTING_ENV]
  if (value === undefined) delete process.env[RECRUITMENT_CONTENT_HOSTING_ENV]
  else process.env[RECRUITMENT_CONTENT_HOSTING_ENV] = value
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env[RECRUITMENT_CONTENT_HOSTING_ENV]
    else process.env[RECRUITMENT_CONTENT_HOSTING_ENV] = previous
  }
}

export interface ConsoleHostingOrgIds {
  school: string
  publicService: string
  enterprise: string
  hr: string
  fair: string
}

export async function assertConsoleHostingFlag(input: {
  prisma: PrismaService
  partner: JobsPartnerService
  orgIds: ConsoleHostingOrgIds
}): Promise<void> {
  console.log('\n--- 两个后台读取招聘内容托管开关（3.13）---')
  const stamp = input.orgIds.school.replace(/[^a-z0-9]/gi, '').slice(-12)
  const adminId = `usr_adm_${stamp}`
  const partnerId = `usr_par_${stamp}`
  const jwtSecret = process.env['JWT_SECRET'] || 'verify-console-hosting-flag-jwt-secret'
  const redisStub = {
    get: async () => null,
    del: async () => 0,
    setJsonIfVersionNotOlder: async () => 'stored' as const,
  }
  const jobsService = new JobsService({} as never, {} as never, input.partner, {} as never)
  // 门禁主体还要用这个客户端做清理。直接交给 Nest，app.close() 会调它的 onModuleDestroy
  // 把连接断掉（PG 适配器下连接池会被关掉）。只把查询面借给鉴权守卫，生命周期钩子不给。
  const sharedPrisma = new Proxy(input.prisma, {
    get(target, prop, receiver) {
      if (prop === 'onModuleInit' || prop === 'onModuleDestroy') return undefined
      return Reflect.get(target, prop, receiver) as unknown
    },
  })

  @Module({
    imports: [JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '30m' } })],
    controllers: [AdminRecruitmentHostingController, JobsController],
    providers: [
      { provide: PrismaService, useValue: sharedPrisma },
      { provide: RedisService, useValue: redisStub },
      { provide: JobsService, useValue: jobsService },
      { provide: JobsPartnerService, useValue: input.partner },
      { provide: AdminFairsService, useValue: {} },
      { provide: JobQualityService, useValue: {} },
      { provide: FairCompanyPrintService, useValue: {} },
      { provide: JobRequirementStatsService, useValue: {} },
      { provide: KioskJobBoardService, useValue: {} },
      JwtAuthGuard,
      RolesGuard,
      Reflector,
    ],
  })
  class ConsoleHostingHttpModule {}

  const orgTypes: Array<[keyof ConsoleHostingOrgIds, string]> = [
    ['school', 'school_employment_center'],
    ['publicService', 'public_employment_service'],
    ['enterprise', 'enterprise_source'],
    ['hr', 'licensed_hr_agency'],
    ['fair', 'fair_organizer'],
  ]

  let app: INestApplication | undefined
  try {
    await input.prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } })
    await input.prisma.user.create({
      data: {
        id: adminId,
        username: `host-admin-${stamp}`,
        passwordHash: 'not-a-login',
        name: 'Hosting Flag Admin',
        role: 'admin',
        tokenVersion: 0,
      },
    })
    await input.prisma.user.create({
      data: {
        id: partnerId,
        username: `host-partner-${stamp}`,
        passwordHash: 'not-a-login',
        name: 'Hosting Flag Partner',
        role: 'partner',
        orgId: input.orgIds.school,
        tokenVersion: 0,
      },
    })

    app = await NestFactory.create<NestExpressApplication>(ConsoleHostingHttpModule, { logger: ['error'] })
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
    const jwt = app.get(JwtService)
    const adminAuth = { Authorization: `Bearer ${jwt.sign({ sub: adminId, ver: 0 })}`, Accept: 'application/json' }
    const partnerAuth = { Authorization: `Bearer ${jwt.sign({ sub: partnerId, ver: 0 })}`, Accept: 'application/json' }

    // 查询参数故意写反，证明两个端点都不读请求来决定开关。
    const adminUrl = (hint: boolean) =>
      `${base}/admin/system/recruitment-hosting?enabled=${String(hint)}&deploymentEnabled=${String(hint)}&recruitmentHosting=${String(hint)}`
    const partnerUrl = (hint: boolean) =>
      `${base}/partner/data-sources/capabilities?recruitmentHosting=${String(hint)}&canImportJobs=${String(hint)}`

    const assertAdminFlag = async (expected: boolean, label: string) => {
      const res = await fetch(adminUrl(!expected), { headers: adminAuth })
      const body = await res.json() as Record<string, unknown>
      const want = { success: true, data: { recruitmentHosting: { enabled: expected, deploymentEnabled: expected } } }
      if (res.status !== 200 || canonical(body) !== canonical(want)) {
        fail(`${label}：管理员接口应恰好返回 ${canonical(want)}，得到 ${res.status} ${canonical(body)}`)
      }
      pass(`${label}：管理员接口信封与两个布尔都等于部署开关（${String(expected)}），查询参数无效`)
    }

    const assertPartnerCaps = async (hosting: boolean, label: string) => {
      const res = await fetch(partnerUrl(!hosting), { headers: partnerAuth })
      const caps = await res.json() as Record<string, unknown>
      const want = expectedCapabilities('school_employment_center', hosting)
      if (res.status !== 200 || canonical(caps) !== canonical(want)) {
        fail(`${label}：学校机构能力接口应为 ${canonical(want)}，得到 ${res.status} ${canonical(caps)}`)
      }
      if (caps['canManagePolicies'] !== true || caps['canManageSmartCampus'] !== true) {
        fail(`${label}：学校机构的政策与智慧校园位不应受托管开关影响：${canonical(caps)}`)
      }
      for (const [key, orgType] of orgTypes) {
        const got = await input.partner.getPartnerDataSourceCapabilities({
          userId: partnerId, role: 'partner', orgId: input.orgIds[key],
        })
        const expected = expectedCapabilities(orgType, hosting)
        if (canonical(got) !== canonical(expected)) {
          fail(`${label}：${orgType} 能力应为 ${canonical(expected)}，得到 ${canonical(got)}`)
        }
        if (!hosting && (got.canImportJobs || got.canImportFairs || got.canManageCompanies)) {
          fail(`${label}：${orgType} 在托管关闭时仍有招聘内容写入能力：${canonical(got)}`)
        }
        if (got.canManagePolicies !== getPartnerCapabilities(orgType).canManagePolicies) {
          fail(`${label}：${orgType} 的 canManagePolicies 被托管开关改写`)
        }
      }
      pass(`${label}：五类机构能力 = 矩阵原值${hosting ? '' : '（岗位/招聘会/企业/导入位为 false）'}，recruitmentHosting=${String(hosting)}，政策位不变`)
    }

    // ── 鉴权：只给 admin ────────────────────────────────────────────────────
    await withHosting('true', async () => {
      const anonymous = await fetch(adminUrl(true), { headers: { Accept: 'application/json' } })
      if (anonymous.status !== 401) fail(`无 token 访问管理员托管接口应 401，得到 ${anonymous.status}`)
      const denied = await fetch(adminUrl(true), { headers: partnerAuth })
      const deniedBody = await denied.json() as { error?: { code?: string } }
      if (denied.status !== 403 || deniedBody.error?.code !== 'AUTH_ROLE_FORBIDDEN') {
        fail(`partner 访问管理员托管接口应 403 AUTH_ROLE_FORBIDDEN，得到 ${denied.status} ${canonical(deniedBody)}`)
      }
      const adminOnPartner = await fetch(partnerUrl(true), { headers: adminAuth })
      if (adminOnPartner.status !== 403) {
        fail(`admin 访问机构能力接口应 403，得到 ${adminOnPartner.status}`)
      }
      pass('管理员托管接口只对 admin 开放：无 token 401，partner 403；机构能力接口不对 admin 开放')
    })

    // ── 三种部署取值：显式关闭 / 未设置（默认关）/ 显式打开（1）────────────
    await withHosting('false', async () => {
      await assertAdminFlag(false, '托管显式关闭')
      await assertPartnerCaps(false, '托管显式关闭')
    })
    await withHosting(undefined, async () => {
      await assertAdminFlag(false, '托管变量未设置（我们云上的默认）')
      await assertPartnerCaps(false, '托管变量未设置（我们云上的默认）')
    })
    await withHosting('1', async () => {
      await assertAdminFlag(true, '托管显式打开（b 版本，取值 1）')
      await assertPartnerCaps(true, '托管显式打开（b 版本，取值 1）')
    })
  } finally {
    await app?.close()
    await input.prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } }).catch(() => undefined)
  }
}
