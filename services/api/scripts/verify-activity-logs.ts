/**
 * P1 浏览/外部跳转记录 — 离线回归验证（可进 CI）。
 *
 *  1. 会员浏览已发布岗位 → BrowseLog 落库（服务端补齐来源快照）→ /me/browse-logs 可见
 *  2. 会员岗位外部跳转 → ExternalJumpLog(action=external_apply) 落库 → /me/external-jump-logs 可见
 *  3. 招聘会浏览 / 外部预约跳转（external_appointment）记录可见
 *  4. 参展企业外部投递入口（fair_company + external_apply）记录可见
 *  5. 政策浏览 / 官方入口（external_open）跳转记录可见（政策无 externalId，如实 null）
 *  6. 跨会员隔离：A 看不到 B 的记录；A 删 B 的记录统一 404
 *  7. 未发布 / 不存在 target → 拒绝记录（404），不产生任何行
 *  8. 非法 targetType / 动作与目标不匹配 → 400 拒绝
 *  9. 删除本人记录（controller 路径）→ 列表不再返回 + 审计落库
 * 10. 浏览去重：30 分钟窗口内同目标重复浏览不刷行；列表 JSON 无投递/预约/筛选/候选人状态字段
 * 11. 匿名上报（controller 路径，无 Authorization）→ recorded:false 且零落库
 * 12. 禁词扫描（本轮触达的前后端文件无违规状态文案）
 *     + 前端封装 fire-and-forget（记录失败不阻断主流程）
 * 13. TTL 清理 cron：过期行被物理删除
 *
 * 运行：pnpm --filter @ai-job-print/api verify:activity-logs
 */
require('dotenv').config()

import { readFileSync } from 'fs'
import { join } from 'path'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { ActivityService } from '../src/activity/activity.service'
import { ActivityController } from '../src/activity/activity.controller'
import { MeActivityController } from '../src/activity/me-activity.controller'
import type { RedisService } from '../src/common/redis/redis.service'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

// 稳定且唯一的残留标记(跨运行不变):嵌进机构 id 与测试会员 phoneHash,开始前预清。
// 本脚本的 finally 已按本次 id 清 endUser/浏览日志,这里的预清负责收掉历史残留。
const RESIDUE_TAG = 'vresidactlog'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

const PAGE = { cursor: null, pageSize: 20 }
const w = (...parts: string[]) => parts.join('')

async function expectStatus(p: Promise<unknown>, status: number, label: string) {
  try {
    await p
    fail(`${label}: 应拒绝（${status}）但成功了`)
  } catch (e) {
    const got = (e as { getStatus?: () => number }).getStatus?.()
    if (got !== status) fail(`${label}: 期望 ${status}，得到 ${got ?? String(e)}`)
  }
}

async function main() {
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const activity = new ActivityService(prisma)
  const meController = new MeActivityController(activity, audit)
  // 匿名路径不触达 redis（无 Authorization 直接返回 null），stub 仅占位
  const stubRedis = { get: async () => null } as unknown as RedisService
  const postController = new ActivityController(activity, new JwtService({ secret: 'verify-only-secret-0123456789' }), stubRedis)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag 命中 org / endUser)。
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const tag = `${RESIDUE_TAG}${Date.now()}`
  const orgId = `org-${tag}`
  let userA = ''
  let userB = ''
  let jobId = ''
  let fairId = ''
  let fairCompanyId = ''
  let draftFairCompanyId = ''
  let policyId = ''
  let draftJobId = ''

  try {
    // ── 测试数据 ──────────────────────────────────────────────
    await prisma.organization.create({ data: { id: orgId, name: `测试机构${tag}`, type: 'licensed_hr_agency' } })
    const a = await prisma.endUser.create({ data: { phoneHash: `ha-${tag}`, phoneEnc: 'enc-a' } })
    const b = await prisma.endUser.create({ data: { phoneHash: `hb-${tag}`, phoneEnc: 'enc-b' } })
    userA = a.id; userB = b.id
    const job = await prisma.job.create({
      data: {
        sourceOrgId: orgId, externalId: `ext-job-${tag}`, sourceName: '来源平台甲',
        sourceUrl: 'https://example.com/job', title: `行政专员${tag}`, company: '某公司', city: '青岛',
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    jobId = job.id
    const draft = await prisma.job.create({
      data: {
        sourceOrgId: orgId, externalId: `ext-draft-${tag}`, sourceName: '来源平台甲',
        sourceUrl: 'https://example.com/draft', title: `未发布岗位${tag}`, company: '某公司', city: '青岛',
        reviewStatus: 'pending', publishStatus: 'draft',
      },
    })
    draftJobId = draft.id
    const fair = await prisma.jobFair.create({
      data: {
        sourceOrgId: orgId, externalId: `ext-fair-${tag}`, sourceName: '来源平台乙',
        sourceUrl: 'https://example.com/fair', title: `春季招聘会${tag}`, venue: '会展中心', city: '青岛',
        startAt: new Date(), endAt: new Date(Date.now() + 86400_000),
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    fairId = fair.id
    const fairCompany = await prisma.fairCompany.create({
      data: {
        jobFairId: fair.id,
        name: `参展企业${tag}`,
        industry: '互联网/软件',
        scale: '50-500',
        sourceUrl: 'https://example.com/fair-company',
      },
    })
    fairCompanyId = fairCompany.id
    const draftFair = await prisma.jobFair.create({
      data: {
        sourceOrgId: orgId, externalId: `ext-draft-fair-${tag}`, sourceName: '来源平台乙',
        sourceUrl: 'https://example.com/draft-fair', title: `未发布招聘会${tag}`, venue: '会展中心', city: '青岛',
        startAt: new Date(), endAt: new Date(Date.now() + 86400_000),
        reviewStatus: 'pending', publishStatus: 'draft',
      },
    })
    const draftFairCompany = await prisma.fairCompany.create({
      data: {
        jobFairId: draftFair.id,
        name: `未发布参展企业${tag}`,
        sourceUrl: 'https://example.com/draft-fair-company',
      },
    })
    draftFairCompanyId = draftFairCompany.id
    const policy = await prisma.policyPost.create({
      data: {
        sourceOrgId: orgId, sourceName: '人社局', kind: 'policy_guide', title: `就业补贴指引${tag}`,
        externalUrl: 'https://example.gov.cn/policy',
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    policyId = policy.id

    // ── 1. 会员浏览岗位 ──────────────────────────────────────
    const r1 = await activity.recordBrowse(userA, 'job', jobId, null)
    if (!r1.recorded || r1.deduped) fail('1. 首次浏览应新建行')
    const list1 = await activity.listBrowse(userA, PAGE)
    const row1 = list1.items.find((x) => x.targetId === jobId)
    if (!row1) fail('1. /me/browse-logs 应可见岗位浏览记录')
    if (row1.targetTitle !== `行政专员${tag}` || row1.sourceName !== '来源平台甲' || row1.externalId !== `ext-job-${tag}`) {
      fail('1. 来源快照应由服务端补齐')
    }
    pass('1. 会员浏览岗位 → BrowseLog 落库（服务端补齐来源快照）→ 列表可见')

    // ── 2. 岗位外部跳转 ──────────────────────────────────────
    await activity.recordJump(userA, 'job', jobId, 'external_apply', null)
    const jumps2 = await activity.listJumps(userA, PAGE)
    const j2 = jumps2.items.find((x) => x.targetId === jobId)
    if (!j2 || j2.action !== 'external_apply') fail('2. 岗位跳转记录应可见且 action=external_apply')
    pass('2. 岗位外部跳转 → ExternalJumpLog 落库 → 列表可见')

    // ── 3. 招聘会浏览 + 预约跳转 ─────────────────────────────
    await activity.recordBrowse(userA, 'job_fair', fairId, null)
    await activity.recordJump(userA, 'job_fair', fairId, 'external_appointment', null)
    const fairBrowse = await activity.listBrowse(userA, PAGE, 'job_fair')
    const fairJumps = await activity.listJumps(userA, PAGE, 'job_fair')
    if (!fairBrowse.items.some((x) => x.targetId === fairId)) fail('3. 招聘会浏览记录应可见')
    if (!fairJumps.items.some((x) => x.targetId === fairId && x.action === 'external_appointment')) fail('3. 预约跳转记录应可见')
    pass('3. 招聘会浏览 / 外部预约跳转记录可见（targetType 过滤生效）')

    // ── 4. 参展企业外部投递入口跳转 ─────────────────────────
    await activity.recordJump(userA, 'fair_company', fairCompanyId, 'external_apply', null)
    const fairCompanyJumps = await activity.listJumps(userA, PAGE, 'fair_company')
    const fc4 = fairCompanyJumps.items.find((x) => x.targetId === fairCompanyId)
    if (!fc4 || fc4.action !== 'external_apply') fail('4. 参展企业投递入口跳转记录应可见且 action=external_apply')
    if (fc4.targetTitle !== `参展企业${tag}`) fail('4. 参展企业跳转 targetTitle 应取 FairCompany.name')
    if (fc4.sourceName !== '来源平台乙') fail('4. 参展企业跳转 sourceName 应取父招聘会来源')
    if (fc4.sourceUrl !== 'https://example.com/fair-company') fail('4. 参展企业跳转 sourceUrl 应取企业来源链接')
    if (fc4.externalId !== fairId) fail('4. 参展企业跳转 externalId 应保存父级 JobFair.id 以支持详情回跳')
    pass('4. 参展企业外部投递入口 → ExternalJumpLog 落库 → 列表可见')

    // ── 5. 政策浏览 + 官方入口跳转 ───────────────────────────
    await activity.recordBrowse(userA, 'policy', policyId, null)
    await activity.recordJump(userA, 'policy', policyId, 'external_open', null)
    const polJumps = await activity.listJumps(userA, PAGE, 'policy')
    const p4 = polJumps.items.find((x) => x.targetId === policyId)
    if (!p4 || p4.action !== 'external_open') fail('5. 政策官方入口跳转记录应可见')
    if (p4.externalId !== null) fail('5. 政策无外部编号，应如实 null')
    if (p4.sourceUrl !== 'https://example.gov.cn/policy') fail('5. 政策官方入口 URL 快照错误')
    pass('5. 政策浏览 / 官方入口跳转记录可见（externalId 如实 null）')

    // ── 6. 跨会员隔离 ────────────────────────────────────────
    const bBrowse = await activity.listBrowse(userB, PAGE)
    const bJumps = await activity.listJumps(userB, PAGE)
    if (bBrowse.total !== 0 || bJumps.total !== 0) fail('6. B 不应看到 A 的记录')
    const aBrowseId = row1.id
    await expectStatus(activity.deleteBrowse(userB, aBrowseId), 404, '6. B 删 A 的记录')
    pass('6. 跨会员隔离：B 看不到 A 的记录；删他人记录统一 404')

    // ── 7. 未发布 / 不存在 target ────────────────────────────
    await expectStatus(activity.recordBrowse(userA, 'job', draftJobId, null), 404, '7. 未发布岗位浏览')
    await expectStatus(activity.recordJump(userA, 'job', draftJobId, 'external_apply', null), 404, '7. 未发布岗位跳转')
    await expectStatus(activity.recordJump(userA, 'fair_company', draftFairCompanyId, 'external_apply', null), 404, '7. 未发布招聘会下的参展企业跳转')
    await expectStatus(activity.recordBrowse(userA, 'job', 'no-such-id', null), 404, '7. 不存在岗位')
    const draftRows = await prisma.browseLog.count({ where: { targetId: draftJobId } })
    if (draftRows !== 0) fail('7. 未发布目标不应产生任何行')
    const draftCompanyRows = await prisma.externalJumpLog.count({ where: { targetId: draftFairCompanyId } })
    if (draftCompanyRows !== 0) fail('7. 未发布招聘会下的参展企业不应产生跳转行')
    pass('7. 未发布 / 不存在 target 拒绝记录（404），零落库')

    // ── 8. 非法 targetType / action ──────────────────────────
    await expectStatus(activity.recordBrowse(userA, 'company', jobId, null), 400, '8. 非法 targetType')
    await expectStatus(activity.recordJump(userA, 'job', jobId, 'external_appointment', null), 400, '8. 动作与目标不匹配')
    await expectStatus(activity.recordJump(userA, 'fair_company', fairCompanyId, 'external_appointment', null), 400, '8. 参展企业动作与目标不匹配')
    await expectStatus(activity.recordJump(userA, 'job', jobId, 'apply_done', null), 400, '8. 非法 action')
    await expectStatus(activity.listBrowse(userA, PAGE, 'candidate'), 400, '8. 非法列表过滤')
    pass('8. 非法 targetType / action 被拒绝（400）')

    // ── 9. controller 删除 + 审计 ────────────────────────────
    const delJump = jumps2.items.find((x) => x.targetId === jobId)!
    await meController.deleteJumpLog({ endUserId: userA, sessionId: 's' }, delJump.id, { headers: {} })
    const jumpsAfter = await activity.listJumps(userA, PAGE, 'job')
    if (jumpsAfter.items.some((x) => x.id === delJump.id)) fail('9. 删除后列表不应返回')
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'member.external_jump_log_delete', targetId: delJump.id },
    })
    if (!auditRow || !auditRow.payloadJson.includes(userA)) fail('9. 删除应写审计（payload 含 endUserId）')
    await meController.deleteBrowseLog({ endUserId: userA, sessionId: 's' }, aBrowseId, { headers: {} })
    const browseAfter = await activity.listBrowse(userA, PAGE, 'job')
    if (browseAfter.items.some((x) => x.id === aBrowseId)) fail('9. 浏览记录删除后不应返回')
    pass('9. 删除本人记录（真实 controller 路径）→ 列表不返回 + 审计落库')

    // ── 10. 浏览去重 + 响应无状态字段 ────────────────────────
    const d1 = await activity.recordBrowse(userA, 'job_fair', fairId, null)
    if (!d1.deduped) fail('10. 30 分钟内重复浏览应去重')
    const dedupCount = await prisma.browseLog.count({ where: { endUserId: userA, targetId: fairId } })
    if (dedupCount !== 1) fail('10. 去重后应仍为单行')
    const allJson = JSON.stringify([await activity.listBrowse(userA, PAGE), await activity.listJumps(userA, PAGE)])
    for (const banned of [
      w('application', 'Status'),
      w('delivery', 'Status'),
      w('appointment', 'Status'),
      w('interview', 'Status'),
      w('candidate', 'Status'),
      w('offer', 'Status'),
      w('review', 'Result'),
      w('已', '投递'),
      w('预约', '成功'),
      '筛选',
    ]) {
      if (allJson.includes(banned)) fail(`10. 响应 JSON 含违规字段/文案: ${banned}`)
    }
    pass('10. 浏览 30 分钟去重；响应 JSON 无投递/预约/筛选/候选人状态字段')

    // ── 11. 匿名上报（controller 路径）──────────────────────
    const beforeBrowse = await prisma.browseLog.count()
    const beforeJump = await prisma.externalJumpLog.count()
    const anon1 = await postController.browse({ targetType: 'job', targetId: jobId }, { headers: {} })
    const anon2 = await postController.externalJump({ targetType: 'job', targetId: jobId, action: 'external_apply' }, { headers: {} })
    const anonData1 = (anon1 as { data: { recorded: boolean } }).data
    const anonData2 = (anon2 as { data: { recorded: boolean } }).data
    if (anonData1.recorded !== false || anonData2.recorded !== false) fail('11. 匿名应诚实返回 recorded:false')
    if ((await prisma.browseLog.count()) !== beforeBrowse || (await prisma.externalJumpLog.count()) !== beforeJump) {
      fail('11. 匿名上报不应落库')
    }
    pass('11. 匿名上报 → recorded:false 且零落库（共享一体机不留影子记录）')

    // ── 12. 禁词扫描 + 前端 fire-and-forget ──────────────────
    const repoRoot = join(__dirname, '..', '..', '..')
    const scanFiles = [
      'services/api/src/activity/activity.service.ts',
      'services/api/src/activity/activity.controller.ts',
      'services/api/src/activity/me-activity.controller.ts',
      'services/api/src/activity/activity.types.ts',
      'apps/kiosk/src/services/api/activity.ts',
      'apps/kiosk/src/pages/profile/ProfilePage.tsx',
      'apps/kiosk/src/pages/jobs/JobDetailPage.tsx',
      'apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx',
      'apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx',
      'apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx',
      'apps/kiosk/src/pages/campus/CampusPage.tsx',
      'apps/kiosk/src/pages/renshi/RenshiPage.tsx',
    ]
    const bannedCopy = [
      w('已', '投递'),
      w('投递', '成功'),
      w('投递', '失败'),
      w('企业', '已查看'),
      w('简历', '已送达'),
      w('筛选', '中'),
      w('筛选', '通过'),
      w('进入', '面试'),
      w('预约', '成功'),
      w('预约', '失败'),
      w('报名', '成功'),
      w('已', '签到'),
      w('已', '入场'),
      w('Of', 'fer'),
      w('录', '用'),
      w('一键', '投递'),
      w('立即', '投递'),
      w('平台', '投递'),
    ]
    for (const f of scanFiles) {
      // 扫描的是用户侧文案（JSX / 字符串），跳过纯注释行——代码中的合规红线注释
      // 需要引用禁词本身来说明「禁止什么」（如 CampusPage 红线注释），不属于违规文案。
      // 「去来源平台投递/预约」「已登录用户」是合规文案，先剥离避免子串误中。
      const content = readFileSync(join(repoRoot, f), 'utf8')
        .split('\n')
        .filter((line) => {
          const t = line.trim()
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
        })
        .join('\n')
        .replaceAll('来源平台投递', '')
        .replaceAll('来源平台预约', '')
        .replaceAll('登录用户', '')
        .replaceAll('记录用于', '')
      for (const w of bannedCopy) {
        if (content.includes(w)) fail(`12. ${f} 含违规状态文案「${w}」`)
      }
    }
    const kioskApi = readFileSync(join(repoRoot, 'apps/kiosk/src/services/api/activity.ts'), 'utf8')
    if (!kioskApi.includes('.catch(() => {')) fail('12. 前端上报封装必须吞掉失败（fire-and-forget）')
    if (!/recordBrowse[\s\S]{0,200}?\): void/.test(kioskApi)) fail('12. recordBrowse 应为 void（调用方不可 await 阻塞）')
    pass('12. 禁词扫描通过；前端上报 fire-and-forget（记录失败不阻断主流程）')

    // ── 13. TTL 清理 ─────────────────────────────────────────
    const expired = await prisma.browseLog.create({
      data: { endUserId: userA, targetType: 'job', targetId: jobId, expiresAt: new Date(Date.now() - 1000) },
    })
    const listBeforeCleanup = await activity.listBrowse(userA, PAGE)
    if (listBeforeCleanup.items.some((x) => x.id === expired.id)) fail('13. 过期行不应出现在列表')
    await activity.cleanupExpired()
    if (await prisma.browseLog.findFirst({ where: { id: expired.id } })) fail('13. cron 应物理清理过期行')
    pass('13. 过期行列表不可见且 cron 物理清理')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    await prisma.browseLog.deleteMany({ where: { endUserId: { in: [userA, userB].filter(Boolean) } } }).catch(() => undefined)
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: { in: [userA, userB].filter(Boolean) } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { action: { in: ['member.browse_log_delete', 'member.external_jump_log_delete'] }, payloadJson: { contains: userA } } }).catch(() => undefined)
    await prisma.fairCompany.deleteMany({ where: { id: { in: [fairCompanyId, draftFairCompanyId].filter(Boolean) } } }).catch(() => undefined)
    await prisma.job.deleteMany({ where: { sourceOrgId: orgId } }).catch(() => undefined)
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: orgId } }).catch(() => undefined)
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: orgId } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB].filter(Boolean) } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
