import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { UserCogIcon } from 'lucide-react'

export default function AccountPage() {
  return (
    <Page title="账号权限" subtitle="机构子账号与操作权限管理">
      <EmptyState
        icon={UserCogIcon}
        title="功能建设中"
        description="该模块正在开发中，上线前暂不开放，敬请期待。"
      />
    </Page>
  )
}
