import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { BotIcon } from 'lucide-react'

export default function AiServicesPage() {
  return (
    <Page title="AI服务管理" subtitle="简历解析、AI诊断、优化任务">
      <EmptyState
        icon={BotIcon}
        title="暂无AI服务记录"
        description="用户使用AI服务后将在此处显示调用记录"
      />
    </Page>
  )
}
