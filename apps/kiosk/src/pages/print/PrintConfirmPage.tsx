import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeftIcon, LoaderIcon, PrinterIcon } from 'lucide-react'
import {
  hasParamsBeyondCapability,
  restrictToAllowedPrintParams,
  type MemberBenefitItem,
  type PrintJobParams,
} from '@ai-job-print/shared'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { loginPathForCurrentLocation } from '../../auth/returnPath'
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
import { materialRedactionBadge } from './piiRedaction'
import { subscribeTerminalSession, terminalSessionState, type TerminalSessionState } from '../../services/terminalAuth'
import { PrintConfirmView } from './components/PrintConfirmView'
import {
  COLOR_MODE_LABEL,
  DUPLEX_LABEL,
  ORIENTATION_LABEL,
  PILL,
  derivePrintConfirmScreen,
  type QuoteView,
} from './printConfirmModel'
import { usePrintConfirmQueryGuard } from './printConfirmQuery'
import './styles/print-confirm-qx.css'

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
  const { scan, queryInvalid, invalidReason } = usePrintConfirmQueryGuard()
  const invalidReasonRef = useRef(invalidReason)
  if (queryInvalid && invalidReason) invalidReasonRef.current = invalidReason
  const state = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])
  const file = state?.file ?? restoredSession?.file ?? { name: '未知文件', size: '-', pages: null }
  const incomingParams = state?.params ?? restoredSession?.printParams ?? DEFAULT_PARAMS
  const capability = usePrintParamCapability()
  const {
    printerReady,
    printerLabel,
    loading: printerLoading,
    kind: printerKind,
    printer,
  } = useTerminalDeviceStatus()
  const printerBlocked = printerLoading || !printerReady
  const printerBlockedReason = printerLoading
    ? '正在确认打印机状态，请稍候'
    : printer.errorCode === 'paperEmpty'
      ? '打印机缺纸，当前不能下单，不会扣费。请联系工作人员补纸后再试。'
      : printerKind === 'offline'
        ? `${printerLabel}。当前不能下单，不会扣费。请联系工作人员检查设备后再试。`
        : `${printerLabel}。当前不能下单，不会扣费。请联系工作人员。`
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
  const [submitting, setSubmitting] = useState(false)
  const [terminalSession, setTerminalSession] = useState<TerminalSessionState>(() => terminalSessionState())
  const [abandoning, setAbandoning] = useState(false)
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
  const [priceNotice, setPriceNotice] = useState<{ key: string; text: string } | null>(null)
  const activeNotice = priceNotice?.key === quoteKey ? priceNotice.text : null
  const inFlightRef = useRef(false)
  const hasFileContext = Boolean(state?.file ?? restoredSession?.file)
  const benefitCardEnabled = API_MODE === 'http' && hasFileContext && !queryInvalid && !paramsWereRestricted
  const [benefits, setBenefits] = useState<BenefitsView>({ status: 'loading' })
  const [priceCfg, setPriceCfg] = useState<PriceCfgView>({ status: 'loading' })

  useEffect(() => {
    if (API_MODE !== 'http') return
    if (paramsWereRestricted) {
      setQuoteState({ key: quoteKey, view: { status: 'unavailable', reason: '参数已按本机已验证能力收口' } })
      return
    }
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
        const reason =
          errorCodeOf(err) === 'PRINTER_UNAVAILABLE'
            ? userMessageOf(err, '本机打印机当前不可用，请联系现场工作人员')
            : '页数待服务端确认，以最终计费为准'
        setQuoteState({ key: quoteKey, view: { status: 'unavailable', reason } })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey 已编码最终文件与全部打印参数
  }, [quoteKey, paramsWereRestricted, quoteNonce])

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
  const summaryRows = [
    { label: '纸张规格', value: params.paperSize === 'A4' ? 'A4（210 × 297 mm）' : params.paperSize },
    { label: '页面方向', value: ORIENTATION_LABEL[params.orientation] ?? params.orientation },
    { label: '色彩模式', value: COLOR_MODE_LABEL[params.colorMode] ?? params.colorMode },
    { label: '单双面', value: DUPLEX_LABEL[params.duplex] ?? params.duplex },
    { label: '版式', value: `${params.pagesPerSheet} 版/页` },
    { label: '缩放方式', value: params.scale === 'fit' ? '适合页面' : '实际大小' },
    { label: '页面范围', value: !params.pageRange || params.pageRange === 'all' ? '全部页面' : params.pageRange },
    { label: '打印份数', value: `${params.copies} 份` },
    { label: '文件编号', value: file.fileId ?? '未登记' },
  ]

  const screen = derivePrintConfirmScreen({
    queryInvalid,
    requestedState: scan.requestedState,
    hasFile: hasFileContext && !queryInvalid,
    paramsWereRestricted,
    quote,
    benefitsError: benefits.status === 'error',
  })

  const confirmBlocked =
    submitting ||
    abandoning ||
    printerBlocked ||
    terminalSession !== 'ready' ||
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
        '终端安全校验失败，请联系现场工作人员',
      ))
      return
    }
    if (printerBlocked) {
      setSubmitError(printerBlockedReason)
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
              text: '已生成合并版（简历+自我探索），费用已按合并后的最终文件重新报价。本次还没有建单，请核对新金额后再点确认。',
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
          hasEndUser:  created.hasEndUser,
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
            text: current
              ? `价格已更新：你确认的是 ${formatCents(quote.amountCents)}，现在应付 ${formatCents(current.amountCents)}。本次没有建单，也没有扣款；请核对新金额后再点确认。`
              : '价格已更新，本次没有建单，也没有扣款。正在重新获取报价，请核对新金额后再确认。',
          })
        } else {
          setSubmitError(userMessageOf(err, '提交失败，请稍后重试或联系现场工作人员'))
        }
      } finally {
        if (!leaving) {
          inFlightRef.current = false
          setSubmitting(false)
        }
      }
      return
    }
    clearPrintMaterialSession()
    navigate('/print/progress', {
      state: { ...(isContractReport ? {} : location.state), file, params, source },
    })
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

  const redactionBadge = materialRedactionBadge(materialCheck?.redaction)
  const amountText = quote.status === 'ready' ? formatCents(quote.amountCents).replace(/^¥/, '') : ''
  const pill = PILL[screen]
  const status = printerLoading && (screen === 'quoted' || screen === 'zero-amount')
    ? { tone: 'unknown' as const, label: '状态未知' }
    : pill

  // 金额变了（服务端 409 或生成了合并版）：按钮写明新金额，用户再点的就是这一笔。
  const reconfirmLabel = activeNotice && quote.status === 'ready'
    ? `按新金额 ${formatCents(quote.amountCents)} 确认${appendEligible ? '（合并版）' : ''}`
    : null

  const primaryLabel = terminalSession === 'checking'
    ? '安全校验中…'
    : terminalSession === 'failed'
      ? '终端安全校验失败'
      : submitting
        ? '提交中…'
        : printerLoading
          ? '设备检测中…'
          : !printerReady
            ? '打印机不可用'
            : reconfirmLabel
              ? reconfirmLabel
              : isContractReport
              ? '按以上设置打印风险提示报告'
              : appendEligible
                ? '打印合并版（简历+自我探索）'
                : screen === 'zero-amount'
                  ? '确认并建单'
                  : '确认并去付款'

  const primaryAccessible = reconfirmLabel ?? (isContractReport
    ? '按以上设置打印风险提示报告'
    : appendEligible
      ? '打印合并版（简历+自我探索）'
      : '确认并去付款 · 按以上设置打印原文件')

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
      aria-label={primaryAccessible}
      onClick={() => void handleConfirm()}
    >
      {submitting ? <LoaderIcon size={24} aria-hidden="true" /> : <PrinterIcon size={24} aria-hidden="true" />}
      {label}
    </button>
  )
  const waitButton = (label: string) => (
    <button type="button" className="qx-btn" data-variant="primary" disabled aria-disabled="true">{label}</button>
  )
  const actions = screen === 'missing-context' ? (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/print-orders')}>我的打印订单</button>
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>重新选文件</button>
    </>
  ) : screen === 'invalid-context' ? (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print/desk')}>返回打印台</button>
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>重新选文件</button>
    </>
  ) : screen === 'capability-invalid-params' ? (
    <>{backButton('返回改参数')}{waitButton('参数回到黑白单面后可确认')}</>
  ) : screen === 'quoting' ? (
    <>{backButton()}{waitButton('获取报价后可继续')}</>
  ) : screen === 'quote-failed' ? (
    <>
      {backButton()}
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => setQuoteNonce((n) => n + 1)}>重新报价</button>
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
        <li>提交后请留在机器旁，任务确认后自动开始打印（免费任务直接进入打印队列，付费任务完成支付后开始）。</li>
        <li>打印完成请从出纸口取件；如有质量问题请联系现场工作人员。</li>
      </ol>
    </section>
  )

  return (
    <QxPageFrame
      back={{ label: '返回预览与参数', onBack: () => navigate('/print/preview') }}
      // 稿 14 没有独立页头：小青区就是页头。标题留给读屏，视觉上由小青区承担。
      title="报价确认"
      status={status}
      terminalLabel="就业服务大厅"
      navbar={
        <QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />
      }
    >
      <PrintConfirmView
        step={4}
        screen={screen}
        invalidReason={
          invalidReason
          || invalidReasonRef.current
          || '这一次没有真的核对失败：本屏是从地址栏直接指定的失败态。交接参数没通过登记核对。'
        }
        file={file}
        summaryRows={summaryRows}
        incomingParams={incomingParams}
        colorOff={!capabilityAllows.color && incomingParams.colorMode !== 'black_white'}
        duplexOff={!capabilityAllows.duplex && incomingParams.duplex !== 'simplex'}
        quote={quote}
        costCalcLabel={costCalcLabel}
        amountText={amountText}
        benefitView={benefitView}
        redactionText={redactionBadge?.text ?? null}
        materialDemo={materialCheck?.mode === 'demo'}
        printerBlocked={printerBlocked}
        printerBlockedReason={printerBlockedReason}
        terminalFailed={terminalSession === 'failed'}
        terminalFailedText={userMessageOf({ code: 'TERMINAL_SESSION_INVALID' }, '终端安全校验失败，请联系现场工作人员')}
        paramsWereRestricted={paramsWereRestricted}
        selfAssessment={selfAssessment}
        printNotes={printNotes}
        actions={actions}
        submitError={submitError ?? activeNotice}
        onLogin={() => navigate(loginPathForCurrentLocation())}
      />
    </QxPageFrame>
  )
}
