import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { UsersIcon } from 'lucide-react'

export default function UsersPage() {
  return (
    <Page title="用户管理" subtitle="终端注册用户列表">
      <EmptyState
        icon={UsersIcon}
        title="暂无用户"
        description="用户注册后将在此处显示"
      />
    </Page>
  )
}
