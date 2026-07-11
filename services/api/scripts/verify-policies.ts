/**
 * 阶段1D — 政策服务(Partner 录入 → Admin 审核 → Kiosk 展示)验证。
 *
 * 覆盖(对应需求验收点):
 *   1. 字段约束:policy_guide 缺 audience → AUDIENCE_REQUIRED;notice 缺 category → CATEGORY_REQUIRED。
 *   2. 创建默认 pending+draft;Kiosk 公开列表不可见。
 *   3. Admin approve + publish → Kiosk 可见;kind/audience 过滤生效。
 *   4. 未过审发布 → PUBLISH_REQUIRES_APPROVAL;reject 必填原因。
 *   5. Partner 编辑 → 强制回 pending+draft,Kiosk 立即不可见。
 *   6. 越权:他机构编辑/删除 → POLICY_NOT_FOUND。
 *   7. Partner 下架/删除生效。
 *   8. 审计:policy.create / partner_update / review / publish / unpublish / delete 齐全。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:policies
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService } from '../src/policies/policies.service'
import { CreatePolicyPostDto, POLICY_AUDIENCES } from '../src/policies/dto/policy.dto'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== 阶段1D 政策服务验证 ===')

  // ── 0. DTO 白名单（class-validator 层;Service 直调会绕过,须单独断言）────────
  {
    if (!(POLICY_AUDIENCES as readonly string[]).includes('flexible')) fail('0a. POLICY_AUDIENCES 缺 flexible')
    const okDto = plainToInstance(CreatePolicyPostDto, {
      kind: 'policy_guide', title: 'DTO白名单验证', audience: 'flexible',
    })
    if ((await validate(okDto)).length === 0) pass('0a. DTO 接受 audience=flexible')
    else fail('0a. DTO 应接受 audience=flexible')
    const badDto = plainToInstance(CreatePolicyPostDto, {
      kind: 'policy_guide', title: 'DTO白名单验证', audience: 'not_a_real_audience',
    })
    if ((await validate(badDto)).some((e) => e.property === 'audience')) pass('0b. DTO 拒绝非法 audience')
    else fail('0b. DTO 应拒绝非法 audience')
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const svc = new PoliciesService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgA = `org_vpo_a_${suffix}`
  const orgB = `org_vpo_b_${suffix}`

  await prisma.organization.createMany({
    data: [
      { id: orgA, name: `政策机构A_${suffix}`, type: 'public_employment_service' },
      { id: orgB, name: `政策机构B_${suffix}`, type: 'public_employment_service' },
    ],
  })
  const partnerARow = await prisma.user.create({
    data: { username: `vpo_pa_${suffix}`, passwordHash: 'x', name: 'A机构账号', role: 'partner', orgId: orgA },
  })
  const partnerBRow = await prisma.user.create({
    data: { username: `vpo_pb_${suffix}`, passwordHash: 'x', name: 'B机构账号', role: 'partner', orgId: orgB },
  })
  const adminRow = await prisma.user.create({
    data: { username: `vpo_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const partnerA: AuthedUser = { userId: partnerARow.id, role: 'partner', orgId: orgA }
  const partnerB: AuthedUser = { userId: partnerBRow.id, role: 'partner', orgId: orgB }
  const admin: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  const cleanup = async () => {
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [partnerA.userId, partnerB.userId, admin.userId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [partnerA.userId, partnerB.userId, admin.userId] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    // ── 1. 字段约束 ────────────────────────────────────────────────────────
    await expectCode(
      () => svc.createPartnerPolicy({ kind: 'policy_guide', title: '缺人群' }, partnerA),
      'AUDIENCE_REQUIRED',
      '1a. policy_guide 缺 audience 被拒',
    )
    await expectCode(
      () => svc.createPartnerPolicy({ kind: 'notice', title: '缺标签' }, partnerA),
      'CATEGORY_REQUIRED',
      '1b. notice 缺 category 被拒',
    )

    // ── 2. 创建默认 pending+draft,Kiosk 不可见 ────────────────────────────
    const guide = await svc.createPartnerPolicy(
      { kind: 'policy_guide', title: `验证扶持_${suffix}`, audience: 'graduate', summary: '验证摘要' },
      partnerA,
    )
    const noticePost = await svc.createPartnerPolicy(
      { kind: 'notice', title: `验证公告_${suffix}`, category: 'notice', publishedDate: '2026-06-10' },
      partnerA,
    )
    if (guide.reviewStatus !== 'pending' || guide.publishStatus !== 'draft') fail('2. 创建默认状态错误')
    {
      const kiosk = await svc.getPublishedPolicies()
      if (kiosk.data.some((p) => p.id === guide.id || p.id === noticePost.id)) fail('2. 未审核内容泄漏到公开列表')
      pass('2. 创建默认 pending+draft,公开列表不可见')
    }

    // ── 4a. 未过审发布被拒 ─────────────────────────────────────────────────
    await expectCode(() => svc.publishPolicy(guide.id, 'publish', admin), 'PUBLISH_REQUIRES_APPROVAL', '4a. 未过审发布 → PUBLISH_REQUIRES_APPROVAL')
    await expectCode(() => svc.reviewPolicy(guide.id, 'reject', undefined, admin), 'REJECT_REASON_REQUIRED', '4b. reject 缺原因被拒')

    // ── 3. 审核 + 发布 → Kiosk 可见 + 过滤 ────────────────────────────────
    {
      await svc.reviewPolicy(guide.id, 'approve', undefined, admin)
      await svc.publishPolicy(guide.id, 'publish', admin)
      await svc.reviewPolicy(noticePost.id, 'approve', undefined, admin)
      await svc.publishPolicy(noticePost.id, 'publish', admin)

      const all = await svc.getPublishedPolicies()
      if (!all.data.some((p) => p.id === guide.id) || !all.data.some((p) => p.id === noticePost.id)) {
        fail('3. 审核发布后公开列表不可见')
      }
      const onlyGuides = await svc.getPublishedPolicies({ kind: 'policy_guide' })
      if (onlyGuides.data.some((p) => p.kind !== 'policy_guide')) fail('3. kind 过滤失效')
      const onlyGraduate = await svc.getPublishedPolicies({ audience: 'graduate' })
      if (!onlyGraduate.data.some((p) => p.id === guide.id)) fail('3. audience 过滤失效')
      pass('3. approve+publish 后 Kiosk 可见,kind/audience 过滤生效')
    }

    // ── 5. Partner 编辑 → 强制重审 + 立即下架 ─────────────────────────────
    {
      const updated = await svc.updatePartnerPolicy(guide.id, { title: `验证扶持改_${suffix}` }, partnerA)
      if (updated.reviewStatus !== 'pending' || updated.publishStatus !== 'draft') fail('5. 编辑未回 pending+draft')
      const kiosk = await svc.getPublishedPolicies()
      if (kiosk.data.some((p) => p.id === guide.id)) fail('5. 编辑后仍在公开列表')
      pass('5. 编辑强制回 pending+draft,公开列表立即撤下')
    }

    // ── 6. 越权 ────────────────────────────────────────────────────────────
    await expectCode(() => svc.updatePartnerPolicy(guide.id, { title: 'x' }, partnerB), 'POLICY_NOT_FOUND', '6a. 他机构编辑 → POLICY_NOT_FOUND')
    await expectCode(() => svc.deletePartnerPolicy(noticePost.id, partnerB), 'POLICY_NOT_FOUND', '6b. 他机构删除 → POLICY_NOT_FOUND')

    // ── 7. 下架 + 删除 ─────────────────────────────────────────────────────
    {
      const unpub = await svc.unpublishPartnerPolicy(noticePost.id, partnerA)
      if (unpub.publishStatus !== 'unpublished') fail('7. 下架未生效')
      await svc.deletePartnerPolicy(noticePost.id, partnerA)
      const gone = await prisma.policyPost.findUnique({ where: { id: noticePost.id } })
      if (gone) fail('7. 删除未生效')
      pass('7. 下架 + 删除生效')
    }

    // ── 8. 审计 ────────────────────────────────────────────────────────────
    {
      const logs = await prisma.auditLog.findMany({
        where: { actorId: { in: [partnerA.userId, admin.userId] } },
      })
      const actions = new Set(logs.map((l) => l.action))
      for (const expected of ['policy.create', 'policy.partner_update', 'policy.review', 'policy.publish', 'policy.unpublish', 'policy.delete']) {
        if (!actions.has(expected)) fail(`8. 缺少审计动作 ${expected};实际: ${[...actions].join(', ')}`)
      }
      pass('8. 6 类审计动作齐全')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
