import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  CloudUploadIcon,
  FileTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadCloudIcon,
  UsbIcon,
} from 'lucide-react'
import { kioskUploadFile } from '../../services/api'

type UploadChannel = 'usb' | 'cloud'

interface UploadOption {
  type: UploadChannel
  label: string
  description: string
  helper: string
  icon: React.ComponentType<{ className?: string }>
}

const UPLOAD_OPTIONS: UploadOption[] = [
  {
    type: 'usb',
    label: 'U盘上传',
    description: '从已插入一体机的 U 盘中选择简历文件',
    helper: '当前通过系统文件选择器读取 U 盘文件；后续可由 Windows Agent 接管盘符直达。',
    icon: UsbIcon,
  },
  {
    type: 'cloud',
    label: '云端上传',
    description: '选择云盘同步目录或本机下载目录中的简历文件',
    helper: '不保存云盘账号，不直接连接第三方网盘；只上传用户主动选择的本地文件。',
    icon: CloudUploadIcon,
  },
]

const DIAGNOSIS_DIMENSIONS = [
  '基础信息完整度',
  '教育经历完整度',
  '实习/项目经历表达',
  '技能关键词覆盖',
  '排版可读性',
]

const SUPPORTED_FORMATS = ['PDF', 'DOC', 'DOCX', 'JPG', 'PNG', 'WEBP']

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

interface UploadedResumeFile {
  name: string
  size: string
  format: string
  fileId: string
  channel: UploadChannel
}

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
  const { getToken } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<UploadChannel>('cloud')
  const [uploadedFile, setUploadedFile] = useState<UploadedResumeFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 简历上传中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(uploading)

  const handleSelect = (option: UploadOption) => {
    setError(null)
    setSelected(option.type)
    fileInputRef.current?.click()
  }

  const handleUploadBoxClick = () => {
    setError(null)
    fileInputRef.current?.click()
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
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      setUploadedFile({
        name: uploaded.filename,
        size: formatSize(uploaded.sizeBytes),
        format: inferFormat(uploaded.mimeType || uploaded.filename),
        fileId: uploaded.fileId,
        channel: selected,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败,请重试'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  const handleStartDiagnosis = () => {
    if (!uploadedFile || uploading) return
    navigate('/resume/parse', {
      state: {
        source: 'upload',
        uploadChannel: uploadedFile.channel,
        file: { name: uploadedFile.name, size: uploadedFile.size, format: uploadedFile.format },
        fileId: uploadedFile.fileId,
      },
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="AI 简历诊断"
        subtitle="上传简历文件，生成基于真实内容的结构化诊断报告"
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

      <div className="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto pb-1">
        <Card className="border-primary-100 bg-primary-50/50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-primary-600 shadow-sm">
              <SparklesIcon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">只分析你上传的简历文件</h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">
                本页面不提供文本粘贴输入，避免在公共一体机上遗留简历原文。诊断报告来自后端 AI 解析结果；未接入真实 AI Provider 时，页面会明确标记为演示报告。
              </p>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {UPLOAD_OPTIONS.map((option) => {
          const isSelected = selected === option.type
          const Icon = option.icon
          const disabled = uploading
          return (
            <button
              key={option.type}
              onClick={() => !disabled && handleSelect(option)}
              disabled={disabled}
              className={[
                'flex min-h-[148px] w-full flex-col justify-between rounded-2xl border-2 px-5 py-5 text-left shadow-sm transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-60',
                isSelected
                  ? 'border-primary-500 bg-white ring-4 ring-primary-100'
                  : 'border-gray-200 bg-white hover:border-primary-200 hover:bg-primary-50/30 active:bg-primary-50',
              ].join(' ')}
            >
              <div className="flex items-center gap-4">
                <div className={['flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', isSelected ? 'bg-primary-100' : 'bg-gray-100'].join(' ')}>
                  <Icon className={['h-8 w-8', isSelected ? 'text-primary-600' : 'text-gray-500'].join(' ')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={['text-xl font-bold', isSelected ? 'text-primary-700' : 'text-gray-900'].join(' ')}>{option.label}</p>
                  <p className="mt-1 text-sm font-medium text-gray-600">{option.description}</p>
                </div>
                {isSelected && <CheckCircleIcon className="h-6 w-6 shrink-0 text-primary-600" aria-hidden="true" />}
              </div>
              <p className="mt-4 text-xs leading-relaxed text-gray-400">{option.helper}</p>
            </button>
          )
          })}
        </div>

        <button
          type="button"
          disabled={uploading}
          onClick={handleUploadBoxClick}
          className={[
            'flex min-h-[214px] flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-white px-6 py-8 text-center transition-colors',
            uploadedFile
              ? 'border-primary-300 bg-primary-50/35'
              : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/30 active:bg-primary-50',
            uploading ? 'cursor-not-allowed opacity-70' : '',
          ].join(' ')}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
            {uploadedFile ? <FileTextIcon className="h-8 w-8" aria-hidden="true" /> : <UploadCloudIcon className="h-8 w-8" aria-hidden="true" />}
          </div>
          <p className="mt-4 text-2xl font-extrabold text-gray-900">
            {uploadedFile ? uploadedFile.name : '点击上传文件'}
          </p>
          <p className="mt-2 text-base font-medium text-gray-500">
            {uploadedFile ? `${uploadedFile.size} · ${uploadedFile.format.toUpperCase()} · ${uploadedFile.channel === 'usb' ? 'U盘上传' : '云端上传'}` : '支持 PDF / DOC / DOCX / 图片格式，单个文件最大 10MB'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {SUPPORTED_FORMATS.map((format) => (
              <span key={format} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-500">
                {format}
              </span>
            ))}
          </div>
        </button>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
            <p className="text-base font-bold text-gray-900">当前可诊断维度</p>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            {DIAGNOSIS_DIMENSIONS.map((item) => (
              <div key={item} className="flex min-h-[64px] items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 px-3 text-center text-sm font-semibold text-gray-700">
                {item}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>诊断维度以当前后端 AI 报告结构为准。系统不会编造「超过多少人」「必然提分」等无法验证的结论。</p>
          </div>
        </Card>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-error-bg/60 bg-error-bg/40 px-4 py-3 text-sm text-error-fg">
          {error}
        </div>
      )}

      {uploading && (
        <div className="mt-4 text-center text-sm font-medium text-primary-700">上传中，请稍候…</div>
      )}

      <div className="mt-6">
        <Button
          size="lg"
          className="min-h-[64px] w-full text-lg"
          disabled={!uploadedFile || uploading}
          onClick={handleStartDiagnosis}
        >
          {uploadedFile ? '开始 AI 诊断' : '请先上传简历文件'}
        </Button>
      </div>
    </div>
  )
}
