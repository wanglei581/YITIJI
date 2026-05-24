import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { BriefcaseIcon } from 'lucide-react'

export default function JobsPage() {
  return (
    <Page title="岗位信息管理" subtitle="上传与维护岗位数据">
      <EmptyState
        icon={BriefcaseIcon}
        title="暂无岗位数据"
        description="从数据源同步或手动上传岗位信息"
      />
    </Page>
  )
}
