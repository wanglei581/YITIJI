import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, KioskActionBar } from '@ai-job-print/ui'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  EyeIcon,
  FileTextIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  WifiOffIcon,
} from 'lucide-react'
import {
  hasUnverifiedPrintParams,
  VERIFIED_PRINT_PARAMETER_PROFILE,
  ColorMode,
  DuplexMode,
  PrintJobParams,
  PrintOrientation,
  PrintQuality,
  PrintScale,
} from '@ai-job-print/shared'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { usePrintParamCapability } from '../../hooks/usePrintParamCapability'
import {
  patchPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'
import { computePrintUsageEstimate } from './printUsageEstimate'
import { materialRedactionBadge } from './piiRedaction'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}


function formatPageCount(pages: number | null): string {
  return pages === null ? '页数待识别' : `共 ${pages} 页`
}

function inferMimeType(file: PrintFile): string {
  if (file.mimeType) return file.mimeType
  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) return 'application/msword'
  return 'application/octet-stream'
}

function previewKindForFile(file: PrintFile): 'pdf' | 'image' | 'unsupported' | 'unavailable' {
  if (!file.fileUrl || file.fileUrl.startsWith('/mock/')) return 'unavailable'
  const mimeType = inferMimeType(file)
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  return 'unsupported'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-neutral-100" />
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{children}</p>
      <div className="h-px flex-1 bg-neutral-100" />
    </div>
  )
}

function ParamCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="mb-3 text-sm font-medium text-neutral-700">{label}</p>
      {children}
    </Card>
  )
}

/**
 * 选项组。禁用态用 **aria-disabled 而不是原生 disabled**：
 * 原生 disabled 的按钮无法聚焦，读屏和键盘用户根本读不到「为什么不能选」。
 * 这里保留可聚焦 + aria-describedby 指向理由文案，点击则被忽略。
 * 触控高度 48px（h-12）满足一体机可点击区下限。
 */
function ToggleGroup({
  options,
  value,
  onChange,
  disabled = false,
  disabledReason,
  describedById,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  disabledReason?: string | null
  describedById?: string
}) {
  return (
    <div
      className={[
        'flex overflow-hidden rounded-lg border',
        disabled ? 'border-neutral-100 opacity-60' : 'border-neutral-200',
      ].join(' ')}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-disabled={disabled || undefined}
          aria-describedby={disabled && describedById ? describedById : undefined}
          title={disabled ? (disabledReason ?? undefined) : undefined}
          onClick={() => {
            if (disabled) return
            onChange(opt.value)
          }}
          className={[
            'flex h-12 flex-1 items-center justify-center text-sm font-medium transition-colors',
            value === opt.value
              ? 'bg-primary-600 text-white'
              : 'bg-white text-neutral-600',
            disabled ? 'cursor-not-allowed' : 'active:bg-neutral-100',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 色彩模式选项 —— 控件与「用量预估」摘要行的**唯一**来源。
 * 摘要行此前写死 '黑白'，而 handlePrint 送出的是真实 colorMode：
 * 终端登记 color_print=available 后，用户选彩色会看到「颜色模式 黑白」，
 * 却按彩色单价报价出纸（CLAUDE.md §9「不伪造能力」+ 资损）。两处共用一份定义，
 * 以后再改选项也不会只改一半。
 */
const COLOR_MODE_OPTIONS: { label: string; value: ColorMode }[] = [
  { label: '黑白', value: 'black_white' },
  { label: '彩色', value: 'color' },
]

function colorModeLabel(mode: ColorMode): string {
  return COLOR_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? mode
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3 last:border-b-0">
      <span className="text-sm text-neutral-500">{label}</span>
      <span className="text-right text-sm font-semibold text-neutral-900">{value}</span>
    </div>
  )
}

function FilePreviewPanel({ file }: { file: PrintFile }) {
  const previewKind = previewKindForFile(file)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/*
        预览框高度上限（2026-08-18 产品走查「预览比例不对」）：
        原先只有 `min-h-[420px] flex-1`，没有任何 max-height —— 预览框会把剩余竖向空间
        全部吃掉，在 1080×1920 竖屏上被拉成一个和 A4 纸完全不成比例的长条。

        取值按竖屏实际列宽算，不照抄桌面习惯：
          可用列宽 = 1080 − 48(左右 p-6) − 400(右侧参数栏) − 24(gap) ≈ 608px
          A4 是 210×297，608px 宽对应高 608 × 297/210 ≈ 860px
        所以 860px 正是「这一列铺满宽度时，A4 纸该有的高度」。
        再用 min(56vh, 860px) 兜住矮屏（桌面浏览器验证时不至于顶出视口）。
      */}
      <div className="relative flex max-h-[min(56vh,860px)] min-h-[420px] flex-1 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
        {previewKind === 'pdf' && (
          <iframe
            title={`${file.name} 预览`}
            src={file.fileUrl}
            className="h-full max-h-full w-full bg-white"
          />
        )}
        {previewKind === 'image' && (
          <img
            src={file.fileUrl}
            alt={`${file.name} 预览`}
            className="h-full max-h-full w-full object-contain"
          />
        )}
        {(previewKind === 'unsupported' || previewKind === 'unavailable') && (
          <div className="flex w-full flex-col items-center justify-center gap-4 px-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
              <FileTextIcon className="h-8 w-8 text-neutral-300" />
            </div>
            <div>
              <p className="break-all text-sm font-semibold text-neutral-800">{file.name}</p>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                {previewKind === 'unavailable'
                  ? '当前没有可嵌入的预览地址，通常出现在离线演示、签名链接过期或文件仍在上传处理中。'
                  : '当前文件类型暂不支持浏览器内直接预览，可继续设置打印参数，打印前请核对文件名和页数。'}
              </p>
            </div>
          </div>
        )}
        {previewKind !== 'unavailable' && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-neutral-600 shadow-sm">
            <EyeIcon className="h-3.5 w-3.5" />
            预览
          </div>
        )}
      </div>

      <div className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-xs leading-5 text-primary-700">
        PDF 和图片可在左侧预览；Word 文档需后续接入转换服务后才能页内预览。若只看到文件图标，请确认文件链接未过期，或返回重新上传。
      </div>
    </div>
  )
}

function InfoSection({
  title,
  accent,
  children,
}: {
  title: string
  accent: 'primary' | 'amber'
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex min-h-[56px] w-full items-center justify-center gap-2 px-5 text-sm font-semibold text-neutral-900">
        <span className={['h-4 w-1 rounded-full', accent === 'primary' ? 'bg-primary-600' : 'bg-warning'].join(' ')} />
        {title}
      </div>
      <div className="border-t border-neutral-100 p-5">{children}</div>
    </Card>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────────

export function PrintPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])

  // Use a placeholder when state is missing — hooks must always run before any early return
  const EMPTY_FILE: PrintFile = { name: '', size: '', pages: null }
  const file = locationState?.file ?? restoredSession?.file ?? EMPTY_FILE
  const materialCheck = locationState?.materialCheck ?? restoredSession?.materialCheck
  // 遮挡结论只从后端 claim 派生（piiRedaction.materialRedactionBadge），本页不自行拼装。
  const redactionBadge = materialRedactionBadge(materialCheck?.redaction)
  const restoredPrintParams = restoredSession?.printParams
  const restoredParamsWereRestricted = restoredPrintParams
    ? hasUnverifiedPrintParams(restoredPrintParams)
    : false
  const source = locationState?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  // 页数未识别时不假设 1 页:用量预估整块改为「待识别」,不给编出来的面数/张数。
  // (2026-08-17 走查:30 页 PDF 页数未识别时,「文件页数」诚实显示「待识别」,
  //  下面两行却写着「总打印面 1 面 / 预计用纸 1 张」——同一张卡自相矛盾,违反 CLAUDE.md §9。)
  const knownPages = file.pages

  const {
    printerName,
    printer,
    printerLabel,
    printerReady,
    kind: printerKind,
    loading: printerLoading,
  } = useTerminalDeviceStatus()

  // ── Parameter state ─────────────────────────────────────────────────────────
  const [copies, setCopies] = useState(restoredPrintParams?.copies ?? 1)
  // 彩色 / 双面按**本机**能力登记决定是否可选（服务端 fail-closed 门禁的体验层镜像）。
  // 起始值一律取安全基线：能力还没确认前不能先把用户放到彩色上再打回。
  const capability = usePrintParamCapability()
  const [colorMode, setColorMode] = useState<ColorMode>(VERIFIED_PRINT_PARAMETER_PROFILE.colorMode)
  const [duplex, setDuplex] = useState<DuplexMode>(VERIFIED_PRINT_PARAMETER_PROFILE.duplex)

  // 能力被收回（管理员改配置 / 换了未验证终端）时，把已选中的未验证值拉回基线，
  // 避免带着一个必被服务端拒绝的参数走到确认页。
  useEffect(() => {
    if (!capability.color.allowed && colorMode !== 'black_white') setColorMode('black_white')
    if (!capability.duplex.allowed && duplex !== 'simplex') setDuplex('simplex')
  }, [capability.color.allowed, capability.duplex.allowed, colorMode, duplex])
  const [orientation, setOrientation] = useState<PrintOrientation>(restoredPrintParams?.orientation ?? 'auto')
  const [scale, setScale] = useState<PrintScale>(restoredPrintParams?.scale ?? 'fit')
  const [pageRange, setPageRange] = useState<'all' | 'custom'>(
    restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? 'custom' : 'all',
  )
  // 收口：quality / pagesPerSheet 当前 Terminal Agent 不生效，暂不暴露 UI 控件，
  // 固定为安全默认值随参数上送（后端仍做枚举校验）。后续真机验证后再决定是否开放。
  const quality: PrintQuality = 'standard'
  const pagesPerSheet = VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet
  const [customRange, setCustomRange] = useState(
    restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? restoredPrintParams.pageRange : '',
  )
  const [rangeError, setRangeError] = useState(false)

  // ── Warnings ────────────────────────────────────────────────────────────────
  const warnings = useMemo(() => {
    const w: { id: string; level: 'error' | 'warn' | 'info'; text: string }[] = []
    if (printerKind === 'unknown' || printer.errorCode === 'statusUnknown') {
      w.push({ id: 'unknown', level: 'error', text: '打印机状态未知，请稍候或联系工作人员' })
    } else if (printerKind === 'offline' || !printer.isOnline) {
      w.push({ id: 'offline', level: 'error', text: '打印机离线，请联系工作人员' })
    } else if (printer.errorCode === 'paperJam') {
      w.push({ id: 'jam', level: 'error', text: '打印机卡纸，请联系工作人员处理后再打印' })
    } else if (printer.errorCode === 'hardwareError') {
      w.push({ id: 'hw', level: 'error', text: '打印机异常，请联系工作人员检查后再打印' })
    } else if (printer.errorCode === 'paperEmpty' || !printer.hasPaper) {
      w.push({ id: 'empty', level: 'error', text: '打印机缺纸，请联系工作人员补纸' })
    } else if (printerKind === 'error') {
      w.push({ id: 'hw', level: 'error', text: '打印机异常，请联系工作人员检查后再打印' })
    }
    if (printerKind === 'low_paper') {
      w.push({ id: 'low-paper', level: 'warn', text: '纸量偏低，建议联系工作人员补纸后再大批量打印' })
    }
    return w
  }, [printer, printerKind])

  const hasBlockingWarning = warnings.some((w) => w.level === 'error') || !printerReady

  // ── Usage estimate ──────────────────────────────────────────────────────────
  // 页数未识别 → 三项全部为 null,页面显示「待识别」而不是编一个数(见 printUsageEstimate.ts)。
  const { totalFaces, sheetsUsed, paperSaved } = useMemo(
    () => computePrintUsageEstimate({ pages: knownPages, copies, pagesPerSheet, duplex }),
    [knownPages, pagesPerSheet, copies, duplex],
  )


  // ── Navigation ──────────────────────────────────────────────────────────────
  const handleNext = () => {
    if (pageRange === 'custom' && !customRange.trim()) {
      setRangeError(true)
      return
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
    patchPrintMaterialSession({ file, materialCheck, printParams: params })
    navigate('/print/confirm', { state: { file, params, materialCheck, source } })
  }

  // Guard: direct URL access without file state — all hooks have already run above
  if (!locationState?.file && !restoredSession?.file) {
    return (
      <PrintPageFrame className="p-6">
      <div data-w2-page="print-preview" className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
          <AlertTriangleIcon className="h-10 w-10 text-warning" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-neutral-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-neutral-500">请重新上传文件后再进行打印设置</p>
        </div>
        <Button size="lg" onClick={() => navigate(uploadPath)}>
          重新上传文件
        </Button>
      </div>
      </PrintPageFrame>
    )
  }

  return (
    <PrintPageFrame className="p-6">
    <div data-w2-page="print-preview" className="flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="打印预览"
        subtitle="预览文件内容并设置打印参数后进入确认"
        step={3}
        backLabel="返回材料检查"
        onBack={() => navigate(-1)}
      />

      <div className="mt-6 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-6">
        {/* ── Left: A4 预览主区 ─────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <FilePreviewPanel file={file} />
          <p className="text-center text-sm text-neutral-500">
            {formatPageCount(file.pages)} · {file.size}
          </p>
          {materialCheck && (
            <div
              className={[
                'rounded-lg border px-3 py-2 text-center text-xs font-medium',
                redactionBadge?.tone === 'success'
                  ? 'border-success-bg bg-success-bg text-success-fg'
                  : 'border-warning/20 bg-warning-bg text-warning-fg',
              ].join(' ')}
            >
              {materialCheck.mode === 'demo' ? '材料检查流程演示完成' : '已完成隐私检查'}
              {redactionBadge ? ` · ${redactionBadge.text}` : ''}
            </div>
          )}
        </div>

        {/* ── Right: 参数侧栏 ──────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pb-6">

          {/* Printer status bar — 仅 printerReady 显示绿色在线，未知/离线 fail-closed */}
          <Card className="flex items-center gap-3 p-4">
            <div
              className={[
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                printerReady ? 'bg-success-bg' : 'bg-error-bg',
              ].join(' ')}
            >
              {printerReady ? (
                <PrinterIcon className="h-5 w-5 text-success-fg" />
              ) : (
                <WifiOffIcon className="h-5 w-5 text-error-fg" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900">
                {printerLoading ? '检测设备中…' : printerName}
              </p>
              <p className={['text-xs', printerReady ? 'text-success-fg' : 'text-error-fg'].join(' ')}>
                {printerLoading ? '请稍候' : printerLabel}
              </p>
            </div>
            {!printerLoading && printerReady && <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" />}
          </Card>

          {/* Warning / info chips */}
          {warnings.length > 0 && (
            <div className="flex flex-col gap-2">
              {warnings.map((w) => (
                <div
                  key={w.id}
                  className={[
                    'flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm',
                    w.level === 'error'
                      ? 'bg-error-bg text-error-fg'
                      : w.level === 'warn'
                      ? 'bg-warning-bg text-warning-fg'
                      : 'bg-primary-50 text-primary-700',
                  ].join(' ')}
                >
                  {w.level === 'info' ? (
                    <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          )}

          <SectionHead>基础参数</SectionHead>

          {/* Copies */}
          <ParamCard label="打印份数">
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={copies <= 1}
                onClick={() => setCopies(Math.max(1, copies - 1))}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40"
              >
                <MinusIcon className="h-5 w-5 text-neutral-600" />
              </button>
              <span className="w-16 text-center text-2xl font-bold text-neutral-900">{copies}</span>
              <button
                type="button"
                disabled={copies >= 99}
                onClick={() => setCopies(Math.min(99, copies + 1))}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40"
              >
                <PlusIcon className="h-5 w-5 text-neutral-600" />
              </button>
              <span className="text-sm text-neutral-400">（最多 99 份）</span>
            </div>
          </ParamCard>

          {/* Color mode */}
          <ParamCard label="色彩模式">
            <ToggleGroup
              options={COLOR_MODE_OPTIONS}
              value={colorMode}
              onChange={(v) => setColorMode(v as ColorMode)}
              disabled={!capability.color.allowed}
              disabledReason={capability.color.reason}
              describedById="print-color-capability-note"
            />
            <p id="print-color-capability-note" className="mt-2 text-xs text-neutral-500">
              {capability.color.allowed
                ? '彩色按彩色单价计费，具体金额以下一步报价为准'
                : capability.color.reason}
              {restoredParamsWereRestricted ? '；检测到旧会话参数，已明确收口为当前可用组合' : ''}
            </p>
          </ParamCard>

          {/* Duplex */}
          <ParamCard label="单双面">
            <ToggleGroup
              options={[
                { label: '单面', value: 'simplex' },
                { label: '双面（长边）', value: 'duplex_long_edge' },
                { label: '双面（短边）', value: 'duplex_short_edge' },
              ]}
              value={duplex}
              onChange={(v) => setDuplex(v as DuplexMode)}
              disabled={!capability.duplex.allowed}
              disabledReason={capability.duplex.reason}
              describedById="print-duplex-capability-note"
            />
            <p id="print-duplex-capability-note" className="mt-2 text-xs text-neutral-500">
              {capability.duplex.allowed
                ? '双面按内容页计费，单价与单面相同，用纸更省'
                : capability.duplex.reason}
            </p>
          </ParamCard>

          {/* Orientation */}
          <ParamCard label="页面方向">
            <ToggleGroup
              options={[
                { label: '自动', value: 'auto' },
                { label: '纵向', value: 'portrait' },
                { label: '横向', value: 'landscape' },
              ]}
              value={orientation}
              onChange={(v) => setOrientation(v as PrintOrientation)}
            />
          </ParamCard>

          {/* Scale */}
          <ParamCard label="缩放方式">
            <ToggleGroup
              options={[
                { label: '适合页面', value: 'fit' },
                { label: '实际大小', value: 'actual' },
              ]}
              value={scale}
              onChange={(v) => setScale(v as PrintScale)}
            />
          </ParamCard>

          {/* Page range */}
          <ParamCard label="页面范围">
            <ToggleGroup
              options={[
                { label: '全部页面', value: 'all' },
                { label: '自定义', value: 'custom' },
              ]}
              value={pageRange}
              onChange={(v) => {
                setPageRange(v as 'all' | 'custom')
                setRangeError(false)
              }}
            />
            {pageRange === 'custom' && (
              <div className="mt-3">
                <input
                  type="text"
                  inputMode="text"
                  value={customRange}
                  onChange={(e) => {
                    setCustomRange(e.target.value)
                    setRangeError(false)
                  }}
                  placeholder="例：1-3, 5, 7-9"
                  className={[
                    'h-12 w-full rounded-lg border px-4 text-sm outline-none transition-colors',
                    rangeError
                      ? 'border-error bg-error-bg focus:border-error-fg'
                      : 'border-neutral-200 focus:border-primary-500',
                  ].join(' ')}
                />
                {rangeError && (
                  <p className="mt-1.5 text-xs text-error-fg">请输入页面范围，例：1-3, 5, 7-9</p>
                )}
              </div>
            )}
          </ParamCard>

          {/* Paper — read only */}
          <ParamCard label="纸张规格">
            <div className="flex h-12 items-center rounded-lg border border-neutral-100 bg-neutral-50 px-4 text-sm text-neutral-500">
              A4（210 × 297 mm）— 仅支持 A4
            </div>
          </ParamCard>

          <SectionHead>用量预估</SectionHead>

          <Card className="p-5">
            <InfoRow
              label="文件页数"
              value={file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页`}
            />
            <InfoRow label="打印份数" value={`${copies} 份`} />
            <InfoRow label="颜色模式" value={colorModeLabel(colorMode)} />
            <InfoRow label="纸张规格" value="A4" />
            <InfoRow
              label="总打印面"
              value={totalFaces === null ? '待识别，以实际打印为准' : `${totalFaces} 面`}
            />
            <InfoRow
              label="预计用纸"
              value={sheetsUsed === null ? '待识别，以实际打印为准' : `${sheetsUsed} 张`}
            />

            {paperSaved > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-xs text-success-fg">
                <InfoIcon className="h-4 w-4 shrink-0" />
                双面打印比单面节省 {paperSaved} 张纸
              </div>
            )}
          </Card>

          <SectionHead>费用说明</SectionHead>

          <Card className="p-5">
            <p className="text-sm leading-relaxed text-neutral-700">
              本页只设置打印参数与估算用纸。应付金额在下一步确认页由服务端按识别页数、页码范围与价目计算，与建单收费一致。
            </p>
            <p className="mt-3 text-xs text-neutral-400">
              不在此页展示本地估算金额，避免与最终计费不一致。
            </p>
          </Card>

          <InfoSection
            title="价格说明"
            accent="primary"
          >
            <div className="overflow-hidden rounded-lg border border-neutral-100">
              <div className="grid grid-cols-4 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-500">
                <span>打印类型</span>
                <span>规格</span>
                <span>黑白</span>
                <span>彩色</span>
              </div>
              {[
                ['文档/简历', 'A4 普通纸', '确认页报价', '待真机验证'],
                ['证件照', '1寸/2寸标准版', '—', '待接入'],
                ['照片打印', '6寸 光面纸', '—', '待接入'],
                ['铜版纸简历', 'A4 铜版纸', '待接入', '待接入'],
              ].map(([type, spec, bw, color]) => (
                <div key={type} className="grid grid-cols-4 border-t border-neutral-100 px-3 py-2 text-xs text-neutral-700">
                  <span className="font-medium text-neutral-900">{type}</span>
                  <span>{spec}</span>
                  <span>{bw}</span>
                  <span className="font-semibold text-primary-600">{color}</span>
                </div>
              ))}
            </div>
          </InfoSection>

          <InfoSection
            title="打印须知"
            accent="amber"
          >
            <ol className="space-y-3 text-sm text-neutral-600">
              {[
                '上传文件需清晰完整，当前支持 PDF、JPG、PNG；Word 页内预览和转换能力后续接入。',
                '左侧可预览 PDF 和图片；如果无法预览，请检查签名链接是否过期，或返回重新上传。',
                '隐私检查只用于本次打印前确认，扫描件/图片可能通过第三方 OCR 服务识别文字；若已生成遮挡后的文件，打印会改用那一份，否则会按实际处理结论提示打印使用原件。',
                '打印完成后请从出纸口取件，如有质量问题请联系现场工作人员。',
              ].map((item, index) => (
                <li key={item} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="leading-6">{item}</span>
                </li>
              ))}
            </ol>
          </InfoSection>

        </div>
      </div>

      {/* Bottom action */}
      <KioskActionBar className="mt-6">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate(-1)}>
          返回
        </Button>
        <Button
          size="lg"
          className="flex-1"
          onClick={handleNext}
          disabled={printerLoading || hasBlockingWarning}
        >
          {printerLoading ? '设备检测中…' : hasBlockingWarning ? '打印机不可用' : '确认参数'}
        </Button>
      </KioskActionBar>
    </div>
    </PrintPageFrame>
  )
}
