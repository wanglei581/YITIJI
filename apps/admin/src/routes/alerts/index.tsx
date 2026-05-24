import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { AlertTriangleIcon } from 'lucide-react'

export default function AlertsPage() {
  return (
    <Page title="告警中心" subtitle="硬件告警与系统告警处理">
      <EmptyState
        icon={AlertTriangleIcon}
        title="暂无告警"
        description="所有终端运行正常，无待处理告警"
      />
    </Page>
  )
}
