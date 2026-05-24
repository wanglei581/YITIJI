import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { ScrollTextIcon } from 'lucide-react'

export default function AuditPage() {
  return (
    <Page title="日志审计" subtitle="管理员操作日志与系统事件">
      <EmptyState
        icon={ScrollTextIcon}
        title="暂无日志"
        description="管理员操作后将自动记录审计日志"
      />
    </Page>
  )
}
