import { useCallback, useRef, useState } from 'react'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { ResumeTouchPage } from './touch/ResumeTouchPage'
import { ResumeSourceWhere, type StagedFile } from './touch/ResumeSourceWhere'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { kioskUploadFile } from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { useDocumentConversionCapabilities } from '../../services/api/documentConversion'
import { clearAiResumeSession } from './aiResumeSession'
import type { PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { DiagnosisDirectionForm } from './components/DiagnosisDirectionForm'
import { useUsbImportGate } from '../../hooks/useUsbImportGate'
import { useSupportContact } from '../../hooks/useSupportContact'
import { unattendedResumeCopy } from './touch/unattendedResumeCopy'
import type { ResumeUsbImportedFile, ResumeUsbPick } from './components/ResumeUsbImportPanel'
import { readScanHandoff, type ScanHandoff } from './resumeScanHandoff'
import './touch/direction.css'

const DIAGNOSIS_DIMENSIONS = [
  ...RESUME_SCORING_DIMENSIONS.map((item) => item.label),
  '风险表述提醒',
  '修改优先级建议',
]

type UploadChannel = 'usb' | 'cloud' | 'phone'
/** 已拿到的文件来自哪条通道；'scan' 只来自扫描工作台的交接（经解析页返回），不是本页可选的通道。 */
type FileChannel = UploadChannel | 'scan'

const RESUME_USB_UNCONFIGURED_NOTE = '这台机器暂未开通 U 盘导入。请改用手机扫码上传。'

const DEFAULT_SELECTED_DIMENSIONS: ResumeScoringDimensionKey[] = ['keyword', 'quantification', 'experience']
// ── intent 分流(diagnose / optimize):同一上传链路,不同语义引导 ──────────────
type ResumeIntent = 'diagnose' | 'optimize'

const INTENT_COPY: Record<ResumeIntent, {
  title: string
  privacyNote: string
  buttonReady: string
  buttonEmpty: string
}> = {
  diagnose: {
    title: 'AI 简历诊断',
    privacyNote: '简历原文仅用于本次解析和诊断，不作为平台简历库沉淀。',
    buttonReady: '开始 AI 诊断',
    buttonEmpty: '请先上传简历文件',
  },
  optimize: {
    title: 'AI 简历优化',
    privacyNote: '简历原文仅用于本次解析、诊断与优化，不作为平台简历库沉淀。',
    buttonReady: '上传并生成优化建议',
    buttonEmpty: '请先上传简历文件',
  },
}

const BASE_SUPPORTED_FORMATS = ['PDF', 'JPG', 'PNG', 'WEBP']
const BASE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const WORD_ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type SourceHeroKey = 'source' | 'usb' | 'phone' | 'uploading' | 'upload-failed' | 'upload-unknown' | 'staged' | 'scan-ready'

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
 * 只按可信错误码映射，不直接展示接口错误原文。
 */
function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiHttpError && ['UNSUPPORTED_FILE_TYPE', 'FILE_TYPE_NOT_ALLOWED'].includes(err.code)) {
    return '不支持的文件类型，请改用 PDF 或清晰图片。'
  }
  return userMessageOf(err, '上传失败，请重新选择文件或更换上传方式。')
}

export function ResumeSourcePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const aiDown = (location.state as { aiDown?: boolean } | null)?.aiDown === true
  const [searchParams, setSearchParams] = useSearchParams()
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
  const kiosk = useTerminalKiosk()
  const usbGate = useUsbImportGate(RESUME_USB_UNCONFIGURED_NOTE)
  const supportContact = useSupportContact()
  const [pickedChannel, setSelected] = useState<UploadChannel>(() => isTerminalKiosk() ? 'phone' : 'cloud')
  const selected = kiosk && pickedChannel === 'cloud' ? 'phone' : pickedChannel
  // 从解析页带着扫描件交接回来时，直接落在稿 21 的 scan-ready：同一份文件，不用重扫。
  const [uploadedFile, setUploadedFile] = useState<UploadedResumeFile | null>(() => scanFileFrom(readScanHandoff(location.state)))
  const [uploading, setUploading] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [phoneCancelled, setPhoneCancelled] = useState(false)
  // 手机端已传上来、等本机确认的那份（只有文件名与大小）。
  const [phoneReceived, setPhoneReceived] = useState<{ filename: string; sizeBytes: number; mimeType: string } | null>(null)
  // 确认函数由面板在「有文件、且不在确认中」时交进来，放在 state 里：确认一开始面板就交回 null，
  // 底栏马上写「正在确认…」并禁用，不会再用确认前的旧函数点出第二次确认。
  // 函数放进 setState 必须包一层，否则会被当成更新函数立即执行。
  const [phoneConfirm, setPhoneConfirm] = useState<(() => void) | null>(null)
  const onPhoneConfirmReady = useCallback((confirm: (() => void) | null) => setPhoneConfirm(() => confirm), [])
  const [usbBusy, setUsbBusy] = useState(false)
  const [usbListed, setUsbListed] = useState(0)
  const [usbPick, setUsbPick] = useState<ResumeUsbPick>({ selected: false, importing: false, run: () => {} })
  const [error, setError] = useState<string | null>(null)
  // 上一次上传没拿到可信答复（稿 21 upload-unknown）；只有用户主动换文件 / 换来源才清掉。
  const [uploadUnknown, setUploadUnknown] = useState(false)
  const [genericDiagnosis, setGenericDiagnosis] = useState(true)
  const [selectedDimensions, setSelectedDimensions] = useState<ResumeScoringDimensionKey[]>(DEFAULT_SELECTED_DIMENSIONS)
  const [targetIndustry, setTargetIndustry] = useState('')
  const [targetJob, setTargetJob] = useState('')
  const [targetExperience, setTargetExperience] = useState<ResumeTargetContext['experience']>(undefined)
  const [targetScene, setTargetScene] = useState<ResumeTargetContext['scene']>(undefined)
  // 目标维度补充(可选):专业与学历,仅用于本人简历表达诊断/优化重点参考
  const [targetMajor, setTargetMajor] = useState('')
  const [targetDegree, setTargetDegree] = useState('')
  const sourceBusy = uploading || phoneBusy || usbBusy
  const [step, setStep] = useState<'where' | 'direction' | 'more'>('where')
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
    if (genericDiagnosis || ![targetIndustry, targetJob.trim(), targetExperience, targetScene, targetMajor.trim(), targetDegree.trim()].some(Boolean)) return { skipped: true }
    return {
      industry: targetIndustry || undefined,
      targetJob: targetJob.trim() || undefined,
      experience: targetExperience,
      scene: targetScene,
      major: targetMajor.trim() || undefined,
      degree: targetDegree.trim() || undefined,
      skipped: false,
    }
  }

  /** 换来源：放下已拿到的文件，清掉上一次上传的报错 / 未知结果。 */
  const switchChannel = (next: UploadChannel) => {
    setError(null)
    setPhoneCancelled(false)
    if (next !== selected) {
      setUploadedFile(null)
      setUploadUnknown(false)
    }
    setSelected(next)
  }

  const pickPhone = () => { if (!sourceBusy) switchChannel('phone') }
  const pickUsb = () => { if (!sourceBusy) switchChannel('usb') }
  const pickCloud = () => {
    if (isTerminalKiosk()) return
    switchChannel('cloud')
    fileInputRef.current?.click()
  }

  const handleUploadBoxClick = () => {
    setError(null)
    if (isTerminalKiosk() || selected !== 'cloud') return
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
    if (isTerminalKiosk()) return
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
        selectedDimensions: buildTargetContext().skipped ? [] : selectedDimensions,
        targetContext: buildTargetContext(),
      },
    })
  }

  const scanReady = uploadedFile?.channel === 'scan'
  const usbScreen = step === 'where' && selected === 'usb' && usbListed > 0 && !uploadedFile && !scanReady
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
  // 胶囊不报「正常」。文件到了只说收到，等你确认；方向步才说通用或定向。
  const status = sourceBusy
    ? { text: uploading ? '上传中' : '接收中', tone: 'reading' as const }
    : step === 'direction'
      ? { text: genericDiagnosis ? '通用诊断' : '定向诊断', tone: 'ok' as const }
      : step === 'more'
        ? { text: '都可以不填', tone: 'ok' as const }
        : scanReady
          ? { text: '扫描件已交接 · 待确认', tone: 'ok' as const }
          : uploadedFile
            ? { text: '系统已收到，等你确认', tone: 'ok' as const }
            : uploadUnknown
              ? { text: '上传结果未知 · 不重发', tone: 'warn' as const }
              : error
                ? { text: '上传未完成', tone: 'warn' as const }
                : { text: '等待简历文件', tone: 'unknown' as const }
  const channelLabel = (channel: FileChannel) =>
    channel === 'usb' ? 'U盘上传' : channel === 'phone' ? '手机扫码上传' : channel === 'scan' ? '扫描工作台交接' : '本机文件'

  /** 「换一种来源」：放下交接来的扫描件，并把这条历史里的交接一起清掉，免得返回时又冒出来。 */
  const dropScanHandoff = () => {
    setUploadedFile(null)
    setError(null)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: aiDown ? { aiDown: true } : null })
  }

  const changeFile = () => {
    setUploadedFile(null)
    setError(null)
    setPhoneCancelled(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    handleUploadBoxClick()
  }
  const clearMore = () => {
    setTargetExperience(undefined)
    setTargetScene(undefined)
    setTargetMajor('')
    setTargetDegree('')
    setStep('direction')
  }
  const setIntent = (value: ResumeIntent) => setSearchParams((params) => { params.set('intent', value); return params }, { replace: true })
  const intentPaths = (
    <div className="qxt-intents" role="group" aria-label="先诊断还是直接给改法">
      <button type="button" className="qxt-intent" aria-pressed={intent === 'diagnose'} disabled={sourceBusy} onClick={() => setIntent('diagnose')}>
        <b>先诊断，再逐条改</b>
        <small>推荐 · 先看问题，再决定改不改</small>
      </button>
      <button type="button" className="qxt-intent" aria-pressed={intent === 'optimize'} disabled={sourceBusy} onClick={() => setIntent('optimize')}>
        <b>直接给改法</b>
        <small>上传后生成优化建议</small>
      </button>
    </div>
  )
  const onUsbPick = useCallback((pick: ResumeUsbPick) => setUsbPick(pick), [])
  const staged: StagedFile | null = uploadedFile
    ? { name: uploadedFile.name, size: uploadedFile.size, format: uploadedFile.format, fileId: uploadedFile.fileId, fileUrl: uploadedFile.fileUrl, mimeType: uploadedFile.mimeType, channelLabel: channelLabel(uploadedFile.channel) }
    : null
  const unknownNext = getToken()
    ? '可先到「我的 → 我的文档」核对；暂时没看到时可稍后刷新。若决定再传，请重新选择文件，可能出现重复文件。'
    : '当前未登录，暂时无法核对账号记录。需要继续时，可重新选择文件或换一种来源。'

  const pageKey = step === 'more' ? 'resume-direction-more' : step === 'direction' ? 'resume-direction' : usbScreen ? 'usb' : 'resume-src'
  const askDraft = '请先问我的求职方向，帮我选择这次简历诊断应重点看的部分。'
  const band = step === 'more'
    ? { eyebrow: '更多条件（可不填）', title: '这些要不要一起告诉我？', subtitle: '不填也能诊断。填了只影响建议关注顺序。' }
    : step === 'direction'
      ? genericDiagnosis
        ? { eyebrow: '诊断方向（可以不选）', title: '按通用标准看，可以吗？', subtitle: '不设方向。想指定重点，再改成定向诊断。' }
        : { eyebrow: '诊断方向（可以不选）', title: '想按什么方向看？', subtitle: '可以多选重点，也可以改回通用。' }
      : usbScreen
        ? { eyebrow: copy.title, title: '挑一份就行', subtitle: '只读根目录，不进子文件夹。' }
        : { eyebrow: copy.title, title: '你的简历在哪里？', subtitle: undefined }
  const backLabel = step === 'where' ? '上一步' : '返回'
  const onBack = usbScreen
    ? () => { setUsbListed(0); setSelected('phone') }
    : step === 'more' ? () => setStep('direction') : step === 'direction' ? () => setStep('where') : () => navigate('/resume-service')
  const ask = aiDown ? { label: '小青暂时不可用，先打印原件', disabled: true as const } : step === 'more'
    ? { label: '问小青：可以不填吗', draft: '诊断方向里的经历、场景、专业和学历都可以不填吗？请只说明它们怎么影响建议顺序，不要替我填写。' }
    : step === 'direction'
      ? { label: '问小青：帮我选重点', draft: askDraft }
      : usbScreen || (step === 'where' && selected === 'phone' && !uploadedFile && !scanReady)
        ? { label: '问小青：选诊断重点', draft: askDraft }
        : { label: '问小青：帮我选诊断重点 →', draft: askDraft }
  const phoneWaitingConfirm = step === 'where' && selected === 'phone' && !uploadedFile && phoneBusy
  const phoneConfirmNow = phoneWaitingConfirm ? phoneConfirm : null
  // 小青停用（从失败屏带回来的）：诊断和优化这次做不了，「简历在哪里」这一步的主按钮改成不用 AI 的打印原件，
  // 不再把人领进诊断方向那一步；手机确认、U 盘导入这两个中间动作照常。
  const primary = aiDown && step === 'where' && !phoneWaitingConfirm && !usbScreen ? { label: '去打印原件', onClick: () => navigate('/print-scan') } : phoneWaitingConfirm
    ? { label: phoneConfirmNow ? '确认使用这份文件' : '正在确认…', onClick: () => phoneConfirmNow?.(), disabled: !phoneConfirmNow, className: 'resume-primary-action' }
    : usbScreen
    ? (usbPick.selected ? { label: usbPick.importing ? '正在导入' : '导入这份文件', onClick: usbPick.run, disabled: usbPick.importing } : undefined)
    : step === 'more'
      ? { label: '好了，回去开始诊断', onClick: () => setStep('direction'), noArrow: true }
      : step === 'direction'
        ? { label: uploadedFile ? copy.buttonReady : copy.buttonEmpty, onClick: handleStartDiagnosis, disabled: !uploadedFile || sourceBusy }
        : { label: uploadedFile ? '下一步：诊断方向' : '请先上传简历文件', onClick: () => setStep('direction'), disabled: !uploadedFile || sourceBusy, className: 'resume-primary-action' }

  return (
    <ResumeTouchPage
      eyebrow={band.eyebrow}
      title={band.title}
      subtitle={band.subtitle}
      status={status}
      railNow={0}
      seal={step === 'where' && !usbScreen ? 'idle' : null}
      navCurrent={step === 'where' && !usbScreen ? 'home' : undefined}
      backLabel={backLabel}
      onBack={onBack}
      ask={ask}
      primary={primary}
      bodyClassName={step === 'where' ? 'qxt-body-scroll' : 'qxt-body-tight'}
    >
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-source" data-intent={intent} data-state={heroKey} data-resume-step={step} data-qx-page={pageKey} data-directed={!genericDiagnosis ? 'true' : undefined} className="qxt-source-page" data-takeaway="简历诊断报告">
        {!kiosk && (
          <input
            ref={fileInputRef}
            type="file"
            aria-label="选择本机简历文件"
            accept={accept}
            className="hidden"
            onChange={handleFileChosen}
          />
        )}

        {step === 'where' ? (
          <ResumeSourceWhere
            kiosk={kiosk}
            selected={selected}
            sourceBusy={sourceBusy}
            usbScreen={usbScreen}
            file={staged}
            scanReady={scanReady}
            loggedIn={Boolean(getToken())}
            uploading={uploading}
            error={error ? unattendedResumeCopy(error, supportContact) : null}
            uploadUnknown={uploadUnknown}
            unknownNext={unknownNext}
            phoneCancelled={phoneCancelled}
            phoneReceived={phoneReceived}
            onPhoneConfirmReady={onPhoneConfirmReady}
            onPhoneReceived={setPhoneReceived}
            wordConversionAvailable={wordConversionAvailable}
            supportedFormats={supportedFormats}
            dimensions={DIAGNOSIS_DIMENSIONS}
            intentIsOptimize={intent === 'optimize'}
            intentPrivacy={copy.privacyNote}
            usbGate={usbGate}
            token={getToken()}
            onPickPhone={pickPhone}
            onPickUsb={pickUsb}
            onPickCloud={pickCloud}
            onPaper={() => navigate('/scan')}
            onPhoneUploaded={handlePhoneUploaded}
            onPhoneBusy={setPhoneBusy}
            onPhoneCancelled={() => setPhoneCancelled(true)}
            onNewScan={() => setPhoneCancelled(false)}
            onUsbUploaded={handleUsbUploaded}
            onUsbBusy={setUsbBusy}
            onUsbListed={setUsbListed}
            onUsbPick={onUsbPick}
            onDropScan={dropScanHandoff}
            onRescan={() => navigate('/scan')}
            onChangeFile={changeFile}
            onUploadBox={handleUploadBoxClick}
            onLogin={() => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })}
            onMine={() => navigate('/me/resumes')}
            aiUnavailable={aiDown}
            onGenerate={() => navigate('/resume/generate')}
            onPrintOnly={() => navigate('/print-scan')}
          />
        ) : (
          <>
            <DiagnosisDirectionForm
              pane={step === 'more' ? 'more' : 'focus'}
              afterModes={step === 'direction' ? intentPaths : undefined}
              onOpenMore={() => setStep('more')}
              onSkipMore={clearMore}
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
            {step === 'direction' ? <AiDeclarationNote /> : null}
          </>
        )}
      </section>
    </ResumeTouchPage>
  )
}
