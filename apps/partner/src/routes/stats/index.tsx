import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { BarChart2Icon } from 'lucide-react'

export default function StatsPage() {
  return (
    <Page title="数据统计" subtitle="岗位与招聘会数据统计">
      <EmptyState
        icon={BarChart2Icon}
        title="功能建设中"
        description="该模块正在开发中，上线前暂不开放，敬请期待。"
      />
    </Page>
  )
}
