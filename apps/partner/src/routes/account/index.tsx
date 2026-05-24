import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { UserCogIcon } from 'lucide-react'

export default function AccountPage() {
  return (
    <Page title="账号权限" subtitle="机构子账号与操作权限管理">
      <EmptyState
        icon={UserCogIcon}
        title="暂无账号配置"
        description="添加子账号后将在此处显示"
      />
    </Page>
  )
}
