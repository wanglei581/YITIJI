// ============================================================
// AI 用量分组表：按功能 / 按供应商 / 按终端 / 按机构 四个页签
//
// 数据全部来自服务端 GET /admin/ai-usage/daily 的四个桶数组：
//   - key 为 null：终端维度显示「未关联终端」、机构维度显示「未关联机构」
//     （服务端口径：无已验签终端 / 无所属机构的调用）。
//   - 金额两列分开：实测金额（只含按 token 实测折算的）与已计费金额
//     （实测 + 未计量 × 保守单价，即计入额度的口径），保留两位小数带「元」。
//   - 空维度如实显示「当日无记录」，不造数。
// ============================================================

import { type AiUsageBucket, type AiUsageDailySummary } from '../../services/api/aiUsageDaily'
import { aiUsageKeyName, formatCny, type AiUsageDimension } from './aiUsageDisplay'

type Tab = { dimension: AiUsageDimension; label: string }

const TABS: readonly Tab[] = [
  { dimension: 'feature', label: '按功能' },
  { dimension: 'vendor', label: '按供应商' },
  { dimension: 'terminal', label: '按终端' },
  { dimension: 'org', label: '按机构' },
]

const TAB_BTN =
  'min-h-12 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'

interface BreakdownProps {
  summary: AiUsageDailySummary
  tab: AiUsageDimension
  onTabChange: (tab: AiUsageDimension) => void
}

export function AiUsageBreakdownTable({ summary, tab, onTabChange }: BreakdownProps) {
  const bucketsOf = (dimension: AiUsageDimension): AiUsageBucket[] => {
    switch (dimension) {
      case 'feature': return summary.byFeature
      case 'vendor': return summary.byVendor
      case 'terminal': return summary.byTerminal
      case 'org': return summary.byOrg
    }
  }
  const rows = bucketsOf(tab)
  const active = TABS.find((entry) => entry.dimension === tab) ?? TABS[0]

  return (
    <div className="mt-4">
      <div role="tablist" aria-label="AI 用量分组" className="flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.dimension}
            type="button"
            role="tab"
            id={`ai-usage-tab-${entry.dimension}`}
            aria-selected={entry.dimension === tab}
            onClick={() => onTabChange(entry.dimension)}
            className={`${TAB_BTN} ${
              entry.dimension === tab
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-neutral-200 bg-surface text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-labelledby={`ai-usage-tab-${active.dimension}`} className="mt-3 min-w-0 max-w-full overflow-x-auto rounded-lg border border-neutral-100">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b border-neutral-100 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{active.label.slice(1)}</th>
              <th className="px-4 py-3 text-right font-medium">调用次数</th>
              <th className="px-4 py-3 text-right font-medium">未计量次数</th>
              <th className="px-4 py-3 text-right font-medium">实测金额</th>
              <th className="px-4 py-3 text-right font-medium">已计费金额（计入额度）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  {summary.day} 当日该维度没有调用记录
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key ?? '__unassigned__'} className="hover:bg-neutral-50/50">
                  <td className="px-4 py-3 text-neutral-700">
                    {aiUsageKeyName(tab, row.key)}
                    {row.key !== null && aiUsageKeyName(tab, row.key) !== row.key && (
                      <span className="ml-1.5 font-mono text-xs text-neutral-400">{row.key}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-700">{row.calls}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-500">{row.unmeasuredCalls}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-500">{formatCny(row.measuredCostCny)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-neutral-800">{formatCny(row.chargedCostCny)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
        已计费金额 = 实测金额 + 未计量次数 × 保守单价 {formatCny(summary.limits.unmeasuredCallCostCny)}/次。「未关联终端」= 这次调用没有已验签终端（没带终端身份，或验签没通过，终端号不入账）。「未关联机构」= 没写入机构：未验签的调用不记机构，已验签但终端当时不属于任何机构的也记在这里。
      </p>
    </div>
  )
}
