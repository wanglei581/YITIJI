/**
 * GET /partner/terminal-operations 的门禁用例（由 verify-partner-stats-contract.ts 调用）。
 *
 * 覆盖：机构隔离、查询参数白名单、未绑定机构 fail-closed、响应键全集、
 * 小样本压制、出纸成功率分子分母、未确认数、重试只算一次、离线 / 打印机故障折叠。
 */
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PartnerStatsController, PartnerStatsQueryDto } from '../../src/orgs/partner-stats.controller'
import { PartnerStatsService } from '../../src/orgs/partner-stats.service'
import { PartnerOrgRequiredError, type PartnerOrgId } from '../../src/console-screen/console-screen.org'
import type { AuthedUser } from '../../src/common/decorators/current-user.decorator'
import {
  HeartbeatFolder,
  TERMINAL_OPS_OFFLINE_GAP_MS,
  successRate,
  summarizeFaults,
  summarizeOutput,
  suppressCount,
  terminalOpsEffectiveFrom,
  terminalOpsHeartbeatSeedRange,
} from '../../src/orgs/partner-terminal-ops'
import { verifyTerminalRebindIsolation } from './partner-terminal-rebind-cases'

type Assert = (label: string, condition: boolean, detail?: string) => void

const MIN = 60_000

/** 响应里允许出现的全部键路径；多一个少一个都算失败。 */
const OUTPUT_KEYS = ['printed', 'settled', 'successRate', 'unconfirmed']
const TOTAL_FAULT_KEYS = [
  'offlineCount', 'offlineMinutes', 'printerFaultCount', 'printerFaultMinutes',
  'recoveredCount', 'avgRecoveryMinutes', 'longestMinutes',
]
const ROW_FAULT_KEYS = [...TOTAL_FAULT_KEYS, 'unrecovered', 'reportedInWindow']
export const TERMINAL_OPS_KEY_PATHS = new Set<string>([
  'period', 'timezone', 'window', 'window.from', 'window.to', 'generatedAt', 'minSample',
  'terminals',
  ...['terminalCode', 'displayName', 'locationLabel', 'online', 'lastHeartbeatAt', 'visitCount', 'serviceCount', 'output', 'faults']
    .map((key) => `terminals[].${key}`),
  ...OUTPUT_KEYS.map((key) => `terminals[].output.${key}`),
  ...ROW_FAULT_KEYS.map((key) => `terminals[].faults.${key}`),
  'totals',
  ...['terminalCount', 'onlineTerminals', 'unrecoveredTerminals', 'silentTerminals', 'visitCount', 'serviceCount', 'output', 'faults']
    .map((key) => `totals.${key}`),
  ...OUTPUT_KEYS.map((key) => `totals.output.${key}`),
  ...TOTAL_FAULT_KEYS.map((key) => `totals.faults.${key}`),
  'visitCount', 'visitCount.available', 'visitCount.recordingStarted',
  'aiAvailability', 'aiAvailability.available', 'aiAvailability.reason',
])

function collectPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, `${prefix}[]`, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      out.add(path)
      collectPaths(child, path, out)
    }
  }
  return out
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

function rejects(fn: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(fn)
    .then(() => null, (error: unknown) => error)
}

// ── T1. 源码与查询参数 ────────────────────────────────────────────────────

async function verifyStaticAndQuery(assert: Assert): Promise<void> {
  const controller = stripComments(readFileSync(join(__dirname, '../../src/orgs/partner-stats.controller.ts'), 'utf8'))
  assert(
    'T1a. 新端点 GET partner/terminal-operations 与 /partner/stats 同 controller、同守卫角色',
    controller.includes("@Get('partner/terminal-operations')")
      && /@UseGuards\(JwtAuthGuard, RolesGuard\)\s*@Roles\('partner'\)\s*export class PartnerStatsController/.test(controller),
  )
  assert(
    'T1b. 两个端点都经 requirePartnerOrgId 取机构，不再用 user.orgId! 断言非空',
    (controller.match(/scopedPartnerOrgId\(user\.orgId\)/g) ?? []).length === 2 && !controller.includes('user.orgId!'),
  )

  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED' } }),
  })
  const meta = { type: 'query' as const, metatype: PartnerStatsQueryDto }
  const codeOf = async (value: Record<string, unknown>): Promise<string | null> => {
    const error = await rejects(() => pipe.transform(value, meta))
    if (!error) return null
    const res = (error as BadRequestException).getResponse() as { error?: { code?: string } }
    return res?.error?.code ?? 'UNKNOWN'
  }
  assert('T1c. ?period=quarter 通过', (await codeOf({ period: 'quarter' })) === null)
  assert('T1d. ?orgId= 被拒成 400 VALIDATION_FAILED', (await codeOf({ period: 'week', orgId: 'org_x' })) === 'VALIDATION_FAILED')
  assert('T1e. 未知参数被拒成 400', (await codeOf({ terminalId: 't1' })) === 'VALIDATION_FAILED')
  assert('T1f. 非法 period 被拒成 400', (await codeOf({ period: 'year' })) === 'VALIDATION_FAILED')
}

// ── T2. 未绑定机构 fail-closed ────────────────────────────────────────────

async function verifyFailClosed(assert: Assert, prisma: PrismaService): Promise<void> {
  const service = new PartnerStatsService(prisma)
  const controller = new PartnerStatsController(service)
  const user = (orgId: string | null): AuthedUser => ({ userId: 'u_verify', role: 'partner', orgId })
  for (const orgId of [null, '', '   ']) {
    const error = await rejects(() => controller.getTerminalOperations(user(orgId), {}))
    const body = error instanceof ForbiddenException
      ? (error.getResponse() as { error?: { code?: string } })
      : null
    assert(
      `T2a. 账号机构为 ${JSON.stringify(orgId)} 时终端数据 403 ORG_REQUIRED`,
      body?.error?.code === 'ORG_REQUIRED',
      String(error),
    )
  }
  const statsError = await rejects(() => controller.getStats(user(null), {}))
  assert('T2b. /partner/stats 同样 403 ORG_REQUIRED', statsError instanceof ForbiddenException)
  const serviceError = await rejects(() => service.getTerminalOperations('' as PartnerOrgId, 'week'))
  assert('T2c. service 收到空机构直接拒绝，不查库', serviceError instanceof PartnerOrgRequiredError)

  // 没有绑定终端：只允许发一次按本机构过滤的终端查询，其余模型一条都不能碰。
  const calls: string[] = []
  const trap = (name: string) => new Proxy({}, {
    get: (_target, method) => () => {
      calls.push(`${name}.${String(method)}`)
      throw new Error(`不应查询 ${name}.${String(method)}`)
    },
  })
  const fake = {
    terminal: {
      findMany: async (args: { where?: { orgId?: unknown } }) => {
        calls.push(`terminal.findMany:${JSON.stringify(args.where)}`)
        return []
      },
    },
    printTask: trap('printTask'),
    scanTask: trap('scanTask'),
    terminalHeartbeat: trap('terminalHeartbeat'),
  } as unknown as PrismaService
  const empty = await new PartnerStatsService(fake).getTerminalOperations('org_no_terminals' as PartnerOrgId, 'month')
  assert(
    'T2d. 机构没有终端：只按本机构查一次终端表，任务与心跳一条都不查',
    calls.length === 1 && calls[0] === 'terminal.findMany:{"orgId":"org_no_terminals"}',
    calls.join(' | '),
  )
  assert(
    'T2e. 机构没有终端：返回空列表与全 0 合计，比率为 null',
    empty.terminals.length === 0
      && empty.totals.terminalCount === 0
      && empty.totals.serviceCount === 0
      && empty.totals.output.settled === 0
      && empty.totals.output.successRate === null
      && empty.period === 'month',
  )
}

// ── T3. 纯函数口径 ────────────────────────────────────────────────────────

function verifyPure(assert: Assert): void {
  assert(
    'T3a. 小样本压制 0→0、1→null、4→null、5→5',
    suppressCount(0) === 0 && suppressCount(1) === null && suppressCount(4) === null && suppressCount(5) === 5,
  )
  const four = summarizeOutput([{ status: 'completed', printOutcome: null, errorCode: null, count: 4 }])
  const five = summarizeOutput([{ status: 'completed', printOutcome: null, errorCode: null, count: 5 }])
  assert('T3b. 分母 4 不给比率，分母 5 给比率', successRate(four) === null && successRate(five) === 100)
  const mixed = summarizeOutput([
    { status: 'completed', printOutcome: null, errorCode: null, count: 3 },
    { status: 'failed', printOutcome: 'printed', errorCode: 'PRINT_JOB_UNCONFIRMED', count: 1 },
    { status: 'failed', printOutcome: null, errorCode: 'PRINT_JOB_UNCONFIRMED', count: 2 },
    { status: 'failed', printOutcome: 'not_printed', errorCode: 'PRINT_JOB_UNCONFIRMED', count: 1 },
    { status: 'cancelled', printOutcome: null, errorCode: null, count: 7 },
    { status: 'abandoned', printOutcome: null, errorCode: null, count: 7 },
    { status: 'pending', printOutcome: null, errorCode: null, count: 7 },
  ])
  assert(
    'T3c. 核查已出纸计入分子；cancelled / abandoned / 未结束不计；未核查的未确认单单列',
    mixed.settled === 7 && mixed.printed === 4 && mixed.unconfirmed === 2 && successRate(mixed) === 57.1,
    JSON.stringify(mixed),
  )

  const now = new Date('2026-09-20T12:00:00.000Z')
  const from = new Date('2026-09-20T00:00:00.000Z')
  const at = (minBeforeNow: number) => new Date(now.getTime() - minBeforeNow * MIN)
  const fold = (
    beats: Array<[number, string | null]>,
    seed: { at?: Date; printer?: string } = {},
  ) => {
    const folder = new HeartbeatFolder({ from, now, seedAt: seed.at ?? null, seedPrinterStatus: seed.printer ?? null })
    for (const [minutes, printerStatus] of beats) folder.push({ createdAt: at(minutes), printerStatus })
    return summarizeFaults(folder.finish(), now, folder.reportedInWindow)
  }

  const offline = fold([[120, 'ready'], [118, 'ready'], [90, 'ready'], [88, 'ready'], [2, 'ready']])
  assert(
    'T3d. 离线段：间隔 >5 分钟记一次，开始 = 前一条 +5 分钟，恢复 = 后一条（118→90 = 23 分钟，88→2 = 81 分钟）',
    offline.offlineCount === 2 && offline.offlineMinutes === 104
      && offline.recoveredCount === 2 && offline.avgRecoveryMinutes === 52 && offline.longestMinutes === 81
      && offline.unrecovered === false,
    JSON.stringify(offline),
  )
  const exactGap = fold([[20, 'ready'], [15, 'ready'], [10, 'ready'], [5, 'ready'], [0, 'ready']])
  assert('T3e. 间隔恰好 5 分钟不算离线', exactGap.offlineCount === 0 && TERMINAL_OPS_OFFLINE_GAP_MS === 5 * MIN)

  const open = fold([[60, 'ready'], [58, 'ready']])
  assert(
    'T3f. 最后一条之后一直没心跳：离线算到当前、记为未恢复（58-5=53 分钟）',
    open.offlineCount === 1 && open.offlineMinutes === 53 && open.unrecovered === true
      && open.recoveredCount === 0 && open.avgRecoveryMinutes === null,
    JSON.stringify(open),
  )

  const printer = fold([[10, 'ready'], [9, 'error'], [8, 'unknown'], [7, null], [6, 'ready'], [5, 'unknown'], [4, 'ready'], [3, 'ready'], [2, 'ready'], [1, 'ready']])
  assert(
    'T3g. 打印机故障段：从第一条异常到其后第一条正常；中间的 unknown / null 不结束它（9→6 = 3 分钟）',
    printer.printerFaultCount === 1 && printer.printerFaultMinutes === 3 && printer.offlineCount === 0,
    JSON.stringify(printer),
  )
  const unknownOnly = fold([[4, 'unknown'], [3, null], [2, 'unknown'], [1, 'ready']])
  assert('T3h. unknown / null 不开始故障段', unknownOnly.printerFaultCount === 0, JSON.stringify(unknownOnly))
  const lowPaper = fold([[4, 'low_paper'], [3, 'ready']])
  assert(
    'T3i. 纸张不足（仍可打印、需补纸）不开始故障段，也不算未恢复',
    lowPaper.printerFaultCount === 0 && lowPaper.unrecovered === false,
    JSON.stringify(lowPaper),
  )
  const lowPaperOnly = fold([[4, 'low_paper']])
  assert(
    'T3i1. 只有纸张不足：故障次数为 0，不算未恢复',
    lowPaperOnly.printerFaultCount === 0 && lowPaperOnly.unrecovered === false,
    JSON.stringify(lowPaperOnly),
  )
  const endedByLowPaper = fold([[6, 'error'], [4, 'low_paper']])
  assert(
    'T3i2. 纸张不足结束已有故障（打印机重新可打印），本身不再另计一次',
    endedByLowPaper.printerFaultCount === 1 && endedByLowPaper.unrecovered === false && endedByLowPaper.printerFaultMinutes === 2,
    JSON.stringify(endedByLowPaper),
  )
  const windowFrom = new Date('2026-09-01T00:00:00.000Z')
  const boundLater = new Date('2026-09-20T00:00:00.000Z')
  const boundEarlier = new Date('2026-08-01T00:00:00.000Z')
  assert(
    'T3m. 有效开始 = max(窗口开始, orgBoundAt)；orgBoundAt 为空按窗口开始（回填后不应再出现空值）',
    terminalOpsEffectiveFrom(windowFrom, null).getTime() === windowFrom.getTime()
      && terminalOpsEffectiveFrom(windowFrom, boundLater).getTime() === boundLater.getTime()
      && terminalOpsEffectiveFrom(windowFrom, boundEarlier).getTime() === windowFrom.getTime(),
  )
  const legacySeed = terminalOpsHeartbeatSeedRange(windowFrom, null)
  const earlierSeed = terminalOpsHeartbeatSeedRange(windowFrom, boundEarlier)
  assert(
    'T3n. 绑定不早于有效窗口时不取绑定前心跳做种子；更早的绑定只取绑定之后、窗口之前',
    terminalOpsHeartbeatSeedRange(windowFrom, boundLater) === null
      && legacySeed?.lt.getTime() === windowFrom.getTime()
      && legacySeed.gte === undefined
      && earlierSeed?.gte?.getTime() === boundEarlier.getTime()
      && earlierSeed.lt.getTime() === windowFrom.getTime(),
  )

  const seeded = fold([[710, 'ready']], { at: new Date(from.getTime() - 30 * MIN), printer: 'error' })
  // 窗口前 30 分钟有过心跳（打印机异常）→ 窗口起点到第一条窗口内心跳（+10 分钟）算离线与故障各 10 分钟；
  // 那条之后再没心跳 → 又一段离线（+15 分钟起到当前 705 分钟）。
  assert(
    'T3j. 窗口前最后一条心跳参与：跨窗口起点的离线与打印机故障都截到窗口内计',
    seeded.offlineCount === 2 && seeded.offlineMinutes === 715 && seeded.printerFaultCount === 1 && seeded.printerFaultMinutes === 10,
    JSON.stringify(seeded),
  )
  const silentSeeded = fold([], { at: new Date(from.getTime() - 60 * MIN) })
  assert(
    'T3k. 窗口前上报过、窗口内一条没有：整窗离线且未恢复，并标出窗口内从未上报',
    silentSeeded.offlineCount === 1 && silentSeeded.offlineMinutes === 720
      && silentSeeded.unrecovered === true && silentSeeded.reportedInWindow === false,
    JSON.stringify(silentSeeded),
  )
  const never = fold([])
  assert(
    'T3l. 从未上报过：不推断离线，只标出窗口内从未上报',
    never.offlineCount === 0 && never.unrecovered === false && never.reportedInWindow === false,
  )
}

// ── T4. 经 service 的端到端（真库） ────────────────────────────────────────

export async function verifyTerminalOperations(
  assert: Assert,
  prisma: PrismaService,
  bannedKeys: readonly string[],
): Promise<void> {
  console.log('\n  — /partner/terminal-operations —')
  await verifyStaticAndQuery(assert)
  await verifyFailClosed(assert, prisma)
  verifyPure(assert)

  const service = new PartnerStatsService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_pto_a_${suffix}` as PartnerOrgId
  const orgB = `org_pto_b_${suffix}` as PartnerOrgId
  const ta1 = `t_pto_a1_${suffix}`
  const ta2 = `t_pto_a2_${suffix}`
  const ta3 = `t_pto_a3_${suffix}`
  const tb1 = `t_pto_b1_${suffix}`
  const terminalIds = [ta1, ta2, ta3, tb1]
  const now = new Date()
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN)

  async function cleanup(): Promise<void> {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.kioskSession.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.printTask.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    await cleanup()
    await prisma.organization.createMany({
      data: [orgA, orgB].map((id, i) => ({
        id, name: `终端数据验证机构${i === 0 ? 'A' : 'B'}`, type: 'school_employment_center', sceneTemplate: 'school', enabled: true,
      })),
    })
    await prisma.terminal.createMany({
      data: [
        { id: ta1, orgId: orgA, name: 'A1' },
        { id: ta2, orgId: orgA, name: 'A2' },
        { id: ta3, orgId: orgA, name: 'A3' },
        { id: tb1, orgId: orgB, name: 'B1' },
      ].map((t) => ({
        id: t.id,
        terminalCode: `PTO-${t.name}-${suffix}`,
        agentToken: `pto-token-${t.id}`,
        deviceFingerprint: `pto-fp-${t.id}`,
        displayName: `验证终端${t.name}`,
        locationLabel: `验证位置${t.name}`,
        orgId: t.orgId,
      })),
    })

    const beforeVisits = await service.getTerminalOperations(orgA, 'week', now)
    const from = new Date(beforeVisits.window.from)
    assert(
      'T4k0. 一体机还没上报过会话时 recordingStarted=false，服务人次按 0 计但页面据此显示「暂无」',
      beforeVisits.visitCount.recordingStarted === false && beforeVisits.totals.visitCount === 0,
      JSON.stringify(beforeVisits.visitCount),
    )
    const task = (id: string, terminalId: string, data: Record<string, unknown>) => ({
      id: `pto_${id}_${suffix}`, terminalId, fileUrl: 'https://example.invalid/f.pdf', fileMd5: 'md5', createdAt: ago(120), ...data,
    })
    await prisma.printTask.createMany({
      data: [
        task('c1', ta1, { status: 'completed', completedAt: ago(60) }),
        task('c2', ta1, { status: 'completed', completedAt: ago(60) }),
        task('c3', ta1, { status: 'completed', completedAt: ago(60) }),
        task('c4', ta1, { status: 'failed', completedAt: ago(100), errorCode: 'PRINTER_ERROR' }),
        task('f1', ta1, { status: 'failed', completedAt: ago(60), errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'printed' }),
        task('f2', ta1, { status: 'failed', completedAt: ago(60), errorCode: 'PRINT_JOB_UNCONFIRMED' }),
        task('f3', ta1, { status: 'failed', completedAt: ago(60), errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'not_printed' }),
        task('x1', ta1, { status: 'cancelled', completedAt: ago(60) }),
        task('x2', ta1, { status: 'abandoned', completedAt: ago(60) }),
        task('p1', ta1, { status: 'failed', completedAt: ago(90), errorCode: 'PRINTER_ERROR' }),
        // 窗口前建单、窗口前结束：两项都不计
        task('o1', ta1, { status: 'completed', createdAt: new Date(from.getTime() - 24 * 60 * MIN), completedAt: new Date(from.getTime() - 23 * 60 * MIN) }),
        // 窗口前建单、窗口内结束：进出纸成功率，不进服务次数
        task('o2', ta1, { status: 'completed', createdAt: new Date(from.getTime() - 60 * MIN), completedAt: new Date(from.getTime() + 60 * MIN) }),
        ...[1, 2, 3, 4].map((n) => task(`s${n}`, ta3, { status: 'completed', completedAt: ago(30) })),
        ...[1, 2, 3, 4, 5, 6].map((n) => task(`b${n}`, tb1, { status: 'completed', completedAt: ago(30) })),
      ],
    })
    // 一体机重试：failed → pending 并清 completedAt（print-jobs.service 同款写法）；c4 之后再次出纸完成。
    const retry = { status: 'pending', claimedAt: null, claimExpiry: null, completedAt: null, errorCode: null, errorMessage: null }
    await prisma.printTask.updateMany({ where: { id: { in: [`pto_c4_${suffix}`, `pto_p1_${suffix}`] }, status: 'failed' }, data: retry })
    await prisma.printTask.update({ where: { id: `pto_c4_${suffix}` }, data: { status: 'completed', completedAt: ago(50) } })
    await prisma.scanTask.createMany({
      data: [1, 2].map((n) => ({ id: `pto_scan${n}_${suffix}`, terminalId: ta1, scanType: 'document', status: 'completed', expiresAt: ago(0), createdAt: ago(110) })),
    })
    const beats: Array<[number, string | null]> = [
      [300, 'ready'], [298, 'ready'], [296, 'ready'], [270, 'error'], [268, 'unknown'], [266, null],
      [264, 'ready'], [262, 'unknown'], [260, 'ready'], [258, 'ready'],
    ]
    await prisma.terminalHeartbeat.createMany({
      data: beats.map(([minutes, printerStatus]) => ({ terminalId: ta1, printerStatus, createdAt: ago(minutes) })),
    })
    // B：超过一批（2000 条）的心跳，走分批游标；每 30 秒一条直到刚才，在线且无离线。
    await prisma.terminalHeartbeat.createMany({
      data: Array.from({ length: 2003 }, (_, i) => ({ terminalId: tb1, printerStatus: 'ready', createdAt: new Date(now.getTime() - 10_000 - i * 30_000) })),
    })

    // 服务人次（一体机会话）：A1 6 次、A3 2 次（压制）、A1 另有 1 次快照属 B（改绑前的历史，不算给 A）、
    // A1 窗口前 1 次（不计），B1 5 次（A 看不到）。
    const visit = (terminalId: string, orgId: string, startedAt: Date) => ({
      terminalId, orgId, clientSessionId: randomUUID(), startedAt, lastActiveAt: startedAt,
      expiresAt: new Date(startedAt.getTime() + 30 * MIN), categoriesJson: '["print"]',
    })
    await prisma.kioskSession.createMany({
      data: [
        ...[1, 2, 3, 4, 5, 6].map((n) => visit(ta1, orgA, ago(40 + n))),
        ...[1, 2].map((n) => visit(ta3, orgA, ago(40 + n))),
        visit(ta1, orgB, ago(80)),
        visit(ta1, orgA, new Date(from.getTime() - 60 * MIN)),
        ...[1, 2, 3, 4, 5].map((n) => visit(tb1, orgB, ago(40 + n))),
      ],
    })

    const a = await service.getTerminalOperations(orgA, 'week', now)
    const b = await service.getTerminalOperations(orgB, 'week', now)
    const row = (code: string) => a.terminals.find((t) => t.terminalCode === `PTO-${code}-${suffix}`)
    const a1 = row('A1')
    const a2 = row('A2')
    const a3 = row('A3')

    assert(
      'T4a. 机构隔离：A 只看到自己的 3 台，B 只看到自己的 1 台',
      a.terminals.length === 3 && Boolean(a1 && a2 && a3) && !a.terminals.some((t) => t.terminalCode.includes('B1'))
        && b.terminals.length === 1 && b.terminals[0]!.terminalCode === `PTO-B1-${suffix}`,
      a.terminals.map((t) => t.terminalCode).join(','),
    )
    assert(
      'T4b. 出纸成功率：分母 8（completed + failed，窗口内结束），分子 6（含核查已出纸 1 单），75%',
      a1?.output.settled === 8 && a1?.output.printed === 6 && a1?.output.successRate === 75,
      JSON.stringify(a1?.output),
    )
    assert(
      'T4c. 未确认 1 单（压制为 null）；核查为未出纸的不算未确认',
      a1?.output.unconfirmed === null,
      JSON.stringify(a1?.output),
    )
    assert(
      'T4d. 打印扫描服务次数 = 窗口内新建的 10 个打印任务 + 2 个扫描任务，重试的任务只算一次',
      a1?.serviceCount === 12,
      String(a1?.serviceCount),
    )
    assert(
      'T4e. 4 单的终端：服务次数、分子、分母全部压制，比率不给',
      a3?.serviceCount === null && a3?.output.settled === null && a3?.output.printed === null && a3?.output.successRate === null,
      JSON.stringify(a3),
    )
    assert(
      'T4f. 0 单的终端保留 0；从未上报心跳的终端不在线、不推断离线',
      a2?.serviceCount === 0 && a2?.output.settled === 0 && a2?.online === false && a2?.lastHeartbeatAt === null
        && a2?.faults.reportedInWindow === false && a2?.faults.offlineCount === 0,
      JSON.stringify(a2),
    )
    assert(
      'T4g. 心跳折叠：离线 2 次共 274 分钟（21 已恢复 + 253 未恢复），打印机故障 1 次 6 分钟',
      a1?.faults.offlineCount === 2 && a1?.faults.offlineMinutes === 274
        && a1?.faults.printerFaultCount === 1 && a1?.faults.printerFaultMinutes === 6
        && a1?.faults.recoveredCount === 2 && a1?.faults.avgRecoveryMinutes === 13.5
        && a1?.faults.longestMinutes === 253 && a1?.faults.unrecovered === true,
      JSON.stringify(a1?.faults),
    )
    assert(
      'T4h. 当前状态：最后心跳 258 分钟前 → 不在线',
      a1?.online === false && a1?.lastHeartbeatAt === ago(258).toISOString(),
    )
    assert(
      'T4i. 合计先求和再压制与算比率：服务 16 次，分母 12、分子 10、83.3%',
      a.totals.terminalCount === 3 && a.totals.serviceCount === 16
        && a.totals.output.settled === 12 && a.totals.output.printed === 10 && a.totals.output.successRate === 83.3
        && a.totals.unrecoveredTerminals === 1 && a.totals.silentTerminals === 2 && a.totals.onlineTerminals === 0,
      JSON.stringify(a.totals),
    )
    assert(
      'T4j. 超过一批的心跳分批读完：B 在线、无离线、分子分母只含 B 自己的 6 单',
      b.terminals[0]!.online === true && b.terminals[0]!.faults.offlineCount === 0
        && b.terminals[0]!.output.settled === 6 && b.totals.output.settled === 6,
      JSON.stringify(b.terminals[0]),
    )
    assert(
      'T4k. 服务人次按会话数：A1 6 次、A2 0、A3 2 次压制为 null、合计 8；快照属 B 与窗口外的不算；B 只看到自己的 5 次',
      a.visitCount.available === true && a.visitCount.recordingStarted === true && a1?.visitCount === 6 && a2?.visitCount === 0 && a3?.visitCount === null
        && a.totals.visitCount === 8 && b.terminals[0]!.visitCount === 5 && b.totals.visitCount === 5,
      JSON.stringify({ a1: a1?.visitCount, a2: a2?.visitCount, a3: a3?.visitCount, total: a.totals.visitCount, b: b.totals.visitCount }),
    )
    assert(
      'T4k2. AI 可用率如实标为不可用',
      a.aiAvailability.available === false && a.aiAvailability.reason.length > 0,
    )
    assert(
      'T4l. 窗口到当前为止，时区由服务端声明，最小样本 5',
      a.window.to === now.toISOString() && a.timezone === 'Asia/Shanghai' && a.minSample === 5
        && new Date(a.window.from).getTime() < now.getTime(),
    )

    const actual = collectPaths(JSON.parse(JSON.stringify(a)))
    const extra = [...actual].filter((path) => !TERMINAL_OPS_KEY_PATHS.has(path))
    const missing = [...TERMINAL_OPS_KEY_PATHS].filter((path) => !actual.has(path))
    assert(
      'T4m. 响应键全集 = 白名单（递归比对，多一个少一个都不行）',
      extra.length === 0 && missing.length === 0,
      `多出 ${extra.join(',') || '无'}；缺少 ${missing.join(',') || '无'}`,
    )
    const keys = terminalOpsKeys(a)
    const hit = bannedKeys.filter((key) => keys.has(key))
    assert('T4n0. 响应不含 3j/3k 禁用键与机构、终端内部、单据字段', hit.length === 0 && bannedKeys.length > 10, hit.join(','))
    const serialized = JSON.stringify(a)
    assert(
      'T4n. 响应里没有机构 id、终端内部 id 与任务 id',
      !serialized.includes(orgA) && !serialized.includes(ta1) && !serialized.includes(`pto_c1_${suffix}`),
    )
  } finally {
    await cleanup()
  }

  await verifyTerminalRebindIsolation(assert, prisma)
}

function terminalOpsKeys(value: unknown): Set<string> {
  const keys = new Set<string>()
  for (const path of collectPaths(value)) keys.add(path.split('.').pop()!.replace('[]', ''))
  return keys
}
