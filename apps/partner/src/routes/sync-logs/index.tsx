import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { RefreshCwIcon } from 'lucide-react'

export default function SyncLogsPage() {
  return (
    <Page title="同步日志" subtitle="数据同步任务记录与状态">
      <EmptyState
        icon={RefreshCwIcon}
        title="暂无同步记录"
        description="数据源同步后将在此处显示日志"
      />
    </Page>
  )
}
