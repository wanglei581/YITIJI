import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CreditCardIcon,
  FileTextIcon,
  InfoIcon,
  LoaderIcon,
  PackageCheckIcon,
  PrinterIcon,
} from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { API_MODE } from '../../services/api/client'
import {
  estimatePrintCents,
  formatPriceCents,
  unitCentsFor,
  usePrintPriceConfig,
} from '../../services/print/priceConfigApi'
import { createPrintJob } from '../../services/print/printJobsApi'
import {
  clearPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  params: PrintJobParams
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}

const DUPLEX_LABEL: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边翻转）',
  duplex_short_edge: '双面（短边翻转）',
}

const ORIENTATION_LABEL: Record<string, string> = {
  auto: '自动',
  portrait: '纵向',
  landscape: '横向',
}

const DEFAULT_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

export function PrintConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])
  const file = state?.file ?? restoredSession?.file ?? { name: '未知文件', size: '-', pages: null }
  const params = state?.params ?? restoredSession?.printParams ?? DEFAULT_PARAMS
  const materialCheck = state?.materialCheck ?? restoredSession?.materialCheck
  const source = state?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  const effectivePages = file.pages ?? 1
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(effectivePages / params.pagesPerSheet)
    const tf = facesPerCopy * params.copies
    const su = params.duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [effectivePages, params])

  // 展示价（唯一来源=服务端价目；估价口径与服务端一致=单价×内容页×份数）
  // 实际扣款金额由服务端建单时计算（绝不信任前端）；付费单进收银台必见真实金额。
  const priceCfg = usePrintPriceConfig()
  const unitCents = unitCentsFor(priceCfg.config, params.colorMode)
  const estimateCents = estimatePrintCents(priceCfg.config, {
    pages: file.pages,
    copies: params.copies,
    colorMode: params.colorMode,
  })

  const summaryRows = [
    { label: '文件名称', value: file.name },
    { label: '文件页数', value: file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页` },
    { label: '纸张规格', value: 'A4（210 × 297 mm）' },
    { label: '打印份数', value: `${params.copies} 份` },
    { label: '色彩模式', value: params.colorMode === 'color' ? '彩色' : '黑白' },
    { label: '单双面', value: DUPLEX_LABEL[params.duplex] ?? params.duplex },
    { label: '页面方向', value: ORIENTATION_LABEL[params.orientation] ?? params.orientation },
    { label: '缩放方式', value: params.scale === 'fit' ? '适合页面' : '实际大小' },
    { label: '页面范围', value: params.pageRange ?? '全部页面' },
  ]

  const handleConfirm = async () => {
    if (API_MODE === 'http') {
      if (!file.fileUrl) {
        setSubmitError('打印文件尚未就绪，无法提交打印。请返回重新上传或重新生成文件后再试。')
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      try {
        const created = await createPrintJob({
          fileUrl:  file.fileUrl,
          fileMd5:  file.fileMd5,
          fileName: file.name,
          params,
          token:    getToken(),
        })
        clearPrintMaterialSession()
        const nextState = {
          ...location.state,
          file,
          params,
          source,
          taskId:      created.taskId,
          orderId:     created.orderId,
          orderNo:     created.orderNo,
          amountCents: created.amountCents,
          priceLines:  created.priceLines,
          paymentSessionToken: created.paymentSessionToken,
        }
        if (created.amountCents > 0 && created.payStatus !== 'paid') {
          navigate('/print/cashier', { state: nextState })
        } else {
          navigate('/print/progress', { state: nextState })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '提交失败，请重试'
        setSubmitError(msg)
        setSubmitting(false)
      }
      return
    }
    clearPrintMaterialSession()
    navigate('/print/progress', { state: { ...location.state, file, params, source } })
  }

  // Guard: 直达 /print/confirm（无前置上传）会拿到"未知文件"占位，禁止继续提交无效任务。
  if (!state?.file && !restoredSession?.file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full" style={{ background: 'rgb(193 74 52 / 10%)' }}>
          <AlertCircleIcon className="h-10 w-10" style={{ color: '#c14a34' }} />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold" style={{ color: 'var(--print-ink)' }}>未找到文件信息</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--print-muted)' }}>请重新上传文件后再确认打印</p>
        </div>
        <button
          type="button"
          className="print-confirm-primary"
          style={{ flex: 'none', minWidth: 200 }}
          onClick={() => navigate(uploadPath)}
        >
          重新上传文件
        </button>
      </div>
    )
  }

  // 费用展示字符串
  const costCalcLabel = priceCfg.status === 'error' || unitCents === null
    ? '价格暂不可用，实付以收银台显示为准'
    : file.pages === null
      ? `${formatPriceCents(unitCents)}/页 × 页数待识别 × ${params.copies} 份`
      : `${formatPriceCents(unitCents)}/页 × ${file.pages} 页 × ${params.copies} 份`

  const privWarnState = materialCheck?.redaction?.resultFileCreated === false
    && (materialCheck?.redactedCount ?? 0) > 0

  return (
    <div className="print-proto flex min-h-full flex-col" style={{ padding: '0 0 0 0' }}>
      <div style={{ padding: '0 24px' }}>
        <PrintPrototypeHeader
          title="确认打印"
          subtitle="核对以下参数，确认无误后提交打印任务"
          step={5}
          backLabel="返回修改"
          onBack={() => navigate(-1)}
        />
      </div>

      {/* 主内容区：两栏 */}
      <div
        className="print-confirm-split"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '0 24px' }}
      >
        {/* 左栏：文件条 + 参数摘要卡 */}
        <div className="print-confirm-left" style={{ overflowY: 'auto' }}>

          {/* 文件条 */}
          <div className="print-file-strip">
            <div className="print-file-icon">
              <FileTextIcon aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="print-file-name">{file.name}</b>
              <span className="print-file-meta">
                {file.size}
                {file.pages !== null && ` · ${file.pages} 页`}
              </span>
            </div>
            {materialCheck && (
              <span className="print-file-chip">
                <CheckCircleIcon style={{ width: 16, height: 16 }} aria-hidden="true" />
                材料检查已完成
              </span>
            )}
          </div>

          {/* 参数摘要卡 */}
          <div className="print-sum-card">
            <b className="print-sum-title">参数确认清单</b>
            <div className="print-sum-table">
              {summaryRows.map(({ label, value }) => (
                <div key={label} className="print-sum-row">
                  <span className="k">{label}</span>
                  <span className="v">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右栏：隐私摘要 + 费用 + 流程 + 须知 */}
        <div className="print-confirm-side" style={{ overflowY: 'auto' }}>

          {/* 隐私摘要卡（仅有 materialCheck 时展示） */}
          {materialCheck && (
            <div className={privWarnState ? 'print-priv-card' : 'print-priv-card'}>
              <div className="print-priv-head">
                <InfoIcon aria-hidden="true" />
                <b>隐私检查摘要{materialCheck.mode === 'demo' ? '（流程演示）' : ''}</b>
              </div>
              <p className="print-priv-body">
                {materialCheck.mode === 'demo' ? '已完成打印前材料检查流程演示' : '已完成打印前材料检查'}；
                遮挡 {materialCheck.redactedCount} 项，保留 {materialCheck.keptCount} 项。
                {privWarnState
                  ? '当前版本尚未生成遮挡后文件，打印仍使用原文件；请确认是否继续。'
                  : '本次打印前选择已记录，仅用于本次确认。'}
              </p>
            </div>
          )}

          {/* 费用卡 */}
          <div className="print-cost-card">
            <div className="print-est-row">
              <span className="k">总打印面</span>
              <span className="v">{totalFaces} 面</span>
            </div>
            <div className="print-est-row">
              <span className="k">预计用纸</span>
              <span className="v">
                {sheetsUsed} 张
                {paperSaved > 0 && <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--print-muted)', marginLeft: 6 }}>（双面省 {paperSaved} 张）</span>}
              </span>
            </div>
            <div className="print-est-row">
              <span className="k">计费方式</span>
              <span className="v" style={{ fontSize: 16 }}>{costCalcLabel}</span>
            </div>
            {params.colorMode === 'color' && (
              <div className="print-est-row">
                <span className="k" style={{ fontSize: 14, color: '#b8683c' }}>彩色效果以设备支持和当前耗材状态为准</span>
              </div>
            )}
            <div className="print-cost-total">
              <span className="print-cost-label">
                预计费用<br />
                按内容页计费 · 实付以收银台为准<br />
                金额以现场公示价为准
              </span>
              <span className="print-cost-num">
                <small>¥</small>
                {estimateCents === null ? '—' : formatPriceCents(estimateCents)}
              </span>
            </div>
          </div>

          {/* 提交后流程卡 */}
          <div className="print-flow-card">
            <b className="print-flow-title">
              提交后流程
              <span>免费订单自动跳过支付</span>
            </b>
            <div className="print-flow-row">
              <div className="print-flow-step">
                <CreditCardIcon aria-hidden="true" />
                <span>完成支付</span>
              </div>
              <svg className="print-flow-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
              <div className="print-flow-step">
                <PrinterIcon aria-hidden="true" />
                <span>自动打印</span>
              </div>
              <svg className="print-flow-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
              <div className="print-flow-step">
                <PackageCheckIcon aria-hidden="true" />
                <span>取件核对</span>
              </div>
            </div>
          </div>

          {/* 打印须知卡 */}
          <div className="print-rules-card">
            <b className="print-rules-title">打印须知</b>
            <ol className="print-rules-list">
              <li>上传文件需清晰完整，当前支持 PDF、JPG、PNG。</li>
              <li>隐私检查仅用于本次打印前确认，扫描件 / 图片可能经第三方 OCR 识别文字。</li>
              <li>提交后请留在机器旁，支付完成后自动开始打印。</li>
              <li>打印完成请从出纸口取件；如有质量问题请联系现场工作人员。</li>
            </ol>
          </div>
        </div>
      </div>

      {/* 提交错误提示 */}
      {submitError && (
        <div className="print-submit-error" style={{ margin: '0 24px' }}>
          <AlertCircleIcon aria-hidden="true" />
          <span>{submitError}</span>
        </div>
      )}

      {/* 底部行动条 */}
      <div className="print-confirm-actionbar" style={{ padding: '16px 24px 24px' }}>
        <button
          type="button"
          className="print-confirm-back"
          disabled={submitting}
          onClick={() => navigate(-1)}
        >
          <ArrowLeftIcon aria-hidden="true" />
          返回修改
        </button>
        <button
          type="button"
          className="print-confirm-primary"
          disabled={submitting}
          onClick={() => void handleConfirm()}
        >
          {submitting ? (
            <>
              <LoaderIcon style={{ width: 24, height: 24, animation: 'spin 1s linear infinite' }} aria-hidden="true" />
              提交中…
            </>
          ) : (
            <>
              <PrinterIcon aria-hidden="true" />
              按以上设置打印原文件
            </>
          )}
        </button>
      </div>
    </div>
  )
}
