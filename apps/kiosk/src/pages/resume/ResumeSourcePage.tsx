import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { AiDriverBanner } from '../../components/AiDriverBanner'
import { FileContentPreview } from '../../components/FileContentPreview'
import { Button, Card, ComplianceBanner, KioskActionBar, KioskPageFrame, KioskPageHeader, Stepper } from '@ai-job-print/ui'
import type { StepperStep } from '@ai-job-print/ui'
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
  DEFAULT_EMPLOYMENT_INDUSTRY,
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { kioskUploadFile } from '../../services/api'
import { clearAiResumeSession } from './aiResumeSession'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { DiagnosisDirectionForm } from './components/DiagnosisDirectionForm'
import { ResumeUsbImportPanel, type ResumeUsbImportedFile } from './components/ResumeUsbImportPanel'
import './resume-diagnosis-lightflow.css'
import './resume-diagnosis-ext.css'
import './resume-fusion-youth.css'

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

// 2026-08-11（CLAUDE.md §9）：移除 DOC。
// 后端 resume-extraction.service.ts:116 对旧版 .doc 固定返回 UNSUPPORTED_FILE_TYPE
// （「暂不支持旧版 .doc 格式，请另存为 PDF 或 DOCX 后重试」），.docx 才走 docx 分支。
// 前端此前既在格式清单里写 DOC、又让 accept 放行 .doc/application/msword，
// 用户能选中却在上传后才被拒——白跑一趟。现让文件选择器直接不可选。
const SUPPORTED_FORMATS = ['PDF', 'DOCX', 'JPG', 'PNG', 'WEBP']

const RESUME_FLOW_STEPS: StepperStep[] = [
  { title: '上传与方向' },
  { title: 'AI 解析' },
  { title: '诊断报告' },
  { title: '优化打印' },
]

const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

interface UploadedResumeFile {
  name: string
  size: string
  format: string
  fileId: string
  fileUrl?: string
  mimeType?: string
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

/**
 * 把上传失败翻译成用户看得懂的话。
 *
 * 事故原样：`fetch` 断网时 `err.message` 就是浏览器的英文原文 `Failed to fetch`，
 * 直接甩给站在一体机前的求职者。而本页自己写着「上传失败会如实提示原因」——
 * 那就别把浏览器的英文当原因。真实后端返回的中文业务错误照常透出，不做覆盖。
 */
function uploadErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message.trim() : ''
  if (!raw) return '上传失败,请重试'
  // 浏览器 / 运行时层面的网络错误：英文原文对用户没有任何意义。
  if (/^(Failed to fetch|NetworkError|Load failed|The user aborted a request)/i.test(raw)) {
    return '文件没能传到服务器，请检查网络后重试；也可以改用 U盘 或 手机扫码上传。'
  }
  // 纯 ASCII 的技术错误（英文异常 / 堆栈）同样不适合直接展示。
  if (!/[一-龥]/.test(raw)) {
    return `上传失败，请重试或更换上传方式。（技术原因：${raw}）`
  }
  return raw
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
  const [usbBusy, setUsbBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [genericDiagnosis, setGenericDiagnosis] = useState(false)
  const [selectedDimensions, setSelectedDimensions] = useState<ResumeScoringDimensionKey[]>(DEFAULT_SELECTED_DIMENSIONS)
  const [targetIndustry, setTargetIndustry] = useState(DEFAULT_EMPLOYMENT_INDUSTRY)
  const [targetJob, setTargetJob] = useState('')
  const [targetExperience, setTargetExperience] = useState<ResumeTargetContext['experience']>('应届')
  const [targetScene, setTargetScene] = useState<ResumeTargetContext['scene']>('校招')
  // 目标维度补充(可选):专业与学历,仅用于本人简历表达诊断/优化重点参考
  const [targetMajor, setTargetMajor] = useState('')
  const [targetDegree, setTargetDegree] = useState('')
  const sourceBusy = uploading || phoneBusy || usbBusy
  // 简历上传中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(sourceBusy)

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
    if (option.type !== selected) setUploadedFile(null)
    setSelected(option.type)
    if (option.type !== 'cloud') return
    fileInputRef.current?.click()
  }

  const handleUploadBoxClick = () => {
    setError(null)
    if (selected !== 'cloud') return
    fileInputRef.current?.click()
  }

  /*
   * 下面三个「选中了一份新文件」的处理器都会先调 clearAiResumeSession()，
   * 作废上一份简历的匿名结果会话（taskId + accessToken）。
   *
   * 事故原样（2026-08-18 走查）：优化过简历 A 之后回到本页选了 B，最小会话里
   * 仍然是 A 的 taskId；此时直接进 /resume/optimize/compare，渲染出来的是
   * **A 的四条改写建议**，不是空态。报告页 / 优化页 / 对照页读 taskId 的顺序都是
   * state → query → session，所以只要 session 不清，直接进页面就一定读到上一份。
   * 与后端模式无关，真实后端下同样成立。
   *
   * 注意本页刻意**不**直接碰任何浏览器持久化 API —— 简历预览 URL 绝不落盘是
   * `verify:resume-phone-upload-ui` 守着的隐私红线。读写那份最小会话一律经由
   * `aiResumeSession.ts`，那里才是被允许、且只存 taskId + accessToken 的地方。
   *
   * 边界（同样重要，别清过头）：
   * - 只在**选中了一份新文件**时清。重新选同一个文件也算新的一次上传，照清即可 ——
   *   后端会重新分配 fileId，旧 taskId 本来就对不上了。
   * - **不**挂在页面 mount / unmount 上。从报告页点「返回上一步」回到本页、
   *   或中途来回切换上传方式，都不该清 —— 那会把用户刚跑完的诊断结果清掉，
   *   逼他把整条链重跑一遍。这正是「回退再继续」必须保住的路径。
   * - 只清 taskId + accessToken 这类读回凭证；简历原文本来就不落 session。
   */
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
    clearAiResumeSession()
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      setUploadedFile({
        name: uploaded.filename,
        size: formatSize(uploaded.sizeBytes),
        format: inferFormat(uploaded.mimeType || uploaded.filename),
        fileId: uploaded.fileId,
        fileUrl: uploaded.signedUrl,
        mimeType: uploaded.mimeType,
        channel: selected,
      })
    } catch (err) {
      setError(uploadErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    clearAiResumeSession()
    setUploadedFile({ ...file, fileUrl: file.fileUrl })
    setError(null)
  }

  const handleUsbUploaded = (file: ResumeUsbImportedFile) => {
    clearAiResumeSession()
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
        // fileUrl / mimeType 一起透传:诊断失败时报告页要凭它们把**原件**送进打印链路。
        // 原来只带 name/size/format,于是 AI 一挂,文件明明还在服务端,用户却一张纸也拿不走。
        // 这是 kiosk-upload 下发的 HMAC content URL(30 分钟 TTL),与 PrintUploadPage 同一条路径。
        file: {
          name: uploadedFile.name,
          size: uploadedFile.size,
          format: uploadedFile.format,
          fileUrl: uploadedFile.fileUrl,
          mimeType: uploadedFile.mimeType,
        },
        fileId: uploadedFile.fileId,
        selectedDimensions: genericDiagnosis ? [] : selectedDimensions,
        targetContext: buildTargetContext(),
      },
    })
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-source" className="resume-lightflow resume-source-lightflow flex h-full flex-col p-6">
      <KioskPageHeader
        title={copy.title}
        description={copy.subtitle}
        onBack={() => navigate('/')}
        backLabel="返回首页"
      />

      <AiDriverBanner feature="AI简历诊断" description="上传后自动解析结构、识别问题" />

      <div className="resume-source-privacy mt-3">
        <ComplianceBanner tone="success" title="隐私保护">
          {copy.privacyNote}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}
        </ComplianceBanner>
      </div>

      <div className="resume-lightflow__stepper mt-3">
        <Stepper steps={RESUME_FLOW_STEPS} currentIndex={0} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        aria-label="选择本机简历文件"
        accept={ACCEPT}
        className="hidden"
        onChange={handleFileChosen}
      />

      <div className="resume-source-content mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-1">
        <Card className="resume-source-intro border-primary-100 bg-primary-50/50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-primary-600 shadow-sm">
              <SparklesIcon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-neutral-900">{copy.infoTitle}</h2>
              <p className="mt-1 text-sm leading-relaxed text-neutral-600">{copy.infoBody}</p>
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
          className="resume-source-alternative flex min-h-[72px] w-full items-center gap-4 rounded-2xl border-2 border-dashed border-primary-200 bg-white px-5 py-3 text-left transition-colors hover:border-primary-400 hover:bg-primary-50/40 active:bg-primary-50"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white">
            <SparklesIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-neutral-900">没有电子简历？AI 帮你生成一份</p>
            <p className="mt-0.5 text-sm text-neutral-500">填写真实信息 → AI 润色排版 → 导出 PDF 当场打印（不编造任何经历）</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700">去生成</span>
        </button>

        <div className="resume-source-split grid min-w-0 grid-cols-1 gap-5">
          <div className="resume-source-main flex min-w-0 flex-1 flex-col">
            <div className="resume-source-methods grid grid-cols-1 gap-4 md:grid-cols-3">
              {UPLOAD_OPTIONS.map((option) => {
              const isSelected = selected === option.type
              const Icon = option.icon
              const disabled = sourceBusy
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
                      : 'border-neutral-200 bg-white hover:border-primary-200 hover:bg-primary-50/30 active:bg-primary-50',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-4">
                    <div className={['flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', isSelected ? 'bg-primary-100' : 'bg-neutral-100'].join(' ')}>
                      <Icon className={['h-8 w-8', isSelected ? 'text-primary-600' : 'text-neutral-500'].join(' ')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={['text-xl font-bold', isSelected ? 'text-primary-700' : 'text-neutral-900'].join(' ')}>{option.label}</p>
                      <p className="mt-1 text-sm font-medium text-neutral-600">{option.description}</p>
                    </div>
                    {isSelected && <CheckCircleIcon className="h-6 w-6 shrink-0 text-primary-600" aria-hidden="true" />}
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-neutral-400">{option.helper}</p>
                </button>
              )
              })}
            </div>

            {selected === 'phone' ? (
              <div className="resume-source-phone-session flex-1">
                <UploadSessionQrPanel onUploaded={handlePhoneUploaded} onBusyChange={setPhoneBusy} />
              </div>
            ) : selected === 'usb' ? (
              <ResumeUsbImportPanel onUploaded={handleUsbUploaded} onBusyChange={setUsbBusy} />
            ) : (
              <button
                type="button"
                disabled={sourceBusy}
                onClick={handleUploadBoxClick}
                className={[
                  'resume-source-dropzone flex flex-1 min-h-[214px] flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-white px-6 py-8 text-center transition-colors',
                  uploadedFile
                    ? 'border-primary-300 bg-primary-50/35'
                    : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30 active:bg-primary-50',
                  uploading ? 'cursor-not-allowed opacity-70' : '',
                ].join(' ')}
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                  {uploadedFile ? <FileTextIcon className="h-8 w-8" aria-hidden="true" /> : <UploadCloudIcon className="h-8 w-8" aria-hidden="true" />}
                </div>
                <p className="mt-4 text-2xl font-extrabold text-neutral-900">
                  {uploadedFile ? uploadedFile.name : '点击上传文件'}
                </p>
                <p className="mt-2 text-base font-medium text-neutral-500">
                  {uploadedFile
                    ? `${uploadedFile.size} · ${uploadedFile.format.toUpperCase()} · ${
                      uploadedFile.channel === 'usb' ? 'U盘上传' : uploadedFile.channel === 'phone' ? '手机扫码上传' : '云端上传'
                    } · 已就绪`
                    /* 与 SUPPORTED_FORMATS / ACCEPT 保持同一份口径：旧版 .doc 后端固定
                       返回 UNSUPPORTED_FILE_TYPE，文件选择器也选不中，不能在这里承诺。 */
                    : '支持 PDF / DOCX / 图片格式，单个文件最大 10MB'}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {SUPPORTED_FORMATS.map((format) => (
                    <span key={format} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-500">
                      {format}
                    </span>
                  ))}
                </div>
              </button>
            )}
            <p className="resume-source-upload-hint mt-2 text-sm leading-relaxed text-neutral-500">
              再次触摸上方区域可更换文件；图片与扫描件将经 OCR 文字识别，识别置信度较低时报告页会提示人工复核。上传失败会如实提示原因，可重试或更换上传方式。
            </p>
            {uploadedFile && (
              <FileContentPreview
                compact
                className="mt-4"
                fileUrl={uploadedFile.fileUrl}
                fileName={uploadedFile.name}
                mimeType={uploadedFile.mimeType}
                format={uploadedFile.format}
              />
            )}
          </div>

          <aside className="resume-source-side flex min-w-0 w-full flex-col">
            <div className="resume-source-direction flex min-h-0 flex-1 flex-col">
              <DiagnosisDirectionForm
                genericDiagnosis={genericDiagnosis}
                selectedDimensions={selectedDimensions}
                targetIndustry={targetIndustry}
                targetJob={targetJob}
                targetExperience={targetExperience}
                targetScene={targetScene}
                targetMajor={targetMajor}
                targetDegree={targetDegree}
                onGenericDiagnosisChange={setGenericDiagnosis}
                onToggleDimension={toggleDimension}
                onTargetIndustryChange={setTargetIndustry}
                onTargetJobChange={setTargetJob}
                onTargetExperienceChange={setTargetExperience}
                onTargetSceneChange={setTargetScene}
                onTargetMajorChange={setTargetMajor}
                onTargetDegreeChange={setTargetDegree}
              />
            </div>
          </aside>
        </div>

        {/*
          维度清单默认收起（R5）。
          事故原样：56px 的主 CTA「开始 AI 诊断」在 1080×1920 首屏只露 21px ——
          内容 1903px 挤进 1844px 可视区。一体机没有滚动条，用户看到的就是一条
          被切坏的按钮，以为传失败了。复验还发现两处更糟的：`?intent=optimize`
          与「上传失败横幅在屏」时该按钮 0px 可见，完全看不到。
          这张卡是页面上最高的一块非必需内容（291px），收起后四种情形全部归零溢出。
          注意只收清单本身；下面那句「不会编造无法验证的结论」是合规声明，常驻可见。
        */}
        <Card className="resume-source-evidence p-4">
          <details className="resume-source-dimensions">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-2 text-base font-bold text-neutral-900">
              <ShieldCheckIcon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
              <span className="flex-1">
                {intent === 'optimize' ? '优化前将先完成以下诊断(必要步骤)' : '诊断报告包含以下内容'}
              </span>
              <span className="text-sm font-medium text-neutral-500">
                {DIAGNOSIS_DIMENSIONS.length} 项 · 点击展开
              </span>
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {DIAGNOSIS_DIMENSIONS.map((item, idx) => {
                // 最后两项（风险表述提醒、修改优先级建议）为扩展维度，用 wheat 色区分
                const isExtra = idx >= DIAGNOSIS_DIMENSIONS.length - 2
                return (
                  <div
                    key={item}
                    className={[
                      'flex min-h-[64px] items-center justify-center rounded-2xl border px-3 text-center text-sm font-semibold',
                      isExtra
                        ? 'fy-inc-extra border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700',
                    ].join(' ')}
                  >
                    {item}
                  </div>
                )
              })}
            </div>
          </details>
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-warning-bg px-4 py-3 text-sm leading-relaxed text-warning-fg">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>诊断维度以当前后端 AI 报告结构为准。系统不会编造「超过多少人」「必然提分」等无法验证的结论。</p>
          </div>
        </Card>
      </div>

      {error && (
        <div className="resume-source-error mt-4 rounded-md border border-error-bg/60 bg-error-bg/40 px-4 py-3 text-sm text-error-fg">
          {error}
        </div>
      )}

      {uploading && (
        <div className="resume-source-status mt-4 text-center text-sm font-medium text-primary-700">上传中，请稍候…</div>
      )}

      <KioskActionBar className="resume-source-actions mt-4">
        {uploadedFile ? (
          <Button
            size="lg"
            variant="outline"
            className="resume-change-file min-h-[64px] min-w-[200px] text-lg"
            disabled={sourceBusy}
            onClick={() => {
              setUploadedFile(null)
              setError(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
              handleUploadBoxClick()
            }}
          >
            更换文件
          </Button>
        ) : null}
        <span className="flex-1" aria-hidden="true" />
        <Button
          size="lg"
          className="resume-primary-action min-h-[64px] min-w-[280px] flex-1 text-lg sm:flex-none sm:min-w-[460px]"
          disabled={!uploadedFile || sourceBusy}
          onClick={handleStartDiagnosis}
        >
          {uploadedFile ? copy.buttonReady : copy.buttonEmpty}
        </Button>
      </KioskActionBar>
    </section>
    </KioskPageFrame>
  )
}
