import { Button, EmptyState, PageHeader } from '@ai-job-print/ui'
import { UploadIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function ResumeUploadPage() {
  const navigate = useNavigate()
  return (
    <div className="p-6">
      <PageHeader
        title="上传简历"
        subtitle="AI简历服务 · 第一步"
        actions={<Button size="sm" variant="outline" onClick={() => navigate('/')}>返回首页</Button>}
      />
      <div className="mt-12">
        <EmptyState
          icon={UploadIcon}
          title="选择简历文件"
          description="支持 PDF、Word、图片格式 · Phase 3 开发中"
          action={<Button size="lg">选择文件</Button>}
        />
      </div>
    </div>
  )
}
