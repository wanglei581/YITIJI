import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { PrinterIcon } from 'lucide-react'

export default function PrintersPage() {
  return (
    <Page title="打印机管理" subtitle="奔图 CM2820ADN 打印机状态监控">
      <EmptyState
        icon={PrinterIcon}
        title="暂无打印机信息"
        description="Terminal Agent 上线后将自动同步打印机状态"
      />
    </Page>
  )
}
