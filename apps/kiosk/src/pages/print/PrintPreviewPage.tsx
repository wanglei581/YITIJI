import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
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
import type {
  ColorMode,
  DuplexMode,
  PagesPerSheet,
  PrintJobParams,
  PrinterStatus,
  PrintOrientation,
  PrintQuality,
  PrintScale,
} from '@ai-job-print/shared'
import {
  patchPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}

// 打印机离线时的默认状态（显示"打印机离线"警告并阻止打印）
const PRINTER_OFFLINE: PrinterStatus = {
  isOnline: false,
  hasPaper: true,
  tonerLevels: { black: 0, cyan: 0, magenta: 0, yellow: 0 },
}

// 从终端 API 心跳状态字符串映射到前端 PrinterStatus
function mapPrinterStatus(raw: string | null | undefined): PrinterStatus {
  switch (raw) {
    case 'ready':     return { isOnline: true,  hasPaper: true,  tonerLevels: { black: 100, cyan: 100, magenta: 100, yellow: 100 } }
    case 'offline':   return PRINTER_OFFLINE
    case 'error':     return { isOnline: true,  hasPaper: false, tonerLevels: { black: 0,   cyan: 0,   magenta: 0,   yellow: 0   }, errorCode: 'hardwareError' }
    case 'low_paper': return { isOnline: true,  hasPaper: true,  tonerLevels: { black: 100, cyan: 100, magenta: 100, yellow: 100 }, errorCode: 'lowPaper' }
    default:          return { isOnline: true,  hasPaper: true,  tonerLevels: { black: 100, cyan: 100, magenta: 100, yellow: 100 } }
  }
}

// 从 VITE_TERMINAL_ID 获取真实打印机状态；未配置或获取失败时返回 PRINTER_OFFLINE
function usePrinterStatus(): { printerName: string; printer: PrinterStatus; loading: boolean } {
  const terminalId  = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
  const printerName = (import.meta.env['VITE_PRINTER_NAME'] ?? '').trim() || '已配置打印机'
  const [printer, setPrinter] = useState<PrinterStatus>(PRINTER_OFFLINE)
  const [loading, setLoading] = useState(!!terminalId)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!terminalId) {
      setLoading(false)
      return
    }
    cancelledRef.current = false
    const ac = new AbortController()

    fetch(`/api/v1/terminals/${terminalId}/printer-status`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data: { printerStatus?: string | null }) => {
        if (cancelledRef.current) return
        setPrinter(mapPrinterStatus(data.printerStatus))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
        if (cancelledRef.current) return
        setPrinter(PRINTER_OFFLINE)
        setLoading(false)
      })

    return () => { cancelledRef.current = true; ac.abort() }
  }, [terminalId])

  return { printerName, printer, loading }
}

const PRICE_BW = 0.2
const PRICE_COLOR = 0.5

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
      <div className="h-px flex-1 bg-gray-100" />
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{children}</p>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  )
}

function ParamCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="mb-3 text-sm font-medium text-gray-700">{label}</p>
      {children}
    </Card>
  )
}

function ToggleGroup({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div
      className={[
        'flex overflow-hidden rounded-lg border',
        disabled ? 'border-gray-100 opacity-50' : 'border-gray-200',
      ].join(' ')}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={[
            'flex h-12 flex-1 items-center justify-center text-sm font-medium transition-colors',
            value === opt.value
              ? 'bg-primary-600 text-white'
              : 'bg-white text-gray-600 active:bg-gray-100',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-right text-sm font-semibold text-gray-900">{value}</span>
    </div>
  )
}

function FilePreviewPanel({ file }: { file: PrintFile }) {
  const previewKind = previewKindForFile(file)

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-56 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
        {previewKind === 'pdf' && (
          <iframe
            title={`${file.name} 预览`}
            src={file.fileUrl}
            className="h-full w-full bg-white"
          />
        )}
        {previewKind === 'image' && (
          <img
            src={file.fileUrl}
            alt={`${file.name} 预览`}
            className="h-full w-full object-contain"
          />
        )}
        {(previewKind === 'unsupported' || previewKind === 'unavailable') && (
          <div className="flex w-full flex-col items-center justify-center gap-4 px-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
              <FileTextIcon className="h-8 w-8 text-gray-300" />
            </div>
            <div>
              <p className="break-all text-sm font-semibold text-gray-800">{file.name}</p>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                {previewKind === 'unavailable'
                  ? '当前没有可嵌入的预览地址，通常出现在离线演示、签名链接过期或文件仍在上传处理中。'
                  : '当前文件类型暂不支持浏览器内直接预览，可继续设置打印参数，打印前请核对文件名和页数。'}
              </p>
            </div>
          </div>
        )}
        {previewKind !== 'unavailable' && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm">
            <EyeIcon className="h-3.5 w-3.5" />
            预览
          </div>
        )}
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
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
      <div className="flex min-h-[56px] w-full items-center justify-center gap-2 px-5 text-sm font-semibold text-gray-900">
        <span className={['h-4 w-1 rounded-full', accent === 'primary' ? 'bg-primary-600' : 'bg-amber-500'].join(' ')} />
        {title}
      </div>
      <div className="border-t border-gray-100 p-5">{children}</div>
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
  const restoredPrintParams = restoredSession?.printParams
  const source = locationState?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  const effectivePages = file.pages ?? 1

  const { printerName, printer, loading: printerLoading } = usePrinterStatus()

  // ── Parameter state ─────────────────────────────────────────────────────────
  const [copies, setCopies] = useState(restoredPrintParams?.copies ?? 1)
  const [colorMode, setColorMode] = useState<ColorMode>(restoredPrintParams?.colorMode ?? 'black_white')
  const [duplex, setDuplex] = useState<DuplexMode>(restoredPrintParams?.duplex ?? 'simplex')
  const [orientation, setOrientation] = useState<PrintOrientation>(restoredPrintParams?.orientation ?? 'auto')
  const [scale, setScale] = useState<PrintScale>(restoredPrintParams?.scale ?? 'fit')
  const [pageRange, setPageRange] = useState<'all' | 'custom'>(
    restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? 'custom' : 'all',
  )
  // 收口：quality / pagesPerSheet 当前 Terminal Agent 不生效，暂不暴露 UI 控件，
  // 固定为安全默认值随参数上送（后端仍做枚举校验）。后续真机验证后再决定是否开放。
  const quality: PrintQuality = 'standard'
  const pagesPerSheet: PagesPerSheet = 1
  const [customRange, setCustomRange] = useState(
    restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? restoredPrintParams.pageRange : '',
  )
  const [rangeError, setRangeError] = useState(false)

  const colorTonerLow =
    printer.tonerLevels.cyan < 25 ||
    printer.tonerLevels.magenta < 25 ||
    printer.tonerLevels.yellow < 25

  // ── Warnings ────────────────────────────────────────────────────────────────
  const warnings = useMemo(() => {
    const w: { id: string; level: 'error' | 'warn' | 'info'; text: string }[] = []
    if (!printer.isOnline)
      w.push({ id: 'offline', level: 'error', text: '打印机离线，请联系工作人员' })
    if (printer.errorCode === 'paperJam')
      w.push({ id: 'jam', level: 'error', text: '打印机卡纸，请联系工作人员处理后再打印' })
    if (!printer.hasPaper)
      w.push({ id: 'empty', level: 'error', text: '打印机缺纸，请联系工作人员补纸' })
    if (colorTonerLow && colorMode === 'color')
      w.push({
        id: 'color-toner',
        level: 'warn',
        text: '彩色墨粉不足，彩印效果可能不理想，建议改用黑白打印',
      })
    if (file.pages !== null && file.pages > 8 && duplex === 'simplex')
      w.push({
        id: 'duplex-hint',
        level: 'info',
        text: `文件共 ${file.pages} 页，建议开启双面打印节省用纸`,
      })
    return w
  }, [printer, colorTonerLow, colorMode, duplex, file.pages])

  const hasBlockingWarning = warnings.some((w) => w.level === 'error')

  // ── Usage estimate ──────────────────────────────────────────────────────────
  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(effectivePages / pagesPerSheet)
    const tf = facesPerCopy * copies
    const su = duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [effectivePages, pagesPerSheet, copies, duplex])

  const pricePerFace = colorMode === 'color' ? PRICE_COLOR : PRICE_BW
  const totalPrice = (totalFaces * pricePerFace).toFixed(2)

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
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-50">
          <AlertTriangleIcon className="h-10 w-10 text-amber-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-gray-500">请重新上传文件后再进行打印设置</p>
        </div>
        <Button size="lg" onClick={() => navigate(uploadPath)}>
          重新上传文件
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col p-6">
      <PageHeader
        title="打印设置"
        subtitle="设置打印参数后进入确认"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 grid grid-cols-[18rem_minmax(0,1fr)] gap-6">
        {/* ── Left: file preview ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <FilePreviewPanel file={file} />
          <p className="text-center text-sm text-gray-500">
            {formatPageCount(file.pages)} · {file.size}
          </p>
          {materialCheck && (
            <div
              className={[
                'rounded-lg border px-3 py-2 text-center text-xs font-medium',
                materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0
                  ? 'border-amber-100 bg-amber-50 text-amber-700'
                  : 'border-green-100 bg-green-50 text-green-700',
              ].join(' ')}
            >
              {materialCheck.mode === 'demo' ? '材料检查流程演示完成' : '已完成隐私检查'} · 遮挡 {materialCheck.redactedCount} 项
              {materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0 ? ' · 仍使用原文件' : ''}
            </div>
          )}
        </div>

        {/* ── Right: params (scrollable) ──────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4 pb-6">

          {/* Printer status bar */}
          <Card className="flex items-center gap-3 p-4">
            <div
              className={[
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                printer.isOnline ? 'bg-green-50' : 'bg-red-50',
              ].join(' ')}
            >
              {printer.isOnline ? (
                <PrinterIcon className="h-5 w-5 text-green-600" />
              ) : (
                <WifiOffIcon className="h-5 w-5 text-red-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {printerLoading ? '检测设备中…' : printerName}
              </p>
              <p className={['text-xs', printer.isOnline ? 'text-green-600' : 'text-red-500'].join(' ')}>
                {printerLoading ? '请稍候' : printer.isOnline ? '在线' : '离线'}
              </p>
            </div>
            {!printerLoading && printer.isOnline && <CheckCircleIcon className="h-5 w-5 shrink-0 text-green-500" />}
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
                      ? 'bg-red-50 text-red-700'
                      : w.level === 'warn'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-blue-50 text-blue-700',
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
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
              >
                <MinusIcon className="h-5 w-5 text-gray-600" />
              </button>
              <span className="w-16 text-center text-2xl font-bold text-gray-900">{copies}</span>
              <button
                type="button"
                disabled={copies >= 99}
                onClick={() => setCopies(Math.min(99, copies + 1))}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
              >
                <PlusIcon className="h-5 w-5 text-gray-600" />
              </button>
              <span className="text-sm text-gray-400">（最多 99 份）</span>
            </div>
          </ParamCard>

          {/* Color mode */}
          <ParamCard label="色彩模式">
            <ToggleGroup
              options={[
                { label: '黑白', value: 'black_white' },
                { label: '彩色', value: 'color' },
              ]}
              value={colorMode}
              onChange={(v) => setColorMode(v as ColorMode)}
            />
            <p className="mt-2 text-xs text-gray-400">
              黑白 ¥{PRICE_BW.toFixed(1)}/面 · 彩色 ¥{PRICE_COLOR.toFixed(1)}/面
            </p>
            {colorMode === 'color' && (
              <p className="mt-1 text-xs text-amber-600">
                彩色效果以设备支持和当前耗材状态为准
              </p>
            )}
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
            />
            <p className="mt-2 text-xs text-gray-400">
              长边翻转适合纵向文档，短边翻转适合横向文档
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
                      ? 'border-red-400 bg-red-50 focus:border-red-500'
                      : 'border-gray-200 focus:border-primary-500',
                  ].join(' ')}
                />
                {rangeError && (
                  <p className="mt-1.5 text-xs text-red-500">请输入页面范围，例：1-3, 5, 7-9</p>
                )}
              </div>
            )}
          </ParamCard>

          {/* Paper — read only */}
          <ParamCard label="纸张规格">
            <div className="flex h-12 items-center rounded-lg border border-gray-100 bg-gray-50 px-4 text-sm text-gray-500">
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
            <InfoRow label="颜色模式" value={colorMode === 'color' ? '彩色' : '黑白'} />
            <InfoRow label="纸张规格" value="A4" />
            <InfoRow label="总打印面" value={`${totalFaces} 面`} />
            <InfoRow label="预计用纸" value={`${sheetsUsed} 张`} />

            {paperSaved > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
                <InfoIcon className="h-4 w-4 shrink-0" />
                双面打印比单面节省 {paperSaved} 张纸
              </div>
            )}
          </Card>

          <SectionHead>费用明细</SectionHead>

          <Card className="p-5">
            <InfoRow label="单价" value={`¥${pricePerFace.toFixed(2)} / 面`} />
            <InfoRow
              label="页数 × 份数"
              value={`${file.pages ?? effectivePages} × ${copies} = ${totalFaces}`}
            />
            <InfoRow label="打印费用" value={`¥${totalPrice}`} />
            <InfoRow label="优惠券抵扣" value={<span className="font-medium text-gray-400">请选择优惠券</span>} />
            <div className="mt-4 flex items-baseline justify-between border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-500">
                实际以机器计费为准
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-xs font-medium text-gray-500">实付金额</span>
                <span className="text-xl font-bold text-gray-900">¥{totalPrice}</span>
              </div>
            </div>
          </Card>

          <InfoSection
            title="价格说明"
            accent="primary"
          >
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <div className="grid grid-cols-4 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
                <span>打印类型</span>
                <span>规格</span>
                <span>黑白</span>
                <span>彩色</span>
              </div>
              {[
                ['文档/简历', 'A4 普通纸', '¥0.20/面', '¥0.50/面'],
                ['证件照', '1寸/2寸标准版', '—', '待接入'],
                ['照片打印', '6寸 光面纸', '—', '待接入'],
                ['铜版纸简历', 'A4 铜版纸', '待接入', '待接入'],
              ].map(([type, spec, bw, color]) => (
                <div key={type} className="grid grid-cols-4 border-t border-gray-100 px-3 py-2 text-xs text-gray-700">
                  <span className="font-medium text-gray-900">{type}</span>
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
            <ol className="space-y-3 text-sm text-gray-600">
              {[
                '上传文件需清晰完整，当前支持 PDF、JPG、PNG；Word 页内预览和转换能力后续接入。',
                '左侧可预览 PDF 和图片；如果无法预览，请检查签名链接是否过期，或返回重新上传。',
                '隐私检查只用于本次打印前确认，不向第三方发送；当前遮挡产物未生成时会明确提示仍使用原文件。',
                '打印完成后请从出纸口取件，如有质量问题请联系现场工作人员。',
              ].map((item, index) => (
                <li key={item} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
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
      <div className="mt-6 flex gap-3">
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
      </div>
    </div>
  )
}
