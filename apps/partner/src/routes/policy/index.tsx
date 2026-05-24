import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { FileTextIcon } from 'lucide-react'

export default function PolicyPage() {
  return (
    <Page title="政策公告" subtitle="就业政策与补贴信息发布">
      <EmptyState
        icon={FileTextIcon}
        title="暂无政策公告"
        description="发布就业政策和补贴申请指南"
      />
    </Page>
  )
}
