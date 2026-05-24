import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { BriefcaseIcon } from 'lucide-react'

export default function JobSourcesPage() {
  return (
    <Page title="岗位信息源" subtitle="第三方岗位数据来源管理">
      <EmptyState
        icon={BriefcaseIcon}
        title="暂无岗位信息源"
        description="配置合作机构数据源后将显示岗位同步记录"
      />
    </Page>
  )
}
