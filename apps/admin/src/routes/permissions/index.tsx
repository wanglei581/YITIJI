import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { ShieldIcon } from 'lucide-react'

export default function PermissionsPage() {
  return (
    <Page title="权限管理" subtitle="管理员角色与操作权限">
      <EmptyState
        icon={ShieldIcon}
        title="暂无权限配置"
        description="配置管理员角色与权限后将在此处显示"
      />
    </Page>
  )
}
