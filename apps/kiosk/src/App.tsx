import { useState } from 'react'
import { Button, Card, PageHeader, StatusBadge } from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'

export default function App() {
  const [deviceStatus] = useState<DeviceStatus>('idle')

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <PageHeader
        title="AI求职打印服务终端"
        subtitle="一体机前台 · Kiosk · Port 5173"
        actions={
          <StatusBadge
            status={deviceStatus === 'online' || deviceStatus === 'idle' ? 'success' : 'warning'}
            label={deviceStatus}
          />
        }
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">打印服务</h2>
          <p className="mt-2 text-sm text-gray-500">上传简历，立即打印</p>
          <Button className="mt-4 w-full" size="lg">
            开始打印
          </Button>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">扫描服务</h2>
          <p className="mt-2 text-sm text-gray-500">扫描文件，生成 PDF</p>
          <Button className="mt-4 w-full" size="lg" variant="secondary">
            开始扫描
          </Button>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">AI 简历优化</h2>
          <p className="mt-2 text-sm text-gray-500">AI 智能分析，提升竞争力</p>
          <Button className="mt-4 w-full" size="lg" variant="ghost">
            了解详情
          </Button>
        </Card>
      </div>
    </div>
  )
}
