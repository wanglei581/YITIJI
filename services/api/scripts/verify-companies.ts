/**
 * 企业展示（CompanyProfile）— 离线回归验证（可进 CI）。
 *
 *  1. Admin 创建 → 默认 pending+draft → 公开列表不可见；未审核发布 → 400
 *  2. 审核通过 + 发布 → 公开可见（来源快照齐全；openJobCount 真实=0）
 *  3. 关联岗位：同机构已发布岗位可关联；未发布 / 跨机构岗位进 rejected；
 *     关联后 openJobCount/代表岗位/企业岗位列表真实更新
 *  4. 筛选：省市 / 企业类型 / 行业 / 招聘类型 / 来源逐项过滤正确；非法枚举 400
 *  5. 统计条全部真实聚合（companyCount/openJobCount/todayNew/fairCompany）
 *  6. 筛选可选项只来自真实已发布企业
 *  7. 指标开关：关闭项不下发；开关开启但数据为空也不下发（不造假数字）
 *  8. 未发布企业详情 / 岗位列表 → 404
 *  9. Partner：导入 upsert 默认 pending+draft + created/updated 计数 +
 *     jobExternalIds 关联本机构岗位；编辑已审核企业强制回 pending+draft；跨机构 PATCH → 404
 * 10. 浏览/跳转闭环：company_profile 浏览与 external_open 跳转落库（快照服务端补齐）；
 *     企业用 external_apply → 400；未发布企业 → 404
 * 11. 禁词扫描（企业展示相关前后端文件无投递闭环/录用承诺文案）+ 响应 JSON 无候选人字段
 * 12. 完整字典：补齐的企业类型/行业（合资/校企/公共机构/其他 + AI/大数据/其他）前后端同步，
 *     shared/backend 字典一致，新增类型/行业可被 Admin 保存、后端真实筛选命中
 * 13. 完整地区字典：选到无企业地区返回真实空态（列表空 + 统计 0），不造数据；
 *     直辖市使用省+区过滤可命中真实企业；常见无后缀地区录入可被规范筛选命中
 * 14. 正式前端企业页（apps/kiosk/src/pages/companies）无「演示」字样
 * 15. Admin/Partner 企业地区录入使用共享行政区划级联选择；旧 filters 接口明确为兼容/诊断链路
 *
 * 运行：pnpm --filter @ai-job-print/api verify:companies
 */
require('dotenv').config()

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { CompaniesService } from '../src/companies/companies.service'
import { ActivityService } from '../src/activity/activity.service'
import { COMPANY_INDUSTRIES, COMPANY_SOURCE_KINDS, COMPANY_TYPES } from '../src/companies/companies.types'
import {
  COMPANY_INDUSTRIES as SHARED_COMPANY_INDUSTRIES,
  COMPANY_SOURCE_KINDS as SHARED_COMPANY_SOURCE_KINDS,
  COMPANY_TYPES as SHARED_COMPANY_TYPES,
} from '../../../packages/shared/src/types/company'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

const PAGE = { cursor: null, pageSize: 20 }

async function expectStatus(p: Promise<unknown>, status: number, label: string) {
  try {
    await p
    fail(`${label}: 应拒绝（${status}）但成功了`)
  } catch (e) {
    const got = (e as { getStatus?: () => number }).getStatus?.()
    if (got !== status) fail(`${label}: 期望 ${status}，得到 ${got ?? String(e)}`)
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

function expectSameSet(actual: readonly string[], expected: readonly string[], label: string) {
  const a = [...actual].sort()
  const e = [...expected].sort()
  if (a.length !== e.length || a.some((v, i) => v !== e[i])) {
    fail(`${label}: 字典不一致 actual=${JSON.stringify(a)} expected=${JSON.stringify(e)}`)
  }
}

async function main() {
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const companies = new CompaniesService(prisma, audit)
  const activity = new ActivityService(prisma)

  const tag = `vfco${Date.now()}`
  const orgA = `orgA-${tag}`
  const orgB = `orgB-${tag}`
  const admin = { userId: `admin-${tag}` } // 真实 User 行在测试数据区创建(AuditLog.actorId FK)
  let companyId = ''
  let userA = ''

  try {
    // ── 测试数据：两个来源机构 + 三个岗位 ─────────────────────
    await prisma.organization.create({ data: { id: orgA, name: `人社平台机构${tag}`, type: 'public_employment_service' } })
    await prisma.organization.create({ data: { id: orgB, name: `高校就业网${tag}`, type: 'school_employment_center' } })
    await prisma.user.create({ data: { id: admin.userId, username: `vadmin-${tag}`, passwordHash: 'x', name: '验证管理员', role: 'admin' } })
    await prisma.user.create({ data: { id: `pu-${tag}`, username: `vpartner-${tag}`, passwordHash: 'x', name: '验证机构', role: 'partner', orgId: orgB } })
    const endUser = await prisma.endUser.create({ data: { phoneHash: `h-${tag}`, phoneEnc: 'enc' } })
    userA = endUser.id
    const jobPub = await prisma.job.create({
      data: {
        sourceOrgId: orgA, externalId: `j1-${tag}`, sourceName: `人社平台机构${tag}`,
        sourceUrl: 'https://example.com/j1', title: `自动化设备工程师${tag}`, company: '未来智造', city: '苏州',
        category: 'fulltime', salary: '15-25K·月', reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    const jobDraft = await prisma.job.create({
      data: {
        sourceOrgId: orgA, externalId: `j2-${tag}`, sourceName: `人社平台机构${tag}`,
        sourceUrl: 'https://example.com/j2', title: `未发布岗位${tag}`, company: '未来智造', city: '苏州',
        reviewStatus: 'pending', publishStatus: 'draft',
      },
    })
    const jobOtherOrg = await prisma.job.create({
      data: {
        sourceOrgId: orgB, externalId: `j3-${tag}`, sourceName: `高校就业网${tag}`,
        sourceUrl: 'https://example.com/j3', title: `跨机构岗位${tag}`, company: '别家公司', city: '青岛',
        category: 'campus', reviewStatus: 'approved', publishStatus: 'published',
      },
    })

    // ── 1. Admin 创建 → pending+draft → 公开不可见；先发布 → 400 ──
    const created = await companies.adminCreate({
      sourceOrgId: orgA, externalId: `c1-${tag}`, name: `未来智造科技${tag}`,
      description: '专注智能制造装备研发、生产与服务。', industry: 'smart_manufacturing',
      companyType: 'high_tech', scale: '1200+', province: '江苏省', city: '苏州市', district: '苏州工业园区',
      honorTags: ['国家高新技术企业'], fairParticipant: true, boothNo: 'A18',
      sourceUrl: 'https://example.com/company/c1',
    }, admin)
    companyId = created.id
    if (created.reviewStatus !== 'pending' || created.publishStatus !== 'draft') fail('1. 新建应为 pending+draft')
    const hidden = await companies.listPublic({}, PAGE)
    if (hidden.items.some((c) => c.id === companyId)) fail('1. 未审核企业不应出现在公开列表')
    await expectStatus(companies.adminPublish(companyId, { publish: true }, admin), 400, '1. 未审核先发布')
    pass('1. Admin 创建默认 pending+draft；公开不可见；未审核发布被拒')

    // ── 2. 审核 + 发布 → 公开可见 ─────────────────────────────
    await companies.adminReview(companyId, { action: 'approve' }, admin)
    await companies.adminPublish(companyId, { publish: true }, admin)
    const visible = await companies.listPublic({}, PAGE)
    const card = visible.items.find((c) => c.id === companyId)
    if (!card) fail('2. 已发布企业应出现在公开列表')
    if (card.sourceName !== `人社平台机构${tag}` || card.openJobCount !== 0 || card.repJobTitles.length !== 0) {
      fail('2. 来源快照/真实岗位计数错误')
    }
    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'company.publish', targetId: companyId } })
    if (!auditRow) fail('2. 发布应写审计')
    pass('2. 审核+发布后公开可见（来源快照齐全；openJobCount 真实为 0；审计落库）')

    // ── 3. 关联岗位 ───────────────────────────────────────────
    const linkRes = await companies.adminLinkJobs(companyId, { jobIds: [jobPub.id, jobDraft.id, jobOtherOrg.id] }, admin)
    if (linkRes.linked !== 1 || linkRes.rejected.length !== 2) fail('3. 只应关联同机构已发布岗位')
    const afterLink = await companies.listPublic({ keyword: `自动化设备工程师${tag}` }, PAGE)
    const linkedCard = afterLink.items.find((c) => c.id === companyId)
    if (!linkedCard || linkedCard.openJobCount !== 1 || !linkedCard.repJobTitles.includes(`自动化设备工程师${tag}`)) {
      fail('3. 关联后 openJobCount/代表岗位应真实更新（且岗位关键词可搜到企业）')
    }
    const companyJobs = await companies.listPublicJobs(companyId, PAGE)
    if (companyJobs.total !== 1 || companyJobs.items[0].title !== `自动化设备工程师${tag}`) fail('3. 企业岗位列表应只含已发布关联岗位')
    pass('3. 岗位关联：同机构已发布可关联，未发布/跨机构进 rejected；计数/列表真实')

    // ── 4. 筛选 ───────────────────────────────────────────────
    const byCity = await companies.listPublic({ province: '江苏省', city: '苏州市' }, PAGE)
    if (!byCity.items.some((c) => c.id === companyId)) fail('4. 省市筛选应命中')
    const byWrongCity = await companies.listPublic({ province: '江苏省', city: '南京市' }, PAGE)
    if (byWrongCity.items.some((c) => c.id === companyId)) fail('4. 非所在城市不应命中')
    const byType = await companies.listPublic({ companyType: 'high_tech' }, PAGE)
    if (!byType.items.some((c) => c.id === companyId)) fail('4. 企业类型筛选应命中')
    const byIndustry = await companies.listPublic({ industry: 'finance' }, PAGE)
    if (byIndustry.items.some((c) => c.id === companyId)) fail('4. 非本行业不应命中')
    const byRecruit = await companies.listPublic({ recruitType: 'fulltime' }, PAGE)
    if (!byRecruit.items.some((c) => c.id === companyId)) fail('4. 招聘类型(社招)应经关联岗位命中')
    const byRecruitMiss = await companies.listPublic({ recruitType: 'intern' }, PAGE)
    if (byRecruitMiss.items.some((c) => c.id === companyId)) fail('4. 无实习岗位不应命中实习筛选')
    const byFair = await companies.listPublic({ recruitType: 'fair' }, PAGE)
    if (!byFair.items.some((c) => c.id === companyId)) fail('4. 招聘会参展筛选应命中')
    const bySource = await companies.listPublic({ sourceKind: 'public_employment_service' }, PAGE)
    if (!bySource.items.some((c) => c.id === companyId)) fail('4. 来源(人社平台)筛选应命中')
    const bySourceMiss = await companies.listPublic({ sourceKind: 'school_employment_center' }, PAGE)
    if (bySourceMiss.items.some((c) => c.id === companyId)) fail('4. 非本来源不应命中')
    await expectStatus(companies.listPublic({ companyType: 'unicorn' }, PAGE), 400, '4. 非法企业类型')
    pass('4. 省市/类型/行业/招聘类型/来源筛选全部正确；非法枚举 400')

    // ── 5. 统计真实聚合 ───────────────────────────────────────
    const stats = await companies.statsPublic({ province: '江苏省' })
    if (stats.companyCount < 1 || stats.openJobCount < 1 || stats.todayNewJobCount < 1 || stats.fairCompanyCount < 1) {
      fail(`5. 统计应为真实聚合，得到 ${JSON.stringify(stats)}`)
    }
    pass('5. 统计条真实聚合（企业数/在招岗位/今日新增/招聘会参展）')

    // ── 6. 筛选可选项来自真实数据 ─────────────────────────────
    const filters = await companies.filtersPublic()
    const js = filters.regions.find((r) => r.province === '江苏省')
    if (!js || !js.cities.some((c) => c.city === '苏州市' && c.districts.includes('苏州工业园区'))) {
      fail('6. 地区可选项应来自真实已发布企业')
    }
    if (!filters.industries.includes('smart_manufacturing') || !filters.sourceKinds.includes('public_employment_service')) {
      fail('6. 行业/来源可选项应来自真实数据')
    }
    pass('6. 筛选可选项只来自真实已发布企业')

    // ── 7. 指标开关 ───────────────────────────────────────────
    const d1 = await companies.getPublic(companyId)
    if (d1.metrics.openJobCount !== 1 || d1.metrics.city !== '苏州市' || d1.metrics.employeeScale !== '1200+') {
      fail('7. 默认开启的指标应下发真实值')
    }
    if (d1.metrics.boothNo !== undefined) fail('7. showBoothNo 默认关闭，不应下发展位号')
    await companies.adminUpdate(companyId, { showEmployeeScale: false, showBoothNo: true }, admin)
    const d2 = await companies.getPublic(companyId)
    if (d2.metrics.employeeScale !== undefined) fail('7. 关闭员工规模开关后不应下发')
    if (d2.metrics.boothNo !== 'A18') fail('7. 打开展位号开关且有数据应下发')
    await companies.adminUpdate(companyId, { boothNo: '' }, admin)
    const d3 = await companies.getPublic(companyId)
    if (d3.metrics.boothNo !== undefined) fail('7. 开关开启但数据为空也不应下发（不造假）')
    pass('7. 指标受后台开关控制；数据为空不下发假值')

    // ── 8. 未发布企业 404 ─────────────────────────────────────
    await companies.adminPublish(companyId, { publish: false }, admin)
    await expectStatus(companies.getPublic(companyId), 404, '8. 已下架详情')
    await expectStatus(companies.listPublicJobs(companyId, PAGE), 404, '8. 已下架岗位列表')
    await companies.adminPublish(companyId, { publish: true }, admin)
    pass('8. 未发布/下架企业详情与岗位列表统一 404')

    // ── 9. Partner 导入/编辑 ──────────────────────────────────
    const partner = { userId: `pu-${tag}` }
    const imp1 = await companies.partnerImport(orgB, {
      items: [{ externalId: `pc1-${tag}`, name: `校企合作企业${tag}`, jobExternalIds: [`j3-${tag}`] }],
    }, partner)
    if (imp1.created !== 1 || imp1.updated !== 0) fail('9. 首次导入应 created=1')
    const imp2 = await companies.partnerImport(orgB, {
      items: [{ externalId: `pc1-${tag}`, name: `校企合作企业${tag}改`, description: '更新描述' }],
    }, partner)
    if (imp2.created !== 0 || imp2.updated !== 1) fail('9. 重复导入应 upsert updated=1')
    const pList = await companies.partnerList(orgB)
    const pc = pList.find((c) => c.externalId === `pc1-${tag}`)
    if (!pc || pc.reviewStatus !== 'pending' || pc.publishStatus !== 'draft') fail('9. 导入应回 pending+draft')
    const linkedJob = await prisma.job.findUnique({ where: { id: jobOtherOrg.id }, select: { companyProfileId: true } })
    if (linkedJob?.companyProfileId !== pc.id) fail('9. jobExternalIds 应关联本机构岗位')
    // 审核发布后 partner 编辑 → 强制回 pending+draft
    await companies.adminReview(pc.id, { action: 'approve' }, admin)
    await companies.adminPublish(pc.id, { publish: true }, admin)
    await companies.partnerUpdate(orgB, pc.id, { description: '编辑后必须重审' }, partner)
    const pAfter = (await companies.partnerList(orgB)).find((c) => c.id === pc.id)
    if (pAfter?.reviewStatus !== 'pending' || pAfter?.publishStatus !== 'draft') fail('9. Partner 编辑应强制回 pending+draft')
    await expectStatus(companies.partnerUpdate(orgA, pc.id, { description: 'x' }, partner), 404, '9. 跨机构编辑')
    pass('9. Partner 导入 upsert(pending+draft)+岗位外部ID关联；编辑强制重审；跨机构 404')

    // ── 9b. Partner 下架本机构企业（P1-A④）────────────────────
    await companies.adminReview(pc.id, { action: 'approve' }, admin)
    await companies.adminPublish(pc.id, { publish: true }, admin)
    const beforeUnpub = (await companies.partnerList(orgB)).find((c) => c.id === pc.id)
    if (beforeUnpub?.publishStatus !== 'published') fail('9b. 前置：企业应为已发布')
    const unpubbed = await companies.partnerUnpublish(orgB, pc.id, partner)
    if (unpubbed?.publishStatus !== 'unpublished') fail('9b. 下架后应为 unpublished')
    if (unpubbed?.reviewStatus !== 'approved') fail('9b. 下架不应改 reviewStatus（仍 approved）')
    await expectStatus(companies.partnerUnpublish(orgA, pc.id, partner), 404, '9b. 跨机构下架')
    const unpubLogs = await prisma.auditLog.findMany({ where: { action: 'company.unpublish', targetId: pc.id } })
    if (unpubLogs.length === 0) fail('9b. 应写 company.unpublish 审计')
    const unpubPayload = unpubLogs[0]?.payloadJson ? JSON.parse(unpubLogs[0].payloadJson) : {}
    if (unpubPayload.fromPublishStatus !== 'published') fail('9b. 审计应记 fromPublishStatus=published')
    pass('9b. Partner 下架→unpublished（不改 reviewStatus）；跨机构 404；审计 company.unpublish（记 fromPublishStatus）')

    // ── 10. 浏览/跳转闭环（company_profile）──────────────────
    const b = await activity.recordBrowse(userA, 'company_profile', companyId, null)
    if (!b.recorded) fail('10. 企业浏览应落库')
    const browseList = await activity.listBrowse(userA, PAGE, 'company_profile')
    const bRow = browseList.items.find((x) => x.targetId === companyId)
    if (!bRow || bRow.targetTitle !== `未来智造科技${tag}` || bRow.sourceName !== `人社平台机构${tag}`) {
      fail('10. 企业浏览快照应由服务端补齐')
    }
    await activity.recordJump(userA, 'company_profile', companyId, 'external_open', null)
    const jumpList = await activity.listJumps(userA, PAGE, 'company_profile')
    if (!jumpList.items.some((x) => x.targetId === companyId && x.action === 'external_open')) fail('10. 企业 external_open 跳转应落库')
    await expectStatus(activity.recordJump(userA, 'company_profile', companyId, 'external_apply', null), 400, '10. 企业不允许 external_apply')
    await companies.adminPublish(companyId, { publish: false }, admin)
    await expectStatus(activity.recordBrowse(userA, 'company_profile', companyId, null), 404, '10. 下架企业不可记录')
    await companies.adminPublish(companyId, { publish: true }, admin)
    pass('10. 企业浏览/external_open 跳转闭环；动作错配 400；下架不可记录')

    // ── 11. 禁词扫描 + 响应无候选人字段 ───────────────────────
    const repoRoot = join(__dirname, '..', '..', '..')
    const scanTargets = [
      'services/api/src/companies',
      'apps/kiosk/src/pages/companies',
      'apps/kiosk/src/services/api/companies.ts',
      'apps/admin/src/routes/companies',
      'apps/admin/src/services/api/companiesAdmin.ts',
      'apps/partner/src/routes/companies',
      'apps/partner/src/services/api/partnerCompanies.ts',
    ]
    const files: string[] = []
    for (const t of scanTargets) {
      const p = join(repoRoot, t)
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) walk(p, files)
      else files.push(p)
    }
    if (files.length < 4) fail(`11. 扫描目标过少(${files.length})，请确认企业展示文件存在`)
    const bannedCopy = ['一键投递', '立即投递', '立即申请', '平台投递', '投递简历', '推荐给企业', '录用概率', '通过率', '候选人', '已投递', '投递成功', '预约成功', '筛选中', '企业收简历', 'Offer', '面试邀约']
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
        .split('\n')
        .filter((line) => { const t = line.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
        .join('\n')
        .replaceAll('来源平台投递', '')
        .replaceAll('来源平台查看', '')
        .replaceAll('不代表录用结果', '')
        .replaceAll('登录用户', '')
        .replaceAll('记录用于', '')
      for (const w of bannedCopy) {
        if (content.includes(w)) fail(`11. ${f.replace(repoRoot + '/', '')} 含违规文案「${w}」`)
      }
    }
    const allJson = JSON.stringify([await companies.listPublic({}, PAGE), await companies.getPublic(companyId), await companies.listPublicJobs(companyId, PAGE)])
    for (const k of ['candidate', 'resume', 'applicationStatus', 'deliveryStatus', 'offer', 'interview']) {
      if (allJson.toLowerCase().includes(k.toLowerCase())) fail(`11. 公开响应含违规字段: ${k}`)
    }
    pass(`11. 禁词扫描通过（${files.length} 个文件）；公开响应无候选人/简历/投递状态字段`)

    // ── 12. 完整字典：补齐的企业类型/行业前后端同步，可存可被真实筛选 ──
    const typeList = COMPANY_TYPES as readonly string[]
    const industryList = COMPANY_INDUSTRIES as readonly string[]
    expectSameSet(Object.keys(SHARED_COMPANY_TYPES), typeList, '12. shared/backend 企业类型')
    expectSameSet(Object.keys(SHARED_COMPANY_INDUSTRIES), industryList, '12. shared/backend 行业')
    expectSameSet(Object.keys(SHARED_COMPANY_SOURCE_KINDS), COMPANY_SOURCE_KINDS, '12. shared/backend 来源')
    for (const t of ['joint_venture', 'school_enterprise', 'public_org', 'other']) {
      if (!typeList.includes(t)) fail(`12. 企业类型字典应包含「${t}」（与 shared 同步）`)
    }
    for (const i of ['ai_big_data', 'other']) {
      if (!industryList.includes(i)) fail(`12. 行业字典应包含「${i}」（与 shared 同步）`)
    }
    const created2 = await companies.adminCreate({
      sourceOrgId: orgA, externalId: `c2-${tag}`, name: `合资字典企业${tag}`,
      companyType: 'joint_venture', industry: 'ai_big_data',
      province: '广东省', city: '深圳市', district: '南山区',
      sourceUrl: 'https://example.com/company/c2',
    }, admin)
    await companies.adminReview(created2.id, { action: 'approve' }, admin)
    await companies.adminPublish(created2.id, { publish: true }, admin)
    const byNewType = await companies.listPublic({ companyType: 'joint_venture' }, PAGE)
    if (!byNewType.items.some((c) => c.id === created2.id)) fail('12. 新增企业类型(合资)应可被后端真实筛选命中')
    const byNewIndustry = await companies.listPublic({ industry: 'ai_big_data' }, PAGE)
    if (!byNewIndustry.items.some((c) => c.id === created2.id)) fail('12. 新增行业(AI/大数据)应可被后端真实筛选命中')
    pass('12. 完整字典：合资/校企/公共机构/其他 + AI/大数据/其他 已补齐；新增类型/行业前后端同步、可存可筛')

    // ── 13. 完整地区字典：选到无企业地区返回真实空态（不报错、不造数据）──
    const emptyRegion = await companies.listPublic({ province: '西藏自治区', city: '拉萨市' }, PAGE)
    if (emptyRegion.items.length !== 0) fail('13. 无企业地区应返回真实空态(空列表)')
    const emptyStats = await companies.statsPublic({ province: '西藏自治区' })
    if (emptyStats.companyCount !== 0 || emptyStats.openJobCount !== 0) fail('13. 无企业地区统计应为 0(不造数据)')
    const municipal = await companies.adminCreate({
      sourceOrgId: orgA, externalId: `c3-${tag}`, name: `北京直辖企业${tag}`,
      companyType: 'public_org', industry: 'professional_services',
      province: '北京市', city: '北京市', district: '朝阳区',
      sourceUrl: 'https://example.com/company/c3',
    }, admin)
    await companies.adminReview(municipal.id, { action: 'approve' }, admin)
    await companies.adminPublish(municipal.id, { publish: true }, admin)
    const byMunicipalDistrict = await companies.listPublic({ province: '北京市', district: '朝阳区' }, PAGE)
    if (!byMunicipalDistrict.items.some((c) => c.id === municipal.id)) {
      fail('13. 直辖市应支持省+区真实筛选命中（前端不应下发 city=市辖区）')
    }
    const aliasRegion = await companies.adminCreate({
      sourceOrgId: orgA, externalId: `c4-${tag}`, name: `地区别名企业${tag}`,
      companyType: 'other', industry: 'other',
      province: '广东', city: '深圳', district: '南山',
      sourceUrl: 'https://example.com/company/c4',
    }, admin)
    await companies.adminReview(aliasRegion.id, { action: 'approve' }, admin)
    await companies.adminPublish(aliasRegion.id, { publish: true }, admin)
    const byCanonicalRegion = await companies.listPublic({ province: '广东省', city: '深圳市', district: '南山区' }, PAGE)
    if (!byCanonicalRegion.items.some((c) => c.id === aliasRegion.id)) {
      fail('13. 规范地区筛选应命中常见无后缀录入，避免真实企业被假空态掩盖')
    }
    pass('13. 完整地区字典下，无企业地区返回真实空态；直辖市省+区可命中；规范筛选可命中常见无后缀录入')

    // ── 14. 正式前端企业页无「演示」字样 ──
    const kioskCompanyDir = join(repoRoot, 'apps/kiosk/src/pages/companies')
    const frontFiles: string[] = []
    if (existsSync(kioskCompanyDir)) walk(kioskCompanyDir, frontFiles)
    if (frontFiles.length < 2) fail(`14. 未找到正式前端企业页文件(${frontFiles.length})`)
    for (const f of frontFiles) {
      if (readFileSync(f, 'utf8').includes('演示')) fail(`14. 正式前端企业页 ${f.replace(repoRoot + '/', '')} 不应含「演示」字样`)
    }
    pass(`14. 正式前端企业页无「演示」字样（${frontFiles.length} 个文件）`)

    // ── 15. 后台企业地区录入与旧 filters 链路标注 ──
    const adminCompaniesPage = readFileSync(join(repoRoot, 'apps/admin/src/routes/companies/index.tsx'), 'utf8')
    const partnerCompaniesPage = readFileSync(join(repoRoot, 'apps/partner/src/routes/companies/index.tsx'), 'utf8')
    const sharedIndex = readFileSync(join(repoRoot, 'packages/shared/src/index.ts'), 'utf8')
    const controllerDoc = readFileSync(join(repoRoot, 'services/api/src/companies/companies.controller.ts'), 'utf8')
    const serviceDoc = readFileSync(join(repoRoot, 'services/api/src/companies/companies.service.ts'), 'utf8')
    const kioskCompanyApi = readFileSync(join(repoRoot, 'apps/kiosk/src/services/api/companies.ts'), 'utf8')
    for (const [label, content] of [
      ['Admin 企业表单', adminCompaniesPage],
      ['Partner 企业表单', partnerCompaniesPage],
    ] as const) {
      for (const symbol of ['PROVINCES', 'citiesOf', 'districtsOf', 'isMunicipality', 'resolveRegionSelection']) {
        if (!content.includes(symbol)) fail(`15. ${label} 应使用共享行政区划工具 ${symbol}`)
      }
      if (!content.includes('<select') || !content.includes('value={form.province}')) fail(`15. ${label} 省份应为级联 select，不应是自由文本`)
      if (!content.includes('districtsOf(form.province')) fail(`15. ${label} 区县应由省市级联计算`)
      if (!content.includes('（原值）')) fail(`15. ${label} 应保留历史非规范地区原值的可见回显`)
      if (content.includes("if (!form.district) return '请选择区/县'")) fail(`15. ${label} 不应把历史 partial 地区记录锁死为区县必填`)
      if (content.includes("return '请选择城市'")) fail(`15. ${label} 不应把省+区县的历史 partial 地区记录锁死为城市必填`)
      if (content.includes('set({ province: e.target.value })') || content.includes('province: e.target.value }))')) {
        fail(`15. ${label} 仍存在省份自由文本录入逻辑`)
      }
    }
    if (!sharedIndex.includes("export * from './regions'")) fail('15. @ai-job-print/shared 应导出统一 regions 工具')
    for (const [label, content] of [
      ['companies.controller.ts', controllerDoc],
      ['companies.service.ts', serviceDoc],
      ['apps/kiosk/src/services/api/companies.ts', kioskCompanyApi],
    ] as const) {
      if (!content.includes('兼容') || !content.includes('诊断')) fail(`15. ${label} 应明确 /companies/filters 为兼容/诊断链路`)
    }
    pass('15. Admin/Partner 地区录入使用共享级联选择；/companies/filters 已标注兼容/诊断')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    await prisma.browseLog.deleteMany({ where: { endUserId: userA } }).catch(() => undefined)
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: userA } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetType: 'company_profile', payloadJson: { contains: tag } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetType: 'company_profile', targetId: companyId } }).catch(() => undefined)
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } }).catch(() => undefined)
    await prisma.companyProfile.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: userA } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { username: { in: [`vadmin-${tag}`, `vpartner-${tag}`] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => undefined)
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
