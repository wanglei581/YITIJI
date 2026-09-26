import type { ScreenSnapshotMetrics } from '@ai-job-print/shared'
import { TwinSlot } from '@ai-job-print/ui'
import { OpsGrid } from './OpsGrid'
import { TwinShell, TwinShellEmpty, snapshotMeta, useAdminSnapshot, type ScreenChrome } from './screenView'

/**
 * 运营看板：面向运维与内容审核，含告警与队列，只在已登录的管理员会话里看，不投放到公开场所。
 * 仍是卡片栅格（每块带来源脚注），外壳与其它页签统一。
 */

const TITLE = '终端运营看板'
const SUBTITLE = '运维与审核 · 仅管理员可见'
const POLL_SECONDS = 15

/**
 * 招聘内容托管关闭时的看板：多取一份政务快照，只为「岗位类存量」要的内容计数（运营快照里没有）。
 * 单独成组件，取数钩子只在托管关闭时挂载，托管开启时不多发一个请求。
 */
function OpsHostingOffGrid({ metrics }: { metrics: ScreenSnapshotMetrics }) {
  const gov = useAdminSnapshot('gov', 60, 'ops-tab')
  const stock = gov.data ? gov.data.metrics.contentInventory : gov.failure ? undefined : 'pending'
  return <OpsGrid metrics={metrics} hostingOff stock={stock} />
}

export function OpsView({ chrome }: { chrome: ScreenChrome }) {
  const ops = useAdminSnapshot('ops', POLL_SECONDS)
  if (!ops.data) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={ops.failure} onRetry={() => void ops.refresh()} />
  }
  const hostingOff = ops.data.limits.recruitmentHosting === 'disabled'
  return (
    <TwinShell
      chrome={chrome}
      title={TITLE}
      subtitle={SUBTITLE}
      layout="full"
      meta={snapshotMeta(ops.data)}
      pollSeconds={POLL_SECONDS}
      failure={ops.failure}
      onRefresh={() => void ops.refresh()}
      refreshing={ops.status === 'loading'}
      hostingOff={hostingOff}
    >
      <TwinSlot slot="full">
        {hostingOff ? <OpsHostingOffGrid metrics={ops.data.metrics} /> : <OpsGrid metrics={ops.data.metrics} />}
      </TwinSlot>
    </TwinShell>
  )
}
