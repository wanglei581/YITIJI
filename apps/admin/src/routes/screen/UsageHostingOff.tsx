import type { ScreenUsageSnapshot } from '@ai-job-print/shared'
import { SCREEN_HOSTING_OFF_NOTE, TwinBarList, TwinMetricPanel, TwinTiles, twinSmall } from '@ai-job-print/ui'
import { aiOperationLabel } from './metricLabels'

/**
 * 服务调用在招聘内容托管关闭（托管 a）时的右栏三块。
 *
 * 「岗位信息使用」整块是招聘内容（服务端给的是 recruitment_hosting_disabled），不再渲染；
 * 它的块位给「AI 质量」：成功率、平均耗时、降级兜底、调用失败从「AI 服务」里搬出来单独成块，
 * 「AI 服务」腾出的地方给功能分项与模型构成。右下「信息内容浏览」换成「政策服务使用」，
 * 并在这里说一次边界（全屏唯一一处）。所有数字都是服务调用快照里已有的，少于 5 写「少于 5」。
 */

type UsageMetrics = ScreenUsageSnapshot['metrics']

const AI_SOURCE = 'AI 服务日志：按功能计次（成功与失败都算一次调用），模型按调用方记录的提供方统计；成本只加已采集的估算，是按单价估算、不是账单。少于 5 次不显示。'

export function UsageAiPanel({ metric, rangeText, presenting }: { metric: UsageMetrics['ai']; rangeText: string; presenting: boolean }) {
  return (
    <TwinMetricPanel
      title="AI 服务"
      sub={`${rangeText} · 按功能`}
      metric={metric}
      source={AI_SOURCE}
      render={(value) => (
        <>
          <TwinBarList
            items={value.byOperation
              .map((row) => ({ label: aiOperationLabel(row.operation, true), value: row.count === null ? 0 : row.count, valueText: twinSmall(row.count) }))
              .sort((a, b) => b.value - a.value)
              .slice(0, presenting ? 4 : 6)}
            emptyText="所选时间内没有 AI 调用"
          />
          {value.providers.length ? (
            <TwinTiles
              cols={value.providers.length >= 3 ? 3 : 2}
              compact
              items={value.providers.slice(0, 3).map((p) => ({ value: twinSmall(p.count), label: p.label }))}
            />
          ) : (
            <p className="twin-cap">模型：暂无调用</p>
          )}
          <p className="twin-cap twin-push">
            估算成本 {value.estimatedCostCny === null ? '样本不足' : `¥${value.estimatedCostCny.toFixed(2)}`} · 按单价估算，不是账单
          </p>
        </>
      )}
    />
  )
}

function percent(value: number | null): string {
  return value === null ? '样本不足' : value.toFixed(1)
}

export function UsageAiQualityPanel({ metric, rangeText }: { metric: UsageMetrics['ai']; rangeText: string }) {
  return (
    <TwinMetricPanel
      title="AI 质量"
      sub={rangeText}
      metric={metric}
      source="成功率 = 成功 ÷（成功 + 失败）；平均耗时只算成功调用；降级兜底 = 由未就绪兜底模型应答的调用；调用失败含超时与上游拒绝。少于 5 次不显示。"
      render={(value) => (
        <>
          <TwinTiles
            items={[
              value.successRate === null
                ? { value: '样本不足', label: '成功率' }
                : { value: percent(value.successRate), unit: '%', label: '成功率', hint: `共 ${twinSmall(value.total)} 次` },
              value.avgLatencyMs === null
                ? { value: '样本不足', label: '平均耗时' }
                : { value: (value.avgLatencyMs / 1000).toFixed(2), unit: '秒', label: '平均耗时' },
              { value: twinSmall(value.fallbackCalls), unit: '次', label: '降级兜底' },
              { value: twinSmall(value.failed), unit: '次', label: '调用失败' },
            ]}
          />
          <p className="twin-cap twin-push">平均耗时只算成功调用；失败含超时与上游拒绝</p>
        </>
      )}
    />
  )
}

export function UsagePolicyPanel({ metric, rangeText, membersNote }: { metric: UsageMetrics['content']; rangeText: string; membersNote: string }) {
  return (
    <TwinMetricPanel
      title="政策服务使用"
      sub={rangeText}
      tone="info"
      metric={metric}
      source={`${membersNote} 政策由运营机构在本平台自行审核发布。`}
      render={(value) => (
        <>
          <div className="twin-hero is-center">
            <span className="twin-big">{twinSmall(value.policy)}</span>
            <span className="twin-unit">次</span>
            <span className="twin-muted">{rangeText}政策浏览 · 只含登录会员</span>
          </div>
          <p className="twin-cap">{SCREEN_HOSTING_OFF_NOTE}</p>
        </>
      )}
    />
  )
}
