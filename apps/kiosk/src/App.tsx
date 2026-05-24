import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KioskLayout,
  LoadingState,
  PageHeader,
  StatusBadge,
  type KioskTab,
} from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'
import { PrinterIcon } from 'lucide-react'

type DemoState = 'ready' | 'loading' | 'empty' | 'error'

export default function App() {
  const [activeTab, setActiveTab] = useState<KioskTab>('home')
  const [deviceStatus] = useState<DeviceStatus>('idle')
  const [demo, setDemo] = useState<DemoState>('ready')

  const statusVariant = deviceStatus === 'online' || deviceStatus === 'idle' ? 'success' : 'warning'

  return (
    <KioskLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerRight={<StatusBadge status={statusVariant} label={deviceStatus} />}
    >
      <div className="p-6">
        <PageHeader
          title="AI求职打印服务终端"
          subtitle="一体机前台 · Kiosk · Port 5173"
        />

        {/* State demo switcher */}
        <div className="mt-6 flex flex-wrap gap-2">
          {(['ready', 'loading', 'empty', 'error'] as DemoState[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={demo === s ? 'primary' : 'outline'}
              onClick={() => setDemo(s)}
            >
              {s}
            </Button>
          ))}
        </div>

        <div className="mt-6">
          {demo === 'loading' && <LoadingState text="正在加载设备状态…" />}
          {demo === 'empty'   && (
            <EmptyState
              icon={PrinterIcon}
              title="暂无打印任务"
              description="上传文件后，任务将出现在这里"
              action={<Button size="lg">上传文件</Button>}
            />
          )}
          {demo === 'error'   && (
            <ErrorState
              title="无法连接打印机"
              message="请检查打印机电源和网络连接"
              onRetry={() => setDemo('ready')}
            />
          )}
          {demo === 'ready'   && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <h2 className="text-lg font-semibold text-gray-900">打印服务</h2>
                <p className="mt-2 text-sm text-gray-500">上传简历，立即打印</p>
                <Button className="mt-4 w-full" size="lg">开始打印</Button>
              </Card>
              <Card>
                <h2 className="text-lg font-semibold text-gray-900">扫描服务</h2>
                <p className="mt-2 text-sm text-gray-500">扫描文件，生成 PDF</p>
                <Button className="mt-4 w-full" size="lg" variant="secondary">开始扫描</Button>
              </Card>
              <Card>
                <h2 className="text-lg font-semibold text-gray-900">AI 简历优化</h2>
                <p className="mt-2 text-sm text-gray-500">AI 智能分析，提升竞争力</p>
                <Button className="mt-4 w-full" size="lg" variant="ghost">了解详情</Button>
              </Card>
            </div>
          )}
        </div>
      </div>
    </KioskLayout>
  )
}
