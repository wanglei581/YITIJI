import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeftIcon, HomeIcon, LoaderIcon, PrinterIcon, SparklesIcon, UserIcon } from 'lucide-react'
import {
  hasParamsBeyondCapability,
  restrictToAllowedPrintParams,
  type MemberBenefitItem,
  type PrintJobParams,
} from '@ai-job-print/shared'
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
import { createPrintJob, quotePrintOrder } from '../../services/print/printJobsApi'
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
  ASK,
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
  const [quote, setQuote] = useState<QuoteView>(
    API_MODE === 'http' ? { status: 'loading' } : { status: 'demo' },
  )
  const hasFileContext = Boolean(state?.file ?? restoredSession?.file)
  const benefitCardEnabled = API_MODE === 'http' && hasFileContext && !queryInvalid && !paramsWereRestricted
  const [benefits, setBenefits] = useState<BenefitsView>({ status: 'loading' })
  const [priceCfg, setPriceCfg] = useState<PriceCfgView>({ status: 'loading' })

  useEffect(() => {
    if (API_MODE !== 'http') {
      setQuote({ status: 'demo' })
      return
    }
    if (paramsWereRestricted) {
      setQuote({ status: 'unavailable', reason: '参数已按本机已验证能力收口' })
      return
    }
    if (!file.fileUrl) {
      setQuote({ status: 'unavailable', reason: '打印文件尚未就绪，无法报价' })
      return
    }
    let cancelled = false
    setQuote({ status: 'loading' })
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
          errorCodeOf(err) === 'PRINTER_UNAVAILABLE'
            ? userMessageOf(err, '本机打印机当前不可用，请联系现场工作人员')
            : '页数待服务端确认，以最终计费为准'
        setQuote({ status: 'unavailable', reason })
      })
    return () => {
      cancelled = true
    }
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
    paramsWereRestricted,
    quoteNonce,
  ])

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
        setSubmitError(userMessageOf(err, '提交失败，请稍后重试或联系现场工作人员'))
        setSubmitting(false)
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
  const ask = ASK[screen]
  const pill = PILL[screen]
  const status = printerLoading && (screen === 'quoted' || screen === 'zero-amount')
    ? { tone: 'unknown' as const, label: '状态未知' }
    : pill

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
            : isContractReport
              ? '按以上设置打印风险提示报告'
              : appendEligible
                ? '打印合并版（简历+自我探索）'
                : screen === 'zero-amount'
                  ? '确认并建单'
                  : '确认并去付款'

  const primaryAccessible = isContractReport
    ? '按以上设置打印风险提示报告'
    : appendEligible
      ? '打印合并版（简历+自我探索）'
      : '确认并去付款 · 按以上设置打印原文件'

  const ctabar = (() => {
    if (screen === 'missing-context') {
      return (
        <>
          <p className="why">先回上一步把文件和参数选好，回到这一页才会有正式报价。</p>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/print-orders')}>
            我的打印订单
          </button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>
            重新选文件
          </button>
        </>
      )
    }
    if (screen === 'invalid-context') {
      return (
        <>
          <p className="why">重新从有文件的那一步进来。这一趟没有创建订单，也没有扣款。</p>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print/desk')}>
            返回打印台
          </button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>
            重新选文件
          </button>
        </>
      )
    }
    if (screen === 'capability-invalid-params') {
      return (
        <>
          <p className="why">参数回到黑白单面再报价，才能确认这一单。</p>
          <button type="button" className="qx-btn" data-variant="ghost" disabled={abandoning} onClick={() => void handleBack()}>
            返回改参数
          </button>
          <button type="button" className="qx-btn" data-variant="primary" disabled aria-disabled="true">
            参数回到黑白单面后可确认
          </button>
        </>
      )
    }
    if (screen === 'quoting') {
      return (
        <>
          <p className="why">金额尚未确认 —— 报价回来之前不能建单。</p>
          <button type="button" className="qx-btn" data-variant="ghost" disabled={abandoning} onClick={() => void handleBack()}>
            {isContractReport ? (abandoning ? '正在删除…' : '放弃打印') : '返回修改'}
          </button>
          <button type="button" className="qx-btn" data-variant="primary" disabled aria-disabled="true">
            获取报价后可继续
          </button>
        </>
      )
    }
    if (screen === 'quote-failed') {
      return (
        <>
          <p className="why">重新报价不会重复建单，也不会重复扣款。价格暂不可用，以最终计费为准。</p>
          <button type="button" className="qx-btn" data-variant="ghost" disabled={abandoning} onClick={() => void handleBack()}>
            {isContractReport ? (abandoning ? '正在删除…' : '放弃打印') : '返回修改'}
          </button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => setQuoteNonce((n) => n + 1)}>
            重新报价
          </button>
        </>
      )
    }
    if (screen === 'benefit-unverified') {
      return (
        <>
          <p className="why">核销没通过就按原价走。本机不先按抵扣后的价格显示。</p>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/benefits')}>
            去我的权益
          </button>
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            disabled={confirmBlocked}
            aria-label={primaryAccessible}
            onClick={() => void handleConfirm()}
          >
            {submitting ? <LoaderIcon size={24} aria-hidden="true" /> : <PrinterIcon size={24} aria-hidden="true" />}
            按实际原价继续
          </button>
        </>
      )
    }
    return (
      <>
        <p className="why">
          {screen === 'zero-amount'
            ? '零元单确认后仍会先建单，再进入打印。不存在不建单直接出纸。'
            : '确认后创建订单并进入付款。金额以服务端返回为准。'}
        </p>
        <button type="button" className="qx-btn" data-variant="ghost" disabled={submitting || abandoning} onClick={() => void handleBack()}>
          {abandoning ? <LoaderIcon size={22} aria-hidden="true" /> : <ArrowLeftIcon aria-hidden="true" />}
          {isContractReport ? (abandoning ? '正在删除…' : '放弃打印') : '返回修改'}
        </button>
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          disabled={confirmBlocked}
          aria-label={primaryAccessible}
          onClick={() => void handleConfirm()}
        >
          {submitting ? <LoaderIcon size={24} aria-hidden="true" /> : <PrinterIcon size={24} aria-hidden="true" />}
          {primaryLabel}
        </button>
      </>
    )
  })()

  const navbar = (
    <>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/')} data-route="/">
        <HomeIcon size={32} aria-hidden="true" />首页
      </button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')} data-route="/assistant">
        <SparklesIcon size={32} aria-hidden="true" />AI 顾问
      </button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')} data-route="/profile">
        <UserIcon size={32} aria-hidden="true" />我的
      </button>
    </>
  )

  const selfAssessment = (
    <>
      {!isContractReport && selfAssessmentSnapshot?.taskId ? (
        <div className="qx-card pcf-self">
          <label>
            <input
              type="checkbox"
              checked={appendSelfAssessment}
              onChange={(e) => setAppendSelfAssessment(e.target.checked)}
              disabled={!file.fileId || file.mimeType === 'image/jpeg' || file.mimeType === 'image/png'}
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
      ) : null}
      <div className="qx-card" style={{ marginTop: 14 }}>
        <h4 className="pcf-benefit-title" style={{ marginTop: 0 }}>打印须知</h4>
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
      </div>
    </>
  )

  return (
    <QxPageFrame
      title="报价确认"
      subtitle={ask.doing}
      status={status}
      terminalLabel="就业服务大厅"
      ctabar={ctabar}
      navbar={navbar}
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
        submitError={submitError}
        onLogin={() => navigate(loginPathForCurrentLocation())}
      />
    </QxPageFrame>
  )
}
