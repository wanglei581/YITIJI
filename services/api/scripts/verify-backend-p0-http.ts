import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import {
  BadRequestException,
  Module,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AdminOfflineAgenciesController } from '../src/offline-agencies/admin-offline-agencies.controller'
import { OfflineAgenciesService } from '../src/offline-agencies/offline-agencies.service'
import { JobSyncController } from '../src/job-sync/job-sync.controller'
import { JobSyncService } from '../src/job-sync/job-sync.service'
import { JobsController } from '../src/jobs/jobs.controller'
import { JobsService } from '../src/jobs/jobs.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import type { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import type { JobsAdminService } from '../src/jobs/jobs-admin.service'
import type { JobsExcelService } from '../src/jobs/jobs-excel.service'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import { FairCompanyPrintService } from '../src/jobs/fair-company-print.service'
import { JobRequirementStatsService } from '../src/jobs/job-requirement-stats.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'

type Json = Record<string, unknown>

const auditEvents: Array<{ action?: string; targetId?: string | null }> = []
const auditStub = {
  write: async (event: { action?: string; targetId?: string | null }) => {
    auditEvents.push(event)
    return `verify-audit-${auditEvents.length}`
  },
}
const qualityStub = { refreshJobQualitySnapshots: async () => undefined }
const memoryCache = new Map<string, string>()
const redisStub = {
  get: async (key: string) => memoryCache.get(key) ?? null,
  del: async (key: string) => memoryCache.delete(key) ? 1 : 0,
  setJsonIfVersionNotOlder: async (key: string, _ttl: number, value: string, tokenVersion: number) => {
    const current = memoryCache.get(key)
    const currentVersion = current
      ? (JSON.parse(current) as { tokenVersion?: number }).tokenVersion
      : undefined
    if (typeof currentVersion === 'number' && currentVersion > tokenVersion) return 'stale' as const
    memoryCache.set(key, value)
    return 'stored' as const
  },
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '30m' },
    }),
  ],
  controllers: [AdminOfflineAgenciesController, JobSyncController, JobsController],
  providers: [
    PrismaService,
    OfflineAgenciesService,
    JobsPartnerService,
    JobSyncService,
    JwtAuthGuard,
    RolesGuard,
    Reflector,
    { provide: RedisService, useValue: redisStub },
    { provide: AuditService, useValue: auditStub },
    { provide: JobQualityService, useValue: qualityStub },
    { provide: AdminFairsService, useValue: {} },
    { provide: FairCompanyPrintService, useValue: {} },
    // 只依赖 PrismaService（本模块已真实提供），因此按 jobs.module.ts 的方式真实注册，
    // 不用空对象打桩——保持 JobsController 能被真实实例化
    JobRequirementStatsService,
    {
      provide: JobsService,
      inject: [JobsPartnerService],
      useFactory: (partner: JobsPartnerService) => new JobsService(
        {} as JobsKioskService,
        {} as JobsAdminService,
        partner,
        {} as JobsExcelService,
      ),
    },
  ],
})
class BackendP0HttpModule {}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const output: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) {
      output.push(...Object.values(error.constraints).map((message) => `${path}: ${message}`))
    }
    if (error.children?.length) output.push(...flatten(error.children, path))
  }
  return output
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function errorCode(json: Json): string | undefined {
  return (json['error'] as { code?: string } | undefined)?.code
}

function envelopeData<T>(response: HttpResult): T {
  assert.equal(response.json['success'], true)
  assert.ok('data' in response.json)
  return response.json['data'] as T
}

interface HttpResult {
  status: number
  json: Json
}

async function main(): Promise<void> {
  assert.ok((process.env['JWT_SECRET'] ?? '').length >= 16, 'JWT_SECRET must be a test value of at least 16 chars')
  assert.ok((process.env['SECRET_ENCRYPTION_KEY'] ?? '').length >= 32, 'SECRET_ENCRYPTION_KEY must be a test value of at least 32 chars')
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  const isLocalSqlite = databaseUrl.startsWith('file:')
  const isLocalPostgres = (() => {
    if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) return false
    const hostname = new URL(databaseUrl).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost'
  })()
  assert.ok(isLocalSqlite || isLocalPostgres, 'HTTP verifier only accepts isolated SQLite or loopback PostgreSQL')

  const app = await NestFactory.create<NestExpressApplication>(BackendP0HttpModule, {
    logger: ['error', 'warn'],
  })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flatten(errors)
      return new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details },
      })
    },
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')

  const address = await app.getUrl()
  const base = `${address.replace('[::1]', '127.0.0.1')}/api/v1`
  const prisma = app.get(PrismaService)
  const jwt = app.get(JwtService)
  const suffix = Date.now().toString(36)
  const ids = {
    admin: `verify-http-admin-${suffix}`,
    enterpriseUser: `verify-http-enterprise-user-${suffix}`,
    hrUser: `verify-http-hr-user-${suffix}`,
    enterpriseOrg: `verify-http-enterprise-org-${suffix}`,
    hrOrg: `verify-http-hr-org-${suffix}`,
  }
  let agencyId: string | null = null
  let offlineJobId: string | null = null
  let webhookSourceId: string | null = null

  const token = (sub: string, role: 'admin' | 'partner', orgId: string | null) =>
    jwt.sign({ sub, role, orgId, ver: 0 })
  const adminToken = token(ids.admin, 'admin', null)
  const enterpriseToken = token(ids.enterpriseUser, 'partner', ids.enterpriseOrg)
  const hrToken = token(ids.hrUser, 'partner', ids.hrOrg)

  async function request(
    method: string,
    path: string,
    authToken?: string,
    body?: unknown,
  ): Promise<HttpResult> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return {
      status: response.status,
      json: (await response.json().catch(() => ({}))) as Json,
    }
  }

  try {
    await prisma.organization.createMany({ data: [
      { id: ids.enterpriseOrg, name: 'HTTP Verify Enterprise', type: 'enterprise_source' },
      { id: ids.hrOrg, name: 'HTTP Verify HR', type: 'licensed_hr_agency' },
    ] })
    await prisma.user.createMany({ data: [
      { id: ids.admin, username: ids.admin, passwordHash: 'verify', name: 'Verify Admin', role: 'admin' },
      { id: ids.enterpriseUser, username: ids.enterpriseUser, passwordHash: 'verify', name: 'Verify Enterprise', role: 'partner', orgId: ids.enterpriseOrg },
      { id: ids.hrUser, username: ids.hrUser, passwordHash: 'verify', name: 'Verify HR', role: 'partner', orgId: ids.hrOrg },
    ] })

    const missingAuth = await request('GET', '/admin/offline-agencies')
    assert.equal(missingAuth.status, 401)
    assert.equal(errorCode(missingAuth.json), 'AUTH_MISSING_TOKEN')
    const wrongRole = await request('GET', '/admin/offline-agencies', enterpriseToken)
    assert.equal(wrongRole.status, 403)
    assert.equal(errorCode(wrongRole.json), 'AUTH_ROLE_FORBIDDEN')
    pass('Real JWT and role guards protect Admin routes')

    const invalidCreate = await request('POST', '/admin/offline-agencies', adminToken, {
      name: 'Invalid Agency', orgType: 'other', address: 'Test Address', licenseNo: 'must-not-pass',
    })
    assert.equal(invalidCreate.status, 400)
    assert.equal(errorCode(invalidCreate.json), 'VALIDATION_FAILED')
    pass('ValidationPipe rejects drifted enums and unknown fields')

    const created = await request('POST', '/admin/offline-agencies', adminToken, {
      name: `HTTP Contract Agency ${suffix}`,
      orgType: 'recruitment',
      address: 'HTTP Contract Address',
      phone: '010-00000000',
    })
    assert.equal(created.status, 201)
    agencyId = envelopeData<{ id: string }>(created).id

    const list = await request('GET', '/admin/offline-agencies?page=1&pageSize=5', adminToken)
    const listData = envelopeData<{ data: Array<{ id: string }>; total: number; pageSize: number }>(list)
    assert.equal(listData.pageSize, 5)
    assert.ok(listData.data.some((agency) => agency.id === agencyId))
    const detail = await request('GET', `/admin/offline-agencies/${agencyId}`, adminToken)
    assert.equal(envelopeData<{ id: string }>(detail).id, agencyId)
    pass('OfflineAgency list/detail use the success/data envelope consumed by Admin')

    const updated = await request('PUT', `/admin/offline-agencies/${agencyId}`, adminToken, {
      name: `HTTP Contract Agency ${suffix}`,
      orgType: 'recruitment',
      address: 'HTTP Contract Address Updated',
    })
    assert.equal(envelopeData<{ reviewStatus: string; publishStatus: string }>(updated).reviewStatus, 'pending')
    const oldReviewBody = await request('PATCH', `/admin/offline-agencies/${agencyId}/review`, adminToken, {
      action: 'reject', rejectReason: 'old contract',
    })
    assert.equal(oldReviewBody.status, 400)
    const reviewed = await request('PATCH', `/admin/offline-agencies/${agencyId}/review`, adminToken, { action: 'approve' })
    assert.equal(envelopeData<{ reviewStatus: string }>(reviewed).reviewStatus, 'approved')
    const oldPublishBody = await request('PATCH', `/admin/offline-agencies/${agencyId}/publish`, adminToken, { publish: true })
    assert.equal(oldPublishBody.status, 400)
    const published = await request('PATCH', `/admin/offline-agencies/${agencyId}/publish`, adminToken, { publishStatus: 'published' })
    assert.equal(envelopeData<{ publishStatus: string }>(published).publishStatus, 'published')
    pass('PUT, reason, and publishStatus contracts survive real HTTP validation')

    const createdJob = await request('POST', `/admin/offline-agencies/${agencyId}/jobs`, adminToken, {
      title: 'HTTP Contract Job', jobType: 'fulltime', salaryMin: 8000, salaryMax: 12000,
      salaryUnit: 'month', location: 'HTTP District', externalUrl: 'https://example.com/jobs/http-contract',
    })
    offlineJobId = envelopeData<{ id: string }>(createdJob).id
    const jobs = await request('GET', `/admin/offline-agencies/${agencyId}/jobs?pageSize=100`, adminToken)
    assert.ok(envelopeData<{ data: Array<{ id: string }> }>(jobs).data.some((job) => job.id === offlineJobId))
    const updatedJob = await request('PUT', `/admin/offline-agencies/${agencyId}/jobs/${offlineJobId}`, adminToken, {
      title: 'HTTP Contract Job Updated', jobType: 'fulltime', location: 'HTTP District Updated',
    })
    assert.equal(envelopeData<{ title: string }>(updatedJob).title, 'HTTP Contract Job Updated')
    const agencyAfterJob = await prisma.offlineAgency.findUniqueOrThrow({ where: { id: agencyId } })
    assert.equal(agencyAfterJob.reviewStatus, 'pending')
    assert.equal(agencyAfterJob.publishStatus, 'draft')
    pass('Offline job CRUD is enveloped and forces the parent back to review')

    const capabilities = await request('GET', '/partner/data-sources/capabilities', enterpriseToken)
    assert.equal(capabilities.status, 200)
    const allowedModes = capabilities.json['allowedAccessModes'] as string[]
    assert.ok(allowedModes.includes('excel'))
    assert.ok(!allowedModes.includes('api') && !allowedModes.includes('webhook'))
    const deniedWebhook = await request('POST', '/partner/data-sources', enterpriseToken, {
      name: 'Denied Enterprise Webhook', accessMode: 'webhook', sourceKind: 'manual',
    })
    assert.equal(deniedWebhook.status, 403)
    assert.equal(errorCode(deniedWebhook.json), 'PARTNER_CAPABILITY_DENIED')
    pass('Partner capability endpoint and server-side deny rules work through HTTP')

    const webhook = await request('POST', '/partner/data-sources', hrToken, {
      name: 'HTTP Verify Webhook', accessMode: 'webhook', sourceKind: 'hr_company',
    })
    assert.equal(webhook.status, 201)
    webhookSourceId = webhook.json['id'] as string
    assert.equal(webhook.json['connStatus'], 'disabled')
    assert.equal(webhook.json['activationManagedBy'], 'admin')
    const crossOrgToggle = await request('PATCH', `/partner/data-sources/${webhookSourceId}/toggle`, enterpriseToken, {})
    assert.equal(crossOrgToggle.status, 404)
    assert.equal(errorCode(crossOrgToggle.json), 'DATA_SOURCE_NOT_FOUND')
    const partnerToggle = await request('PATCH', `/partner/data-sources/${webhookSourceId}/toggle`, hrToken, {})
    assert.equal(partnerToggle.status, 403)
    assert.equal(errorCode(partnerToggle.json), 'DATA_SOURCE_ADMIN_MANAGED')

    const adminEnable = await request('PATCH', `/admin/job-sync/sources/${webhookSourceId}/enabled`, adminToken, { enabled: true })
    assert.equal(envelopeData<{ updated: { enabled: boolean } }>(adminEnable).updated.enabled, true)
    const sourceList = await request('GET', '/admin/job-sync/sources', adminToken)
    assert.ok(envelopeData<Array<{ id: string }>>(sourceList).some((source) => source.id === webhookSourceId))
    pass('Webhook is cross-org 404, starts disabled, stays Partner read-only, and Admin can enable it')

    const canonicalJob = await prisma.job.create({ data: {
      sourceOrgId: ids.hrOrg,
      sourceId: webhookSourceId,
      externalId: `verify-http-job-${suffix}`,
      sourceName: 'HTTP Verify HR',
      sourceUrl: 'https://example.com/jobs/http-verify',
      title: 'HTTP Verify Canonical Job',
      company: 'HTTP Verify Company',
      city: 'HTTP Verify City',
      reviewStatus: 'approved',
      publishStatus: 'published',
    } })
    await request('PATCH', `/admin/job-sync/sources/${webhookSourceId}/enabled`, adminToken, { enabled: false })
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: canonicalJob.id } })).publishStatus, 'published')
    const impact = await request('GET', `/admin/job-sync/sources/${webhookSourceId}/impact`, adminToken)
    assert.equal(envelopeData<{ content: { jobs: { published: number } } }>(impact).content.jobs.published, 1)
    const badConfirmation = await request('POST', `/admin/job-sync/sources/${webhookSourceId}/unpublish-content`, adminToken, { confirmation: 'yes' })
    assert.equal(badConfirmation.status, 400)
    const unpublished = await request('POST', `/admin/job-sync/sources/${webhookSourceId}/unpublish-content`, adminToken, {
      confirmation: 'UNPUBLISH_SOURCE_CONTENT',
    })
    assert.equal(envelopeData<{ unpublishedJobs: number }>(unpublished).unpublishedJobs, 1)
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: canonicalJob.id } })).publishStatus, 'unpublished')
    assert.ok(auditEvents.some((event) => event.action === 'data_source.content_bulk_unpublish'))
    pass('Disable retains content; impact preview and confirmed bulk unpublish are separate audited HTTP operations')
  } finally {
    if (webhookSourceId) {
      await prisma.job.deleteMany({ where: { sourceId: webhookSourceId } })
      await prisma.jobFair.deleteMany({ where: { sourceId: webhookSourceId } })
      await prisma.syncLog.deleteMany({ where: { sourceId: webhookSourceId } })
      await prisma.importBatch.deleteMany({ where: { sourceId: webhookSourceId } })
      await prisma.jobSource.deleteMany({ where: { id: webhookSourceId } })
    }
    if (agencyId) {
      await prisma.offlineJob.deleteMany({ where: { agencyId } })
      await prisma.offlineAgency.deleteMany({ where: { id: agencyId } })
    }
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.enterpriseUser, ids.hrUser] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [ids.enterpriseOrg, ids.hrOrg] } } })
    await app.close()
  }

  console.log('\nAll backend P0 real HTTP checks passed.\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
