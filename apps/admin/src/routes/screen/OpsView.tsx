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

export function OpsView({ chrome }: { chrome: ScreenChrome }) {
  const ops = useAdminSnapshot('ops', POLL_SECONDS)
  if (!ops.data) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={ops.failure} onRetry={() => void ops.refresh()} />
  }
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
    >
      <TwinSlot slot="full">
        <OpsGrid metrics={ops.data.metrics} />
      </TwinSlot>
    </TwinShell>
  )
}
