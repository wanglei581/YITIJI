import { Button, EmptyState, PageHeader } from '@ai-job-print/ui'
import { BriefcaseIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function JobsPage() {
  const navigate = useNavigate()
  return (
    <div className="p-6">
      <PageHeader
        title="岗位信息"
        subtitle="来源：第三方平台 · 官方机构"
        actions={<Button size="sm" variant="outline" onClick={() => navigate('/')}>返回首页</Button>}
      />
      <div className="mt-12">
        <EmptyState
          icon={BriefcaseIcon}
          title="暂无岗位数据"
          description="岗位信息由合作机构同步，Phase 4 开发中"
        />
      </div>
    </div>
  )
}
