import { formatCny } from './aiUsageDisplay'
// ============================================================
// 分能力调用量与成本（A-6，近 24 小时）—— 从 ai-services/index.tsx 拆出
//
// 上面的概览卡片只覆盖 6 个高频能力；这张表覆盖全部 operation，
// 避免职业规划 / 参会计划 / 模拟面试 / 语音这些能力的花费在 Admin 侧不可见。
//
// AI-COST-TRUTH：costByOperation 是三态结构（measuredCalls / calls），
// tokenBilled 只说明「这个能力应该按 token 计费」，说明不了「成本采到了没有」——
// costState 才是展示依据；未采集绝不显示 ¥0（那等于谎称免费）。
// ============================================================

import { Card } from '@ai-job-print/ui'
import { formatCount } from '@ai-job-print/shared'
import type { AdminAiUsage, AiOperation } from '../../services/api'
import { NON_TOKEN_BILLED_NOTE, NON_TOKEN_BILLED_OPS, OPERATION_LABELS } from './aiOperationLabels'

interface CostTableProps {
  usage: AdminAiUsage
}

export function AiOperationCostTable({ usage }: CostTableProps) {
  // 只列有调用的行，避免 16 行里 12 行是 0 的噪声。
  const operationRows = (Object.keys(OPERATION_LABELS) as AiOperation[])
    .map((op) => {
      const cost = usage.costByOperation[op] ?? { cny: 0, calls: 0, measuredCalls: 0 }
      const calls = usage.byOperation[op] ?? 0
      const tokenBilled = !NON_TOKEN_BILLED_OPS.includes(op)
      const costState: 'measured' | 'partial' | 'uncollected' =
        cost.measuredCalls === 0 ? 'uncollected'
          : cost.measuredCalls < cost.calls ? 'partial'
            : 'measured'
      return { op, calls, cost: cost.cny, tokenBilled, costState, unmeasured: cost.calls - cost.measuredCalls }
    })
    .filter((row) => row.calls > 0)
    .sort((a, b) => b.calls - a.calls)
  // 新前端可能先于后端到达浏览器：旧接口没有语音合计时按「暂无用量数据」显示，不让整页崩
  const voiceTotals = usage.voiceUsageTotals ?? { asrSeconds: 0, asrCallsWithUsage: 0, ttsChars: 0, ttsCallsWithUsage: 0 }
  const roundedAsrSeconds = Math.round(voiceTotals.asrSeconds * 10) / 10
  const totalOperationCalls = operationRows.reduce((sum, row) => sum + row.calls, 0)
  // 只累计**已采集**的成本。未采集的那部分不能当 0 加进来充数。
  const totalTokenBilledCost = operationRows
    .filter((row) => row.tokenBilled)
    .reduce((sum, row) => sum + row.cost, 0)
  const totalUnmeasuredCalls = operationRows
    .filter((row) => row.tokenBilled)
    .reduce((sum, row) => sum + row.unmeasured, 0)

  return (
    <section aria-label="分能力调用量与成本" className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-neutral-500">分能力调用量与成本（近 24 小时）</h2>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">AI 能力</th>
                <th className="px-4 py-3 text-right font-medium">调用次数</th>
                <th className="px-4 py-3 text-right font-medium">估算成本</th>
                <th className="px-4 py-3 text-left font-medium">计费方式</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {operationRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                    近 24 小时暂无 AI 调用记录
                  </td>
                </tr>
              ) : (
                operationRows.map((row) => (
                  <tr key={row.op} className="hover:bg-neutral-50/50">
                    <td className="px-4 py-3 text-neutral-700" title={row.op}>{OPERATION_LABELS[row.op]}</td>
                    <td className="px-4 py-3 text-right font-mono text-neutral-700">{row.calls}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {/* 三态：未采集绝不显示 ¥0（那等于谎称免费）；部分采集要标出缺口 */}
                      {!row.tokenBilled
                        ? <span className="text-neutral-400">未配置单价</span>
                        : row.costState === 'uncollected'
                          ? <span className="text-neutral-400">未估算</span>
                        : (
                          <span className="text-neutral-700">
                            {formatCny(row.cost)}
                            {row.costState === 'partial' && (
                              <span className="ml-1 text-warning">+{row.unmeasured} 笔未估算</span>
                            )}
                          </span>
                        )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {!row.tokenBilled
                        ? <>{NON_TOKEN_BILLED_NOTE[row.op]} · {row.op === 'voiceTranscribe'
                          ? voiceTotals.asrCallsWithUsage > 0 ? `时长 ${Math.floor(roundedAsrSeconds / 60)} 分 ${(roundedAsrSeconds % 60).toFixed(1)} 秒` : '暂无用量数据'
                          : voiceTotals.ttsCallsWithUsage > 0 ? `${formatCount(voiceTotals.ttsChars)} 字` : '暂无用量数据'}{((measured) => measured > 0 && measured < row.calls ? '（部分调用无可用数据）' : null)(row.op === 'voiceTranscribe' ? voiceTotals.asrCallsWithUsage : voiceTotals.ttsCallsWithUsage)}</>
                        : row.costState === 'uncollected'
                          ? '按 token 计费，但本窗口未采集到用量'
                          : '按 token 用量'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {operationRows.length > 0 && (
              <tfoot className="border-t border-neutral-100 bg-neutral-50 text-xs">
                <tr>
                  <td className="px-4 py-3 font-medium text-neutral-600">合计（按 token 计费部分）</td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-neutral-700">{totalOperationCalls}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-neutral-700">{formatCny(totalTokenBilledCost)}</td>
                  <td className="px-4 py-3 text-neutral-500">
                    {totalUnmeasuredCalls > 0
                      ? `合计只含大模型费用；语音费用待配置单价后计入；另有 ${totalUnmeasuredCalls} 笔未采集，合计为下限`
                      : '合计只含大模型费用；语音费用待配置单价后计入'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
      <p className="mt-2 text-xs text-neutral-400">
        语音用量仅统计可确认的音频时长和合成成功文字；计费单位与单价待合同确认，请以厂商账单为准。
      </p>
      {/*
        历史数据说明（交付章程 D-2）：token 用量从来没采集过，少算部分不可恢复。
        任何回填都是拿估算冒充实测，属第二次编造，比承认数据不全更糟 —— 故不回填，
        只如实标注。日期由后端 AI_COST_COLLECTION_SINCE 提供，不在前端写死。
      */}
      <p className="mt-1 text-xs text-neutral-400">
        成本采集自 {usage.costCollectionSince} 起生效；该日期之前的调用未采集 token 用量，
        历史成本统计不完整且不做回填（回填等于用估算冒充实测）。
      </p>
    </section>
  )
}
