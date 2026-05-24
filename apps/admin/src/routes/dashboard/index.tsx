import { Page } from '../Page'
import { Card, EmptyState } from '@ai-job-print/ui'
import { LayoutDashboardIcon } from 'lucide-react'

export default function DashboardPage() {
  return (
    <Page title="工作台" subtitle="管理员后台">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold text-gray-800">设备概览</h2>
          <p className="mt-2 text-sm text-gray-500">终端总数：— 台</p>
          <p className="mt-1 text-sm text-gray-500">在线：— 台</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-800">打印任务</h2>
          <p className="mt-2 text-sm text-gray-500">今日打印：— 页</p>
          <p className="mt-1 text-sm text-gray-500">待处理：— 个</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-800">告警统计</h2>
          <p className="mt-2 text-sm text-gray-500">未处理告警：— 条</p>
          <p className="mt-1 text-sm text-gray-500">今日新增：— 条</p>
        </Card>
      </div>
      <div className="mt-6">
        <EmptyState
          icon={LayoutDashboardIcon}
          title="暂无更多数据"
          description="连接设备后将自动展示运营数据"
        />
      </div>
    </Page>
  )
}
