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
 * 岗位详情里的 sourceUrl 是扫码投递二维码的内容，没有单独的二维码接口。
 * 机构详情在关闭时去掉内嵌岗位列表，机构本身仍返回。
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
import { JobAiController } from '../src/job-ai/job-ai.controller'
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
  const companies = new CompaniesController(new CompaniesService(prisma, audit))
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
  const user = { userId: adminId, role: 'admin' as const, orgId: null }
  const reqOf = (terminalId?: string) => ({
    headers: terminalId ? { 'x-terminal-id': terminalId } : {},
  })

  async function cleanup(): Promise<void> {
    await prisma.kioskJobBoardConfig.deleteMany({
      where: { terminalId: { in: ['__global__', codeA, codeB, tA, tB] } },
    })
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    await prisma.job.deleteMany({ where: { id: jobId } })
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
        startAt: new Date(now - 86_400_000),
        endAt: new Date(now + 7 * 86_400_000),
        venue: 'Hall',
        city: 'Shanghai',
        reviewStatus: 'approved',
        publishStatus: 'published',
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
    if (jobBrowseCount !== 0) fail('10e. 关闭后仍写入了岗位浏览记录')
    pass('10e. 关闭后没有岗位浏览记录落库')
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
