import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { SettingsIcon } from 'lucide-react'

export default function SettingsPage() {
  return (
    <Page title="系统设置" subtitle="权限管理、角色配置、操作日志">
      <EmptyState
        icon={SettingsIcon}
        title="设置模块"
        description="系统设置功能开发中"
      />
    </Page>
  )
}
