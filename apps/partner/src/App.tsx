import { useState } from 'react'
import { Button, Card, PageHeader, StatusBadge } from '@ai-job-print/ui'
import type { JobReviewStatus } from '@ai-job-print/shared'

export default function App() {
  const [reviewStatus] = useState<JobReviewStatus>('pending')

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <PageHeader
        title="合作机构后台"
        subtitle="Partner Portal · Port 5175"
        actions={
          <StatusBadge
            status={reviewStatus === 'published' ? 'success' : reviewStatus === 'rejected' ? 'error' : 'warning'}
            label={reviewStatus}
          />
        }
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">招聘会信息</h2>
          <p className="mt-2 text-sm text-gray-500">发布招聘会活动信息</p>
          <Button className="mt-4" size="md">
            发布活动
          </Button>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">数据统计</h2>
          <p className="mt-2 text-sm text-gray-500">查看终端使用情况报表</p>
          <Button className="mt-4" size="md" variant="secondary">
            查看报表
          </Button>
        </Card>
      </div>
    </div>
  )
}
