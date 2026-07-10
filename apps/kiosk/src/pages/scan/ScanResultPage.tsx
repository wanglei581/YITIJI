import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
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
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: 'PDF'
  mimeType?: string
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
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, pages: file.pages, mimeType: file.mimeType },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleSave = () => {
    if (!file) return
    navigate('/me/documents')
  }

  const handleResumeAI = () => {
    if (!file) return
    navigate('/resume/parse', {
      state: {
        source: 'scan',
        // ResumeParsePage 只读顶层 state.fileId 发起解析请求，file 内的 fileId/fileUrl
        // 仅用于展示；与 ResumeSourcePage 的既有上传流程保持同一 state 契约。
        fileId: file.fileId,
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, format: file.format },
      },
    })
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* 状态图标 */}
      <div
        className={[
          'mb-8 flex h-24 w-24 items-center justify-center rounded-full',
          success ? 'bg-success-bg' : 'bg-error-bg',
        ].join(' ')}
      >
        {success ? (
          <CheckCircleIcon className="h-14 w-14 text-success-fg" />
        ) : (
          <AlertCircleIcon className="h-14 w-14 text-error-fg" />
        )}
      </div>

      {/* 标题 / 描述 */}
      <h1 className="text-2xl font-bold text-neutral-900">
        {success ? '扫描完成' : '扫描失败'}
      </h1>
      <p className="mt-2 text-base text-neutral-500">
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
              <p className="truncate text-sm font-medium text-neutral-900">{file.name}</p>
              <p className="text-xs text-neutral-500">
                {file.pages != null ? `${file.pages} 页 · ` : ''}
                {file.size} · {file.format}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 操作按钮 */}
      {success ? (
        <div className="mt-8 grid w-full max-w-sm grid-cols-2 gap-3">
          <Button
            size="lg"
            variant="secondary"
            className="flex items-center gap-2"
            disabled={!file}
            onClick={handlePrint}
          >
            <PrinterIcon className="h-4 w-4" />
            直接打印
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="flex items-center gap-2"
            disabled={!file}
            onClick={handleSave}
          >
            <SaveIcon className="h-4 w-4" />
            保存文档
          </Button>
          <Button
            size="lg"
            variant={scanType === 'resume' ? 'primary' : 'secondary'}
            disabled={scanType !== 'resume' || !file}
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
