import { Page } from '../Page'
import { Card, EmptyState } from '@ai-job-print/ui'
import { LayoutDashboardIcon } from 'lucide-react'

export default function DashboardPage() {
  return (
    <Page title="工作台" subtitle="合作机构后台">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold text-gray-800">岗位数据</h2>
          <p className="mt-2 text-sm text-gray-500">已发布：— 条</p>
          <p className="mt-1 text-sm text-gray-500">待审核：— 条</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-800">招聘会数据</h2>
          <p className="mt-2 text-sm text-gray-500">进行中：— 场</p>
          <p className="mt-1 text-sm text-gray-500">已结束：— 场</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-800">浏览统计</h2>
          <p className="mt-2 text-sm text-gray-500">今日浏览：— 次</p>
          <p className="mt-1 text-sm text-gray-500">总浏览：— 次</p>
        </Card>
      </div>
      <div className="mt-6">
        <EmptyState
          icon={LayoutDashboardIcon}
          title="暂无更多数据"
          description="上传岗位或招聘会数据后将自动展示统计信息"
        />
      </div>
    </Page>
  )
}
