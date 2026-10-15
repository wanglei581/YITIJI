import 'dotenv/config'
import { createHmac } from 'crypto'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { decryptSecret, generateWebhookSecret } from '../src/common/crypto/secret-cipher'
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

async function expectException(
  matches: (error: unknown) => boolean,
  expected: string,
  run: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (matches(error)) {
      pass(message)
      return
    }
    throw error
  }
  throw new Error(`${message}: expected ${expected}`)
}

function expectForbidden(run: () => Promise<unknown>, message: string): Promise<void> {
  return expectException((error) => error instanceof ForbiddenException, 'ForbiddenException', run, message)
}

function expectNotFound(run: () => Promise<unknown>, message: string): Promise<void> {
  return expectException((error) => error instanceof NotFoundException, 'NotFoundException', run, message)
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

    // ── 凭证与密钥处理契约 ────────────────────────────────────
    // 覆盖 W3 BE-8 的安全性质:密钥只在创建响应回显一次、落库必须是密文、
    // 一次性回显的那把密钥正是 Webhook 验签实际使用的密钥。
    // 签名构造与 services/api/src/sync/sync.service.ts 的 HMAC 校验保持同构。

    // 空串兜底:后续断言都不再需要非空断言,断言失败即直接暴露"没回显密钥"。
    const webhookSecretOnce = webhookSource.webhookSecretOnce ?? ''
    expect(webhookSecretOnce.length >= 32, 'create must return webhookSecretOnce for a webhook source')

    const apiCredential = `verify-partner-api-credential-${suffix}`
    const apiSource = await partner.createPartnerDataSource(
      {
        name: 'School API',
        accessMode: 'api',
        sourceKind: 'school',
        endpoint: 'https://example.edu/api/jobs',
        authType: 'bearer',
        credential: apiCredential,
      },
      partnerUser(orgIds.school),
    )
    expect(apiSource.credentialConfigured, 'API source must record credentialConfigured')
    expect(apiSource.webhookSecretOnce === undefined, 'API source must not return webhookSecretOnce')

    // 整串 JSON 扫描,而不是只看字段:字段改名或多挂一层嵌套都不能让密钥漏出去。
    // credentialConfigured 断言是反空转保险 —— 证明这个源确实有密钥,扫不到不是因为没配。
    const hrList = await partner.getPartnerDataSources(partnerUser(orgIds.hr))
    const hrListJson = JSON.stringify(hrList)
    const listedWebhook = hrList.find((row) => row.id === webhookSource.id)
    expect(listedWebhook?.credentialConfigured, 'listed webhook source must report credentialConfigured')
    expect(!hrListJson.includes(webhookSecretOnce), 'webhook secret leaked into the data source list JSON')
    expect(!hrListJson.includes('webhookSecret'), 'list JSON must not carry any webhookSecret field')

    const schoolList = await partner.getPartnerDataSources(partnerUser(orgIds.school))
    const schoolListJson = JSON.stringify(schoolList)
    const listedApi = schoolList.find((row) => row.id === apiSource.id)
    expect(listedApi?.credentialConfigured, 'listed API source must report credentialConfigured')
    expect(!schoolListJson.includes(apiCredential), 'API credential leaked into the data source list JSON')
    pass('Secrets are echoed once on create and never appear anywhere in the list response JSON')

    // secret-cipher 的容器格式:base64(iv):base64(ciphertext):base64(authTag)
    const CIPHER_CONTAINER = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/
    const storedWebhookRow = await prisma.jobSource.findUniqueOrThrow({ where: { id: webhookSource.id } })
    const storedWebhookSecret = storedWebhookRow.webhookSecret ?? ''
    expect(storedWebhookSecret.length > 0, 'webhook source must persist a secret column')
    expect(!storedWebhookSecret.includes(webhookSecretOnce), 'webhook secret persisted in plaintext')
    expect(CIPHER_CONTAINER.test(storedWebhookSecret), 'webhook secret is not an AES-256-GCM container')
    expect(decryptSecret(storedWebhookSecret) === webhookSecretOnce, 'stored webhook secret does not decrypt to the echoed one')

    const storedApiRow = await prisma.jobSource.findUniqueOrThrow({ where: { id: apiSource.id } })
    const storedApiCredential = storedApiRow.encryptedCredential ?? ''
    expect(storedApiCredential.length > 0, 'API source must persist a credential column')
    expect(!storedApiCredential.includes(apiCredential), 'partner-supplied credential persisted in plaintext')
    expect(CIPHER_CONTAINER.test(storedApiCredential), 'partner credential is not an AES-256-GCM container')
    expect(decryptSecret(storedApiCredential) === apiCredential, 'stored credential does not decrypt to the submitted value')
    pass('Partner-supplied credential and webhook secret are both stored as ciphertext, not plaintext')

    // 与 sync.service.ts 的验签同构:HMAC-SHA256 over `${ts}.${rawBody}`。
    // 这条锁死"发给合作机构的那把密钥 == 真正能通过验签的密钥",
    // 并证明任何其他密钥都算不出同一个签名。
    const signedTs = '1756900000000'
    const signedBody = JSON.stringify({ items: [{ externalId: `verify-hmac-${suffix}`, title: 'Verify' }] })
    const signWith = (secret: string): string =>
      createHmac('sha256', secret).update(`${signedTs}.${signedBody}`).digest('hex')
    const expectedSignature = signWith(webhookSecretOnce)
    expect(signWith(decryptSecret(storedWebhookSecret)) === expectedSignature, 'stored secret does not reproduce the webhook signature')
    expect(signWith(generateWebhookSecret()) !== expectedSignature, 'an unrelated secret produced a matching signature')
    pass('The once-echoed secret is exactly the key that validates webhook signatures; any other key fails')

    const createEvents = auditEvents.filter((event) => event.action === 'data_source.create')
    expect(createEvents.length >= 2, 'data_source.create audit events missing')
    const createEventsJson = JSON.stringify(createEvents)
    expect(!createEventsJson.includes(webhookSecretOnce), 'creation audit event carries the webhook secret')
    expect(!createEventsJson.includes(apiCredential), 'creation audit event carries the API credential')
    expect(
      createEvents.some((event) => event.payload?.['credentialConfigured'] === true),
      'creation audit must record credentialConfigured',
    )
    pass('Data source audit records credentialConfigured only, with no secret material in the payload')

    // 跨机构只能是 404:不能用 403 把"这个 id 存在"泄漏出去。
    await expectNotFound(
      () => partner.togglePartnerDataSource(fileSource.id, partnerUser(orgIds.school)),
      'Cross-org access to another org data source is a 404, not an existence leak',
    )
  } finally {
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: Object.values(orgIds) } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: Object.values(orgIds) } } })
    await prisma.syncLog.deleteMany({ where: { orgId: { in: Object.values(orgIds) } } })
    await prisma.importBatch.deleteMany({ where: { orgId: { in: Object.values(orgIds) } } })
    await prisma.fieldMappingRule.deleteMany({ where: { orgId: { in: Object.values(orgIds) } } })
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
