import { randomUUID } from 'node:crypto'
import { PRINTED_PAGES_BY_COMPLETION_SOURCE, PRINTED_PAGES_SOURCE, loadPrintedPagesTrend, loadTerminalPrintedPagesToday } from '../src/console-screen/console-screen.printed-pages'
import { shanghaiDayKey, shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { assert } from './console-screen-printed-visits-cases-01'
import { createDayPrint, trendDayPages, assertPrintedDayBucketsSetup } from './console-screen-printed-visits-cases-02'
import { carryContext, Prisma } from './console-screen-printed-visits-cases-04'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'



export async function assertPrintedDayBucketsPhase1(context: Awaited<ReturnType<typeof assertPrintedDayBucketsSetup>>) {
const { prisma, screen, cache, orgId } = context
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
      const previous = before.days.find((item) => item.date === day.date)
      return previous !== undefined && previous.pages === day.pages
    })
assert(
    'd3. 其余 12 天没有新增页数，趋势始终是 14 个上海自然日',
    otherDaysSame && after.days.length === 14,
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
return carryContext(context, { now, dayStart, nextMidnight, todayAt, yesterdayAt, todayKey, yesterdayKey, before, todayBefore, yesterdayBefore, termT, termU, termV, aPages, bPages, multiPages, pkgPages, eodPages, uPages, vPages, terminalT, todayDelta, yesterdayDelta, after, todayAfter, yesterdayAfter, otherDaysSame, directT, directU, directV, adminT, partnerT, adminU, adminV, partnerV, gov, loaded, partner })
}


export async function assertPrintedDayBucketsPhase2(context: Awaited<ReturnType<typeof assertPrintedDayBucketsPhase1>>) {
const { prisma, now, partner } = context
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
return carryContext(context, { cappedTrend, openTrend, twinSrc, assembleSrc })
}


export async function assertPrintedDayBuckets(
  prisma: Prisma,
  screen: ConsoleScreenService,
  cache: ScreenSnapshotCache,
  orgId: string,
): Promise<void> {
const context = await assertPrintedDayBucketsSetup(prisma, screen, cache, orgId)
const phase1 = await assertPrintedDayBucketsPhase1(context)
await assertPrintedDayBucketsPhase2(phase1)

}
