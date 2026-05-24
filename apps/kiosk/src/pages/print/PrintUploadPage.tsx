import { Button, EmptyState, PageHeader } from '@ai-job-print/ui'
import { PrinterIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function PrintUploadPage() {
  const navigate = useNavigate()
  return (
    <div className="p-6">
      <PageHeader
        title="打印 / 扫描"
        subtitle="上传文件或扫描原件"
        actions={<Button size="sm" variant="outline" onClick={() => navigate('/')}>返回首页</Button>}
      />
      <div className="mt-12">
        <EmptyState
          icon={PrinterIcon}
          title="选择打印方式"
          description="上传文件 · 扫码上传 · U盘导入 · Phase 3 开发中"
          action={<Button size="lg">上传文件</Button>}
        />
      </div>
    </div>
  )
}
