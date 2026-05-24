import { EmptyState, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon } from 'lucide-react'

export function PolicyPage() {
  return (
    <div className="p-6">
      <PageHeader title="政策服务" subtitle="就业政策 · 补贴资讯 · 官方通知" />
      <div className="mt-12">
        <EmptyState
          icon={FileTextIcon}
          title="政策信息即将上线"
          description="Phase 4 开发中，展示就业政策、补贴申请、官方通知等信息"
        />
      </div>
    </div>
  )
}
