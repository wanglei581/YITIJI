import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { ShieldIcon } from 'lucide-react'

export default function PermissionsPage() {
  return (
    <Page title="权限管理" subtitle="管理员角色与操作权限">
      <EmptyState
        icon={ShieldIcon}
        title="功能建设中"
        description="该模块正在开发中，上线前暂不开放，敬请期待。"
      />
    </Page>
  )
}
