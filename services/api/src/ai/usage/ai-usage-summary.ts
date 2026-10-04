// 后台「AI 当日用量」只读汇总（GET /admin/ai-usage/daily）。
//
// 字段白名单：只给维度键（功能 / 厂商 / 终端号 / 机构号）、调用数、未计量数、金额，
// 以及三档上限与是否触顶。**不含会员号**，会员只给人数与触顶人数。
// 终端桶另给只读的终端编号（如 KSK-001）、机构桶另给机构名，从 Terminal / Organization 表取，
// 不推算；记录还在但终端或机构已被删除时给 null，后台照旧显示尾号。
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

export interface AiUsageTerminalBucket extends AiUsageBucket {
  /** 终端编号；key 为 null 或终端已删除时为 null。 */
  terminalCode: string | null
}

export interface AiUsageOrgBucket extends AiUsageBucket {
  /** 机构名；key 为 null 或机构已删除时为 null。 */
  orgName: string | null
}

export interface AiUsageDailySummary {
  day: string
  limits: AiBudgetLimits
  totals: AiUsageBucket & { memberCount: number }
  reached: {
    global: boolean
    terminalIds: string[]
    /** 与 terminalIds 同序，带终端编号，供后台直接显示。 */
    terminals: { terminalId: string; terminalCode: string | null }[]
    memberCount: number
  }
  byFeature: AiUsageBucket[]
  byVendor: AiUsageBucket[]
  byTerminal: AiUsageTerminalBucket[]
  byOrg: AiUsageOrgBucket[]
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
  const terminalIds = [...dims.terminal.keys()].filter((key): key is string => key !== null)
  const orgIds = [...dims.org.keys()].filter((key): key is string => key !== null)
  const [terminals, orgs] = await Promise.all([
    terminalIds.length ? prisma.terminal.findMany({ where: { id: { in: terminalIds } }, select: { id: true, terminalCode: true } }) : [],
    orgIds.length ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
  ])
  const codeOf = new Map(terminals.map((t) => [t.id, t.terminalCode]))
  const nameOf = new Map(orgs.map((o) => [o.id, o.name]))
  const byTerminal: AiUsageTerminalBucket[] = finish(dims.terminal).map((bucket) => ({ ...bucket, terminalCode: bucket.key === null ? null : codeOf.get(bucket.key) ?? null }))
  const byOrg: AiUsageOrgBucket[] = finish(dims.org).map((bucket) => ({ ...bucket, orgName: bucket.key === null ? null : nameOf.get(bucket.key) ?? null }))
  const reachedTerminals = byTerminal.filter((bucket) => bucket.key !== null && bucket.chargedCostCny >= limits.terminalCny)
  return {
    day,
    limits: { ...limits },
    totals: { ...total, measuredCostCny: roundMoney(total.measuredCostCny), chargedCostCny: roundMoney(total.chargedCostCny), memberCount: members.size },
    reached: {
      global: roundMoney(total.chargedCostCny) >= limits.globalCny,
      terminalIds: reachedTerminals.map((bucket) => bucket.key as string),
      terminals: reachedTerminals.map((bucket) => ({ terminalId: bucket.key as string, terminalCode: bucket.terminalCode })),
      memberCount: [...members.values()].filter((spent) => roundMoney(spent) >= limits.memberCny).length,
    },
    byFeature: finish(dims.feature),
    byVendor: finish(dims.vendor),
    byTerminal,
    byOrg,
  }
}
