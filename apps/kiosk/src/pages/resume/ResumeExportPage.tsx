import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon, PrinterIcon, SaveIcon } from 'lucide-react'

interface ResumeFile {
  name: string
  size: string
  format: string
}

export function ResumeExportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  const rawFile = state?.file as ResumeFile | undefined
  const file: ResumeFile = rawFile ?? {
    name: '我的简历.pdf',
    size: '248 KB',
    format: 'PDF',
  }

  const handleSave = () => {
    navigate('/profile', {
      state: { savedResume: file, savedAt: new Date().toISOString() },
    })
  }

  const handlePrintOriginal = () => {
    navigate('/print/confirm', {
      state: {
        file: { name: file.name, size: file.size, pages: 1 },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="简历文件"
        subtitle="请选择下一步操作"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回
          </Button>
        }
      />

      {/* 文件摘要 */}
      <Card className="mt-6 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <FileTextIcon className="h-6 w-6 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{file.name}</p>
            <p className="mt-0.5 text-sm text-gray-500">
              {file.size} · {file.format}
            </p>
          </div>
        </div>
      </Card>

      {/* 操作按钮 */}
      <div className="mt-8 flex flex-1 flex-col gap-3 content-start">
        <Button size="lg" className="flex items-center gap-2" onClick={handleSave}>
          <SaveIcon className="h-4 w-4" />
          保存到我的简历
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="flex items-center gap-2"
          onClick={handlePrintOriginal}
        >
          <PrinterIcon className="h-4 w-4" />
          打印原简历
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => navigate('/')}
        >
          返回首页
        </Button>
      </div>
    </div>
  )
}
