import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  FileTextIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  SparklesIcon,
  WifiOffIcon,
} from 'lucide-react'
import {
  hasUnverifiedPrintParams,
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
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { FileContentPreview } from '../../components/FileContentPreview'
import {
  isWordDocument,
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
  WORD_CONVERSION_UNAVAILABLE_COPY,
} from '../../services/api/documentConversion'
import {
  getPrintParamSuggestions,
  type PrintParamSuggestionItem,
  type PrintParamSuggestionView,
} from '../../services/api/materials'
import { userMessageOf } from '../../services/api/userErrorMessage'
import {
  patchPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'
import { computePrintUsageEstimate } from './printUsageEstimate'
import { countPagesInRange } from './pageRange'
import { materialRedactionBadge } from './piiRedaction'
import './styles/print-desk-qx.css'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}

type PrivacyPreviewGate =
  | { kind: 'ready'; confirmationLabel: null }
  | { kind: 'confirm'; confirmationLabel: string }
  | { kind: 'blocked'; confirmationLabel: null }

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

function privacyPreviewGate(
  materialCheck: MaterialCheckSummary | undefined,
  file: PrintFile,
): PrivacyPreviewGate {
  const redaction = materialCheck?.redaction
  if (!redaction?.claim) return { kind: 'blocked', confirmationLabel: null }

  if (redaction.claim === 'nothing_to_redact') {
    return { kind: 'ready', confirmationLabel: null }
  }

  if (redaction.claim === 'not_supported') {
    return redaction.unredactedAcknowledgedAt
      ? { kind: 'ready', confirmationLabel: null }
      : {
          kind: 'confirm',
          confirmationLabel: '我已逐页核对预览，知道本机没有生成遮挡文件，仍确认使用原文件',
        }
  }

  const isUsingDerivedFile = Boolean(redaction.redactedFileId && file.fileId === redaction.redactedFileId)
  if (!isUsingDerivedFile) return { kind: 'blocked', confirmationLabel: null }
  if (redaction.previewConfirmedAt) return { kind: 'ready', confirmationLabel: null }

  const remaining = redaction.reverifyRemainingCount
  if (remaining !== null && remaining > 0) {
    return {
      kind: 'confirm',
      confirmationLabel: `我已逐页核对预览，知道仍检出 ${remaining} 处未盖住，仍确认继续`,
    }
  }
  if (redaction.claim === 'partial') {
    return {
      kind: 'confirm',
      confirmationLabel: '我已逐页核对预览，知道有片段未能定位，仍确认继续',
    }
  }
  if (redaction.claim === 'redacted_unverified') {
    return {
      kind: 'confirm',
      confirmationLabel: '我已逐页核对预览，知道机器复检未完成，仍确认继续',
    }
  }
  return {
    kind: 'confirm',
    confirmationLabel: '我已逐页核对遮挡后的文件，确认可以继续',
  }
}

function previewKindForFile(file: PrintFile): 'pdf' | 'image' | 'word' | 'unsupported' | 'unavailable' {
  if (isWordDocument({ fileName: file.name, mimeType: file.mimeType })) return 'word'
  if (!file.fileUrl || file.fileUrl.startsWith('/mock/')) return 'unavailable'
  const mimeType = file.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image'
  return 'unsupported'
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
    <div className="qpd-toggle" style={{ '--qpd-options': options.length } as React.CSSProperties}>
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

function FilePreviewPanel({ file, token }: { file: PrintFile; token: string | null }) {
  const { capabilities } = useDocumentConversionCapabilities()
  const previewKind = previewKindForFile(file)

  return (
    <>
      <div className="relative flex max-h-[min(56vh,860px)] min-h-[620px] qpd-preview-shell rounded-xl border border-neutral-200 bg-neutral-50">
        {previewKind === 'pdf' ? <iframe className="max-h-full" title={`${file.name} 预览`} src={file.fileUrl} /> : null}
        {previewKind === 'image' ? <img className="max-h-full" src={file.fileUrl} alt={`${file.name} 预览`} /> : null}
        {previewKind === 'word' ? (
          <FileContentPreview
            fileUrl={file.fileUrl}
            fileName={file.name}
            mimeType={file.mimeType}
            fileId={file.fileId}
            token={token}
          />
        ) : null}
        {previewKind === 'unsupported' || previewKind === 'unavailable' ? (
          <div className="qpd-preview-fallback">
            <FileTextIcon aria-hidden="true" />
            <strong>{file.name}</strong>
            <p>
              {previewKind === 'unavailable'
                ? '当前没有可用的预览地址。文件仍在本次办理中，但不能据此声称预览成功。'
                : '当前文件类型不能在浏览器内直接预览。请返回重新选择 PDF、JPG 或 PNG。'}
            </p>
          </div>
        ) : null}
        <span className="qpd-preview-label">文件预览</span>
      </div>
      <div className="qpd-conversion-note">
        {capabilities.wordToPdf
          ? `PDF、图片和 Word 可预览；Word ${WORD_CONVERSION_DISCLOSURE}。`
          : `PDF 和图片可预览；${WORD_CONVERSION_UNAVAILABLE_COPY}。${capabilities.reason || '转换引擎未就绪'}。`}
      </div>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="qpd-fact"><span>{label}</span><strong>{value}</strong></div>
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

export function PrintPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const locationState = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])

  const emptyFile: PrintFile = { name: '', size: '', pages: null }
  const file = locationState?.file ?? restoredSession?.file ?? emptyFile
  const materialCheck = locationState?.materialCheck ?? restoredSession?.materialCheck
  const redactionBadge = materialRedactionBadge(materialCheck?.redaction)
  const restoredPrintParams = restoredSession?.printParams
  const restoredParamsWereRestricted = restoredPrintParams ? hasUnverifiedPrintParams(restoredPrintParams) : false
  const source = locationState?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  const hasFile = Boolean(locationState?.file || restoredSession?.file)
  const privacyGate = privacyPreviewGate(materialCheck, file)
  const materialCheckTasksComplete = Boolean(
    materialCheck?.inspectionTaskId &&
    materialCheck.piiTaskId &&
    materialCheck.piiRedactTaskId,
  )
  const materialCheckComplete = materialCheckTasksComplete && privacyGate.kind !== 'blocked'

  const {
    printerName,
    printer,
    printerLabel,
    printerReady,
    kind: printerKind,
    loading: printerLoading,
  } = useTerminalDeviceStatus(hasFile && materialCheckComplete)

  const capability = usePrintParamCapability()
  const [copies, setCopies] = useState(restoredPrintParams?.copies ?? 1)
  const [colorMode, setColorMode] = useState<ColorMode>(VERIFIED_PRINT_PARAMETER_PROFILE.colorMode)
  const [duplex, setDuplex] = useState<DuplexMode>(VERIFIED_PRINT_PARAMETER_PROFILE.duplex)
  const [orientation, setOrientation] = useState<PrintOrientation>(restoredPrintParams?.orientation ?? 'auto')
  const [scale, setScale] = useState<PrintScale>(restoredPrintParams?.scale ?? 'fit')
  const [pageRange, setPageRange] = useState<'all' | 'custom'>(
    restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? 'custom' : 'all',
  )
  const quality: PrintQuality = 'standard'
  const pagesPerSheet = VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet
  const [customRange, setCustomRange] = useState(
    restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? restoredPrintParams.pageRange : '',
  )
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<SuggestionState>({ status: 'idle', data: null, message: null })
  const [suggestionApplied, setSuggestionApplied] = useState(false)
  const [privacyConfirmed, setPrivacyConfirmed] = useState(privacyGate.kind === 'ready')

  useEffect(() => {
    if (!capability.color.allowed && colorMode !== 'black_white') setColorMode('black_white')
    if (!capability.duplex.allowed && duplex !== 'simplex') setDuplex('simplex')
  }, [capability.color.allowed, capability.duplex.allowed, colorMode, duplex])

  useEffect(() => {
    const taskId = materialCheck?.inspectionTaskId
    if (!materialCheckComplete || !taskId) return
    let cancelled = false
    setSuggestion({ status: 'loading', data: null, message: null })
    void getPrintParamSuggestions(taskId, {
      token: getToken(),
      accessToken: restoredSession?.inspectionTask?.accessToken,
    }).then((result) => {
      if (cancelled) return
      if (result.available) setSuggestion({ status: 'ready', data: result, message: null })
      else setSuggestion({
        status: 'unavailable',
        data: result,
        message: result.unavailableReason?.text ?? '参数建议暂不可用，请手动设置。',
      })
    }).catch((error) => {
      if (!cancelled) setSuggestion({ status: 'error', data: null, message: userMessageOf(error, '参数建议读取失败，请手动设置。') })
    })
    return () => { cancelled = true }
  }, [getToken, materialCheck?.inspectionTaskId, materialCheckComplete, restoredSession?.inspectionTask?.accessToken])

  const warnings = useMemo(() => {
    const next: Array<{ id: string; level: 'error' | 'warn'; text: string }> = []
    if (printerKind === 'unknown' || printer.errorCode === 'statusUnknown') {
      next.push({ id: 'unknown', level: 'error', text: '打印机状态未知，请稍候或联系工作人员' })
    } else if (printerKind === 'offline' || !printer.isOnline) {
      next.push({ id: 'offline', level: 'error', text: '打印机离线，请联系工作人员' })
    } else if (printer.errorCode === 'paperJam') {
      next.push({ id: 'jam', level: 'error', text: '打印机卡纸，请联系工作人员处理后再打印' })
    } else if (printer.errorCode === 'hardwareError' || printerKind === 'error') {
      next.push({ id: 'hardware', level: 'error', text: '打印机异常，请联系工作人员检查后再打印' })
    } else if (printer.errorCode === 'paperEmpty' || !printer.hasPaper) {
      next.push({ id: 'paper', level: 'error', text: '打印机缺纸，请联系工作人员补纸' })
    }
    if (printerKind === 'low_paper') next.push({ id: 'low-paper', level: 'warn', text: '纸量偏低，建议补纸后再大批量打印' })
    return next
  }, [printer, printerKind])

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
    {
      const materialCheck = materialCheckForNext
      patchPrintMaterialSession({ file, materialCheck, printParams: params })
      navigate('/print/confirm', { state: { file, params, materialCheck, source } })
    }
  }

  if (!hasFile) {
    return (
      <QxPageFrame
        title="预览与打印参数"
        subtitle="第 3 步 / 共 4 步 · 必须先有真实文件和材料检查结果"
        status={{ tone: 'warn', label: '没有待处理的文件' }}
        ctabar={(
          <>
            <button className="qx-btn" data-variant="ghost" type="button" onClick={() => navigate('/print-scan')}>返回打印扫描</button>
            <p className="why">没有文件时不展示预览、参数或设备成功状态。</p>
            <button className="qx-btn" data-variant="primary" type="button" onClick={() => navigate(uploadPath)}>去选文件</button>
          </>
        )}
      >
        <div className="qpd-context-empty" data-w2-page="print-preview" data-qx-state="missing-context">
          <div className="qx-state" data-tone="empty">
            <span className="qx-state-ic"><AlertTriangleIcon aria-hidden="true" /></span>
            <div><h2 className="qx-state-t">这一页没有待处理的文件</h2><p className="qx-state-d">请从选文件步骤开始，完成材料检查后再设置打印参数。</p></div>
          </div>
          <div className="qpd-empty-work qx-grow">
            <section className="qpd-empty-sheet"><FileTextIcon /><strong>当前文件：无</strong><span>没有预览、页数或打印参数</span></section>
            <section className="qx-card"><div className="qx-sec-h"><span className="t">本页不会伪造什么</span></div><ul><li>不显示示例文件或示例页数。</li><li>不默认打印机在线。</li><li>不把参数写成已保存。</li></ul></section>
          </div>
        </div>
      </QxPageFrame>
    )
  }

  if (!materialCheckComplete) {
    const canRunCheck = Boolean(file.fileId)
    return (
      <QxPageFrame
        title="预览与打印参数"
        subtitle="隐私预检不可绕过"
        status={{ tone: 'bad', label: '材料检查尚未完成' }}
        ctabar={(
          <>
            <button className="qx-btn" data-variant="ghost" type="button" onClick={() => navigate(uploadPath)}>返回选文件</button>
            <p className="why">没有完整且可识别的文件体检、PII 检查与遮挡处理结果，参数页不会放行到确认。</p>
            <button
              className="qx-btn"
              data-variant="primary"
              type="button"
              onClick={() => navigate(canRunCheck ? '/print/material-check' : uploadPath, canRunCheck ? { state: { file, source } } : undefined)}
            >
              {canRunCheck ? '完成材料检查' : '重新选择文件'}
            </button>
          </>
        )}
      >
        <div className="qpd-guard" data-w2-page="print-preview" data-qx-state="check-required">
          <div className="qx-state" data-tone="error">
            <span className="qx-state-ic"><AlertTriangleIcon /></span>
            <div><h2 className="qx-state-t">不能跳过隐私预检直接打印</h2><p className="qx-state-d">当前没有可信的材料检查与遮挡处理结论。页面不会只凭任务编号伪造“已检查”。</p></div>
          </div>
          <div className="qpd-guard-work">
            <section className="qpd-file-sheet"><FileTextIcon /><strong>{file.name}</strong><span>{file.size}</span><span>{formatPageCount(file.pages)}</span></section>
            <section className="qx-card"><div className="qx-sec-h"><span className="t">继续前必须完成</span></div><ol><li>读取真实文件体检结果。</li><li>完成隐私片段检查与逐项裁决。</li><li>等待遮挡处理返回真实结论。</li></ol></section>
          </div>
        </div>
      </QxPageFrame>
    )
  }

  const previewKind = previewKindForFile(file)
  const unsupported = previewKind === 'unsupported'
  const status = printerLoading
    ? { tone: 'warn' as const, label: '正在读取打印机状态' }
    : unsupported
      ? { tone: 'bad' as const, label: '当前文件不能预览打印' }
      : printerReady
        ? { tone: 'ok' as const, label: '预览与参数待确认' }
        : printerKind === 'offline'
          ? { tone: 'bad' as const, label: '打印机离线' }
          : printerKind === 'error'
            ? { tone: 'bad' as const, label: '打印机异常' }
            : { tone: 'warn' as const, label: '打印机状态未知' }

  // Legacy gate markers: PrintPageFrame, KioskActionBar, step={3}.
  // The route now renders QxPageFrame and qx-ctabar while preserving the same business state.
  return (
    <QxPageFrame
      title="预览与打印参数"
      subtitle="第 3 步 / 共 4 步 · 逐页核对文件，再确认份数、颜色、单双面和页范围"
      status={status}
      ctabar={(
        <>
          <button className="qx-btn" data-variant="ghost" type="button" onClick={() => navigate('/print/material-check', { state: { file, source } })}>返回材料检查</button>
          <p className="why">
            {unsupported
              ? '当前文件类型不能直接预览打印，请返回重新选择文件。'
              : privacyGate.kind === 'confirm' && !privacyConfirmed
                ? '请先逐页核对预览并确认隐私处理结果。'
              : printerLoading
                ? '设备状态返回前不放行。'
                : hasBlockingWarning
                  ? '打印机当前不可用，不能进入报价确认。'
                  : '本页不显示金额；下一步由服务端按真实页数和参数报价。'}
          </p>
          <button className="qx-btn" data-variant="primary" type="button" disabled={printerLoading || hasBlockingWarning || unsupported || (privacyGate.kind === 'confirm' && !privacyConfirmed)} onClick={handleNext}>
            {privacyGate.kind === 'confirm' && !privacyConfirmed ? '请先确认隐私处理结果' : printerLoading ? '设备检测中…' : hasBlockingWarning ? '打印机不可用' : '下一步：让服务端报价'}
          </button>
        </>
      )}
    >
      <div className="qpd-preview-grid" data-w2-page="print-preview" data-qx-state={unsupported ? 'file-unsupported' : 'preview'}>
        <section className="qpd-preview-left">
          <FilePreviewPanel file={file} token={getToken()} />
          <div className="qpd-preview-meta"><strong>{file.name}</strong><span>{formatPageCount(file.pages)} · {file.size}</span></div>
          <div className="qpd-redaction-badge" data-tone={redactionBadge?.tone ?? 'warning'}>
            {materialCheck?.mode === 'demo' ? '材料检查流程演示完成' : '材料检查已完成'}
            {redactionBadge ? ` · ${redactionBadge.text}` : ' · 遮挡结果未知，请自行核对预览'}
          </div>
          {privacyGate.kind === 'confirm' ? (
            <label className="qpd-privacy-confirm">
              <input
                type="checkbox"
                checked={privacyConfirmed}
                onChange={(event) => setPrivacyConfirmed(event.target.checked)}
              />
              <span>{privacyGate.confirmationLabel}</span>
            </label>
          ) : null}
        </section>

        <section className="qpd-preview-right">
          <div className="qpd-device" data-ready={printerReady ? 'true' : undefined}>
            <span>{printerReady ? <PrinterIcon /> : <WifiOffIcon />}</span>
            <div><strong>{printerLoading ? '检测设备中…' : printerName}</strong><small>{printerLoading ? '请稍候' : printerLabel}</small></div>
            {!printerLoading && printerReady ? <CheckCircleIcon aria-hidden="true" /> : null}
          </div>

          {warnings.length > 0 ? <div className="qpd-warnings">{warnings.map((warning) => <div className="qpd-warning" data-level={warning.level} key={warning.id}><AlertTriangleIcon /><span>{warning.text}</span></div>)}</div> : null}

          <div className="qpd-param-stack">
            <section className="qpd-param-card qpd-suggestion" data-suggestion-state={suggestion.status}>
              <div className="qpd-suggestion-head"><SparklesIcon /><div><strong>按文件事实给出的参数建议</strong><p>确定性规则，只建议不裁决；你确认前不会生效。</p></div></div>
              {suggestion.status === 'loading' ? <p className="qpd-param-note">正在读取真实建议…</p> : null}
              {suggestion.status === 'error' || suggestion.status === 'unavailable' ? <p className="qpd-param-note">{suggestion.message}</p> : null}
              {suggestion.status === 'ready' ? (
                <>
                  <dl className="qpd-suggestion-list">{suggestion.data.items.map((item) => <div key={item.field}><dt>{item.label}</dt><dd>{suggestionValueLabel(item)}</dd></div>)}</dl>
                  <button className="qx-btn" data-variant="teal" type="button" onClick={applySuggestion}>{suggestionApplied ? '已采用，可继续修改' : '采用这些建议'}</button>
                </>
              ) : null}
            </section>

            <section className="qpd-param-card"><span className="qpd-card-label">打印份数</span><div className="qpd-stepper"><button type="button" aria-label="减少打印份数" disabled={copies <= 1} onClick={() => setCopies(Math.max(1, copies - 1))}><MinusIcon /></button><output>{copies}</output><button type="button" aria-label="增加打印份数" disabled={copies >= 99} onClick={() => setCopies(Math.min(99, copies + 1))}><PlusIcon /></button><span>最多 99 份</span></div></section>

            <section className="qpd-param-card"><span className="qpd-card-label">色彩模式</span><ToggleGroup options={COLOR_MODE_OPTIONS} value={colorMode} onChange={(value) => setColorMode(value as ColorMode)} disabled={!capability.color.allowed} disabledReason={capability.color.reason} describedById="print-color-capability-note" /><p id="print-color-capability-note" className="qpd-param-note">{capability.color.allowed ? '彩色金额以下一步服务端报价为准' : capability.color.reason}{restoredParamsWereRestricted ? '；旧会话参数已收口为当前可用组合' : ''}</p></section>

            <section className="qpd-param-card"><span className="qpd-card-label">单双面</span><ToggleGroup options={DUPLEX_OPTIONS} value={duplex} onChange={(value) => setDuplex(value as DuplexMode)} disabled={!capability.duplex.allowed} disabledReason={capability.duplex.reason} describedById="print-duplex-capability-note" /><p id="print-duplex-capability-note" className="qpd-param-note">{capability.duplex.allowed ? '双面按内容页计费，用纸更省' : capability.duplex.reason}</p></section>

            <section className="qpd-param-card"><span className="qpd-card-label">页面方向</span><ToggleGroup options={[{ label: '自动', value: 'auto' }, { label: '纵向', value: 'portrait' }, { label: '横向', value: 'landscape' }]} value={orientation} onChange={(value) => setOrientation(value as PrintOrientation)} /></section>

            <section className="qpd-param-card"><span className="qpd-card-label">缩放方式</span><ToggleGroup options={[{ label: '适合页面', value: 'fit' }, { label: '实际大小', value: 'actual' }]} value={scale} onChange={(value) => setScale(value as PrintScale)} /></section>

            <section className="qpd-param-card"><span className="qpd-card-label">页面范围</span><ToggleGroup options={[{ label: '全部页面', value: 'all' }, { label: '自定义', value: 'custom' }]} value={pageRange} onChange={(value) => { setPageRange(value as 'all' | 'custom'); setRangeError(null) }} />{pageRange === 'custom' ? <><input className="qpd-range-input" aria-label="自定义页面范围" aria-invalid={Boolean(rangeError)} value={customRange} onChange={(event) => { setCustomRange(event.target.value); setRangeError(null) }} placeholder="例：1-3, 5, 7-9" />{rangeError ? <p className="qpd-range-error">{rangeError}</p> : <p className="qpd-param-note">逗号分开不连续页；重叠范围会去重；超出文档的整段会忽略。</p>}</> : null}</section>

            <section className="qpd-param-card"><span className="qpd-card-label">纸张规格</span><div className="qpd-readonly">A4（210 × 297 mm）· 当前仅提供 A4</div></section>

            <section className="qpd-param-card"><span className="qpd-card-label">用量事实</span><div className="qpd-facts"><InfoRow label="文件页数" value={file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页`} /><InfoRow label="本次选中" value={selectedPages === null ? '待识别，以服务端校验为准' : `${selectedPages} 页`} /><InfoRow label="打印份数" value={`${copies} 份`} /><InfoRow label="颜色模式" value={colorModeLabel(colorMode)} /><InfoRow label="单双面" value={duplexLabel(duplex)} /><InfoRow label="总打印面" value={totalFaces === null ? '待识别，以实际打印为准' : `${totalFaces} 面`} /><InfoRow label="预计用纸" value={sheetsUsed === null ? '待识别，以实际打印为准' : `${sheetsUsed} 张`} />{paperSaved > 0 ? <div className="qpd-warning"><InfoIcon /><span>双面比单面预计少用 {paperSaved} 张纸</span></div> : null}</div></section>

            <section className="qpd-param-card"><span className="qpd-card-label">费用说明</span><p className="qpd-price-truth">本页只设置参数，不展示本地估算金额。应付金额在下一步确认页由服务端按识别页数、页码范围与价目报价，与建单收费保持同源。</p><p className="qpd-param-note">打印涉及第三方 OCR 的隐私披露沿用材料检查页；文件留存期限以隐私政策和“我的文档”设置为准。</p></section>
          </div>
        </section>
      </div>
    </QxPageFrame>
  )
}
