import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { CalendarIcon } from 'lucide-react'

export default function FairSourcesPage() {
  return (
    <Page title="招聘会信息源" subtitle="第三方招聘会数据来源管理">
      <EmptyState
        icon={CalendarIcon}
        title="暂无招聘会信息源"
        description="配置合作机构数据源后将显示招聘会同步记录"
      />
    </Page>
  )
}
