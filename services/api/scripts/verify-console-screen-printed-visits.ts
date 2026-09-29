/**
 * 数据大屏两处口径（走查 W-68 / W-69，9/29）。
 *
 * W-68「累计打印页数」：只计真正出纸的任务（completed，或「未确认出纸」经核查为 printed），
 *   页数 = 计费页数（材料包行优先，其次单文件订单）× Agent 执行的份数。
 *   失败 / 取消 / 未派发 / 进行中 / 核查为未出纸 / 没有可信页数的任务都不算；不看订单后来是否退款。
 *   走查现场：旧口径（已支付订单内容页之和）读出 12 页，实际出纸 15 张。
 *
 * 趋势与单台「今日打印页数」与累计同一口径：只计已出纸，页数 = 计费页 × 份数，
 *   按 PrintTask.completedAt 落入上海自然日（与北京时间同一东八区）。
 *   跨过零点的任务记在完成那天；付了款但没出纸、没有完成时间的，不进任何一天。
 *
 * W-69「服务人次」：一体机会话已真写入（#1065），读取侧不能再写死「未接入」。
 *   政务版快照、机构快照、服务调用（管理员 / 机构）、单台孪生（管理员 / 机构）六处都按
 *   KioskSession.startedAt 计数；机构只数快照为本机构且终端仍属本机构的；1–4 标样本不足。
 *
 * 为什么是新文件：verify-console-screen-snapshot.ts（2700+ 行）与 verify-console-screen-usage.ts
 * （1200+ 行）都已超 1000 行，只减不增；它们里与旧口径冲突的钉子已就地改写、不加行。
 *
 * 始终自建 OS 临时 SQLite + prisma migrate deploy，不读写 prisma/dev.db。
 *
 * Run: pnpm --filter @ai-job-print/api verify:console-screen-printed-visits
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { loadPrintCumulativeSlice } from '../src/console-screen/console-screen.queries'
import {
  PRINTED_PAGES_BY_COMPLETION_SOURCE,
  PRINTED_PAGES_SOURCE,
  loadPrintedPagesTotal,
  loadPrintedPagesTrend,
  loadTerminalPrintedPagesToday,
  taskCopies,
} from '../src/console-screen/console-screen.printed-pages'
import { visitMetric } from '../src/console-screen/console-screen.visits'
import { shanghaiDayKey, shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { SCREEN_UNAVAILABLE_REASON, type ScreenMetric, type ScreenPrintTrendValue } from '../src/console-screen/console-screen.types'
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

function prepareDatabase(): { cleanup: () => void } {
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const directory = mkdtempSync(join(tmpdir(), 'verify-console-printed-visits-'))
  const databasePath = join(directory, 'verify-printed-visits.db')
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
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function metricValue(metric: ScreenMetric<number> | undefined): number | string {
  if (!metric) return 'missing'
  return metric.available ? metric.value : `unavailable:${metric.reason}`
}

function isValue(metric: ScreenMetric<number> | undefined, expected: number): boolean {
  return metric?.available === true && metric.value === expected
}

function isBelowThreshold(metric: ScreenMetric<number> | undefined): boolean {
  return metric?.available === false
    && metric.reason === SCREEN_UNAVAILABLE_REASON.sampleBelowThreshold
    && !('value' in metric)
}

type Prisma = PrismaService

interface PrintFixture {
  pages: number
  copies: unknown
  status: string
  errorCode?: string
  printOutcome?: string | null
  payStatus?: string
}

async function createSingleFilePrint(prisma: Prisma, terminalId: string, tag: string, fx: PrintFixture): Promise<string> {
  const taskId = `ptask_w68_${tag}_${randomUUID().slice(0, 8)}`
  await prisma.printTask.create({
    data: {
      id: taskId,
      terminalId,
      fileUrl: `https://internal/${taskId}`,
      fileMd5: 'sha',
      paramsJson: JSON.stringify({ copies: fx.copies, colorMode: 'black_white', billablePages: 999 }),
      status: fx.status,
      errorCode: fx.errorCode ?? null,
      printOutcome: fx.printOutcome ?? null,
      ...(fx.status === 'completed' ? { completedAt: new Date() } : {}),
    },
  })
  await prisma.order.create({
    data: {
      orderNo: `W68-${tag}-${randomUUID().slice(0, 8)}`,
      type: 'print',
      terminalId,
      printTaskId: taskId,
      amountCents: 0,
      billablePages: fx.pages,
      payStatus: fx.payStatus ?? 'paid',
      paidAt: new Date(),
      taskStatus: fx.status,
    },
  })
  return taskId
}

async function assertPrintedPages(prisma: Prisma, screen: ConsoleScreenService, cache: ScreenSnapshotCache, terminalId: string): Promise<void> {
  console.log('\n── W-68 累计打印页数 ──')
  // 走查现场：三张已支付单共 12 页；两张出纸（3 页×3 份、2 页×3 份），一张失败。
  await createSingleFilePrint(prisma, terminalId, 'a', { pages: 3, copies: 3, status: 'completed' })
  await createSingleFilePrint(prisma, terminalId, 'b', { pages: 2, copies: 3, status: 'completed' })
  await createSingleFilePrint(prisma, terminalId, 'c', { pages: 7, copies: 1, status: 'failed', errorCode: 'PRINTER_OFFLINE' })
  const oldReading = (await prisma.order.aggregate({ where: { payStatus: 'paid', billablePages: { not: null } }, _sum: { billablePages: true } }))._sum.billablePages
  cache.clear()
  const gov = await screen.getAdminSnapshot('gov')
  const walk = gov.metrics.printPagesCumulative
  assert('p0. 夹具就是走查现场：已支付订单内容页之和 = 12', oldReading === 12, String(oldReading))
  assert(
    'p1. 走查复现：政务版累计打印 = 实际出纸 15 页（3×3 + 2×3），不是 12',
    walk?.available === true && walk.value.totalPages === 15,
    walk?.available ? `totalPages=${walk.value.totalPages}` : `unavailable:${walk?.reason}`,
  )
  assert(
    'p2. 来源写明按出纸任务 × 份数，窗口 cumulative，彩色拆分仍如实未接入',
    walk?.available === true
      && walk.source.includes('PrintTask')
      && walk.source.includes('copies')
      && walk.window === 'cumulative'
      && walk.value.byColor.available === false,
    walk?.source,
  )

  // 不出纸的各种终态与中间态：一律不算。
  for (const [tag, fx] of [
    ['cancel', { pages: 4, copies: 2, status: 'cancelled' }],
    ['pending', { pages: 5, copies: 1, status: 'pending' }],
    ['claimed', { pages: 5, copies: 1, status: 'claimed' }],
    ['printing', { pages: 5, copies: 1, status: 'printing' }],
    ['unconf-no', { pages: 6, copies: 1, status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'not_printed' }],
    ['unconf-open', { pages: 6, copies: 1, status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' }],
    ['done-no', { pages: 8, copies: 1, status: 'completed', printOutcome: 'not_printed' }],
  ] as const) {
    await createSingleFilePrint(prisma, terminalId, tag, fx)
  }
  // 已支付但从未派发（没有任务）
  await prisma.order.create({
    data: { orderNo: `W68-undispatched-${randomUUID().slice(0, 8)}`, type: 'print', terminalId, billablePages: 9, payStatus: 'paid', paidAt: new Date() },
  })
  // 没有订单的出纸任务（开发环境自检任务）：没有可信页数，参数里的 pages/billablePages 不采信。
  await prisma.printTask.create({
    data: { id: `ptask_w68_seed_${randomUUID().slice(0, 8)}`, fileUrl: 'x', fileMd5: 'x', status: 'completed', paramsJson: JSON.stringify({ copies: 3, pages: 50, billablePages: 50 }) },
  })
  const afterNonPrinted = await loadPrintedPagesTotal(prisma)
  assert('p3. 取消 / 未出 / 进行中 / 核查未出纸 / 未派发 / 无可信页数都不计：仍是 15', afterNonPrinted === 15, String(afterNonPrinted))

  // 「未确认出纸」经核查为 printed：计入（2 页 × 2 份）。
  await createSingleFilePrint(prisma, terminalId, 'unconf-yes', { pages: 2, copies: 2, status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'printed' })
  // 出纸后退款：纸已经出了，计入（1 页 × 5 份）。
  await createSingleFilePrint(prisma, terminalId, 'refunded', { pages: 1, copies: 5, status: 'completed', payStatus: 'refunded' })
  // 份数缺失 / 非法：按 1 份（Agent 同样按 1 份打印）。
  await createSingleFilePrint(prisma, terminalId, 'bad-copies-0', { pages: 1, copies: 0, status: 'completed' })
  await createSingleFilePrint(prisma, terminalId, 'bad-copies-str', { pages: 1, copies: 'abc', status: 'completed' })
  const afterPrinted = await loadPrintedPagesTotal(prisma)
  assert('p4. 核查为已出纸计入、出纸后退款仍计入、非法份数按 1 份：15 + 4 + 5 + 1 + 1 = 26', afterPrinted === 26, String(afterPrinted))
  assert(
    'p5. 份数解析：正整数原样，缺失 / 0 / 负数 / 小数 / 非数字按 1，超过 99 按 99',
    taskCopies(JSON.stringify({ copies: 4 })) === 4
      && taskCopies('{}') === 1
      && taskCopies(JSON.stringify({ copies: 0 })) === 1
      && taskCopies(JSON.stringify({ copies: -2 })) === 1
      && taskCopies(JSON.stringify({ copies: 1.5 })) === 1
      && taskCopies('not json') === 1
      && taskCopies(JSON.stringify({ copies: 500 })) === 99,
  )

  // 材料包：逐行任务，页数取材料包行（5 页），不取整单（订单写 6 页且 printTaskId 指向同一任务）。
  const itemTask = `ptask_w68_pkg1_${randomUUID().slice(0, 8)}`
  const failedItemTask = `ptask_w68_pkg2_${randomUUID().slice(0, 8)}`
  await prisma.printTask.createMany({
    data: [
      { id: itemTask, terminalId, fileUrl: 'x', fileMd5: 'x', status: 'completed', paramsJson: JSON.stringify({ copies: 2 }) },
      { id: failedItemTask, terminalId, fileUrl: 'x', fileMd5: 'x', status: 'failed', paramsJson: JSON.stringify({ copies: 1 }) },
    ],
  })
  const pkg = await prisma.order.create({
    data: { orderNo: `W68-pkg-${randomUUID().slice(0, 8)}`, type: 'print', terminalId, printTaskId: itemTask, billablePages: 6, payStatus: 'paid', paidAt: new Date() },
  })
  await prisma.orderItem.createMany({
    data: [
      { orderId: pkg.id, seq: 0, fileId: 'f1', colorMode: 'black_white', duplex: 'simplex', copies: 2, billablePages: 5, amountCents: 0, status: 'completed', printTaskId: itemTask },
      { orderId: pkg.id, seq: 1, fileId: 'f2', colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 1, amountCents: 0, status: 'failed', printTaskId: failedItemTask },
    ],
  })
  // 材料包里另一个出纸行，只挂在 OrderItem 上（订单的 printTaskId 不指向它）。
  const loneItemTask = `ptask_w68_pkg3_${randomUUID().slice(0, 8)}`
  await prisma.printTask.create({
    data: { id: loneItemTask, terminalId, fileUrl: 'x', fileMd5: 'x', status: 'completed', paramsJson: JSON.stringify({ copies: 3 }), orderId: pkg.id },
  })
  await prisma.orderItem.create({
    data: { orderId: pkg.id, seq: 2, fileId: 'f3', colorMode: 'black_white', duplex: 'simplex', copies: 3, billablePages: 2, amountCents: 0, status: 'completed', printTaskId: loneItemTask },
  })
  const afterPackage = await loadPrintedPagesTotal(prisma)
  assert(
    'p6. 材料包按行计：5 页×2 份 + 2 页×3 份，失败行不计，不拿整单 6 页：26 + 10 + 6 = 42',
    afterPackage === 42,
    String(afterPackage),
  )

  const paged = await loadPrintedPagesTotal(prisma, { batchSize: 2 })
  const capped = await loadPrintedPagesTotal(prisma, { rowCap: 3, batchSize: 2 })
  const now = new Date()
  const cappedSlice = await loadPrintCumulativeSlice(prisma, now, { printedRowCap: 3 })
  const fullSlice = await loadPrintCumulativeSlice(prisma, now)
  assert('p7. 分批读取与一次读取结果一致（不漏批、不重复）', paged === 42, String(paged))
  assert(
    'p8. 出纸任务行超上限：不给算少了的累计数（capped），不影响趋势',
    capped === 'capped' && cappedSlice.pages === 'capped' && cappedSlice.trend !== 'capped',
  )
  assert(
    'p9. 快照切片与政务版一致',
    fullSlice.pages !== 'capped' && fullSlice.pages.totalPages === 42,
  )
  cache.clear()
  const govAfter = await screen.getAdminSnapshot('gov')
  assert(
    'p10. 政务版累计打印 = 42',
    govAfter.metrics.printPagesCumulative?.available === true && govAfter.metrics.printPagesCumulative.value.totalPages === 42,
  )
  const queries = readFileSync(join(__dirname, '..', 'src/console-screen/console-screen.queries.ts'), 'utf8')
  assert(
    'p11. 累计不再用已支付订单页数之和（order.aggregate 的 _sum.billablePages）',
    !/_sum:\s*\{\s*billablePages/.test(queries) && /loadPrintedPagesTotal\(/.test(queries),
  )
}

interface DayPrintInput {
  pages: number
  copies: number
  status: string
  completedAt: Date | null
  paidAt: Date | null
  printOutcome?: string | null
  errorCode?: string | null
  itemPages?: number
  itemCopies?: number
}

async function createDayPrint(prisma: Prisma, terminalId: string, tag: string, fx: DayPrintInput): Promise<void> {
  const taskId = `ptask_day_${tag}_${randomUUID().slice(0, 8)}`
  await prisma.printTask.create({
    data: {
      id: taskId,
      terminalId,
      fileUrl: `https://internal/${taskId}`,
      fileMd5: 'sha',
      paramsJson: JSON.stringify({ copies: fx.copies, colorMode: 'black_white', billablePages: 999, pages: 999 }),
      status: fx.status,
      errorCode: fx.errorCode ?? null,
      printOutcome: fx.printOutcome ?? null,
      completedAt: fx.completedAt,
    },
  })
  const order = await prisma.order.create({
    data: {
      orderNo: `DAY-${tag}-${randomUUID().slice(0, 8)}`,
      type: 'print',
      terminalId,
      printTaskId: taskId,
      amountCents: 0,
      billablePages: fx.pages,
      payStatus: 'paid',
      paidAt: fx.paidAt,
      taskStatus: fx.status,
    },
  })
  if (fx.itemPages !== undefined) {
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        seq: 0,
        fileId: `f_${tag}`,
        colorMode: 'black_white',
        duplex: 'simplex',
        copies: fx.itemCopies ?? fx.copies,
        billablePages: fx.itemPages,
        amountCents: 0,
        status: fx.status,
        printTaskId: taskId,
      },
    })
  }
}

function trendDayPages(trend: ScreenPrintTrendValue | 'capped', key: string): number | null {
  if (trend === 'capped') return null
  return trend.days.find((day) => day.date === key)?.pages ?? null
}

async function assertPrintedDayBuckets(
  prisma: Prisma,
  screen: ConsoleScreenService,
  cache: ScreenSnapshotCache,
  orgId: string,
): Promise<void> {
  console.log('\n── 趋势与单台今日：出纸完成日 × 份数 ──')
  const now = new Date()
  const dayStart = shanghaiDayStart(now)
  const nextMidnight = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const todayAt = new Date(dayStart.getTime() + 60 * 1000)
  const yesterdayAt = new Date(dayStart.getTime() - 60 * 1000)
  const todayKey = shanghaiDayKey(todayAt)
  const yesterdayKey = shanghaiDayKey(yesterdayAt)
  const before = await loadPrintedPagesTrend(prisma, now)
  const todayBefore = trendDayPages(before, todayKey)
  const yesterdayBefore = trendDayPages(before, yesterdayKey)

  const termT = `term_day_t_${randomUUID().slice(0, 8)}`
  const termU = `term_day_u_${randomUUID().slice(0, 8)}`
  const termV = `term_day_v_${randomUUID().slice(0, 8)}`
  for (const [id, tag] of [[termT, 'T'], [termU, 'U'], [termV, 'V']] as const) {
    await prisma.terminal.create({
      data: {
        id,
        terminalCode: `DAY-${tag}-${id.slice(-8)}`,
        agentToken: `tok_${id}`,
        deviceFingerprint: 'fp',
        orgId,
        enabled: true,
      },
    })
  }

  // 规格：页数 = 计费页 × 任务份数。A 昨天付款今天出纸，B 今天付款昨天出纸。
  const aPages = 3 * 2
  const bPages = 4 * 3
  const multiPages = 6 * 2
  const pkgPages = 5 * 2
  const eodPages = 7 * 1
  const uPages = 6 * 2
  const vPages = 3 * 2
  const terminalT = aPages + multiPages + pkgPages + eodPages
  const todayDelta = terminalT + uPages + vPages
  const yesterdayDelta = bPages

  await createDayPrint(prisma, termT, 'a', { pages: 3, copies: 2, status: 'completed', completedAt: todayAt, paidAt: yesterdayAt })
  await createDayPrint(prisma, termT, 'b', { pages: 4, copies: 3, status: 'completed', completedAt: yesterdayAt, paidAt: todayAt })
  await createDayPrint(prisma, termT, 'multi', { pages: 6, copies: 2, status: 'completed', completedAt: todayAt, paidAt: todayAt })
  await createDayPrint(prisma, termT, 'pkg', {
    pages: 6,
    copies: 2,
    status: 'completed',
    completedAt: todayAt,
    paidAt: todayAt,
    itemPages: 5,
    itemCopies: 9,
  })
  await createDayPrint(prisma, termT, 'eod', {
    pages: 7,
    copies: 1,
    status: 'completed',
    completedAt: new Date(nextMidnight.getTime() - 1000),
    paidAt: todayAt,
  })
  // 未出纸、或没有完成时间：不进今天，也不进昨天。
  await createDayPrint(prisma, termT, 'failed', {
    pages: 9,
    copies: 4,
    status: 'failed',
    completedAt: todayAt,
    paidAt: todayAt,
    errorCode: 'PRINTER_OFFLINE',
  })
  await createDayPrint(prisma, termT, 'not-printed', {
    pages: 8,
    copies: 2,
    status: 'completed',
    completedAt: todayAt,
    paidAt: todayAt,
    printOutcome: 'not_printed',
  })
  await createDayPrint(prisma, termT, 'cancelled', { pages: 4, copies: 2, status: 'cancelled', completedAt: todayAt, paidAt: todayAt })
  await createDayPrint(prisma, termT, 'printing', { pages: 7, copies: 3, status: 'printing', completedAt: null, paidAt: todayAt })
  await createDayPrint(prisma, termT, 'no-completed', {
    pages: 5,
    copies: 2,
    status: 'failed',
    completedAt: null,
    paidAt: todayAt,
    printOutcome: 'printed',
    errorCode: 'PRINT_JOB_UNCONFIRMED',
  })
  await createDayPrint(prisma, termT, 'next-day', {
    pages: 20,
    copies: 1,
    status: 'completed',
    completedAt: new Date(nextMidnight.getTime() + 60 * 1000),
    paidAt: todayAt,
  })
  await createDayPrint(prisma, termU, 'u', { pages: 6, copies: 2, status: 'completed', completedAt: todayAt, paidAt: todayAt })
  await createDayPrint(prisma, termV, 'v', { pages: 3, copies: 2, status: 'completed', completedAt: todayAt, paidAt: todayAt })

  const after = await loadPrintedPagesTrend(prisma, now)
  const todayAfter = trendDayPages(after, todayKey)
  const yesterdayAfter = trendDayPages(after, yesterdayKey)
  assert(
    'd1. 趋势今日增量 = 53（T 35 + U 12 + V 6）。未出纸、无完成时间、次日完成都不计；不乘份数会变成 30',
    todayBefore !== null && todayAfter !== null && todayAfter - todayBefore === todayDelta && todayDelta === 53,
    `before=${String(todayBefore)} after=${String(todayAfter)} delta=${String(todayAfter === null || todayBefore === null ? null : todayAfter - todayBefore)}`,
  )
  assert(
    'd2. 跨零点：昨天出纸今天付款记在昨天（12），今天出纸昨天付款记在今天。按付款日落日会变成昨天 6',
    yesterdayBefore !== null && yesterdayAfter !== null && yesterdayAfter - yesterdayBefore === yesterdayDelta && yesterdayDelta === 12,
    `before=${String(yesterdayBefore)} after=${String(yesterdayAfter)}`,
  )
  const otherDaysSame = after !== 'capped'
    && before !== 'capped'
    && after.days.every((day) => {
      if (day.date === todayKey || day.date === yesterdayKey) return true
      const previous = before === 'capped' ? undefined : before.days.find((item) => item.date === day.date)
      return previous !== undefined && previous.pages === day.pages
    })
  assert(
    'd3. 其余 12 天没有新增页数，趋势始终是 14 个上海自然日',
    otherDaysSame && after !== 'capped' && after.days.length === 14,
  )
  assert(
    'd4. 峰值落在今天（本夹具今天的页数多于其余各天）',
    after !== 'capped' && after.peak !== null && after.peak.date === todayKey && after.peak.pages === todayAfter,
    after === 'capped' ? 'capped' : `peak=${JSON.stringify(after.peak)}`,
  )

  const directT = await loadTerminalPrintedPagesToday(prisma, termT, now)
  const directU = await loadTerminalPrintedPagesToday(prisma, termU, now)
  const directV = await loadTerminalPrintedPagesToday(prisma, termV, now)
  cache.clear()
  const adminT = await screen.getAdminTerminalTwin(termT)
  const partnerT = await screen.getPartnerTerminalTwin(orgId, termT)
  const adminU = await screen.getAdminTerminalTwin(termU)
  const adminV = await screen.getAdminTerminalTwin(termV)
  const partnerV = await screen.getPartnerTerminalTwin(orgId, termV)
  assert(
    'd5. 单台 T 今日 = 35（3×2 + 6×2 + 材料包行 5×2 + 当天最末 7）。不乘份数是 21；按付款日会把昨天那单算进来',
    directT === terminalT
      && terminalT === 35
      && adminT.today.printPages === 35
      && partnerT.today.printPages === 35,
    `direct=${directT} admin=${String(adminT.today.printPages)} partner=${String(partnerT.today.printPages)}`,
  )
  assert(
    'd6. 单台只数自己的机器：U 今日 = 12，不会把 T 的页加进来',
    directU === uPages && uPages === 12 && adminU.today.printPages === 12,
    `direct=${directU} admin=${String(adminU.today.printPages)}`,
  )
  assert(
    'd7. 单台 V 今日 3×2 = 6。不乘份数是 3，会显示成「少于 5」',
    directV === vPages && vPages === 6 && adminV.today.printPages === 6 && partnerV.today.printPages === 6,
    `direct=${directV} admin=${String(adminV.today.printPages)} partner=${String(partnerV.today.printPages)}`,
  )

  cache.clear()
  const gov = await screen.getAdminSnapshot('gov')
  const loaded = await loadPrintedPagesTrend(prisma, new Date())
  const partner = await screen.getPartnerSnapshot(orgId)
  assert(
    'd8. 政务版趋势来源改为出纸完成日 × 份数，窗口 14d，天数与直接查询一致；累计来源不变',
    gov.metrics.printTrend14d?.available === true
      && gov.metrics.printTrend14d.source === PRINTED_PAGES_BY_COMPLETION_SOURCE
      && gov.metrics.printTrend14d.window === '14d'
      && gov.metrics.printPagesCumulative?.source === PRINTED_PAGES_SOURCE
      && loaded !== 'capped'
      && JSON.stringify(gov.metrics.printTrend14d.value.days) === JSON.stringify(loaded.days),
    gov.metrics.printTrend14d?.available ? gov.metrics.printTrend14d.source : `unavailable:${gov.metrics.printTrend14d?.reason}`,
  )
  assert(
    'd9. 机构趋势仍因订单没有机构字段而不给数，来源说明改为出纸完成日；累计来源仍是 Order',
    partner.metrics.printTrend14d?.available === false
      && partner.metrics.printTrend14d?.source === PRINTED_PAGES_BY_COMPLETION_SOURCE
      && partner.metrics.printTrend14d?.window === 'current'
      && partner.metrics.printTrend14d?.reason === SCREEN_UNAVAILABLE_REASON.missingOrgIdOnAiAndOrders
      && partner.metrics.printPagesCumulative?.source === 'Order',
    partner.metrics.printTrend14d?.source,
  )
  const cappedTrend = await loadPrintedPagesTrend(prisma, now, { rowCap: 2 })
  const openTrend = await loadPrintedPagesTrend(prisma, now)
  assert(
    'd10. 14 天出纸任务超过注入的行上限则不给趋势；默认上限内可算',
    cappedTrend === 'capped' && openTrend !== 'capped',
    `capped=${String(cappedTrend === 'capped')} open=${String(openTrend !== 'capped')}`,
  )
  const twinSrc = readFileSync(join(__dirname, '..', 'src/console-screen/console-screen.twin.ts'), 'utf8')
  const assembleSrc = readFileSync(join(__dirname, '..', 'src/console-screen/console-screen.assemble.ts'), 'utf8')
  assert(
    'd11. 单台今日走出纸函数，不再按已支付订单页数求和',
    /loadTerminalPrintedPagesToday\(/.test(twinSrc)
      && !/order\.aggregate/.test(twinSrc)
      && !/_sum:\s*\{\s*billablePages/.test(twinSrc),
  )
  assert(
    'd12. 组装处不再用已支付订单的支付时间作为趋势来源',
    !assembleSrc.includes('Order.payStatus=paid,paidAt+billablePages')
      && assembleSrc.includes('PRINTED_PAGES_BY_COMPLETION_SOURCE'),
  )
}

async function assertVisits(prisma: Prisma, screen: ConsoleScreenService, cache: ScreenSnapshotCache): Promise<void> {
  console.log('\n── W-69 服务人次 ──')
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_w69_a_${suffix}`
  const orgB = `org_w69_b_${suffix}`
  const orgZero = `org_w69_z_${suffix}`
  const termA1 = `term_w69_a1_${suffix}`
  const termA2 = `term_w69_a2_${suffix}`
  const termB = `term_w69_b_${suffix}`
  const termZ = `term_w69_z_${suffix}`
  await prisma.organization.createMany({
    data: [
      { id: orgA, name: '服务人次机构A', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
      { id: orgB, name: '服务人次机构B', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
      { id: orgZero, name: '服务人次空机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
    ],
  })
  await prisma.terminal.createMany({
    data: [
      { id: termA1, terminalCode: `W69-A1-${suffix}`, agentToken: `tok_a1_${suffix}`, deviceFingerprint: 'fp', orgId: orgA, enabled: true },
      { id: termA2, terminalCode: `W69-A2-${suffix}`, agentToken: `tok_a2_${suffix}`, deviceFingerprint: 'fp', orgId: orgA, enabled: true },
      { id: termB, terminalCode: `W69-B-${suffix}`, agentToken: `tok_b_${suffix}`, deviceFingerprint: 'fp', orgId: orgB, enabled: true },
      { id: termZ, terminalCode: `W69-Z-${suffix}`, agentToken: `tok_z_${suffix}`, deviceFingerprint: 'fp', orgId: orgZero, enabled: true },
    ],
  })
  const now = new Date()
  const dayStart = shanghaiDayStart(now)
  const today = new Date(dayStart.getTime() + Math.floor((now.getTime() - dayStart.getTime()) / 2))
  const yesterday = new Date(dayStart.getTime() - 60 * 60 * 1000)
  const sessions = (terminalId: string, orgId: string, count: number, startedAt: Date) =>
    Array.from({ length: count }, () => ({
      terminalId,
      orgId,
      clientSessionId: randomUUID(),
      startedAt,
      lastActiveAt: startedAt,
      expiresAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
    }))
  await prisma.kioskSession.createMany({
    data: [
      ...sessions(termA1, orgA, 6, today),
      ...sessions(termA2, orgA, 2, today),
      ...sessions(termB, orgB, 3, today),
      // A1 改绑前属于 B 时留下的会话：管理员计数；机构 A 不认（快照不是 A），机构 B 也不认（终端已不属 B）。
      ...sessions(termA1, orgB, 1, today),
      ...sessions(termA1, orgA, 4, yesterday),
    ],
  })

  cache.clear()
  const gov = await screen.getAdminSnapshot('gov')
  const ops = await screen.getAdminSnapshot('ops')
  const partnerA = await screen.getPartnerSnapshot(orgA)
  const partnerB = await screen.getPartnerSnapshot(orgB)
  const partnerZero = await screen.getPartnerSnapshot(orgZero)
  assert(
    'v1. 政务版服务人次 = 今日全部会话 12（6+2+3+1），不再是「会话未写入」',
    isValue(gov.metrics.visitCount, 12)
      && gov.metrics.visitCount?.window === 'shanghai-day'
      && gov.metrics.visitCount.source === 'KioskSession.startedAt',
    String(metricValue(gov.metrics.visitCount)),
  )
  assert('v2. 运营版仍不含服务人次', ops.metrics.visitCount === undefined)
  assert('v3. 机构 A 快照 = 8（只数本机构快照且终端仍属本机构）', isValue(partnerA.metrics.visitCount, 8), String(metricValue(partnerA.metrics.visitCount)))
  assert('v4. 机构 B 今日 3 人次：样本不足，不给数', isBelowThreshold(partnerB.metrics.visitCount), String(metricValue(partnerB.metrics.visitCount)))
  assert('v5. 没有会话的机构给 0（真的没有），不是未接入', isValue(partnerZero.metrics.visitCount, 0), String(metricValue(partnerZero.metrics.visitCount)))

  const usage = new ConsoleScreenUsageService(prisma, new ScreenSnapshotCache())
  const adminToday = await usage.getAdminUsage('today', now)
  const admin7d = await usage.getAdminUsage('7d', now)
  const partnerAToday = await usage.getPartnerUsage(orgA, 'today', now)
  const partnerA7d = await usage.getPartnerUsage(orgA, '7d', now)
  const partnerBToday = await usage.getPartnerUsage(orgB, 'today', now)
  assert('v6. 服务调用（管理员，今日）访问人次 = 12', isValue(adminToday.metrics.visits, 12), String(metricValue(adminToday.metrics.visits)))
  assert('v7. 服务调用（管理员，近 7 天）含昨日 = 16', isValue(admin7d.metrics.visits, 16), String(metricValue(admin7d.metrics.visits)))
  assert('v8. 服务调用（机构 A，今日）= 8', isValue(partnerAToday.metrics.visits, 8), String(metricValue(partnerAToday.metrics.visits)))
  assert('v9. 服务调用（机构 A，近 7 天）= 12', isValue(partnerA7d.metrics.visits, 12), String(metricValue(partnerA7d.metrics.visits)))
  assert('v10. 服务调用（机构 B，今日 3）样本不足', isBelowThreshold(partnerBToday.metrics.visits), String(metricValue(partnerBToday.metrics.visits)))
  assert('v11. 服务调用窗口随 range 走', adminToday.metrics.visits?.window === 'today' && admin7d.metrics.visits?.window === '7d')

  const twinAdminA1 = await screen.getAdminTerminalTwin(termA1)
  const twinPartnerA1 = await screen.getPartnerTerminalTwin(orgA, termA1)
  const twinAdminA2 = await screen.getAdminTerminalTwin(termA2)
  const twinAdminZ = await screen.getAdminTerminalTwin(termZ)
  assert('v12. 单台（管理员）A1 今日 = 7（含改绑前留下的 1 次）', isValue(twinAdminA1.today.visits, 7), String(metricValue(twinAdminA1.today.visits)))
  assert('v13. 单台（机构 A）A1 今日 = 6（只认本机构快照）', isValue(twinPartnerA1.today.visits, 6), String(metricValue(twinPartnerA1.today.visits)))
  assert('v14. 单台 A2 今日 2：样本不足', isBelowThreshold(twinAdminA2.today.visits), String(metricValue(twinAdminA2.today.visits)))
  assert('v15. 单台没有会话给 0', isValue(twinAdminZ.today.visits, 0), String(metricValue(twinAdminZ.today.visits)))

  const texts = JSON.stringify([gov, partnerA, partnerB, partnerZero, adminToday, admin7d, partnerAToday, partnerBToday, twinAdminA1, twinPartnerA1, twinAdminA2])
  assert('v16. 六处响应里不再出现「会话未写入」', !texts.includes(SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten))
  assert(
    'v17. 取数失败如实标本次没有取到，不给 0',
    (() => {
      const m = visitMetric({ ok: false, reason: SCREEN_UNAVAILABLE_REASON.sourceQueryFailed }, 'today', true)
      return m.available === false && m.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed && !('value' in m)
    })(),
  )
  const shared = readFileSync(join(__dirname, '..', '..', '..', 'packages/shared/src/types/consoleScreen.ts'), 'utf8')
  assert(
    'v18. 共享契约：visitCount / visits 放开为 ScreenMetric<number>',
    /visitCount\?: ScreenMetric<number>/.test(shared) && /visits\?: ScreenMetric<number>/.test(shared),
  )
}

async function main(): Promise<void> {
  console.log('\n=== 数据大屏：累计打印页数与服务人次 ===')
  const db = prepareDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    const cache = new ScreenSnapshotCache()
    const screen = new ConsoleScreenService(prisma, new AdminOpsService(prisma), cache)
    const orgId = `org_w68_${randomUUID().slice(0, 8)}`
    const terminalId = `term_w68_${randomUUID().slice(0, 8)}`
    await prisma.organization.create({ data: { id: orgId, name: '出纸机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true } })
    await prisma.terminal.create({ data: { id: terminalId, terminalCode: `W68-${terminalId}`, agentToken: `tok_${terminalId}`, deviceFingerprint: 'fp', orgId, enabled: true } })
    await assertPrintedPages(prisma, screen, cache, terminalId)
    await assertPrintedDayBuckets(prisma, screen, cache, orgId)
    await assertVisits(prisma, screen, cache)
  } finally {
    await prisma.onModuleDestroy()
    db.cleanup()
  }
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:console-screen-printed-visits FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:console-screen-printed-visits PASSED')
}

main().catch((error: unknown) => {
  console.error('\n❌ verify:console-screen-printed-visits 执行异常')
  console.error(error)
  process.exit(1)
})
