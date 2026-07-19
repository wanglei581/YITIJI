/**
 * 招聘会审核 / 发布状态机 service 级验证（2026-06-17 P0 补门禁）。
 *
 * 覆盖（service 直调 JobsService.reviewFairSource / publishFairSource）：
 *   1. 初始 pending + draft。
 *   2. 未 approved 禁止 publish（PUBLISH_REQUIRES_APPROVAL）。
 *   3. reviewing 可进入审核中。
 *   4. approve → approved + draft，并清空 rejectReason（不自动发布）。
 *   5. approved 后 publish → published。
 *   6. Kiosk 公开查询只返回 approved + published。
 *   7. unpublish → unpublished，且不再进 Kiosk。
 *   8. 终态（approved / rejected）不可再次审核（INVALID_STATE_TRANSITION）。
 *   9. reject 必填 reason（REJECT_REASON_REQUIRED）。
 *   10. reject → rejected + draft + rejectReason。
 *   11. reject 强制 publishStatus=draft，防止脏态继续公开展示。
 *   12. 审计落 fair.review / fair.publish，payload 含 from/to 状态且无密码字段。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:jobfair-review
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobsExcelService } from '../src/jobs/jobs-excel.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

const RESIDUE_TAG = 'vresidfairreview'

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
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function main() {
  console.log('\n=== 招聘会审核 / 发布状态机 service 级验证（2026-06-17 P0 补门禁）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const _audit = new AuditService(prisma)
  const _jobQuality = new JobQualityService(prisma)
  const _kiosk = new JobsKioskService(prisma)
  const _admin = new JobsAdminService(prisma, _audit)
  const _partner = new JobsPartnerService(prisma, _audit, _jobQuality)
  const _excel = new JobsExcelService(prisma, _audit, _jobQuality)
  const jobs = new JobsService(_kiosk, _admin, _partner, _excel)

  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomBytes(6).toString('hex')
  const orgId = `org_${RESIDUE_TAG}_${suffix}`
  const fairIds: string[] = []

  const adminRow = await prisma.user.create({
    data: {
      username: `${RESIDUE_TAG}_admin_${suffix}`,
      passwordHash: 'x',
      name: '招聘会审核验证管理员',
      role: 'admin',
    },
  })
  const adminUser: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  const mkFair = async (key: string, extra: Record<string, unknown> = {}) => {
    const id = `fair_${RESIDUE_TAG}_${key}_${suffix}`
    // getPublishedFairs 按 startAt asc 分页；使用 epoch 附近时间，避免测试夹具被
    // 真实/种子 approved+published 招聘会挤出第一页而误报。
    const startAt = new Date(1_000 + fairIds.length * 3_600_000)
    const endAt = new Date(startAt.getTime() + 3_600_000)
    await prisma.jobFair.create({
      data: {
        id,
        sourceOrgId: orgId,
        externalId: `FAIR-${key}-${suffix}`,
        sourceName: '招聘会审核验证来源',
        sourceUrl: 'https://example.com/fairs',
        title: `招聘会审核验证 ${key}`,
        theme: 'campus',
        startAt,
        endAt,
        venue: '验证展馆',
        city: '青岛',
        ...extra,
      },
    })
    fairIds.push(id)
    return id
  }

  async function cleanup() {
    await cleanFairVerifyResidue(prisma, RESIDUE_TAG)
  }

  try {
    await prisma.organization.create({
      data: {
        id: orgId,
        name: `招聘会审核验证机构_${suffix}`,
        type: 'fair_organizer',
      },
    })

    // ── 1. 初始 pending + draft ─────────────────────────────────────────
    const fairA = await mkFair('a', { rejectReason: '历史拒绝原因' })
    const fairPending = await mkFair('pending')
    const init = await prisma.jobFair.findUnique({ where: { id: fairA } })
    if (init?.reviewStatus === 'pending' && init.publishStatus === 'draft') pass('1. 初始 pending + draft')
    else fail(`1. 初始状态异常: ${init?.reviewStatus}/${init?.publishStatus}`)

    // ── 2. 未 approved 禁止 publish（红线）─────────────────────────────
    await expectCode(() => jobs.publishFairSource(fairA, 'publish', adminUser), 'PUBLISH_REQUIRES_APPROVAL', '2. 未审核通过 publish → 400 PUBLISH_REQUIRES_APPROVAL')

    // ── 3. reviewing 可进入审核中 ──────────────────────────────────────
    const reviewing = await jobs.reviewFairSource(fairA, 'reviewing', undefined, adminUser)
    if (reviewing.reviewStatus === 'reviewing' && reviewing.publishStatus === 'draft') pass('3. reviewing → reviewing + draft')
    else fail(`3. reviewing 异常: ${reviewing.reviewStatus}/${reviewing.publishStatus}`)

    // ── 4. approve → approved + draft（不自动发布）──────────────────────
    const approved = await jobs.reviewFairSource(fairA, 'approve', undefined, adminUser)
    const approvedRow = await prisma.jobFair.findUnique({ where: { id: fairA }, select: { rejectReason: true } })
    if (approved.reviewStatus === 'approved' && approved.publishStatus === 'draft' && approvedRow?.rejectReason === null) {
      pass('4. approve → approved + draft，并清空 rejectReason（不自动发布）')
    } else {
      fail(`4. approve 异常: dto=${JSON.stringify(approved)} rejectReason=${approvedRow?.rejectReason}`)
    }

    // ── 5. approved 后 publish → published ──────────────────────────────
    const published = await jobs.publishFairSource(fairA, 'publish', adminUser)
    if (published.publishStatus === 'published') pass('5. approved 后 publish → published')
    else fail(`5. publish 异常: ${published.publishStatus}`)

    // ── 6. Kiosk 公开查询只返回 approved + published ────────────────────
    const pub1 = await jobs.getPublishedFairs({ pageSize: 100 })
    const ids1 = pub1.data.map((i) => i.id)
    if (ids1.includes(fairA) && !ids1.includes(fairPending)) {
      pass('6. Kiosk 公开查询：含 approved+published 的 fairA，不含 pending 的 fairPending')
    } else {
      fail(`6. Kiosk 可见性异常: ${JSON.stringify(ids1)}`)
    }

    // ── 7. unpublish → unpublished（不再进 Kiosk）──────────────────────
    const unpub = await jobs.publishFairSource(fairA, 'unpublish', adminUser)
    const pub2 = await jobs.getPublishedFairs({ pageSize: 100 })
    if (unpub.publishStatus === 'unpublished' && !pub2.data.some((i) => i.id === fairA)) {
      pass('7. unpublish → unpublished，且不再进 Kiosk 公开查询')
    } else {
      fail(`7. unpublish 异常: ${unpub.publishStatus} kiosk=${JSON.stringify(pub2.data.map((i) => i.id))}`)
    }

    // ── 8. 终态不可再次审核（approved）─────────────────────────────────
    await expectCode(() => jobs.reviewFairSource(fairA, 'reviewing', undefined, adminUser), 'INVALID_STATE_TRANSITION', '8a. approved（终态）再 review → 400 INVALID_STATE_TRANSITION')

    // ── 9+10. reject 必填 reason；reject → rejected + draft + reason ─────
    const fairB = await mkFair('b')
    await jobs.reviewFairSource(fairB, 'reviewing', undefined, adminUser)
    await expectCode(() => jobs.reviewFairSource(fairB, 'reject', '   ', adminUser), 'REJECT_REASON_REQUIRED', '9. reject 空 reason → 400 REJECT_REASON_REQUIRED')
    const rejected = await jobs.reviewFairSource(fairB, 'reject', '招聘会信息不完整', adminUser)
    const rejectedRow = await prisma.jobFair.findUnique({ where: { id: fairB }, select: { rejectReason: true } })
    if (rejected.reviewStatus === 'rejected' && rejected.publishStatus === 'draft' && rejectedRow?.rejectReason === '招聘会信息不完整') {
      pass('10. reject（带 reason）→ rejected + draft + rejectReason')
    } else {
      fail(`10. reject 异常: dto=${JSON.stringify(rejected)} rejectReason=${rejectedRow?.rejectReason}`)
    }
    await expectCode(() => jobs.reviewFairSource(fairB, 'approve', undefined, adminUser), 'INVALID_STATE_TRANSITION', '8b. rejected（终态）再 approve → 400 INVALID_STATE_TRANSITION')

    // ── 11. reject 强制 publishStatus=draft（防御脏态）───────────────────
    const fairDirty = await mkFair('dirty', { reviewStatus: 'reviewing', publishStatus: 'published' })
    const forcedDraft = await jobs.reviewFairSource(fairDirty, 'reject', '撤下并拒绝', adminUser)
    const pub3 = await jobs.getPublishedFairs({ pageSize: 100 })
    if (
      forcedDraft.reviewStatus === 'rejected' &&
      forcedDraft.publishStatus === 'draft' &&
      !pub3.data.some((i) => i.id === fairDirty)
    ) {
      pass('11. reject 强制 publishStatus=draft，脏态不再进 Kiosk 公开查询')
    } else {
      fail(`11. reject force-draft 异常: ${forcedDraft.reviewStatus}/${forcedDraft.publishStatus}`)
    }

    // ── 12. 审计日志 ────────────────────────────────────────────────────
    const logs = await prisma.auditLog.findMany({
      where: { actorId: adminUser.userId, targetType: 'fair', targetId: { in: fairIds } },
      orderBy: { createdAt: 'asc' },
    })
    const actions = new Set(logs.map((l) => l.action))
    if (!actions.has('fair.review') || !actions.has('fair.publish')) {
      fail(`12. 审计动作缺失: ${JSON.stringify([...actions])}`)
    }
    const payloads = logs.map((l) => parsePayload(l.payloadJson))
    const hasApproveTransition = payloads.some((p) => p.action === 'approve' && p.fromReviewStatus === 'reviewing' && p.toReviewStatus === 'approved')
    const hasPublishTransition = payloads.some((p) => p.action === 'publish' && p.fromPublishStatus === 'draft' && p.toPublishStatus === 'published')
    if (!hasApproveTransition || !hasPublishTransition) {
      fail(`12. 审计 payload 未记录关键 from/to 状态: ${JSON.stringify(payloads)}`)
    }
    if (JSON.stringify(payloads).toLowerCase().includes('password')) {
      fail('12. 审计 payload 不应包含 password 字段')
    }
    pass('12. 审计落 fair.review / fair.publish，payload 含 from/to 状态且无密码字段')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
