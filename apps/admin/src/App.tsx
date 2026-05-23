import { useState } from 'react'
import { Button, Card, PageHeader, StatusBadge } from '@ai-job-print/ui'
import type { PrintTaskStatus } from '@ai-job-print/shared'

export default function App() {
  const [taskStatus] = useState<PrintTaskStatus>('pending')

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <PageHeader
        title="管理员后台"
        subtitle="Admin Dashboard · Port 5174"
        actions={
          <StatusBadge
            status={taskStatus === 'completed' ? 'success' : taskStatus === 'failed' ? 'error' : 'info'}
            label={taskStatus}
          />
        }
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">打印任务队列</h2>
          <p className="mt-2 text-sm text-gray-500">当前等待任务：0</p>
          <Button className="mt-4" size="md" variant="secondary">
            刷新队列
          </Button>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">设备管理</h2>
          <p className="mt-2 text-sm text-gray-500">已连接打印机：0 台</p>
          <Button className="mt-4" size="md" variant="danger">
            重启设备
          </Button>
        </Card>
      </div>
    </div>
  )
}
