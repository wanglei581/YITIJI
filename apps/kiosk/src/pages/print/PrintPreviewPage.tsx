import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  VERIFIED_PRINT_PARAMETER_PROFILE,
  type ColorMode,
  type DuplexMode,
  type PrintJobParams,
  type PrintOrientation,
  type PrintQuality,
  type PrintScale,
} from '@ai-job-print/shared'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { usePrintParamCapability } from '../../hooks/usePrintParamCapability'
import { useAuth } from '../../auth/useAuth'
import { QxTouchStateEmpty } from '../../components/qingxu/touch/QxTouchStates'
import { PrintTouchFrame, printAsk } from './PrintTouchFrame'
import { PrintArt } from './art/PrintArt'
import { PrintIcon } from './art/PrintIcon'
import { FileThumbCard } from './components/FileThumbCard'

import {
  getPrintParamSuggestions,
  type PrintParamSuggestionItem,
  type PrintParamSuggestionView,
} from '../../services/api/materials'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { machineCannotPrintLine, preferUnattended, printProblemLine } from '../../copy/unattendedCopy'
import { printUploadPathForSource, type PrintFileState } from './printMaterialSession'
import { patchPrintHandoff, type PrintHandoffContext } from './printHandoff'
import { usePreviewPrintParams } from './usePreviewPrintParams'
import { computePrintUsageEstimate } from './printUsageEstimate'
import { countPagesInRange } from './pageRange'
import { materialRedactionBadge } from './piiRedaction'
import { isPrintDeskPreviewAuthorized, privacyPreviewGate } from './printDeskModel'
import { previewKindForFile } from './components/printPreviewKind'
import './styles/print-desk-qx.css'
import './styles/print-desk-touch.css'

const PREVIEW_ASK = {
  label: '问小青：选参数',
  draft: '帮我选打印参数：黑白还是彩色、单面还是双面？',
} as const

const EMPTY_ASK = {
  label: '问小青：文件要从哪传？',
  draft: '这一页没有待处理的文件。请说明文件可以从哪里传上来。不要假装已经收到文件。',
} as const

const PREVIEW_SUB = '第 3 步 / 共 4 步 · 核对内容与参数，下一步看价格'
const EMPTY_STEPS = ['选文件', '材料检查', '预览与参数', '核对价格'] as const

function EmptyPrintDesk({
  marker,
  problem,
  onPickFile,
  onDocuments,
}: {
  marker: 'print-material-check' | 'print-preview'
  problem: string | null
  onPickFile: () => void
  onDocuments: () => void
}) {
  return (
    <div className="pdt-empty" data-w2-page={marker} data-qx-state="missing-context">
      <p className="pdt-current-file"><strong>当前文件：无</strong></p>
      {problem ? <p data-print-handoff-problem="true">{problem}</p> : null}
      <QxTouchStateEmpty
        howto="文件还没选，或者上一位的文件已经清除。到这一步没有订单，也没有扣费。"
        stepsTitle="办理顺序"
        steps={[...EMPTY_STEPS]}
        slabs={[
          { title: '去选文件', desc: '手机、U 盘，把真实文件带进这次办理', onClick: onPickFile, visual: <PrintArt name="phone" size={86} /> },
          { title: '我的文档（登录后）', desc: '登录后才能看到你保存的文件', onClick: onDocuments, visual: <PrintArt name="stack" size={100} count={2} /> },
        ]}
        fine="这一页本身不保存文件"
      />
    </div>
  )
}

type PrintFile = PrintFileState

type SuggestionState =
  | { status: 'idle' | 'loading'; data: null; message: string | null }
  | { status: 'ready'; data: PrintParamSuggestionView; message: null }
  | { status: 'unavailable' | 'error'; data: PrintParamSuggestionView | null; message: string }

const COLOR_MODE_OPTIONS: Array<{ label: string; value: ColorMode }> = [
  { label: '黑白', value: 'black_white' },
  { label: '彩色', value: 'color' },
]

const DUPLEX_OPTIONS: Array<{ label: string; value: DuplexMode }> = [
  { label: '单面', value: 'simplex' },
  { label: '双面（长边）', value: 'duplex_long_edge' },
  { label: '双面（短边）', value: 'duplex_short_edge' },
]

function formatPageCount(pages: number | null): string {
  return pages === null ? '页数待识别' : `共 ${pages} 页`
}

function colorModeLabel(mode: ColorMode): string {
  return COLOR_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode
}

function duplexLabel(mode: DuplexMode): string {
  return DUPLEX_OPTIONS.find((option) => option.value === mode)?.label ?? mode
}

function ToggleGroup({
  options,
  value,
  onChange,
  disabled = false,
  disabledReason,
  describedById,
}: {
  options: Array<{ label: string; value: string }>
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  disabledReason?: string | null
  describedById?: string
}) {
  return (
    <div className="qpd-toggle pdk-seg" style={{ '--qpd-options': options.length } as React.CSSProperties}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-selected={value === option.value ? 'true' : undefined}
          aria-pressed={value === option.value}
          aria-disabled={disabled || undefined}
          aria-describedby={disabled && describedById ? describedById : undefined}
          title={disabled ? (disabledReason ?? undefined) : undefined}
          onClick={() => {
            if (!disabled) onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function suggestionValueLabel(item: PrintParamSuggestionItem): string {
  if (item.status !== 'suggested') return item.reason?.text ?? '需要手动设置'
  if (item.field === 'colorMode' && typeof item.suggestedValue === 'string') {
    return colorModeLabel(item.suggestedValue as ColorMode)
  }
  if (item.field === 'duplex' && typeof item.suggestedValue === 'string') {
    return duplexLabel(item.suggestedValue as DuplexMode)
  }
  if (item.field === 'copies') return `${item.suggestedValue} 份`
  if (item.field === 'pagesPerSheet') return `${item.suggestedValue} 页/张`
  return String(item.suggestedValue ?? '需要手动设置')
}

export function PrintPreviewPage({
  handoff = null,
  problem = null,
  onBackToCheck,
}: {
  /** 打印台读好的交接上下文（唯一的文件身份来源）；null = 这一页没有文件。 */
  handoff?: PrintHandoffContext | null
  /** 交接失效时的一句人话；不回显旧文件的任何信息。 */
  problem?: string | null
  onBackToCheck?: () => void
} = {}) {
  const navigate = useNavigate()
  const { getToken, isLoggedIn } = useAuth()
  const openDocuments = () => {
    if (isLoggedIn) navigate('/me/documents')
    else navigate('/login', { state: { from: '/me/documents' } })
  }

  const emptyFile: PrintFile = { name: '', size: '', pages: null }
  const file = handoff?.file ?? emptyFile
  const materialCheck = handoff?.materialCheck
  const redactionBadge = materialRedactionBadge(materialCheck?.redaction)
  const source = handoff?.source
  const uploadPath = printUploadPathForSource(source)
  const hasFile = Boolean(handoff)
  // 免检查的来源（AI 报告、优化稿、求职材料……服务端建单闸门本来就放行）直接进参数页。
  const exempt = handoff?.checkPolicy === 'exempt'
  const privacyGate = exempt ? { kind: 'ready' as const, confirmationLabel: null } : privacyPreviewGate(materialCheck, file)
  const materialCheckComplete = exempt || isPrintDeskPreviewAuthorized(materialCheck, file)
  const backToPrevious = () => (handoff?.returnPath ? navigate(handoff.returnPath) : navigate(-1))
  const [handoffError, setHandoffError] = useState<string | null>(null)

  const {
    printer,
    printerLabel,
    printerNotice,
    printerReady,
    kind: printerKind,
    loading: printerLoading,
  } = useTerminalDeviceStatus(hasFile && materialCheckComplete)

  const capability = usePrintParamCapability()
  const colorReason = (capability.color.reason ?? '').replace(/尚未通过真机验证|未验证/g, '暂未开通')
  const duplexReason = (capability.duplex.reason ?? '').replace(/尚未通过真机验证|未验证/g, '暂未开通')
  const capabilityUnknown = [colorReason, duplexReason].some((reason) => reason.startsWith('暂时无法确认本机打印能力'))
  const {
    copies, setCopies, colorMode, setColorMode, duplex, setDuplex, orientation, setOrientation,
    scale, setScale, pageRange, setPageRange, customRange, setCustomRange, capabilityNote,
  } = usePreviewPrintParams(handoff, capability)
  const quality: PrintQuality = 'standard'
  const pagesPerSheet = VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<SuggestionState>({ status: 'idle', data: null, message: null })
  const [suggestionApplied, setSuggestionApplied] = useState(false)
  const [privacyConfirmed, setPrivacyConfirmed] = useState(privacyGate.kind === 'ready')

  useEffect(() => {
    const taskId = materialCheck?.inspectionTaskId
    if (!materialCheckComplete || !taskId) return
    let cancelled = false
    setSuggestion({ status: 'loading', data: null, message: null })
    void getPrintParamSuggestions(taskId, {
      token: getToken(),
      accessToken: handoff?.inspectionTask?.accessToken,
    }).then((result) => {
      if (cancelled) return
      if (result.available) setSuggestion({ status: 'ready', data: result, message: null })
      else setSuggestion({
        status: 'unavailable',
        data: result,
        message: result.unavailableReason?.text ?? '参数建议暂不可用，请手动设置。',
      })
    }).catch((error) => {
      if (!cancelled) setSuggestion({ status: 'error', data: null, message: preferUnattended(userMessageOf(error, '参数建议读取失败，请手动设置。'), `参数建议没读到。请手动设置。${printProblemLine()}`) })
    })
    return () => { cancelled = true }
  }, [getToken, materialCheck?.inspectionTaskId, materialCheckComplete, handoff?.inspectionTask?.accessToken])

  // 参数一改就写回交接上下文（页码范围写得不对时先不写）：看门狗刷新、去报价再回来都还是这一组。
  const contextId = handoff?.contextId
  const rangeForStore = pageRange === 'all' ? undefined : customRange.trim() || undefined
  const rangeStorable = pageRange === 'all' || file.pages === null || countPagesInRange(customRange, file.pages) !== null
  useEffect(() => {
    if (!contextId || !materialCheckComplete || !rangeStorable) return
    patchPrintHandoff(contextId, {
      printParams: { copies, colorMode, duplex, paperSize: 'A4', pageRange: rangeForStore, orientation, quality: 'standard', scale, pagesPerSheet },
    })
  }, [contextId, materialCheckComplete, rangeStorable, copies, colorMode, duplex, rangeForStore, orientation, scale, pagesPerSheet])

  const warnings = useMemo(() => {
    const next: Array<{ id: string; level: 'error' | 'warn'; text: string }> = []
    if (printerNotice) {
      next.push({ id: 'queue-gate', level: 'error', text: printerNotice })
    } else if (printerKind === 'unknown' || printer.errorCode === 'statusUnknown') {
      next.push({ id: 'unknown', level: 'error', text: `打印机状态未知，请稍候。${printProblemLine()}` })
    } else if (printerKind === 'offline' || !printer.isOnline) {
      next.push({ id: 'offline', level: 'error', text: `打印机离线。${machineCannotPrintLine()}` })
    } else if (printer.errorCode === 'paperJam') {
      next.push({ id: 'jam', level: 'error', text: `打印机卡纸。${machineCannotPrintLine()}` })
    } else if (printer.errorCode === 'hardwareError' || printerKind === 'error') {
      next.push({ id: 'hardware', level: 'error', text: `打印机异常。${machineCannotPrintLine()}` })
    } else if (printer.errorCode === 'paperEmpty' || !printer.hasPaper) {
      next.push({ id: 'paper', level: 'error', text: `打印机缺纸。${machineCannotPrintLine()}` })
    }
    if (printerKind === 'low_paper') next.push({ id: 'low-paper', level: 'warn', text: '纸量偏低，建议补纸后再大批量打印' })
    return next
  }, [printer, printerKind, printerNotice])

  const hasBlockingWarning = warnings.some((warning) => warning.level === 'error') || !printerReady
  const selectedPages = useMemo(() => {
    if (file.pages === null || pageRange === 'all') return file.pages
    return countPagesInRange(customRange, file.pages)
  }, [customRange, file.pages, pageRange])
  const { totalFaces, sheetsUsed, paperSaved } = useMemo(
    () => computePrintUsageEstimate({ pages: selectedPages, copies, pagesPerSheet, duplex }),
    [copies, duplex, pagesPerSheet, selectedPages],
  )

  const applySuggestion = () => {
    if (suggestion.status !== 'ready') return
    for (const item of suggestion.data.items) {
      if (item.status !== 'suggested') continue
      if (item.field === 'copies' && typeof item.suggestedValue === 'number') {
        setCopies(Math.min(99, Math.max(1, Math.trunc(item.suggestedValue))))
      }
      if (item.field === 'colorMode' && typeof item.suggestedValue === 'string' && capability.color.allowed) {
        setColorMode(item.suggestedValue as ColorMode)
      }
      if (item.field === 'duplex' && typeof item.suggestedValue === 'string' && capability.duplex.allowed) {
        setDuplex(item.suggestedValue as DuplexMode)
      }
    }
    setSuggestionApplied(true)
  }

  const handleNext = () => {
    if (!materialCheckComplete || (privacyGate.kind === 'confirm' && !privacyConfirmed)) return
    if (pageRange === 'custom') {
      if (!customRange.trim()) {
        setRangeError('请输入页面范围，例如 1-3, 5, 7-9')
        return
      }
      if (file.pages !== null && countPagesInRange(customRange, file.pages) === null) {
        setRangeError('页码写法无效，或全部页码超出这份文件')
        return
      }
    }
    const params: PrintJobParams = {
      copies,
      colorMode,
      duplex,
      paperSize: 'A4',
      pageRange: pageRange === 'all' ? undefined : customRange.trim() || undefined,
      orientation,
      quality,
      scale,
      pagesPerSheet,
    }
    const materialCheckForNext = privacyGate.kind === 'confirm' && materialCheck?.redaction
      ? {
          ...materialCheck,
          redaction: materialCheck.redaction.claim === 'not_supported'
            ? { ...materialCheck.redaction, unredactedAcknowledgedAt: new Date().toISOString() }
            : { ...materialCheck.redaction, previewConfirmedAt: new Date().toISOString() },
        }
      : materialCheck
    // 只带交接编号去报价确认页；文件、参数、检查结论都在上下文里。
    const saved = contextId ? patchPrintHandoff(contextId, { file, materialCheck: materialCheckForNext, printParams: params }) : null
    if (!saved) {
      setHandoffError('这一单已失效，请重新发起。')
      return
    }
    navigate('/print/confirm', { state: { printContextId: saved.contextId } })
  }

  if (!hasFile) {
    return (
      <PrintTouchFrame
        page="print-check"
        legacyBody={false}
        kind="compact"
        seal={null}
        eyebrow="材料检查与预览"
        title="这一页没有待处理的文件"
        titleTag="h2"
        subtitle="先选好要打印的材料，再检查、再设参数。"
        status={{ tone: 'warn', label: '没有待处理的文件' }}
        back={{ label: '上一步', onBack: () => navigate(uploadPath) }}
        ask={printAsk(EMPTY_ASK.label, EMPTY_ASK.draft)}
        primary={{ label: '去选文件', onClick: () => navigate(uploadPath) }}
      >
        <EmptyPrintDesk
          marker="print-preview"
          problem={problem}
          onPickFile={() => navigate(uploadPath)}
          onDocuments={openDocuments}
        />
      </PrintTouchFrame>
    )
  }

  if (!materialCheckComplete) {
    const canRunCheck = Boolean(file.fileId)
    return (
      <PrintTouchFrame
        page="print-preview"
        legacyBody={false}
        kind="compact"
        seal={null}
        railNow={2}
        eyebrow="预览与参数"
        title="先完成材料检查"
        subtitle="请先完成文件和隐私检查，再设置打印参数。"
        status={{ tone: 'bad', label: '材料检查尚未完成' }}
        back={{ label: '上一步', onBack: () => navigate(uploadPath) }}
        ask={printAsk(PREVIEW_ASK.label, PREVIEW_ASK.draft)}
        primary={{
          label: canRunCheck ? '完成材料检查' : '重新选择文件',
          onClick: () => {
            if (canRunCheck && onBackToCheck) {
              onBackToCheck()
              return
            }
            navigate(canRunCheck ? '/print/desk?step=check' : uploadPath)
          },
        }}
      >
        <div className="pdk-preview" data-w2-page="print-preview" data-qx-state="check-required">
          <div className="qxt-reason-box" role="alert">
            <h2><PrintIcon name="shield" size={30} />不能跳过隐私预检直接打印</h2>
            <p className="qxt-reason">这份文件尚未完成材料检查，请检查后再继续。</p>
          </div>
          <div className="qxt-file">
            <span className="qxt-file-badge">待检查</span>
            <div>
              <b>{file.name}</b>
              <small>{file.size} · {formatPageCount(file.pages)}</small>
            </div>
          </div>
          <div className="qxt-sec">继续前必须完成</div>
          <ol className="qxt-steps qxt-steps-big pdk-unlock">
            {['读取真实文件体检结果。', '完成隐私片段检查与逐项裁决。', '等待遮挡处理返回真实结论。'].map((text, index) => (
              <li className="qxt-step" key={text}><span className="qxt-step-n">{index + 1}</span><b>{text}</b></li>
            ))}
          </ol>
        </div>
      </PrintTouchFrame>
    )
  }

  const directionLabel = orientation === 'auto' ? '方向自动' : orientation === 'portrait' ? '纵向' : '横向'
  const scaleLabel = scale === 'fit' ? '适合页面' : '实际大小'
  const rangeLabel = pageRange === 'all' ? (file.pages === null ? '全部页面' : `全部 ${file.pages} 页`) : `自定义 ${customRange || '待填写'}`
  const previewKind = previewKindForFile(file)
  const unsupported = previewKind === 'unsupported'
  const status = printerLoading
    ? { tone: 'warn' as const, label: '正在读取打印机状态' }
    : unsupported
      ? { tone: 'bad' as const, label: '当前文件不能预览打印' }
      : printerReady
        ? { tone: 'ok' as const, label: printerLabel }
        : printerNotice
          ? { tone: 'bad' as const, label: printerLabel }
          : printerKind === 'offline'
            ? { tone: 'bad' as const, label: '打印机离线' }
            : printerKind === 'error'
              ? { tone: 'bad' as const, label: '打印机异常' }
              : { tone: 'warn' as const, label: '打印机状态未知' }

  const previewTitle = unsupported
    ? '这份文件印不了'
    : printerLoading
      ? '正在读设备状态'
      : printerKind === 'offline'
        ? '打印机离线'
        : printerKind === 'error'
          ? '打印机异常'
          : !printerReady
            ? '打印机状态读不到'
            : capability.loading
              ? '本机能力还在确认'
              : capabilityUnknown
                ? '本机能力读不到'
                : !capability.color.allowed || !capability.duplex.allowed
                  ? '部分打印能力暂未开通'
                  : '纸上会长这样'
  const backToCheck = () => onBackToCheck ? onBackToCheck() : navigate('/print/desk?step=check')
  const blockingLine = printerLoading
    ? null
    : handoffError
      ? handoffError
      : unsupported
        ? '当前文件类型不能直接预览打印，请返回重新选择文件。'
        : hasBlockingWarning
          ? (warnings.find((warning) => warning.level === 'error')?.text ?? '打印机当前不可用，不能进入报价确认。')
          : null

  // Legacy gate markers: PrintPageFrame, KioskActionBar, step={3}.
  // The route now renders QxPageFrame and qx-ctabar while preserving the same business state.
  return (
    <PrintTouchFrame
      page="print-preview"
      legacyBody={false}
      kind="compact"
      seal={null}
      railNow={2}
      eyebrow="预览与参数"
      title={previewTitle}
      subtitle={PREVIEW_SUB}
      status={status}
      back={{
        label: '上一步',
        onBack: exempt ? backToPrevious : backToCheck,
      }}
      ask={printAsk(PREVIEW_ASK.label, PREVIEW_ASK.draft)}
      primary={{
        label: privacyGate.kind === 'confirm' && !privacyConfirmed
          ? '请先确认隐私处理结果'
          : printerLoading
            ? '设备检测中…'
            : printerNotice
              ? printerLabel
              : hasBlockingWarning
                ? '打印机不可用'
                : '下一步：核对价格',
        disabled: printerLoading || hasBlockingWarning || unsupported || (privacyGate.kind === 'confirm' && !privacyConfirmed),
        onClick: handleNext,
      }}
    >
      <div className="pdk-preview" data-w2-page="print-preview" data-qx-state={unsupported ? 'file-unsupported' : 'preview'}>
        <FileThumbCard file={file} token={getToken()} size="lg" pager>
          <span className="qpd-redaction-badge" data-tone={redactionBadge?.tone ?? 'warning'}>
            {exempt
              ? '系统生成的文件，不需要材料检查 · 请自行核对预览'
              : <>{materialCheck?.mode === 'demo' ? '材料检查流程演示完成' : '材料检查已完成'}
                {redactionBadge ? ` · ${redactionBadge.text}` : ' · 遮挡结果未知，请自行核对预览'}</>}
          </span>
        </FileThumbCard>
        {privacyGate.kind === 'confirm' ? (
          <label className="qpd-privacy-confirm pdk-privacy-confirm">
            <input
              type="checkbox"
              checked={privacyConfirmed}
              onChange={(event) => setPrivacyConfirmed(event.target.checked)}
            />
            <span>{privacyGate.confirmationLabel}</span>
          </label>
        ) : null}
        <section className="pdk-sug qpd-suggestion" data-suggestion-state={suggestion.status}>
          <div className="pdk-sug-tx">
            <b>按文件事实给出的参数建议</b>
            <p>按文件页数和纸张计算；采用后仍可修改。</p>
            {suggestion.status === 'loading' ? <p className="pdk-sug-note">正在准备参数建议…</p> : null}
            {suggestion.status === 'error' || suggestion.status === 'unavailable' ? <p className="pdk-sug-note">{suggestion.message}</p> : null}
            {suggestion.status === 'ready' ? (
              <div className="pdk-sug-items">{suggestion.data.items.map((item) => <span key={item.field}>{item.label} · {suggestionValueLabel(item)}</span>)}</div>
            ) : null}
          </div>
          {suggestion.status === 'ready' ? (
            <button className="qxt-btn qxt-btn-sec" type="button" onClick={applySuggestion}>{suggestionApplied ? '已采用，可继续修改' : '采用这些建议'}</button>
          ) : null}
        </section>
        <div className="pdk-facts-row" aria-label="用纸提示">
          <b>总打印面 {totalFaces === null ? '待识别，以实际打印为准' : `${totalFaces} 面`}</b>
          <b>预计用纸 {sheetsUsed === null ? '待识别，以实际打印为准' : `${sheetsUsed} 张`}</b>
        </div>
        {paperSaved > 0 ? <p className="pdk-opt">双面比单面预计少用 {paperSaved} 张纸</p> : null}
        <div className="pdk-params qpd-param-stack">
          <div className="pdk-prow qpd-param-card">
            <span>份数</span>
            <div className="pdk-stepx qpd-stepper">
              <button type="button" aria-label="减少十份" aria-disabled={copies <= 1 || undefined} onClick={() => { if (copies > 1) setCopies(Math.max(1, copies - 10)) }}>−10</button>
              <button type="button" aria-label="减少打印份数" aria-disabled={copies <= 1 || undefined} onClick={() => { if (copies > 1) setCopies(Math.max(1, copies - 1)) }}><PrintIcon name="minus" size={34} strokeWidth={2.6} /></button>
              <output aria-live="polite">{copies} 份</output>
              <button type="button" aria-label="增加打印份数" aria-disabled={copies >= 99 || undefined} onClick={() => { if (copies < 99) setCopies(Math.min(99, copies + 1)) }}><PrintIcon name="plus" size={34} strokeWidth={2.6} /></button>
              <button type="button" aria-label="增加十份" aria-disabled={copies >= 99 || undefined} onClick={() => { if (copies < 99) setCopies(Math.min(99, copies + 10)) }}>+10</button>
              <small className="pdk-cap">{copies === 1 ? '已经是最少的 1 份。' : copies === 99 ? '已经是最多的 99 份。' : ''}可选 1–99 份</small>
            </div>
          </div>
          <div className="pdk-prow qpd-param-card">
            <span>颜色</span>
            <div>
              <ToggleGroup options={COLOR_MODE_OPTIONS} value={colorMode} onChange={(value) => setColorMode(value as ColorMode)} disabled={!capability.color.allowed} disabledReason={colorReason} describedById="print-color-capability-note" />
              <p id="print-color-capability-note" className="pdk-why">{capability.color.allowed ? '彩色价格在下一步核对' : `彩色：${colorReason}`}{capabilityNote ? `；${capabilityNote}` : ''}</p>
            </div>
          </div>
          <div className="pdk-prow qpd-param-card">
            <span>单双面</span>
            <div>
              <ToggleGroup options={DUPLEX_OPTIONS} value={duplex} onChange={(value) => setDuplex(value as DuplexMode)} disabled={!capability.duplex.allowed} disabledReason={duplexReason} describedById="print-duplex-capability-note" />
              <p id="print-duplex-capability-note" className="pdk-why">{capability.duplex.allowed ? (duplex === 'simplex' ? '当前是单面。' : `翻页边：${duplex === 'duplex_long_edge' ? '长边' : '短边'}`) : `双面：${duplexReason}`}</p>
            </div>
          </div>
          <div className="pdk-prow qpd-param-card"><span>纸张</span><div className="pdk-ro qpd-readonly">A4（这台机器只打 A4）</div></div>
          <div className="pdk-prow qpd-param-card"><span>版面</span><div className="pdk-ro qpd-readonly">{pagesPerSheet} 版 / 页</div></div>
          <button type="button" className="pdk-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
            更多设置<span>{moreOpen ? '收起' : '展开'}</span>
          </button>
          {moreOpen ? (
            <>
              <div className="pdk-prow qpd-param-card qpd-orientation-scale"><span>方向</span>
                <ToggleGroup options={[{ label: '自动', value: 'auto' }, { label: '纵向', value: 'portrait' }, { label: '横向', value: 'landscape' }]} value={orientation} onChange={(value) => setOrientation(value as PrintOrientation)} />
              </div>
              <div className="pdk-prow qpd-param-card"><span>缩放</span>
                <ToggleGroup options={[{ label: '适合页面', value: 'fit' }, { label: '实际大小', value: 'actual' }]} value={scale} onChange={(value) => setScale(value as PrintScale)} />
              </div>
              <div className="pdk-prow qpd-param-card qpd-range-card"><span>页码</span>
                <div>
                  <ToggleGroup options={[{ label: file.pages === null ? '全部页面' : `全部 ${file.pages} 页`, value: 'all' }, { label: '自定义页码', value: 'custom' }]} value={pageRange} onChange={(value) => { setPageRange(value as 'all' | 'custom'); setRangeError(null) }} />
                  {pageRange === 'custom' ? <><input className="qpd-range-input pdk-range" aria-label="自定义页面范围" aria-invalid={Boolean(rangeError)} aria-describedby="print-range-explanation" value={customRange} onChange={(event) => { setCustomRange(event.target.value); setRangeError(null) }} placeholder="例：1-3, 5, 7-9" />{rangeError ? <p className="qpd-range-error" role="alert">{rangeError}</p> : null}</> : null}
                  <p className="qpd-range-detail pdk-why">这份文件{file.pages === null ? '页数待识别' : `共 ${file.pages} 页`}，{pageRange === 'all' ? '现在全部打印。' : selectedPages === null ? '请填写有效页码。' : `本次选中 ${selectedPages} 页。`}</p>
                  <p id="print-range-explanation" className="pdk-why">逗号分开不连续页；重叠范围会去重；超出文档的整段会忽略。</p>
                </div>
              </div>
            </>
          ) : null}
          <section className="pdk-summary qpd-parameter-summary" aria-label="参数摘要">
            <span>当前参数：A4 · {colorModeLabel(colorMode)} · {duplexLabel(duplex)} · {directionLabel} · {scaleLabel} · {pagesPerSheet} 版 / 页 · {rangeLabel} · {copies} 份。下一步核对价格，再决定是否打印；未确认前不会收费，文件保留时间以隐私政策和“我的文档”设置为准。</span>
          </section>
        </div>
        {warnings.length > 0 ? (
          <div className="qpd-warnings">
            {warnings.map((warning) => (
              <div className="qxt-remind qpd-warning" data-level={warning.level} key={warning.id}>
                <PrintIcon name="shield" size={34} /><span>{warning.text}</span>
              </div>
            ))}
          </div>
        ) : null}
        {blockingLine && !warnings.some((warning) => warning.level === 'error' && warning.text === blockingLine) ? <p className="pdt-block-line pdk-offnote">{blockingLine}</p> : null}
      </div>
    </PrintTouchFrame>
  )
}
