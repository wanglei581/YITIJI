
import { SCREEN_JUMP_COPY, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'
import { assert } from './console-screen-snapshot-cases-01'
import { isHostingClosed, firstMetricDiff } from './console-screen-snapshot-cases-06'
import { assertRecruitmentHostingContractPhase1 } from './console-screen-snapshot-cases-07'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertRecruitmentHostingContractPhase2(context: Awaited<ReturnType<typeof assertRecruitmentHostingContractPhase1>>) {
const { prisma, orgA, memberId, suffix, now, policyId, fairId, companyId, govOn, opsOn, partnerAOn, emptyOn, govOff, opsOff, partnerAOff, emptyOff, diffs } = context
assert(
      '6j. 审核时效和其余快照指标在开关两侧逐字段相同，状态仍是 ok',
      diffs.every((diff) => diff === '')
        && govOn.status === 'ok'
        && govOff.status === 'ok'
        && govOff.degraded === false
        && opsOn.status === opsOff.status
        && partnerAOn.status === partnerAOff.status
        && emptyOn.status === emptyOff.status
        && JSON.stringify(govOn.window) === JSON.stringify(govOff.window)
        && opsOn.metrics.reviewSlaAndOrgDimension?.available === false
        && opsOn.metrics.reviewSlaAndOrgDimension.reason === SCREEN_UNAVAILABLE_REASON.reviewDecisionUnwritten
        && partnerAOn.metrics.reviewSlaAndOrgDimension?.available === false
        && partnerAOn.metrics.reviewSlaAndOrgDimension.reason === SCREEN_UNAVAILABLE_REASON.reviewDecisionUnwritten,
      diffs.filter(Boolean).join(' | '),
    )
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
const browseBefore = await prisma.browseLog.count()
const jobJumpsBefore = await prisma.externalJumpLog.count({ where: { targetType: 'job' } })
const jumpsBefore = await prisma.externalJumpLog.count()
const job = await prisma.job.findFirst({
      where: { sourceOrgId: orgA, reviewStatus: 'approved', publishStatus: 'published' },
      select: { id: true },
    })
context.jobId = job?.id ?? ''
const expiresAt = new Date(now.getTime() + 86_400_000)
await prisma.policyPost.create({
      data: { id: policyId, sourceOrgId: orgA, sourceName: 'A源', title: '甲机构政策' },
    })
await prisma.jobFair.create({
      data: {
        id: fairId,
        sourceOrgId: orgA,
        externalId: `fair-${suffix}`,
        sourceName: 'A源',
        sourceUrl: 'https://example.com/fair-host',
        title: '甲机构招聘会',
        startAt: new Date(now.getTime() - 86_400_000),
        endAt: new Date(now.getTime() + 86_400_000),
        venue: '馆',
        city: '青岛',
      },
    })
await prisma.companyProfile.create({
      data: { id: companyId, sourceOrgId: orgA, externalId: `co-${suffix}`, sourceName: 'A源', name: '甲机构企业' },
    })
const targets = [
      { type: 'job', id: context.jobId },
      { type: 'job_fair', id: fairId },
      { type: 'policy', id: policyId },
      { type: 'company_profile', id: companyId },
    ]
await prisma.browseLog.createMany({
      data: targets.flatMap((target) => Array.from({ length: 6 }, () => ({
        endUserId: memberId,
        targetType: target.type,
        targetId: target.id,
        createdAt: now,
        expiresAt,
      }))),
    })
await prisma.externalJumpLog.createMany({
      data: [
        ...Array.from({ length: 6 }, () => ({
          endUserId: memberId,
          targetType: 'job',
          targetId: context.jobId,
          action: 'external_open',
          sourceName: '托管回归源',
          createdAt: now,
          expiresAt,
        })),
        ...Array.from({ length: 6 }, () => ({
          endUserId: memberId,
          targetType: 'policy',
          targetId: policyId,
          action: 'external_open',
          sourceName: '政策入口',
          createdAt: now,
          expiresAt,
        })),
      ],
    })
const usage = new ConsoleScreenUsageService(prisma, new ScreenSnapshotCache())
const adminUseOn = await usage.getAdminUsage('today', now)
const partnerUseOn = await usage.getPartnerUsage(orgA, 'today', now)
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
const adminUseOff = await usage.getAdminUsage('today', now)
const partnerUseOff = await usage.getPartnerUsage(orgA, 'today', now)
assert(
      '6k. 使用统计 limits.recruitmentHosting 覆盖开与关，样本下限仍是 5',
      adminUseOn.limits.recruitmentHosting === 'enabled'
        && adminUseOff.limits.recruitmentHosting === 'disabled'
        && partnerUseOn.limits.recruitmentHosting === 'enabled'
        && partnerUseOff.limits.recruitmentHosting === 'disabled'
        && adminUseOn.limits.minAggregateSample === 5
        && adminUseOff.limits.minAggregateSample === 5
        && partnerUseOn.limits.minAggregateSample === 5,
    )
const jobsOn = adminUseOn.metrics.jobs
const topOn = adminUseOn.metrics.topSources30d
assert(
      '6l. 托管打开时今日岗位使用按种子计数、30天榜不计今天，关闭后两项未开启',
      browseBefore === 0
        && jobJumpsBefore === 20 + 3
        && jumpsBefore === 20 + 3
        && context.jobId.length > 0
        && jobsOn?.available === true
        && jobsOn.value.browse === 6
        && jobsOn.value.favorites === 0
        && jobsOn.value.sourceOpens === 20 + 3 + 6
        && jobsOn.value.coverage === 'members_only'
        && jobsOn.source === 'BrowseLog/Favorite/ExternalJumpLog'
        && jobsOn.window === 'today'
        && isHostingClosed(adminUseOff.metrics.jobs, 'BrowseLog/Favorite/ExternalJumpLog', 'today')
        && topOn?.available === true
        && topOn.source === 'ExternalJumpLog.sourceName'
        && topOn.window === '30d'
        && topOn.value.copy === SCREEN_JUMP_COPY
        && topOn.value.items.length === 0 // 种子均在今天，完整30天榜不计。
        && isHostingClosed(adminUseOff.metrics.topSources30d, 'ExternalJumpLog.sourceName', '30d'),
      `jobs=${JSON.stringify(jobsOn)} jumpsBefore=${jobJumpsBefore}`,
    )
const servicesOn = adminUseOn.metrics.services?.available === true ? adminUseOn.metrics.services.value : null
const servicesOff = adminUseOff.metrics.services?.available === true ? adminUseOff.metrics.services.value : null
const hiddenServices = new Set(['jobs', 'fairs', 'company'])
assert(
      '6m. 托管关闭后服务节点不下发岗位、招聘会、企业，政策保留且其余节点逐项相同',
      servicesOn !== null
        && servicesOff !== null
        && servicesOn.find((item) => item.key === 'jobs')?.count === 6
        && servicesOn.find((item) => item.key === 'fairs')?.count === 6
        && servicesOn.find((item) => item.key === 'policy')?.count === 6
        && servicesOn.find((item) => item.key === 'company')?.count === 6
        && servicesOff.some((item) => item.key === 'policy' && item.count === 6 && item.lane === 'info')
        && servicesOff.every((item) => !hiddenServices.has(item.key))
        && JSON.stringify(servicesOff) === JSON.stringify(servicesOn.filter((item) => !hiddenServices.has(item.key)))
        && adminUseOn.metrics.services?.source === adminUseOff.metrics.services?.source
        && adminUseOn.metrics.services?.window === adminUseOff.metrics.services?.window,
      `on=${servicesOn?.map((item) => item.key).join(',')} off=${servicesOff?.map((item) => item.key).join(',')}`,
    )
const contentOn = adminUseOn.metrics.content?.available === true ? adminUseOn.metrics.content.value : null
const contentOff = adminUseOff.metrics.content?.available === true ? adminUseOff.metrics.content.value : null
const outcomesOn = adminUseOn.metrics.outcomes?.available === true ? adminUseOn.metrics.outcomes.value : null
const outcomesOff = adminUseOff.metrics.outcomes?.available === true ? adminUseOff.metrics.outcomes.value : null
const usageDiff = firstMetricDiff(adminUseOn.metrics, adminUseOff.metrics, ['jobs', 'topSources30d', 'services'])
assert(
      '6n. 内容与结果在关闭后仍原样计数，招聘会和企业浏览不下成未开启',
      contentOn !== null
        && contentOn.policy === 6
        && contentOn.fair === 6
        && contentOn.company === 6
        && contentOn.coverage === 'members_only'
        && JSON.stringify(contentOff) === JSON.stringify(contentOn)
        && outcomesOn !== null
        && outcomesOn.sourceOpens === 20 + 3 + 6 + 6
        && JSON.stringify(outcomesOff) === JSON.stringify(outcomesOn)
        && usageDiff === ''
        && adminUseOn.status === 'ok'
        && adminUseOff.status === 'ok',
      `content=${JSON.stringify(contentOff)} outcomes=${JSON.stringify(outcomesOff)} diff=${usageDiff}`,
    )
const contentPartnerOn = partnerUseOn.metrics.partnerContent?.available === true ? partnerUseOn.metrics.partnerContent.value : null
return carryContext(context, { browseBefore, jobJumpsBefore, jumpsBefore, job, expiresAt, targets, usage, adminUseOn, partnerUseOn, adminUseOff, partnerUseOff, jobsOn, topOn, servicesOn, servicesOff, hiddenServices, contentOn, contentOff, outcomesOn, outcomesOff, usageDiff, contentPartnerOn })
}
