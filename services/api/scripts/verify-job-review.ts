/**
 * 岗位审核 / 发布状态机 service 级验证（P1-B⑤ 守门）。
 *
 * 覆盖（按验收顺序，service 直调 JobsService.reviewJobSource / publishJobSource）：
 *   1. 初始 pending + draft。
 *   2. 未 approved 禁止 publish（合规红线 PUBLISH_REQUIRES_APPROVAL）。
 *   3. approve → approved + draft（不自动发布）。
 *   4. approved 后 publish → published。
 *   5. Kiosk 公开查询只返回 approved + published。
 *   6. unpublish → unpublished（且不再进 Kiosk）。
 *   7. 终态（approved / rejected）不可回退 pending（INVALID_STATE_TRANSITION）。
 *   8. reject 必填 reason（service 守卫 REJECT_REASON_REQUIRED）。
 *   9. reject 强制 publishStatus=draft（防"已发布的还挂在 Kiosk"——人造 reviewing+published 脏态验证）。
 *
 * service 直调真库（临时 SQLite，DATABASE_URL 由 runner/CI 提供，脚本只建+清自身夹具）。
 * 运行：pnpm --filter @ai-job-print/api verify:job-review
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
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
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== 岗位审核 / 发布状态机 service 级验证（P1-B⑤ 守门）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const jobs = new JobsService(prisma, new AuditService(prisma))

  const sfx = randomBytes(6).toString('hex')
  const orgId = `org_vjr_${sfx}`
  const user = { userId: `admin_vjr_${sfx}` } as AuthedUser
  const jobIds: string[] = []

  const mkJob = async (key: string, extra: Record<string, unknown> = {}) => {
    const id = `job_vjr_${key}_${sfx}`
    await prisma.job.create({
      data: {
        id, sourceOrgId: orgId, externalId: `EXT-${key}-${sfx}`,
        sourceName: '某来源机构', sourceUrl: 'https://example.com/jobs',
        title: `测试岗位 ${key}`, company: '某公司', city: '青岛', ...extra,
      },
    })
    jobIds.push(id)
    return id
  }

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { targetType: 'job', targetId: { in: jobIds } } })
    if (jobIds.length) await prisma.job.deleteMany({ where: { id: { in: jobIds } } })
    await prisma.user.deleteMany({ where: { id: user.userId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
  }

  try {
    await cleanup()
    await prisma.organization.create({ data: { id: orgId, name: '审核验证机构', type: 'hr_company' } })
    // 审核/发布会写审计（actorId → User FK）；建 admin User 夹具使审计真正落库（对齐真实管理员操作）。
    await prisma.user.create({ data: { id: user.userId, username: `vjr_admin_${sfx}`, passwordHash: 'x', name: '审核管理员', role: 'admin' } })

    // ── 1. 初始 pending + draft ─────────────────────────────────────────
    const j1 = await mkJob('a')
    const j2 = await mkJob('b') // 留作"未发布不进 Kiosk"对照
    const init = await prisma.job.findUnique({ where: { id: j1 } })
    if (init?.reviewStatus === 'pending' && init.publishStatus === 'draft') pass('1. 初始 pending + draft')
    else fail(`1. 初始状态异常: ${init?.reviewStatus}/${init?.publishStatus}`)

    // ── 2. 未 approved 禁止 publish（红线）─────────────────────────────
    await expectCode(() => jobs.publishJobSource(j1, 'publish', user), 'PUBLISH_REQUIRES_APPROVAL', '2. 未审核通过 publish → 400 PUBLISH_REQUIRES_APPROVAL（合规红线）')

    // ── 3. approve → approved + draft（不自动发布）──────────────────────
    const approved = await jobs.reviewJobSource(j1, 'approve', undefined, user)
    if (approved.reviewStatus === 'approved' && approved.publishStatus === 'draft') pass('3. approve → approved + draft（不自动发布）')
    else fail(`3. approve 异常: ${approved.reviewStatus}/${approved.publishStatus}`)

    // ── 4. approved 后 publish → published ──────────────────────────────
    const published = await jobs.publishJobSource(j1, 'publish', user)
    if (published.publishStatus === 'published') pass('4. approved 后 publish → published')
    else fail(`4. publish 异常: ${published.publishStatus}`)

    // ── 5. Kiosk 公开查询只返回 approved + published ────────────────────
    const pub1 = await jobs.getPublishedJobs({ sourceOrgId: orgId })
    const ids1 = pub1.data.map((i) => i.id)
    if (ids1.includes(j1) && !ids1.includes(j2)) pass('5. Kiosk 公开查询：含 approved+published 的 j1，不含 pending 的 j2')
    else fail(`5. Kiosk 可见性异常: ${JSON.stringify(ids1)}`)

    // ── 6. unpublish → unpublished（不再进 Kiosk）──────────────────────
    const unpub = await jobs.publishJobSource(j1, 'unpublish', user)
    const pub2 = await jobs.getPublishedJobs({ sourceOrgId: orgId })
    if (unpub.publishStatus === 'unpublished' && !pub2.data.some((i) => i.id === j1)) pass('6. unpublish → unpublished，且不再进 Kiosk 公开查询')
    else fail(`6. unpublish 异常: ${unpub.publishStatus} kiosk=${JSON.stringify(pub2.data.map((i) => i.id))}`)

    // ── 7. 终态不可回退（approved）─────────────────────────────────────
    await expectCode(() => jobs.reviewJobSource(j1, 'reviewing', undefined, user), 'INVALID_STATE_TRANSITION', '7a. approved（终态）再 review → 400 INVALID_STATE_TRANSITION')

    // ── 8. reject 必填 reason（service 守卫）─────────────────────────────
    const j3 = await mkJob('c')
    await jobs.reviewJobSource(j3, 'reviewing', undefined, user) // 先进非终态 reviewing
    await expectCode(() => jobs.reviewJobSource(j3, 'reject', '   ', user), 'REJECT_REASON_REQUIRED', '8a. reject 空 reason → 400 REJECT_REASON_REQUIRED')
    const rejected = await jobs.reviewJobSource(j3, 'reject', '岗位信息不完整', user)
    if (rejected.reviewStatus === 'rejected' && rejected.publishStatus === 'draft' && rejected.rejectReason === '岗位信息不完整') pass('8b. reject（带 reason）→ rejected + draft + rejectReason')
    else fail(`8b. reject 异常: ${JSON.stringify(rejected)}`)
    // rejected 也是终态
    await expectCode(() => jobs.reviewJobSource(j3, 'approve', undefined, user), 'INVALID_STATE_TRANSITION', '7b. rejected（终态）再 approve → 400 INVALID_STATE_TRANSITION')

    // ── 9. reject 强制 publishStatus=draft（防御）──────────────────────
    // 人造脏态：reviewing + published（正常流程不可达，验证 reject 的防御性 force-draft）
    const j4 = await mkJob('d', { reviewStatus: 'reviewing', publishStatus: 'published' })
    const rejForce = await jobs.reviewJobSource(j4, 'reject', '撤下并拒绝', user)
    if (rejForce.reviewStatus === 'rejected' && rejForce.publishStatus === 'draft') pass('9. reject 强制 publishStatus=draft（防"已发布的还挂在 Kiosk"）')
    else fail(`9. reject force-draft 异常: ${rejForce.reviewStatus}/${rejForce.publishStatus}`)
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
