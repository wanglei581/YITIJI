/**
 * 大屏与服务调用里的「服务人次」读取侧（走查 W-69，9/29）。
 *
 * 为什么单独一个文件：写入侧（#1065，kiosk-session 模块）已经是真写，但读取侧四处
 * （政务版快照 visitCount、机构快照 visitCount、服务调用 visits、单台孪生 today.visits）
 * 一直写死「未接入」。四处共用同一口径和同一套小样本规则，分散写进 assemble / usage.service /
 * twin 三个文件会出现三份口径；usage.service.ts 已近 500 行，也不宜再加。
 *
 * 口径（与 kiosk-session.types.ts、current-progress 2026-09-29 条目一致）：
 *   - 服务人次 = 窗口内 start 成功的一体机会话数（KioskSession.startedAt 落在 [from, to)）。
 *     是「会话数」不是「自然人数」；没收到 end 的照样计数。
 *   - 管理员：全部终端。机构：只数机构快照为本机构、且终端当前仍属本机构的会话
 *     （复用 countKioskVisitsByTerminal，终端改绑不带走历史）。单台：只数该终端；
 *     机构看单台时同样要求快照为本机构。
 *   - 小样本：面向机构的数、服务调用里的数、单台的数，大于 0 且小于 5 时不给数，
 *     标「少于 5」（原因码 sample_below_threshold，界面显示「少于 5」）（与这些页面其它计数的最小聚合口径一致）；0 就是 0。
 *     政务版整体快照与同屏「累计打印」「AI 调用」一样给原数。
 *   - 原始记录只保留 180 天（KIOSK_SESSION_RETENTION_DAYS），因此不提供「累计服务人次」。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { countKioskVisitsByTerminal } from '../kiosk-session/kiosk-session.queries'
import { SCREEN_MIN_AGGREGATE_SAMPLE, SCREEN_UNAVAILABLE_REASON, type ScreenMetric } from './console-screen.types'
import { availableMetric, unavailableMetric } from './console-screen.metric'

export const VISIT_SOURCE = 'KioskSession.startedAt'
/** 快照与单台的服务人次窗口：上海自然日零点到现在。 */
export const VISIT_DAY_WINDOW = 'shanghai-day'

export type VisitLoaded = { ok: true; value: number } | { ok: false; reason: string }

export async function countAllVisits(
  prisma: Pick<PrismaService, 'kioskSession'>,
  from: Date,
  to: Date,
): Promise<number> {
  return prisma.kioskSession.count({ where: { startedAt: { gte: from, lt: to } } })
}

export async function countOrgVisits(
  prisma: Pick<PrismaService, 'kioskSession' | 'terminal'>,
  orgId: string,
  from: Date,
  to: Date,
): Promise<number> {
  if (!orgId.trim()) return 0
  const terminals = await prisma.terminal.findMany({ where: { orgId }, select: { id: true } })
  const byTerminal = await countKioskVisitsByTerminal(prisma, {
    orgId,
    terminalIds: terminals.map((terminal) => terminal.id),
    from,
    to,
  })
  let total = 0
  for (const count of byTerminal.values()) total += count
  return total
}

/** 单台。expectedOrgId 非空（机构视角）时只数快照为该机构的会话。 */
export async function countTerminalVisits(
  prisma: Pick<PrismaService, 'kioskSession'>,
  terminalId: string,
  expectedOrgId: string | null,
  from: Date,
  to: Date,
): Promise<number> {
  return prisma.kioskSession.count({
    where: {
      terminalId,
      ...(expectedOrgId !== null ? { orgId: expectedOrgId } : {}),
      startedAt: { gte: from, lt: to },
    },
  })
}

/** 取数失败如实标「本次没有取到」；suppressSmall 时 1–4 标「少于 5」。 */
export function visitMetric(loaded: VisitLoaded, window: string, suppressSmall: boolean): ScreenMetric<number> {
  if (!loaded.ok) return unavailableMetric(VISIT_SOURCE, window, loaded.reason)
  const count = loaded.value
  if (suppressSmall && count > 0 && count < SCREEN_MIN_AGGREGATE_SAMPLE) {
    return unavailableMetric(VISIT_SOURCE, window, SCREEN_UNAVAILABLE_REASON.sampleBelowThreshold)
  }
  return availableMetric(VISIT_SOURCE, window, count)
}
