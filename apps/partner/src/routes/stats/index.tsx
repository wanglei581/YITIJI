import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { BarChart2Icon } from 'lucide-react'

export default function StatsPage() {
  return (
    <Page title="数据统计" subtitle="岗位与招聘会数据统计">
      <EmptyState
        icon={BarChart2Icon}
        title="暂无统计数据"
        description="数据积累后自动展示统计报表"
      />
    </Page>
  )
}
