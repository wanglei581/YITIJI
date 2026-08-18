/**
 * 内容信息库端到端验证的夹具:两个来源机构(可信 / 未标记)、两个内部账号、
 * 六种 accessMode 的 JobSource。
 *
 * 为什么不复用 prisma/seed.ts:seed 是**演示数据**,带 demo 守卫(verify:demo-seed-guard),
 * 且会写进共享 dev.db。本验证要的是「本次运行独有、跑完删干净」的夹具,
 * 所有 id 都带 run 后缀,cleanup 按前缀删,不依赖 seed 是否跑过。
 */
import type { PrismaService } from '../../src/prisma/prisma.service'
import { encryptSecret } from '../../src/common/crypto/secret-cipher'
import { hashPassword, FIXTURE_PREFIX } from './content-pipeline-harness'

export interface Fixtures {
  /** contentTrustStatus='active' 且未归档 —— 内容应当能一路发布 */
  trustedOrgId: string
  /** contentTrustStatus=null —— fail-closed,内容必须被发布闸门拦下 */
  untrustedOrgId: string
  adminUsername: string
  partnerUsername: string
  /** 未可信机构下的 partner 账号(用于验「不可信机构的内容也能录入,只是发不出去」) */
  untrustedPartnerUsername: string
  password: string
  /** accessMode → JobSource id(可信机构下) */
  sources: Record<string, string>
  /** 未可信机构下的 manual 源 */
  untrustedManualSourceId: string
  /** webhook 源的明文 secret(只有创建时知道) */
  webhookSecret: string
}

const PASSWORD = 'Verify-Cpe2e-2026!'

export async function createFixtures(prisma: PrismaService, run: string): Promise<Fixtures> {
  const trustedOrgId = `${FIXTURE_PREFIX}-org-trusted-${run}`
  const untrustedOrgId = `${FIXTURE_PREFIX}-org-untrusted-${run}`
  const webhookSecret = `whsec-${run}-0123456789abcdef`
  const passwordHash = await hashPassword(PASSWORD)

  // public_employment_service 在 partner-capabilities 里允许全部 6 种 accessMode,
  // 且 canImportJobs / canImportFairs 都为 true —— 一个机构就能覆盖矩阵大部分格子。
  // 政策录入还额外要求 org.type ∈ {public_employment_service, school_employment_center}。
  await prisma.organization.create({
    data: {
      id: trustedOrgId,
      name: `E2E可信来源机构-${run}`,
      type: 'public_employment_service',
      enabled: true,
      // 注意:这里直接写 active 是**夹具**,不是被验对象。
      // 「运营怎么把机构标成可信」由 PATCH /admin/orgs/:id/content-trust 单独验(见 §5)。
      contentTrustStatus: 'active',
      contentTrustReason: 'E2E 夹具:模拟已完成授权核验的机构',
    },
  })
  await prisma.organization.create({
    data: {
      id: untrustedOrgId,
      name: `E2E未核验来源机构-${run}`,
      type: 'public_employment_service',
      enabled: true,
      // contentTrustStatus 刻意留 null —— 这正是 8/17 事故里那种「没人核验过」的机构。
    },
  })

  const adminUsername = `${FIXTURE_PREFIX}-admin-${run}`
  const partnerUsername = `${FIXTURE_PREFIX}-partner-${run}`
  const untrustedPartnerUsername = `${FIXTURE_PREFIX}-partner-nt-${run}`
  await prisma.user.create({
    data: { username: adminUsername, passwordHash, name: 'E2E管理员', role: 'admin', enabled: true },
  })
  await prisma.user.create({
    data: { username: partnerUsername, passwordHash, name: 'E2E机构运营', role: 'partner', orgId: trustedOrgId, enabled: true },
  })
  await prisma.user.create({
    data: {
      username: untrustedPartnerUsername, passwordHash, name: 'E2E未核验机构运营',
      role: 'partner', orgId: untrustedOrgId, enabled: true,
    },
  })

  // 六种 accessMode 各建一个源。sourceKind 必须落在该 orgType 的白名单里
  // (public_employment_service → ['aggregator','manual'])。
  const sources: Record<string, string> = {}
  for (const mode of ['api', 'excel', 'csv', 'json', 'webhook', 'manual'] as const) {
    const id = `${FIXTURE_PREFIX}-src-${mode}-${run}`
    await prisma.jobSource.create({
      data: {
        id,
        orgId: trustedOrgId,
        name: `E2E-${mode}源`,
        sourceKind: mode === 'manual' ? 'manual' : 'aggregator',
        accessMode: mode,
        enabled: true,
        syncEnabled: mode === 'api',
        ...(mode === 'webhook' ? { webhookSecret: encryptSecret(webhookSecret) } : {}),
      },
    })
    sources[mode] = id
  }

  const untrustedManualSourceId = `${FIXTURE_PREFIX}-src-manual-nt-${run}`
  await prisma.jobSource.create({
    data: {
      id: untrustedManualSourceId,
      orgId: untrustedOrgId,
      name: 'E2E-未核验机构manual源',
      sourceKind: 'manual',
      accessMode: 'manual',
      enabled: true,
    },
  })

  return {
    trustedOrgId,
    untrustedOrgId,
    adminUsername,
    partnerUsername,
    untrustedPartnerUsername,
    password: PASSWORD,
    sources,
    untrustedManualSourceId,
    webhookSecret,
  }
}

/**
 * 按 run 后缀清理。顺序服从外键:内容 → 批次/日志 → 源 → 账号 → 机构。
 * 清理失败必须显式报出来 —— 残留的 approved+published 测试岗位会泄漏到公开前台。
 */
export async function cleanupFixtures(prisma: PrismaService, run: string): Promise<void> {
  const like = { contains: run }
  const orgIds = [`${FIXTURE_PREFIX}-org-trusted-${run}`, `${FIXTURE_PREFIX}-org-untrusted-${run}`]

  const batches = await prisma.importBatch.findMany({
    where: { orgId: { in: orgIds } },
    select: { id: true },
  })
  const batchIds = batches.map((b) => b.id)
  if (batchIds.length) {
    await prisma.importRecord.deleteMany({ where: { batchId: { in: batchIds } } })
    await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } })
  }
  await prisma.policyEligibilityRule.deleteMany({ where: { policy: { sourceOrgId: { in: orgIds } } } })
  await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
  await prisma.job.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
  await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
  await prisma.syncLog.deleteMany({ where: { orgId: { in: orgIds } } })
  await prisma.fieldMappingRule.deleteMany({ where: { sourceId: { contains: FIXTURE_PREFIX } } })
  await prisma.browseLog.deleteMany({ where: { endUserId: { contains: run } } })
  await prisma.externalJumpLog.deleteMany({ where: { endUserId: { contains: run } } })
  await prisma.endUser.deleteMany({ where: { id: { contains: run } } })
  await prisma.jobSource.deleteMany({ where: { orgId: { in: orgIds } } })
  await prisma.auditLog.deleteMany({ where: { actorId: { contains: run } } })
  await prisma.user.deleteMany({ where: { username: like } })
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
}
