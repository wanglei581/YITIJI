import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { MonitorIcon } from 'lucide-react'

export default function TerminalsPage() {
  return (
    <Page title="终端管理" subtitle="管理所有一体机终端">
      <EmptyState
        icon={MonitorIcon}
        title="暂无终端设备"
        description="连接一体机终端后将显示设备列表"
      />
    </Page>
  )
}
