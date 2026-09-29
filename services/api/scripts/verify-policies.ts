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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService } from '../src/policies/policies.service'
import { PolicyEligibilityService } from '../src/policies/policy-eligibility.service'
import { CreatePolicyPostDto, POLICY_AUDIENCES } from '../src/policies/dto/policy.dto'
import { CommunityService } from '../src/community/community.service'
import { MemberFavoritesService } from '../src/member-favorites/member-favorites.service'
import { ActivityService } from '../src/activity/activity.service'
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
      // contentTrustStatus='active':发布闸门要求来源机构已通过内容信任核验(见 src/common/content-trust.ts)
      { id: orgA, name: `政策机构A_${suffix}`, type: 'public_employment_service', contentTrustStatus: 'active' },
      { id: orgB, name: `政策机构B_${suffix}`, type: 'public_employment_service', contentTrustStatus: 'active' },
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
    await prisma.partnerOrgNotice.deleteMany({ where: { orgId: { in: [orgA, orgB] } } }).catch(() => undefined)
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { orgId: { in: [orgA, orgB] } } }).catch(() => undefined)
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
      await expectCode(() => svc.getPublishedPolicyById(guide.id), 'POLICY_NOT_FOUND', '2b. 未发布详情 404')
    }

    // ── 4a. 未过审发布被拒 ─────────────────────────────────────────────────
    await expectCode(() => svc.publishPolicy(guide.id, 'publish', admin), 'ADMIN_POLICY_PUBLISH_DISABLED', '4a-admin. 管理员发布被拒')
    await expectCode(
      () => svc.publishPolicy(guide.id, 'publish', partnerA, { responsibilityAcknowledged: true }),
      'PUBLISH_REQUIRES_APPROVAL',
      '4a. 未过审发布 → PUBLISH_REQUIRES_APPROVAL',
    )
    await expectCode(() => svc.reviewPolicy(guide.id, 'reject', undefined, partnerA), 'REJECT_REASON_REQUIRED', '4b. reject 缺原因被拒')

    // ── 3. 机构审核 + 发布确认 → Kiosk 可见 + 过滤 ─────────────────────────
    {
      await svc.reviewPolicy(guide.id, 'approve', undefined, partnerA)
      const published = await svc.publishPolicy(guide.id, 'publish', partnerA, { responsibilityAcknowledged: true })
      if (published.publishConfirmedBy !== partnerA.userId || published.publishConfirmedContentVersion !== published.contentVersion) {
        fail('3-ack. 发布确认没有记下确认人和版本号')
      }
      await svc.reviewPolicy(noticePost.id, 'approve', undefined, partnerA)
      await svc.publishPolicy(noticePost.id, 'publish', partnerA, { responsibilityAcknowledged: true })

      const all = await svc.getPublishedPolicies()
      if (!all.data.some((p) => p.id === guide.id) || !all.data.some((p) => p.id === noticePost.id)) {
        fail('3. 审核发布后公开列表不可见')
      }
      const onlyGuides = await svc.getPublishedPolicies({ kind: 'policy_guide' })
      if (onlyGuides.data.some((p) => p.kind !== 'policy_guide')) fail('3. kind 过滤失效')
      const onlyGraduate = await svc.getPublishedPolicies({ audience: 'graduate' })
      if (!onlyGraduate.data.some((p) => p.id === guide.id)) fail('3. audience 过滤失效')
      const detail = await svc.getPublishedPolicyById(guide.id)
      if (detail.data.id !== guide.id || detail.data.reviewStatus !== 'approved') fail('3b. GET /policies/:id 未返回已发布政策')
      await expectCode(() => svc.getPublishedPolicyById('missing-policy-id'), 'POLICY_NOT_FOUND', '3c. 不存在的政策详情 404')
      pass('3. approve+publish 后 Kiosk 可见,kind/audience 过滤生效,公开详情可读')
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

    await svc.reviewPolicy(guide.id, 'approve', undefined, partnerA)
    await svc.publishPolicy(guide.id, 'unpublish', admin, { reasonCode: 'rights_complaint', reasonText: '权利投诉核验' })
    await expectCode(
      () => svc.publishPolicy(guide.id, 'publish', partnerA, { responsibilityAcknowledged: true }),
      'EMERGENCY_TAKEDOWN_IRREVERSIBLE',
      '下架后不能恢复',
    )
    const notices = await prisma.partnerOrgNotice.findMany({ where: { orgId: orgA } })
    if (!notices.some((row) => row.kind === 'recruitment_emergency_takedown')) fail('政策下架通知未写出')
    else pass('政策下架通知写出')

    {
      const unpaged = await svc.getPartnerPolicies(partnerA)
      if (!Array.isArray(unpaged)) fail('PTR-22. 缺省 getPartnerPolicies 应保持数组形状')
      const paged = await svc.getPartnerPolicies(partnerA, { page: 1, pageSize: 1 })
      if (!('data' in paged) || paged.data.length !== 1) fail('PTR-22. 带 page 的政策列表应返回单页 {data,pagination}')
      if (paged.pagination.total < 1) fail('PTR-22. 政策 total 未计入本机构行')
      pass('PTR-22. 政策列表缺省保持数组，带 page/pageSize 走 skip/take + count')
    }

    {
      const pendingRow = await prisma.policyPost.create({
        data: {
          sourceOrgId: orgA, sourceName: `政策机构A_${suffix}`, kind: 'notice', title: `筛选待审_${suffix}`,
          category: 'notice', reviewStatus: 'pending', publishStatus: 'draft',
        },
      })
      const approvedRow = await prisma.policyPost.create({
        data: {
          sourceOrgId: orgA, sourceName: `政策机构A_${suffix}`, kind: 'notice', title: `筛选已过_${suffix}`,
          category: 'notice', reviewStatus: 'approved', publishStatus: 'published',
        },
      })
      const pendingOnly = await svc.getPartnerPolicies(partnerA, { page: 1, pageSize: 50, reviewStatus: 'pending' })
      if (!('data' in pendingOnly)) fail('RES-5. 政策带筛选分页应返回 {data,pagination}')
      if (pendingOnly.data.some((p) => p.reviewStatus !== 'pending')) fail('RES-5. 政策 reviewStatus=pending 混入其他态')
      if (!pendingOnly.data.some((p) => p.id === pendingRow.id)) fail('RES-5. 政策 pending 筛选漏目标行')
      if (pendingOnly.data.some((p) => p.id === approvedRow.id)) fail('RES-5. 政策 pending 筛选含已通过')
      const publishedOnly = await svc.getPartnerPolicies(partnerA, { page: 1, pageSize: 50, publishStatus: 'published' })
      if (publishedOnly.data.some((p) => p.publishStatus !== 'published')) fail('RES-5. 政策 publishStatus 未下推')
      const ignored = await svc.getPartnerPolicies(partnerA, { page: 1, pageSize: 50, reviewStatus: 'not-a-status' })
      const unfiltered = await svc.getPartnerPolicies(partnerA, { page: 1, pageSize: 50 })
      if (ignored.pagination.total !== unfiltered.pagination.total) fail('RES-5. 政策非法 reviewStatus 应收口为缺省')
      pass('RES-5. Partner 政策列表筛选下推 where，非法值缺省不变')
    }
    // ── 9. ADM-C15 GET /admin/policy-sources 可选分页 ───────────────────
    {
      const controller = readFileSync(join(process.cwd(), 'src/policies/policies.controller.ts'), 'utf8')
      const fn = controller.slice(controller.indexOf('getPolicySources('), controller.indexOf('getPolicySources(') + 900)
      if (!fn.includes("@Query('page')") || !fn.includes("@Query('pageSize')")) {
        fail('9a. GET /admin/policy-sources 未声明 page/pageSize')
      }
      pass('9a. GET /admin/policy-sources 声明 page/pageSize')

      const tag = `ADM_C15_PAGE_${suffix}`
      await svc.createPartnerPolicy({ kind: 'notice', title: `${tag}_1`, category: 'notice' }, partnerA)
      await svc.createPartnerPolicy({ kind: 'notice', title: `${tag}_2`, category: 'notice' }, partnerA)
      await svc.createPartnerPolicy({ kind: 'notice', title: `${tag}_3`, category: 'notice' }, partnerA)
      const unpaged = await svc.getAllPolicySources()
      if (!Array.isArray(unpaged)) fail('9b. 缺省参数必须保持裸数组')
      if (!unpaged.some((p) => p.title.includes(tag))) fail('9b. 缺省数组未包含分页夹具')
      pass('9b. 缺省参数返回裸数组')

      const paged = await svc.getAllPolicySources({ page: '1', pageSize: '2', keyword: tag })
      if (Array.isArray(paged)) fail('9c. 带 page/pageSize 不得返回裸数组')
      if (paged.total !== 3 || paged.page !== 1 || paged.pageSize !== 2 || paged.items.length !== 2) {
        fail(`9c. 分页形状异常: total=${paged.total} page=${paged.page} pageSize=${paged.pageSize} items=${paged.items.length}`)
      }
      if (paged.items.length > paged.pageSize) fail('9c. items.length > pageSize')
      pass('9c. 带分页参数返回 total 且 items.length ≤ pageSize')

      const page2 = await svc.getAllPolicySources({ page: '2', pageSize: '2', keyword: tag })
      if (Array.isArray(page2) || page2.items.length !== 1 || page2.total !== 3) {
        fail('9d. 第二页未按 skip/take 切片')
      }
      pass('9d. 第二页 skip/take 生效')
    }

    // ── P1. 托管关闭时 recruitment 分类不能当政策旁路 ─────────────────────
    {
      const previousHosting = process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED
      const eligibility = new PolicyEligibilityService(prisma, audit)
      const community = new CommunityService(prisma, {
        get: async () => null,
        setEx: async () => 'OK',
      } as never)
      const favorites = new MemberFavoritesService(prisma)
      const activity = new ActivityService(prisma)
      const sourceName = `政策机构A_${suffix}`
      try {
        process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
        await expectCode(
          () => svc.createPartnerPolicy({ kind: 'notice', title: `招聘旁路_${suffix}`, category: 'recruitment' }, partnerA),
          'RECRUITMENT_HOSTING_DISABLED',
          'P1a. 托管关闭时不能新建 recruitment 政策',
        )
        const stock = await prisma.policyPost.create({
          data: {
            sourceOrgId: orgA, sourceName, kind: 'notice', title: `存量招聘_${suffix}`,
            category: 'recruitment', reviewStatus: 'approved', publishStatus: 'published',
            externalUrl: 'https://jobs.example.com/list', content: '岗位与招聘会清单',
            publishedDate: new Date('2099-01-02'),
          },
        })
        const pendingStock = await prisma.policyPost.create({
          data: {
            sourceOrgId: orgA, sourceName, kind: 'notice', title: `待审招聘_${suffix}`,
            category: 'recruitment', reviewStatus: 'pending', publishStatus: 'draft',
          },
        })
        const stockGuide = await prisma.policyPost.create({
          data: {
            sourceOrgId: orgA, sourceName, kind: 'policy_guide', title: `扶持招聘_${suffix}`,
            audience: 'graduate', category: 'recruitment', reviewStatus: 'approved', publishStatus: 'published',
            publishedDate: new Date('2099-01-03'),
          },
        })
        const normalGuide = await prisma.policyPost.create({
          data: {
            sourceOrgId: orgA, sourceName, kind: 'policy_guide', title: `扶持正常_${suffix}`,
            audience: 'graduate', category: 'policy', reviewStatus: 'approved', publishStatus: 'published',
            publishedDate: new Date('2099-01-04'),
          },
        })
        await expectCode(
          () => svc.updatePartnerPolicy(stock.id, { title: `改存量_${suffix}` }, partnerA),
          'RECRUITMENT_HOSTING_DISABLED',
          'P1b. 托管关闭时不能修改 recruitment 政策',
        )
        await expectCode(
          () => svc.updatePartnerPolicy(stock.id, { category: 'notice' }, partnerA),
          'RECRUITMENT_HOSTING_DISABLED',
          'P1c. 托管关闭时不能把 recruitment 改成其他分类',
        )
        await expectCode(
          () => svc.updatePartnerPolicy(normalGuide.id, { category: 'recruitment' }, partnerA),
          'RECRUITMENT_HOSTING_DISABLED',
          'P1d. 托管关闭时不能把普通政策改成 recruitment',
        )
        await expectCode(
          () => svc.reviewPolicy(pendingStock.id, 'approve', undefined, partnerA),
          'RECRUITMENT_HOSTING_DISABLED',
          'P1e. 托管关闭时不能审核通过 recruitment 政策',
        )
        await expectCode(
          () => svc.publishPolicy(stock.id, 'publish', partnerA, { responsibilityAcknowledged: true }),
          'RECRUITMENT_HOSTING_DISABLED',
          'P1f. 托管关闭时不能发布 recruitment 政策',
        )
        const hidden = await svc.getPublishedPolicies({ category: 'recruitment' })
        if (hidden.data.some((row) => row.id === stock.id || row.id === stockGuide.id)) {
          fail('P1g. 公开列表仍返回 recruitment 分类')
        }
        const visibleNormal = await svc.getPublishedPolicies()
        if (!visibleNormal.data.some((row) => row.id === normalGuide.id)) fail('P1g. 普通政策被公开列表误伤')
        if (visibleNormal.data.some((row) => row.hostingStock)) fail('P1g. 公开列表不应带 hostingStock')
        await expectCode(() => svc.getPublishedPolicyById(stock.id), 'POLICY_NOT_FOUND', 'P1h. 公开详情不返回 recruitment')
        const detail = await svc.getPublishedPolicyById(normalGuide.id)
        if (detail.data.id !== normalGuide.id || detail.data.hostingStock) fail('P1h. 普通政策详情异常')
        const checked = await eligibility.checkEligibility({ policyIds: [stockGuide.id, normalGuide.id] })
        if (checked.items.some((item) => item.policyId === stockGuide.id)) fail('P1i. 条件核对仍返回 recruitment')
        if (!checked.items.some((item) => item.policyId === normalGuide.id)) fail('P1i. 条件核对漏了普通政策')
        pass('P1i. 公开列表、详情、条件核对排除 recruitment，普通政策仍在')
        const feed = await community.list()
        if (feed.items.some((item) => item.id === `policy:${stock.id}` || item.id === `policy:${stockGuide.id}`)) {
          fail('P1j. 职业圈仍展示 recruitment 政策')
        }
        if (!feed.items.some((item) => item.id === `policy:${normalGuide.id}`)) fail('P1j. 职业圈漏了普通政策')
        pass('P1j. 职业圈不展示 recruitment 政策')
        await expectCode(
          () => favorites.add('p1-nobody', { targetType: 'policy', targetId: stock.id }),
          'FAVORITE_TARGET_NOT_FOUND',
          'P1k. 收藏读取口不把 recruitment 当已发布',
        )
        await expectCode(
          () => activity.recordBrowse('p1-nobody', 'policy', stock.id, null),
          'ACTIVITY_TARGET_NOT_FOUND',
          'P1l. 浏览记录读取口不把 recruitment 当已发布',
        )
        const partnerRows = await svc.getPartnerPolicies(partnerA)
        if (!Array.isArray(partnerRows)) fail('P1m. 机构列表缺省应仍是数组')
        const partnerStock = partnerRows.find((row) => row.id === stock.id)
        if (!partnerStock || partnerStock.hostingStock !== true || partnerStock.title !== `存量招聘_${suffix}`) {
          fail('P1m. 机构列表应看到存量且只多 hostingStock')
        }
        if (partnerRows.some((row) => row.id === normalGuide.id && row.hostingStock)) {
          fail('P1m. 普通政策不应标 hostingStock')
        }
        const adminRows = await svc.getAllPolicySources()
        if (!Array.isArray(adminRows)) fail('P1n. 管理员列表缺省应仍是数组')
        const adminStock = adminRows.find((row) => row.id === stock.id)
        if (!adminStock || adminStock.hostingStock !== true) fail('P1n. 管理员列表应看到存量并带 hostingStock')
        pass('P1n. 机构和管理员列表保留存量，并带 hostingStock')

        process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'true'
        const opened = await svc.createPartnerPolicy(
          { kind: 'notice', title: `b招聘_${suffix}`, category: 'recruitment' },
          partnerA,
        )
        if (opened.category !== 'recruitment' || opened.hostingStock) fail('P1o. 托管打开时 recruitment 应能新建且不带存量标记')
        await svc.reviewPolicy(opened.id, 'approve', undefined, partnerA)
        const openedPublished = await svc.publishPolicy(opened.id, 'publish', partnerA, { responsibilityAcknowledged: true })
        if (openedPublished.publishStatus !== 'published' || openedPublished.hostingStock) {
          fail('P1o. 托管打开时 recruitment 应能发布且不带存量标记')
        }
        const openedList = await svc.getPublishedPolicies()
        if (!openedList.data.some((row) => row.id === opened.id) || !openedList.data.some((row) => row.id === stock.id)) {
          fail('P1o. 托管打开时已发布的 recruitment 应回到公开列表')
        }
        pass('P1o. 托管打开时 recruitment 分类读写与公开读取保持原样')
      } finally {
        if (previousHosting === undefined) delete process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED
        else process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = previousHosting
      }
    }

    // ── P2. 紧急下架与机构发布并发，不能留下「有 hold 且 published」────────
    {
      // 根客户端的 update 若在「改成 unpublished」之后让出事件循环，旧的两步下架会被发布插进来。
      // 正确实现走事务客户端，不经过这次让出。
      const policyWrites = prisma.policyPost as unknown as {
        update: (args: { where: { id: string }; data: { publishStatus?: string } }) => Promise<unknown>
      }
      const originalPolicyUpdate = policyWrites.update.bind(policyWrites)
      policyWrites.update = async (args) => {
        const result = await originalPolicyUpdate(args)
        if (args.data?.publishStatus === 'unpublished') {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return result
      }
      const race = await svc.createPartnerPolicy(
        { kind: 'notice', title: `并发下架_${suffix}`, category: 'notice' },
        partnerA,
      )
      await svc.reviewPolicy(race.id, 'approve', undefined, partnerA)
      const rounds = 40
      for (let i = 0; i < rounds; i += 1) {
        await prisma.recruitmentEmergencyHold.deleteMany({ where: { targetType: 'policy', targetId: race.id } })
        await prisma.policyPost.update({
          where: { id: race.id },
          data: {
            reviewStatus: 'approved',
            publishStatus: 'draft',
            publishConfirmedBy: null,
            publishConfirmedAt: null,
            publishConfirmedContentVersion: null,
          },
        })
        await Promise.allSettled([
          svc.publishPolicy(race.id, 'unpublish', admin, { reasonCode: 'illegal_content', reasonText: `并发下架第${i}次` }),
          svc.publishPolicy(race.id, 'publish', partnerA, { responsibilityAcknowledged: true }),
        ])
        const row = await prisma.policyPost.findUnique({ where: { id: race.id } })
        const hold = await prisma.recruitmentEmergencyHold.findFirst({
          where: { targetType: 'policy', targetId: race.id },
        })
        if (hold && row?.publishStatus === 'published') {
          fail(`P2. 第 ${i} 次并发后出现 hold 且 published`)
        }
        const listed = await svc.getPublishedPolicies()
        if (hold && listed.data.some((item) => item.id === race.id)) {
          fail(`P2. 第 ${i} 次并发后公开列表仍能读到有 hold 的政策`)
        }
      }
      await prisma.policyPost.update({
        where: { id: race.id },
        data: { reviewStatus: 'approved', publishStatus: 'published' },
      })
      await prisma.recruitmentEmergencyHold.upsert({
        where: { targetType_targetId: { targetType: 'policy', targetId: race.id } },
        create: {
          targetType: 'policy',
          targetId: race.id,
          orgId: orgA,
          reasonCode: 'false_information',
          reasonText: '纵深防御夹具',
          actorId: admin.userId,
        },
        update: { reasonText: '纵深防御夹具' },
      })
      const planted = await svc.getPublishedPolicies()
      if (planted.data.some((item) => item.id === race.id)) fail('P2. 直接写成有 hold 且 published 后，公开列表仍能读到')
      await expectCode(() => svc.getPublishedPolicyById(race.id), 'POLICY_NOT_FOUND', 'P2. 有 hold 的政策详情不可读')
      policyWrites.update = originalPolicyUpdate
      pass(`P2. ${rounds} 次并发下架与发布没有出现 hold 且 published，公开读取也排除 hold`)
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
