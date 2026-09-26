/**
 * 一体机岗位板块开关。
 *
 * 由 verify:terminal-device-config 拉起，因此进现有 CI 脚本链。
 * 覆盖：默认开、逐台关、全局关优先、关闭时公开岗位接口拒绝、
 * 招聘会与找企业仍可读、审计写入。
 *
 * 拒绝的一体机公开岗位接口：
 *   GET  /jobs
 *   GET  /jobs/requirement-stats
 *   GET  /jobs/:id
 *   GET  /kiosk/offline-jobs/:id
 *   GET  /kiosk/offline-agencies/:id/jobs
 *   POST /jobs/ai/recommendations
 *   POST /jobs/:id/ai/explain
 *   POST /jobs/:id/ai/match
 *   POST /activity/browse            （仅 targetType=job）
 *   POST /activity/external-jump     （仅 targetType=job）
 *   GET  /companies/:id/jobs         （空列表，企业详情仍返回）
 *   GET  /companies                  （去掉代表岗位标题，不再按岗位标题搜索）
 *   POST /resume/job-fit、GET /resume/job-fit/:taskId、POST .../print
 *   GET/POST/DELETE /me/favorites    （仅 targetType=job；混合列表去掉岗位）
 *   GET  /kiosk/campus/recruitment-stats （岗位计数为 null，招聘会统计仍在）
 *   GET  /me/browse-logs、/me/external-jump-logs （去掉岗位行；?targetType=job 拒绝）
 *   GET  /me/job-ai-sessions
 *   POST/GET /resume/career-plan/:taskId 与打印（带岗位标题的结果拒绝；新生成不附标题）
 *   GET/POST/PATCH /me/job-applications （仅关联了本站岗位的记录）
 * 岗位详情里的 sourceUrl 是扫码投递二维码的内容，没有单独的二维码接口。
 * 机构详情在关闭时去掉内嵌岗位列表，机构本身仍返回。
 * 顾问/助手不查岗位表。早报只给新增岗位个数，不给标题或来源链接，因此不关。
 * 企业详情上的 openJobCount 仍返回：企业本身不受开关影响。
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { KioskJobBoardService } from '../src/terminals/kiosk-job-board.service'
import { AdminKioskJobBoardController } from '../src/terminals/admin-kiosk-job-board.controller'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobRequirementStatsService } from '../src/jobs/job-requirement-stats.service'
import { JobsController } from '../src/jobs/jobs.controller'
import { ActivityService } from '../src/activity/activity.service'
import { ActivityController } from '../src/activity/activity.controller'
import { CompaniesService } from '../src/companies/companies.service'
import { CompaniesController } from '../src/companies/companies.controller'
import { KioskOfflineJobsController } from '../src/offline-agencies/kiosk-offline-jobs.controller'
import { JobAiController, MemberJobAiSessionsController } from '../src/job-ai/job-ai.controller'
import { JobFitController } from '../src/ai/job-fit.controller'
import { CareerPlanController } from '../src/ai/career-plan.controller'
import { KioskCampusRecruitmentStatsController } from '../src/jobs/kiosk-campus-recruitment-stats.controller'
import { CampusRecruitmentStatsService } from '../src/jobs/campus-recruitment-stats.service'
import { MemberFavoritesController } from '../src/member-favorites/member-favorites.controller'
import { MemberFavoritesService } from '../src/member-favorites/member-favorites.service'
import { MeActivityController } from '../src/activity/me-activity.controller'
import { JobApplicationsController } from '../src/job-applications/job-applications.controller'
import { JobApplicationsService } from '../src/job-applications/job-applications.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { CONFIG_REFRESH_INTERVAL_MS } from '../src/terminals/terminal-utils'

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): never { throw new Error(`FAIL ${msg}`) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : undefined) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('FAIL ')) throw e
    const got = errCode(e)
    if (got === code) pass(`${label} → ${code}`)
    else fail(`${label} — 期望 ${code}，实际 ${got ?? (e as Error).message}`)
  }
}

function ensureTable(dbPath: string): void {
  const sql = `
    CREATE TABLE IF NOT EXISTS "KioskJobBoardConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "terminalId" TEXT NOT NULL,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "updatedBy" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "KioskJobBoardConfig_terminalId_key"
      ON "KioskJobBoardConfig"("terminalId");
  `
  execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf8' })
}

function prepareDatabase(): { url: string; cleanup: () => void } {
  const current = process.env.DATABASE_URL ?? ''
  const base = current.startsWith('file:') ? current.slice('file:'.length).split(/[?#]/, 1)[0] : ''
  const name = base.split(/[\\/]/).pop() ?? ''
  if (
    process.env.VERIFICATION_DATABASE_TARGET === 'isolated'
    && current.startsWith('file:')
    && /verify/i.test(name)
    && existsSync(base)
  ) {
    ensureTable(base)
    return { url: current.startsWith('file:') ? current : `file:${base}`, cleanup: () => {} }
  }
  const dir = join(tmpdir(), `kiosk-job-board-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'jobs-verify.db')
  const source = join(process.cwd(), 'prisma/dev.db')
  if (!existsSync(source)) fail('prisma/dev.db 不存在，无法复制验证库')
  copyFileSync(source, dbPath)
  ensureTable(dbPath)
  return {
    url: `file:${dbPath}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export async function verifyKioskJobBoardSwitch(): Promise<void> {
  console.log('\n=== 一体机岗位板块开关 ===')
  const previousUrl = process.env.DATABASE_URL
  const previousTarget = process.env.VERIFICATION_DATABASE_TARGET
  const db = prepareDatabase()
  process.env.DATABASE_URL = db.url
  process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
  assertIsolatedVerificationDatabase()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const board = new KioskJobBoardService(prisma)
  const adminApi = new AdminKioskJobBoardController(board, audit)
  const agent = new TerminalAgentService(prisma, audit)
  const terminals = new TerminalAdminService(prisma, agent, new TerminalToolboxService(prisma), undefined as never, board)
  const jobs = new JobsController(
    new JobsService(new JobsKioskService(prisma), null as never, null as never, null as never),
    null as never,
    null as never,
    null as never,
    new JobRequirementStatsService(prisma),
    null as never,
    board,
  )
  const activity = new ActivityController(
    new ActivityService(prisma),
    new JwtService({ secret: 'verify-job-board-secret-0123456789' }),
    { get: async () => null } as never,
    prisma,
    board,
  )
  const companies = new CompaniesController(new CompaniesService(prisma, audit), board)
  const campus = new KioskCampusRecruitmentStatsController(new CampusRecruitmentStatsService(prisma), board)
  const favorites = new MemberFavoritesController(new MemberFavoritesService(prisma), board)
  const history = new MeActivityController(new ActivityService(prisma), audit, board)
  const applications = new JobApplicationsController(new JobApplicationsService(prisma), board)
  let jobFitReads = 0
  const jobFit = new JobFitController(
    {
      getLatest: async () => { jobFitReads += 1; return { job: { title: 'leaked' } } },
      printReport: async () => { jobFitReads += 1; return { fileId: 'leaked' } },
    } as never,
    new JwtService({ secret: 'verify-job-board-secret-0123456789' }),
    { get: async () => null } as never,
    prisma,
    { analyzeForJobFit: async () => { jobFitReads += 1; return { status: 'completed' } } } as never,
    board,
  )
  let sessionReads = 0
  const sessions = new MemberJobAiSessionsController(
    { listMine: async () => { sessionReads += 1; return { items: [], nextCursor: null, total: 0 } } } as never,
    board,
  )
  let careerIncludeTitle: boolean | undefined
  let careerPrints = 0
  const career = new CareerPlanController(
    {
      generate: async (_taskId: string, _requester: unknown, options?: { includeJobFitTitle?: boolean }) => {
        careerIncludeTitle = options?.includeJobFitTitle
        return { basedOn: { jobFit: null } }
      },
      getLatest: async () => ({ basedOn: { jobFit: 'KJB career job', resume: true, interview: null, selfAssessment: null } }),
      printPlan: async () => { careerPrints += 1; return { fileId: 'career' } },
    } as never,
    new JwtService({ secret: 'verify-job-board-secret-0123456789' }),
    { get: async () => null } as never,
    prisma,
    board,
  )
  const offlineJobs = new KioskOfflineJobsController({
    findOneJob: async () => { throw new Error('closed offline job must not be read') },
  } as never, board)
  const jobAi = new JobAiController(
    null as never,
    null as never,
    new JwtService({ secret: 'verify-job-board-secret-0123456789' }),
    null as never,
    prisma,
    board,
  )

  const suffix = randomBytes(4).toString('hex')
  const adminId = `usr_kjb_${suffix}`
  const orgId = `org_kjb_${suffix}`
  const tA = `term_kjb_${suffix}_a`
  const tB = `term_kjb_${suffix}_b`
  const codeA = `KJB-${suffix}-A`
  const codeB = `KJB-${suffix}-B`
  const jobId = `job_kjb_${suffix}`
  const fairId = `fair_kjb_${suffix}`
  const companyId = `co_kjb_${suffix}`
  const companyName = `KJB Co ${suffix}`
  let endUserId = ''
  const user = { userId: adminId, role: 'admin' as const, orgId: null }
  const reqOf = (terminalId?: string) => ({
    headers: terminalId ? { 'x-terminal-id': terminalId } : {},
  })

  async function cleanup(): Promise<void> {
    await prisma.kioskJobBoardConfig.deleteMany({
      where: { terminalId: { in: ['__global__', codeA, codeB, tA, tB] } },
    })
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    if (endUserId) {
      await prisma.favorite.deleteMany({ where: { endUserId } })
      await prisma.browseLog.deleteMany({ where: { endUserId } })
      await prisma.externalJumpLog.deleteMany({ where: { endUserId } })
      await prisma.jobApplication.deleteMany({ where: { endUserId } })
      await prisma.endUser.deleteMany({ where: { id: endUserId } })
    }
    await prisma.job.deleteMany({ where: { id: jobId } })
    await prisma.companyProfile.deleteMany({ where: { id: companyId } })
    await prisma.jobFair.deleteMany({ where: { id: fairId } })
    await prisma.terminal.deleteMany({ where: { id: { in: [tA, tB] } } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.user.deleteMany({ where: { id: adminId } })
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: { id: adminId, username: `kjb_${suffix}`, passwordHash: 'x', name: '岗位开关验证', role: 'admin' },
    })
    await prisma.organization.create({
      data: { id: orgId, name: `KJB Org ${suffix}`, type: 'school' },
    })
    await prisma.terminal.create({
      data: { id: tA, terminalCode: codeA, agentToken: `kjb-a-${suffix}`, deviceFingerprint: `fp-a-${suffix}` },
    })
    await prisma.terminal.create({
      data: { id: tB, terminalCode: codeB, agentToken: `kjb-b-${suffix}`, deviceFingerprint: `fp-b-${suffix}` },
    })
    await prisma.companyProfile.create({
      data: {
        id: companyId,
        sourceOrgId: orgId,
        externalId: `kjb-co-${suffix}`,
        sourceName: `KJB Source ${suffix}`,
        name: companyName,
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    await prisma.job.create({
      data: {
        id: jobId,
        sourceOrgId: orgId,
        externalId: `kjb-job-${suffix}`,
        sourceName: `KJB Source ${suffix}`,
        sourceUrl: `https://sources.example.com/jobs/${suffix}`,
        title: `KJB Job ${suffix}`,
        company: 'KJB Co',
        city: 'Shanghai',
        category: 'campus',
        companyProfileId: companyId,
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    const now = Date.now()
    await prisma.jobFair.create({
      data: {
        id: fairId,
        sourceOrgId: orgId,
        externalId: `kjb-fair-${suffix}`,
        sourceName: `KJB Fair Source ${suffix}`,
        sourceUrl: `https://sources.example.com/fairs/${suffix}`,
        title: `KJB Fair ${suffix}`,
        theme: 'campus',
        startAt: new Date(now - 86_400_000),
        endAt: new Date(now + 7 * 86_400_000),
        venue: 'Hall',
        city: 'Shanghai',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    const member = await prisma.endUser.create({ data: { phoneHash: `kjb-${suffix}`, phoneEnc: 'enc' } })
    endUserId = member.id
    const memberUser = { endUserId }
    const expiresAt = new Date(Date.now() + 86_400_000)
    await prisma.favorite.create({
      data: { endUserId, targetType: 'job', targetId: jobId, title: `KJB Job ${suffix}` },
    })
    await prisma.favorite.create({
      data: { endUserId, targetType: 'job_fair', targetId: fairId, title: `KJB Fair ${suffix}` },
    })
    await prisma.browseLog.create({
      data: {
        endUserId, targetType: 'job', targetId: jobId, targetTitle: `KJB Job ${suffix}`,
        sourceUrl: `https://sources.example.com/jobs/${suffix}`, expiresAt,
      },
    })
    await prisma.browseLog.create({
      data: {
        endUserId, targetType: 'job_fair', targetId: fairId, targetTitle: `KJB Fair ${suffix}`,
        sourceUrl: `https://sources.example.com/fairs/${suffix}`, expiresAt,
      },
    })
    await prisma.externalJumpLog.create({
      data: {
        endUserId, targetType: 'job', targetId: jobId, action: 'external_apply',
        targetTitle: `KJB Job ${suffix}`, sourceUrl: `https://sources.example.com/jobs/${suffix}`, expiresAt,
      },
    })
    await prisma.externalJumpLog.create({
      data: {
        endUserId, targetType: 'job_fair', targetId: fairId, action: 'external_appointment',
        targetTitle: `KJB Fair ${suffix}`, sourceUrl: `https://sources.example.com/fairs/${suffix}`, expiresAt,
      },
    })
    const linkedApp = await prisma.jobApplication.create({
      data: {
        endUserId, jobId, companyName: 'KJB Co', positionTitle: `KJB Job ${suffix}`,
        channel: 'external_self_reported', statusSource: 'self_reported',
      },
    })
    const manualApp = await prisma.jobApplication.create({
      data: {
        endUserId, companyName: '手填公司', positionTitle: `手填进度${suffix}`,
        channel: 'external_self_reported', statusSource: 'self_reported',
      },
    })
    pass('夹具已创建')

    const openConfig = await terminals.getKioskTerminalConfig(codeA)
    if (
      openConfig.jobBoard.enabled === true
      && openConfig.jobBoard.globalEnabled === true
      && openConfig.jobBoard.terminalEnabled === null
      && openConfig.jobBoard.reason === 'open'
      && openConfig.refreshIntervalMs === CONFIG_REFRESH_INTERVAL_MS
      && openConfig.configVersion.includes('job-board-global:default')
    ) {
      pass('1. 未配置时默认开，刷新周期 5 分钟，configVersion 含默认版本')
    } else {
      fail(`1. 默认开关异常: ${JSON.stringify(openConfig.jobBoard)} version=${openConfig.configVersion}`)
    }

    const openList = await jobs.getJobs(`KJB Job ${suffix}`)
    if (!openList.data.some((row) => row.id === jobId)) fail('2. 默认开时 GET /jobs 未返回夹具岗位')
    pass('2. 默认开时 GET /jobs 返回岗位')

    const savedOff = await adminApi.saveTerminal(codeB, { enabled: false }, user, { headers: {} })
    if (savedOff.enabled !== false || savedOff.effectiveEnabled !== false) {
      fail(`3. 逐台关闭未落库: ${JSON.stringify(savedOff)}`)
    }
    const terminalAudit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, action: 'kiosk_job_board.terminal_update', targetId: codeB },
    })
    if (!terminalAudit?.payloadJson.includes('"afterEnabled":false')) fail('3. 逐台关闭没有审计')
    pass('3. 逐台关闭已落库并写审计')

    await expectCode(
      () => jobs.getJobs(`KJB Job ${suffix}`, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reqOf(codeB)),
      'KIOSK_JOB_BOARD_DISABLED',
      '4. 逐台关时该终端 GET /jobs 拒绝',
    )
    const other = await jobs.getJobs(`KJB Job ${suffix}`, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reqOf(codeA))
    if (!other.data.some((row) => row.id === jobId)) fail('4b. 其它终端被逐台关误伤')
    pass('4b. 其它终端 GET /jobs 仍可读')
    const anon = await jobs.getJobs(`KJB Job ${suffix}`)
    if (!anon.data.some((row) => row.id === jobId)) fail('4c. 无终端身份的请求被逐台关误伤')
    pass('4c. 无终端身份且全局为开时 GET /jobs 仍可读')

    const closedB = await terminals.getKioskTerminalConfig(codeB)
    if (closedB.jobBoard.enabled !== false || closedB.jobBoard.reason !== 'terminal_off') {
      fail(`5. 逐台关的下发值异常: ${JSON.stringify(closedB.jobBoard)}`)
    }
    pass('5. 配置下发带上逐台关')

    await adminApi.saveTerminal(codeA, { enabled: true }, user, { headers: {} })
    await adminApi.saveGlobal({ enabled: false }, user, { headers: {} })
    const globalAudit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, action: 'kiosk_job_board.global_update', targetId: 'global' },
    })
    if (!globalAudit?.payloadJson.includes('"afterEnabled":false')) fail('6. 全局关闭没有审计')
    pass('6. 全局关闭已写审计')

    const priority = await terminals.getKioskTerminalConfig(codeA)
    if (
      priority.jobBoard.enabled !== false
      || priority.jobBoard.reason !== 'global_off'
      || priority.jobBoard.terminalEnabled !== true
      || priority.jobBoard.globalEnabled !== false
      || !priority.configVersion.includes('job-board-global:')
    ) {
      fail(`7. 全局关优先未体现在下发: ${JSON.stringify(priority.jobBoard)}`)
    }
    pass('7. 全局关优先于逐台开，configVersion 含开关版本')

    await expectCode(() => jobs.getJobs(`KJB Job ${suffix}`, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reqOf(codeA)), 'KIOSK_JOB_BOARD_DISABLED', '8. 全局关时已开的终端 GET /jobs 仍拒绝')
    await expectCode(() => jobs.getJobs(`KJB Job ${suffix}`), 'KIOSK_JOB_BOARD_DISABLED', '8b. 全局关时无终端身份的 GET /jobs 拒绝')
    await expectCode(() => jobs.getJobById(jobId, {}), 'KIOSK_JOB_BOARD_DISABLED', '8c. 全局关时 GET /jobs/:id 拒绝')
    await expectCode(() => jobs.getJobRequirementStats(`KJB Job ${suffix}`), 'KIOSK_JOB_BOARD_DISABLED', '8d. 全局关时 GET /jobs/requirement-stats 拒绝')
    await expectCode(() => offlineJobs.findOne(jobId, {}), 'KIOSK_JOB_BOARD_DISABLED', '8e. 全局关时 GET /kiosk/offline-jobs/:id 拒绝')
    await expectCode(() => jobAi.explain(jobId, { headers: {} }), 'KIOSK_JOB_BOARD_DISABLED', '8f. 全局关时岗位 AI 解读拒绝')

    const fairs = await jobs.getJobFairs(undefined, `KJB Fair ${suffix}`)
    if (!fairs.data.some((row) => row.id === fairId)) fail('9. 全局关时招聘会列表被误关')
    pass('9. 全局关时招聘会列表仍可读')
    const companyList = await companies.list()
    if (companyList.success !== true) fail('9b. 找企业列表未成功')
    pass('9b. 全局关时找企业列表仍可读')

    await expectCode(
      () => activity.browse({ targetType: 'job', targetId: jobId, terminalId: codeA }, { headers: {} }),
      'KIOSK_JOB_BOARD_DISABLED',
      '10. 全局关时岗位浏览写入拒绝',
    )
    const fairBrowse = await activity.browse({ targetType: 'job_fair', targetId: fairId }, { headers: {} })
    if (fairBrowse.data.recorded !== false || fairBrowse.data.reason !== 'LOGIN_REQUIRED') {
      fail(`10b. 招聘会浏览被误关: ${JSON.stringify(fairBrowse.data)}`)
    }
    pass('10b. 全局关时招聘会浏览写入不受影响')
    await expectCode(
      () => activity.externalJump({ targetType: 'job', targetId: jobId, action: 'external_apply' }, { headers: { 'x-terminal-id': codeB } }),
      'KIOSK_JOB_BOARD_DISABLED',
      '10c. 全局关时岗位外跳写入拒绝',
    )
    const fairJump = await activity.externalJump({
      targetType: 'job_fair',
      targetId: fairId,
      action: 'external_appointment',
    }, { headers: {} })
    if (fairJump.data.recorded !== false) fail('10d. 招聘会外跳被误关')
    pass('10d. 全局关时招聘会外跳写入不受影响')

    const jobBrowseCount = await prisma.browseLog.count({ where: { targetId: jobId } })
    if (jobBrowseCount !== 1) fail('10e. 夹具里的岗位浏览记录被误删')
    pass('10e. 关闭后没有新的岗位浏览记录落库')

    const closedJobs = await companies.companyJobs(companyId)
    if (closedJobs.data.total !== 0 || closedJobs.data.items.length !== 0) {
      fail(`11. 全局关时企业岗位列表未清空: ${JSON.stringify(closedJobs.data)}`)
    }
    pass('11. 全局关时 GET /companies/:id/jobs 返回空列表')
    const detail = await companies.detail(companyId)
    const detailJson = JSON.stringify(detail.data)
    if (detail.data.name !== companyName || detailJson.includes(`KJB Job ${suffix}`) || detailJson.includes(`/jobs/${suffix}`)) {
      fail('11b. 企业详情被误关或漏出岗位标题/来源链接')
    }
    pass('11b. 全局关时企业详情仍返回，且不含岗位标题或来源链接')
    const titled = await companies.list(companyName)
    const titledCard = titled.data.items.find((row) => row.id === companyId)
    if (!titledCard || titledCard.repJobTitles.length !== 0) fail('11c. 找企业列表仍返回代表岗位标题')
    const byJobTitle = await companies.list(`KJB Job ${suffix}`)
    if (byJobTitle.data.items.some((row) => row.id === companyId)) fail('11d. 关闭后仍能按岗位标题搜到企业')
    pass('11c. 全局关时代表岗位标题为空，且不能按岗位标题搜到企业')

    await expectCode(
      () => jobFit.analyze({ taskId: 't', jobId }, {}),
      'KIOSK_JOB_BOARD_DISABLED',
      '12. 全局关时 POST /resume/job-fit 拒绝',
    )
    await expectCode(() => jobFit.latest('t', {}), 'KIOSK_JOB_BOARD_DISABLED', '12b. 全局关时岗位匹配结果拒绝')
    await expectCode(() => jobFit.print('t', {}), 'KIOSK_JOB_BOARD_DISABLED', '12c. 全局关时岗位匹配打印拒绝')
    if (jobFitReads !== 0) fail('12d. 关闭后仍读了岗位匹配')
    pass('12d. 关闭后没有进入岗位匹配读写')

    await expectCode(
      () => favorites.list(memberUser, 'job'),
      'KIOSK_JOB_BOARD_DISABLED',
      '13. 全局关时只读岗位收藏拒绝',
    )
    await expectCode(
      () => favorites.add(memberUser, { targetType: 'job', targetId: jobId }),
      'KIOSK_JOB_BOARD_DISABLED',
      '13b. 全局关时新增岗位收藏拒绝',
    )
    await expectCode(
      () => favorites.remove(memberUser, 'job', jobId),
      'KIOSK_JOB_BOARD_DISABLED',
      '13c. 全局关时取消岗位收藏拒绝',
    )
    const mixedFav = await favorites.list(memberUser)
    if (mixedFav.data.items.some((row) => row.targetType === 'job' || row.title === `KJB Job ${suffix}`)) {
      fail('13d. 混合收藏仍返回岗位')
    }
    if (!mixedFav.data.items.some((row) => row.targetType === 'job_fair' && row.title === `KJB Fair ${suffix}`)) {
      fail('13e. 招聘会收藏被误关')
    }
    pass('13e. 全局关时混合收藏去掉岗位，招聘会收藏仍在')

    const statsOff = await campus.getRecruitmentStats()
    const campusGroup = statsOff.data.groups.find((group) => group.sourceOrgId === orgId)
    if (!campusGroup || campusGroup.fairCount < 1 || campusGroup.jobListingCount !== null || campusGroup.openJobCount !== null) {
      fail(`14. 校招统计未按开关隐藏岗位计数: ${JSON.stringify(campusGroup)}`)
    }
    if (campusGroup.fairPositionCount !== 0) fail('14b. 招聘会场内岗位计数被改写')
    pass('14. 全局关时校招岗位计数为 null，招聘会场次仍在')

    await expectCode(
      () => history.browseLogs(memberUser, undefined, undefined, 'job'),
      'KIOSK_JOB_BOARD_DISABLED',
      '15. 全局关时只读岗位浏览记录拒绝',
    )
    const browseMixed = await history.browseLogs(memberUser)
    if (browseMixed.data.items.some((row) => row.targetType === 'job' || (row.sourceUrl ?? '').includes('/jobs/'))) {
      fail('15b. 浏览记录仍返回岗位标题或来源链接')
    }
    if (!browseMixed.data.items.some((row) => row.targetType === 'job_fair')) fail('15c. 招聘会浏览记录被误关')
    const jumpMixed = await history.jumpLogs(memberUser)
    if (jumpMixed.data.items.some((row) => row.targetType === 'job')) fail('15d. 外跳记录仍返回岗位')
    if (!jumpMixed.data.items.some((row) => row.targetType === 'job_fair')) fail('15e. 招聘会外跳记录被误关')
    await expectCode(
      () => history.jumpLogs(memberUser, undefined, undefined, 'job'),
      'KIOSK_JOB_BOARD_DISABLED',
      '15f. 全局关时只读岗位外跳记录拒绝',
    )
    pass('15e. 全局关时浏览和外跳记录去掉岗位，招聘会记录仍在')

    await expectCode(
      () => sessions.list(memberUser),
      'KIOSK_JOB_BOARD_DISABLED',
      '16. 全局关时岗位 AI 会话列表拒绝',
    )
    if (sessionReads !== 0) fail('16b. 关闭后仍读取了岗位 AI 会话')
    pass('16b. 关闭后没有读取岗位 AI 会话')

    const generated = await career.generate('career-task', {})
    if (careerIncludeTitle !== false || generated.basedOn?.jobFit) fail('17. 全局关时新职业规划仍附岗位标题')
    pass('17. 全局关时新职业规划不附岗位标题')
    await expectCode(() => career.latest('career-task', {}), 'KIOSK_JOB_BOARD_DISABLED', '17b. 全局关时已保存的带标题规划拒绝')
    await expectCode(() => career.print('career-task', {}), 'KIOSK_JOB_BOARD_DISABLED', '17c. 全局关时带标题规划的打印拒绝')
    if (careerPrints !== 0) fail('17d. 关闭后仍生成了带岗位标题的规划打印')
    pass('17d. 关闭后没有打印带岗位标题的规划')

    const apps = await applications.list(memberUser)
    if (apps.data.items.some((row) => row.jobId === jobId || row.positionTitle === `KJB Job ${suffix}`)) {
      fail('18. 关联本站岗位的求职进度仍返回岗位标题')
    }
    if (!apps.data.items.some((row) => row.id === manualApp.id && row.positionTitle === `手填进度${suffix}`)) {
      fail('18b. 手填求职进度被误关')
    }
    pass('18b. 全局关时关联岗位的进度被隐藏，手填进度仍在')
    await expectCode(
      () => applications.create(memberUser, { jobId, status: 'intention' }),
      'KIOSK_JOB_BOARD_DISABLED',
      '18c. 全局关时按岗位新建进度拒绝',
    )
    await expectCode(
      () => applications.update(memberUser, linkedApp.id, { note: 'no' }),
      'KIOSK_JOB_BOARD_DISABLED',
      '18d. 全局关时修改关联岗位的进度拒绝',
    )
    const manualUpdated = await applications.update(memberUser, manualApp.id, { note: '仍可改' })
    if (manualUpdated.data.note !== '仍可改') fail('18e. 手填进度不能修改')
    pass('18e. 全局关时手填进度仍可修改')

    await adminApi.saveGlobal({ enabled: true }, user, { headers: {} })
    const openJobs = await companies.companyJobs(companyId, undefined, undefined, reqOf(codeA))
    if (!openJobs.data.items.some((row) => row.id === jobId && row.sourceUrl?.includes(`/jobs/${suffix}`))) {
      fail('19. 全局重新打开后，已开终端看不到企业岗位')
    }
    pass('19. 全局打开且本台打开时企业岗位列表恢复')
    const closedTerminalJobs = await companies.companyJobs(companyId, undefined, undefined, reqOf(codeB))
    if (closedTerminalJobs.data.items.length !== 0) fail('19b. 逐台关时该终端仍看到企业岗位')
    const anonJobs = await companies.companyJobs(companyId)
    if (!anonJobs.data.items.some((row) => row.id === jobId)) fail('19c. 无终端身份被逐台关误伤')
    pass('19c. 逐台关只作用于带该终端身份的企业岗位列表')

    await expectCode(
      () => jobFit.analyze({ taskId: 't', manualJob: { title: '手填岗位' } }, reqOf(codeB)),
      'KIOSK_JOB_BOARD_DISABLED',
      '20. 逐台关时该终端岗位匹配拒绝',
    )
    const openedFit = await jobFit.analyze({ taskId: 't', jobId }, reqOf(codeA))
    if (!openedFit || jobFitReads !== 1) fail('20b. 其它终端的岗位匹配没有放行')
    pass('20b. 逐台关不误伤其它终端的岗位匹配')

    const terminalStats = await campus.getRecruitmentStats(reqOf(codeB))
    const terminalGroup = terminalStats.data.groups.find((group) => group.sourceOrgId === orgId)
    if (!terminalGroup || terminalGroup.jobListingCount !== null || terminalGroup.fairCount < 1) {
      fail(`21. 逐台关时校招岗位计数未隐藏: ${JSON.stringify(terminalGroup)}`)
    }
    const openStats = await campus.getRecruitmentStats(reqOf(codeA))
    const openGroup = openStats.data.groups.find((group) => group.sourceOrgId === orgId)
    if (!openGroup || openGroup.jobListingCount === null || openGroup.jobListingCount < 1 || openGroup.openJobCount === null) {
      fail(`21b. 其它终端的校招岗位计数没有恢复: ${JSON.stringify(openGroup)}`)
    }
    pass('21b. 逐台关只隐藏该终端的校招岗位计数')

    await expectCode(
      () => favorites.list(memberUser, 'job', undefined, undefined, reqOf(codeB)),
      'KIOSK_JOB_BOARD_DISABLED',
      '22. 逐台关时该终端读取岗位收藏拒绝',
    )
    const otherFav = await favorites.list(memberUser, 'job', undefined, undefined, reqOf(codeA))
    if (!otherFav.data.items.some((row) => row.targetId === jobId)) fail('22b. 其它终端读不到岗位收藏')
    pass('22b. 逐台关不误伤其它终端的岗位收藏')
  } finally {
    await cleanup().catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl
    if (previousTarget === undefined) delete process.env.VERIFICATION_DATABASE_TARGET
    else process.env.VERIFICATION_DATABASE_TARGET = previousTarget
    db.cleanup()
  }
  console.log('一体机岗位板块开关验证通过')
}

const invokedDirectly = process.argv[1]?.includes('verify-kiosk-job-board-switch')
if (invokedDirectly) {
  verifyKioskJobBoardSwitch().catch((error: unknown) => {
    console.error(`\n❌ ${(error as Error).message}\n`)
    process.exit(1)
  })
}
