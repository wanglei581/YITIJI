import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  SmartphoneIcon,
  SparklesIcon,
  UploadCloudIcon,
  UsbIcon,
} from 'lucide-react'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { kioskUploadFile } from '../../services/api'
import { UploadSessionQrPanel, type PhoneUploadedResumeFile } from '../upload/components/UploadSessionQrPanel'
import { DiagnosisDirectionForm } from './components/DiagnosisDirectionForm'

type UploadChannel = 'usb' | 'cloud' | 'phone'

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
    helper: '只读取你主动选择的文件，上传完成后即可拔出 U 盘。',
    icon: UsbIcon,
  },
  {
    type: 'cloud',
    label: '云端上传',
    description: '选择云盘同步目录或本机下载目录中的简历文件',
    helper: '适合先把云盘文件下载到本机目录后选择；不会保存你的云盘账号。',
    icon: CloudUploadIcon,
  },
  {
    type: 'phone',
    label: '手机扫码上传',
    description: '用手机扫码选择简历文件，再回到一体机确认',
    helper: '二维码只含一次性上传令牌；手机端不会获得一体机会员登录凭证。',
    icon: SmartphoneIcon,
  },
]

// 与后端真实报告结构对齐:6 评分维度 + 风险表述提醒 + 修改优先级建议
const DIAGNOSIS_DIMENSIONS = [
  ...RESUME_SCORING_DIMENSIONS.map((item) => item.label),
  '风险表述提醒',
  '修改优先级建议',
]
const DEFAULT_SELECTED_DIMENSIONS: ResumeScoringDimensionKey[] = ['keyword', 'quantification', 'experience']
// ── intent 分流(diagnose / optimize):同一上传链路,不同语义引导 ──────────────
type ResumeIntent = 'diagnose' | 'optimize'

const INTENT_COPY: Record<ResumeIntent, {
  title: string
  subtitle: string
  infoTitle: string
  infoBody: string
  privacyNote: string
  buttonReady: string
  buttonEmpty: string
}> = {
  diagnose: {
    title: 'AI 简历诊断',
    subtitle: '上传简历文件，生成基于真实内容的结构化诊断报告',
    infoTitle: '只分析你上传的简历文件',
    infoBody: '上传简历后，系统从完整度、表达清晰度、岗位表达、风险项、排版结构、修改优先级等方面生成诊断报告。本页面不提供文本粘贴输入，避免在公共一体机上遗留简历原文；未接入真实 AI 模型时，页面会明确标记为演示报告。',
    privacyNote: '简历原文仅用于本次解析和诊断，不作为平台简历库沉淀。',
    buttonReady: '开始 AI 诊断',
    buttonEmpty: '请先上传简历文件',
  },
  optimize: {
    title: 'AI 简历优化',
    subtitle: '上传简历文件，先完成必要诊断，再基于原文生成可编辑的优化版简历',
    infoTitle: '只基于你的简历原文优化表达',
    infoBody: '上传简历后，系统会先完成必要诊断，再基于原文重组优化，生成可编辑的结构化优化版简历。优化版只基于原文事实重组，不补充虚构学校、公司、项目、证书、电话、邮箱等信息；原文没有的内容保持为空，由你自行补充。',
    privacyNote: '简历原文仅用于本次解析、诊断与优化，不作为平台简历库沉淀。',
    buttonReady: '上传并生成优化建议',
    buttonEmpty: '请先上传简历文件',
  },
}

/** 优化路径闭环展示(上传页直接告诉用户整条链路)。 */
const OPTIMIZE_FLOW_STEPS = ['上传', '诊断', '优化', '新旧对比', '编辑', '导出 PDF', '打印']

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
  const [searchParams] = useSearchParams()
  const intent: ResumeIntent = searchParams.get('intent') === 'optimize' ? 'optimize' : 'diagnose'
  const copy = INTENT_COPY[intent]
  const { getToken } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<UploadChannel>('cloud')
  const [uploadedFile, setUploadedFile] = useState<UploadedResumeFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [genericDiagnosis, setGenericDiagnosis] = useState(false)
  const [selectedDimensions, setSelectedDimensions] = useState<ResumeScoringDimensionKey[]>(DEFAULT_SELECTED_DIMENSIONS)
  const [targetIndustry, setTargetIndustry] = useState('互联网/科技')
  const [targetJob, setTargetJob] = useState('')
  const [targetExperience, setTargetExperience] = useState<ResumeTargetContext['experience']>('应届')
  const [targetScene, setTargetScene] = useState<ResumeTargetContext['scene']>('校招')
  // 目标维度补充(可选):专业与学历,仅用于本人简历表达诊断/优化重点参考
  const [targetMajor, setTargetMajor] = useState('')
  const [targetDegree, setTargetDegree] = useState('')
  // 简历上传中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(uploading || phoneBusy)

  const toggleDimension = (key: ResumeScoringDimensionKey) => {
    setSelectedDimensions((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    )
  }

  const buildTargetContext = (): ResumeTargetContext => {
    if (genericDiagnosis) return { skipped: true }
    return {
      industry: targetIndustry,
      targetJob: targetJob.trim() || undefined,
      experience: targetExperience,
      scene: targetScene,
      major: targetMajor.trim() || undefined,
      degree: targetDegree.trim() || undefined,
      skipped: false,
    }
  }

  const handleSelect = (option: UploadOption) => {
    setError(null)
    setSelected(option.type)
    if (option.type === 'phone') return
    fileInputRef.current?.click()
  }

  const handleUploadBoxClick = () => {
    setError(null)
    if (selected === 'phone') return
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

  const handlePhoneUploaded = (file: PhoneUploadedResumeFile) => {
    setUploadedFile(file)
    setError(null)
  }

  const handleStartDiagnosis = () => {
    if (!uploadedFile || uploading) return
    // intent 随 state 全链路透传(parse/report/optimize 均 ...state 转发)
    navigate('/resume/parse', {
      state: {
        intent,
        source: 'upload',
        uploadChannel: uploadedFile.channel,
        file: { name: uploadedFile.name, size: uploadedFile.size, format: uploadedFile.format },
        fileId: uploadedFile.fileId,
        selectedDimensions: genericDiagnosis ? [] : selectedDimensions,
        targetContext: buildTargetContext(),
      },
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>
        }
      />

      <div className="mt-4">
        <ComplianceBanner tone="success" title="隐私保护">
          {copy.privacyNote}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}
        </ComplianceBanner>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        aria-label="选择本机简历文件"
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
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-gray-900">{copy.infoTitle}</h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{copy.infoBody}</p>
              {intent === 'optimize' && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {OPTIMIZE_FLOW_STEPS.map((step, i) => (
                    <span key={step} className="flex items-center gap-1.5">
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 shadow-sm">{step}</span>
                      {i < OPTIMIZE_FLOW_STEPS.length - 1 && <span className="text-xs text-primary-300">→</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* 阶段2A:没有电子简历的用户 → AI 简历生成(引导式表单,只润色不编造) */}
        <button
          type="button"
          onClick={() => navigate('/resume/generate')}
          className="flex min-h-[72px] w-full items-center gap-4 rounded-2xl border-2 border-dashed border-primary-200 bg-white px-5 py-4 text-left transition-colors hover:border-primary-400 hover:bg-primary-50/40 active:bg-primary-50"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white">
            <SparklesIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-gray-900">没有电子简历？AI 帮你生成一份</p>
            <p className="mt-0.5 text-sm text-gray-500">填写真实信息 → AI 润色排版 → 导出 PDF 当场打印（不编造任何经历）</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700">去生成</span>
        </button>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {UPLOAD_OPTIONS.map((option) => {
          const isSelected = selected === option.type
          const Icon = option.icon
          const disabled = uploading
          return (
            <button
              type="button"
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

        {selected === 'phone' ? (
          <UploadSessionQrPanel onUploaded={handlePhoneUploaded} onBusyChange={setPhoneBusy} />
        ) : (
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
              {uploadedFile
                ? `${uploadedFile.size} · ${uploadedFile.format.toUpperCase()} · ${
                  uploadedFile.channel === 'usb' ? 'U盘上传' : uploadedFile.channel === 'phone' ? '手机扫码上传' : '云端上传'
                }`
                : '支持 PDF / DOC / DOCX / 图片格式，单个文件最大 10MB'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUPPORTED_FORMATS.map((format) => (
                <span key={format} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-500">
                  {format}
                </span>
              ))}
            </div>
          </button>
        )}

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
            <p className="text-base font-bold text-gray-900">
              {intent === 'optimize' ? '优化前将先完成以下诊断(必要步骤)' : '诊断报告包含以下内容'}
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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

        <DiagnosisDirectionForm
          genericDiagnosis={genericDiagnosis}
          selectedDimensions={selectedDimensions}
          targetIndustry={targetIndustry}
          targetJob={targetJob}
          targetExperience={targetExperience}
          targetScene={targetScene}
          onGenericDiagnosisChange={setGenericDiagnosis}
          onToggleDimension={toggleDimension}
          onTargetIndustryChange={setTargetIndustry}
          onTargetJobChange={setTargetJob}
          onTargetExperienceChange={setTargetExperience}
          onTargetSceneChange={setTargetScene}
        />

        <Card className="p-5">
          <p className="text-sm font-bold text-gray-900">补充方向（可选）</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            补充专业和学历，仅用于本人简历表达诊断/优化重点参考，不影响是否可以诊断。
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">专业</span>
              <input
                value={targetMajor}
                disabled={genericDiagnosis}
                onChange={(e) => setTargetMajor(e.target.value.slice(0, 60))}
                placeholder="例如：计算机科学与技术"
                className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">学历</span>
              <input
                value={targetDegree}
                disabled={genericDiagnosis}
                onChange={(e) => setTargetDegree(e.target.value.slice(0, 30))}
                placeholder="例如：本科、硕士、大专"
                className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
              />
            </label>
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
          {uploadedFile ? copy.buttonReady : copy.buttonEmpty}
        </Button>
      </div>
    </div>
  )
}
