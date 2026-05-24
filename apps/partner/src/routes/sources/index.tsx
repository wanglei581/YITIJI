import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { DatabaseIcon } from 'lucide-react'

export default function SourcesPage() {
  return (
    <Page title="数据源管理" subtitle="配置自动同步数据源">
      <EmptyState
        icon={DatabaseIcon}
        title="暂无数据源"
        description="配置外部数据接口实现自动同步"
      />
    </Page>
  )
}
