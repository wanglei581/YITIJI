// 后台「AI 当日用量」只读汇总（GET /admin/ai-usage/daily）。
//
// 字段白名单：只给维度键（功能 / 厂商 / 终端号 / 机构号）、调用数、未计量数、金额，
// 以及三档上限与是否触顶。**不含会员号**，会员只给人数与触顶人数。
// 不含任何正文、型号以外的配置、URL。

import type { PrismaService } from '../../prisma/prisma.service'
import { roundMoney } from './ai-pricing'
import type { AiBudgetLimits } from './ai-budget.service'

export interface AiUsageBucket {
  /** 维度值；终端 / 机构维度下 null 表示「无已验签终端」/「无所属机构」。 */
  key: string | null
  calls: number
  /** 取不到用量的调用数（金额按保守单价计入 chargedCostCny）。 */
  unmeasuredCalls: number
  /** 只含实测金额。 */
  measuredCostCny: number
  /** 计入额度的金额 = 实测 + 未计量 × 保守单价。 */
  chargedCostCny: number
}

export interface AiUsageDailySummary {
  day: string
  limits: AiBudgetLimits
  totals: AiUsageBucket & { memberCount: number }
  reached: { global: boolean; terminalIds: string[]; memberCount: number }
  byFeature: AiUsageBucket[]
  byVendor: AiUsageBucket[]
  byTerminal: AiUsageBucket[]
  byOrg: AiUsageBucket[]
}

interface Row {
  featureKey: string
  vendor: string
  terminalId: string | null
  orgId: string | null
  endUserId: string | null
  costCny: number | null
  costMeasured: boolean
}

function emptyBucket(key: string | null): AiUsageBucket {
  return { key, calls: 0, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0 }
}

function add(bucket: AiUsageBucket, row: Row, unit: number): void {
  bucket.calls += 1
  if (row.costMeasured && row.costCny !== null) {
    bucket.measuredCostCny += row.costCny
    bucket.chargedCostCny += row.costCny
  } else {
    bucket.unmeasuredCalls += 1
    bucket.chargedCostCny += unit
  }
}

function finish(map: Map<string | null, AiUsageBucket>): AiUsageBucket[] {
  return [...map.values()]
    .map((bucket) => ({ ...bucket, measuredCostCny: roundMoney(bucket.measuredCostCny), chargedCostCny: roundMoney(bucket.chargedCostCny) }))
    .sort((a, b) => b.chargedCostCny - a.chargedCostCny || b.calls - a.calls)
}

export async function buildAiUsageDailySummary(prisma: PrismaService, day: string, limits: AiBudgetLimits): Promise<AiUsageDailySummary> {
  const rows: Row[] = await prisma.aiUsageRecord.findMany({
    where: { dayKey: day },
    select: { featureKey: true, vendor: true, terminalId: true, orgId: true, endUserId: true, costCny: true, costMeasured: true },
  })
  const unit = limits.unmeasuredCallCostCny
  const total = emptyBucket(null)
  const dims = { feature: new Map<string | null, AiUsageBucket>(), vendor: new Map<string | null, AiUsageBucket>(), terminal: new Map<string | null, AiUsageBucket>(), org: new Map<string | null, AiUsageBucket>() }
  const members = new Map<string, number>()
  const bucketOf = (map: Map<string | null, AiUsageBucket>, key: string | null) => {
    let bucket = map.get(key)
    if (!bucket) { bucket = emptyBucket(key); map.set(key, bucket) }
    return bucket
  }
  for (const row of rows) {
    add(total, row, unit)
    add(bucketOf(dims.feature, row.featureKey), row, unit)
    add(bucketOf(dims.vendor, row.vendor), row, unit)
    add(bucketOf(dims.terminal, row.terminalId), row, unit)
    add(bucketOf(dims.org, row.orgId), row, unit)
    if (row.endUserId) members.set(row.endUserId, (members.get(row.endUserId) ?? 0) + (row.costMeasured && row.costCny !== null ? row.costCny : unit))
  }
  const byTerminal = finish(dims.terminal)
  return {
    day,
    limits: { ...limits },
    totals: { ...total, measuredCostCny: roundMoney(total.measuredCostCny), chargedCostCny: roundMoney(total.chargedCostCny), memberCount: members.size },
    reached: {
      global: roundMoney(total.chargedCostCny) >= limits.globalCny,
      terminalIds: byTerminal.filter((bucket) => bucket.key !== null && bucket.chargedCostCny >= limits.terminalCny).map((bucket) => bucket.key as string),
      memberCount: [...members.values()].filter((spent) => roundMoney(spent) >= limits.memberCny).length,
    },
    byFeature: finish(dims.feature),
    byVendor: finish(dims.vendor),
    byTerminal,
    byOrg: finish(dims.org),
  }
}
