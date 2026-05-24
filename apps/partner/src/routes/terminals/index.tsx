import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { MonitorIcon } from 'lucide-react'

export default function TerminalsPage() {
  return (
    <Page title="终端数据" subtitle="机构关联终端的使用数据">
      <EmptyState
        icon={MonitorIcon}
        title="暂无终端数据"
        description="关联终端后将显示使用统计"
      />
    </Page>
  )
}
