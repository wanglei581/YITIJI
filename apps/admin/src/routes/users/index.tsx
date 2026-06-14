import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { UsersIcon } from 'lucide-react'

export default function UsersPage() {
  return (
    <Page title="用户管理" subtitle="终端注册用户列表">
      <EmptyState
        icon={UsersIcon}
        title="功能建设中"
        description="该模块正在开发中，上线前暂不开放，敬请期待。"
      />
    </Page>
  )
}
