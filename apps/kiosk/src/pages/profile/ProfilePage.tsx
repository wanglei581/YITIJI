import { Button, Card, EmptyState, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon, PrinterIcon, SparklesIcon, UserIcon } from 'lucide-react'

export function ProfilePage() {
  return (
    <div className="p-6">
      <PageHeader title="我的" subtitle="记录 · 订单 · 账号" />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-3">
            <FileTextIcon className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">我的简历</h2>
          </div>
          <EmptyState
            title="暂无简历"
            description="上传或扫描后的简历将显示在这里"
          />
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <PrinterIcon className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">打印订单</h2>
          </div>
          <EmptyState
            title="暂无订单"
            description="打印完成后的订单记录"
          />
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <SparklesIcon className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">AI 服务记录</h2>
          </div>
          <EmptyState
            title="暂无记录"
            description="AI简历诊断和优化记录"
          />
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <UserIcon className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">账号设置</h2>
          </div>
          <div className="mt-4">
            <Button size="md" variant="outline" className="w-full">
              账号设置
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
