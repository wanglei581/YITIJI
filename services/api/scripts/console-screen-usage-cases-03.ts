import { ADMIN_USAGE_METRIC_KEYS } from '../src/console-screen/console-screen.types'
import { daysAgoStart, shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { usageWindow } from '../src/console-screen/console-screen.usage.queries'
import { assert, inWindow, opened } from './console-screen-usage-cases-01'
import { assertBehaviorSetup } from './console-screen-usage-cases-02'
import { NOW, TODAY_START, DAY7_START, DAY30_START, YESTERDAY_NOON, PHONE, FILE_NAME, IP_SECRET, APP_COMPANY, FAVORITE_SNAPSHOT, carryContext } from './console-screen-usage-cases-07'



export async function assertBehaviorPhase1(context: Awaited<ReturnType<typeof assertBehaviorSetup>>) {
const { prisma, usage, suffix, orgA, orgB, termLeak, adminId, userA, userB, userBlank, memberId, phoneEnc, fileUrl, jobJia, jobCold, jobDel, jobB, extraA, extraB, policyA, policyAExtra, policyB, fairA, companyA, browses, favorites, jumps, ai, orders, prints, scans, countBrowse, successOf, paidWhere, show } = context
const expiresAt = new Date('2026-02-01T00:00:00.000Z')
await prisma.organization.createMany({
      data: [orgA, orgB].map((id, index) => ({
        id, name: index === 0 ? '用法机构甲' : '用法机构乙', type: 'school_employment_center', sceneTemplate: 'school', enabled: true,
      })),
    })
await prisma.user.createMany({
      data: [
        { id: adminId, username: `usage_admin_${suffix}`, name: 'usage admin', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
        { id: userA, username: `usage_pa_${suffix}`, name: 'usage partner a', passwordHash: 'hash', role: 'partner', orgId: orgA, enabled: true, tokenVersion: 0 },
        { id: userB, username: `usage_pb_${suffix}`, name: 'usage partner b', passwordHash: 'hash', role: 'partner', orgId: orgB, enabled: true, tokenVersion: 0 },
        { id: userBlank, username: `usage_blank_${suffix}`, name: 'usage blank', passwordHash: 'hash', role: 'partner', orgId: null, enabled: true, tokenVersion: 0 },
      ],
    })
await prisma.endUser.create({ data: { id: memberId, phoneHash: `ph_${suffix}`, phoneEnc } })
await prisma.terminal.create({
      data: { id: termLeak, terminalCode: `USG-${suffix}`, agentToken: `tok_${suffix}`, deviceFingerprint: `fp_${suffix}`, orgId: orgA, enabled: true },
    })
const jobRows = [
      { id: jobJia, sourceOrgId: orgA, title: '甲机构岗位' },
      { id: jobCold, sourceOrgId: orgA, title: '甲机构冷门' },
      { id: jobDel, sourceOrgId: orgA, title: '已删岗位' },
      ...extraA.map((id) => ({ id, sourceOrgId: orgA, title: '甲机构补充岗' })),
      { id: jobB, sourceOrgId: orgB, title: '乙机构岗位' },
      ...extraB.map((id) => ({ id, sourceOrgId: orgB, title: '乙机构补充岗' })),
    ]
await prisma.job.createMany({
      data: jobRows.map((row) => ({
        id: row.id,
        sourceOrgId: row.sourceOrgId,
        externalId: row.id,
        sourceName: '来源',
        sourceUrl: 'https://example.com/job',
        title: row.title,
        company: '示例公司',
        city: '青岛',
        reviewStatus: 'approved',
        publishStatus: 'published',
      })),
    })
await prisma.policyPost.createMany({
      data: [
        { id: policyA, sourceOrgId: orgA, sourceName: '来源', title: '甲机构政策' },
        ...policyAExtra.map((id) => ({ id, sourceOrgId: orgA, sourceName: '来源', title: '甲机构政策补' })),
        { id: policyB, sourceOrgId: orgB, sourceName: '来源', title: '乙机构政策' },
      ],
    })
await prisma.jobFair.create({
      data: {
        id: fairA, sourceOrgId: orgA, externalId: fairA, sourceName: '来源', sourceUrl: 'https://example.com/fair',
        title: '甲机构招聘会', startAt: NOW, endAt: expiresAt, venue: '会场', city: '青岛',
      },
    })
await prisma.companyProfile.create({
      data: { id: companyA, sourceOrgId: orgA, externalId: companyA, sourceName: '来源', name: '甲机构企业' },
    })
await prisma.browseLog.createMany({
      data: browses.map((row, index) => ({
        endUserId: memberId, targetType: row.targetType, targetId: row.targetId, createdAt: row.at, expiresAt,
        targetTitle: index === 0 ? FAVORITE_SNAPSHOT : '浏览标题',
      })),
    })
await prisma.favorite.createMany({
      data: favorites.map((row, index) => ({
        endUserId: memberId, targetType: row.targetType, targetId: row.targetId, createdAt: row.at,
        title: index === 0 ? FAVORITE_SNAPSHOT : '收藏标题',
      })),
    })
await prisma.externalJumpLog.createMany({
      data: jumps.map((row) => ({
        endUserId: memberId, targetType: row.targetType, targetId: row.targetId, action: 'external_apply',
        sourceName: row.sourceName, createdAt: row.at, expiresAt,
      })),
    })
await prisma.job.delete({ where: { id: jobDel } })
await prisma.jobApplication.create({
      data: { endUserId: memberId, companyName: APP_COMPANY, positionTitle: '自填机密岗位', note: PHONE },
    })
await prisma.aiServiceLog.createMany({ data: ai.map((row) => ({ ...row, terminalId: termLeak })) })
await prisma.printTask.createMany({
      data: prints.map((row) => ({ ...row, terminalId: termLeak, fileUrl, fileMd5: 'md5' })),
    })
await prisma.scanTask.createMany({
      data: scans.map((createdAt) => ({ terminalId: termLeak, scanType: 'document', status: 'completed', createdAt, expiresAt })),
    })
await prisma.order.createMany({
      data: orders.map((row) => ({
        orderNo: row.orderNo,
        payStatus: row.payStatus,
        channel: row.channel,
        paidAt: row.paidAt,
        endUserId: row.endUserId,
        createdAt: row.createdAt,
        sourceFileName: FILE_NAME,
        amountCents: 100,
      })),
    })
// HTTP的7d用例必须落在截至昨天的完整日内。
const wall = new Date(Date.now() - 86_400_000)
await prisma.browseLog.createMany({
      data: [
        ...Array.from({ length: 5 }, () => ({ endUserId: memberId, targetType: 'job', targetId: jobJia, createdAt: wall, expiresAt: new Date(wall.getTime() + 86_400_000) })),
        ...Array.from({ length: 5 }, () => ({ endUserId: memberId, targetType: 'job', targetId: jobB, createdAt: wall, expiresAt: new Date(wall.getTime() + 86_400_000) })),
      ],
    })
await prisma.auditLog.createMany({
      data: [
        ...Array.from({ length: 5 }, () => ({ actorRole: 'admin', action: 'resume.diagnosis_exported', targetType: 'resume', createdAt: NOW, ipAddress: IP_SECRET, payloadJson: JSON.stringify({ phone: PHONE, file: FILE_NAME }) })),
        { actorRole: 'admin', action: 'resume.diagnosis_exported', targetType: 'resume', createdAt: YESTERDAY_NOON, ipAddress: IP_SECRET, payloadJson: '{}' },
        ...Array.from({ length: 2 }, () => ({ actorRole: 'admin', action: 'resume.viewed', targetType: 'resume', createdAt: NOW, ipAddress: IP_SECRET, payloadJson: '{}' })),
      ],
    })
const today = usageWindow('today', NOW)
const week = usageWindow('7d', NOW)
const month = usageWindow('30d', NOW)
assert(
      'u10. today 窗口是上海零点到 now，7d/30d 只含截至昨天的完整自然日',
      today.from.toISOString() === TODAY_START.toISOString()
        && today.to.toISOString() === NOW.toISOString()
        && week.from.toISOString() === DAY7_START.toISOString()
        && month.from.toISOString() === DAY30_START.toISOString()
        && shanghaiDayStart(NOW).toISOString() === TODAY_START.toISOString()
        && daysAgoStart(NOW, 8).toISOString() === DAY7_START.toISOString()
        && daysAgoStart(NOW, 31).toISOString() === DAY30_START.toISOString(),
    )
const admin = await usage.getAdminUsage('today', NOW)
const services = opened(admin.metrics.services)
const serviceCount = (key: string) => {
      const item = services?.find((row) => row.key === key)
      return item === undefined ? 'missing' : item.count
    }
const aiResumeOps = ['parseResume', 'optimizeResume', 'adjustResumeLayout', 'generateResume']
assert('u11. 管理员指标键齐全且 visits 已接入（W-69，无会话为 0）', JSON.stringify(Object.keys(admin.metrics)) === JSON.stringify([...ADMIN_USAGE_METRIC_KEYS]) && admin.metrics.visits?.available === true && admin.metrics.visits.value === 0 && admin.metrics.visits.window === 'today')
assert(
      'u12. 服务节点按口径求和，AI 只数成功，公司样本不足为 null',
      serviceCount('jobs') === show(countBrowse(['job'], today.from, today.to))
        && serviceCount('fairs') === show(countBrowse(['job_fair', 'fair_company'], today.from, today.to))
        && serviceCount('policy') === show(countBrowse(['policy'], today.from, today.to))
        && serviceCount('company') === null
        && countBrowse(['company_profile'], today.from, today.to) === 4
        && serviceCount('aiResume') === successOf(aiResumeOps, today.from, today.to)
        && serviceCount('aiAdvisor') === successOf(['chatAssistant'], today.from, today.to)
        && serviceCount('aiAdvisor') !== successOf(['chatAssistant', 'classifyIntent'], today.from, today.to)
        && serviceCount('interview') === successOf(['interviewQuestion', 'interviewReport'], today.from, today.to)
        && serviceCount('careerPlan') === successOf(['careerPlan', 'selfAssessment'], today.from, today.to)
        && serviceCount('jobAi') === successOf(['jobRecommend', 'jobExplain', 'jobMatch', 'fairVisitPlan'], today.from, today.to)
        && serviceCount('print') === prints.filter((row) => inWindow(row.createdAt, today.from, today.to)).length
        && serviceCount('scan') === scans.filter((at) => inWindow(at, today.from, today.to)).length
        && services !== null
        && services.every((item) => item.lane === (item.key === 'print' || item.key === 'scan' ? 'print' : item.key.startsWith('ai') || item.key === 'interview' || item.key === 'careerPlan' || item.key === 'jobAi' ? 'ai' : 'info'))
        && services.filter((item) => item.lane === 'info').every((item) => item.coverage === 'members_only')
        && services.filter((item) => item.lane !== 'info').every((item) => item.coverage === 'all_recorded'),
      `jobs=${String(serviceCount('jobs'))} advisor=${String(serviceCount('aiAdvisor'))} scan=${String(serviceCount('scan'))}`,
    )
const channels = opened(admin.metrics.channels)
const paidToday = paidWhere(today.from, today.to)
return carryContext(context, { expiresAt, jobRows, wall, today, week, month, admin, services, serviceCount, aiResumeOps, channels, paidToday })
}
