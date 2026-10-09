import { useRef, useState } from 'react'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { FileContentPreview } from '../../components/FileContentPreview'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { AlertCircleIcon, UploadCloudIcon } from 'lucide-react'
import { kioskUploadFile } from '../../services/api'
import { ResumeSourceSummary } from './components/ResumeSourceSummary'
import { ResumeGuestNote, ResumeSourceNavbar, ResumeSourcePrivacy, ResumeSummaryFileCard } from './components/ResumeSourceChrome'
import {
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
} from '../../services/api/documentConversion'
import { clearAiResumeSession } from './aiResumeSession'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { DiagnosisDirectionForm, type DiagnosisDirectionFields } from './components/DiagnosisDirectionForm'
import { useUsbImportGate } from '../../hooks/useUsbImportGate'
import { ResumeUsbImportPanel, type ResumeUsbImportedFile } from './components/ResumeUsbImportPanel'
import { ResumeSourceChannels } from './components/ResumeSourceChannels'
import { sourcePhaseView, type UsbChannelPhase } from './components/resumeChannelCopy'
import { useLocalPickerCancel, type LocalChannelPhase } from './components/useLocalPickerCancel'
import { ResumeTriageHero } from './components/ResumeTriageHero'
import { type ResumeScoringDimensionKey, type ResumeTargetContext } from '@ai-job-print/shared'
import { readScanHandoff } from './resumeScanHandoff'
import { ResumeIntentSwitch } from './components/ResumeIntentSwitch'
import { ResumeSourceCards } from './components/ResumeSourceCards'
import { ResumeExtraExits } from './components/ResumeExtraExits'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { ResumeSourceActions } from './components/ResumeSourceActions'
import { ResumeUploadPanels } from './components/ResumeUploadPanels'
import { ResumeWithoutAi } from './components/ResumeWithoutAi'
import { ResumeTargetSendoff } from './components/ResumeTargetSendoff'
import { ResumeUnrecognized } from './components/ResumeUnrecognized'
import { ResumeIndustrySheet } from './components/ResumeIndustrySheet'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'
import {
  formatSize,
  inferFormat,
  receivableFormatView,
  resolveResumeScreen,
  scanFileFrom,
  uploadErrorMessage,
  uploadOutcomeOf,
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
  const retryFile = useRef<File | null>(null)
  const contact = useSupportContact()
  const kiosk = useTerminalKiosk()
  const usbGate = useUsbImportGate(RESUME_USB_UNCONFIGURED_NOTE)
  const [pickedChannel, setSelected] = useState<UploadChannel>(() => isTerminalKiosk() ? 'phone' : 'cloud')
  const selected = kiosk && pickedChannel === 'cloud' ? 'phone' : pickedChannel
  const [channelScreen, setChannelScreen] = useState<null | 'usb' | 'phone' | 'local'>(null)
  const [usbPhase, setUsbPhase] = useState<UsbChannelPhase>('usb-detecting')
  const [localPhase, setLocalPhase] = useState<LocalChannelPhase>('local-guide')
  useLocalPickerCancel(fileInputRef, channelScreen === 'local', () => setLocalPhase('local-cancelled'))
  const [heldFile, setHeldFile] = useState<UploadedResumeFile | null>(null)
  const [uploadedFile, setUploadedFile] = useState<UploadedResumeFile | null>(() => scanFileFrom(readScanHandoff(location.state)))
  const [uploading, setUploading] = useState(false)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [usbBusy, setUsbBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadUnknown, setUploadUnknown] = useState(false)
  const [uploadRecheck, setUploadRecheck] = useState(false)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [genericDiagnosis, setGenericDiagnosis] = useState(() => !directedScreenRequest())
  const [selectedDimensions, setSelectedDimensions] = useState<ResumeScoringDimensionKey[]>(['keyword', 'quantification', 'experience'])
  const [targetIndustry, setTargetIndustry] = useState('')
  const [targetJob, setTargetJob] = useState('')
  const [targetExperience, setTargetExperience] = useState<ResumeTargetContext['experience']>(undefined)
  const [targetScene, setTargetScene] = useState<ResumeTargetContext['scene']>(undefined)
  const [targetMajor, setTargetMajor] = useState('')
  const [targetDegree, setTargetDegree] = useState('')
  const toggleDimension = (key: ResumeScoringDimensionKey) => setSelectedDimensions((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  const buildTargetContext = (): ResumeTargetContext => {
    if (genericDiagnosis || ![targetIndustry, targetJob.trim(), targetExperience, targetScene, targetMajor.trim(), targetDegree.trim()].some(Boolean)) return { skipped: true }
    return { industry: targetIndustry || undefined, targetJob: targetJob.trim() || undefined, experience: targetExperience, scene: targetScene, major: targetMajor.trim() || undefined, degree: targetDegree.trim() || undefined, skipped: false }
  }
  const sourceBusy = uploading || phoneBusy || usbBusy
  useBusyLock(sourceBusy)

  const rememberScreen = (next: ResumeScreen) => setSearchParams((params) => { params.set('screen', next); return params }, { replace: true })
  // 确认屏不写 screen=summary，从解析页 replace 回来再后退，仍落在原来的 ?intent= 上。
  const releaseScreen = () => { if (!searchParams.get('screen')) return; setSearchParams((params) => { params.delete('screen'); return params }, { replace: true }) }
  const screen = resolveResumeScreen(searchParams.get('screen'), Boolean(uploadedFile) && !uploading && !uploadUnknown && !error)
  const openDirectionSettings = () => {
    setGenericDiagnosis(false)
    rememberScreen('target')
  }

  const leaveUnknown = () => { setUploadUnknown(false); setUploadRecheck(false); setPendingName(null); setError(null); releaseScreen() }
  const recheckUpload = () => {
    if (!uploadUnknown || uploadRecheck) return
    setUploadRecheck(true)
  }
  const handleSelect = (type: UploadChannel) => {
    if (isTerminalKiosk() && type === 'cloud') return
    if (type === 'usb' && usbGate.state !== 'allowed') return
    setError(null)
    if (uploadUnknown || uploadRecheck) {
      setUploadUnknown(false)
      setUploadRecheck(false)
      setPendingName(null)
      if (type !== selected) setUploadedFile(null)
      setSelected(type)
      return
    }
    if (type !== selected) {
      setUploadedFile(null)
      setUploadUnknown(false)
    }
    setHeldFile(null)
    setSelected(type)
    setChannelScreen(type === 'cloud' ? 'local' : type)
    if (type === 'cloud') setLocalPhase('local-guide')
  }
  const closeChannel = () => {
    setChannelScreen(null)
    setHeldFile(null)
    setLocalPhase('local-guide')
    setError(null)
    setSelected(isTerminalKiosk() ? 'phone' : 'cloud')
  }
  const openLocalPicker = () => {
    setError(null)
    setLocalPhase('local-guide')
    fileInputRef.current?.click()
  }
  const usePhoneChannel = () => {
    setHeldFile(null)
    setError(null)
    setSelected('phone')
    setChannelScreen('phone')
  }
  const continueHeld = () => {
    if (!heldFile) return
    setUploadedFile(heldFile)
    setHeldFile(null)
    setChannelScreen(null)
    releaseScreen()
  }

  // 选中新文件才清上一份匿名结果。不挂在 mount / unmount 上。
  const acceptLocalFile = async (file: File) => {
    if (isTerminalKiosk()) return
    const guidedLocal = channelScreen === 'local'
    setUploadedFile(null)
    setHeldFile(null)
    setUploadUnknown(false)
    setUploadRecheck(false)
    setPendingName(file.name)
    if (guidedLocal && file.size === 0) {
      retryFile.current = null
      setLocalPhase('local-unreadable')
      setError('文件为空或大小未知')
      return
    }
    if (file.size > MAX_BYTES) {
      retryFile.current = file
      setError(`文件超过 10MB(${formatSize(file.size)}),请压缩后重试`)
      if (guidedLocal) setLocalPhase('local-oversize')
      return
    }
    retryFile.current = file
    setError(null)
    setUploading(true)
    clearAiResumeSession()
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      if (typeof uploaded?.fileId !== 'string' || !uploaded.fileId) {
        retryFile.current = null
        setUploadUnknown(true)
        releaseScreen()
        return
      }
      retryFile.current = null
      setPendingName(null)
      const received = {
        name: uploaded.filename, size: formatSize(uploaded.sizeBytes),
        format: inferFormat(uploaded.mimeType || uploaded.filename), fileId: uploaded.fileId,
        fileUrl: uploaded.signedUrl, mimeType: uploaded.mimeType, channel: selected,
      }
      if (guidedLocal) { setHeldFile(received); setLocalPhase('local-ready') } else setUploadedFile(received)
      releaseScreen()
    } catch (err) {
      if (uploadOutcomeOf(err) === 'unknown') {
        retryFile.current = null
        setUploadUnknown(true)
      } else setError(uploadErrorMessage(err))
      if (guidedLocal) setChannelScreen(null)
      releaseScreen()
    } finally {
      setUploading(false)
    }
  }
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isTerminalKiosk()) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    clearAiResumeSession()
    await acceptLocalFile(file)
  }
  const retryUpload = () => {
    const file = retryFile.current
    if (!file || uploadUnknown || uploadRecheck) return
    void acceptLocalFile(file)
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    clearAiResumeSession()
    setUploadedFile({ ...file, fileUrl: file.fileUrl })
    setError(null); setUploadUnknown(false); releaseScreen()
  }

  const handleUsbUploaded = (file: ResumeUsbImportedFile) => {
    clearAiResumeSession()
    setHeldFile(file)
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
          name: uploadedFile.name, size: uploadedFile.size, format: uploadedFile.format,
          fileUrl: uploadedFile.fileUrl, mimeType: uploadedFile.mimeType,
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
  const channelLabel = (channel: UploadedResumeFile['channel']) => channel === 'usb' ? 'U盘上传' : channel === 'phone' ? '手机扫码上传' : channel === 'scan' ? '扫描工作台交接' : '本机文件'
  const scanReady = uploadedFile?.channel === 'scan'
  const phase = sourcePhaseView({
    screen, intent, uploading, uploadRecheck, uploadUnknown, error, scanReady,
    hasFile: Boolean(uploadedFile), selected, channelScreen, held: Boolean(heldFile),
    usbPhase, localPhase, receiving: phoneBusy || usbBusy,
  })
  const formats = receivableFormatView(kiosk, wordConversionAvailable)
  const helpLine = helpNeededLine(contact)
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
  const industryLabel = targetIndustry.trim() || '暂不指定'
  const industryPrimary = `用「${industryLabel}」继续`
  const uploadBusyPanel = uploading || uploadUnknown || uploadRecheck || Boolean(error)
  const changeFileLabel = '换一份文件'

  return (
    <QxPageFrame
      title={title}
      subtitle={intent === 'optimize' ? '先完成必要诊断，再基于原文生成可编辑的优化版简历' : '上传简历文件，生成基于真实内容的结构化诊断报告'}
      status={phase.frameStatus}
      terminalLabel="AI 简历服务"
      back={{ label: '返回 AI 简历服务', onBack: () => navigate('/resume-service') }}
      navbar={<ResumeSourceNavbar />}
      ctabar={(
        <>
          <QxStepActions onPrev={() => navigate('/resume-service')}>
            <QxAiHelp label="问小青：帮我选诊断重点 →" draft="请先问我的求职方向，帮我选择这次简历诊断应重点看的部分。" />
          </QxStepActions>
          {screen === 'source' ? (
            !channelScreen && !uploadBusyPanel ? <ResumeSourceActions disabled={sourceBusy} onGeneric={() => setGenericDiagnosis(true)} onOpenWorkbench={openDirectionSettings} /> : null
          ) : null}
          {screen === 'source' && channelScreen && !phase.usbOffline ? (
            <button type="button" className="qx-btn" data-variant="ghost" onClick={closeChannel}>回到来源选择</button>
          ) : null}
          {screen === 'source' && uploading ? <p className="qx-rt-ctxstrip">{helpLine}</p> : null}
          {screen === 'source' && error && !(channelScreen === 'local' && (localPhase === 'local-oversize' || localPhase === 'local-unreadable')) ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => fileInputRef.current?.click()}>{changeFileLabel}</button>
              <button type="button" className="qx-btn" data-variant="primary" onClick={retryUpload}>重试上传</button>
            </>
          ) : null}
          {screen === 'source' && (uploadUnknown || uploadRecheck) ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={leaveUnknown}>换一种来源</button>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume-service')}>先离开这一步</button>
              {uploadUnknown && !uploadRecheck
                ? <button type="button" className="qx-btn" data-variant="primary" onClick={recheckUpload}>再查刚才这一次的结果</button>
                : <p className="qx-rt-ctxstrip">{helpLine}</p>}
            </>
          ) : null}
          {screen === 'unknown' ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')}>回首页</button>
              <button type="button" className="qx-btn" data-variant="primary" onClick={() => rememberScreen('source')}>返回来源选择</button>
            </>
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
              <button type="button" className="qx-btn resume-change-file" data-variant="ghost" disabled={sourceBusy} onClick={changeFile}>{changeFileLabel}</button>
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
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-source" data-intent={intent} data-state={phase.stateAttr} data-screen={screen} data-dock={screen === 'target-context' || screen === 'target-profile' ? 'sendoff' : undefined} className="qx-resume-triage" data-takeaway="简历诊断报告">
      <ResumeTriageHero eyebrow={title} ask={phase.hero.ask} doing={phase.hero.doing} flag={phase.hero.flag} warn={phase.hero.warn} rail={['current', 'todo', 'todo', 'todo']} />
      {!kiosk && (
        <input ref={fileInputRef} type="file" aria-label="选择本机简历文件" accept={accept} className="hidden" onChange={handleFileChosen} />
      )}
      <div className="qx-scroll qx-rt-scroll">
        {screen === 'unknown' ? (
          <ResumeUnrecognized helpLine={helpLine} onSource={() => rememberScreen('source')} onHome={() => navigate('/')} onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} onGenerate={() => navigate('/resume/generate')} onPrint={() => navigate('/print-scan')} />
        ) : null}
        <ResumeSourceChannels
          screen={screen} channelScreen={channelScreen} heldFile={heldFile} localPhase={localPhase}
          uploading={uploading} pendingName={pendingName} error={error} wordOpen={wordConversionAvailable}
          usbGate={usbGate} helpLine={helpLine}
          onPhoneUploaded={handlePhoneUploaded} onPhoneBusy={setPhoneBusy}
          onUsbUploaded={handleUsbUploaded} onUsbBusy={setUsbBusy} onUsbPhase={setUsbPhase}
          onOpenPicker={openLocalPicker} onUsePhone={usePhoneChannel} onContinue={continueHeld} onLeave={closeChannel}
        />
        {screen === 'source' && !channelScreen ? (
          <>
            <ResumeIntentSwitch heading="这次想让我做什么" intent={intent} disabled={sourceBusy} onChange={(value) => setSearchParams((params) => { params.set('intent', value); return params }, { replace: true })} />
            <ResumeGuestNote />
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
                ) : uploadBusyPanel ? (
                  <ResumeUploadPanels
                    error={error} uploadUnknown={uploadUnknown} uploadRecheck={uploadRecheck} uploading={uploading}
                    signedIn={Boolean(getToken())} pendingName={pendingName} helpLine={helpLine}
                  />
                ) : (
                  <button type="button" disabled={sourceBusy} onClick={() => { if (!isTerminalKiosk()) { setLocalPhase('local-guide'); setChannelScreen('local') } }} className="qx-rt-dropzone">
                    <span className="ico"><UploadCloudIcon className="h-8 w-8" aria-hidden="true" /></span>
                    <strong>点击上传文件</strong>
                    <span>{wordConversionAvailable ? '支持 PDF、DOC、DOCX 和图片格式，单个文件最大 10MB' : '支持 PDF / 图片格式，单个文件最大 10MB'}</span>
                  </button>
                )}
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
            <ResumeSourcePrivacy intent={intent} />
          </>
        ) : null}

        {screen === 'summary' && uploadedFile ? (
          <>
            <ResumeSummaryFileCard scanReady={scanReady} name={uploadedFile.name} size={uploadedFile.size} format={uploadedFile.format} channel={channelLabel(uploadedFile.channel)} onDrop={changeFile} onRescan={() => navigate('/scan')} />
            <ResumeSourceSummary generic={generic} dimensions={selectedDimensions} target={target} intent={intent} />
            <ResumeWithoutAi onGenerate={() => navigate('/resume/generate')} onPrint={() => navigate('/print-scan')} />
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
        {screen === 'target' || screen === 'unknown' ? null : (
          <p className="qx-rt-note" data-tone="warn">
            <AlertCircleIcon size={18} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
            {NO_FABRICATION_NOTE}
          </p>
        )}
      </div>
      {(screen === 'target-context' || screen === 'target-profile') ? (
        <ResumeTargetSendoff generic={genericDiagnosis} intent={intent} selectedDimensions={selectedDimensions} targetIndustry={targetIndustry} targetJob={targetJob} targetExperience={targetExperience} targetScene={targetScene} targetMajor={targetMajor} targetDegree={targetDegree} />
      ) : null}
    </section>
    </QxPageFrame>
  )
}
