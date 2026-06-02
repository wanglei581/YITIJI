import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
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

interface PrintFile {
  name:     string
  size:     string
  pages:    number
  fileUrl?: string
  fileMd5?: string
}

interface LocationState {
  file: PrintFile
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

// ── Main page ───────────────────────────────────────────────────────────────────

export function PrintPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LocationState | null

  // Use a placeholder when state is missing — hooks must always run before any early return
  const EMPTY_FILE: PrintFile = { name: '', size: '', pages: 0 }
  const file = locationState?.file ?? EMPTY_FILE

  const { printerName, printer, loading: printerLoading } = usePrinterStatus()

  // ── Parameter state ─────────────────────────────────────────────────────────
  const [copies, setCopies] = useState(1)
  const [colorMode, setColorMode] = useState<ColorMode>('black_white')
  const [duplex, setDuplex] = useState<DuplexMode>('simplex')
  const [orientation, setOrientation] = useState<PrintOrientation>('auto')
  const [scale, setScale] = useState<PrintScale>('fit')
  const [pageRange, setPageRange] = useState<'all' | 'custom'>('all')
  // 收口：quality / pagesPerSheet 当前 Terminal Agent 不生效，暂不暴露 UI 控件，
  // 固定为安全默认值随参数上送（后端仍做枚举校验）。后续真机验证后再决定是否开放。
  const quality: PrintQuality = 'standard'
  const pagesPerSheet: PagesPerSheet = 1
  const [customRange, setCustomRange] = useState('')
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
    if (file.pages > 8 && duplex === 'simplex')
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
    const facesPerCopy = Math.ceil(file.pages / pagesPerSheet)
    const tf = facesPerCopy * copies
    const su = duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [file.pages, pagesPerSheet, copies, duplex])

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
    navigate('/print/confirm', { state: { file, params } })
  }

  // Guard: direct URL access without file state — all hooks have already run above
  if (!locationState?.file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-50">
          <AlertTriangleIcon className="h-10 w-10 text-amber-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-gray-500">请重新上传文件后再进行打印设置</p>
        </div>
        <Button size="lg" onClick={() => navigate('/print/upload')}>
          重新上传文件
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="打印设置"
        subtitle="设置打印参数后进入确认"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 gap-6 overflow-hidden">
        {/* ── Left: file preview ─────────────────────────────────────────── */}
        <div className="flex w-60 shrink-0 flex-col gap-3">
          <div className="flex aspect-[3/4] w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              <FileTextIcon className="h-16 w-16 text-gray-300" />
              <p className="break-all text-xs leading-relaxed text-gray-400">{file.name}</p>
            </div>
          </div>
          <p className="text-center text-sm text-gray-500">
            共 {file.pages} 页 · {file.size}
          </p>
        </div>

        {/* ── Right: params (scrollable) ──────────────────────────────────── */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-2">

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
            <div className="grid grid-cols-2 gap-y-2.5 text-sm">
              <span className="text-gray-500">文件页数</span>
              <span className="text-right font-medium text-gray-900">{file.pages} 页</span>

              <span className="text-gray-500">打印份数</span>
              <span className="text-right font-medium text-gray-900">{copies} 份</span>

              <span className="text-gray-500">总打印面</span>
              <span className="text-right font-medium text-gray-900">{totalFaces} 面</span>

              <span className="text-gray-500">预计用纸</span>
              <span className="text-right font-medium text-gray-900">{sheetsUsed} 张</span>
            </div>

            {paperSaved > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
                <InfoIcon className="h-4 w-4 shrink-0" />
                双面打印比单面节省 {paperSaved} 张纸
              </div>
            )}

            <div className="mt-4 flex items-baseline justify-between border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-500">
                ¥{pricePerFace.toFixed(1)}/面（{colorMode === 'color' ? '彩色' : '黑白'}）× {totalFaces} 面
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-gray-900">¥{totalPrice}</span>
                <span className="text-xs text-gray-400">实际以机器计费为准</span>
              </div>
            </div>
          </Card>

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
