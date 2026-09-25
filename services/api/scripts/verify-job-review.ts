/**
 * 岗位审核 / 发布状态机 service 级验证（P1-B⑤ 守门）。
 *
 * 主路径走 JobsService.importJobs（Partner 身份与机构归属），不再只靠直接插入 Job 行：
 *   0. 非 partner / 无 orgId 拒绝且不写行；导入行归属调用方机构；
 *      另一机构用同一 externalId 另成一行，机构列表互不可见。
 *   1. 导入初始 pending + draft，公开列表和详情都不可见。
 *   2. 未 approved 禁止 publish（合规红线 PUBLISH_REQUIRES_APPROVAL）。
 *   3. approve → approved + draft（不自动发布，仍不可见）。
 *   4. approved 后 publish → published。
 *   5. 公开查询只返回 approved + published。
 *   6. unpublish → unpublished（且不再公开可见）。
 *   7. 终态（approved / rejected）不可回退 pending（INVALID_STATE_TRANSITION）。
 *   11. 重新发布后再导入：同一行回到 pending + draft，审核元数据清空，公开不可见；
 *       本机构 job.import 审计与质量快照都留下记录。
 *   8–10. 拒绝原因、脏态强制 draft、分页仍用直接造行夹具。
 *
 * service 直调真库（临时 SQLite，DATABASE_URL 由 runner/CI 提供，脚本只建+清自身夹具）。
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:job-review
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobsExcelService } from '../src/jobs/jobs-excel.service'
import { RecruitmentEmergencyService } from '../src/recruitment-hosting/recruitment-emergency.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import type { ImportJobItemDto } from '../src/jobs/dto/import-jobs.dto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); throw new Error(m) }

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
  assertIsolatedVerificationDatabase()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const _audit = new AuditService(prisma)
  const _jobQuality = new JobQualityService(prisma)
  const _kiosk = new JobsKioskService(prisma)
  const _admin = new JobsAdminService(prisma, _audit)
  const _partner = new JobsPartnerService(prisma, _audit, _jobQuality)
  const _excel = new JobsExcelService(prisma, _audit, _jobQuality)
  const jobs = new JobsService(_kiosk, _admin, _partner, _excel)

  const sfx = randomBytes(6).toString('hex')
  const orgId = `org_vjr_${sfx}`
  const otherOrgId = `org_vjr_b_${sfx}`
  const user: AuthedUser = { userId: `admin_vjr_${sfx}`, role: 'admin', orgId: null }
  const partner: AuthedUser = { userId: `partner_vjr_${sfx}`, role: 'partner', orgId }
  const otherPartner: AuthedUser = { userId: `partner_vjr_b_${sfx}`, role: 'partner', orgId: otherOrgId }
  const actorIds = [user.userId, partner.userId, otherPartner.userId]
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
    const orgIds = [orgId, otherOrgId]
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetType: 'job', targetId: { in: jobIds } }, { actorId: { in: actorIds } }] },
    })
    await prisma.jobDataQualitySnapshot.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
    await prisma.partnerOrgNotice.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined)
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined)
    await prisma.job.deleteMany({ where: { OR: [{ id: { in: jobIds } }, { sourceOrgId: { in: orgIds } }] } })
    await prisma.user.deleteMany({ where: { id: { in: actorIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  }

  try {
    await cleanup()
    // licensed_hr_agency 才能走 importJobs；hr_company 是来源种类，能力矩阵会拒绝。
    // contentTrustStatus='active'：发布闸门要求来源机构已通过内容信任核验。
    await prisma.organization.create({ data: { id: orgId, name: '审核验证机构', type: 'licensed_hr_agency', contentTrustStatus: 'active' } })
    await prisma.organization.create({ data: { id: otherOrgId, name: '对照验证机构', type: 'licensed_hr_agency' } })
    // 审核/发布/导入会写审计（actorId → User FK）；建真实用户使审计落库。
    await prisma.user.create({ data: { id: user.userId, username: `vjr_admin_${sfx}`, passwordHash: 'x', name: '审核管理员', role: 'admin' } })
    await prisma.user.create({ data: { id: partner.userId, username: `vjr_partner_${sfx}`, passwordHash: 'x', name: '导入机构账号', role: 'partner', orgId } })
    await prisma.user.create({ data: { id: otherPartner.userId, username: `vjr_partner_b_${sfx}`, passwordHash: 'x', name: '对照机构账号', role: 'partner', orgId: otherOrgId } })

    const externalId = `EXT-imp-${sfx}`
    const sourceUrl = 'https://example.com/jobs/import'
    const item = (title: string): ImportJobItemDto => ({
      externalId, title, company: '某公司', city: '青岛', sourceUrl,
      description: '用于审核闭环的岗位说明',
    })
    const publicHit = async (id: string, sourceOrgId: string) => {
      const page = await jobs.getPublishedJobs({ sourceOrgId })
      const detail = await jobs.getPublishedJobById(id)
      return {
        inList: page.data.some((row) => row.id === id),
        inDetail: detail.data != null,
      }
    }

    // ── 0. Partner 身份 / 机构归属 ──────────────────────────────────────
    const before = await prisma.job.count({ where: { externalId } })
    await expectCode(
      () => jobs.importJobs([item('无机构')], { userId: partner.userId, role: 'partner', orgId: null }),
      'PARTNER_ORG_REQUIRED',
      '0a. partner 无 orgId → 400 PARTNER_ORG_REQUIRED',
    )
    await expectCode(
      () => jobs.importJobs([item('非机构角色')], { userId: user.userId, role: 'admin', orgId }),
      'PARTNER_ORG_REQUIRED',
      '0b. admin 即使带 orgId 也不得导入 → 400 PARTNER_ORG_REQUIRED',
    )
    if (await prisma.job.count({ where: { externalId } }) !== before) fail('0c. 身份拒绝仍写入了岗位')
    else pass('0c. 身份拒绝不写岗位行')

    const imported = await jobs.importJobs([item('导入岗位')], partner)
    const j1 = imported.items[0]?.id
    if (j1) jobIds.push(j1)
    if (!j1 || imported.imported !== 1) fail('1. 导入未返回岗位')
    const init = await prisma.job.findUnique({ where: { id: j1 } })
    if (
      init?.sourceOrgId === orgId
      && init.sourceName === '审核验证机构'
      && init.externalId === externalId
      && init.sourceUrl === sourceUrl
      && init.reviewStatus === 'pending'
      && init.publishStatus === 'draft'
      && init.reviewedBy == null
      && init.reviewedAt == null
    ) pass('1. Partner 导入归属本机构，初始 pending + draft')
    else fail(`1. 导入初始状态异常: ${init?.sourceOrgId}/${init?.sourceName}/${init?.reviewStatus}/${init?.publishStatus}`)

    const otherImported = await jobs.importJobs([item('他机构同外部编号')], otherPartner)
    const otherId = otherImported.items[0]?.id
    if (otherId) jobIds.push(otherId)
    if (!otherId || otherImported.imported !== 1) fail('1b. 他机构导入未返回岗位')
    const otherRow = await prisma.job.findUnique({ where: { id: otherId } })
    const ownList = await jobs.getPartnerJobs(partner)
    const otherList = await jobs.getPartnerJobs(otherPartner)
    if (!Array.isArray(ownList) || !Array.isArray(otherList)) fail('1b. 未分页机构列表应为数组')
    if (
      otherId !== j1
      && otherRow?.sourceOrgId === otherOrgId
      && otherRow.sourceName === '对照验证机构'
      && ownList.some((row) => row.id === j1)
      && !ownList.some((row) => row.id === otherId)
      && otherList.some((row) => row.id === otherId)
      && !otherList.some((row) => row.id === j1)
    ) pass('1b. 相同 externalId 按机构拆行，机构列表互不可见')
    else fail(`1b. 机构归属异常: ${otherId}/${otherRow?.sourceOrgId}`)

    const j2 = await mkJob('b') // 直接造行只留作「未发布不进公开查询」对照
    const importedHit = await publicHit(j1, orgId)
    const otherHit = await publicHit(otherId, otherOrgId)
    if (importedHit.inList || importedHit.inDetail || otherHit.inList || otherHit.inDetail) fail('1d. 未审核岗位进入公开查询')
    else pass('1d. 未审核导入对公开列表和详情不可见')

    // ── 2. 未 approved 禁止 publish（红线）─────────────────────────────
    await expectCode(() => jobs.publishJobSource(j1, 'publish', user), 'PUBLISH_REQUIRES_APPROVAL', '2. 未审核通过 publish → 400 PUBLISH_REQUIRES_APPROVAL（合规红线）')

    // ── 3. approve → approved + draft（不自动发布）──────────────────────
    const approved = await jobs.reviewJobSource(j1, 'approve', undefined, user)
    const approvedHit = await publicHit(j1, orgId)
    if (approved.reviewStatus === 'approved' && approved.publishStatus === 'draft' && !approvedHit.inList && !approvedHit.inDetail) pass('3. approve → approved + draft（不自动发布，列表和详情仍不可见）')
    else fail(`3. approve 异常: ${approved.reviewStatus}/${approved.publishStatus} list=${approvedHit.inList} detail=${approvedHit.inDetail}`)

    // ── 4. approved 后 publish → published ──────────────────────────────
    const published = await jobs.publishJobSource(j1, 'publish', user)
    const publishedHit = await publicHit(j1, orgId)
    if (published.publishStatus === 'published' && publishedHit.inList && publishedHit.inDetail) pass('4. approved 后 publish → published，列表和详情都可见')
    else fail(`4. publish 异常: ${published.publishStatus} list=${publishedHit.inList} detail=${publishedHit.inDetail}`)

    // ── 5. Kiosk 公开查询只返回 approved + published ────────────────────
    const pub1 = await jobs.getPublishedJobs({ sourceOrgId: orgId })
    const ids1 = pub1.data.map((i) => i.id)
    const j1Detail = await jobs.getPublishedJobById(j1)
    const j2Detail = await jobs.getPublishedJobById(j2)
    if (ids1.includes(j1) && j1Detail.data != null && !ids1.includes(j2) && j2Detail.data == null) pass('5. Kiosk 公开查询：列表和详情都含 j1，都不含 pending 的 j2')
    else fail(`5. Kiosk 可见性异常: list=${JSON.stringify(ids1)} j1Detail=${j1Detail.data != null} j2Detail=${j2Detail.data != null}`)

    // ── 6. unpublish → unpublished（不再进 Kiosk）──────────────────────
    const unpub = await jobs.publishJobSource(j1, 'unpublish', user)
    const unpublishedHit = await publicHit(j1, orgId)
    if (unpub.publishStatus === 'unpublished' && !unpublishedHit.inList && !unpublishedHit.inDetail) pass('6. unpublish → unpublished，列表和详情都不再公开')
    else fail(`6. unpublish 异常: ${unpub.publishStatus} list=${unpublishedHit.inList} detail=${unpublishedHit.inDetail}`)

    // ── 7. 终态不可回退（approved）─────────────────────────────────────
    await expectCode(() => jobs.reviewJobSource(j1, 'reviewing', undefined, user), 'INVALID_STATE_TRANSITION', '7a. approved（终态）再 review → 400 INVALID_STATE_TRANSITION')

    // ── 11. 已发布岗位再导入：强制 pending+draft 并退出公开查询 ─────────
    const republished = await jobs.publishJobSource(j1, 'publish', user)
    const republishedHit = await publicHit(j1, orgId)
    if (republished.publishStatus !== 'published' || !republishedHit.inList || !republishedHit.inDetail) {
      fail(`11. 再导入前未能重新发布: list=${republishedHit.inList} detail=${republishedHit.inDetail}`)
    }
    const again = await jobs.importJobs([item('再导入岗位')], partner)
    if (again.items[0]?.id !== j1 || again.imported !== 1) fail('11. 再导入没有命中同一行')
    const reset = await prisma.job.findUnique({ where: { id: j1 } })
    const resetHit = await publicHit(j1, orgId)
    if (
      reset?.reviewStatus !== 'pending'
      || reset.publishStatus !== 'draft'
      || reset.title !== '再导入岗位'
      || reset.reviewedBy != null
      || reset.reviewedAt != null
      || reset.rejectReason != null
      || resetHit.inList
      || resetHit.inDetail
    ) fail(`11. 再导入未强制下架重审: ${reset?.reviewStatus}/${reset?.publishStatus}/${reset?.title} list=${resetHit.inList} detail=${resetHit.inDetail}`)
    const importAudits = await prisma.auditLog.findMany({
      where: { actorId: partner.userId, action: 'job.import', targetType: 'job' },
    })
    const sawExternalId = importAudits.some((row) => {
      try {
        const payload = JSON.parse(row.payloadJson) as { externalIds?: unknown }
        return Array.isArray(payload.externalIds) && payload.externalIds.includes(externalId)
      } catch {
        return false
      }
    })
    const snapshots = await prisma.jobDataQualitySnapshot.count({ where: { jobId: j1, sourceOrgId: orgId } })
    if (importAudits.length >= 2 && sawExternalId && snapshots >= 2) {
      pass('11. 已发布后再导入 → 同一行 pending+draft、审核元数据清空、公开不可见，审计与质量快照已落库')
    } else fail(`11. 副作用缺失: audits=${importAudits.length} payload=${sawExternalId} snapshots=${snapshots}`)

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

    // ── 10. ADM-C15 GET /admin/job-sources 可选分页 ─────────────────────
    {
      const controller = readFileSync(join(process.cwd(), 'src/jobs/jobs.controller.ts'), 'utf8')
      const fn = controller.slice(controller.indexOf('getJobSources('), controller.indexOf('getJobSources(') + 900)
      if (!fn.includes("@Query('page')") || !fn.includes("@Query('pageSize')")) {
        fail('10a. GET /admin/job-sources 未声明 page/pageSize')
      }
      pass('10a. GET /admin/job-sources 声明 page/pageSize')

      const tag = `ADM_C15_${sfx}`
      await mkJob('p1', { title: `${tag} one` })
      await mkJob('p2', { title: `${tag} two` })
      await mkJob('p3', { title: `${tag} three` })
      const unpaged = await jobs.getAllJobSources()
      if (!Array.isArray(unpaged)) fail('10b. 缺省参数必须保持裸数组')
      if (!unpaged.some((j) => j.title.includes(tag))) fail('10b. 缺省数组未包含分页夹具')
      pass('10b. 缺省参数返回裸数组')

      const paged = await jobs.getAllJobSources({ page: '1', pageSize: '2', keyword: tag })
      if (Array.isArray(paged)) fail('10c. 带 page/pageSize 不得返回裸数组')
      if (paged.total !== 3 || paged.page !== 1 || paged.pageSize !== 2 || paged.items.length !== 2) {
        fail(`10c. 分页形状异常: total=${paged.total} page=${paged.page} pageSize=${paged.pageSize} items=${paged.items.length}`)
      }
      if (paged.items.length > paged.pageSize) fail('10c. items.length > pageSize')
      pass('10c. 带分页参数返回 total 且 items.length ≤ pageSize')

      const page2 = await jobs.getAllJobSources({ page: '2', pageSize: '2', keyword: tag })
      if (Array.isArray(page2) || page2.items.length !== 1 || page2.total !== 3) {
        fail('10d. 第二页未按 skip/take 切片')
      }
      pass('10d. 第二页 skip/take 生效')

      const capped = await jobs.getAllJobSources({ page: '1', pageSize: '999', keyword: tag })
      if (Array.isArray(capped) || capped.pageSize !== 100) {
        fail(`10e. pageSize 上限应为 100，实际 ${Array.isArray(capped) ? 'array' : capped.pageSize}`)
      }
      pass('10e. pageSize 上限 100')

      const pending = await jobs.getAllJobSources({ page: '1', pageSize: '20', keyword: tag, reviewStatus: 'pending' })
      if (Array.isArray(pending) || pending.items.some((j) => j.reviewStatus !== 'pending')) {
        fail('10f. reviewStatus 筛选在分页下未生效')
      }
      pass('10f. 分页下 reviewStatus 筛选生效')
    }

    const emergency = new RecruitmentEmergencyService(prisma, _audit)
    await emergency.takedown('job', j1, 'illegal_content', '验证紧急下架', user)
    await expectCode(
      () => jobs.publishJobSource(j1, 'publish', user),
      'EMERGENCY_TAKEDOWN_IRREVERSIBLE',
      '下架后管理员不能恢复',
    )
    const notices = await prisma.partnerOrgNotice.findMany({ where: { orgId } })
    if (notices.length < 1) fail('下架通知未写出')
    else pass('下架通知写出')
    await emergency.circuitBreak('org', orgId, 'authority_order', '验证熔断', user)
    const circuit = await prisma.auditLog.findFirst({ where: { action: 'recruitment.circuit_break', targetId: orgId } })
    if (!circuit) fail('熔断没有审计')
    else pass('熔断留痕')

    const previousHosting = process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED
    process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
    try {
      await expectCode(
        () => jobs.importJobs([item('关闭后导入')], partner),
        'RECRUITMENT_HOSTING_DISABLED',
        '托管关闭时招聘类写入停止',
      )
      await expectCode(
        () => jobs.publishJobSource(j1, 'publish', user),
        'RECRUITMENT_HOSTING_DISABLED',
        '管理员发布被拒',
      )
      const hidden = await jobs.getPublishedJobs({ sourceOrgId: orgId })
      if (hidden.data.length !== 0) fail('托管关闭时公开岗位列表不是空')
      else pass('托管关闭时招聘类读返回空')
      await expectCode(() => jobs.getPublishedJobById(j1), 'RECRUITMENT_HOSTING_DISABLED', '托管关闭时岗位详情拒绝')
    } finally {
      if (previousHosting === undefined) delete process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED
      else process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = previousHosting
    }
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
