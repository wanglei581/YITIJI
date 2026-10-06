import { join } from 'node:path'
import { shanghaiDayKey } from '../src/console-screen/console-screen.metric'
import { assert, prepareIsolatedScreenDatabase } from './console-screen-snapshot-cases-01'
import { firstMetricDiff, assertRecruitmentHostingContractSetup } from './console-screen-snapshot-cases-06'
import { assertRecruitmentHostingContractPhase2 } from './console-screen-snapshot-cases-08'
import { carryContext } from './console-screen-snapshot-cases-18'
import { PrismaService } from '../src/prisma/prisma.service'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { assertRecruitmentHostingContractPhase1 } from './console-screen-snapshot-cases-07'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'



export async function assertRecruitmentHostingContractPhase3(context: Awaited<ReturnType<typeof assertRecruitmentHostingContractPhase2>>) {
const { now, partnerUseOn, partnerUseOff, contentPartnerOn } = context
const contentPartnerOff = partnerUseOff.metrics.partnerContent?.available === true ? partnerUseOff.metrics.partnerContent.value : null
const typed = (
      rows: { byType: Array<{ type: string; browse: number | null; favorites: number | null; sourceOpens: number | null }> } | null,
      type: string,
    ) => rows?.byType.find((item) => item.type === type)
assert(
      '6o. 机构内容分类在打开时四类都在，关闭后只下发政策；零收藏/来源计数保留 0',
      contentPartnerOn !== null
        && contentPartnerOff !== null
        && contentPartnerOn.coverage === 'members_only'
        && contentPartnerOn.basis === 'current_content_join'
        && contentPartnerOff.coverage === 'members_only'
        && contentPartnerOff.basis === 'current_content_join'
        && contentPartnerOn.byType.map((item) => item.type).join(',') === 'job,job_fair,policy,company_profile'
        && typed(contentPartnerOn, 'job')?.browse === 6
        && typed(contentPartnerOn, 'job')?.sourceOpens === 6
        && typed(contentPartnerOn, 'job')?.favorites === 0
        && typed(contentPartnerOn, 'job_fair')?.browse === 6
        && typed(contentPartnerOn, 'job_fair')?.sourceOpens === 0
        && typed(contentPartnerOn, 'policy')?.browse === 6
        && typed(contentPartnerOn, 'policy')?.sourceOpens === 6
        && typed(contentPartnerOn, 'company_profile')?.browse === 6
        && typed(contentPartnerOn, 'company_profile')?.sourceOpens === 0
        && contentPartnerOff.byType.map((item) => item.type).join(',') === 'policy'
        && typed(contentPartnerOff, 'policy')?.browse === 6
        && typed(contentPartnerOff, 'policy')?.favorites === 0
        && typed(contentPartnerOff, 'policy')?.sourceOpens === 6,
      `on=${JSON.stringify(contentPartnerOn?.byType)} off=${JSON.stringify(contentPartnerOff?.byType)}`,
    )
const topPartnerOn = partnerUseOn.metrics.partnerTop?.available === true ? partnerUseOn.metrics.partnerTop.value : null
const topPartnerOff = partnerUseOff.metrics.partnerTop?.available === true ? partnerUseOff.metrics.partnerTop.value : null
assert(
      '6p. 机构热门在关闭后滤掉岗位、招聘会、企业，政策标题仍在',
      topPartnerOn !== null
        && topPartnerOff !== null
        && topPartnerOn.items.length === 4
        && topPartnerOn.items.some((item) => item.type === 'job' && item.title === 'A岗1' && item.browse === 6)
        && topPartnerOn.items.some((item) => item.type === 'job_fair' && item.title === '甲机构招聘会' && item.browse === 6)
        && topPartnerOn.items.some((item) => item.type === 'policy' && item.title === '甲机构政策' && item.browse === 6)
        && topPartnerOn.items.some((item) => item.type === 'company_profile' && item.title === '甲机构企业' && item.browse === 6)
        && topPartnerOff.items.length === 1
        && topPartnerOff.items[0]?.type === 'policy'
        && topPartnerOff.items[0]?.title === '甲机构政策'
        && topPartnerOff.items[0]?.browse === 6
        && topPartnerOff.items.every((item) => item.type !== 'job' && item.type !== 'job_fair' && item.type !== 'company_profile'),
      `on=${JSON.stringify(topPartnerOn?.items)} off=${JSON.stringify(topPartnerOff?.items)}`,
    )
const dailyOn = partnerUseOn.metrics.partnerDaily?.available === true ? partnerUseOn.metrics.partnerDaily.value : null
const dailyOff = partnerUseOff.metrics.partnerDaily?.available === true ? partnerUseOff.metrics.partnerDaily.value : null
const day = shanghaiDayKey(now)
const partnerDiff = firstMetricDiff(partnerUseOn.metrics, partnerUseOff.metrics, ['partnerContent', 'partnerTop', 'partnerDaily'])
assert(
      '6q. 机构按日在关闭后仍可用，且只统计政策',
      partnerUseOn.metrics.partnerDaily?.available === true
        && partnerUseOff.metrics.partnerDaily?.available === true
        && dailyOn?.days.length === 1
        && dailyOn.days[0]?.date === day
        && dailyOn.days[0]?.browse === 24
        && dailyOn.days[0]?.sourceOpens === 12
        && dailyOff?.days.length === 1
        && dailyOff.days[0]?.date === day
        && dailyOff.days[0]?.browse === 6
        && dailyOff.days[0]?.sourceOpens === 6
        && partnerDiff === ''
        && partnerUseOn.metrics.visits?.available === true // 服务人次已接入（W-69）；本夹具没写会话 → 真 0
        && partnerUseOn.metrics.visits.value === 0,
      `on=${JSON.stringify(dailyOn)} off=${JSON.stringify(dailyOff)} diff=${partnerDiff}`,
    )
return carryContext(context, { contentPartnerOff, typed, topPartnerOn, topPartnerOff, dailyOn, dailyOff, day, partnerDiff })
}


export async function assertRecruitmentHostingContract(
  prisma: PrismaService,
  screen: ConsoleScreenService,
  args: {
    orgA: string
    orgB: string
    memberId: string
    suffix: string
    now: Date
    jumpQualified: string
    jumpSmall: string
  },
): Promise<void> {
const context = await assertRecruitmentHostingContractSetup(prisma, screen, args)
const { memberId, orgEmpty, policyId, fairId, companyId, jobId } = context
try {
const phase1 = await assertRecruitmentHostingContractPhase1(context)
const phase2 = await assertRecruitmentHostingContractPhase2(phase1)
await assertRecruitmentHostingContractPhase3(phase2)

}  finally {
    process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
    await prisma.browseLog.deleteMany({ where: { endUserId: memberId } })
    await prisma.favorite.deleteMany({ where: { endUserId: memberId } })
    const jumpTargets = [jobId, policyId].filter((id) => id.length > 0)
    if (jumpTargets.length > 0) {
      await prisma.externalJumpLog.deleteMany({ where: { targetId: { in: jumpTargets } } })
    }
    await prisma.policyPost.deleteMany({ where: { id: policyId } })
    await prisma.jobFair.deleteMany({ where: { id: fairId } })
    await prisma.companyProfile.deleteMany({ where: { id: companyId } })
    await prisma.organization.deleteMany({ where: { id: orgEmpty } })
  }

}


export async function assertServiceContractSetup(){
const isolated = prepareIsolatedScreenDatabase()
assert(
    '0a. 数据库安全：NODE_ENV 不是 production',
    process.env['NODE_ENV'] !== 'production',
  )
assert(
    '0b. 数据库安全：跑在本地 SQLite（DATABASE_URL=file:）',
    Boolean(process.env['DATABASE_URL']?.startsWith('file:')),
    `DATABASE_URL=${process.env['DATABASE_URL'] ?? '(unset)'}`,
  )
assert(
    '0c. 隔离库在 OS 临时目录，不写 prisma/dev.db',
    isolated.databasePath.startsWith(tmpdir())
      && isolated.databasePath.endsWith('verify.db')
      && !isolated.databasePath.includes(`${join('prisma', 'dev.db')}`)
      && process.env['VERIFICATION_DATABASE_TARGET'] === 'isolated',
    isolated.databasePath,
  )
const prisma = new PrismaService()
await prisma.onModuleInit()
const cache = new ScreenSnapshotCache()
const opsService = new AdminOpsService(prisma)
let alertCalls = 0
const originalListDerivedAlerts = opsService.listDerivedAlerts.bind(opsService)
opsService.listDerivedAlerts = (async (view, limit) => {
    alertCalls += 1
    return originalListDerivedAlerts(view, limit)
  }) as AdminOpsService['listDerivedAlerts']
const screen = new ConsoleScreenService(prisma, opsService, cache)
const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
const orgA = `org_scrn_a_${suffix}`
const orgB = `org_scrn_b_${suffix}`
const srcA = `src_scrn_a_${suffix}`
const srcB = `src_scrn_b_${suffix}`
const termA = `term_scrn_a_${suffix}`
const termB = `term_scrn_b_${suffix}`
const userA = `user_scrn_pa_${suffix}`
const userB = `user_scrn_pb_${suffix}`
const adminId = `user_scrn_ad_${suffix}`
const memberId = `eu_scrn_${suffix}`
const taskA = `pt_scrn_a_${suffix}`
const taskHist1 = `pt_scrn_h1_${suffix}`
const taskHist2 = `pt_scrn_h2_${suffix}`
const taskHist3 = `pt_scrn_h3_${suffix}`
const taskRecovered = `pt_scrn_ok_${suffix}`
const userBlank = `user_scrn_nb_${suffix}`
const printTaskIds = [taskA, taskHist1, taskHist2, taskHist3, taskRecovered]
const resumeFileName = `求职简历-张三-${suffix}.pdf`
const ids = { orgA, orgB, srcA, srcB, termA, termB, userA, userB, adminId, memberId, taskA, userBlank, suffix, resumeFileName }
const cleanup = async () => {
    await prisma.auditLog.deleteMany({ where: { targetType: 'terminal' } })
    await prisma.scanTask.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.terminalCapability.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: memberId } })
    await prisma.aiServiceLog.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { task: { terminal: { orgId: { in: [orgA, orgB] } } } } })
    await prisma.printTask.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: printTaskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: printTaskIds } } })
    await prisma.order.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.syncLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.companyProfile.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobSource.deleteMany({ where: { id: { in: [srcA, srcB] } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.terminal.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB, adminId, userBlank] } } })
    await prisma.endUser.deleteMany({ where: { id: memberId } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }
const previousHosting = process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED']
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
return { isolated, prisma, cache, opsService, get alertCalls() { return alertCalls }, set alertCalls(value: typeof alertCalls) { alertCalls = value }, originalListDerivedAlerts, screen, suffix, orgA, orgB, srcA, srcB, termA, termB, userA, userB, adminId, memberId, taskA, taskHist1, taskHist2, taskHist3, taskRecovered, userBlank, printTaskIds, resumeFileName, ids, cleanup, previousHosting }
}
