import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { Building2Icon } from 'lucide-react'

export default function PartnersPage() {
  return (
    <Page title="合作机构管理" subtitle="管理数据合作机构账号与权限">
      <EmptyState
        icon={Building2Icon}
        title="暂无合作机构"
        description="添加合作机构后将在此处显示"
      />
    </Page>
  )
}
