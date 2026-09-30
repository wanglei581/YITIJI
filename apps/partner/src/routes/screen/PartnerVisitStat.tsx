import { SCREEN_UNAVAILABLE_REASON, type ScreenSnapshotMetrics } from '@ai-job-print/shared'
import { TwinUnavailable, screenCount } from '@ai-job-print/ui'

type VisitMetric = ScreenSnapshotMetrics['visitCount']

function visitReason(metric: VisitMetric): string {
  return metric && metric.available === false && metric.reason ? metric.reason : SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
}

/**
 * 机构总览主栅格上的服务人次。有数就写数；服务端不给原数时只写原因表里的中文，不补 1–4。
 * 放在「本机构终端」里，不另开面板，也不进归并行。
 */
export function PartnerVisitStat({ metric }: { metric: VisitMetric }) {
  return (
    <div className="twin-stat">
      <span>
        今日服务人次
        <span className="twin-muted"> · 会话数，不是人数</span>
      </span>
      {metric?.available ? (
        <b>
          {screenCount(metric.value)}
          <span className="twin-unit">人次</span>
        </b>
      ) : (
        <TwinUnavailable reason={visitReason(metric)} inline />
      )}
    </div>
  )
}
