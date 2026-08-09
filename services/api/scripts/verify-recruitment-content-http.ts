import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AdminRecruitmentContentController } from '../src/recruitment-content/admin-recruitment-content.controller'
import { RecruitmentContentReadService } from '../src/recruitment-content/recruitment-content-read.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { assertRecruitmentContentVerifyTarget } from '../src/recruitment-content/recruitment-content-verify-target'

type Json = Record<string, unknown>

process.env['JWT_SECRET'] ||= 'recruitment-http-verify-secret-32-chars'

const cache = new Map<string, string>()
const redisStub = {
  get: async (key: string) => cache.get(key) ?? null,
  del: async (key: string) => cache.delete(key) ? 1 : 0,
  setJsonIfVersionNotOlder: async (key: string, _ttl: number, value: string, tokenVersion: number) => {
    const previous = cache.get(key)
    const version = previous ? (JSON.parse(previous) as { tokenVersion?: number }).tokenVersion : undefined
    if (typeof version === 'number' && version > tokenVersion) return 'stale' as const
    cache.set(key, value)
    return 'stored' as const
  },
}

const filesStub = {
  getAccessUrl: async (fileId: string) => ({
    response: {
      fileId,
      url: `https://signed.invalid/qualification/${fileId}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      disposition: 'inline' as const,
    },
    record: { purpose: 'qualification_evidence', ownerType: 'admin' },
    needsAdminAudit: false,
  }),
}

@Module({
  imports: [JwtModule.register({ secret: process.env['JWT_SECRET'], signOptions: { expiresIn: '30m' } })],
  controllers: [AdminRecruitmentContentController],
  providers: [
    PrismaService,
    AuditService,
    RecruitmentContentReadService,
    JwtAuthGuard,
    RolesGuard,
    Reflector,
    { provide: RedisService, useValue: redisStub },
    { provide: FilesService, useValue: filesStub },
  ],
})
class RecruitmentContentHttpModule {}

interface HttpResult {
  status: number
  json: Json
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const output: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) output.push(...Object.values(error.constraints).map((message) => `${path}: ${message}`))
    if (error.children?.length) output.push(...flatten(error.children, path))
  }
  return output
}

function envelope<T>(response: HttpResult): T {
  assert.equal(response.json['success'], true)
  return response.json['data'] as T
}

function errorCode(response: HttpResult): string | undefined {
  return (response.json['error'] as { code?: string } | undefined)?.code
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

async function main(): Promise<void> {
  assert.throws(() => assertRecruitmentContentVerifyTarget({
    DATABASE_URL: 'file:./isolated.db', NODE_ENV: 'production', RECRUITMENT_CONTENT_VERIFY_TARGET: 'isolated',
  }), /PRODUCTION_FORBIDDEN/)
  assert.throws(() => assertRecruitmentContentVerifyTarget({
    DATABASE_URL: 'file:./isolated.db', NODE_ENV: 'test',
  }), /TARGET_REQUIRED/)
  assert.throws(() => assertRecruitmentContentVerifyTarget({
    DATABASE_URL: 'postgresql://verify:verify@production.example.com/db',
    NODE_ENV: 'test', RECRUITMENT_CONTENT_VERIFY_TARGET: 'isolated',
  }), /DATABASE_UNSAFE/)
  assertRecruitmentContentVerifyTarget({
    ...process.env,
    DATABASE_URL: 'file:./preflight-placeholder.db',
  })

  const suppliedUrl = process.env['DATABASE_URL'] ?? ''
  const usePostgres = suppliedUrl.startsWith('postgres://') || suppliedUrl.startsWith('postgresql://')
  let tempDirectory: string | null = null
  if (!usePostgres) {
    tempDirectory = mkdtempSync(join(tmpdir(), 'recruitment-content-http-'))
    const databasePath = join(tempDirectory, 'verify.db')
    process.env['DATABASE_URL'] = `file:${databasePath}`
    const migrationsRoot = resolve(__dirname, '../prisma/migrations')
    for (const entry of readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const migration = join(migrationsRoot, entry.name, 'migration.sql')
      if (!existsSync(migration)) continue
      execFileSync('sqlite3', ['-bail', databasePath], {
        input: `PRAGMA foreign_keys=ON;\n${readFileSync(migration, 'utf8')}`,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }
  }
  assertRecruitmentContentVerifyTarget(process.env)

  const app = await NestFactory.create<NestExpressApplication>(RecruitmentContentHttpModule, {
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

  const root = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
  const prisma = app.get(PrismaService)
  const jwt = app.get(JwtService)
  const suffix = `${process.pid}-${Date.now().toString(36)}`
  const ids = {
    admin: `rc-admin-${suffix}`,
    partner: `rc-partner-${suffix}`,
    orgA: `rc-org-a-${suffix}`,
    orgB: `rc-org-b-${suffix}`,
    profileA: `rc-profile-a-${suffix}`,
    profileB: `rc-profile-b-${suffix}`,
    branchA: `rc-branch-a-${suffix}`,
    branchB: `rc-branch-b-${suffix}`,
    qualBusiness: `rc-qual-business-${suffix}`,
    qualHr: `rc-qual-hr-${suffix}`,
    qualNoEvidence: `rc-qual-no-evidence-${suffix}`,
    evidence: `rc-evidence-${suffix}`,
    invalidEvidence: `rc-invalid-evidence-${suffix}`,
    directoryGood: `rc-directory-good-${suffix}`,
    directoryBlocked: `rc-directory-blocked-${suffix}`,
  }

  const adminToken = jwt.sign({ sub: ids.admin, role: 'admin', orgId: null, ver: 0 })
  const partnerToken = jwt.sign({ sub: ids.partner, role: 'partner', orgId: ids.orgB, ver: 0 })
  const hash = `sha256:${suffix}`

  async function request(path: string, token?: string, method = 'GET'): Promise<HttpResult> {
    const response = await fetch(`${root}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'User-Agent': 'recruitment-content-http-verifier',
      },
    })
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Json }
  }

  let primaryError: Error | null = null
  const cleanupErrors: Error[] = []
  try {
    await prisma.organization.createMany({ data: [
      { id: ids.orgA, name: 'Verify Licensed Agency', type: 'licensed_hr_agency', contentTrustStatus: 'active' },
      { id: ids.orgB, name: 'Verify Public Service', type: 'public_employment_service', contentTrustStatus: 'active' },
    ] })
    await prisma.user.createMany({ data: [
      { id: ids.admin, username: ids.admin, passwordHash: 'verify', name: 'Verify Admin', role: 'admin' },
      { id: ids.partner, username: ids.partner, passwordHash: 'verify', name: 'Verify Partner', role: 'partner', orgId: ids.orgB },
    ] })
    await prisma.fileObject.createMany({ data: [
      {
        id: ids.evidence,
        storageKey: `verify/qualification/${ids.evidence}.pdf`,
        filename: 'qualification.pdf', mimeType: 'application/pdf', sizeBytes: 128, sha256: '0'.repeat(64),
        uploaderId: ids.admin, ownerType: 'admin', ownerId: ids.admin,
        purpose: 'qualification_evidence', sensitiveLevel: 'sensitive', visibility: 'private', status: 'active',
      },
      {
        id: ids.invalidEvidence,
        storageKey: `verify/qualification/${ids.invalidEvidence}.pdf`,
        filename: 'invalid-evidence.pdf', mimeType: 'application/pdf', sizeBytes: 64, sha256: '1'.repeat(64),
        uploaderId: ids.admin, ownerType: 'admin', ownerId: ids.admin,
        purpose: 'admin_upload', sensitiveLevel: 'sensitive', visibility: 'private', status: 'active',
      },
    ] })
    await prisma.onlinePlatformDirectory.createMany({ data: [
      {
        id: ids.directoryGood,
        organizationId: ids.orgA,
        name: 'Verify Official Platform',
        slug: `verify-official-${suffix}`,
        officialDomainsJson: '["example.com"]',
        landingUrl: 'https://jobs.example.com/',
        operatorLegalName: 'Example Operator',
        status: 'active', reviewStatus: 'approved', publishStatus: 'published',
        contentHash: hash, approvedContentHash: hash, hashAlgorithmVersion: 'v1', linkCheckStatus: 'valid',
      },
      {
        id: ids.directoryBlocked,
        name: 'Verify Blocked Platform',
        slug: `verify-blocked-${suffix}`,
        officialDomainsJson: '["example.com"]',
        landingUrl: 'http://127.0.0.1/internal',
        operatorLegalName: 'Blocked Operator',
        status: 'active', reviewStatus: 'approved', publishStatus: 'published',
        contentHash: hash, approvedContentHash: `${hash}-old`, linkCheckStatus: 'valid',
      },
    ] })
    await prisma.offlineAgencyProfile.createMany({ data: [
      {
        id: ids.profileA, organizationId: ids.orgA, displayName: 'Verify Agency A',
        serviceScopeJson: '["recruitment_service"]', reviewStatus: 'approved', publishStatus: 'published',
        contentHash: hash, approvedContentHash: hash, hashAlgorithmVersion: 'v1',
      },
      {
        id: ids.profileB, organizationId: ids.orgB, displayName: 'Verify Agency B',
        serviceScopeJson: 'not-json', reviewStatus: 'pending', publishStatus: 'draft',
      },
    ] })
    await prisma.offlineAgencyBranch.createMany({ data: [
      {
        id: ids.branchA, agencyProfileId: ids.profileA, branchName: 'Verify Branch A', address: 'Shanghai',
        status: 'active', reviewStatus: 'approved', publishStatus: 'published', contentHash: hash,
        approvedContentHash: hash, hashAlgorithmVersion: 'v1',
      },
      {
        id: ids.branchB, agencyProfileId: ids.profileB, branchName: 'Verify Branch B', address: 'Beijing',
        status: 'closed',
      },
    ] })
    await prisma.qualificationRecord.createMany({ data: [
      {
        id: ids.qualBusiness, organizationId: ids.orgA, qualificationType: 'business_license',
        licenseNumber: '91310000VERIFY1234', status: 'valid', contentHash: hash, approvedContentHash: hash,
        hashAlgorithmVersion: 'v1', evidenceFileId: ids.evidence, verificationSource: 'admin_manual',
        issuerName: 'Shanghai Authority', jurisdiction: '310000', verifiedBy: ids.admin, verifiedAt: new Date(),
      },
      {
        id: ids.qualHr, organizationId: ids.orgA, qualificationType: 'hr_service_license',
        licenseNumber: 'HR-VERIFY-5678', status: 'valid', contentHash: hash, approvedContentHash: hash,
        hashAlgorithmVersion: 'v1', evidenceFileId: ids.evidence, appliesToBranchId: ids.branchB,
        verificationSource: 'admin_manual', issuerName: 'Shanghai HR Authority', jurisdiction: '310000',
        verifiedBy: ids.admin, verifiedAt: new Date(),
      },
      {
        id: ids.qualNoEvidence, organizationId: ids.orgA, qualificationType: 'organizer_authorization',
        status: 'valid', contentHash: hash, approvedContentHash: hash, hashAlgorithmVersion: 'v1',
        evidenceFileId: ids.invalidEvidence, verificationSource: 'admin_manual', issuerName: 'Test Authority',
        jurisdiction: '310000', verifiedBy: ids.admin, verifiedAt: new Date(),
      },
    ] })

    const missingAuth = await request('/admin/recruitment-content/platform-directories')
    assert.equal(missingAuth.status, 401)
    assert.equal(errorCode(missingAuth), 'AUTH_MISSING_TOKEN')
    const wrongRole = await request('/admin/recruitment-content/platform-directories', partnerToken)
    assert.equal(wrongRole.status, 403)
    assert.equal(errorCode(wrongRole), 'AUTH_ROLE_FORBIDDEN')
    pass('JWT and RBAC keep all recruitment governance routes Admin-only')

    const invalidQuery = await request('/admin/recruitment-content/platform-directories?unknown=1', adminToken)
    assert.equal(invalidQuery.status, 400)
    assert.equal(errorCode(invalidQuery), 'VALIDATION_FAILED')
    pass('ValidationPipe rejects unknown query drift')

    const directories = envelope<{ items: Array<{ id: string; publicationReadiness: { ready: boolean; blockers: string[] } }> }>(
      await request('/admin/recruitment-content/platform-directories?page=1&pageSize=100', adminToken),
    )
    const goodDirectory = directories.items.find((item) => item.id === ids.directoryGood)
    const blockedDirectory = directories.items.find((item) => item.id === ids.directoryBlocked)
    assert.equal(goodDirectory?.publicationReadiness.ready, true)
    assert.equal(blockedDirectory?.publicationReadiness.ready, false)
    assert.ok(blockedDirectory?.publicationReadiness.blockers.includes('landing_url_invalid'))
    assert.ok(blockedDirectory?.publicationReadiness.blockers.includes('approved_hash_mismatch'))
    assert.ok(blockedDirectory?.publicationReadiness.blockers.includes('hash_algorithm_missing'))
    pass('review/publish/hash, HTTPS domain policy and link state derive fail-closed readiness')

    const blockedProfile = envelope<{
      publicationReadiness: { ready: boolean }
      qualifications: Array<{ id: string; licenseNumberMasked: string | null; effectiveValid: boolean }>
    }>(await request(`/admin/recruitment-content/agency-profiles/${ids.profileA}`, adminToken))
    assert.equal(blockedProfile.publicationReadiness.ready, false)
    assert.equal(blockedProfile.qualifications.find((item) => item.id === ids.qualNoEvidence)?.effectiveValid, false)
    await prisma.qualificationRecord.update({ where: { id: ids.qualHr }, data: { appliesToBranchId: null } })
    const profile = envelope<{
      publicationReadiness: { ready: boolean }
      qualifications: Array<{ id: string; licenseNumberMasked: string | null; effectiveValid: boolean }>
    }>(await request(`/admin/recruitment-content/agency-profiles/${ids.profileA}`, adminToken))
    assert.equal(profile.publicationReadiness.ready, true)
    const business = profile.qualifications.find((item) => item.id === ids.qualBusiness)
    assert.equal(business?.effectiveValid, true)
    assert.notEqual(business?.licenseNumberMasked, '91310000VERIFY1234')
    assert.ok(business?.licenseNumberMasked?.includes('*'))
    pass('agency readiness requires applicable evidence-backed qualifications; license is masked')

    const invalidScope = envelope<{
      publicationReadiness: { blockers: string[] }
      branches: Array<{ status: string; localPublicationReadiness: { ready: boolean } }>
    }>(
      await request(`/admin/recruitment-content/agency-profiles/${ids.profileB}`, adminToken),
    )
    assert.ok(invalidScope.publicationReadiness.blockers.includes('service_scope_invalid'))
    assert.equal(invalidScope.branches[0]?.status, 'closed')
    assert.equal(invalidScope.branches[0]?.localPublicationReadiness.ready, false)
    pass('malformed service scope and closed branches remain fail-closed')

    const wrongProfileBranch = await request(
      `/admin/recruitment-content/agency-profiles/${ids.profileB}/branches/${ids.branchA}`,
      adminToken,
    )
    assert.equal(wrongProfileBranch.status, 404)
    const wrongOrgQualification = await request(
      `/admin/recruitment-content/organizations/${ids.orgB}/qualifications/${ids.qualBusiness}`,
      adminToken,
    )
    assert.equal(wrongOrgQualification.status, 404)
    pass('nested identifiers fail with 404 instead of leaking cross-organization objects')

    const wrongEvidence = await request(
      `/admin/recruitment-content/organizations/${ids.orgB}/qualifications/${ids.qualBusiness}/evidence-access`,
      adminToken,
    )
    assert.equal(wrongEvidence.status, 404)
    const wrongPurposeQualification = envelope<{ effectiveValid: boolean; evidenceAvailable: boolean }>(await request(
      `/admin/recruitment-content/organizations/${ids.orgA}/qualifications/${ids.qualNoEvidence}`,
      adminToken,
    ))
    assert.equal(wrongPurposeQualification.effectiveValid, false)
    assert.equal(wrongPurposeQualification.evidenceAvailable, false)
    for (const invalidState of [
      { purpose: 'qualification_evidence', visibility: 'public', status: 'active', deletedAt: null, expiresAt: null },
      { purpose: 'qualification_evidence', visibility: 'private', status: 'quarantined', deletedAt: null, expiresAt: null },
      { purpose: 'qualification_evidence', visibility: 'private', status: 'deleted', deletedAt: new Date(), expiresAt: null },
      { purpose: 'qualification_evidence', visibility: 'private', status: 'active', deletedAt: null, expiresAt: new Date(Date.now() - 60_000) },
    ]) {
      await prisma.fileObject.update({ where: { id: ids.invalidEvidence }, data: invalidState })
      const blocked = await request(
        `/admin/recruitment-content/organizations/${ids.orgA}/qualifications/${ids.qualNoEvidence}/evidence-access`,
        adminToken,
      )
      assert.equal(blocked.status, 404)
    }
    await prisma.fileObject.update({ where: { id: ids.invalidEvidence }, data: {
      purpose: 'qualification_evidence', visibility: 'private', status: 'active', deletedAt: null, expiresAt: null,
    } })
    await prisma.qualificationRecord.update({ where: { id: ids.qualNoEvidence }, data: { issuerName: null } })
    const missingProvenance = envelope<{ effectiveValid: boolean }>(await request(
      `/admin/recruitment-content/organizations/${ids.orgA}/qualifications/${ids.qualNoEvidence}`,
      adminToken,
    ))
    assert.equal(missingProvenance.effectiveValid, false)
    const evidence = envelope<{ fileId: string; url: string }>(await request(
      `/admin/recruitment-content/organizations/${ids.orgA}/qualifications/${ids.qualBusiness}/evidence-access`,
      adminToken,
    ))
    assert.equal(evidence.fileId, ids.evidence)
    assert.ok(evidence.url.startsWith('https://signed.invalid/'))
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'recruitment.qualification_evidence_access', targetId: ids.evidence },
      orderBy: { createdAt: 'desc' },
    })
    assert.ok(audit)
    assert.ok(!audit.payloadJson.includes('signed.invalid'))
    assert.ok(!audit.payloadJson.includes('91310000VERIFY1234'))
    assert.ok(audit.payloadJson.includes(ids.qualBusiness))
    pass('private evidence access is nested, signed and synchronously audited without URL or license leakage')

    const mutation = await request('/admin/recruitment-content/platform-directories', adminToken, 'POST')
    assert.equal(mutation.status, 404)
    pass('Wave 1B exposes no create/update/review/publish mutation endpoints')
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error))
  } finally {
    const cleanup = async (label: string, operation: () => Promise<unknown>) => {
      try { await operation() } catch (error) {
        cleanupErrors.push(new Error(`${label}: ${(error as Error).message}`))
      }
    }
    await cleanup('audit logs', () => prisma.auditLog.deleteMany({
      where: { actorId: ids.admin, action: 'recruitment.qualification_evidence_access' },
    }))
    await cleanup('qualifications', () => prisma.qualificationRecord.deleteMany({
      where: { organizationId: { in: [ids.orgA, ids.orgB] } },
    }))
    await cleanup('branches', () => prisma.offlineAgencyBranch.deleteMany({
      where: { agencyProfileId: { in: [ids.profileA, ids.profileB] } },
    }))
    await cleanup('profiles', () => prisma.offlineAgencyProfile.deleteMany({
      where: { id: { in: [ids.profileA, ids.profileB] } },
    }))
    await cleanup('directories', () => prisma.onlinePlatformDirectory.deleteMany({
      where: { id: { in: [ids.directoryGood, ids.directoryBlocked] } },
    }))
    await cleanup('evidence files', () => prisma.fileObject.deleteMany({
      where: { id: { in: [ids.evidence, ids.invalidEvidence] } },
    }))
    await cleanup('users', () => prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.partner] } } }))
    await cleanup('organizations', () => prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }))
    await cleanup('app close', () => app.close())
    if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  }
  const failures = [...(primaryError ? [primaryError] : []), ...cleanupErrors]
  if (failures.length > 0) throw new AggregateError(failures, 'recruitment content HTTP verification failed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
