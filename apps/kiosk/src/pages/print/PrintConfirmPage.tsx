import { useEffect, useMemo, useState } from 'react'
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
  TicketIcon,
} from 'lucide-react'
import {
  hasParamsBeyondCapability,
  restrictToAllowedPrintParams,
  type BenefitType,
  type MemberBenefitItem,
  type PrintJobParams,
} from '@ai-job-print/shared'
import { KioskActionBar } from '@ai-job-print/ui'
import { useAuth } from '../../auth/useAuth'
import { loginPathForCurrentLocation } from '../../auth/returnPath'
import { API_MODE } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import { usePrintParamCapability } from '../../hooks/usePrintParamCapability'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import {
  fetchPrintBenefits,
  resolvePrintBenefitState,
  PRINT_BENEFIT_REDEEM_CTA_LABEL,
  PRINT_BENEFIT_REDEEM_DISABLED_REASON,
} from '../../services/api/benefits'
import { fetchPrintPriceConfig, unitCentsFor } from '../../services/print/priceConfigApi'
import { createPrintJob, quotePrintOrder, PrintApiError } from '../../services/print/printJobsApi'
import { appendSelfAssessmentToResume } from '../../services/api/selfAssessment'
import { abandonContractReviewReport } from '../../services/api/contractReview'
import { formatCents } from './cashierStatus'
import {
  clearPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'
import { materialRedactionBadge } from './piiRedaction'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  params: PrintJobParams
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
  contractReport?: {
    fileId: string
    abandonToken: string
  }
}

interface SelfAssessmentSessionSnapshot {
  taskId?: string
  accessToken?: string
  result?: { expiresAt?: string }
}

const SELF_ASSESSMENT_SESSION_KEY = 'self_assessment_session_v1'

function readSelfAssessmentSnapshot(): SelfAssessmentSessionSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SELF_ASSESSMENT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SelfAssessmentSessionSnapshot
    if (!parsed || typeof parsed !== 'object' || !parsed.taskId) return null
    return parsed
  } catch {
    return null
  }
}

type QuoteView =
  | { status: 'demo' }
  | { status: 'loading' }
  | { status: 'ready'; amountCents: number; billablePages: number; unitCents: number; quantity: number }
  | { status: 'unavailable'; reason: string }

/**
 * 色彩模式展示名。必须与计价用的 params.colorMode 同源 —— 报价
 * （unitCentsFor(config, params.colorMode)）和建单都读真实值，摘要卡此前却写死「黑白」。
 * 一旦 Admin 把某台终端的 color_print 能力标成 available，用户选彩色后
 * 会看到「黑白」却按彩色单价扣款（print_color_page 50 分/页 vs print_bw_page 20 分/页），
 * 属 CLAUDE.md §9「不伪造能力」红线 + 资损。
 */
const COLOR_MODE_LABEL: Record<string, string> = {
  black_white: '黑白',
  color: '彩色',
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

/** 权益卡展示用类型名（与 /me/benefits 返回的 benefitType 一一对应，不新增语义）。 */
const BENEFIT_TYPE_LABEL: Record<BenefitType, string> = {
  coupon: '优惠券',
  free_quota: '免费次数',
  package_entitlement: '服务额度',
  subsidy_eligibility_hint: '政策资格提示',
}

/** 权益列表读取态（真实 GET /me/benefits 结果；loadedAt 用于有效期比对，避免每次渲染取新时间）。 */
type BenefitsView =
  | { status: 'loading' }
  | { status: 'ready'; items: MemberBenefitItem[]; loadedAt: number }
  | { status: 'error' }

/** 公示价读取态（真实 GET /print/price-config；与本单报价单价比对识别「后台刚调价」）。 */
type PriceCfgView =
  | { status: 'loading' }
  | { status: 'ready'; unitCents: number | null }
  | { status: 'error' }

function benefitQuantityLine(item: MemberBenefitItem): string {
  const remaining = item.quantityRemaining ?? 0
  return item.quantityTotal === null ? `剩余 ${remaining}` : `剩余 ${remaining} / ${item.quantityTotal}`
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
  const { getToken, isLoggedIn } = useAuth()
  const state = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])
  const file = state?.file ?? restoredSession?.file ?? { name: '未知文件', size: '-', pages: null }
  const incomingParams = state?.params ?? restoredSession?.printParams ?? DEFAULT_PARAMS
  // 按**本机**能力收口：已验收的彩色/双面原样保留，未验收的才砍回基线。
  // 无条件砍成黑白会把管理员已验收的能力静默降级，用户选了彩色却按黑白出纸。
  const capability = usePrintParamCapability()
  const {
    printerReady,
    printerLabel,
    loading: printerLoading,
  } = useTerminalDeviceStatus()
  const printerBlocked = printerLoading || !printerReady
  const capabilityAllows = useMemo(
    () => ({ color: capability.color.allowed, duplex: capability.duplex.allowed }),
    [capability.color.allowed, capability.duplex.allowed],
  )
  const paramsWereRestricted = hasParamsBeyondCapability(incomingParams, capabilityAllows)
  const params = useMemo(
    () => restrictToAllowedPrintParams(incomingParams, capabilityAllows),
    [incomingParams, capabilityAllows],
  )
  const materialCheck = state?.materialCheck ?? restoredSession?.materialCheck
  const source = state?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  const contractReport = state?.contractReport
  const isContractReport = Boolean(contractReport)
  const effectivePages = file.pages ?? 1
  const [submitting, setSubmitting] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [appendSelfAssessment, setAppendSelfAssessment] = useState(false)
  const selfAssessmentSnapshot = useMemo(() => readSelfAssessmentSnapshot(), [])
  const appendEligible =
    !isContractReport &&
    appendSelfAssessment &&
    Boolean(selfAssessmentSnapshot?.taskId) &&
    Boolean(file.fileId) &&
    (file.mimeType === undefined || file.mimeType === 'application/pdf')
  const [quote, setQuote] = useState<QuoteView>(
    API_MODE === 'http' ? { status: 'loading' } : { status: 'demo' },
  )
  // 权益卡只在真实后端模式、且本页确有文件上下文时才取数：
  // 直达 /print/confirm（无文件）会走下方守卫分支，不该为一个不会渲染的卡片发请求。
  const hasFileContext = Boolean(state?.file ?? restoredSession?.file)
  const benefitCardEnabled = API_MODE === 'http' && hasFileContext
  const [benefits, setBenefits] = useState<BenefitsView>({ status: 'loading' })
  const [priceCfg, setPriceCfg] = useState<PriceCfgView>({ status: 'loading' })

  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(effectivePages / params.pagesPerSheet)
    const tf = facesPerCopy * params.copies
    const su = params.duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [effectivePages, params])

  // P0-1：应付金额只读后端 POST /orders/quote；无 fileUrl / 报价失败时不显示具体金额。
  useEffect(() => {
    if (API_MODE !== 'http') {
      setQuote({ status: 'demo' })
      return
    }
    if (!file.fileUrl) {
      setQuote({ status: 'unavailable', reason: '打印文件尚未就绪，无法报价' })
      return
    }
    let cancelled = false
    setQuote({ status: 'loading' })
    // 带 terminalId：彩色/双面必须按本机能力登记计价，服务端会 fail-closed 复核。
    void quotePrintOrder({ fileUrl: file.fileUrl, params, terminalId: getTerminalId() || undefined })
      .then((q) => {
        if (cancelled) return
        const line = q.priceLines[0]
        setQuote({
          status: 'ready',
          amountCents: q.amountCents,
          billablePages: q.billablePages,
          unitCents: line?.unitCents ?? 0,
          quantity: line?.quantity ?? q.billablePages * params.copies,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const reason =
          err instanceof PrintApiError && err.code === 'PRINTER_UNAVAILABLE'
            ? err.message
            : '页数待服务端确认，以最终计费为准'
        setQuote({ status: 'unavailable', reason })
      })
    return () => {
      cancelled = true
    }
    // params 字段逐项列出，避免对象引用变化导致重复报价；与后端计费相关的字段均已覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional field-level deps
  }, [
    file.fileUrl,
    params.copies,
    params.colorMode,
    params.pageRange,
    params.pagesPerSheet,
    params.duplex,
    params.orientation,
    params.quality,
    params.scale,
    params.paperSize,
  ])

  // S2：公示价快照（GET /print/price-config）。与本单报价单价是对同一份 PriceConfig 的
  // 两次独立读取；不一致即说明后台在两次读取之间改过价（六态之「后台刚调价」）。
  useEffect(() => {
    if (!benefitCardEnabled) return
    let cancelled = false
    setPriceCfg({ status: 'loading' })
    void fetchPrintPriceConfig()
      .then((config) => {
        if (!cancelled) setPriceCfg({ status: 'ready', unitCents: unitCentsFor(config, params.colorMode) })
      })
      .catch(() => {
        if (!cancelled) setPriceCfg({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [benefitCardEnabled, params.colorMode])

  // S2：本人权益列表（GET /me/benefits）。游客态不发请求 —— 权益挂在本人账号下，
  // 拿不到就如实说「未认领身份」，不是「没有权益」。
  useEffect(() => {
    if (!benefitCardEnabled) return
    if (!isLoggedIn) {
      setBenefits({ status: 'ready', items: [], loadedAt: Date.now() })
      return
    }
    let cancelled = false
    setBenefits({ status: 'loading' })
    void fetchPrintBenefits(getToken())
      .then((page) => {
        if (!cancelled) setBenefits({ status: 'ready', items: page.items, loadedAt: Date.now() })
      })
      .catch(() => {
        if (!cancelled) setBenefits({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [benefitCardEnabled, isLoggedIn, getToken])

  // S2：六态判定。四个输入全部是真实数据 —— 登录态、/me/benefits、/orders/quote、
  // /print/price-config。没有任何一态来自 URL 参数、本地猜测或写死分支。
  const benefitView = useMemo(() => {
    if (!benefitCardEnabled) return null
    const quoteInput =
      quote.status === 'ready'
        ? { status: 'ready' as const, amountCents: quote.amountCents, unitCents: quote.unitCents }
        : quote.status === 'unavailable'
          ? { status: 'unavailable' as const }
          : { status: 'loading' as const }
    return resolvePrintBenefitState({
      isLoggedIn,
      benefits:
        benefits.status === 'ready'
          ? { status: 'ready', items: benefits.items }
          : { status: benefits.status, items: [] },
      quote: quoteInput,
      priceConfig:
        priceCfg.status === 'ready'
          ? { status: 'ready', unitCents: priceCfg.unitCents }
          : { status: priceCfg.status, unitCents: null },
      now: benefits.status === 'ready' ? benefits.loadedAt : Date.now(),
    })
  }, [benefitCardEnabled, isLoggedIn, benefits, quote, priceCfg])

  const summaryRows = [
    { label: '文件名称', value: file.name },
    { label: '文件页数', value: file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页` },
    { label: '纸张规格', value: 'A4（210 × 297 mm）' },
    { label: '打印份数', value: `${params.copies} 份` },
    { label: '色彩模式', value: COLOR_MODE_LABEL[params.colorMode] ?? params.colorMode },
    { label: '单双面', value: DUPLEX_LABEL[params.duplex] ?? params.duplex },
    { label: '页面方向', value: ORIENTATION_LABEL[params.orientation] ?? params.orientation },
    { label: '缩放方式', value: params.scale === 'fit' ? '适合页面' : '实际大小' },
    { label: '页面范围', value: !params.pageRange || params.pageRange === 'all' ? '全部页面' : params.pageRange },
  ]

  const confirmBlocked =
    submitting ||
    abandoning ||
    printerBlocked ||
    (API_MODE === 'http' && quote.status !== 'ready' && quote.status !== 'demo')

  const handleBack = async () => {
    if (!contractReport) {
      navigate(-1)
      return
    }
    setAbandoning(true)
    setSubmitError(null)
    try {
      await abandonContractReviewReport(contractReport.fileId, contractReport.abandonToken)
      navigate('/resume-service', { replace: true })
    } catch {
      setSubmitError('风险提示报告删除失败，请重试。系统仍会按最长保留时限自动清理。')
      setAbandoning(false)
    }
  }

  const handleConfirm = async () => {
    if (printerBlocked) {
      setSubmitError(
        printerLoading
          ? '正在确认打印机状态，请稍候'
          : `${printerLabel}。当前不能下单，请联系工作人员。`,
      )
      return
    }
    if (API_MODE === 'http') {
      if (!file.fileUrl) {
        setSubmitError('打印文件尚未就绪，无法提交打印。请返回重新上传或重新生成文件后再试。')
        return
      }
      if (quote.status !== 'ready') {
        setSubmitError(quote.status === 'unavailable' ? quote.reason : '报价尚未就绪，请稍后再试')
        return
      }
      if (appendSelfAssessment && !file.fileId) {
        setSubmitError('当前文件不支持「附加自我探索」合并，请先在简历页生成可合并的简历 PDF 后再试。')
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      try {
        let printFileUrl = file.fileUrl
        let printFileName = file.name
        let printFileMd5: string | undefined = file.fileMd5
        if (appendEligible && selfAssessmentSnapshot?.taskId && file.fileId) {
          const authToken = getToken()
          const merged = await appendSelfAssessmentToResume(
            selfAssessmentSnapshot.taskId,
            file.fileId,
            { token: authToken, accessToken: selfAssessmentSnapshot.accessToken ?? null },
          )
          printFileUrl = merged.printFileUrl ?? ''
          printFileName = merged.filename || `${file.name.replace(/\.pdf$/i, '')}-self-assessment.pdf`
          printFileMd5 = undefined
        }
        const created = await createPrintJob({
          fileUrl:  printFileUrl,
          fileMd5:  printFileMd5,
          fileName: printFileName,
          params,
          token:    getToken(),
        })
        clearPrintMaterialSession()
        const nextState = {
          ...(isContractReport ? {} : location.state),
          file: { ...file, fileUrl: printFileUrl, name: printFileName, fileMd5: printFileMd5 },
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
        const msg =
          err instanceof PrintApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '提交失败，请重试'
        setSubmitError(msg)
        setSubmitting(false)
      }
      return
    }
    clearPrintMaterialSession()
    navigate('/print/progress', {
      state: { ...(isContractReport ? {} : location.state), file, params, source },
    })
  }

  // Guard: 直达 /print/confirm（无前置上传）会拿到"未知文件"占位，禁止继续提交无效任务。
  if (!state?.file && !restoredSession?.file) {
    return (
      <PrintPageFrame>
        <div data-w2-page="print-confirm" className="print-confirm-body">
          <div className="print-confirm-guard">
            <div className="print-confirm-guard-icon">
              <AlertCircleIcon aria-hidden="true" />
            </div>
            <div>
              <p className="print-confirm-guard-title">未找到文件信息</p>
              <p className="print-confirm-guard-hint">请重新上传文件后再确认打印</p>
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
        </div>
      </PrintPageFrame>
    )
  }

  const costCalcLabel =
    quote.status === 'ready'
      ? `${formatCents(quote.unitCents)}/页 × ${quote.quantity} 页`
      : quote.status === 'loading'
        ? '正在向服务端确认页数与价目…'
        : quote.status === 'demo'
          ? '演示模式不显示金额'
          : quote.status === 'unavailable'
            ? quote.reason
            : '页数待服务端确认，以最终计费为准'

  // 遮挡结论只从后端 claim 派生（piiRedaction.materialRedactionBadge），本页不自行拼装。
  const redactionBadge = materialRedactionBadge(materialCheck?.redaction)
  const privWarnState = redactionBadge !== null && redactionBadge.tone !== 'success'

  return (
    <PrintPageFrame>
    <div data-w2-page="print-confirm" className="print-confirm-body">
      <PrintPrototypeHeader
        title="确认打印"
        subtitle="核对以下参数，确认无误后提交打印任务"
        step={4}
        backLabel={isContractReport ? '放弃打印' : '返回修改'}
        onBack={() => void handleBack()}
      />

      <div className="print-confirm-split" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* 左栏：文件条 + 参数摘要卡 */}
        <div className="print-confirm-left" style={{ overflowY: 'auto' }}>

          {/* 文件条 */}
          {printerBlocked && (
            <div className="mb-4 rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning-fg" role="status">
              {printerLoading
                ? '正在确认打印机状态…'
                : `${printerLabel}。当前不能下单，请联系工作人员。`}
            </div>
          )}
          {paramsWereRestricted && (
            <div className="mb-4 rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning-fg">
              参数已按本机已验证能力收口
              {!capabilityAllows.color ? '：彩色未在本机通过真机验证，已改为黑白' : ''}
              {!capabilityAllows.duplex ? '；双面未在本机通过真机验证，已改为单面' : ''}
              。收口后的参数才参与报价。
            </div>
          )}
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
                <div key={label} className="print-sum-row" data-sum-row={label}>
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
                {materialCheck.mode === 'demo' ? '已完成打印前材料检查流程演示。' : ''}
                {redactionBadge ? `${redactionBadge.text}。` : '本次没有需要遮挡的内容。'}
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
              <span className="v" data-cost-calc style={{ fontSize: 16 }}>{costCalcLabel}</span>
            </div>
            <div className="print-cost-total">
              <span className="print-cost-label">
                预计费用<br />
                按内容页计费 · 实付以收银台为准<br />
                金额以现场公示价为准
              </span>
              <span className="print-cost-num">
                <small>¥</small>
                {quote.status === 'ready'
                  ? formatCents(quote.amountCents).replace(/^¥/, '')
                  : quote.status === 'loading'
                    ? '…'
                    : '—'}
              </span>
            </div>
          </div>

          {/* 权益卡（V6 P06 s4）：**只读**。六态由真实数据判定，核销 CTA 保持可聚焦禁用。 */}
          {benefitView && (
            <div className="print-benefit-card" data-benefit-state={benefitView.state}>
              <div className="print-benefit-head">
                <TicketIcon aria-hidden="true" />
                <b>权益与本单价格</b>
                <span className="print-benefit-snap">价目与权益均来自后台配置</span>
              </div>
              <p className="print-benefit-title">{benefitView.title}</p>
              <p className="print-benefit-detail">{benefitView.detail}</p>

              {benefitView.repricedUnits && (
                <p className="print-benefit-units">
                  本单报价单价 {formatCents(benefitView.repricedUnits.quoteUnitCents)}
                  ，现行公示单价 {formatCents(benefitView.repricedUnits.configUnitCents)}
                </p>
              )}

              {benefitView.grants.length > 0 && (
                <ul className="print-benefit-list">
                  {benefitView.grants.map((grant) => (
                    <li key={grant.id} className="print-benefit-item">
                      <b>{grant.title}</b>
                      <span>
                        {BENEFIT_TYPE_LABEL[grant.benefitType] ?? grant.benefitType}
                        {' · '}
                        {benefitQuantityLine(grant)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {benefitView.showLoginAction && (
                <button
                  type="button"
                  className="print-benefit-login"
                  onClick={() => navigate(loginPathForCurrentLocation())}
                >
                  去登录查看我的权益
                </button>
              )}

              {/* 核销 CTA：真 <button> + aria-disabled（保持可聚焦、可被读屏播报），
                  不加 disabled 属性以免退出 Tab 序列；不绑任何 /orders/:id/redeem 调用。
                  原因常驻可见并经 aria-describedby 关联，杜绝「按了没反应」的死按钮。 */}
              {benefitView.state === 'available' && (
                <>
                  <button
                    type="button"
                    className="print-benefit-redeem"
                    aria-disabled="true"
                    aria-describedby="print-benefit-redeem-reason"
                    data-benefit-redeem="disabled"
                  >
                    {PRINT_BENEFIT_REDEEM_CTA_LABEL}
                  </button>
                  <p className="print-benefit-reason" id="print-benefit-redeem-reason">
                    {PRINT_BENEFIT_REDEEM_DISABLED_REASON}
                  </p>
                </>
              )}
            </div>
          )}

          {/* 提交后流程 + 打印须知（合并，避免右栏碎卡堆叠） */}
          <div className="print-flow-card print-rules-card">
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

          {/* 附加自我探索摘要（仅在已有测评结果且为 PDF 简历时出现） */}
          {!isContractReport && selfAssessmentSnapshot?.taskId && (
            <div className="print-rules-card print-self-assessment-card">
              <label className="print-self-assessment-toggle">
                <input
                  type="checkbox"
                  checked={appendSelfAssessment}
                  onChange={(e) => setAppendSelfAssessment(e.target.checked)}
                  disabled={!file.fileId || file.mimeType === 'image/jpeg' || file.mimeType === 'image/png'}
                />
                <span>附加自我探索 · 倾向参考摘要</span>
              </label>
              <p className="print-self-assessment-hint">
                仅在本人简历下方合并一份本人自助参考摘要；勾选后系统会即时生成仅供本人打印的合并 PDF，文件名追加 <code>-self-assessment</code>；合并结果不会进入任何企业、合作机构、Partner 或第三方可见的分享链路。
              </p>
              {appendSelfAssessment && !file.fileId && (
                <p className="print-self-assessment-hint" role="alert">
                  当前文件不支持合并：请在简历页生成可合并的简历 PDF 后再勾选此项。
                </p>
              )}
            </div>
          )}

          {/* 打印须知卡 */}
          <div className="print-rules-card">
            <b className="print-rules-title" style={{ marginTop: 16 }}>打印须知</b>
            <ol className="print-rules-list">
              {isContractReport ? (
                <>
                  <li>本次仅打印 AI 风险提示报告，不打印合同原件。</li>
                  <li>报告可能包含敏感条款摘要，请勿离开终端并及时取件。</li>
                </>
              ) : (
                <>
                  <li>上传文件需清晰完整，当前支持 PDF、JPG、PNG。</li>
                  <li>隐私检查仅用于本次打印前确认，扫描件 / 图片可能经第三方 OCR 识别文字。</li>
                </>
              )}
              <li>提交后请留在机器旁，任务确认后自动开始打印（免费任务直接进入打印队列，付费任务完成支付后开始）。</li>
              <li>打印完成请从出纸口取件；如有质量问题请联系现场工作人员。</li>
            </ol>
          </div>
        </div>
      </div>

      {/* 提交错误提示 */}
      {submitError && (
        <div className="print-submit-error">
          <AlertCircleIcon aria-hidden="true" />
          <span>{submitError}</span>
        </div>
      )}

      {/* 底部行动条 */}
      <KioskActionBar className="print-confirm-actionbar">
        <button
          type="button"
          className="print-confirm-back"
          disabled={submitting || abandoning}
          onClick={() => void handleBack()}
        >
          {abandoning
            ? <LoaderIcon style={{ width: 24, height: 24, animation: 'spin 1s linear infinite' }} aria-hidden="true" />
            : <ArrowLeftIcon aria-hidden="true" />}
          {isContractReport ? (abandoning ? '正在删除…' : '放弃打印') : '返回修改'}
        </button>
        <button
          type="button"
          className="print-confirm-primary"
          disabled={confirmBlocked}
          onClick={() => void handleConfirm()}
        >
          {submitting ? (
            <>
              <LoaderIcon style={{ width: 24, height: 24, animation: 'spin 1s linear infinite' }} aria-hidden="true" />
              提交中…
            </>
          ) : printerLoading ? (
            '设备检测中…'
          ) : !printerReady ? (
            '打印机不可用'
          ) : (
            <>
              <PrinterIcon aria-hidden="true" />
              {isContractReport
                ? '按以上设置打印风险提示报告'
                : appendEligible
                  ? '打印合并版（简历+自我探索）'
                  : '按以上设置打印原文件'}
            </>
          )}
        </button>
      </KioskActionBar>
    </div>
    </PrintPageFrame>
  )
}
