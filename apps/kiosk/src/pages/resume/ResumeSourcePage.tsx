import { type ReactNode, useRef, useState } from 'react'
import { isTerminalKiosk } from '../../services/api/screensaver'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { FileContentPreview } from '../../components/FileContentPreview'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
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
import { ApiHttpError } from '../../services/api/httpAdapter'
import { KIOSK_DEVICE_ORIGINAL_NOTICE } from '../../utils/kioskLocalPrivacy'
import {
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
  WORD_CONVERSION_UNAVAILABLE_COPY,
} from '../../services/api/documentConversion'
import { clearAiResumeSession } from './aiResumeSession'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { DiagnosisDirectionForm } from './components/DiagnosisDirectionForm'
import { ResumeUsbImportPanel, type ResumeUsbImportedFile } from './components/ResumeUsbImportPanel'
import { ResumeTriageHero } from './components/ResumeTriageHero'
import { ResumeScanReady } from './components/ResumeScanReady'
import { readScanHandoff, type ScanHandoff } from './resumeScanHandoff'
import './resume-triage-qx.css'
import './resume-triage-panels-qx.css'

type UploadChannel = 'usb' | 'cloud' | 'phone'
/** 已拿到的文件来自哪条通道；'scan' 只来自扫描工作台的交接（经解析页返回），不是本页可选的通道。 */
type FileChannel = UploadChannel | 'scan'

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
    // 稿 21：它打开的是本机文件选择，不是云盘账号登录，所以用户可见名不叫「云端上传」。
    label: '本机文件 / 云盘下载目录',
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

const BASE_SUPPORTED_FORMATS = ['PDF', 'JPG', 'PNG', 'WEBP']
const BASE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const WORD_ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 稿 21 小青任务头随本页真实状态换话（每条都对应一个能被用户看到的事实，不预告结果）。 */
type SourceHeroKey = 'source' | 'usb' | 'phone' | 'uploading' | 'upload-failed' | 'upload-unknown' | 'staged' | 'scan-ready'
const SOURCE_HERO: Record<SourceHeroKey, { ask: ReactNode; doing: string; flag: string; warn: boolean }> = {
  source: { ask: <>简历这趟，先<em>把文件交给我</em>。</>, doing: '选一种来源把简历送进来，方向和背景在旁边点选；上传后 AI 自动解析结构、识别问题。', flag: '原件只读不改', warn: false },
  usb: { ask: <>从 U 盘里<em>挑一份简历</em>。</>, doing: '插好后文件列表会自动出现；只列 10MB 以内的 PDF / JPG / PNG，要用哪一份由你来点。', flag: 'U 盘', warn: false },
  phone: { ask: <>用手机<em>扫码上传</em>。</>, doing: '二维码有效期以服务端返回为准；手机传完，回到这台机器确认后才继续。', flag: '手机扫码', warn: false },
  uploading: { ask: <>正在把这一份<em>送到服务端</em>。</>, doing: '一次性上传，没有实时百分比，也没有中止入口；成功或失败都会明确告诉你。', flag: '上传中', warn: false },
  'upload-failed': { ask: <>这一份<em>没能送进来</em>。</>, doing: '原件还在你手里，可以重试，或者换一种来源。', flag: '未送达', warn: true },
  'upload-unknown': { ask: <>这一份<em>暂时无法确认有没有传上去</em>。</>, doing: '可能已经传上去了，也可能没有。本页不会自动再传一次，也不会拿之前那份文件继续。', flag: '结果未知', warn: true },
  staged: { ask: <>服务端<em>已经确认收到</em>。</>, doing: '下面这份文件名和大小是服务端回给本机的结果，不是本机自己记的。', flag: '已收到', warn: false },
  'scan-ready': { ask: <>扫描好的这一份<em>已经接到这一步</em>。</>, doing: '它是从扫描工作台交接过来的，不是本页去扫的；身份一路不变。', flag: '已交接', warn: false },
}

const MAX_BYTES = 10 * 1024 * 1024

interface UploadedResumeFile {
  name: string
  size: string
  format: string
  fileId: string
  fileUrl?: string
  mimeType?: string
  channel: FileChannel
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

/** 解析页带回来的扫描件交接 → 本页的「已拿到的文件」。只搬已有字段，不补造。 */
function scanFileFrom(handoff: ScanHandoff | null): UploadedResumeFile | null {
  if (!handoff) return null
  const { fileId, file } = handoff
  return {
    name: file.name,
    size: typeof file.size === 'number' ? formatSize(file.size) : file.size ?? '大小未知',
    format: inferFormat(file.format || file.mimeType || file.name),
    fileId,
    fileUrl: file.fileUrl,
    mimeType: file.mimeType,
    channel: 'scan',
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 这一次上传有没有拿到服务端的**可信答复**（稿 21 upload-unknown）。
 *
 * 只有 4xx 且带着 API 的业务错误码，才算明确拒收（'rejected'），原因照常透出。
 * API 的异常过滤器对 4xx 一律写 `error.code`，所以没有信封的 4xx 是代理代回的，不冒充已知失败。
 * 5xx 一律不算拒收，带信封也一样：`FilesService.upload` 先把 FileObject 落成 active，
 * 之后签名响应失败时的补偿删除也可能失败，服务端照样回 500，而文件已经归入会员账号。
 * 其余同样是「结果未知」：断网（fetch 抛 TypeError）、2xx 但响应体截断（JSON 解析失败）、
 * 2xx 却没带回数据（FILE_UPLOAD_EMPTY，状态仍是 2xx）。kiosk-upload 没有防重键，
 * 所以这些情况既不能说「没传上」，也不能引导用户盲目重传出第二份。
 */
function uploadOutcomeOf(err: unknown): 'rejected' | 'unknown' {
  if (!(err instanceof ApiHttpError)) return 'unknown'
  if (err.status < 400 || err.status >= 500) return 'unknown'
  if (err.code === 'UNKNOWN_ERROR' || err.code === 'NETWORK_ERROR' || err.code === 'REQUEST_TIMEOUT') return 'unknown'
  return 'rejected'
}

/**
 * 把服务端明确拒收的原因翻译成用户看得懂的话（只处理 'rejected'，没收到答复的走结果未知）。
 * 真实后端返回的中文业务错误照常透出，不做覆盖。
 */
function uploadErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message.trim() : ''
  if (!raw) return '上传失败,请重试'
  // 纯 ASCII 的技术错误（英文异常 / 堆栈）不适合直接展示。
  if (!/[一-龥]/.test(raw)) {
    return `上传失败，请重试或更换上传方式。（技术原因：${raw}）`
  }
  return raw
}

export function ResumeSourcePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const intent: ResumeIntent = searchParams.get('intent') === 'optimize' ? 'optimize' : 'diagnose'
  const copy = INTENT_COPY[intent]
  const { getToken } = useAuth()
  const { capabilities: conversionCapabilities } = useDocumentConversionCapabilities()
  const wordConversionAvailable = conversionCapabilities.wordToPdf
  const supportedFormats = wordConversionAvailable
    ? ['PDF', 'DOC', 'DOCX', ...BASE_SUPPORTED_FORMATS.slice(1)]
    : BASE_SUPPORTED_FORMATS
  const accept = wordConversionAvailable ? `${BASE_ACCEPT},${WORD_ACCEPT}` : BASE_ACCEPT
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<UploadChannel>('cloud')
  // 从解析页带着扫描件交接回来时，直接落在稿 21 的 scan-ready：同一份文件，不用重扫。
  const [uploadedFile, setUploadedFile] = useState<UploadedResumeFile | null>(() => scanFileFrom(readScanHandoff(location.state)))
  const [uploading, setUploading] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [usbBusy, setUsbBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 上一次上传没拿到可信答复（稿 21 upload-unknown）；只有用户主动换文件 / 换来源才清掉。
  const [uploadUnknown, setUploadUnknown] = useState(false)
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
    if (option.type !== selected) {
      setUploadedFile(null)
      setUploadUnknown(false)
    }
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
    // 用户已经换成这一份：上一份（哪怕上传成功过）从此不再是「要交给解析的那一份」，
    // 否则这一份失败 / 结果未知时，主按钮会拿着上一份进解析。
    setUploadedFile(null)
    setUploadUnknown(false)
    if (file.size > MAX_BYTES) {
      setError(`文件超过 10MB(${formatSize(file.size)}),请压缩后重试`)
      return
    }
    setError(null)
    setUploading(true)
    clearAiResumeSession()
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      // 2xx 却没带回文件标识：服务端可能已经收下，但本机没有能继续用的那一份。
      if (typeof uploaded?.fileId !== 'string' || !uploaded.fileId) {
        setUploadUnknown(true)
        return
      }
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
      if (uploadOutcomeOf(err) === 'unknown') setUploadUnknown(true)
      else setError(uploadErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    clearAiResumeSession()
    setUploadedFile({ ...file, fileUrl: file.fileUrl })
    setError(null)
    setUploadUnknown(false)
  }

  const handleUsbUploaded = (file: ResumeUsbImportedFile) => {
    clearAiResumeSession()
    setUploadedFile(file)
    setError(null)
    setUploadUnknown(false)
  }

  const handleStartDiagnosis = () => {
    if (!uploadedFile || uploading) return
    // intent 随 state 全链路透传(parse/report/optimize 均 ...state 转发)
    navigate('/resume/parse', {
      state: {
        intent,
        // 扫描工作台交接来的仍按扫描件提交（服务端合同本来就接受 'scan'）。
        source: uploadedFile.channel === 'scan' ? 'scan' : 'upload',
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

  const scanReady = uploadedFile?.channel === 'scan'
  const heroKey: SourceHeroKey = scanReady
    ? 'scan-ready'
    : uploading
      ? 'uploading'
      : uploadUnknown
        ? 'upload-unknown'
        : error
          ? 'upload-failed'
          : uploadedFile
            ? 'staged'
            : selected === 'usb' ? 'usb' : selected === 'phone' ? 'phone' : 'source'
  const hero = SOURCE_HERO[heroKey]

  // 顶栏状态胶囊只报本机真实可知的状态：忙碌 / 文件已就绪 / 还没有文件。拿不到的一律不报「正常」。
  const frameStatus = sourceBusy
    ? { tone: 'warn' as const, label: uploading ? '上传中' : '接收中' }
    : scanReady
      ? { tone: 'ok' as const, label: '扫描件已交接 · 待确认' }
      : uploadedFile
        ? { tone: 'ok' as const, label: '文件已就绪' }
        : uploadUnknown
          ? { tone: 'warn' as const, label: '上传结果未知 · 不重发' }
          : error
            ? { tone: 'warn' as const, label: '上传未完成' }
            : { tone: 'unknown' as const, label: '等待简历文件' }
  const channelLabel = (channel: FileChannel) =>
    channel === 'usb' ? 'U盘上传' : channel === 'phone' ? '手机扫码上传' : channel === 'scan' ? '扫描工作台交接' : '本机文件'

  /** 「换一种来源」：放下交接来的扫描件，并把这条历史里的交接一起清掉，免得返回时又冒出来。 */
  const dropScanHandoff = () => {
    setUploadedFile(null)
    setError(null)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }

  return (
    <QxPageFrame
      title={copy.title}
      subtitle={copy.subtitle}
      status={frameStatus}
      terminalLabel="AI 简历服务"
      back={{ label: '返回 AI 简历服务', onBack: () => navigate('/resume-service') }}
      ctabar={(
        <>
          {uploadedFile && !scanReady ? (
            <button
              type="button"
              className="qx-btn resume-change-file"
              data-variant="ghost"
              disabled={sourceBusy}
              onClick={() => {
                setUploadedFile(null)
                setError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
                handleUploadBoxClick()
              }}
            >
              更换文件
            </button>
          ) : null}
          <button
            type="button"
            className="qx-btn resume-primary-action"
            data-variant="primary"
            disabled={!uploadedFile || sourceBusy}
            onClick={handleStartDiagnosis}
          >
            {uploadedFile ? copy.buttonReady : copy.buttonEmpty}
          </button>
        </>
      )}
    >
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-source" data-intent={intent} data-state={heroKey} className="qx-resume-triage">
      {/* 稿 21 小青任务头：随真实状态换话，四步轨当前在第 1 步。页面 h1 仍是 QxPageFrame 页头。 */}
      <ResumeTriageHero
        eyebrow={intent === 'optimize' ? 'AI RESUME OPTIMIZE' : 'AI RESUME DIAGNOSE'}
        ask={hero.ask}
        doing={hero.doing}
        flag={hero.flag}
        warn={hero.warn}
        rail={['current', 'todo', 'todo', 'todo']}
      />

      <input
        ref={fileInputRef}
        type="file"
        aria-label="选择本机简历文件"
        accept={accept}
        className="hidden"
        onChange={handleFileChosen}
      />

      <div className="qx-scroll qx-rt-scroll">
        {scanReady && uploadedFile ? (
          <ResumeScanReady
            name={uploadedFile.name}
            size={uploadedFile.size}
            format={uploadedFile.format}
            onDrop={dropScanHandoff}
            onRescan={() => navigate('/scan')}
          />
        ) : (
          <section className="qx-rt-pick" aria-labelledby="qx-rt-pick-h">
            <h2 className="qx-rt-sec-h" id="qx-rt-pick-h">简历文件从哪儿来 <small>点一下直接进这条通道</small></h2>
            <div className="qx-rt-srcs" role="group" aria-label="选择简历来源">
              {UPLOAD_OPTIONS.filter((option) => option.type !== 'cloud' || !isTerminalKiosk()).map((option) => {
                const isSelected = selected === option.type
                const Icon = option.icon
                return (
                  <button
                    type="button"
                    key={option.type}
                    className="qx-rt-src"
                    aria-pressed={isSelected}
                    onClick={() => !sourceBusy && handleSelect(option)}
                    disabled={sourceBusy}
                  >
                    <span className="ico"><Icon className="h-8 w-8" /></span>
                    <span className="n">{option.label}</span>
                    <span className="d">{option.description}</span>
                    <span className="go">{option.helper}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <div className="qx-rt-split">
          <div className="qx-rt-main">
            {scanReady ? null : selected === 'phone' ? (
              <div className="resume-source-phone-session qx-rt-phone">
                <UploadSessionQrPanel onUploaded={handlePhoneUploaded} onBusyChange={setPhoneBusy} />
              </div>
            ) : selected === 'usb' ? (
              <div className="qx-rt-usb">
                <ResumeUsbImportPanel onUploaded={handleUsbUploaded} onBusyChange={setUsbBusy} />
              </div>
            ) : (
              <button
                type="button"
                disabled={sourceBusy}
                onClick={handleUploadBoxClick}
                className="qx-rt-dropzone"
                data-staged={uploadedFile ? 'true' : undefined}
              >
                <span className="ico">
                  {uploadedFile ? <FileTextIcon className="h-8 w-8" aria-hidden="true" /> : <UploadCloudIcon className="h-8 w-8" aria-hidden="true" />}
                </span>
                <strong>{uploadedFile ? uploadedFile.name : '点击上传文件'}</strong>
                <span>
                  {uploadedFile
                    ? `${uploadedFile.size} · ${uploadedFile.format.toUpperCase()} · ${channelLabel(uploadedFile.channel)} · 已就绪`
                    : wordConversionAvailable
                      ? '支持 PDF、DOC、DOCX 和图片格式，单个文件最大 10MB'
                      : `${WORD_CONVERSION_UNAVAILABLE_COPY}；支持 PDF / 图片格式，单个文件最大 10MB`}
                </span>
                <span className="qx-rt-fmts">
                  {supportedFormats.map((format) => <em key={format}>{format}</em>)}
                </span>
              </button>
            )}

            {error && (
              <p className="qx-rt-note resume-source-error" data-tone="error" role="alert">{error}</p>
            )}
            {/* 稿 21 upload-unknown。没有后端「按同一标识再查」合同，所以不做再查按钮，只如实说未知。 */}
            {uploadUnknown && (
              <>
                <p className="qx-rt-note resume-source-unknown" data-tone="warn" role="status">
                  <b>结果未知</b>暂时无法确认这一份有没有传上去。本页不会自动再传，也不会用之前那份文件继续。
                </p>
                <dl className="qx-rt-kv">
                  <div><dt>发生了什么</dt><dd>上传过程中网络或服务出了问题，这台机器没能确认上传是否完成。</dd></div>
                  <div><dt>还不确定的</dt><dd>这份文件可能已经传上去了，也可能没有。</dd></div>
                  <div><dt>再传一次</dt><dd>可以重新选择文件再传；如果刚才那次其实已经传上去，会多出一份重复文件。</dd></div>
                  <div>
                    <dt>建议这样做</dt>
                    <dd data-testid="resume-source-unknown-next">
                      {getToken()
                        ? '可先到「我的 → 我的文档」核对；暂时没看到时可稍后刷新。若决定再传，请重新选择文件，可能出现重复文件。'
                        : '当前未登录，暂时无法核对账号记录。需要继续时，可重新选择文件或换一种来源。'}
                    </dd>
                  </div>
                </dl>
              </>
            )}
            {uploading && (
              <p className="qx-rt-note resume-source-status" role="status">上传中，请稍候…</p>
            )}

            {scanReady ? null : (
              <p className="qx-rt-hint">
                再次触摸上方区域可更换文件；图片与扫描件将经 OCR 文字识别，识别置信度较低时报告页会提示人工复核。上传失败会如实提示原因，可重试或更换上传方式。
                <span
                  aria-disabled={!wordConversionAvailable || undefined}
                  aria-describedby={!wordConversionAvailable ? 'resume-word-conversion-reason' : undefined}
                >
                  {wordConversionAvailable
                    ? ` Word ${WORD_CONVERSION_DISCLOSURE}。`
                    : ` ${WORD_CONVERSION_UNAVAILABLE_COPY}。`}
                </span>
              </p>
            )}
            {!wordConversionAvailable && !scanReady && (
              <p id="resume-word-conversion-reason" className="qx-rt-hint">
                {conversionCapabilities.reason || '转换引擎未就绪；服务恢复并通过能力探测后会自动开放。'}
              </p>
            )}
            {uploadedFile && (
              <div className="qx-rt-preview">
                <FileContentPreview
                  compact
                  fileUrl={uploadedFile.fileUrl}
                  fileName={uploadedFile.name}
                  mimeType={uploadedFile.mimeType}
                  format={uploadedFile.format}
                  fileId={uploadedFile.fileId}
                  token={getToken()}
                />
              </div>
            )}
          </div>

          <aside className="qx-rt-side">
            <div className="qx-rt-direction">
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

        <section className="qx-card qx-rt-intro">
          <h2>{copy.infoTitle}</h2>
          <p>{copy.infoBody}</p>
          {intent === 'optimize' && (
            <ol className="qx-rt-chain" aria-label="优化链路">
              {OPTIMIZE_FLOW_STEPS.map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
        </section>

        {/* 阶段2A:没有电子简历的用户 → AI 简历生成(引导式表单,只润色不编造) */}
        <button type="button" onClick={() => navigate('/resume/generate')} className="qx-rt-alt">
          <SparklesIcon size={30} aria-hidden="true" />
          <span>
            <strong>没有电子简历？AI 帮你生成一份</strong>
            <small>填写真实信息 → AI 润色排版 → 导出 PDF 当场打印（不编造任何经历）</small>
          </span>
          <span className="go">去生成</span>
        </button>

        {/*
          维度清单默认收起（R5）：主 CTA 固定在 ctabar，但这张卡仍是页面上最高的
          非必需内容，收起后工作台不必为它滚一整屏。
          注意只收清单本身；下面那句「不会编造无法验证的结论」是合规声明，常驻可见。
        */}
        <section className="qx-card qx-rt-dims">
          <details>
            <summary>
              <ShieldCheckIcon size={22} aria-hidden="true" />
              <span>{intent === 'optimize' ? '优化前将先完成以下诊断(必要步骤)' : '诊断报告包含以下内容'}</span>
              <small>{DIAGNOSIS_DIMENSIONS.length} 项 · 点击展开</small>
            </summary>
            <div className="qx-rt-dim-grid">
              {DIAGNOSIS_DIMENSIONS.map((item, idx) => (
                // 最后两项（风险表述提醒、修改优先级建议）为扩展维度，用 wheat 色区分
                <span key={item} className="qx-rt-dim" data-extra={idx >= DIAGNOSIS_DIMENSIONS.length - 2 ? 'true' : undefined}>
                  {item}
                </span>
              ))}
            </div>
          </details>
          <p className="qx-rt-note" data-tone="warn">
            <AlertCircleIcon size={18} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
            诊断维度以当前后端 AI 报告结构为准。系统不会编造「超过多少人」「必然提分」等无法验证的结论。
          </p>
        </section>
      </div>

      {/* 稿 21 `.truth`：格式 / 用途 / 留存三栏，常驻页底，不随滚动走开。 */}
      <footer className="qx-rt-truth">
        <p><b>格式</b>只收 {supportedFormats.join(' / ')}，单份不超过 10MB；U 盘通道只列 PDF / JPG / PNG。</p>
        <p className="resume-source-privacy"><b>用途 · 隐私</b>{copy.privacyNote}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}</p>
        <p><b>留存</b>{KIOSK_DEVICE_ORIGINAL_NOTICE}</p>
      </footer>
    </section>
    </QxPageFrame>
  )
}
