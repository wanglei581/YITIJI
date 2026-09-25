/**
 * 紧急下架覆盖招聘会资料与线下机构，机构熔断把这两类已发布内容一并下架。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:recruitment-emergency-scope
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { RecruitmentEmergencyService } from '../src/recruitment-hosting/recruitment-emergency.service'
import { EmergencyTakedownDto } from '../src/recruitment-hosting/recruitment-emergency.controller'
import { OfflineAgenciesService } from '../src/offline-agencies/offline-agencies.service'
import { FairMaterialService } from '../src/jobs/fair-material.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(`FAIL ${message}`) }

function errCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
  return response?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string) {
  try {
    await fn()
    fail(`${label} — 期望 ${code}，但未抛`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FAIL ')) throw error
    const got = errCode(error)
    if (got === code) pass(`${label} → ${code}`)
    else fail(`${label} — 期望 ${code}，实际 ${got ?? (error as Error).message}`)
  }
}

async function main() {
  assertIsolatedVerificationDatabase()
  process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'true'
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const emergency = new RecruitmentEmergencyService(prisma, audit)
  const agencies = new OfflineAgenciesService(prisma)
  const materials = new FairMaterialService(
    prisma,
    audit,
    { deleteObject: async () => undefined } as never,
    { revokeForMaterial: async () => undefined, revokeForFair: async () => undefined } as never,
  )
  const sfx = randomBytes(4).toString('hex')
  const orgId = `org_em_${sfx}`
  const userId = `admin_em_${sfx}`
  const actor: AuthedUser = { userId, role: 'admin', orgId: null }
  const fairId = `fair_em_${sfx}`
  const materialId = `mat_em_${sfx}`
  const draftMaterialId = `mat_draft_${sfx}`
  const agencyId = `agency_em_${sfx}`
  const circuitMaterialId = `mat_cb_${sfx}`
  const circuitAgencyId = `agency_cb_${sfx}`

  const dto = plainToInstance(EmergencyTakedownDto, {
    targetType: 'fair_material',
    targetId: materialId,
    reasonCode: 'illegal_content',
    reasonText: '资料含违法内容',
  })
  if (validateSync(dto).length !== 0) fail('1. 下架 DTO 不接受招聘会资料')
  const agencyDto = plainToInstance(EmergencyTakedownDto, {
    targetType: 'offline_agency',
    targetId: agencyId,
    reasonCode: 'false_information',
    reasonText: '线下机构信息不实',
  })
  if (validateSync(agencyDto).length !== 0) fail('1b. 下架 DTO 不接受线下机构')
  pass('1. 下架 DTO 接受招聘会资料与线下机构')

  async function cleanup() {
    await prisma.partnerOrgNotice.deleteMany({ where: { orgId } }).catch(() => undefined)
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { orgId } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { actorId: userId } }).catch(() => undefined)
    await prisma.fairMaterial.deleteMany({ where: { jobFairId: fairId } }).catch(() => undefined)
    await prisma.offlineAgency.deleteMany({ where: { sourceOrgId: orgId } }).catch(() => undefined)
    await prisma.jobFair.deleteMany({ where: { id: fairId } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
  }

  try {
    await cleanup()
    await prisma.organization.create({
      data: { id: orgId, name: '熔断验证机构', type: 'licensed_hr_agency', contentTrustStatus: 'active' },
    })
    await prisma.user.create({
      data: { id: userId, username: `em_${sfx}`, passwordHash: 'x', name: '下架管理员', role: 'admin' },
    })
    const now = new Date()
    await prisma.jobFair.create({
      data: {
        id: fairId,
        sourceOrgId: orgId,
        externalId: `fair-${sfx}`,
        sourceName: '熔断验证机构',
        sourceUrl: 'https://example.com/fair',
        title: '验证招聘会',
        startAt: now,
        endAt: new Date(now.getTime() + 86_400_000),
        venue: '会场',
        city: '青岛',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    const materialData = {
      jobFairId: fairId,
      type: 'other',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      sha256: 'abc',
      storageKey: '',
    }
    await prisma.fairMaterial.create({
      data: { ...materialData, id: materialId, name: '已发布资料', storageKey: `k/${materialId}`, publishStatus: 'published' },
    })
    await prisma.fairMaterial.create({
      data: { ...materialData, id: draftMaterialId, name: '草稿资料', storageKey: `k/${draftMaterialId}`, publishStatus: 'draft', sha256: 'def' },
    })
    await prisma.fairMaterial.create({
      data: { ...materialData, id: circuitMaterialId, name: '熔断资料', storageKey: `k/${circuitMaterialId}`, publishStatus: 'published', sha256: 'ghi' },
    })
    await prisma.offlineAgency.create({
      data: {
        id: agencyId, name: '已发布线下机构', address: '青岛市市南区', sourceOrgId: orgId,
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    await prisma.offlineAgency.create({
      data: {
        id: circuitAgencyId, name: '熔断线下机构', address: '青岛市市北区', sourceOrgId: orgId,
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })

    await emergency.takedown('fair_material', materialId, 'illegal_content', '资料含违法内容', actor)
    const material = await prisma.fairMaterial.findUnique({ where: { id: materialId } })
    const materialHold = await prisma.recruitmentEmergencyHold.findFirst({ where: { targetType: 'fair_material', targetId: materialId } })
    if (material?.publishStatus !== 'unpublished' || !materialHold) fail('2. 招聘会资料下架后未下架或未写 hold')
    pass('2. 招聘会资料可以紧急下架并写入 hold')
    await expectCode(
      () => materials.publishMaterial(fairId, materialId, 'publish', actor),
      'EMERGENCY_TAKEDOWN_IRREVERSIBLE',
      '3. 招聘会资料下架后不能再发布',
    )

    await emergency.takedown('offline_agency', agencyId, 'false_information', '线下机构信息不实', actor)
    const agency = await prisma.offlineAgency.findUnique({ where: { id: agencyId } })
    const agencyHold = await prisma.recruitmentEmergencyHold.findFirst({ where: { targetType: 'offline_agency', targetId: agencyId } })
    if (agency?.publishStatus !== 'unpublished' || !agencyHold) fail('4. 线下机构下架后未下架或未写 hold')
    pass('4. 线下机构可以紧急下架并写入 hold')
    await expectCode(
      () => agencies.adminPublish(agencyId, 'published'),
      'EMERGENCY_TAKEDOWN_IRREVERSIBLE',
      '5. 线下机构下架后不能再发布',
    )

    await emergency.circuitBreak('org', orgId, 'authority_order', '机构范围熔断', actor)
    const circuitMaterial = await prisma.fairMaterial.findUnique({ where: { id: circuitMaterialId } })
    const circuitAgency = await prisma.offlineAgency.findUnique({ where: { id: circuitAgencyId } })
    const draftMaterial = await prisma.fairMaterial.findUnique({ where: { id: draftMaterialId } })
    const materialCircuitHold = await prisma.recruitmentEmergencyHold.findFirst({ where: { targetType: 'fair_material', targetId: circuitMaterialId } })
    const agencyCircuitHold = await prisma.recruitmentEmergencyHold.findFirst({ where: { targetType: 'offline_agency', targetId: circuitAgencyId } })
    if (circuitMaterial?.publishStatus !== 'unpublished' || !materialCircuitHold) fail('6. 机构熔断没有下架招聘会资料')
    if (circuitAgency?.publishStatus !== 'unpublished' || !agencyCircuitHold) fail('6b. 机构熔断没有下架线下机构')
    if (draftMaterial?.publishStatus !== 'draft') fail('6c. 本条只要求已发布内容；草稿不应被误改')
    pass('6. 机构熔断覆盖已发布的招聘会资料与线下机构')
    const notices = await prisma.partnerOrgNotice.count({ where: { orgId, kind: 'recruitment_emergency_takedown' } })
    if (notices < 4) fail(`7. 下架通知不足，实际 ${notices}`)
    pass('7. 招聘会资料与线下机构下架都通知了机构')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
