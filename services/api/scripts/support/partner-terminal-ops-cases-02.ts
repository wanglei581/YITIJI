import { verifyOutputPrivacy } from './partner-terminal-privacy-cases'
import { HeartbeatFolder, TERMINAL_OPS_OFFLINE_GAP_MS, successRate, summarizeFaults, summarizeOutput, suppressCount, terminalOpsEffectiveFrom, terminalOpsHeartbeatSeedRange } from '../../src/orgs/partner-terminal-ops'
import { Assert, MIN } from './partner-terminal-ops-cases-04'
import { randomUUID } from 'crypto'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PartnerStatsService } from '../../src/orgs/partner-stats.service'
import { type PartnerOrgId } from '../../src/console-screen/console-screen.org'
import { verifyStaticAndQuery, verifyFailClosed } from './partner-terminal-ops-cases-01'



export function verifyPure(assert: Assert): void {
  assert(
    'T3a. 小样本压制 0→0、1→null、4→null、5→5',
    suppressCount(-1) === 0 && suppressCount(0) === 0 && suppressCount(1) === null && suppressCount(4) === null && suppressCount(5) === 5 && suppressCount(12) === 12,
  )
  const four = summarizeOutput([{ status: 'completed', printOutcome: null, errorCode: null, count: 4 }])
  const five = summarizeOutput([{ status: 'completed', printOutcome: null, errorCode: null, count: 5 }])
  verifyOutputPrivacy(assert)
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
    mixed.settled === 7 && mixed.printed === 4 && mixed.unconfirmed === 2 && successRate(mixed) === null,
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


export async function verifyTerminalOperationsSetup(
  assert: Assert,
  prisma: PrismaService,
  bannedKeys: readonly string[],
){
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
const periodEnd = new Date(new Date(now.getTime() + 8 * 3600000).setUTCHours(0, 0, 0, 0) - 8 * 3600000)
const ago = (minutes: number) => new Date(periodEnd.getTime() - minutes * MIN)
async function cleanup(): Promise<void> {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.kioskSession.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.printTask.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } })
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }
return { assert, prisma, bannedKeys, service, suffix, orgA, orgB, ta1, ta2, ta3, tb1, terminalIds, now, periodEnd, ago, cleanup }
}
