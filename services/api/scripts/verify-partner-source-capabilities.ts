import 'dotenv/config'
import { ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobSyncService } from '../src/job-sync/job-sync.service'
import type { AuditService } from '../src/audit/audit.service'
import type { JobQualityService } from '../src/job-ai/job-quality.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

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
