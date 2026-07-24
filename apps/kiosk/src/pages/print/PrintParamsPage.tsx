import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, KioskActionBar } from '@ai-job-print/ui'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
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
import {
  estimatePrintCents,
  formatPriceCents,
  unitCentsFor,
  usePrintPriceConfig,
} from '../../services/print/priceConfigApi'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
  pageRange?: string
}

const PRINTER_OFFLINE: PrinterStatus = {
  isOnline: false,
  hasPaper: true,
  tonerLevels: { black: 0, cyan: 0, magenta: 0, yellow: 0 },
}

function mapPrinterStatus(raw: string | null | undefined): PrinterStatus {
  switch (raw) {
    case 'ready':     return { isOnline: true,  hasPaper: true,  tonerLevels: { black: 100, cyan: 100, magenta: 100, yellow: 100 } }
    case 'offline':   return PRINTER_OFFLINE
    case 'error':     return { isOnline: true,  hasPaper: false, tonerLevels: { black: 0, cyan: 0, magenta: 0, yellow: 0 }, errorCode: 'hardwareError' }
    case 'low_paper': return { isOnline: true,  hasPaper: true,  tonerLevels: { black: 100, cyan: 100, magenta: 100, yellow: 100 }, errorCode: 'lowPaper' }
    default:          return { isOnline: true,  hasPaper: true,  tonerLevels: { black: 100, cyan: 100, magenta: 100, yellow: 100 } }
  }
}

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
    <div className={['flex overflow-hidden rounded-lg border', disabled ? 'border-neutral-100 opacity-50' : 'border-neutral-200'].join(' ')}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={[
            'flex h-12 flex-1 items-center justify-center text-sm font-medium transition-colors',
            value === opt.value ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 active:bg-neutral-100',
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
    <div className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3 last:border-b-0">
      <span className="text-sm text-neutral-500">{label}</span>
      <span className="text-right text-sm font-semibold text-neutral-900">{value}</span>
    </div>
  )
}

function InfoSection({ title, accent, children }: { title: string; accent: 'primary' | 'amber'; children: React.ReactNode }) {
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

export function PrintParamsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])

  const EMPTY_FILE: PrintFile = { name: '', size: '', pages: null }
  const file = locationState?.file ?? restoredSession?.file ?? EMPTY_FILE
  const materialCheck = locationState?.materialCheck ?? restoredSession?.materialCheck
  const restoredPrintParams = restoredSession?.printParams
  const source = locationState?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  // Page range passed from preview step
  const incomingPageRange = locationState?.pageRange ?? (restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? restoredPrintParams.pageRange : 'all')
  const effectivePages = file.pages ?? 1

  const { printerName, printer, loading: printerLoading } = usePrinterStatus()

  const [copies, setCopies] = useState(restoredPrintParams?.copies ?? 1)
  const [colorMode, setColorMode] = useState<ColorMode>(restoredPrintParams?.colorMode ?? 'black_white')
  const [duplex, setDuplex] = useState<DuplexMode>(restoredPrintParams?.duplex ?? 'simplex')
  const [orientation, setOrientation] = useState<PrintOrientation>(restoredPrintParams?.orientation ?? 'auto')
  const [scale, setScale] = useState<PrintScale>(restoredPrintParams?.scale ?? 'fit')
  const quality: PrintQuality = 'standard'
  const pagesPerSheet: PagesPerSheet = 1

  const colorTonerLow = printer.tonerLevels.cyan < 25 || printer.tonerLevels.magenta < 25 || printer.tonerLevels.yellow < 25

  const warnings = useMemo(() => {
    const w: { id: string; level: 'error' | 'warn' | 'info'; text: string }[] = []
    if (!printer.isOnline)
      w.push({ id: 'offline', level: 'error', text: '打印机离线，请联系工作人员' })
    if (printer.errorCode === 'paperJam')
      w.push({ id: 'jam', level: 'error', text: '打印机卡纸，请联系工作人员处理后再打印' })
    if (!printer.hasPaper)
      w.push({ id: 'empty', level: 'error', text: '打印机缺纸，请联系工作人员补纸' })
    if (colorTonerLow && colorMode === 'color')
      w.push({ id: 'color-toner', level: 'warn', text: '彩色墨粉不足，彩印效果可能不理想，建议改用黑白打印' })
    if (file.pages !== null && file.pages > 8 && duplex === 'simplex')
      w.push({ id: 'duplex-hint', level: 'info', text: `文件共 ${file.pages} 页，建议开启双面打印节省用纸` })
    return w
  }, [printer, colorTonerLow, colorMode, duplex, file.pages])

  const hasBlockingWarning = warnings.some((w) => w.level === 'error')

  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(effectivePages / pagesPerSheet)
    const tf = facesPerCopy * copies
    const su = duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [effectivePages, pagesPerSheet, copies, duplex])

  const priceCfg = usePrintPriceConfig()
  const unitCents = unitCentsFor(priceCfg.config, colorMode)
  const bwUnitCents = unitCentsFor(priceCfg.config, 'black_white')
  const colorUnitCents = unitCentsFor(priceCfg.config, 'color')
  const estimateCents = estimatePrintCents(priceCfg.config, { pages: file.pages, copies, colorMode })

  const handleNext = () => {
    const params: PrintJobParams = {
      copies,
      colorMode,
      duplex,
      paperSize: 'A4',
      pageRange: incomingPageRange === 'all' ? undefined : incomingPageRange,
      orientation,
      quality,
      scale,
      pagesPerSheet,
    }
    patchPrintMaterialSession({ file, materialCheck, printParams: params })
    navigate('/print/confirm', { state: { file, params, materialCheck, source } })
  }

  if (!locationState?.file && !restoredSession?.file) {
    return (
      <PrintPageFrame className="p-6">
      <div data-w2-page="print-params" className="flex min-h-full flex-col">
        <PrintPrototypeHeader
          title="打印参数"
          subtitle="设置份数、颜色、单双面等打印参数"
          step={4}
          backLabel="返回预览"
          onBack={() => navigate(-1)}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
            <AlertTriangleIcon className="h-10 w-10 text-warning" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-neutral-900">未找到文件信息</p>
            <p className="mt-2 text-sm text-neutral-500">请重新上传文件后再进行打印设置</p>
          </div>
          <Button size="lg" onClick={() => navigate(uploadPath)}>重新上传文件</Button>
        </div>
      </div>
      </PrintPageFrame>
    )
  }

  return (
    <PrintPageFrame className="p-6">
    <div data-w2-page="print-params" className="flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="打印参数"
        subtitle="设置份数、颜色、单双面等打印参数"
        step={4}
        backLabel="返回预览"
        onBack={() => navigate(-1)}
      />

      <div className="pp-params-content mt-4">

        {/* 打印机状态 */}
        <Card className="flex items-center gap-3 p-4">
          <div className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-full', printer.isOnline ? 'bg-success-bg' : 'bg-error-bg'].join(' ')}>
            {printer.isOnline
              ? <PrinterIcon className="h-5 w-5 text-success-fg" />
              : <WifiOffIcon className="h-5 w-5 text-error-fg" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900">{printerLoading ? '检测设备中…' : printerName}</p>
            <p className={['text-xs', printer.isOnline ? 'text-success-fg' : 'text-error-fg'].join(' ')}>
              {printerLoading ? '请稍候' : printer.isOnline ? '在线' : '离线'}
            </p>
          </div>
          {!printerLoading && printer.isOnline && <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" />}
        </Card>

        {/* 警告/提示 */}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-2">
            {warnings.map((w) => (
              <div
                key={w.id}
                className={[
                  'flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm',
                  w.level === 'error' ? 'bg-error-bg text-error-fg' : w.level === 'warn' ? 'bg-warning-bg text-warning-fg' : 'bg-primary-50 text-primary-700',
                ].join(' ')}
              >
                {w.level === 'info' ? <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        )}

        <SectionHead>基础参数</SectionHead>

        {/* 份数 */}
        <ParamCard label="打印份数">
          <div className="flex items-center gap-4">
            <button type="button" disabled={copies <= 1} onClick={() => setCopies(Math.max(1, copies - 1))} className="flex h-12 w-12 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40">
              <MinusIcon className="h-5 w-5 text-neutral-600" />
            </button>
            <span className="w-16 text-center text-2xl font-bold text-neutral-900">{copies}</span>
            <button type="button" disabled={copies >= 99} onClick={() => setCopies(Math.min(99, copies + 1))} className="flex h-12 w-12 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40">
              <PlusIcon className="h-5 w-5 text-neutral-600" />
            </button>
            <span className="text-sm text-neutral-400">（最多 99 份）</span>
          </div>
        </ParamCard>

        {/* 色彩 */}
        <ParamCard label="色彩模式">
          <ToggleGroup
            options={[{ label: '黑白', value: 'black_white' }, { label: '彩色', value: 'color' }]}
            value={colorMode}
            onChange={(v) => setColorMode(v as ColorMode)}
          />
          <p className="mt-2 text-xs text-neutral-400">
            {bwUnitCents === null || colorUnitCents === null
              ? '价格以收银台显示为准'
              : `黑白 ${formatPriceCents(bwUnitCents)}/页 · 彩色 ${formatPriceCents(colorUnitCents)}/页`}
          </p>
          {colorMode === 'color' && (
            <p className="mt-1 text-xs text-warning-fg">彩色效果以设备支持和当前耗材状态为准</p>
          )}
        </ParamCard>

        {/* 单双面 */}
        <ParamCard label="单双面">
          <ToggleGroup
            options={[{ label: '单面', value: 'simplex' }, { label: '双面（长边）', value: 'duplex_long_edge' }, { label: '双面（短边）', value: 'duplex_short_edge' }]}
            value={duplex}
            onChange={(v) => setDuplex(v as DuplexMode)}
          />
          <p className="mt-2 text-xs text-neutral-400">长边翻转适合纵向文档，短边翻转适合横向文档</p>
        </ParamCard>

        {/* 方向 */}
        <ParamCard label="页面方向">
          <ToggleGroup
            options={[{ label: '自动', value: 'auto' }, { label: '纵向', value: 'portrait' }, { label: '横向', value: 'landscape' }]}
            value={orientation}
            onChange={(v) => setOrientation(v as PrintOrientation)}
          />
        </ParamCard>

        {/* 缩放 */}
        <ParamCard label="缩放方式">
          <ToggleGroup
            options={[{ label: '适合页面', value: 'fit' }, { label: '实际大小', value: 'actual' }]}
            value={scale}
            onChange={(v) => setScale(v as PrintScale)}
          />
        </ParamCard>

        {/* 页范围（来自上一步） */}
        <ParamCard label="页面范围">
          <div className="flex h-12 items-center rounded-lg border border-neutral-100 bg-neutral-50 px-4 text-sm text-neutral-700">
            {incomingPageRange === 'all' ? '全部页面' : incomingPageRange}
            <span className="ml-2 text-xs text-neutral-400">（在预览步骤设置）</span>
          </div>
        </ParamCard>

        {/* 纸张 */}
        <ParamCard label="纸张规格">
          <div className="flex h-12 items-center rounded-lg border border-neutral-100 bg-neutral-50 px-4 text-sm text-neutral-500">
            A4（210 × 297 mm）— 仅支持 A4
          </div>
        </ParamCard>

        <SectionHead>用量预估</SectionHead>

        <Card className="p-5">
          <InfoRow label="文件页数" value={file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页`} />
          <InfoRow label="打印份数" value={`${copies} 份`} />
          <InfoRow label="颜色模式" value={colorMode === 'color' ? '彩色' : '黑白'} />
          <InfoRow label="纸张规格" value="A4" />
          <InfoRow label="总打印面" value={`${totalFaces} 面`} />
          <InfoRow label="预计用纸" value={`${sheetsUsed} 张`} />
          {paperSaved > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-xs text-success-fg">
              <InfoIcon className="h-4 w-4 shrink-0" />
              双面打印比单面节省 {paperSaved} 张纸
            </div>
          )}
        </Card>

        <SectionHead>费用明细</SectionHead>

        <Card className="p-5">
          {priceCfg.status === 'error' ? (
            <div className="flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-3 text-sm text-warning-fg">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              价格暂不可用，可继续操作，实付金额以收银台显示为准。
            </div>
          ) : (
            <>
              <InfoRow label="单价" value={unitCents === null ? '获取中…' : `${formatPriceCents(unitCents)} / 页（${colorMode === 'color' ? '彩色' : '黑白'}）`} />
              <InfoRow label="计费页数 × 份数" value={file.pages === null ? '页数待识别，以实际识别为准' : `${file.pages} 页 × ${copies} 份`} />
              <InfoRow label="打印费用" value={estimateCents === null ? '以收银台金额为准' : formatPriceCents(estimateCents)} />
              <div className="mt-4 flex items-baseline justify-between border-t border-neutral-100 pt-4">
                <p className="text-sm text-neutral-500">按内容页计费；实付以收银台为准</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-xs font-medium text-neutral-500">预估金额</span>
                  <span className="text-xl font-bold text-neutral-900">
                    {estimateCents === null ? '—' : formatPriceCents(estimateCents)}
                  </span>
                </div>
              </div>
            </>
          )}
        </Card>

        <InfoSection title="价格说明" accent="primary">
          <div className="overflow-hidden rounded-lg border border-neutral-100">
            <div className="grid grid-cols-4 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-500">
              <span>打印类型</span><span>规格</span><span>黑白</span><span>彩色</span>
            </div>
            {[
              ['文档/简历', 'A4 普通纸', bwUnitCents === null ? '—' : `${formatPriceCents(bwUnitCents)}/页`, colorUnitCents === null ? '—' : `${formatPriceCents(colorUnitCents)}/页`],
              ['证件照', '1寸/2寸标准版', '—', '待接入'],
              ['照片打印', '6寸 光面纸', '—', '待接入'],
              ['铜版纸简历', 'A4 铜版纸', '待接入', '待接入'],
            ].map(([type, spec, bw, color]) => (
              <div key={type} className="grid grid-cols-4 border-t border-neutral-100 px-3 py-2 text-xs text-neutral-700">
                <span className="font-medium text-neutral-900">{type}</span>
                <span>{spec}</span><span>{bw}</span>
                <span className="font-semibold text-primary-600">{color}</span>
              </div>
            ))}
          </div>
        </InfoSection>

        <InfoSection title="打印须知" accent="amber">
          <ol className="space-y-3 text-sm text-neutral-600">
            {[
              '上传文件需清晰完整，当前支持 PDF、JPG、PNG；Word 页内预览和转换能力后续接入。',
              '隐私检查只用于本次打印前确认；当前遮挡产物未生成时会明确提示仍使用原文件。',
              '打印完成后请从出纸口取件，如有质量问题请联系现场工作人员。',
            ].map((item, index) => (
              <li key={item} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning text-xs font-bold text-white">{index + 1}</span>
                <span className="leading-6">{item}</span>
              </li>
            ))}
          </ol>
        </InfoSection>

      </div>

      {/* 底部操作 */}
      <KioskActionBar className="mt-6">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate(-1)}>
          返回预览
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
