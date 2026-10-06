import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeftIcon, LoaderIcon, PrinterIcon } from 'lucide-react'
import { PRINT_MAX_SIDES_PER_ORDER, type MemberBenefitItem, type PrintJobParams } from '@ai-job-print/shared'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { loginPathForPrintStep } from '../../auth/returnPath'
import { API_MODE } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import { usePrintParamCapability } from '../../hooks/usePrintParamCapability'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import {
  fetchPrintBenefits,
  resolvePrintBenefitState,
} from '../../services/api/benefits'
import { fetchPrintPriceConfig, unitCentsFor } from '../../services/print/priceConfigApi'
import {
  createPrintJob,
  PrintPriceChangedError,
  quotePrintOrder,
  type PrintPriceChangedQuote,
} from '../../services/print/printJobsApi'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import { helpNeededLine, machineCannotPrintLine, machineUnusableLine, printProblemLine } from '../../copy/unattendedCopy'
import { appendSelfAssessmentToResume } from '../../services/api/selfAssessment'
import { abandonContractReviewReport } from '../../services/api/contractReview'
import { formatCents } from './cashierStatus'
import { countPagesInRange } from './pageRange'
import { clearPrintMaterialSession, printUploadPathForSource, type PrintFileState } from './printMaterialSession'
import { patchPrintHandoff } from './printHandoff'
import { usePrintConfirmHandoff } from './usePrintConfirmHandoff'
import { printPrivacyDecisionSummary } from './printDeskModel'
import { materialRedactionBadge } from './piiRedaction'
import { subscribeTerminalSession, terminalSessionState, type TerminalSessionState } from '../../services/terminalAuth'
import { PrintConfirmView } from './components/PrintConfirmView'
import {
  COLOR_MODE_LABEL,
  DUPLEX_LABEL,
  ORIENTATION_LABEL,
  PILL,
  confirmScreenAllowsOrder,
  derivePrintConfirmScreen,
  type QuoteView,
} from './printConfirmModel'
import { usePrintConfirmQueryGuard } from './printConfirmQuery'
import './styles/print-confirm-qx.css'

type PrintFile = PrintFileState

/** 跳转带来的临时状态：文件、参数一律不从这里读（只认交接上下文），只剩合同报告的放弃凭据。 */
interface LocationState {
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

type BenefitsView =
  | { status: 'loading' }
  | { status: 'ready'; items: MemberBenefitItem[]; loadedAt: number }
  | { status: 'error' }

type PriceCfgView =
  | { status: 'loading' }
  | { status: 'ready'; unitCents: number | null }
  | { status: 'error' }

/** 报价接口与 409 PRICE_CHANGED 带回的现价共用同一换算，两处展示口径一致。 */
function readyQuoteView(q: PrintPriceChangedQuote, copies: number): QuoteView {
  const line = q.priceLines[0]
  return {
    status: 'ready',
    amountCents: q.amountCents,
    billablePages: q.billablePages,
    unitCents: line?.unitCents ?? 0,
    quantity: line?.quantity ?? q.billablePages * copies,
  }
}

/** 报价键：最终出纸文件 + 全部打印参数。 */
function quoteKeyOf(fileUrl: string | null | undefined, params: PrintJobParams): string {
  return `${fileUrl ?? ''}|${JSON.stringify(params)}`
}

export function PrintConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken, isLoggedIn } = useAuth()
  const { scan, queryInvalid, invalidReason } = usePrintConfirmQueryGuard()
  const invalidReasonRef = useRef(invalidReason)
  if (queryInvalid && invalidReason) invalidReasonRef.current = invalidReason
  const state = location.state as LocationState | null
  const capability = usePrintParamCapability()
  const {
    handoff, problem, handoffInvalid, returnPath, ordered, params, adjustments, waitingCapability, paperNote,
  } = usePrintConfirmHandoff(capability)
  const file: PrintFile = handoff?.file ?? { name: '未知文件', size: '-', pages: null }
  const {
    printerReady,
    printerLabel,
    printerNotice,
    loading: printerLoading,
  } = useTerminalDeviceStatus()
  const printerBlocked = printerLoading || !printerReady
  const printerBlockedReason = printerLoading
    ? '正在确认打印机状态，请稍候'
    : printerNotice
      ? printerNotice
      : machineCannotPrintLine()
  const adjusted = adjustments.length > 0
  const materialCheck = handoff?.materialCheck
  const source = handoff?.source
  const uploadPath = printUploadPathForSource(source)
  const contractReport = state?.contractReport
  const isContractReport = Boolean(contractReport)
  const [submitting, setSubmitting] = useState(false)
  const [terminalSession, setTerminalSession] = useState<TerminalSessionState>(() => terminalSessionState())
  const [abandoning, setAbandoning] = useState(false)
  const [piiCheckRequired, setPiiCheckRequired] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [appendSelfAssessment, setAppendSelfAssessment] = useState(false)
  const [quoteNonce, setQuoteNonce] = useState(0)
  const selfAssessmentSnapshot = useMemo(() => readSelfAssessmentSnapshot(), [])
  const appendEligible =
    !isContractReport &&
    appendSelfAssessment &&
    Boolean(selfAssessmentSnapshot?.taskId) &&
    Boolean(file.fileId) &&
    (file.mimeType === undefined || file.mimeType === 'application/pdf')

  useEffect(() => subscribeTerminalSession(setTerminalSession), [])
  // 自我探索合并版只生成一次；二次确认复用同一份材料，不重复生成。
  const [mergedMaterial, setMergedMaterial] = useState<{ printFileUrl: string; name: string } | null>(null)
  const mergedFileUrl = appendEligible ? mergedMaterial?.printFileUrl ?? null : null
  // 报价只对「最终出纸文件 + 这组参数」有效：键一变，旧报价与迟到的响应都不算数。
  const quoteKey = quoteKeyOf(mergedFileUrl ?? file.fileUrl, params)
  const [quoteState, setQuoteState] = useState<{ key: string; view: QuoteView } | null>(null)
  const quote = useMemo<QuoteView>(
    () => (API_MODE !== 'http' ? { status: 'demo' } : quoteState?.key === quoteKey ? quoteState.view : { status: 'loading' }),
    [quoteState, quoteKey],
  )
  // 面数 = 计费页数 × 份数，双面不折算。页数还不知道时不在本机拦，等报价返回后再按错误码说明。
  const rangedPages = file.pages === null ? null : countPagesInRange(params.pageRange, file.pages)
  const printSides = rangedPages === null ? null : rangedPages * params.copies
  const sidesOverLimit = printSides !== null && printSides > PRINT_MAX_SIDES_PER_ORDER
  const sidesNotice = printSides === null
    ? null
    : `每单最多打印 ${PRINT_MAX_SIDES_PER_ORDER} 面（页数 × 份数），当前 ${printSides} 面`
  const [priceNotice, setPriceNotice] = useState<{ key: string; text: string } | null>(null)
  const activeNotice = priceNotice?.key === quoteKey ? priceNotice.text : null
  const inFlightRef = useRef(false)
  const hasFileContext = Boolean(handoff)
  // 权益卡只在「不在等能力」时出（以前是「参数没被收口」时才出，收口后连登录入口都没了）。
  const benefitCardEnabled = API_MODE === 'http' && hasFileContext && !queryInvalid && !waitingCapability && !ordered
  const [benefits, setBenefits] = useState<BenefitsView>({ status: 'loading' })
  const [priceCfg, setPriceCfg] = useState<PriceCfgView>({ status: 'loading' })
  const freePricing = quote.status === 'ready' ? quote.amountCents === 0 : priceCfg.status === 'ready' && priceCfg.unitCents === 0

  useEffect(() => {
    if (API_MODE !== 'http') return
    // 本机能力还在加载、参数里又有彩色或双面：先别报价（停在「正在计算本次费用」），也不闪拦截屏。
    // 建过单的只看状态，不再报价。
    if (waitingCapability || ordered || !hasFileContext) return
    if (sidesOverLimit) return
    if (!file.fileUrl) {
      setQuoteState({ key: quoteKey, view: { status: 'unavailable', reason: '打印文件尚未就绪，无法报价' } })
      return
    }
    let cancelled = false
    setQuoteState({ key: quoteKey, view: { status: 'loading' } })
    // 合并版才是最终出纸文件：已生成时报的是合并后那一份的价。
    const request = mergedFileUrl
      ? quotePrintOrder({ fileUrl: mergedFileUrl, params, terminalId: getTerminalId() || undefined })
      : quotePrintOrder({ fileUrl: file.fileUrl, params, terminalId: getTerminalId() || undefined })
    void request
      .then((q) => {
        if (!cancelled) setQuoteState({ key: quoteKey, view: readyQuoteView(q, params.copies) })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const code = errorCodeOf(err)
        const reason =
          code === 'PRINTER_UNAVAILABLE' || code === 'PRINT_JOB_TOO_LARGE' || code === 'PRINT_TERMINAL_QUEUE_HALTED'
            ? userMessageOf(err, `请稍后重试。${helpNeededLine()}。`)
            : '页数以实际结果为准，确认前不显示金额'
        setQuoteState({ key: quoteKey, view: { status: 'unavailable', reason, code } })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey 已编码最终文件与全部打印参数
  }, [quoteKey, waitingCapability, ordered, hasFileContext, quoteNonce, sidesOverLimit])

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
    // 价格变更提示一出现就重读公示价：否则权益卡拿开页时的旧价比新报价，会误报「本屏报价已不是现价」。
  }, [benefitCardEnabled, params.colorMode, priceNotice])

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

  // 稿 14 的 3×3 参数格。文件名、页数、大小在文件头里，不在格子里重复。
  // 本机暂未开通、已改过的项画灰并就地写「已按……报价」（稿 14，9/29 定稿）。
  const colorAdjusted = adjustments.some((item) => item.field === 'colorMode')
  const duplexAdjusted = adjustments.some((item) => item.field === 'duplex')
  const summaryRows = [
    { label: '纸张规格', value: params.paperSize === 'A4' ? 'A4（210 × 297 mm）' : params.paperSize },
    { label: '页面方向', value: ORIENTATION_LABEL[params.orientation] ?? params.orientation },
    {
      label: '色彩模式',
      value: colorAdjusted ? '彩色本机暂未开通，' : COLOR_MODE_LABEL[params.colorMode] ?? params.colorMode,
      off: colorAdjusted,
      note: colorAdjusted ? (freePricing ? '已改为黑白' : '已按黑白报价') : undefined,
    },
    {
      label: '单双面',
      value: duplexAdjusted ? '双面本机暂未开通，' : DUPLEX_LABEL[params.duplex] ?? params.duplex,
      off: duplexAdjusted,
      note: duplexAdjusted ? (freePricing ? '已改为单面' : '已按单面报价') : undefined,
    },
    { label: '版式', value: `${params.pagesPerSheet} 版/页` },
    { label: '缩放方式', value: params.scale === 'fit' ? '适合页面' : '实际大小' },
    { label: '页面范围', value: !params.pageRange || params.pageRange === 'all' ? '全部页面' : params.pageRange },
    { label: '打印份数', value: `${params.copies} 份` },
    { label: '本次产物', value: '打印件', fileId: file.fileId ?? '' },
  ]

  const screen = derivePrintConfirmScreen({
    queryInvalid,
    requestedState: scan.requestedState,
    hasFile: hasFileContext && !queryInvalid,
    handoffInvalid,
    ordered,
    waitingCapability,
    adjusted,
    quote,
    benefitsError: benefits.status === 'error',
  })

  const confirmBlocked =
    sidesOverLimit ||
    submitting ||
    abandoning ||
    printerBlocked ||
    terminalSession !== 'ready' ||
    !hasFileContext ||
    (API_MODE === 'http' && !confirmScreenAllowsOrder(screen)) ||
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
    if (terminalSession === 'checking') return
    if (terminalSession === 'failed') {
      setSubmitError(userMessageOf(
        { code: 'TERMINAL_SESSION_INVALID' },
        machineUnusableLine(),
      ))
      return
    }
    if (printerBlocked) {
      setSubmitError(printerBlockedReason)
      return
    }
    if (sidesOverLimit) {
      setSubmitError(sidesNotice)
      return
    }
    // 同一份交接只能建一单；交接失效时不猜是哪一份。
    if (!handoff || ordered) return
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
      // 同一帧里的连点在按钮变灰之前就会进来，只能靠同步 ref 挡住第二次建单。
      if (inFlightRef.current) return
      inFlightRef.current = true
      setSubmitting(true)
      setSubmitError(null)
      let leaving = false
      try {
        let printFileUrl = file.fileUrl
        let printFileName = file.name
        let printFileMd5: string | undefined = file.fileMd5
        if (appendEligible && selfAssessmentSnapshot?.taskId && file.fileId) {
          if (!mergedMaterial) {
            const merged = await appendSelfAssessmentToResume(
              selfAssessmentSnapshot.taskId,
              file.fileId,
              { token: getToken(), accessToken: selfAssessmentSnapshot.accessToken ?? null },
            )
            if (!merged.printFileUrl) {
              setSubmitError('合并版文件还没有就绪，本次没有建单。请稍后再试。')
              return
            }
            // 合并版页数与原文件不同：先按合并后的最终文件重新报价，停在这里等用户再确认一次。
            const next = { printFileUrl: merged.printFileUrl, name: merged.filename || `${file.name.replace(/\.pdf$/i, '')}-self-assessment.pdf` }
            setMergedMaterial(next)
            setPriceNotice({
              key: quoteKeyOf(next.printFileUrl, params),
              text: freePricing ? '已生成合并版（简历+自我探索），正在核定最终文件的页数。本次还没有建单，请核对页数后再点确认。' : '已生成合并版（简历+自我探索），费用已按合并后的最终文件重新报价。本次还没有建单，请核对新金额后再点确认。',
            })
            return
          }
          printFileUrl = mergedMaterial.printFileUrl
          printFileName = mergedMaterial.name
          printFileMd5 = undefined
        }
        const created = await createPrintJob({
          fileUrl:  printFileUrl,
          fileMd5:  printFileMd5,
          fileName: printFileName,
          params,
          quotedAmountCents: quote.amountCents,
          token:    getToken(),
        })
        leaving = true
        // 建单后只打标记、不清：收银页「返回确认页」只能看这一单，不能拿同一份再建第二单。完成页再清。
        const marked = patchPrintHandoff(handoff.contextId, {
          order: { orderId: created.orderId ?? null, taskId: created.taskId ?? null, orderedAt: new Date().toISOString() },
        })
        if (!marked) clearPrintMaterialSession()
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
          hasEndUser:  created.hasEndUser,
          idDocument:  handoff.idDocument === true,
        }
        if (created.amountCents > 0 && created.payStatus !== 'paid') {
          navigate('/print/cashier', { state: nextState })
        } else {
          navigate('/print/progress', { state: nextState })
        }
      } catch (err) {
        if (err instanceof PrintPriceChangedError) {
          // 不自动重试建单：把服务端按最终文件重算的现价换上屏，等用户再点一次确认。
          const current = err.currentQuote
          if (current) setQuoteState({ key: quoteKey, view: readyQuoteView(current, params.copies) })
          else setQuoteNonce((n) => n + 1)
          setPriceNotice({
            key: quoteKey,
            text: current?.amountCents === 0
              ? '页数与参数已更新，本次没有建单。请核对后再点确认打印。'
              : current
              ? `价格已更新：你确认的是 ${formatCents(quote.amountCents)}，现在应付 ${formatCents(current.amountCents)}。本次没有建单，也没有扣款；请核对新金额后再点确认。`
              : '价格已更新，本次没有建单，也没有扣款。正在重新获取报价，请核对新金额后再确认。',
          })
        } else if (errorCodeOf(err) === 'PRINT_PII_SCAN_REQUIRED') {
          setPiiCheckRequired(true)
          setSubmitError('这份文件的隐私检查还没有确认完，需要回到材料检查再确认一次。你的文件还在，不用重新上传。')
        } else {
          setSubmitError(userMessageOf(err, `提交失败，请稍后重试。${helpNeededLine()}。`))
        }
      } finally {
        if (!leaving) {
          inFlightRef.current = false
          setSubmitting(false)
        }
      }
      return
    }
    if (!patchPrintHandoff(handoff.contextId, { order: { orderId: null, taskId: null, orderedAt: new Date().toISOString() } })) {
      clearPrintMaterialSession()
    }
    navigate('/print/progress', {
      state: { ...(isContractReport ? {} : location.state), file, params, source, idDocument: handoff.idDocument === true },
    })
  }

  const costCalcLabel = sidesOverLimit && sidesNotice
    ? sidesNotice
    : quote.status === 'ready'
      ? `${formatCents(quote.unitCents)}/页 × ${quote.quantity} 页`
      : quote.status === 'loading'
        ? (sidesNotice ?? '正在核对页数与价目…')
        : quote.status === 'demo'
          ? (sidesNotice ?? '演示模式不显示金额')
          : quote.status === 'unavailable'
            ? quote.reason
            : '页数以实际结果为准，确认前不显示金额'

  const redactionBadge = materialRedactionBadge(materialCheck?.redaction)
  const decisionSummary = materialCheck ? printPrivacyDecisionSummary(materialCheck) : null
  // 裁决摘要修正“全保留”的说法；定位失败、复检残留等既有警告仍然保留。
  const privacySummary = materialCheck?.redaction?.claim === 'nothing_to_redact'
    ? decisionSummary
    : [decisionSummary, redactionBadge?.text].filter(Boolean).join(' ') || null
  const amountText = quote.status === 'ready' ? formatCents(quote.amountCents).replace(/^¥/, '') : ''
  const pill = PILL[screen]
  const pricingPill = freePricing && screen === 'quoting' ? { tone: 'unknown' as const, label: '正在核定页数' }
    : freePricing && screen === 'quote-failed' ? { tone: 'bad' as const, label: '页数核定未完成 · 未建单' } : pill
  const status = printerLoading && (screen === 'quoted' || screen === 'zero-amount')
    ? { tone: 'unknown' as const, label: '状态未知' }
    : pricingPill

  // 金额变了（服务端 409 或生成了合并版）：按钮写明新金额，用户再点的就是这一笔。
  const reconfirmLabel = activeNotice && quote.status === 'ready'
    ? quote.amountCents === 0 ? `核对后确认打印${appendEligible ? '（合并版）' : ''}` : `按新金额 ${formatCents(quote.amountCents)} 确认${appendEligible ? '（合并版）' : ''}`
    : null

  const primaryLabel = terminalSession === 'checking'
    ? '安全校验中…'
    : terminalSession === 'failed'
      ? '这台机器的安全校验没通过'
      : submitting
        ? '提交中…'
        : printerLoading
          ? '设备检测中…'
          : !printerReady
            ? (printerNotice ? printerLabel : '打印机不可用')
            : reconfirmLabel
              ? reconfirmLabel
              : isContractReport
              ? '按以上设置打印风险提示报告'
              : appendEligible
                ? '打印合并版（简历+自我探索）'
                : quote.status === 'ready' && quote.amountCents === 0
                  ? '确认并打印'
                  : '确认并去付款'

  // 稿 14 .cfm-act：动作收在 03 卡里（返回在左、主操作在右），不再挂在底部操作条上。
  const backLabel = isContractReport ? (abandoning ? '正在删除…' : '放弃打印') : '返回修改'
  const backButton = (label = backLabel) => (
    <button type="button" className="qx-btn" data-variant="ghost" disabled={submitting || abandoning} onClick={() => void handleBack()}>
      {abandoning ? <LoaderIcon size={22} aria-hidden="true" /> : <ArrowLeftIcon aria-hidden="true" />}
      {label}
    </button>
  )
  const confirmButton = (label: string) => (
    <button
      type="button"
      className="qx-btn"
      data-variant="primary"
      disabled={confirmBlocked}
      aria-label={label}
      onClick={() => void handleConfirm()}
    >
      {submitting ? <LoaderIcon size={24} aria-hidden="true" /> : <PrinterIcon size={24} aria-hidden="true" />}
      {label}
    </button>
  )
  const waitButton = (label: string) => (
    <button type="button" className="qx-btn" data-variant="primary" disabled aria-disabled="true">{label}</button>
  )
  const returnToMaterialCheck = () => {
    if (!handoff) return
    // 显式新一轮：保留当前文件、来源与参数，不再复用可能落后于服务端闸门的任务。
    const kept = patchPrintHandoff(handoff.contextId, {
      materialCheck: undefined, inspectionTask: undefined, normalizeTask: undefined,
      piiTask: undefined, piiRedactTask: undefined,
    })
    if (!kept) {
      setSubmitError('这份文件已失效，请重新选择文件。')
      return
    }
    navigate('/print/desk?step=check', { state: { printContextId: kept.contextId } })
  }
  const actions = piiCheckRequired ? (
    <button type="button" className="qx-btn" data-variant="primary" style={{ minHeight: 56 }} onClick={returnToMaterialCheck}>回到材料检查</button>
  ) : screen === 'missing-context' ? (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/print-orders')}>我的打印订单</button>
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>重新选文件</button>
    </>
  ) : screen === 'invalid-context' && handoffInvalid ? (
    // 交接失效（上一位的、过期、被替换）：只给「回到上一步」和「重新选文件」，不提供切到别的那一份。
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => (returnPath ? navigate(returnPath) : navigate(-1))}>回到上一步</button>
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>重新选文件</button>
    </>
  ) : screen === 'invalid-context' ? (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print/desk')}>返回打印台</button>
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>重新选文件</button>
    </>
  ) : screen === 'ordered' ? (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/print-orders')}>我的打印订单</button>
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(-1)}>回到这一单</button>
    </>
  ) : sidesOverLimit ? (
    <>{backButton()}{confirmButton('确认打印')}</>
  ) : screen === 'quoting' ? (
    <>{backButton()}{waitButton(freePricing ? '页数核定后可继续' : '获取报价后可继续')}</>
  ) : screen === 'quote-failed' ? (
    <>
      {backButton()}
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => setQuoteNonce((n) => n + 1)}>{freePricing ? '重新核定页数' : '重新报价'}</button>
    </>
  ) : screen === 'benefit-unverified' ? (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/benefits')}>去我的权益</button>
      {confirmButton(reconfirmLabel ?? '按实际原价继续')}
    </>
  ) : (
    <>{backButton()}{confirmButton(primaryLabel)}</>
  )

  const selfAssessment = !isContractReport && selfAssessmentSnapshot?.taskId ? (
    <div className="qx-card pcf-self">
      <label>
        <input
          type="checkbox"
          checked={appendSelfAssessment}
          onChange={(e) => setAppendSelfAssessment(e.target.checked)}
          disabled={submitting || !file.fileId || file.mimeType === 'image/jpeg' || file.mimeType === 'image/png'}
        />
        <span>附加自我探索 · 倾向参考摘要</span>
      </label>
      <p>
        仅在本人简历下方合并一份本人自助参考摘要；勾选后系统会即时生成仅供本人打印的合并 PDF，文件名追加 <code>-self-assessment</code>；合并结果不会进入任何企业、合作机构、Partner 或第三方可见的分享链路。
      </p>
      {appendSelfAssessment && !file.fileId ? (
        <p role="alert">当前文件不支持合并：请在简历页生成可合并的简历 PDF 后再勾选此项。</p>
      ) : null}
    </div>
  ) : null

  const printNotes = (
    <section className="qx-card pcf-notes" aria-label="打印须知">
      <h2 className="pcf-notes-t">打印须知</h2>
      <ol className="pcf-plan">
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
        <li>{freePricing ? '提交后请留在机器旁，任务确认后自动开始打印。' : '提交后请留在机器旁，任务确认后自动开始打印（免费任务直接进入打印队列，付费任务完成支付后开始）。'}</li>
        <li>打印完成请从出纸口取件。{printProblemLine()}。</li>
      </ol>
    </section>
  )

  return (
    <QxPageFrame
      // 直达打印台参数页（不经旧地址重定向）；是哪一份文件由交接上下文决定。
      back={{ label: '返回预览与参数', onBack: () => navigate('/print/desk?step=preview') }}
      // 稿 14 没有独立页头：小青区就是页头。标题留给读屏，视觉上由小青区承担。
      title={freePricing ? '确认打印' : '报价确认'}
      status={status}
      terminalLabel="就业服务大厅"
      navbar={
        <QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />
      }
    >
      <PrintConfirmView
        step={4}
        freePricing={freePricing}
        screen={screen}
        invalidReason={
          (handoffInvalid ? problem : null)
          || invalidReason
          || invalidReasonRef.current
          || '这一次没有真的核对失败：本屏是从地址栏直接指定的失败态。交接参数没通过登记核对。'
        }
        file={file}
        summaryRows={summaryRows}
        adjustments={adjustments}
        paperNote={paperNote}
        pricedParamsLabel={`${COLOR_MODE_LABEL[params.colorMode] ?? params.colorMode} · ${DUPLEX_LABEL[params.duplex] ?? params.duplex}`}
        quote={quote}
        costCalcLabel={costCalcLabel}
        amountText={amountText}
        benefitView={freePricing ? null : benefitView}
        redactionText={privacySummary}
        materialDemo={materialCheck?.mode === 'demo'}
        printerBlocked={printerBlocked}
        printerBlockedReason={freePricing ? printerBlockedReason.replace('不会扣费。', '') : printerBlockedReason}
        terminalFailed={terminalSession === 'failed'}
        terminalFailedText={userMessageOf({ code: 'TERMINAL_SESSION_INVALID' }, machineUnusableLine())}
        selfAssessment={selfAssessment}
        printNotes={printNotes}
        actions={actions}
        submitError={submitError ?? activeNotice ?? (sidesOverLimit ? sidesNotice : null)}
        // 回跳地址只放路由路径：不带文件编号、打印链接、交接编号，也不带当前查询串。
        onLogin={() => navigate(loginPathForPrintStep('confirm'))}
      />
    </QxPageFrame>
  )
}
