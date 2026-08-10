import { useMemo, useState } from 'react'
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
import {
  hasUnverifiedPrintParams,
  VERIFIED_PRINT_PARAMETER_PROFILE,
  PrintJobParams,
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
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { countPagesInRange } from './pageRange'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
  pageRange?: string
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
  const restoredParamsWereRestricted = restoredPrintParams
    ? hasUnverifiedPrintParams(restoredPrintParams)
    : false
  const source = locationState?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  // Page range passed from preview step
  const incomingPageRange = locationState?.pageRange ?? (restoredPrintParams?.pageRange && restoredPrintParams.pageRange !== 'all' ? restoredPrintParams.pageRange : 'all')
  // 用量与估价按 pageRange 交集；未知页数时退回 1 仅用于纸张预估，不作为实付依据。
  const billablePages =
    file.pages === null
      ? null
      : countPagesInRange(incomingPageRange === 'all' ? 'all' : incomingPageRange, file.pages)
  const effectivePages = billablePages ?? (file.pages ?? 1)

  const {
    printerName,
    printer,
    printerLabel,
    printerReady,
    kind: printerKind,
    loading: printerLoading,
  } = useTerminalDeviceStatus()

  const [copies, setCopies] = useState(restoredPrintParams?.copies ?? 1)
  const colorMode = VERIFIED_PRINT_PARAMETER_PROFILE.colorMode
  const duplex = VERIFIED_PRINT_PARAMETER_PROFILE.duplex
  const [orientation, setOrientation] = useState<PrintOrientation>(restoredPrintParams?.orientation ?? 'auto')
  const [scale, setScale] = useState<PrintScale>(restoredPrintParams?.scale ?? 'fit')
  const quality: PrintQuality = 'standard'
  const pagesPerSheet = VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet

  const warnings = useMemo(() => {
    const w: { id: string; level: 'error' | 'warn' | 'info'; text: string }[] = []
    if (printerKind === 'unknown' || printer.errorCode === 'statusUnknown') {
      w.push({ id: 'unknown', level: 'error', text: '打印机状态未知，请稍候或联系工作人员' })
    } else if (!printerReady) {
      w.push({ id: 'offline', level: 'error', text: '打印机离线，请联系工作人员' })
    }
    if (printer.errorCode === 'paperJam')
      w.push({ id: 'jam', level: 'error', text: '打印机卡纸，请联系工作人员处理后再打印' })
    if (!printer.hasPaper)
      w.push({ id: 'empty', level: 'error', text: '打印机缺纸，请联系工作人员补纸' })
    return w
  }, [printer, printerReady, printerKind])

  const hasBlockingWarning = warnings.some((w) => w.level === 'error') || !printerReady

  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(effectivePages / pagesPerSheet)
    const tf = facesPerCopy * copies
    const su = duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [effectivePages, pagesPerSheet, copies, duplex])

  const priceCfg = usePrintPriceConfig()
  const unitCents = unitCentsFor(priceCfg.config, colorMode)
  const bwUnitCents = unitCentsFor(priceCfg.config, 'black_white')
  const estimateCents =
    billablePages === null
      ? null
      : estimatePrintCents(priceCfg.config, { pages: billablePages, copies, colorMode })

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
          subtitle="设置份数、页面方向与页面范围"
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
        subtitle="设置份数、页面方向与页面范围"
        step={4}
        backLabel="返回预览"
        onBack={() => navigate(-1)}
      />

      <div className="pp-params-content mt-4">
        <div className="pp-split">
          <div className="pp-params-left flex min-w-0 flex-1 flex-col gap-4">
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
                onChange={() => undefined}
                disabled
              />
              <p className="mt-2 text-xs text-neutral-500">
                当前仅开放黑白、单面、每张 1 页
                {restoredParamsWereRestricted ? '；检测到旧会话参数，已明确收口为当前组合' : ''}
              </p>
            </ParamCard>

            {/* 单双面 */}
            <ParamCard label="单双面">
              <ToggleGroup
                options={[{ label: '单面', value: 'simplex' }, { label: '双面（长边）', value: 'duplex_long_edge' }, { label: '双面（短边）', value: 'duplex_short_edge' }]}
                value={duplex}
                onChange={() => undefined}
                disabled
              />
              <p className="mt-2 text-xs text-neutral-400">彩色、双面和多页合一将在厂家确认和 Windows 真机验收后再开放</p>
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
          </div>

          <aside className="pp-side-col">
            {/* 打印机状态 */}
            <Card className="flex items-center gap-3 p-4">
              <div className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-full', printerReady ? 'bg-success-bg' : 'bg-error-bg'].join(' ')}>
                {printerReady
                  ? <PrinterIcon className="h-5 w-5 text-success-fg" />
                  : <WifiOffIcon className="h-5 w-5 text-error-fg" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{printerLoading ? '检测设备中…' : printerName}</p>
                <p className={['text-xs', printerReady ? 'text-success-fg' : 'text-error-fg'].join(' ')}>
                  {printerLoading ? '请稍候' : printerLabel}
                </p>
              </div>
              {!printerLoading && printerReady && <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" />}
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

            <SectionHead>用量预估</SectionHead>

            <Card className="p-5">
              <InfoRow label="文件页数" value={file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页`} />
              <InfoRow label="打印份数" value={`${copies} 份`} />
              <InfoRow label="颜色模式" value="黑白" />
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
                  <InfoRow label="单价" value={unitCents === null ? '获取中…' : `${formatPriceCents(unitCents)} / 页（黑白）`} />
                  <InfoRow
                    label="计费页数 × 份数"
                    value={
                      billablePages === null
                        ? '页数待识别，以确认页报价为准'
                        : `${billablePages} 页 × ${copies} 份`
                    }
                  />
                  <InfoRow label="打印费用" value={estimateCents === null ? '以确认页报价为准' : formatPriceCents(estimateCents)} />
                  <div className="mt-4 flex items-baseline justify-between border-t border-neutral-100 pt-4">
                    <p className="text-sm text-neutral-500">预估含页范围；实付以确认页报价为准</p>
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
                  ['文档/简历', 'A4 普通纸', bwUnitCents === null ? '—' : `${formatPriceCents(bwUnitCents)}/页`, '待真机验证'],
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
          </aside>
        </div>
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
