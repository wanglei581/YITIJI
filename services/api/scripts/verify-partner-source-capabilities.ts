import 'dotenv/config'
import { ForbiddenException, HttpException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobSyncService } from '../src/job-sync/job-sync.service'
import type { AuditService } from '../src/audit/audit.service'
import type { JobQualityService } from '../src/job-ai/job-quality.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { decryptSecret, encryptSecret } from '../src/common/crypto/secret-cipher'
import { webhookSecretStrengthIssue } from '../src/common/crypto/webhook-secret-strength'
import { ROTATE_CREDENTIAL_CONFIRMATION } from '../src/jobs/data-source-credential-policy'
import { resolveAuthScopedTracker } from '../src/common/throttler/terminal-throttle'
import type { RotateDataSourceCredentialDto } from '../src/jobs/dto/data-source.dto'

process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-partner-source-capabilities-key-32-bytes-minimum'

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

async function expectForbidden(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof ForbiddenException) {
      pass(message)
      return
    }
    throw error
  }
  throw new Error(`${message}: expected ForbiddenException`)
}

function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof HttpException) {
    const body = error.getResponse()
    if (body && typeof body === 'object' && 'error' in body) {
      return (body as { error?: { code?: string } }).error?.code
    }
  }
  return undefined
}

async function expectCode(run: () => Promise<unknown>, code: string, message: string): Promise<void> {
  try {
    await run()
  } catch (error) {
    const actual = errorCodeOf(error)
    if (actual === code) {
      pass(message)
      return
    }
    throw new Error(`${message}: expected ${code}, got ${actual ?? (error instanceof Error ? error.message : 'unknown')}`)
  }
  throw new Error(`${message}: expected ${code}`)
}

async function main(): Promise<void> {
  console.log('\n=== Partner source capability and activation contract ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const auditEvents: Array<{ action?: string; payload?: Record<string, unknown> }> = []
  const audit = {
    write: async (args: { action?: string; payload?: Record<string, unknown> }) => {
      auditEvents.push(args)
      return 'verify-audit'
    },
  } as unknown as AuditService
  const quality = {
    refreshJobQualitySnapshots: async () => undefined,
  } as unknown as JobQualityService
  const partner = new JobsPartnerService(prisma, audit, quality)
  const admin = new JobSyncService(prisma, quality, audit)
  const suffix = Date.now().toString(36)
  const orgIds = {
    school: `verify-school-${suffix}`,
    publicService: `verify-public-${suffix}`,
    enterprise: `verify-enterprise-${suffix}`,
    hr: `verify-hr-${suffix}`,
    fair: `verify-fair-${suffix}`,
  }

  const partnerUser = (orgId: string): AuthedUser => ({ userId: `verify-user-${suffix}`, role: 'partner', orgId })
  const adminUser: AuthedUser = { userId: `verify-admin-${suffix}`, role: 'admin', orgId: null }

  try {
    await prisma.organization.createMany({
      data: [
        { id: orgIds.school, name: 'Verify School', type: 'school_employment_center' },
        { id: orgIds.publicService, name: 'Verify Public Service', type: 'public_employment_service' },
        { id: orgIds.enterprise, name: 'Verify Enterprise', type: 'enterprise_source' },
        { id: orgIds.hr, name: 'Verify HR', type: 'licensed_hr_agency' },
        { id: orgIds.fair, name: 'Verify Fair', type: 'fair_organizer' },
      ],
    })

    const schoolCaps = await partner.getPartnerDataSourceCapabilities(partnerUser(orgIds.school))
    expect(schoolCaps.allowedAccessModes.includes('api'), 'school missing API capability')
    expect(schoolCaps.allowedSourceKinds.includes('school'), 'school missing school sourceKind')
    await expectForbidden(
      () => partner.createPartnerDataSource({ name: 'Wrong school kind', accessMode: 'excel', sourceKind: 'hr_company' }, partnerUser(orgIds.school)),
      'School cannot claim an HR-company sourceKind',
    )

    const publicCaps = await partner.getPartnerDataSourceCapabilities(partnerUser(orgIds.publicService))
    expect(publicCaps.allowedAccessModes.includes('webhook'), 'public service missing Webhook capability')
    expect(publicCaps.allowedSourceKinds.includes('aggregator'), 'public service missing aggregator sourceKind')
    pass('School and public-service capability rules expose only their allowed source identities')

    const enterpriseCaps = await partner.getPartnerDataSourceCapabilities(partnerUser(orgIds.enterprise))
    expect(!enterpriseCaps.allowedAccessModes.includes('api'), 'enterprise unexpectedly allowed API')
    expect(enterpriseCaps.allowedAccessModes.includes('excel'), 'enterprise missing Excel capability')
    pass('Enterprise capability exposes file/manual only and denies API')

    await expectForbidden(
      () => partner.createPartnerDataSource({ name: 'Denied webhook', accessMode: 'webhook', sourceKind: 'manual' }, partnerUser(orgIds.enterprise)),
      'Enterprise cannot create Webhook sources',
    )

    const fileSource = await partner.createPartnerDataSource(
      { name: 'Enterprise Excel', accessMode: 'excel' },
      partnerUser(orgIds.enterprise),
    )
    expect(fileSource.connStatus === 'connected', 'file source should start enabled')
    expect(fileSource.sourceKind === 'manual', 'enterprise default sourceKind must be server-derived manual')
    pass('Enterprise Excel source is enabled with server-derived sourceKind')

    const webhookSource = await partner.createPartnerDataSource(
      { name: 'HR Webhook', accessMode: 'webhook', sourceKind: 'hr_company' },
      partnerUser(orgIds.hr),
    )
    expect(webhookSource.connStatus === 'disabled', 'Webhook source must start disabled')
    expect(webhookSource.activationManagedBy === 'admin', 'Webhook activation owner must be admin')
    pass('Webhook source starts disabled and Admin-managed')

    await expectForbidden(
      () => partner.togglePartnerDataSource(webhookSource.id, partnerUser(orgIds.hr)),
      'Partner cannot self-enable an API/Webhook source',
    )

    await admin.setSourceEnabled(webhookSource.id, true, adminUser)
    const enabledSource = await prisma.jobSource.findUniqueOrThrow({ where: { id: webhookSource.id } })
    expect(enabledSource.enabled, 'Admin enable did not persist')
    pass('Admin can approve and enable a ready Webhook source')

    const job = await prisma.job.create({
      data: {
        sourceOrgId: orgIds.hr,
        sourceId: webhookSource.id,
        externalId: `verify-job-${suffix}`,
        sourceName: 'Verify HR',
        sourceUrl: 'https://example.com/jobs/verify',
        title: 'Verify Job',
        company: 'Verify Company',
        city: 'Verify City',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    await admin.setSourceEnabled(webhookSource.id, false, adminUser)
    const retained = await prisma.job.findUniqueOrThrow({ where: { id: job.id } })
    expect(retained.publishStatus === 'published', 'disabling source unexpectedly unpublished content')
    pass('Disabling a source stops ingestion without cascading published content')

    const impact = await admin.getSourceImpact(webhookSource.id)
    expect(impact.content.jobs.published === 1, 'impact preview missed published job')
    await admin.unpublishSourceContent(webhookSource.id, adminUser)
    const unpublished = await prisma.job.findUniqueOrThrow({ where: { id: job.id } })
    expect(unpublished.publishStatus === 'unpublished', 'explicit bulk unpublish did not update content')
    expect(auditEvents.some((event) => event.action === 'data_source.content_bulk_unpublish'), 'bulk unpublish audit missing')
    pass('Impact preview and separately confirmed bulk unpublish are audited')

    await expectForbidden(
      () => partner.importJobs([], partnerUser(orgIds.fair)),
      'Fair organizer cannot import generic jobs',
    )
    await expectForbidden(
      () => partner.importFairs({ items: [] }, partnerUser(orgIds.hr)),
      'Licensed HR agency cannot import job fairs',
    )

    expect(webhookSecretStrengthIssue('12345678') === 'too_short', '8-char webhook secret is too_short')
    expect(webhookSecretStrengthIssue('a'.repeat(32)) === 'low_entropy', '32 identical chars are low_entropy')
    expect(webhookSecretStrengthIssue('0123456789abcdef0123456789abcdef') === null, '32-char hex meets the write-path bar')
    expect(decryptSecret(encryptSecret('short8ch')) === 'short8ch', '8-char secret still round-trips; verify path must not reject it')
    pass('Webhook secret strength is write-path only; short secrets still decrypt')

    const sameJwtIp1 = resolveAuthScopedTracker({ ip: '203.0.113.10', headers: { authorization: 'Bearer stolen-jwt' } })
    const sameJwtIp2 = resolveAuthScopedTracker({ ip: '198.51.100.20', headers: { authorization: 'Bearer stolen-jwt' } })
    const otherJwt = resolveAuthScopedTracker({ ip: '203.0.113.10', headers: { authorization: 'Bearer other-jwt' } })
    expect(sameJwtIp1 === sameJwtIp2, 'auth-scoped tracker must ignore IP when Authorization is present')
    expect(sameJwtIp1 !== otherJwt, 'different JWTs must not share the rotation throttle bucket')
    pass('Credential rotation throttle tracker is per JWT, not per IP')

    const hr = partnerUser(orgIds.hr)
    await expectCode(
      () => partner.createPartnerDataSource(
        { name: 'Too short webhook', accessMode: 'webhook', sourceKind: 'hr_company', credential: '12345678' },
        hr,
      ),
      'WEBHOOK_SECRET_TOO_SHORT',
      'Write path rejects 8-char webhook secrets',
    )
    await expectCode(
      () => partner.createPartnerDataSource(
        { name: 'Low entropy webhook', accessMode: 'webhook', sourceKind: 'hr_company', credential: 'a'.repeat(32) },
        hr,
      ),
      'WEBHOOK_SECRET_LOW_ENTROPY',
      'Write path rejects low-entropy webhook secrets',
    )
    const strongWebhook = await partner.createPartnerDataSource(
      { name: 'Strong webhook', accessMode: 'webhook', sourceKind: 'hr_company', credential: '0123456789abcdef0123456789abcdef' },
      hr,
    )
    expect(strongWebhook.webhookSecretOnce === '0123456789abcdef0123456789abcdef', 'supplied webhook secret is returned once')
    pass('32-char hex webhook secret is accepted on write')

    await expectCode(
      () => partner.rotatePartnerDataSourceCredential(strongWebhook.id, {} as RotateDataSourceCredentialDto, hr),
      'CREDENTIAL_ROTATION_CONFIRMATION_REQUIRED',
      'Empty rotate body cannot mint a new webhook secret',
    )

    await partner.archivePartnerDataSource(strongWebhook.id, true, hr)
    await expectCode(
      () => partner.rotatePartnerDataSourceCredential(
        strongWebhook.id,
        { confirmPhrase: ROTATE_CREDENTIAL_CONFIRMATION },
        hr,
      ),
      'DATA_SOURCE_ARCHIVED',
      'Archived sources cannot be rotated — archive is the freeze/止血 path',
    )
    await partner.archivePartnerDataSource(strongWebhook.id, false, hr)

    const agedAt = new Date(Date.now() - 20 * 60 * 1000)
    await prisma.jobSource.update({
      where: { id: strongWebhook.id },
      data: { createdAt: agedAt, webhookSecretRotatedAt: agedAt },
    })
    const rotated = await partner.rotatePartnerDataSourceCredential(
      strongWebhook.id,
      { confirmPhrase: ROTATE_CREDENTIAL_CONFIRMATION },
      hr,
    )
    expect(typeof rotated.webhookSecretOnce === 'string' && rotated.webhookSecretOnce.length >= 32, 'confirmed rotate returns a new secret once')
    await expectCode(
      () => partner.rotatePartnerDataSourceCredential(
        strongWebhook.id,
        { confirmPhrase: ROTATE_CREDENTIAL_CONFIRMATION },
        hr,
      ),
      'CREDENTIAL_ROTATION_COOLDOWN',
      'Aged source cannot be rotated twice inside the cooldown window',
    )

    const school = partnerUser(orgIds.school)
    const schoolSourceIds: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const created = await partner.createPartnerDataSource(
        { name: `School webhook ${i}`, accessMode: 'webhook', sourceKind: 'school' },
        school,
      )
      schoolSourceIds.push(created.id)
      await prisma.jobSource.update({
        where: { id: created.id },
        data: { createdAt: agedAt, webhookSecretRotatedAt: agedAt },
      })
    }
    for (let i = 0; i < 3; i += 1) {
      await partner.rotatePartnerDataSourceCredential(
        schoolSourceIds[i]!,
        { confirmPhrase: ROTATE_CREDENTIAL_CONFIRMATION },
        school,
      )
    }
    await expectCode(
      () => partner.rotatePartnerDataSourceCredential(
        schoolSourceIds[3]!,
        { confirmPhrase: ROTATE_CREDENTIAL_CONFIRMATION },
        school,
      ),
      'CREDENTIAL_ROTATION_RATE_LIMITED',
      'Org-level rotation cap stops a stolen JWT from burning every webhook in one window',
    )
  } finally {
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: Object.values(orgIds) } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: Object.values(orgIds) } } })
    await prisma.syncLog.deleteMany({ where: { orgId: { in: Object.values(orgIds) } } })
    await prisma.importBatch.deleteMany({ where: { orgId: { in: Object.values(orgIds) } } })
    await prisma.jobSource.deleteMany({ where: { orgId: { in: Object.values(orgIds) } } })
    await prisma.organization.deleteMany({ where: { id: { in: Object.values(orgIds) } } })
    await prisma.onModuleDestroy()
  }

  console.log('\nAll Partner source capability checks passed.\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
