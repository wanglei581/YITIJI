import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { type ScreenMetric, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { randomUUID } from 'node:crypto'
import { Prisma, PrintFixture } from './console-screen-printed-visits-cases-04'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { loadPrintCumulativeSlice } from '../src/console-screen/console-screen.queries'
import { loadPrintedPagesTotal, taskCopies } from '../src/console-screen/console-screen.printed-pages'



export let passed = 0

export let failed = 0

export function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed += 1
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed += 1
  }
}


export function prepareDatabase(): { cleanup: () => void } {
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


export function metricValue(metric: ScreenMetric<number> | undefined): number | string {
  if (!metric) return 'missing'
  return metric.available ? metric.value : `unavailable:${metric.reason}`
}


export function isValue(metric: ScreenMetric<number> | undefined, expected: number): boolean {
  return metric?.available === true && metric.value === expected
}


export function isBelowThreshold(metric: ScreenMetric<number> | undefined): boolean {
  return metric?.available === false
    && metric.reason === SCREEN_UNAVAILABLE_REASON.sampleBelowThreshold
    && !('value' in metric)
}


export async function createSingleFilePrint(prisma: Prisma, terminalId: string, tag: string, fx: PrintFixture): Promise<string> {
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


export async function assertPrintedPages(prisma: Prisma, screen: ConsoleScreenService, cache: ScreenSnapshotCache, terminalId: string): Promise<void> {
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
