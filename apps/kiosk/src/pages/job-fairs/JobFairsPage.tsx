import { Button, EmptyState, PageHeader } from '@ai-job-print/ui'
import { CalendarIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function JobFairsPage() {
  const navigate = useNavigate()
  return (
    <div className="p-6">
      <PageHeader
        title="招聘会"
        subtitle="来源：第三方平台 · 官方机构"
        actions={<Button size="sm" variant="outline" onClick={() => navigate('/')}>返回首页</Button>}
      />
      <div className="mt-12">
        <EmptyState
          icon={CalendarIcon}
          title="暂无招聘会信息"
          description="招聘会活动由合作机构发布，Phase 4 开发中"
        />
      </div>
    </div>
  )
}
