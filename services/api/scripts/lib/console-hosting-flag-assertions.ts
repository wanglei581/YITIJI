/**
 * 两个后台读取招聘内容托管开关。
 * 挂在 verify:partner-source-capabilities 上，CI 已跑这条门禁。
 *
 * 期望：
 * - GET /api/v1/admin/system/recruitment-hosting
 *   信封 { success, data.recruitmentHosting.{enabled,deploymentEnabled} }
 *   两个布尔都等于 isRecruitmentContentHostingEnabled()，查询参数改不了。
 *   非 admin 403 AUTH_ROLE_FORBIDDEN。
 * - GET /api/v1/partner/data-sources/capabilities
 *   recruitmentHosting 同部署开关。
 *   关闭时 canImportJobs / canImportFairs / canManageCompanies 为 false。
 *   canManagePolicies 与机构类型矩阵的其余字段保持原值。
 *   打开时矩阵原值不变（例如招聘会主办方仍不能导入岗位）。
 */
import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Reflector } from '@nestjs/core'
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
import { JobQualityService } from '../../src/job-ai/job-quality.service'
import { AdminRecruitmentHostingController } from '../../src/recruitment-hosting/admin-recruitment-hosting.controller'
import { KioskJobBoardService } from '../../src/terminals/kiosk-job-board.service'

const HOSTING_ENV = 'RECRUITMENT_CONTENT_HOSTING_ENABLED'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(`FAIL ${message}`)
}

interface CapsBody {
  recruitmentHosting?: boolean
  canImportJobs?: boolean
  canImportFairs?: boolean
  canManageCompanies?: boolean
  canManagePolicies?: boolean
  canManageSmartCampus?: boolean
  allowedAccessModes?: string[]
  companyManageScope?: string
}

interface AdminBody {
  success?: boolean
  data?: {
    recruitmentHosting?: { enabled?: boolean; deploymentEnabled?: boolean }
  }
}

async function withHosting(enabled: boolean, run: () => Promise<void>): Promise<void> {
  const previous = process.env[HOSTING_ENV]
  process.env[HOSTING_ENV] = enabled ? 'true' : 'false'
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env[HOSTING_ENV]
    else process.env[HOSTING_ENV] = previous
  }
}

export async function assertConsoleHostingFlag(input: {
  prisma: PrismaService
  partner: JobsPartnerService
  orgIds: { school: string; fair: string; hr: string }
}): Promise<void> {
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

  @Module({
    imports: [JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '30m' } })],
    controllers: [AdminRecruitmentHostingController, JobsController],
    providers: [
      { provide: PrismaService, useValue: input.prisma },
      { provide: RedisService, useValue: redisStub },
      { provide: JobsService, useValue: jobsService },
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
    const adminToken = jwt.sign({ sub: adminId, ver: 0 })
    const partnerToken = jwt.sign({ sub: partnerId, ver: 0 })
    const adminAuth = { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' }
    const partnerAuth = { Authorization: `Bearer ${partnerToken}`, Accept: 'application/json' }

    const adminUrl = `${base}/admin/system/recruitment-hosting?enabled=true&deploymentEnabled=false`
    const partnerUrl = `${base}/partner/data-sources/capabilities?recruitmentHosting=true&canImportJobs=true`

    await withHosting(false, async () => {
      const denied = await fetch(adminUrl, { headers: partnerAuth })
      const deniedBody = await denied.json() as { error?: { code?: string } }
      if (denied.status !== 403 || deniedBody.error?.code !== 'AUTH_ROLE_FORBIDDEN') {
        fail(`非 admin 访问管理员托管接口应 403 AUTH_ROLE_FORBIDDEN，得到 ${denied.status} ${JSON.stringify(deniedBody)}`)
      }
      pass('非 admin 访问 GET /admin/system/recruitment-hosting 被拒')

      const adminRes = await fetch(adminUrl, { headers: adminAuth })
      const adminBody = await adminRes.json() as AdminBody
      const flag = adminBody.data?.recruitmentHosting
      if (adminRes.status !== 200 || adminBody.success !== true || flag?.enabled !== false || flag?.deploymentEnabled !== false) {
        fail(`托管关闭时管理员接口应为 enabled=false 且 deploymentEnabled=false，得到 ${adminRes.status} ${JSON.stringify(adminBody)}`)
      }
      pass('托管关闭时管理员接口两个布尔都为 false，且不读查询参数')

      const partnerRes = await fetch(partnerUrl, { headers: partnerAuth })
      const caps = await partnerRes.json() as CapsBody
      if (
        partnerRes.status !== 200
        || caps.recruitmentHosting !== false
        || caps.canImportJobs !== false
        || caps.canImportFairs !== false
        || caps.canManageCompanies !== false
        || caps.canManagePolicies !== true
        || caps.canManageSmartCampus !== true
        || !caps.allowedAccessModes?.includes('api')
        || caps.companyManageScope !== 'unrestricted'
      ) {
        fail(`托管关闭时学校机构能力位组合不符：${partnerRes.status} ${JSON.stringify(caps)}`)
      }
      pass('托管关闭时学校机构：导入/企业为 false，政策与矩阵其余字段不变')

      const fair = await input.partner.getPartnerDataSourceCapabilities({
        userId: partnerId, role: 'partner', orgId: input.orgIds.fair,
      })
      if (
        fair.recruitmentHosting !== false
        || fair.canImportJobs !== false
        || fair.canImportFairs !== false
        || fair.canManageCompanies !== false
        || fair.canManagePolicies !== false
      ) {
        fail(`托管关闭时招聘会主办方能力位组合不符：${JSON.stringify(fair)}`)
      }
      pass('托管关闭时招聘会主办方：招聘会导入也关闭，政策位仍为 false')
    })

    await withHosting(true, async () => {
      const adminRes = await fetch(`${base}/admin/system/recruitment-hosting?enabled=false`, { headers: adminAuth })
      const adminBody = await adminRes.json() as AdminBody
      const flag = adminBody.data?.recruitmentHosting
      if (adminRes.status !== 200 || adminBody.success !== true || flag?.enabled !== true || flag?.deploymentEnabled !== true) {
        fail(`托管打开时管理员接口应为两个 true，得到 ${adminRes.status} ${JSON.stringify(adminBody)}`)
      }
      pass('托管打开时管理员接口两个布尔都为 true，且不读查询参数')

      const partnerRes = await fetch(partnerUrl, { headers: partnerAuth })
      const caps = await partnerRes.json() as CapsBody
      if (
        partnerRes.status !== 200
        || caps.recruitmentHosting !== true
        || caps.canImportJobs !== true
        || caps.canImportFairs !== true
        || caps.canManageCompanies !== true
        || caps.canManagePolicies !== true
      ) {
        fail(`托管打开时学校机构能力位应回到矩阵：${partnerRes.status} ${JSON.stringify(caps)}`)
      }
      pass('托管打开时学校机构能力位回到矩阵，recruitmentHosting 为 true')

      const fair = await input.partner.getPartnerDataSourceCapabilities({
        userId: partnerId, role: 'partner', orgId: input.orgIds.fair,
      })
      if (fair.recruitmentHosting !== true || fair.canImportJobs !== false || fair.canImportFairs !== true || fair.canManagePolicies !== false) {
        fail(`托管打开时招聘会主办方矩阵被改写：${JSON.stringify(fair)}`)
      }
      const hr = await input.partner.getPartnerDataSourceCapabilities({
        userId: partnerId, role: 'partner', orgId: input.orgIds.hr,
      })
      if (hr.recruitmentHosting !== true || hr.canImportJobs !== true || hr.canImportFairs !== false || hr.canManagePolicies !== false) {
        fail(`托管打开时人社代理矩阵被改写：${JSON.stringify(hr)}`)
      }
      pass('托管打开时机构类型矩阵保持原语义')
    })
  } finally {
    await app?.close()
    await input.prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } }).catch(() => undefined)
  }
}
