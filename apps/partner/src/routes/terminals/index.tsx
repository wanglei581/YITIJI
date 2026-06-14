import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { MonitorIcon } from 'lucide-react'

export default function TerminalsPage() {
  return (
    <Page title="终端数据" subtitle="机构关联终端的使用数据">
      <EmptyState
        icon={MonitorIcon}
        title="功能建设中"
        description="该模块正在开发中，上线前暂不开放，敬请期待。"
      />
    </Page>
  )
}
