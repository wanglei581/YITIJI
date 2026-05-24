import { EmptyState, PageHeader } from '@ai-job-print/ui'
import { BotIcon } from 'lucide-react'

export function AssistantPage() {
  return (
    <div className="p-6">
      <PageHeader title="AI 助手" subtitle="智能问答 · 求职指导" />
      <div className="mt-12">
        <EmptyState
          icon={BotIcon}
          title="AI 助手即将上线"
          description="Phase 3 开发中，支持简历建议、打印帮助、政策问答"
        />
      </div>
    </div>
  )
}
