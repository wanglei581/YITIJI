import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileTextIcon,
  PrinterIcon,
  SaveIcon,
  SparklesIcon,
} from 'lucide-react'

type ScanType = 'resume' | 'id' | 'document'

interface ScannedFile {
  name: string
  size: string
  pages: number
  format: 'PDF'
}

interface ScanResultState {
  scanType?: ScanType
  source?: string
  pageMode?: string
  color?: string
  dpi?: number
  success?: boolean
  reason?: string
  file?: ScannedFile
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'file'])

export function ScanResultPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as ScanResultState

  const { scanType = 'document', success = true, reason, file } = state

  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/scan/settings', { state: retryState })
  }

  const handlePrint = () => {
    if (!file) return
    navigate('/print/confirm', {
      state: {
        file: { name: file.name, size: file.size, pages: file.pages },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  const handleSave = () => {
    navigate('/profile', { state: { savedFile: file, savedAt: new Date().toISOString() } })
  }

  const handleResumeAI = () => {
    navigate('/resume/parse', {
      state: {
        source: 'scan',
        file: file
          ? { name: file.name, size: file.size, format: file.format }
          : { name: '扫描简历.pdf', size: '-', format: 'PDF' },
      },
    })
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* 状态图标 */}
      <div
        className={[
          'mb-8 flex h-24 w-24 items-center justify-center rounded-full',
          success ? 'bg-green-50' : 'bg-red-50',
        ].join(' ')}
      >
        {success ? (
          <CheckCircleIcon className="h-14 w-14 text-green-600" />
        ) : (
          <AlertCircleIcon className="h-14 w-14 text-red-500" />
        )}
      </div>

      {/* 标题 / 描述 */}
      <h1 className="text-2xl font-bold text-gray-900">
        {success ? '扫描完成' : '扫描失败'}
      </h1>
      <p className="mt-2 text-base text-gray-500">
        {success
          ? '文件已生成，请选择下一步操作'
          : (reason ?? '扫描任务未能完成，请重试或联系工作人员')}
      </p>

      {/* 文件摘要卡片（成功时） */}
      {success && file && (
        <Card className="mt-8 w-full max-w-sm p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
              <FileTextIcon className="h-5 w-5 text-primary-600" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">
                {file.pages} 页 · {file.size} · {file.format}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 操作按钮 */}
      {success ? (
        <div className="mt-8 grid w-full max-w-sm grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" className="flex items-center gap-2" onClick={handlePrint}>
            <PrinterIcon className="h-4 w-4" />
            直接打印
          </Button>
          <Button size="lg" variant="secondary" className="flex items-center gap-2" onClick={handleSave}>
            <SaveIcon className="h-4 w-4" />
            保存文档
          </Button>
          <Button
            size="lg"
            variant={scanType === 'resume' ? 'primary' : 'secondary'}
            disabled={scanType !== 'resume'}
            className="flex items-center gap-2"
            onClick={handleResumeAI}
          >
            <SparklesIcon className="h-4 w-4" />
            AI 简历识别
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      ) : (
        <div className="mt-8 flex w-full max-w-sm gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/')}>
            返回首页
          </Button>
          <Button size="lg" className="flex-1" onClick={handleRetry}>
            重试扫描
          </Button>
        </div>
      )}
    </div>
  )
}
