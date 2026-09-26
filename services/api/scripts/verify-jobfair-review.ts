/**
 * 招聘会审核 / 发布状态机 service 级验证（2026-06-17 P0 补门禁）。
 *
 * 主路径走 JobsService.importFairs（Partner 身份与机构归属），不再只靠直接插入 JobFair 行：
 *   0. 非 partner / 无 orgId 拒绝且不写行；导入行归属调用方机构；
 *      另一机构用同一 externalId 另成一行，机构列表互不可见。
 *   1. 导入初始 pending + draft，公开列表、按编号读取和详情都不可见。
 *   2. 未 approved 禁止 publish（PUBLISH_REQUIRES_APPROVAL）。
 *   3. reviewing 可进入审核中。
 *   4. approve → approved + draft，并清空 rejectReason（不自动发布，仍不可见）。
 *   5. approved 后 publish → published，列表、按编号读取和详情都可见。
 *   6. 公开查询只返回 approved + published；pending 对照行列表和详情都不可见。
 *   7. unpublish → unpublished，列表、按编号读取和详情都不再公开。
 *   8. 终态（approved / rejected）不可再次审核（INVALID_STATE_TRANSITION）。
 *   9. reject 必填 reason（REJECT_REASON_REQUIRED）。
 *   10. reject → rejected + draft + rejectReason。
 *   11. reject 强制 publishStatus=draft，防止脏态继续公开展示。
 *   12. 审计落 fair.review / fair.publish，payload 含 from/to 状态且无密码字段。
 *   13. 管理端列表分页。
 *   14. 重新发布后再导入：同一行回到 pending + draft，审核元数据清空，公开不可见；
 *       本机构 fair.import 审计留下记录。招聘会导入不写岗位质量快照。
 *
 * 8–13 的拒绝、脏态和分页仍用直接造行夹具。
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:jobfair-review
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobsExcelService } from '../src/jobs/jobs-excel.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import type { ImportFairItemDto } from '../src/jobs/dto/import-fairs.dto'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const RESIDUE_TAG = 'vresidfairreview'

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

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

type PublicVisibility = { inList: boolean; inById: boolean; inDetail: boolean }

function isShown(hit: PublicVisibility): boolean {
  return hit.inList && hit.inById && hit.inDetail
}

function isHidden(hit: PublicVisibility): boolean {
  return !hit.inList && !hit.inById && !hit.inDetail
}

function visibilityText(hit: PublicVisibility): string {
  return `list=${hit.inList} byId=${hit.inById} detail=${hit.inDetail}`
}

async function main() {
  console.log('\n=== 招聘会审核 / 发布状态机 service 级验证（2026-06-17 P0 补门禁）===')
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

  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomBytes(6).toString('hex')
  const orgId = `org_${RESIDUE_TAG}_${suffix}`
  const otherOrgId = `org_${RESIDUE_TAG}_b_${suffix}`
  const fairIds: string[] = []
  const adminUser: AuthedUser = { userId: `admin_${RESIDUE_TAG}_${suffix}`, role: 'admin', orgId: null }
  const partner: AuthedUser = { userId: `partner_${RESIDUE_TAG}_${suffix}`, role: 'partner', orgId }
  const otherPartner: AuthedUser = { userId: `partner_${RESIDUE_TAG}_b_${suffix}`, role: 'partner', orgId: otherOrgId }

  const mkFair = async (key: string, extra: Record<string, unknown> = {}) => {
    const id = `fair_${RESIDUE_TAG}_${key}_${suffix}`
    // 公开列表按未结束/已结束分桶。直接造行的负向夹具仍用 epoch 附近时间。
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
        name: `招聘会审核机构_${suffix}`,
        type: 'fair_organizer',
        // 发布闸门要求来源机构已通过内容信任核验(见 src/common/content-trust.ts)
        contentTrustStatus: 'active',
      },
    })
    await prisma.organization.create({
      data: { id: otherOrgId, name: `对照招聘会机构_${suffix}`, type: 'fair_organizer' },
    })
    await prisma.user.create({
      data: { id: adminUser.userId, username: `${RESIDUE_TAG}_admin_${suffix}`, passwordHash: 'x', name: '招聘会审核验证管理员', role: 'admin' },
    })
    await prisma.user.create({
      data: { id: partner.userId, username: `${RESIDUE_TAG}_partner_${suffix}`, passwordHash: 'x', name: '导入机构账号', role: 'partner', orgId },
    })
    await prisma.user.create({
      data: { id: otherPartner.userId, username: `${RESIDUE_TAG}_partner_b_${suffix}`, passwordHash: 'x', name: '对照机构账号', role: 'partner', orgId: otherOrgId },
    })

    const externalId = `FAIR-imp-${suffix}`
    const sourceUrl = 'https://example.com/fairs/import'
    const venueToken = `Hall-${suffix}`
    const otherVenue = `HallB-${suffix}`
    const item = (title: string, venue: string): ImportFairItemDto => ({
      externalId,
      title,
      theme: 'campus',
      startAt: '1970-01-01T00:00:01.000Z',
      endAt: '1970-01-01T01:00:01.000Z',
      venue,
      city: '青岛',
      sourceUrl,
      description: '用于审核闭环的招聘会说明',
    })
    const publicHit = async (id: string, keyword: string): Promise<PublicVisibility> => {
      const listed = await jobs.getPublishedFairs({ keyword, pageSize: 100 })
      const byId = await jobs.getPublishedFairById(id)
      const detail = await jobs.getPublishedFairDetail(id)
      return {
        inList: listed.data.some((row) => row.id === id),
        inById: byId.data?.id === id,
        inDetail: detail?.fair.id === id,
      }
    }

    // ── 0. Partner 身份 / 机构归属 ──────────────────────────────────────
    const before = await prisma.jobFair.count({ where: { externalId } })
    await expectCode(
      () => jobs.importFairs({ items: [item('无机构', venueToken)] }, { userId: partner.userId, role: 'partner', orgId: null }),
      'PARTNER_ORG_REQUIRED',
      '0a. partner 无 orgId → 400 PARTNER_ORG_REQUIRED',
    )
    await expectCode(
      () => jobs.importFairs({ items: [item('非机构角色', venueToken)] }, { userId: adminUser.userId, role: 'admin', orgId }),
      'PARTNER_ORG_REQUIRED',
      '0b. admin 即使带 orgId 也不得导入 → 400 PARTNER_ORG_REQUIRED',
    )
    if (await prisma.jobFair.count({ where: { externalId } }) !== before) fail('0c. 身份拒绝仍写入了招聘会')
    else pass('0c. 身份拒绝不写招聘会行')

    // ── 1. Partner 导入：归属本机构，初始 pending + draft ───────────────
    const imported = await jobs.importFairs({ items: [item('导入招聘会', venueToken)] }, partner)
    const fairA = imported.items[0]?.id
    if (fairA) fairIds.push(fairA)
    if (!fairA || imported.imported !== 1) fail('1. 导入未返回招聘会')
    const init = await prisma.jobFair.findUnique({ where: { id: fairA } })
    if (
      init?.sourceOrgId === orgId
      && init.sourceName === `招聘会审核机构_${suffix}`
      && init.externalId === externalId
      && init.sourceUrl === sourceUrl
      && init.reviewStatus === 'pending'
      && init.publishStatus === 'draft'
      && init.reviewedBy == null
      && init.reviewedAt == null
      && init.rejectReason == null
    ) pass('1. Partner 导入归属本机构，初始 pending + draft')
    else fail(`1. 导入初始状态异常: ${init?.sourceOrgId}/${init?.sourceName}/${init?.reviewStatus}/${init?.publishStatus}`)

    const otherImported = await jobs.importFairs({ items: [item('他机构同外部编号', otherVenue)] }, otherPartner)
    const otherId = otherImported.items[0]?.id
    if (otherId) fairIds.push(otherId)
    if (!otherId || otherImported.imported !== 1) fail('1b. 他机构导入未返回招聘会')
    const otherRow = await prisma.jobFair.findUnique({ where: { id: otherId } })
    const ownList = await jobs.getPartnerFairs(partner)
    const otherList = await jobs.getPartnerFairs(otherPartner)
    if (!Array.isArray(ownList) || !Array.isArray(otherList)) fail('1b. 未分页机构列表应为数组')
    if (
      otherId !== fairA
      && otherRow?.sourceOrgId === otherOrgId
      && otherRow.sourceName === `对照招聘会机构_${suffix}`
      && ownList.some((row) => row.id === fairA)
      && !ownList.some((row) => row.id === otherId)
      && otherList.some((row) => row.id === otherId)
      && !otherList.some((row) => row.id === fairA)
    ) pass('1b. 相同 externalId 按机构拆行，机构列表互不可见')
    else fail(`1b. 机构归属异常: ${otherId}/${otherRow?.sourceOrgId}`)

    const pendingTitle = `待审对照 ${suffix}`
    const fairPending = await mkFair('pending', {
      title: pendingTitle,
      sourceName: `来源 ${suffix}`,
      venue: `对照展馆 ${suffix}`,
      city: '青岛',
      sourceUrl: 'https://example.com/fairs/pending',
    })
    const importedHit = await publicHit(fairA, venueToken)
    const otherHit = await publicHit(otherId, otherVenue)
    const pendingHit = await publicHit(fairPending, pendingTitle)
    if (isHidden(importedHit) && isHidden(otherHit) && isHidden(pendingHit)) {
      pass('1d. 未审核导入对公开列表、按编号读取和详情都不可见')
    } else {
      fail(`1d. 未审核招聘会进入公开查询: imported=${visibilityText(importedHit)} other=${visibilityText(otherHit)} pending=${visibilityText(pendingHit)}`)
    }

    // 导入本身不带拒绝原因。先写入一条历史原因，再证明 approve 会清掉它。
    await prisma.jobFair.update({ where: { id: fairA }, data: { rejectReason: '历史拒绝原因' } })

    // ── 2. 未 approved 禁止 publish（红线）─────────────────────────────
    await expectCode(() => jobs.publishFairSource(fairA, 'publish', adminUser), 'PUBLISH_REQUIRES_APPROVAL', '2. 未审核通过 publish → 400 PUBLISH_REQUIRES_APPROVAL')

    // ── 3. reviewing 可进入审核中 ──────────────────────────────────────
    const reviewing = await jobs.reviewFairSource(fairA, 'reviewing', undefined, adminUser)
    if (reviewing.reviewStatus === 'reviewing' && reviewing.publishStatus === 'draft') pass('3. reviewing → reviewing + draft')
    else fail(`3. reviewing 异常: ${reviewing.reviewStatus}/${reviewing.publishStatus}`)

    // ── 4. approve → approved + draft（不自动发布）──────────────────────
    const approved = await jobs.reviewFairSource(fairA, 'approve', undefined, adminUser)
    const approvedRow = await prisma.jobFair.findUnique({ where: { id: fairA }, select: { rejectReason: true } })
    const approvedHit = await publicHit(fairA, venueToken)
    if (
      approved.reviewStatus === 'approved'
      && approved.publishStatus === 'draft'
      && approvedRow?.rejectReason === null
      && isHidden(approvedHit)
    ) {
      pass('4. approve → approved + draft，并清空 rejectReason（不自动发布，列表和详情仍不可见）')
    } else {
      fail(`4. approve 异常: dto=${JSON.stringify(approved)} rejectReason=${approvedRow?.rejectReason} ${visibilityText(approvedHit)}`)
    }

    // ── 5. approved 后 publish → published ──────────────────────────────
    const published = await jobs.publishFairSource(fairA, 'publish', adminUser)
    const publishedHit = await publicHit(fairA, venueToken)
    if (published.publishStatus === 'published' && isShown(publishedHit)) {
      pass('5. approved 后 publish → published，列表、按编号读取和详情都可见')
    } else {
      fail(`5. publish 异常: ${published.publishStatus} ${visibilityText(publishedHit)}`)
    }

    // ── 6. 公开查询只返回 approved + published ──────────────────────────
    const publishedAgain = await publicHit(fairA, venueToken)
    const pendingAgain = await publicHit(fairPending, pendingTitle)
    if (isShown(publishedAgain) && isHidden(pendingAgain)) {
      pass('6. 公开查询：fairA 的列表和详情可见，pending 对照的列表和详情都不可见')
    } else {
      fail(`6. 公开可见性异常: fairA=${visibilityText(publishedAgain)} pending=${visibilityText(pendingAgain)}`)
    }

    // ── 7. unpublish → unpublished（不再公开）──────────────────────────
    const unpub = await jobs.publishFairSource(fairA, 'unpublish', adminUser)
    const unpublishedHit = await publicHit(fairA, venueToken)
    if (unpub.publishStatus === 'unpublished' && isHidden(unpublishedHit)) {
      pass('7. unpublish → unpublished，列表、按编号读取和详情都不再公开')
    } else {
      fail(`7. unpublish 异常: ${unpub.publishStatus} ${visibilityText(unpublishedHit)}`)
    }

    // ── 8. 终态不可再次审核（approved）─────────────────────────────────
    await expectCode(() => jobs.reviewFairSource(fairA, 'reviewing', undefined, adminUser), 'INVALID_STATE_TRANSITION', '8a. approved（终态）再 review → 400 INVALID_STATE_TRANSITION')

    // ── 14. 已发布后再导入：同一行强制下架重审 ─────────────────────────
    const republished = await jobs.publishFairSource(fairA, 'publish', adminUser)
    const republishedHit = await publicHit(fairA, venueToken)
    const beforeReset = await prisma.jobFair.findUnique({ where: { id: fairA }, select: { reviewedBy: true, reviewedAt: true } })
    if (republished.publishStatus !== 'published' || !isShown(republishedHit) || beforeReset?.reviewedBy !== adminUser.userId || beforeReset.reviewedAt == null) {
      fail(`14. 再导入前未能重新发布: ${republished.publishStatus} ${visibilityText(republishedHit)} reviewedBy=${beforeReset?.reviewedBy ?? 'null'}`)
    }
    const again = await jobs.importFairs({ items: [item('再导入招聘会', venueToken)] }, partner)
    if (again.items[0]?.id !== fairA || again.imported !== 1) fail('14. 再导入没有命中同一行')
    const reset = await prisma.jobFair.findUnique({ where: { id: fairA } })
    const resetHit = await publicHit(fairA, venueToken)
    if (
      reset?.reviewStatus !== 'pending'
      || reset.publishStatus !== 'draft'
      || reset.title !== '再导入招聘会'
      || reset.reviewedBy != null
      || reset.reviewedAt != null
      || reset.rejectReason != null
      || !isHidden(resetHit)
    ) {
      fail(`14. 再导入未强制下架重审: ${reset?.reviewStatus}/${reset?.publishStatus}/${reset?.title} ${visibilityText(resetHit)}`)
    }
    const importAudits = await prisma.auditLog.findMany({
      where: { actorId: partner.userId, action: 'fair.import', targetType: 'fair' },
    })
    const sawExternalId = importAudits.some((row) => {
      const payload = parsePayload(row.payloadJson)
      return Array.isArray(payload.externalIds) && payload.externalIds.includes(externalId)
    })
    if (importAudits.length >= 2 && sawExternalId) {
      pass('14. 已发布后再导入 → 同一行 pending+draft、审核元数据清空、列表和详情不可见，fair.import 审计已落库')
    } else {
      fail(`14. 导入审计缺失: audits=${importAudits.length} payload=${sawExternalId}`)
    }

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
    const dirtyTitle = `脏态 ${suffix}`
    const fairDirty = await mkFair('dirty', {
      reviewStatus: 'reviewing',
      publishStatus: 'published',
      title: dirtyTitle,
      sourceName: `脏态来源 ${suffix}`,
      venue: `脏态展馆 ${suffix}`,
      city: '青岛',
      sourceUrl: 'https://example.com/fairs/dirty',
    })
    const forcedDraft = await jobs.reviewFairSource(fairDirty, 'reject', '撤下并拒绝', adminUser)
    const dirtyHit = await publicHit(fairDirty, dirtyTitle)
    if (
      forcedDraft.reviewStatus === 'rejected'
      && forcedDraft.publishStatus === 'draft'
      && isHidden(dirtyHit)
    ) {
      pass('11. reject 强制 publishStatus=draft，脏态的列表、按编号读取和详情都不再公开')
    } else {
      fail(`11. reject force-draft 异常: ${forcedDraft.reviewStatus}/${forcedDraft.publishStatus} ${visibilityText(dirtyHit)}`)
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

    // ── 13. ADM-C15 GET /admin/fair-sources 可选分页 ────────────────────
    {
      const controller = readFileSync(join(process.cwd(), 'src/jobs/jobs.controller.ts'), 'utf8')
      const fn = controller.slice(controller.indexOf('getFairSources('), controller.indexOf('getFairSources(') + 900)
      if (!fn.includes("@Query('page')") || !fn.includes("@Query('pageSize')")) {
        fail('13a. GET /admin/fair-sources 未声明 page/pageSize')
      }
      pass('13a. GET /admin/fair-sources 声明 page/pageSize')

      const tag = `ADM_C15_FAIR_${suffix}`
      await mkFair('p1', { title: `${tag} one` })
      await mkFair('p2', { title: `${tag} two` })
      await mkFair('p3', { title: `${tag} three` })
      const unpaged = await jobs.getAllFairSources()
      if (!Array.isArray(unpaged)) fail('13b. 缺省参数必须保持裸数组')
      if (!unpaged.some((f) => f.name.includes(tag))) fail('13b. 缺省数组未包含分页夹具')
      pass('13b. 缺省参数返回裸数组')

      const paged = await jobs.getAllFairSources({ page: '1', pageSize: '2', keyword: tag })
      if (Array.isArray(paged)) fail('13c. 带 page/pageSize 不得返回裸数组')
      if (paged.total !== 3 || paged.page !== 1 || paged.pageSize !== 2 || paged.items.length !== 2) {
        fail(`13c. 分页形状异常: total=${paged.total} page=${paged.page} pageSize=${paged.pageSize} items=${paged.items.length}`)
      }
      if (paged.items.length > paged.pageSize) fail('13c. items.length > pageSize')
      pass('13c. 带分页参数返回 total 且 items.length ≤ pageSize')

      const page2 = await jobs.getAllFairSources({ page: '2', pageSize: '2', keyword: tag })
      if (Array.isArray(page2) || page2.items.length !== 1 || page2.total !== 3) {
        fail('13d. 第二页未按 skip/take 切片')
      }
      pass('13d. 第二页 skip/take 生效')
    }

    const previousHosting = process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED
    process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
    try {
      const hidden = await jobs.getPublishedFairs({})
      if (hidden.data.length !== 0) fail('托管关闭时公开招聘会列表不是空')
      else pass('托管关闭时招聘会列表返回空')
      await expectCode(() => jobs.publishFairSource(fairA, 'publish', adminUser), 'RECRUITMENT_HOSTING_DISABLED', '托管关闭时管理员发布招聘会被拒')
      await expectCode(() => jobs.importFairs({ items: [item('关闭后导入', venueToken)] }, partner), 'RECRUITMENT_HOSTING_DISABLED', '托管关闭时招聘会导入停止')
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
