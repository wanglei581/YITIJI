import { useRef, useState } from 'react'
import { isTerminalKiosk } from '../../services/api/screensaver'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import './resume-triage-qx.css'

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

const BASE_SUPPORTED_FORMATS = ['PDF', 'JPG', 'PNG', 'WEBP']
const BASE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const WORD_ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 稿 21 小青任务头的四步轨；本页是第 1 步。 */
const RESUME_FLOW_STEPS = ['上传与方向', 'AI 解析', '诊断报告', '优化打印']

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
  const { capabilities: conversionCapabilities } = useDocumentConversionCapabilities()
  const wordConversionAvailable = conversionCapabilities.wordToPdf
  const supportedFormats = wordConversionAvailable
    ? ['PDF', 'DOC', 'DOCX', ...BASE_SUPPORTED_FORMATS.slice(1)]
    : BASE_SUPPORTED_FORMATS
  const accept = wordConversionAvailable ? `${BASE_ACCEPT},${WORD_ACCEPT}` : BASE_ACCEPT
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

  // 顶栏状态胶囊只报本机真实可知的状态：忙碌 / 文件已就绪 / 还没有文件。拿不到的一律不报「正常」。
  const frameStatus = sourceBusy
    ? { tone: 'warn' as const, label: uploading ? '上传中' : '接收中' }
    : uploadedFile
      ? { tone: 'ok' as const, label: '文件已就绪' }
      : { tone: 'unknown' as const, label: '等待简历文件' }
  const channelLabel = (channel: UploadChannel) =>
    channel === 'usb' ? 'U盘上传' : channel === 'phone' ? '手机扫码上传' : '云端上传'

  return (
    <QxPageFrame
      title={copy.title}
      subtitle={copy.subtitle}
      status={frameStatus}
      terminalLabel="AI 简历服务"
      back={{ label: '返回 AI 简历服务', onBack: () => navigate('/resume-service') }}
      ctabar={(
        <>
          {uploadedFile ? (
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
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-source" data-intent={intent} className="qx-resume-triage">
      {/* 稿 21 小青任务头：AI 驱动层在这里表达（✦ 旗标 + 小青的话），四步轨当前在第 1 步。
          页面 h1 仍是 QxPageFrame 页头的 copy.title，这里不再另起标题。 */}
      <header className="qx-rt-xq">
        <div className="qx-rt-xq-row">
          <span className="qx-rt-face" aria-hidden="true">青</span>
          <div className="qx-rt-xq-main">
            <p className="qx-rt-eyebrow">{intent === 'optimize' ? 'AI RESUME OPTIMIZE' : 'AI RESUME DIAGNOSE'}</p>
            <p className="qx-rt-title">简历这趟，先<em>把文件交给我</em>。</p>
            <p className="qx-rt-doing">选一种来源把简历送进来，方向和背景都点选完成；上传后 AI 自动解析结构、识别问题。</p>
          </div>
          <span className="qx-rt-flag">✦ AI 驱动</span>
        </div>
        <ol className="qx-rt-rail" aria-label="简历服务流程：上传与方向、AI 解析、诊断报告、优化打印">
          {RESUME_FLOW_STEPS.map((step, i) => (
            <li key={step} aria-current={i === 0 ? 'step' : undefined}><i>{i + 1}</i>{step}</li>
          ))}
        </ol>
      </header>

      <p className="qx-rt-note" role="note">{KIOSK_DEVICE_ORIGINAL_NOTICE}</p>
      <p className="qx-rt-note resume-source-privacy" role="note">
        <b>隐私保护</b>{copy.privacyNote}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        aria-label="选择本机简历文件"
        accept={accept}
        className="hidden"
        onChange={handleFileChosen}
      />

      <div className="qx-scroll qx-rt-scroll">
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

        <div className="qx-rt-split">
          <div className="qx-rt-main">
            {selected === 'phone' ? (
              <div className="resume-source-phone-session">
                <UploadSessionQrPanel onUploaded={handlePhoneUploaded} onBusyChange={setPhoneBusy} />
              </div>
            ) : selected === 'usb' ? (
              <ResumeUsbImportPanel onUploaded={handleUsbUploaded} onBusyChange={setUsbBusy} />
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
            {!wordConversionAvailable && (
              <p id="resume-word-conversion-reason" className="qx-rt-hint">
                {conversionCapabilities.reason || '转换引擎未就绪；服务恢复并通过能力探测后会自动开放。'}
              </p>
            )}
            {uploadedFile && (
              <FileContentPreview
                compact
                fileUrl={uploadedFile.fileUrl}
                fileName={uploadedFile.name}
                mimeType={uploadedFile.mimeType}
                format={uploadedFile.format}
                fileId={uploadedFile.fileId}
                token={getToken()}
              />
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

        {/*
          维度清单默认收起（R5）：主 CTA 现在固定在 ctabar，但这张卡仍是页面上最高的
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

      {error && (
        <p className="qx-rt-note resume-source-error" data-tone="error" role="alert">{error}</p>
      )}

      {uploading && (
        <p className="qx-rt-note resume-source-status" role="status">上传中，请稍候…</p>
      )}
    </section>
    </QxPageFrame>
  )
}
