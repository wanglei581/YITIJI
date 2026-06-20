/**
 * Kiosk /campus 本校招聘会优先验证。
 *
 * 覆盖:
 *   1. GET /job-fairs 默认无 terminalId 时仍按原公开列表排序(startAt asc)。
 *   2. terminalId/terminalCode 归属到启用学校机构时,该学校招聘会排在其它公开招聘会前。
 *   3. 终端不存在 / 未绑定机构 / 非学校机构 / 停用机构 / 本校无场次时,降级为原公开排序。
 *   4. 本校优先只是展示排序,不隐藏其它公开招聘会。
 *   5. pending/draft 等未审核未发布招聘会不泄露。
 *   6. 本校已结束场次不抢占进行中/未结束场次,跨本校/其它边界分页无重漏。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:jobfair-campus-priority
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

const RESIDUE_TAG = 'vresidcampuspriority'

function pass(m: string): void { console.log(`  PASS ${m}`) }
function fail(m: string): never { throw new Error(`FAIL ${m}`) }

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.terminal.deleteMany({
    where: {
      OR: [
        { id: { contains: RESIDUE_TAG } },
        { terminalCode: { contains: RESIDUE_TAG } },
      ],
    },
  })
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)
}

function idsInOrder(actualIds: string[], expectedIds: string[]): boolean {
  const actual = actualIds.filter((id) => expectedIds.includes(id))
  return actual.length === expectedIds.length && actual.every((id, i) => id === expectedIds[i])
}

function assertOrder(actualIds: string[], expectedIds: string[], label: string): void {
  if (!idsInOrder(actualIds, expectedIds)) {
    fail(`${label}: 期望 ${expectedIds.join(' > ')},实际 ${actualIds.filter((id) => expectedIds.includes(id)).join(' > ')}`)
  }
  pass(label)
}

async function main(): Promise<void> {
  console.log('\n=== Kiosk /campus 本校招聘会优先验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new JobsService(prisma, new AuditService(prisma))

  await cleanup(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const schoolA = `org_vjcp_${RESIDUE_TAG}_school_a_${suffix}`
  const schoolB = `org_vjcp_${RESIDUE_TAG}_school_b_${suffix}`
  const schoolNoFair = `org_vjcp_${RESIDUE_TAG}_school_empty_${suffix}`
  const nonSchool = `org_vjcp_${RESIDUE_TAG}_nonschool_${suffix}`
  const disabledSchool = `org_vjcp_${RESIDUE_TAG}_disabled_${suffix}`
  const terminalAId = `terminal_${RESIDUE_TAG}_a_${suffix}`
  const terminalACode = `KSK_${RESIDUE_TAG}_A_${suffix}`
  const terminalEmptyCode = `KSK_${RESIDUE_TAG}_EMPTY_${suffix}`
  const terminalUnboundCode = `KSK_${RESIDUE_TAG}_UNBOUND_${suffix}`
  const terminalNonSchoolCode = `KSK_${RESIDUE_TAG}_NONSCHOOL_${suffix}`
  const terminalDisabledCode = `KSK_${RESIDUE_TAG}_DISABLED_${suffix}`

  try {
    await prisma.organization.createMany({
      data: [
        { id: schoolA, name: `验证学校A_${suffix}`, type: 'school_employment_center' },
        { id: schoolB, name: `验证学校B_${suffix}`, type: 'school_employment_center' },
        { id: schoolNoFair, name: `验证无场次学校_${suffix}`, type: 'school_employment_center' },
        { id: nonSchool, name: `验证非学校机构_${suffix}`, type: 'public_employment_service' },
        { id: disabledSchool, name: `验证停用学校_${suffix}`, type: 'school_employment_center', enabled: false },
      ],
    })

    await prisma.terminal.createMany({
      data: [
        { id: terminalAId, terminalCode: terminalACode, agentToken: `token-${terminalAId}`, deviceFingerprint: `fp-${terminalAId}`, orgId: schoolA },
        { id: `terminal_${RESIDUE_TAG}_empty_${suffix}`, terminalCode: terminalEmptyCode, agentToken: `token-empty-${suffix}`, deviceFingerprint: `fp-empty-${suffix}`, orgId: schoolNoFair },
        { id: `terminal_${RESIDUE_TAG}_unbound_${suffix}`, terminalCode: terminalUnboundCode, agentToken: `token-unbound-${suffix}`, deviceFingerprint: `fp-unbound-${suffix}`, orgId: null },
        { id: `terminal_${RESIDUE_TAG}_nonschool_${suffix}`, terminalCode: terminalNonSchoolCode, agentToken: `token-nonschool-${suffix}`, deviceFingerprint: `fp-nonschool-${suffix}`, orgId: nonSchool },
        { id: `terminal_${RESIDUE_TAG}_disabled_${suffix}`, terminalCode: terminalDisabledCode, agentToken: `token-disabled-${suffix}`, deviceFingerprint: `fp-disabled-${suffix}`, orgId: disabledSchool },
      ],
    })

    const now = Date.now()
    const mkFair = (label: string, orgId: string, startOffsetMs: number, visible = true) =>
      prisma.jobFair.create({
        data: {
          sourceOrgId: orgId,
          externalId: `VJCP-${label}-${suffix}`,
          sourceName: '验证来源',
          sourceUrl: 'https://example.org/fairs',
          title: `验证校园双选会_${label}_${suffix}`,
          theme: 'campus',
          startAt: new Date(now + startOffsetMs),
          endAt: new Date(now + startOffsetMs + 3_600_000),
          venue: '验证体育馆',
          city: '验证市',
          reviewStatus: visible ? 'approved' : 'pending',
          publishStatus: visible ? 'published' : 'draft',
        },
      })

    const fairB = await mkFair('school-b-earliest', schoolB, -1_000 * 86_400_000)
    const fairOther = await mkFair('public-service-middle', nonSchool, -999 * 86_400_000)
    const endedFairA = await mkFair('school-a-ended', schoolA, -5 * 86_400_000)
    const activeOther = await mkFair('public-service-active', nonSchool, 1 * 86_400_000)
    const fairA = await mkFair('school-a-latest', schoolA, 5 * 86_400_000)
    const hiddenFairA = await mkFair('school-a-hidden', schoolA, -1 * 86_400_000, false)
    const testVisibleIds = [endedFairA.id, fairB.id, fairOther.id, activeOther.id, fairA.id]
    const fallbackOrder = [fairB.id, fairOther.id, endedFairA.id, activeOther.id, fairA.id]
    const terminalFallbackOrder = [activeOther.id, fairA.id, endedFairA.id, fairOther.id, fairB.id]
    const schoolAOrder = [fairA.id, endedFairA.id, activeOther.id, fairOther.id, fairB.id]

    type FairQuery = NonNullable<Parameters<JobsService['getPublishedFairs']>[0]> & { terminalId?: string }

    const defaultList = await svc.getPublishedFairs({ pageSize: 100 })
    const defaultIds = defaultList.data.map((f) => f.id)
    assertOrder(defaultIds, fallbackOrder, '1. 默认无 terminalId 保持公开列表 startAt asc')

    const byCode = await svc.getPublishedFairs({ pageSize: 100, terminalId: terminalACode } as FairQuery)
    const byCodeIds = byCode.data.map((f) => f.id)
    assertOrder(byCodeIds, schoolAOrder, '2a. terminalCode → 学校A → 本校招聘会优先')
    if (byCodeIds.indexOf(endedFairA.id) < byCodeIds.indexOf(fairA.id)) fail('2a. 本校已结束场次不应排在未结束场次前')
    pass('2a. 本校未结束场次优先于已结束场次')
    if (byCodeIds.indexOf(activeOther.id) < byCodeIds.indexOf(endedFairA.id)) fail('2a. 本校已结束场次应优先于其它机构未结束场次')
    pass('2a. 本校已结束场次仍优先于其它机构未结束场次')
    if (!byCodeIds.includes(fairB.id) || !byCodeIds.includes(fairOther.id)) fail('4. 本校优先不应隐藏其它公开招聘会')
    pass('4. 其它公开招聘会仍保留,只是排在本校之后')

    const byId = await svc.getPublishedFairs({ pageSize: 100, terminalId: terminalAId } as FairQuery)
    assertOrder(byId.data.map((f) => f.id), schoolAOrder, '2b. terminalId → 学校A → 本校招聘会优先')

    const fallbackInputs = [
      ['终端不存在', `missing_${RESIDUE_TAG}_${suffix}`],
      ['终端未绑定机构', terminalUnboundCode],
      ['非学校机构终端', terminalNonSchoolCode],
      ['停用学校终端', terminalDisabledCode],
      ['本校无公开场次', terminalEmptyCode],
    ] as const
    for (const [label, terminalId] of fallbackInputs) {
      const res = await svc.getPublishedFairs({ pageSize: 100, terminalId } as FairQuery)
      assertOrder(res.data.map((f) => f.id), terminalFallbackOrder, `3. ${label} → 降级为终端公开未结束优先排序`)
    }

    const pagedIds: string[] = []
    for (let page = 1; page <= 20 && !schoolAOrder.every((id) => pagedIds.includes(id)); page++) {
      const res = await svc.getPublishedFairs({ pageSize: 2, page, terminalId: terminalACode } as FairQuery)
      pagedIds.push(...res.data.map((f) => f.id))
    }
    assertOrder(pagedIds, schoolAOrder, '4b. 小 pageSize 跨本校/其它边界分页无重漏')

    const noLeak = await svc.getPublishedFairs({ pageSize: 100, terminalId: terminalACode } as FairQuery)
    if (noLeak.data.some((f) => f.id === hiddenFairA.id)) fail('5. pending/draft 招聘会泄露到了 Kiosk 列表')
    pass('5. 未审核未发布招聘会不泄露')

    const visibleHitCount = noLeak.data.filter((f) => testVisibleIds.includes(f.id)).length
    if (visibleHitCount !== testVisibleIds.length) fail(`公开测试招聘会应全部可见,实际 ${visibleHitCount}/${testVisibleIds.length}`)
    pass('6. 本校优先仅改变排序,不改变公开可见集合')
  } finally {
    await cleanup(prisma)
    await prisma.onModuleDestroy()
  }
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})
