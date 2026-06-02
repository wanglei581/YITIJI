import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { ChevronRightIcon, FolderOpenIcon, ScanIcon, UploadIcon } from 'lucide-react'
import { kioskUploadFile } from '../../services/api'

type Source = 'upload' | 'scan' | 'my-docs'

interface SourceOption {
  type: Source
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  directAction?: boolean
}

const SOURCES: SourceOption[] = [
  { type: 'upload',  label: '上传电子简历', description: '支持 PDF、Word、图片 · 最大 10MB', icon: UploadIcon },
  { type: 'scan',    label: '扫描纸质简历', description: '使用扫描仪将纸质简历数字化', icon: ScanIcon, directAction: true },
  { type: 'my-docs', label: '从我的文档选择', description: '使用已上传或扫描过的文件', icon: FolderOpenIcon },
]

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

function inferFormat(mimeOrName: string): string {
  const m = mimeOrName.toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('word') || m.includes('doc')) return 'word'
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  return 'unknown'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ResumeSourcePage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Source | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = (option: SourceOption) => {
    setError(null)
    if (option.directAction) {
      navigate('/scan/start', { state: { scanType: 'resume' } })
      return
    }
    setSelected(option.type)
    if (option.type === 'upload') {
      fileInputRef.current?.click()
    }
  }

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许选同名再次触发
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError(`文件超过 10MB(${formatSize(file.size)}),请压缩后重试`)
      return
    }
    setError(null)
    setUploading(true)
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload')
      navigate('/resume/target', {
        state: {
          source: 'upload',
          file: { name: uploaded.filename, size: formatSize(uploaded.sizeBytes), format: inferFormat(uploaded.mimeType || uploaded.filename) },
          fileId: uploaded.fileId,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败,请重试'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  const handleMyDocsNext = () => {
    if (selected !== 'my-docs') return
    navigate('/resume/target', {
      state: { source: 'manual', file: { name: '已选择的文档', size: '—', format: 'pdf' } },
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="AI 简历服务"
        subtitle="请选择简历来源"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/resume')}>返回服务中心</Button>
        }
      />

      <div className="mt-4">
        <ComplianceBanner tone="success" title="隐私保护">
          {COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}
        </ComplianceBanner>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleFileChosen}
      />

      <div className="mt-6 flex flex-1 flex-col gap-4">
        {SOURCES.map((option) => {
          const isSelected = selected === option.type
          const Icon = option.icon
          const disabled = uploading
          return (
            <button
              key={option.type}
              onClick={() => !disabled && handleSelect(option)}
              disabled={disabled}
              className={[
                'flex flex-1 flex-col justify-center w-full rounded-xl border-2 px-5 py-6 text-left transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-60',
                isSelected
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100',
              ].join(' ')}
            >
              <div className="flex items-center gap-4">
                <div className={['flex h-16 w-16 shrink-0 items-center justify-center rounded-xl', isSelected ? 'bg-primary-100' : 'bg-gray-100'].join(' ')}>
                  <Icon className={['h-8 w-8', isSelected ? 'text-primary-600' : 'text-gray-500'].join(' ')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={['text-xl font-semibold', isSelected ? 'text-primary-700' : 'text-gray-900'].join(' ')}>{option.label}</p>
                  <p className="mt-1 text-sm text-gray-500">{option.description}</p>
                </div>
                <ChevronRightIcon className={['h-5 w-5 shrink-0', isSelected ? 'text-primary-500' : 'text-gray-300'].join(' ')} />
              </div>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-error-bg/60 bg-error-bg/40 px-4 py-3 text-sm text-error-fg">
          {error}
        </div>
      )}

      {uploading && (
        <div className="mt-4 text-center text-sm text-primary-700">上传中,请稍候…</div>
      )}

      <div className="mt-6">
        <Button
          size="lg"
          className="w-full"
          disabled={selected !== 'my-docs' || uploading}
          onClick={handleMyDocsNext}
        >
          {selected === 'my-docs' ? '下一步' : '请选择简历来源'}
        </Button>
      </div>
    </div>
  )
}
