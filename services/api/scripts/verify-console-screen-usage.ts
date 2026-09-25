/**
 * GET /admin/screen/usage 与 GET /partner/screen/usage。
 * 自建隔离 SQLite（文件名含 verify），不读写 prisma/dev.db，不访问生产。
 *
 * Run: pnpm --filter @ai-job-print/api verify:console-screen-usage
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BadRequestException, ForbiddenException, Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import {
  ADMIN_USAGE_METRIC_KEYS,
  PARTNER_USAGE_METRIC_KEYS,
  SCREEN_JUMP_COPY,
  SCREEN_MIN_AGGREGATE_SAMPLE,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenMetric,
  type ScreenUsageSnapshot,
} from '../src/console-screen/console-screen.types'
import { PrismaService } from '../src/prisma/prisma.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { daysAgoStart, shanghaiDayKey, shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { PartnerOrgRequiredError } from '../src/console-screen/console-screen.org'
import { AdminUsageController, PartnerUsageController } from '../src/console-screen/console-screen.usage.controller'
import {
  USAGE_ADMIN_CACHE_ORG,
  usageCacheKey,
  ConsoleScreenUsageService,
} from '../src/console-screen/console-screen.usage.service'
import {
  USAGE_EVENT_ROW_CAP,
  USAGE_SERVICE_NODES,
  loadUsageTimeline,
  usageProviderLabel,
  usageWindow,
} from '../src/console-screen/console-screen.usage.queries'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed += 1
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed += 1
  }
}

function readSrc(relative: string): string {
  return readFileSync(join(__dirname, '..', relative), 'utf8')
}

function contractBody(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\//, '').replace(/^\s+/, '')
}

function inWindow(at: Date, from: Date, to: Date): boolean {
  const time = at.getTime()
  return time >= from.getTime() && time <= to.getTime()
}

function opened<T>(metric: ScreenMetric<T> | undefined): T | null {
  return metric && metric.available === true ? metric.value : null
}

const EXPECTED_NODES = [
  { key: 'jobs', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['job'] },
  { key: 'fairs', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['job_fair', 'fair_company'] },
  { key: 'policy', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['policy'] },
  { key: 'company', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['company_profile'] },
  { key: 'aiResume', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['parseResume', 'optimizeResume', 'adjustResumeLayout', 'generateResume'] },
  { key: 'aiAdvisor', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['chatAssistant'] },
  { key: 'interview', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['interviewQuestion', 'interviewReport'] },
  { key: 'careerPlan', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['careerPlan', 'selfAssessment'] },
  { key: 'jobAi', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['jobRecommend', 'jobExplain', 'jobMatch', 'fairVisitPlan'] },
  { key: 'print', lane: 'print', coverage: 'all_recorded', kind: 'print_created' },
  { key: 'scan', lane: 'print', coverage: 'all_recorded', kind: 'scan_created' },
] as const

function assertSourceContract(): void {
  const shared = readFileSync(join(__dirname, '..', '..', '..', 'packages/shared/src/types/consoleScreen.ts'), 'utf8')
  const local = readSrc('src/console-screen/console-screen.types.ts')
  const usageSrc = [
    'console-screen.usage.queries.ts',
    'console-screen.usage.service.ts',
    'console-screen.usage.controller.ts',
  ].map((name) => readSrc(`src/console-screen/${name}`)).join('\n')
  const controller = readSrc('src/console-screen/console-screen.usage.controller.ts')
  const service = readSrc('src/console-screen/console-screen.usage.service.ts')
  const queries = readSrc('src/console-screen/console-screen.usage.queries.ts')
  const ci = readFileSync(join(__dirname, '..', '..', '..', '.github/workflows/ci.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }

  assert('u1. shared 与 API 副本去掉文件头后逐字节相同', contractBody(shared) === contractBody(local))
  assert(
    'u2. 两个未写入计数器原因已追加',
    SCREEN_UNAVAILABLE_REASON.uploadCounterUnwritten === 'upload_counter_unwritten'
      && SCREEN_UNAVAILABLE_REASON.inspectionCounterUnwritten === 'inspection_counter_unwritten'
      && shared.includes("uploadCounterUnwritten: 'upload_counter_unwritten'")
      && shared.includes("inspectionCounterUnwritten: 'inspection_counter_unwritten'"),
  )
  assert(
    'u3. 服务节点常量表与口径逐项一致，classifyIntent 不进节点',
    JSON.stringify(USAGE_SERVICE_NODES) === JSON.stringify(EXPECTED_NODES)
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('classifyIntent')
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('voiceTranscribe')
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('voiceSynthesize')
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('contractReview'),
  )
  assert(
    'u4. 管理员与机构指标键、行数上限、提供者标签',
    JSON.stringify(ADMIN_USAGE_METRIC_KEYS) === JSON.stringify(['channels', 'visits', 'services', 'outcomes', 'heat7d', 'pulse2h', 'printSteps', 'resumeSteps', 'ai', 'jobs', 'topSources30d', 'content'])
      && JSON.stringify(PARTNER_USAGE_METRIC_KEYS) === JSON.stringify(['partnerContent', 'partnerDaily', 'partnerTop', 'visits'])
      && USAGE_EVENT_ROW_CAP === 60_000
      && usageProviderLabel('llm:deepseek') === 'DeepSeek'
      && usageProviderLabel('llm:qwen') === '千问'
      && usageProviderLabel('mock') === '未就绪兜底'
      && usageProviderLabel('stub') === '未就绪兜底'
      && usageProviderLabel('llm:other') === 'llm:other',
  )
  assert(
    'u5. 守卫与 snapshot 一致，机构 orgId 只取当前用户，DTO 不收 orgId',
    /@UseGuards\(JwtAuthGuard, RolesGuard\)/.test(controller)
      && /@Roles\('admin'\)/.test(controller)
      && /@Roles\('partner'\)/.test(controller)
      && /@Get\('admin\/screen\/usage'\)/.test(controller)
      && /@Get\('partner\/screen\/usage'\)/.test(controller)
      && /requirePartnerOrgId\(user\.orgId\)/.test(controller)
      && !/query\.orgId/.test(controller)
      && !/orgId\?:/.test(controller)
      && /getAdminUsage\(query\.range \?\? 'today'\)/.test(controller)
      && !/getAdminUsage\([^)]*rowCap/.test(controller),
  )
  assert(
    'u6. 缓存键含 audience、orgId、range，counts 档 60 秒',
    usageCacheKey('admin', USAGE_ADMIN_CACHE_ORG, 'today') === 'usage:admin:platform:today'
      && usageCacheKey('partner', 'org_a', '7d') === 'usage:partner:org_a:7d'
      && /usage:\$\{audience\}:\$\{orgId\}:\$\{range\}/.test(service)
      && /SCREEN_CACHE_TTL_SECONDS\.counts/.test(service),
  )
  assert(
    'u7. usage 文件不读求职进度、不记搜索词、不把外跳说成投递结果',
    !/jobApplication|JobApplication/.test(usageSrc)
      && !/搜索词|searchKeyword|hotSearch/.test(usageSrc)
      && !/投递成功|一键投递|立即投递|平台投递/.test(usageSrc)
      && /打开来源平台入口/.test(service)
      && !/terminalId|phoneEnc|sourceFileName|orderNo|ipAddress|payloadJson|fileUrl/.test(usageSrc),
  )
  assert(
    'u8. 时间线只取 createdAt；企业展示名用 name；CI 两个 job 都执行本门禁',
    /select: \{ createdAt: true \}/.test(queries)
      && /title: row\.name/.test(queries)
      && /loadUsageTimeline\(this\.prisma, heatFrom, now, rowCap\)/.test(service)
      && pkg.scripts['verify:console-screen-usage'] === 'node -r @swc-node/register scripts/verify-console-screen-usage.ts'
      && ci.split('pnpm --filter @ai-job-print/api verify:console-screen-usage').length === 3,
  )
}

function prepareDatabase(): { databasePath: string; cleanup: () => void } {
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const directory = mkdtempSync(join(tmpdir(), 'verify-console-usage-'))
  const databasePath = join(directory, 'verify-usage.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    databasePath,
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

const NOW = new Date('2026-01-15T02:07:30.000Z')
const TODAY_START = new Date('2026-01-14T16:00:00.000Z')
const BEFORE_TODAY = new Date(TODAY_START.getTime() - 1)
const DAY7_START = new Date(TODAY_START.getTime() - 6 * 86_400_000)
const DAY30_START = new Date(TODAY_START.getTime() - 29 * 86_400_000)
const BEFORE_30 = new Date(DAY30_START.getTime() - 1)
const HOUR1 = new Date('2026-01-14T17:10:00.000Z')
const HOUR4 = new Date('2026-01-14T20:00:00.000Z')
const HOUR7 = new Date('2026-01-14T23:10:00.000Z')
const PULSE_AI = new Date('2026-01-15T00:12:00.000Z')
const YESTERDAY_NOON = new Date('2026-01-14T04:00:00.000Z')
const PHONE = '13900001111'
const FILE_NAME = '张三的简历.pdf'
const ORDER_SECRET = 'ORD机密单号'
const IP_SECRET = '203.0.113.55'
const APP_COMPANY = '自填机密公司'
const FAVORITE_SNAPSHOT = '收藏快照不要用'

interface AiSeed {
  operation: string
  status: string
  provider: string
  estimatedCostCny: number | null
  latencyMs: number | null
  createdAt: Date
}

interface OrderSeed {
  orderNo: string
  payStatus: string
  channel: string | null
  paidAt: Date | null
  endUserId: string | null
  createdAt: Date
}

interface PrintSeed {
  id: string
  createdAt: Date
  status: string
  completedAt: Date | null
  printOutcome: string | null
  updatedAt: Date
}

function repeatAi(count: number, seed: Omit<AiSeed, 'estimatedCostCny' | 'latencyMs'> & Partial<AiSeed>): AiSeed[] {
  return Array.from({ length: count }, () => ({
    estimatedCostCny: null,
    latencyMs: null,
    ...seed,
  }))
}

function isPrinted(row: PrintSeed, from: Date, to: Date): boolean {
  const completedIn = row.completedAt !== null && inWindow(row.completedAt, from, to)
  if (row.status === 'completed' && completedIn) return true
  if (row.printOutcome === 'printed' && completedIn) return true
  return row.printOutcome === 'printed' && row.completedAt === null && inWindow(row.updatedAt, from, to)
}

async function assertBehavior(): Promise<void> {
  const isolated = prepareDatabase()
  assert('u9. 隔离库文件名含 verify，且不是 prisma/dev.db', isolated.databasePath.endsWith('verify-usage.db') && !isolated.databasePath.includes(`${join('prisma', 'dev.db')}`))
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const cache = new ScreenSnapshotCache()
  const usage = new ConsoleScreenUsageService(prisma, cache)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_usage_a_${suffix}`
  const orgB = `org_usage_b_${suffix}`
  const termLeak = `term_leak_${suffix}`
  const adminId = `user_usage_admin_${suffix}`
  const userA = `user_usage_a_${suffix}`
  const userB = `user_usage_b_${suffix}`
  const userBlank = `user_usage_blank_${suffix}`
  const memberId = `eu_leak_${suffix}`
  const phoneEnc = `enc_${PHONE}_${suffix}`
  const fileUrl = `https://files.internal/${FILE_NAME}`
  const orderNo = `${ORDER_SECRET}-${suffix}`

  const jobJia = `job_jia_${suffix}`
  const jobCold = `job_cold_${suffix}`
  const jobDel = `job_del_${suffix}`
  const jobB = `job_b_${suffix}`
  const extraA = [1, 2, 3].map((index) => `job_ax_${index}_${suffix}`)
  const extraB = [1, 2, 3, 4].map((index) => `job_bx_${index}_${suffix}`)
  const policyA = `pol_a_${suffix}`
  const policyAExtra = [1, 2, 3].map((index) => `pol_ax_${index}_${suffix}`)
  const policyB = `pol_b_${suffix}`
  const fairA = `fair_a_${suffix}`
  const companyA = `co_a_${suffix}`
  const fairCompanyId = `fc_${suffix}`

  const owned: Record<'A' | 'B', Record<string, string[]>> = {
    A: { job: [jobJia, jobCold, ...extraA], job_fair: [fairA], policy: [policyA, ...policyAExtra], company_profile: [companyA] },
    B: { job: [jobB, ...extraB], job_fair: [], policy: [policyB], company_profile: [] },
  }
  const browses: Array<{ targetType: string; targetId: string; at: Date }> = []
  const favorites: Array<{ targetType: string; targetId: string; at: Date }> = []
  const jumps: Array<{ targetType: string; targetId: string; at: Date; sourceName: string }> = []
  const addBrowse = (targetType: string, targetId: string, at: Date, count: number) => {
    for (let index = 0; index < count; index += 1) browses.push({ targetType, targetId, at })
  }
  addBrowse('job', jobJia, NOW, 6)
  addBrowse('job', jobJia, HOUR1, 5)
  addBrowse('job', jobJia, HOUR7, 5)
  addBrowse('job', jobCold, HOUR4, 4)
  addBrowse('job', jobB, NOW, 7)
  addBrowse('job', jobDel, NOW, 6)
  addBrowse('policy', policyA, NOW, 5)
  addBrowse('policy', policyB, NOW, 4)
  addBrowse('job_fair', fairA, NOW, 5)
  addBrowse('company_profile', companyA, NOW, 4)
  addBrowse('fair_company', fairCompanyId, NOW, 3)
  for (const id of [jobJia, jobCold, ...extraA, jobB, ...extraB]) {
    favorites.push({ targetType: 'job', targetId: id, at: NOW })
  }
  for (const id of [policyA, ...policyAExtra]) favorites.push({ targetType: 'policy', targetId: id, at: NOW })
  for (let index = 0; index < 6; index += 1) jumps.push({ targetType: 'job', targetId: jobJia, at: NOW, sourceName: '公共就业' })
  for (let index = 0; index < 5; index += 1) jumps.push({ targetType: 'job', targetId: jobJia, at: YESTERDAY_NOON, sourceName: '公共就业' })
  for (let index = 0; index < 3; index += 1) jumps.push({ targetType: 'job', targetId: `gone_${suffix}`, at: NOW, sourceName: '小样本' })
  for (let index = 0; index < 5; index += 1) jumps.push({ targetType: 'policy', targetId: policyA, at: NOW, sourceName: '公共就业' })

  const ai: AiSeed[] = [
    { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', estimatedCostCny: 1.5, latencyMs: 100, createdAt: NOW },
    { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', estimatedCostCny: 1.5, latencyMs: 200, createdAt: NOW },
    { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', estimatedCostCny: 1.5, latencyMs: 300, createdAt: NOW },
    ...repeatAi(2, { operation: 'optimizeResume', status: 'success', provider: 'llm:deepseek', latencyMs: 400, createdAt: NOW }),
    ...repeatAi(1, { operation: 'adjustResumeLayout', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'chatAssistant', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(1, { operation: 'chatAssistant', status: 'running', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'interviewQuestion', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'interviewReport', status: 'success', provider: 'llm:deepseek', createdAt: NOW }),
    ...repeatAi(5, { operation: 'careerPlan', status: 'success', provider: 'llm:deepseek', createdAt: NOW }),
    ...repeatAi(4, { operation: 'selfAssessment', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'jobRecommend', status: 'success', provider: 'llm:other', createdAt: NOW }),
    ...repeatAi(4, { operation: 'classifyIntent', status: 'success', provider: 'llm:deepseek', createdAt: NOW }),
    ...repeatAi(4, { operation: 'classifyIntent', status: 'success', provider: 'llm:deepseek', createdAt: PULSE_AI }),
    ...repeatAi(5, { operation: 'voiceTranscribe', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(3, { operation: 'voiceSynthesize', status: 'success', provider: 'stub', createdAt: NOW }),
    ...repeatAi(2, { operation: 'contractReview', status: 'success', provider: 'mock', createdAt: NOW }),
    ...repeatAi(3, { operation: 'parseResume', status: 'failed', provider: 'stub', latencyMs: 9000, createdAt: NOW }),
    ...repeatAi(1, { operation: 'parseResume', status: 'failed', provider: 'llm:qwen', latencyMs: 9000, createdAt: NOW }),
  ]
  ai.filter((row) => row.operation === 'optimizeResume').forEach((row, index) => {
    row.latencyMs = index === 0 ? 400 : 500
  })

  const orders: OrderSeed[] = [
    ...Array.from({ length: 3 }, (_, index) => ({ orderNo: `kiosk-m-${index}-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: NOW, endUserId: memberId, createdAt: NOW })),
    { orderNo: `kiosk-a-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: NOW, endUserId: null, createdAt: NOW },
    { orderNo: `kiosk-boundary-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: TODAY_START, endUserId: null, createdAt: NOW },
    { orderNo: `kiosk-before-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: BEFORE_TODAY, endUserId: null, createdAt: NOW },
    ...Array.from({ length: 4 }, (_, index) => ({ orderNo: `mini-${index}-${suffix}`, payStatus: 'paid', channel: 'miniapp_cloud', paidAt: NOW, endUserId: memberId, createdAt: BEFORE_TODAY })),
    ...Array.from({ length: 3 }, (_, index) => ({ orderNo: `nullch-${index}-${suffix}`, payStatus: 'paid', channel: null, paidAt: NOW, endUserId: null, createdAt: NOW })),
    ...Array.from({ length: 2 }, (_, index) => ({ orderNo: `emptych-${index}-${suffix}`, payStatus: 'paid', channel: '', paidAt: NOW, endUserId: null, createdAt: NOW })),
    { orderNo: `h5-${suffix}`, payStatus: 'paid', channel: 'h5', paidAt: NOW, endUserId: null, createdAt: NOW },
    { orderNo: `unpaid-${suffix}`, payStatus: 'unpaid', channel: 'kiosk', paidAt: null, endUserId: memberId, createdAt: NOW },
    { orderNo: `refund-${suffix}`, payStatus: 'refunded', channel: 'kiosk', paidAt: NOW, endUserId: memberId, createdAt: NOW },
    { orderNo: orderNo, payStatus: 'paid', channel: 'kiosk', paidAt: NOW, endUserId: null, createdAt: NOW },
  ]

  const prints: PrintSeed[] = [
    { id: `pt_a_${suffix}`, createdAt: YESTERDAY_NOON, status: 'completed', completedAt: NOW, printOutcome: null, updatedAt: NOW },
    { id: `pt_b_${suffix}`, createdAt: NOW, status: 'failed', completedAt: null, printOutcome: 'printed', updatedAt: NOW },
    { id: `pt_c_${suffix}`, createdAt: NOW, status: 'completed', completedAt: YESTERDAY_NOON, printOutcome: null, updatedAt: NOW },
    ...Array.from({ length: 4 }, (_, index) => ({ id: `pt_d_${index}_${suffix}`, createdAt: NOW, status: 'completed', completedAt: NOW, printOutcome: null, updatedAt: NOW })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `pt_e_${index}_${suffix}`, createdAt: DAY30_START, status: 'pending', completedAt: null, printOutcome: null, updatedAt: DAY30_START })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `pt_f_${index}_${suffix}`, createdAt: BEFORE_30, status: 'pending', completedAt: null, printOutcome: null, updatedAt: BEFORE_30 })),
  ]
  const scans = [
    ...Array.from({ length: 5 }, () => TODAY_START),
    ...Array.from({ length: 4 }, () => BEFORE_TODAY),
  ]

  const countBrowse = (targetTypes: string[], from: Date, to: Date, ids?: string[]) => browses.filter((row) => (
    targetTypes.includes(row.targetType) && inWindow(row.at, from, to) && (ids === undefined || ids.includes(row.targetId))
  )).length
  const countFav = (targetType: string, from: Date, to: Date, ids?: string[]) => favorites.filter((row) => (
    row.targetType === targetType && inWindow(row.at, from, to) && (ids === undefined || ids.includes(row.targetId))
  )).length
  const countJump = (targetType: string | null, from: Date, to: Date, ids?: string[]) => jumps.filter((row) => (
    (targetType === null || row.targetType === targetType) && inWindow(row.at, from, to) && (ids === undefined || ids.includes(row.targetId))
  )).length
  const aiWhere = (from: Date, to: Date) => ai.filter((row) => inWindow(row.createdAt, from, to))
  const successOf = (ops: string[], from: Date, to: Date) => aiWhere(from, to).filter((row) => row.status === 'success' && ops.includes(row.operation)).length
  const paidWhere = (from: Date, to: Date) => orders.filter((row) => row.payStatus === 'paid' && row.paidAt !== null && inWindow(row.paidAt, from, to))
  const show = (count: number) => (count >= SCREEN_MIN_AGGREGATE_SAMPLE ? count : null)

  try {
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
    const wall = new Date()
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
      'u10. today 窗口是上海零点到 now，7d/30d 含当天往前数',
      today.from.toISOString() === TODAY_START.toISOString()
        && today.to.toISOString() === NOW.toISOString()
        && week.from.toISOString() === DAY7_START.toISOString()
        && month.from.toISOString() === DAY30_START.toISOString()
        && shanghaiDayStart(NOW).toISOString() === TODAY_START.toISOString()
        && daysAgoStart(NOW, 7).toISOString() === DAY7_START.toISOString()
        && daysAgoStart(NOW, 30).toISOString() === DAY30_START.toISOString(),
    )

    const admin = await usage.getAdminUsage('today', NOW)
    const services = opened(admin.metrics.services)
    const serviceCount = (key: string) => {
      const item = services?.find((row) => row.key === key)
      return item === undefined ? 'missing' : item.count
    }
    const aiResumeOps = ['parseResume', 'optimizeResume', 'adjustResumeLayout', 'generateResume']
    assert('u11. 管理员指标键齐全且 visits 未接入', JSON.stringify(Object.keys(admin.metrics)) === JSON.stringify([...ADMIN_USAGE_METRIC_KEYS]) && admin.metrics.visits?.available === false && admin.metrics.visits.reason === SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten && !('value' in admin.metrics.visits))
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
        && services?.every((item) => item.lane === (item.key === 'print' || item.key === 'scan' ? 'print' : item.key.startsWith('ai') || item.key === 'interview' || item.key === 'careerPlan' || item.key === 'jobAi' ? 'ai' : 'info'))
        && services?.filter((item) => item.lane === 'info').every((item) => item.coverage === 'members_only')
        && services?.filter((item) => item.lane !== 'info').every((item) => item.coverage === 'all_recorded'),
      `jobs=${String(serviceCount('jobs'))} advisor=${String(serviceCount('aiAdvisor'))} scan=${String(serviceCount('scan'))}`,
    )

    const channels = opened(admin.metrics.channels)
    const paidToday = paidWhere(today.from, today.to)
    assert(
      'u13. 渠道按 paidAt 计已支付，分项小于 5 为 null，未支付和已退款不计',
      channels?.paidOrders === paidToday.length
        && channels.kiosk === show(paidToday.filter((row) => row.channel === 'kiosk').length)
        && channels.miniapp === show(paidToday.filter((row) => row.channel === 'miniapp_cloud').length)
        && channels.unlabeled === show(paidToday.filter((row) => row.channel === null || row.channel === '').length)
        && channels.memberOrders === show(paidToday.filter((row) => row.endUserId !== null).length)
        && paidToday.length === 16
        && channels.miniapp === null
        && channels.kiosk === 6,
      `paid=${String(channels?.paidOrders)} kiosk=${String(channels?.kiosk)} mini=${String(channels?.miniapp)} unlabeled=${String(channels?.unlabeled)} member=${String(channels?.memberOrders)}`,
    )

    const outcomes = opened(admin.metrics.outcomes)
    const printedToday = prints.filter((row) => isPrinted(row, today.from, today.to)).length
    assert(
      'u14. 结果是外跳、收藏、三类成功报告和完成出纸',
      outcomes?.sourceOpens === show(countJump(null, today.from, today.to))
        && outcomes.favorites === show(favorites.filter((row) => inWindow(row.at, today.from, today.to)).length)
        && outcomes.aiReports === show(successOf(['parseResume', 'interviewReport', 'careerPlan'], today.from, today.to))
        && outcomes.printed === show(printedToday)
        && successOf(['parseResume'], today.from, today.to) === 3
        && outcomes.aiReports === 13,
      `opens=${String(outcomes?.sourceOpens)} fav=${String(outcomes?.favorites)} reports=${String(outcomes?.aiReports)} printed=${String(outcomes?.printed)}`,
    )

    const steps = opened(admin.metrics.printSteps)
    const resume = opened(admin.metrics.resumeSteps)
    assert(
      'u15. 上传和检查未写入；付款、出纸、解析、优化、导出与结果共用少于 5 则 null',
      steps?.uploaded.available === false
        && steps.uploaded.reason === 'upload_counter_unwritten'
        && steps.inspected.available === false
        && steps.inspected.reason === 'inspection_counter_unwritten'
        && steps.paid === channels?.paidOrders
        && steps.printed === outcomes?.printed
        && steps.printed === show(printedToday)
        && resume?.uploaded.available === false
        && resume.analyzed === show(successOf(['parseResume'], today.from, today.to))
        && resume.optimized === show(successOf(['optimizeResume'], today.from, today.to))
        && resume.exported === 5
        && resume.analyzed === null
        && resume.optimized === null,
      `printedStep=${String(steps?.printed)} analyzed=${String(resume?.analyzed)} optimized=${String(resume?.optimized)}`,
    )

    const aiMetric = opened(admin.metrics.ai)
    const aiToday = aiWhere(today.from, today.to)
    const successN = aiToday.filter((row) => row.status === 'success').length
    const failedN = aiToday.filter((row) => row.status === 'failed').length
    const measured = aiToday.filter((row) => row.estimatedCostCny !== null)
    const latencyRows = aiToday.filter((row) => row.status === 'success' && row.latencyMs !== null)
    const avgLatency = Math.round(latencyRows.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) / latencyRows.length)
    const classify = aiMetric?.byOperation.find((row) => row.operation === 'classifyIntent')
    const voice = aiMetric?.byOperation.find((row) => row.operation === 'voiceTranscribe')
    const contract = aiMetric?.byOperation.find((row) => row.operation === 'contractReview')
    const chat = aiMetric?.byOperation.find((row) => row.operation === 'chatAssistant')
    const deepseek = aiMetric?.providers.find((row) => row.provider === 'llm:deepseek')
    const qwen = aiMetric?.providers.find((row) => row.provider === 'llm:qwen')
    const mock = aiMetric?.providers.find((row) => row.provider === 'mock')
    const fallbackN = aiToday.filter((row) => row.provider === 'mock' || row.provider === 'stub').length
    assert(
      'u16. AI 总量、成功率、已采集成本和兜底提供者少于 5 则 null',
      aiMetric?.total === show(aiToday.length)
        && aiMetric.success === show(successN)
        && aiMetric.failed === show(failedN)
        && failedN === 4
        && aiMetric.failed === null
        && aiMetric.successRate === Math.round((successN / aiToday.length) * 1000) / 10
        && aiMetric.successRate !== Math.round((successN / (successN + failedN)) * 1000) / 10
        && successN + failedN >= SCREEN_MIN_AGGREGATE_SAMPLE
        && aiMetric.avgLatencyMs === avgLatency
        && measured.length === 3
        && aiMetric.estimatedCostCny === null
        && aiMetric.costMeasuredCalls === null
        && aiMetric.fallbackCalls === show(fallbackN)
        && classify?.count === 8
        && voice?.count === 5
        && contract?.count === null
        && chat?.count === 6
        && deepseek?.label === 'DeepSeek'
        && qwen?.label === '千问'
        && mock?.label === '未就绪兜底'
        && mock.count === null
        && !aiMetric.byOperation.some((row) => row.operation === 'jobApplication'),
      `total=${String(aiMetric?.total)} rate=${String(aiMetric?.successRate)} cost=${String(aiMetric?.estimatedCostCny)} latency=${String(aiMetric?.avgLatencyMs)}`,
    )

    const jobs = opened(admin.metrics.jobs)
    const content = opened(admin.metrics.content)
    const top = opened(admin.metrics.topSources30d)
    assert(
      'u17. 岗位与内容只统计会员行为，外跳榜复用小于 5 则不进榜',
      jobs?.browse === show(countBrowse(['job'], today.from, today.to))
        && jobs.favorites === show(countFav('job', today.from, today.to))
        && jobs.sourceOpens === show(countJump('job', today.from, today.to))
        && jobs.coverage === 'members_only'
        && content?.fair === show(countBrowse(['job_fair', 'fair_company'], today.from, today.to))
        && content.policy === show(countBrowse(['policy'], today.from, today.to))
        && content.company === null
        && content.coverage === 'members_only'
        && top?.copy === SCREEN_JUMP_COPY
        && top.items.some((item) => item.sourceName === '公共就业' && item.count >= 5)
        && top.items.every((item) => item.count >= 5)
        && !top.items.some((item) => item.sourceName === '小样本'),
    )

    const heat = opened(admin.metrics.heat7d)
    const todayHeat = heat?.days.find((day) => day.date === '2026-01-15')
    assert(
      'u18. 热力是上海自然日的 24 小时，未到的钟点和小于 5 为 null',
      heat?.days.length === 7
        && heat.days[0]?.date === '2026-01-09'
        && heat.days[6]?.date === '2026-01-15'
        && todayHeat?.hours.length === 24
        && todayHeat.hours[0] === 5
        && todayHeat.hours[1] === 5
        && todayHeat.hours[4] === null
        && todayHeat.hours[7] === 5
        && todayHeat.hours[10] !== null
        && todayHeat.hours.slice(11).every((hour) => hour === null)
        && heat.peakHour === 10,
      `h0=${String(todayHeat?.hours[0])} h1=${String(todayHeat?.hours[1])} h4=${String(todayHeat?.hours[4])} h7=${String(todayHeat?.hours[7])} peak=${String(heat?.peakHour)}`,
    )
    assert(
      'u18c. 热力图最后一行是今天',
      heat?.days[heat.days.length - 1]?.date === shanghaiDayKey(NOW),
    )
    const pulse = opened(admin.metrics.pulse2h)
    assert(
      'u19. 脉搏是上海时区近 2 小时的 24 个 5 分钟桶',
      pulse?.bucketMinutes === 5
        && pulse.buckets.length === 24
        && pulse.buckets[0]?.start === '2026-01-15T00:10:00.000Z'
        && pulse.buckets[23]?.start === '2026-01-15T02:05:00.000Z'
        && pulse.buckets[0].ai === null
        && pulse.buckets[0].info === null
        && pulse.buckets[0].print === null
        && pulse.buckets[23].ai !== null
        && pulse.buckets[23].info !== null
        && pulse.buckets[23].print !== null,
      `first=${pulse?.buckets[0]?.start} ai0=${String(pulse?.buckets[0]?.ai)}`,
    )

    const weekSnap = await usage.getAdminUsage('7d', NOW)
    const monthSnap = await usage.getAdminUsage('30d', NOW)
    const weekServices = opened(weekSnap.metrics.services)
    const monthServices = opened(monthSnap.metrics.services)
    const weekScan = weekServices?.find((item) => item.key === 'scan')?.count
    const todayScan = services?.find((item) => item.key === 'scan')?.count
    const monthPrint = monthServices?.find((item) => item.key === 'print')?.count
    const weekPrint = weekServices?.find((item) => item.key === 'print')?.count
    assert(
      'u20. 上海零点是窗口边界：零点计入，零点前 1 毫秒不计入 today',
      todayScan === 5
        && weekScan === 9
        && week.from.toISOString() === DAY7_START.toISOString()
        && prints.filter((row) => inWindow(row.createdAt, month.from, month.to)).length === (monthPrint ?? -1)
        && prints.filter((row) => inWindow(row.createdAt, week.from, week.to)).length === (weekPrint ?? -1)
        && (monthPrint ?? 0) > (weekPrint ?? 0)
        && opened(weekSnap.metrics.resumeSteps)?.exported === 6
        && opened(weekSnap.metrics.channels)?.kiosk === 7,
      `scan today/7d=${String(todayScan)}/${String(weekScan)} print 7d/30d=${String(weekPrint)}/${String(monthPrint)}`,
    )

    const partnerA = await usage.getPartnerUsage(orgA, 'today', NOW)
    const partnerB = await usage.getPartnerUsage(orgB, 'today', NOW)
    const contentA = opened(partnerA.metrics.partnerContent)
    const contentB = opened(partnerB.metrics.partnerContent)
    const rowA = (type: string) => contentA?.byType.find((row) => row.type === type)
    const rowB = (type: string) => contentB?.byType.find((row) => row.type === type)
    const topA = opened(partnerA.metrics.partnerTop)
    const topB = opened(partnerB.metrics.partnerTop)
    assert(
      'u21. 机构只看见自己内容上的浏览、收藏和外跳，已删目标不计',
      partnerA.audience === 'partner'
        && contentA?.coverage === 'members_only'
        && contentA.basis === 'current_content_join'
        && contentA.byType.map((row) => row.type).join(',') === 'job,job_fair,policy,company_profile'
        && rowA('job')?.browse === show(countBrowse(['job'], today.from, today.to, owned.A['job']))
        && rowA('job')?.favorites === show(countFav('job', today.from, today.to, owned.A['job']))
        && rowA('job')?.sourceOpens === show(countJump('job', today.from, today.to, owned.A['job']))
        && rowA('job_fair')?.browse === 5
        && rowA('policy')?.browse === 5
        && rowA('policy')?.favorites === null
        && rowA('company_profile')?.browse === null
        && rowB('job')?.browse === 7
        && rowB('policy')?.browse === null
        && rowA('job')?.browse !== (rowA('job')?.browse ?? 0) + (rowB('job')?.browse ?? 0)
        && countBrowse(['job'], today.from, today.to, [jobDel]) === 6
        && (rowA('job')?.browse ?? 0) < countBrowse(['job'], today.from, today.to),
      `Ajob=${String(rowA('job')?.browse)} Bjob=${String(rowB('job')?.browse)}`,
    )
    assert(
      'u22. 机构热门只用本机构内容标题，浏览少于 5 不进榜',
      topA !== null
        && topA.items.length <= 5
        && topA.items.every((item) => item.browse >= 5)
        && topA.items.some((item) => item.title === '甲机构岗位' && item.type === 'job')
        && topA.items.every((item) => item.title.startsWith('甲机构'))
        && !topA.items.some((item) => item.title.includes('乙') || item.title === '甲机构冷门' || item.title === '已删岗位' || item.title === FAVORITE_SNAPSHOT)
        && topB?.items.length === 1
        && topB.items[0]?.title === '乙机构岗位'
        && !JSON.stringify(topB).includes('甲机构'),
      `A=${topA?.items.map((item) => item.title).join('|')} B=${topB?.items.map((item) => item.title).join('|')}`,
    )
    const dailyA = opened((await usage.getPartnerUsage(orgA, '7d', NOW)).metrics.partnerDaily)
    assert(
      'u23. 机构按日序列长度跟随 range，小于 5 的日子为 null',
      opened(partnerA.metrics.partnerDaily)?.days.length === 1
        && opened(partnerA.metrics.partnerDaily)?.days[0]?.date === '2026-01-15'
        && dailyA?.days.length === 7
        && dailyA.days[0]?.date === '2026-01-09'
        && dailyA.days[6]?.date === '2026-01-15'
        && dailyA.days[6]?.browse !== null
        && dailyA.days[5]?.sourceOpens === 5
        && dailyA.days[0]?.browse === null,
      `days=${String(dailyA?.days.length)} yOpens=${String(dailyA?.days[5]?.sourceOpens)}`,
    )
    assert(
      'u23b. 机构端浏览、收藏同样是 4 为 null、5 为实数',
      countBrowse(['company_profile'], today.from, today.to, owned.A['company_profile']) === 4
        && rowA('company_profile')?.browse === null
        && rowA('policy')?.browse === 5
        && countFav('policy', today.from, today.to, owned.A['policy']) === 4
        && rowA('policy')?.favorites === null
        && rowA('job')?.favorites === 5
        && rowA('job_fair')?.favorites === null
        && dailyA?.days[5]?.sourceOpens === 5
        && dailyA.days[0]?.browse === null,
    )

    const packed = JSON.stringify({ admin, weekSnap, monthSnap, partnerA, partnerB })
    const secrets = [PHONE, phoneEnc, FILE_NAME, fileUrl, orderNo, IP_SECRET, APP_COMPANY, '自填机密岗位', FAVORITE_SNAPSHOT, termLeak, memberId, `tok_${suffix}`]
    const leaked = secrets.filter((secret) => packed.includes(secret))
    const bannedKeys = ['endUserId', 'phoneEnc', 'phoneHash', 'orderNo', 'sourceFileName', 'ipAddress', 'terminalId', 'payloadJson', 'fileUrl', 'jobApplication', 'searchKeyword']
    assert('u24. 响应 JSON 不含手机号、文件名、订单号、IP、终端和自填进度', leaked.length === 0, leaked.join(','))
    assert('u25. 响应键不含身份、文件或搜索字段', bannedKeys.every((key) => !packed.includes(`"${key}"`)))
    assert('u26. 响应不出现投递成功等违禁文案', !/投递成功|一键投递|立即投递|平台投递/.test(packed) && packed.includes(SCREEN_JUMP_COPY))
    assert(
      'u27. 快照带上海窗口、样本下限和 ok 状态',
      admin.range === 'today'
        && admin.window.timezone === 'Asia/Shanghai'
        && admin.window.from === TODAY_START.toISOString()
        && admin.limits.minAggregateSample === 5
        && admin.status === 'ok'
        && admin.degraded === false
        && partnerA.range === 'today'
        && partnerB.metrics.visits?.reason === 'kiosk_session_unwritten',
    )

    cache.clear()
    const seenKeys: string[] = []
    const seenTtls: number[] = []
    const originalGet = cache.getOrLoad.bind(cache)
    cache.getOrLoad = (async (key: string, ttl: number, load: () => Promise<unknown>, shouldCache?: (value: unknown) => boolean) => {
      seenKeys.push(key)
      seenTtls.push(ttl)
      return originalGet(key, ttl, load as never, shouldCache as never)
    }) as typeof cache.getOrLoad
    let orderCalls = 0
    const originalOrderCount = prisma.order.count.bind(prisma.order)
    prisma.order.count = (async (...args: unknown[]) => {
      orderCalls += 1
      return originalOrderCount(...args as never)
    }) as typeof prisma.order.count
    await usage.getAdminUsage('today', NOW)
    const afterFirst = orderCalls
    await usage.getAdminUsage('today', NOW)
    const afterHit = orderCalls
    await usage.getAdminUsage('7d', NOW)
    await usage.getPartnerUsage(orgA, '30d', NOW)
    await usage.getPartnerUsage(orgB, '30d', NOW)
    prisma.order.count = originalOrderCount
    cache.getOrLoad = originalGet
    assert(
      'u28. 缓存键区分 range 和 orgId，命中不再查订单，TTL 为 60 秒',
      afterFirst > 0
        && afterHit === afterFirst
        && seenKeys.includes('usage:admin:platform:today')
        && seenKeys.includes('usage:admin:platform:7d')
        && seenKeys.includes(`usage:partner:${orgA}:30d`)
        && seenKeys.includes(`usage:partner:${orgB}:30d`)
        && seenTtls.every((ttl) => ttl === 60),
      `orders ${afterFirst}->${afterHit} keys=${seenKeys.join(',')}`,
    )

    cache.clear()
    prisma.order.count = (async () => {
      throw new Error('order down')
    }) as typeof prisma.order.count
    const degraded = await usage.getAdminUsage('today', NOW)
    prisma.order.count = originalOrderCount
    const recovered = await usage.getAdminUsage('today', NOW)
    assert(
      'u29. 查询失败不入缓存，渠道 unavailable，热力仍在，状态 degraded',
      degraded.status === 'degraded'
        && degraded.degraded
        && degraded.metrics.channels?.available === false
        && degraded.metrics.channels.reason === 'source_query_failed'
        && degraded.metrics.heat7d?.available === true
        && recovered.metrics.channels?.available === true
        && recovered.status === 'ok',
    )

    cache.clear()
    const capped = await loadUsageTimeline(prisma, week.from, NOW, 2)
    const cappedAdmin = await usage.getAdminUsage('today', NOW, 2)
    const cappedPartner = await usage.getPartnerUsage(orgA, 'today', NOW, 1)
    assert(
      'u30. 超过行数上限整项拒绝，不返回半截桶',
      capped.capped === true
        && capped.lanes.info.length === 0
        && capped.lanes.ai.length === 0
        && capped.lanes.print.length === 0
        && cappedAdmin.metrics.heat7d?.available === false
        && cappedAdmin.metrics.heat7d.reason === 'window_row_cap_exceeded'
        && !('value' in cappedAdmin.metrics.heat7d)
        && cappedAdmin.metrics.pulse2h?.available === false
        && cappedAdmin.metrics.channels?.available === true
        && cappedPartner.metrics.partnerDaily?.available === false
        && cappedPartner.metrics.partnerDaily.reason === 'window_row_cap_exceeded'
        && cappedPartner.metrics.partnerContent?.available === true
        && cappedPartner.metrics.partnerTop?.available === true,
    )

    let blankOrg: unknown
    try {
      await usage.getPartnerUsage('   ', 'today', NOW)
    } catch (error) {
      blankOrg = error
    }
    const partnerController = new PartnerUsageController(usage)
    let controllerBlank: unknown
    try {
      await partnerController.getPartnerUsage({ userId: userA, role: 'partner', orgId: null }, {})
    } catch (error) {
      controllerBlank = error
    }
    assert(
      'u31. 空白机构 fail-closed',
      blankOrg instanceof PartnerOrgRequiredError && controllerBlank instanceof ForbiddenException,
    )

    await assertHttp(prisma, { adminId, userA, userB, userBlank, orgA })
    await assertSmallSampleFloor({
      prisma, usage, cache, memberId, terminalId: termLeak, fileUrl, suffix,
    })
  } finally {
    await prisma.onModuleDestroy().catch(() => undefined)
    isolated.cleanup()
  }
}

async function assertSmallSampleFloor(input: {
  prisma: PrismaService
  usage: ConsoleScreenUsageService
  cache: ScreenSnapshotCache
  memberId: string
  terminalId: string
  fileUrl: string
  suffix: string
}): Promise<void> {
  const { prisma, usage, cache, memberId, terminalId, fileUrl, suffix } = input
  await prisma.browseLog.deleteMany()
  await prisma.favorite.deleteMany()
  await prisma.externalJumpLog.deleteMany()
  await prisma.aiServiceLog.deleteMany()
  await prisma.printTask.deleteMany()
  await prisma.scanTask.deleteMany()
  await prisma.order.deleteMany()
  await prisma.auditLog.deleteMany()
  cache.clear()

  const read = async (range: 'today' | '7d' = 'today') => {
    cache.clear()
    return usage.getAdminUsage(range, NOW)
  }
  const expiresAt = new Date('2026-02-01T00:00:00.000Z')
  const browseAt = (createdAt: Date) => ({
    endUserId: memberId,
    targetType: 'job',
    targetId: `heat_${suffix}`,
    createdAt,
    expiresAt,
  })
  await prisma.browseLog.createMany({
    data: Array.from({ length: 7 }, (_, day) => browseAt(new Date(DAY7_START.getTime() + day * 86_400_000 + 4 * 3_600_000))),
  })
  let heat = opened((await read()).metrics.heat7d)
  assert(
    'u42. 每天 04:00 各 1 次时格子和峰值都是 null，最后一行仍是今天',
    heat?.days.length === 7
      && heat.days.every((day) => day.hours[4] === null)
      && heat.days.every((day) => day.hours.every((hour) => hour === null))
      && heat.peakHour === null
      && heat.days[heat.days.length - 1]?.date === shanghaiDayKey(NOW),
  )
  await prisma.browseLog.createMany({
    data: Array.from({ length: 5 }, () => browseAt(new Date('2026-01-15T02:00:00.000Z'))),
  })
  heat = opened((await read()).metrics.heat7d)
  assert(
    'u43. 04:00 原始合计为 7 也不当峰值，峰值只来自可见的 10 点',
    heat?.days.every((day) => day.hours[4] === null)
      && heat.days.find((day) => day.date === shanghaiDayKey(NOW))?.hours[10] === 5
      && heat.peakHour === 10,
  )
  await prisma.browseLog.deleteMany()
  const aiOf = (snap: ScreenUsageSnapshot) => opened(snap.metrics.ai)
  const stepsOf = (snap: ScreenUsageSnapshot) => opened(snap.metrics.printSteps)
  const resumeOf = (snap: ScreenUsageSnapshot) => opened(snap.metrics.resumeSteps)
  let seq = 0
  const nextId = (prefix: string) => `${prefix}_${seq += 1}_${suffix}`

  const printRow = (completedAt: Date) => ({
    id: nextId('edge_print'),
    terminalId,
    fileUrl,
    fileMd5: 'md5',
    status: 'completed',
    completedAt,
    printOutcome: null,
    createdAt: completedAt,
    updatedAt: completedAt,
  })
  await prisma.printTask.create({ data: printRow(NOW) })
  let snap = await read()
  assert(
    'u44. 当天只完成 1 次打印时，结果和步骤都是 null',
    opened(snap.metrics.outcomes)?.printed === null && stepsOf(snap)?.printed === null,
  )
  await prisma.printTask.createMany({ data: [printRow(NOW), printRow(NOW), printRow(NOW)] })
  snap = await read()
  assert(
    'u45. 出纸 4 次时两处仍都是 null',
    opened(snap.metrics.outcomes)?.printed === null && stepsOf(snap)?.printed === null,
  )
  await prisma.printTask.create({ data: printRow(NOW) })
  snap = await read()
  assert(
    'u46. 出纸 5 次时两处都是 5',
    opened(snap.metrics.outcomes)?.printed === 5 && stepsOf(snap)?.printed === 5,
  )

  const paidRow = (paidAt: Date) => ({
    orderNo: nextId('edge_order'),
    payStatus: 'paid',
    channel: 'kiosk',
    paidAt,
    endUserId: null,
    createdAt: paidAt,
    amountCents: 100,
  })
  await prisma.order.createMany({ data: [paidRow(NOW), paidRow(NOW), paidRow(NOW), paidRow(NOW)] })
  snap = await read()
  assert(
    'u47. 已支付订单 4 笔时，渠道总数和打印步骤都是 null',
    opened(snap.metrics.channels)?.paidOrders === null && stepsOf(snap)?.paid === null,
  )
  await prisma.order.create({ data: paidRow(NOW) })
  snap = await read()
  assert(
    'u48. 已支付订单 5 笔时，渠道总数和打印步骤都是 5',
    opened(snap.metrics.channels)?.paidOrders === 5 && stepsOf(snap)?.paid === 5,
  )

  const aiRow = (seed: AiSeed) => ({ ...seed, terminalId })
  const seedAi = (count: number, seed: AiSeed) => prisma.aiServiceLog.createMany({
    data: Array.from({ length: count }, () => aiRow(seed)),
  })
  const successSeed = (createdAt: Date): AiSeed => ({
    operation: 'parseResume', status: 'success', provider: 'llm:deepseek',
    estimatedCostCny: 1.5, latencyMs: 100, createdAt,
  })
  await seedAi(4, successSeed(NOW))
  snap = await read()
  assert(
    'u49. AI 成功、总量、时延、成本和解析步骤在 4 次时都是 null',
    aiOf(snap)?.total === null
      && aiOf(snap)?.success === null
      && aiOf(snap)?.failed === null
      && aiOf(snap)?.successRate === null
      && aiOf(snap)?.avgLatencyMs === null
      && aiOf(snap)?.estimatedCostCny === null
      && aiOf(snap)?.costMeasuredCalls === null
      && aiOf(snap)?.fallbackCalls === null
      && resumeOf(snap)?.analyzed === null,
  )
  await seedAi(1, successSeed(NOW))
  snap = await read()
  assert(
    'u50. AI 成功、总量、时延、成本和解析步骤在 5 次时给出实数',
    aiOf(snap)?.total === 5
      && aiOf(snap)?.success === 5
      && aiOf(snap)?.successRate === 100
      && aiOf(snap)?.avgLatencyMs === 100
      && aiOf(snap)?.estimatedCostCny === 7.5
      && aiOf(snap)?.costMeasuredCalls === 5
      && resumeOf(snap)?.analyzed === 5,
  )

  await prisma.aiServiceLog.deleteMany()
  await seedAi(2, { ...successSeed(NOW), estimatedCostCny: null })
  await seedAi(2, { ...successSeed(NOW), status: 'failed', estimatedCostCny: null, latencyMs: null })
  await seedAi(3, { ...successSeed(NOW), operation: 'chatAssistant', status: 'running', provider: 'llm:qwen', estimatedCostCny: null, latencyMs: null })
  snap = await read()
  assert(
    'u51. 成功加失败只有 4 次时成功率为 null，哪怕总调用已经到 7',
    aiOf(snap)?.total === 7 && aiOf(snap)?.successRate === null,
  )
  await seedAi(1, { ...successSeed(NOW), estimatedCostCny: null })
  snap = await read()
  assert(
    'u52. 成功加失败达到 5 次时给出成功率，分母仍含其它状态',
    aiOf(snap)?.total === 8 && aiOf(snap)?.successRate === 37.5,
  )

  await prisma.aiServiceLog.deleteMany()
  await seedAi(4, { ...successSeed(NOW), status: 'failed', estimatedCostCny: null, latencyMs: null })
  snap = await read()
  assert('u53. 失败 4 次为 null', aiOf(snap)?.failed === null && aiOf(snap)?.total === null)
  await seedAi(1, { ...successSeed(NOW), status: 'failed', estimatedCostCny: null, latencyMs: null })
  snap = await read()
  assert('u54. 失败 5 次为 5', aiOf(snap)?.failed === 5 && aiOf(snap)?.total === 5)

  await prisma.aiServiceLog.deleteMany()
  const fallbackSeed: AiSeed = {
    operation: 'voiceSynthesize', status: 'running', provider: 'stub',
    estimatedCostCny: null, latencyMs: null, createdAt: NOW,
  }
  await seedAi(4, fallbackSeed)
  snap = await read()
  assert('u55. 兜底调用 4 次为 null', aiOf(snap)?.fallbackCalls === null)
  await seedAi(1, fallbackSeed)
  snap = await read()
  assert('u56. 兜底调用 5 次为 5', aiOf(snap)?.fallbackCalls === 5)

  await prisma.aiServiceLog.deleteMany()
  const optimized: AiSeed = { ...successSeed(NOW), operation: 'optimizeResume', estimatedCostCny: null, latencyMs: null }
  await seedAi(4, optimized)
  snap = await read()
  assert('u57. 优化 4 次为 null', resumeOf(snap)?.optimized === null)
  await seedAi(1, optimized)
  snap = await read()
  assert('u58. 优化 5 次为 5', resumeOf(snap)?.optimized === 5)

  const auditRow = (createdAt: Date) => ({
    actorRole: 'admin',
    action: 'resume.diagnosis_exported',
    targetType: 'resume',
    createdAt,
    payloadJson: '{}',
  })
  await prisma.auditLog.createMany({ data: [auditRow(NOW), auditRow(NOW), auditRow(NOW), auditRow(NOW)] })
  snap = await read()
  assert('u59. 导出 4 次为 null', resumeOf(snap)?.exported === null)
  await prisma.auditLog.create({ data: auditRow(NOW) })
  snap = await read()
  assert('u60. 导出 5 次为 5', resumeOf(snap)?.exported === 5)
}

async function assertHttp(
  prisma: PrismaService,
  ids: { adminId: string; userA: string; userB: string; userBlank: string; orgA: string },
): Promise<void> {
  process.env['JWT_SECRET'] ||= 'dev-only-secret-please-replace-in-prod-min-16-chars'
  const cache = new ScreenSnapshotCache()
  @Module({
    imports: [JwtModule.register({ secret: process.env['JWT_SECRET'], signOptions: { expiresIn: '30m' } })],
    controllers: [AdminUsageController, PartnerUsageController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      ConsoleScreenUsageService,
      { provide: ScreenSnapshotCache, useValue: cache },
      JwtAuthGuard,
      RolesGuard,
      Reflector,
      { provide: RedisService, useValue: { get: async () => null, del: async () => 0, setJsonIfVersionNotOlder: async () => 'stored' as const } },
    ],
  })
  class UsageHttpModule {}

  const app = await NestFactory.create<NestExpressApplication>(UsageHttpModule, { logger: ['error'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  try {
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
    const jwt = app.get(JwtService)
    const adminToken = jwt.sign({ sub: ids.adminId, ver: 0, jti: randomUUID() })
    const partnerToken = jwt.sign({ sub: ids.userA, ver: 0, jti: randomUUID(), orgId: ids.orgA, role: 'admin' })
    const otherToken = jwt.sign({ sub: ids.userB, ver: 0, jti: randomUUID() })
    const blankToken = jwt.sign({ sub: ids.userBlank, ver: 0, jti: randomUUID() })
    const adminHeaders = { Authorization: `Bearer ${adminToken}` }
    const partnerHeaders = { Authorization: `Bearer ${partnerToken}` }

    const unauth = await fetch(`${base}/admin/screen/usage`)
    assert('u32. 无 token 为 401', unauth.status === 401, String(unauth.status))
    const badRange = await fetch(`${base}/admin/screen/usage?range=90d`, { headers: adminHeaders })
    assert('u33. 非法 range 为 400', badRange.status === 400, String(badRange.status))
    const extra = await fetch(`${base}/admin/screen/usage?range=today&orgId=${ids.orgA}`, { headers: adminHeaders })
    assert('u34. 管理员多传 orgId 为 400', extra.status === 400, String(extra.status))
    const partnerOnAdmin = await fetch(`${base}/admin/screen/usage`, { headers: partnerHeaders })
    assert('u35. 机构账号调管理员用法为 403', partnerOnAdmin.status === 403, String(partnerOnAdmin.status))
    const adminOnPartner = await fetch(`${base}/partner/screen/usage`, { headers: adminHeaders })
    assert('u36. 管理员调机构用法为 403', adminOnPartner.status === 403, String(adminOnPartner.status))
    const orgQuery = await fetch(`${base}/partner/screen/usage?orgId=${ids.orgA}`, { headers: partnerHeaders })
    assert('u37. 机构端传 orgId 查询参数为 400', orgQuery.status === 400, String(orgQuery.status))

    const adminRes = await fetch(`${base}/admin/screen/usage`, { headers: adminHeaders })
    const adminBody = await adminRes.json() as { success?: boolean; data?: { range?: string; audience?: string } }
    assert('u38. 缺省 range=today，管理员走 ApiResponse', adminRes.status === 200 && adminBody.success === true && adminBody.data?.range === 'today' && adminBody.data.audience === 'admin')

    const partnerRes = await fetch(`${base}/partner/screen/usage?range=7d`, { headers: partnerHeaders })
    const partnerBody = await partnerRes.json() as { success?: boolean; audience?: string; range?: string; metrics?: { partnerTop?: { available?: boolean; value?: { items?: Array<{ title?: string }> } } } }
    const titles = JSON.stringify(partnerBody)
    assert(
      'u39. 机构端是裸对象，JWT 里的 orgId/role 不被采信',
      partnerRes.status === 200
        && partnerBody.success === undefined
        && partnerBody.audience === 'partner'
        && partnerBody.range === '7d'
        && titles.includes('甲机构岗位')
        && !titles.includes('乙机构岗位'),
      titles.slice(0, 240),
    )
    const otherRes = await fetch(`${base}/partner/screen/usage?range=7d`, { headers: { Authorization: `Bearer ${otherToken}` } })
    const otherBody = await otherRes.text()
    assert('u40. 另一家机构看不到甲的标题', otherRes.status === 200 && otherBody.includes('乙机构岗位') && !otherBody.includes('甲机构岗位'), otherBody.slice(0, 240))
    const blankRes = await fetch(`${base}/partner/screen/usage`, { headers: { Authorization: `Bearer ${blankToken}` } })
    assert('u41. 未绑定机构的账号为 401', blankRes.status === 401, String(blankRes.status))
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  console.log('\n=== console screen usage 契约 ===\n')
  assertSourceContract()
  const anchor = usageWindow('today', NOW)
  assert(
    'u0. 独立算出的上海零点与 usageWindow 一致',
    anchor.from.toISOString() === '2026-01-14T16:00:00.000Z' && shanghaiDayKey(NOW) === '2026-01-15',
  )
  await assertBehavior()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:console-screen-usage FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:console-screen-usage PASSED')
}

main().catch((error: unknown) => {
  console.error('\n❌ verify:console-screen-usage 执行异常')
  console.error(error)
  process.exit(1)
})
