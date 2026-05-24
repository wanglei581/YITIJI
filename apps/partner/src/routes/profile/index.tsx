import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { Building2Icon } from 'lucide-react'

export default function ProfilePage() {
  return (
    <Page title="机构资料" subtitle="机构基本信息与资质">
      <EmptyState
        icon={Building2Icon}
        title="暂无机构资料"
        description="请完善机构基本信息"
      />
    </Page>
  )
}
