import { useRef, useState } from 'react'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { FileContentPreview } from '../../components/FileContentPreview'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { AlertCircleIcon, HomeIcon, SparklesIcon, UploadCloudIcon, UserIcon } from 'lucide-react'
import {
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { kioskUploadFile } from '../../services/api'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { ResumeSourceSummary } from './components/ResumeSourceSummary'
import { KIOSK_DEVICE_ORIGINAL_NOTICE } from '../../utils/kioskLocalPrivacy'
import {
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
} from '../../services/api/documentConversion'
import { clearAiResumeSession } from './aiResumeSession'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { DiagnosisDirectionForm, type DiagnosisDirectionFields } from './components/DiagnosisDirectionForm'
import { useUsbImportGate } from '../../hooks/useUsbImportGate'
import { ResumeUsbImportPanel, type ResumeUsbImportedFile } from './components/ResumeUsbImportPanel'
import { ResumeTriageHero } from './components/ResumeTriageHero'
import { heroCopy, type SourceHeroKey } from './components/resumeSourceHero'
import { ResumeScanReady } from './components/ResumeScanReady'
import { readScanHandoff } from './resumeScanHandoff'
import { ResumeIntentSwitch } from './components/ResumeIntentSwitch'
import { ResumeSourceCards } from './components/ResumeSourceCards'
import { ResumeExtraExits } from './components/ResumeExtraExits'
import { ResumeSourceActions } from './components/ResumeSourceActions'
import { ResumeUploadNotices } from './components/ResumeUploadNotices'
import { ResumeIndustrySheet } from './components/ResumeIndustrySheet'
import {
  formatSize,
  inferFormat,
  receivableFormatView,
  resolveResumeScreen,
  scanFileFrom,
  sourceFrameStatus,
  uploadErrorMessage,
  uploadOutcomeOf,
  type FileChannel,
  type ResumeScreen,
  type UploadChannel,
  type UploadedResumeFile,
} from './components/resumeSourceModel'
import './resume-triage-qx.css'
import './resume-triage-panels-qx.css'
import './resume-r1-qx2.css'

const RESUME_USB_UNCONFIGURED_NOTE = '这台机器暂未开通 U 盘导入。请改用手机扫码上传，或联系现场工作人员。'
const NO_FABRICATION_NOTE = '报告按六个维度分别给出建议。系统不会编造「超过多少人」「必然提分」等无法验证的结论。'
const BASE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const WORD_ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DEFAULT_SELECTED_DIMENSIONS: ResumeScoringDimensionKey[] = ['keyword', 'quantification', 'experience']
const MAX_BYTES = 10 * 1024 * 1024

function directedScreenRequest(): boolean {
  const requested = new URLSearchParams(window.location.search).get('screen')
  return requested === 'target' || requested === 'target-context' || requested === 'target-profile' || requested === 'target-industry'
}

export function ResumeSourcePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const intent = searchParams.get('intent') === 'optimize' ? 'optimize' : 'diagnose'
  const title = intent === 'optimize' ? 'AI 简历优化' : 'AI 简历诊断'
  const { getToken } = useAuth()
  const { capabilities: conversionCapabilities } = useDocumentConversionCapabilities()
  const wordConversionAvailable = conversionCapabilities.wordToPdf
  const accept = wordConversionAvailable ? `${BASE_ACCEPT},${WORD_ACCEPT}` : BASE_ACCEPT
  const fileInputRef = useRef<HTMLInputElement>(null)
  const industryAtOpen = useRef('')
  const kiosk = useTerminalKiosk()
  const usbGate = useUsbImportGate(RESUME_USB_UNCONFIGURED_NOTE)
  const [pickedChannel, setSelected] = useState<UploadChannel>(() => isTerminalKiosk() ? 'phone' : 'cloud')
  const selected = kiosk && pickedChannel === 'cloud' ? 'phone' : pickedChannel
  const [uploadedFile, setUploadedFile] = useState<UploadedResumeFile | null>(() => scanFileFrom(readScanHandoff(location.state)))
  const [uploading, setUploading] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [usbBusy, setUsbBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadUnknown, setUploadUnknown] = useState(false)
  const [genericDiagnosis, setGenericDiagnosis] = useState(() => !directedScreenRequest())
  const [selectedDimensions, setSelectedDimensions] = useState<ResumeScoringDimensionKey[]>(DEFAULT_SELECTED_DIMENSIONS)
  const [targetIndustry, setTargetIndustry] = useState('')
  const [targetJob, setTargetJob] = useState('')
  const [targetExperience, setTargetExperience] = useState<ResumeTargetContext['experience']>(undefined)
  const [targetScene, setTargetScene] = useState<ResumeTargetContext['scene']>(undefined)
  const [targetMajor, setTargetMajor] = useState('')
  const [targetDegree, setTargetDegree] = useState('')
  const sourceBusy = uploading || phoneBusy || usbBusy
  useBusyLock(sourceBusy)

  const rememberScreen = (next: ResumeScreen) => {
    setSearchParams((params) => { params.set('screen', next); return params }, { replace: true })
  }
  // 确认屏由「已经有文件」推出来，地址不放文件名，也不强行写 screen=summary。
  // 这样从解析页 replace 回来再后退，仍落在原来的 ?intent= 上。
  const releaseScreen = () => {
    if (!searchParams.get('screen')) return
    setSearchParams((params) => { params.delete('screen'); return params }, { replace: true })
  }
  const screen = resolveResumeScreen(searchParams.get('screen'), Boolean(uploadedFile) && !uploading && !uploadUnknown && !error)
  const openDirectionSettings = () => {
    setGenericDiagnosis(false)
    rememberScreen('target')
  }

  const toggleDimension = (key: ResumeScoringDimensionKey) => {
    setSelectedDimensions((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
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
  const handleSelect = (type: UploadChannel) => {
    if (isTerminalKiosk() && type === 'cloud') return
    if (type === 'usb' && usbGate.state !== 'allowed') return
    setError(null)
    if (type !== selected) {
      setUploadedFile(null)
      setUploadUnknown(false)
    }
    setSelected(type)
    if (type !== 'cloud') return
    fileInputRef.current?.click()
  }

  /*
   * 下面三个「选中了一份新文件」的处理器都会先调 clearAiResumeSession()，
   * 作废上一份简历的匿名结果会话（taskId + accessToken）。
   * 只在选中新文件时清，不挂在页面 mount / unmount 上。
   */
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isTerminalKiosk()) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
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
      if (typeof uploaded?.fileId !== 'string' || !uploaded.fileId) {
        setUploadUnknown(true)
        releaseScreen()
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
      releaseScreen()
    } catch (err) {
      if (uploadOutcomeOf(err) === 'unknown') setUploadUnknown(true)
      else setError(uploadErrorMessage(err))
      releaseScreen()
    } finally {
      setUploading(false)
    }
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    clearAiResumeSession()
    setUploadedFile({ ...file, fileUrl: file.fileUrl })
    setError(null)
    setUploadUnknown(false)
    releaseScreen()
  }

  const handleUsbUploaded = (file: ResumeUsbImportedFile) => {
    clearAiResumeSession()
    setUploadedFile(file)
    setError(null)
    setUploadUnknown(false)
    releaseScreen()
  }

  const handleStartDiagnosis = () => {
    if (!uploadedFile || uploading) return
    navigate('/resume/parse', {
      state: {
        intent,
        source: uploadedFile.channel === 'scan' ? 'scan' : 'upload',
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

  const changeFile = () => {
    const scan = uploadedFile?.channel === 'scan'
    setUploadedFile(null)
    setError(null)
    setUploadUnknown(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (scan) {
      const params = new URLSearchParams(location.search)
      params.delete('screen')
      const search = params.toString()
      navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true, state: null })
      return
    }
    releaseScreen()
  }
  const channelLabel = (channel: FileChannel) =>
    channel === 'usb' ? 'U盘上传' : channel === 'phone' ? '手机扫码上传' : channel === 'scan' ? '扫描工作台交接' : '本机文件'

  const scanReady = uploadedFile?.channel === 'scan'
  const heroKey: SourceHeroKey = screen === 'target' || screen === 'target-context' || screen === 'target-profile' || screen === 'target-industry'
    ? screen
    : uploading ? 'uploading'
      : uploadUnknown ? 'upload-unknown'
        : error ? 'upload-failed'
          : screen === 'summary' ? (scanReady ? 'scan-ready' : 'staged')
            : !uploadedFile && selected === 'usb' ? 'usb'
              : !uploadedFile && selected === 'phone' ? 'phone'
                : 'source'
  const hero = heroCopy(heroKey, intent)
  const formats = receivableFormatView(kiosk, wordConversionAvailable)
  const frameStatus = sourceFrameStatus({
    screen, uploading, receiving: phoneBusy || usbBusy, uploadUnknown, error: Boolean(error),
  })
  const target = buildTargetContext()
  const generic = target.skipped === true
  const formProps: DiagnosisDirectionFields = {
    intent, genericDiagnosis, selectedDimensions, targetIndustry, targetJob, targetExperience, targetScene, targetMajor, targetDegree,
    onGenericDiagnosisChange: setGenericDiagnosis, onToggleDimension: toggleDimension,
    onTargetIndustryChange: setTargetIndustry, onTargetJobChange: setTargetJob,
    onTargetExperienceChange: setTargetExperience, onTargetSceneChange: setTargetScene,
    onTargetMajorChange: setTargetMajor, onTargetDegreeChange: setTargetDegree,
    onOpenIndustry: () => { industryAtOpen.current = targetIndustry; rememberScreen('target-industry') },
    onOpenOfficialChannels: () => navigate('/official-channels'),
  }
  const contextPrimary = uploadedFile ? '用这些设置，回去确认' : '用这些设置，去取文件'
  const industryPrimary = targetIndustry ? '用所选门类继续' : '用『暂不指定』继续'

  return (
    <QxPageFrame
      title={title}
      subtitle={intent === 'optimize' ? '先完成必要诊断，再基于原文生成可编辑的优化版简历' : '上传简历文件，生成基于真实内容的结构化诊断报告'}
      status={frameStatus}
      terminalLabel="AI 简历服务"
      back={{ label: '返回 AI 简历服务', onBack: () => navigate('/resume-service') }}
      navbar={(
        <>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/')}>
            <HomeIcon size={32} aria-hidden="true" />首页
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')}>
            <SparklesIcon size={32} aria-hidden="true" />AI 顾问
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')}>
            <UserIcon size={32} aria-hidden="true" />我的
          </button>
        </>
      )}
      ctabar={(
        <>
          <QxStepActions onPrev={() => navigate('/resume-service')}>
            <QxAiHelp label="问小青：帮我选诊断重点 →" draft="请先问我的求职方向，帮我选择这次简历诊断应重点看的部分。" />
          </QxStepActions>
          {screen === 'source' ? (
            <ResumeSourceActions disabled={sourceBusy} onGeneric={() => setGenericDiagnosis(true)} onOpenWorkbench={openDirectionSettings} />
          ) : null}
          {screen === 'target' ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => rememberScreen('source')}>回到来源选择</button>
              <button type="button" className="qx-btn resume-primary-action" data-variant="primary" onClick={() => rememberScreen(genericDiagnosis ? 'source' : 'target-context')}>
                {genericDiagnosis ? '通用诊断，直接回来源选择' : '下一步：设目标岗位与背景'}
              </button>
            </>
          ) : null}
          {(screen === 'target-context' || screen === 'target-profile') ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => rememberScreen('target')}>上一步：诊断范围</button>
              <button type="button" className="qx-btn resume-primary-action" data-variant="primary" onClick={() => { if (uploadedFile) rememberScreen('summary'); else rememberScreen('source') }}>
                {contextPrimary}
              </button>
            </>
          ) : null}
          {screen === 'target-industry' ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => { setTargetIndustry(industryAtOpen.current); rememberScreen('target-context') }}>不改了，返回</button>
              <button type="button" className="qx-btn resume-primary-action" data-variant="primary" onClick={() => rememberScreen('target-context')}>{industryPrimary}</button>
            </>
          ) : null}
          {screen === 'summary' && uploadedFile ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={openDirectionSettings}>改诊断方向</button>
              <button type="button" className="qx-btn resume-change-file" data-variant="ghost" disabled={sourceBusy} onClick={changeFile}>更换文件</button>
              <span className="qx-ai-declaration-slot">
                <button type="button" className="qx-btn resume-primary-action" data-variant="primary" disabled={sourceBusy} onClick={handleStartDiagnosis}>
                  {intent === 'optimize' ? 'AI 优化，看改进建议' : 'AI 诊断，看改进建议'}
                </button>
                <AiDeclarationNote />
              </span>
            </>
          ) : null}
        </>
      )}
    >
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-source" data-intent={intent} data-state={heroKey} data-screen={screen} className="qx-resume-triage" data-takeaway="简历诊断报告">
      <ResumeTriageHero eyebrow={title} ask={hero.ask} doing={hero.doing} flag={hero.flag} warn={hero.warn} rail={['current', 'todo', 'todo', 'todo']} />
      {!kiosk && (
        <input ref={fileInputRef} type="file" aria-label="选择本机简历文件" accept={accept} className="hidden" onChange={handleFileChosen} />
      )}
      <div className="qx-scroll qx-rt-scroll">
        {screen === 'source' ? (
          <>
            <ResumeIntentSwitch heading="这次想让我做什么" intent={intent} disabled={sourceBusy} onChange={(value) => setSearchParams((params) => { params.set('intent', value); return params }, { replace: true })} />
            {!getToken() && (
              <p className="qx-rt-note" data-tone="warn">
                <b>当前未登录 · 这次按临时上传处理</b>
                简历属高度敏感文件，这台机器默认 1 小时清理，不进账号、不归档。登录后：U 盘 / 本机上传当场绑定账号存 90 天，手机扫码要在这台机器确认之后才绑定。
                <button type="button" onClick={() => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })}>去登录 →</button>
              </p>
            )}
            <ResumeSourceCards
              kiosk={kiosk} selected={selected} busy={sourceBusy}
              usbLocked={usbGate.state !== 'allowed'} usbNote={usbGate.note}
              showUsbRetry={usbGate.state === 'unknown' && selected !== 'usb'}
              onSelect={handleSelect} onRetryUsb={usbGate.retry}
            />
            <p className="qx-rt-fmt" data-testid="resume-format-line">
              <span>可接收：</span>
              {formats.tags.map((tag) => <i key={tag}>{tag}</i>)}
              <span>{formats.note}</span>
            </p>
            <div className="qx-rt-split">
              <div className="qx-rt-main">
                {uploadedFile ? (
                  <button type="button" className="qx-rt-alt" onClick={() => rememberScreen('summary')}>
                    <span><strong>这份文件已经收下</strong><small>{uploadedFile.name}</small></span>
                    <span className="go">去确认 →</span>
                  </button>
                ) : selected === 'phone' ? (
                  <div className="resume-source-phone-session qx-rt-phone">
                    <UploadSessionQrPanel onUploaded={handlePhoneUploaded} onBusyChange={setPhoneBusy} busyWhen="received" />
                  </div>
                ) : selected === 'usb' ? (
                  <div className="qx-rt-usb"><ResumeUsbImportPanel gate={usbGate} onUploaded={handleUsbUploaded} onBusyChange={setUsbBusy} /></div>
                ) : (
                  <button type="button" disabled={sourceBusy} onClick={() => { if (!isTerminalKiosk()) fileInputRef.current?.click() }} className="qx-rt-dropzone">
                    <span className="ico"><UploadCloudIcon className="h-8 w-8" aria-hidden="true" /></span>
                    <strong>点击上传文件</strong>
                    <span>{wordConversionAvailable ? '支持 PDF、DOC、DOCX 和图片格式，单个文件最大 10MB' : '支持 PDF / 图片格式，单个文件最大 10MB'}</span>
                  </button>
                )}
                <ResumeUploadNotices error={error} uploadUnknown={uploadUnknown} uploading={uploading} signedIn={Boolean(getToken())} />
                <p id="resume-word-conversion-reason" className="qx-rt-hint" aria-disabled={!wordConversionAvailable || undefined}>
                  {wordConversionAvailable ? `Word ${WORD_CONVERSION_DISCLOSURE}。` : 'Word 转换暂未开放，请另存为 PDF 再上传。'}
                </p>
              </div>
              <aside className="qx-rt-side">
                <h2 className="qx-rt-sec-h">这次的诊断方向与目标背景 <small>没有选择时按通用标准看</small></h2>
                {generic && <p className="qx-rt-hint">没选方向，按通用标准看</p>}
                <ResumeSourceSummary compact={!uploadedFile} generic={generic} dimensions={selectedDimensions} target={target} intent={intent} />
              </aside>
            </div>
            <ResumeExtraExits onGenerate={() => navigate('/resume/generate')} onPrint={() => navigate('/print-scan')} />
            <footer className="qx-rt-truth">
              <p className="resume-source-privacy"><b>用途 · 隐私</b>{intent === 'optimize' ? '简历原文仅用于本次解析、诊断与优化，不作为平台简历库沉淀。' : '简历原文仅用于本次解析和诊断，不作为平台简历库沉淀。'}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}</p>
              <p><b>留存</b>{KIOSK_DEVICE_ORIGINAL_NOTICE}</p>
            </footer>
          </>
        ) : null}

        {screen === 'summary' && uploadedFile ? (
          <>
            {scanReady ? <ResumeScanReady name={uploadedFile.name} size={uploadedFile.size} format={uploadedFile.format} onDrop={changeFile} onRescan={() => navigate('/scan')} /> : (
              <div className="qx-rt-filecard">
                <span className="fx">
                  <b>{uploadedFile.name}</b>
                  <small>{uploadedFile.format.toUpperCase()} · {uploadedFile.size} · 页数未返回 · {channelLabel(uploadedFile.channel)}</small>
                </span>
                <span className="fb">待你确认</span>
              </div>
            )}
            <ResumeSourceSummary generic={generic} dimensions={selectedDimensions} target={target} intent={intent} />
            <details className="qx-rt-preview">
              <summary>预览原件</summary>
              <FileContentPreview compact fileUrl={uploadedFile.fileUrl} fileName={uploadedFile.name} mimeType={uploadedFile.mimeType} format={uploadedFile.format} fileId={uploadedFile.fileId} token={getToken()} />
            </details>
          </>
        ) : null}

        {screen === 'target' ? (
          <DiagnosisDirectionForm part="focus" {...formProps} />
        ) : null}
        {(screen === 'target-context' || screen === 'target-profile') ? (
          <DiagnosisDirectionForm part="context" forceMore={screen === 'target-profile'} {...formProps} />
        ) : null}
        {screen === 'target-industry' ? <ResumeIndustrySheet value={targetIndustry} onChange={setTargetIndustry} /> : null}
        {screen === 'target' ? null : (
          <p className="qx-rt-note" data-tone="warn">
            <AlertCircleIcon size={18} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
            {NO_FABRICATION_NOTE}
          </p>
        )}
      </div>
    </section>
    </QxPageFrame>
  )
}
