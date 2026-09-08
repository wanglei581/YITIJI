import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  FileTextIcon,
  PrinterIcon,
  ShieldIcon,
} from 'lucide-react'
import type { PrintJobParams, PrintJobTakeawayUrl } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { useAuth } from '../../auth/useAuth'
import { formatRemainingSeconds, useRemainingSeconds } from '../../hooks/useCountdown'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { getPayStatus } from '../../services/print/paymentApi'
import {
  getPrintJobStatus,
  issuePrintJobTakeawayUrl,
  retryPrintJob,
  type PrintJobStatusResult,
} from '../../services/print/printJobsApi'
import { KioskFeedbackDialog } from '../../components/KioskFeedbackDialog'
import { PRINT_DONE_ISSUE_OPTIONS } from '../../services/api/kioskFeedback'
import { printUploadPathForSource, clearPrintMaterialSession, type PrintMaterialSource } from './printMaterialSession'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { PrintFileDeletionRecords } from './components/PrintFileDeletionRecords'
import { PrintFileRetentionNotice } from './components/PrintFileRetentionNotice'
import { formatCents } from './cashierStatus'
import './styles/print-fulfill-qx.css'

interface PrintFile {
  name:     string
  size:     string
  pages:    number
  fileUrl?: string
}

interface PrintJobState {
  file?:                PrintFile
  params?:              PrintJobParams
  returnUrl?:           string
  returnLabel?:         string
  taskId?:              string
  orderId?:             string
  orderNo?:             string
  amountCents?:         number
  paymentSessionToken?: string
  source?:              PrintMaterialSource
}

type PrintResultState = 'loading' | 'completed' | 'failed' | 'unknown'

interface PrintVerification {
  taskId: string
  result: Exclude<PrintResultState, 'loading'>
  failureReason?: string
  errorCode?: string
  fileRetentionAvailable?: boolean
  fileExpiresAt?: string | null
  fileRetentionPolicy?: string | null
  fileDeletedAt?: string | null
  fileDeleteReason?: string | null
  fileStorageDeletedAt?: string | null
}

function fileRetentionFromStatus(result: PrintJobStatusResult) {
  return {
    fileRetentionAvailable: result.fileRetentionAvailable,
    fileExpiresAt: result.fileExpiresAt,
    fileRetentionPolicy: result.fileRetentionPolicy,
    fileDeletedAt: result.fileDeletedAt,
    fileDeleteReason: result.fileDeleteReason,
    fileStorageDeletedAt: result.fileStorageDeletedAt,
  }
}

/**
 * Agent 在派发已开始、但重启后无法确认纸到底出没出时上报的码
 * （`terminal-agent/src/agent/task-runner.ts`）。整条链路对它的口径都是「**无法确认**」：
 * 服务端在任何写入之前拒绝重排以防重复出纸（`PRINT_SCAN_RETRY_UNCONFIRMED_FORBIDDEN`），
 * Admin 也只引导人工核查后决定处理费用。
 *
 * 唯独本页此前把它和普通失败混在一起，标题写「打印失败」、副标题写
 * 「打印任务已由服务端确认失败」—— 服务端恰恰没有确认任何事。这句话两个方向都会害人：
 * 纸真出来了，用户以为失败去要钱；纸没出来，他也拿不到「系统承认不确定、请找人核查」
 * 这个说法。属 CLAUDE.md §9「不得展示未经证实的结论」。
 */
const PRINT_JOB_UNCONFIRMED = 'PRINT_JOB_UNCONFIRMED'

function toPublicQrUrl(signedUrl: string): string {
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl
  return `${window.location.origin}${signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`}`
}

interface PickupLookup {
  orderId: string
  code: string | null
  error: string | null
}

const ACTIVE_PRINT_STATUSES = ['pending', 'claimed', 'printing'] as const

const DUPLEX_LABEL: Record<string, string> = {
  simplex:           '单面',
  duplex_long_edge:  '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

function failVisual(errorCode?: string): 'paper-jam' | 'out-of-paper' | 'result-unconfirmed' | 'failed' {
  if (errorCode === PRINT_JOB_UNCONFIRMED) return 'result-unconfirmed'
  if (errorCode === 'PAPER_EMPTY') return 'out-of-paper'
  if (errorCode === 'PRINTER_ERROR') return 'paper-jam'
  return 'failed'
}

export function PrintDonePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PrintJobState

  const { file, params } = state
  const taskId = typeof state.taskId === 'string' && state.taskId.trim() ? state.taskId.trim() : null
  const uploadPath = printUploadPathForSource(state.source)
  const amountCents = typeof state.amountCents === 'number' ? state.amountCents : null
  const orderNo = typeof state.orderNo === 'string' ? state.orderNo : state.orderId ?? null

  const canReportIssue = taskId !== null
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feeInfoOpen, setFeeInfoOpen] = useState(false)
  const [wiped, setWiped] = useState(false)
  const [wipeArmed, setWipeArmed] = useState(false)
  const [idleLeft, setIdleLeft] = useState(60)

  const [verification, setVerification] = useState<PrintVerification | null>(null)
  const resultState: PrintResultState = !taskId
    ? 'unknown'
    : verification?.taskId === taskId
      ? verification.result
      : 'loading'
  const failureReason = verification?.taskId === taskId
    ? verification.failureReason ?? '打印任务未能完成，请联系现场工作人员'
    : '打印任务未能完成，请联系现场工作人员'
  const isUnconfirmed =
    verification?.taskId === taskId && verification.errorCode === PRINT_JOB_UNCONFIRMED
  const visual = resultState === 'failed' ? failVisual(verification?.errorCode) : resultState

  const [pickupLookup, setPickupLookup] = useState<PickupLookup | null>(null)
  const pickupCode = state.orderId && pickupLookup?.orderId === state.orderId ? pickupLookup.code : null
  const pickupCodeError = state.orderId && pickupLookup?.orderId === state.orderId ? pickupLookup.error : null
  const [takeaway, setTakeaway] = useState<PrintJobTakeawayUrl | null>(null)
  const [takeawayError, setTakeawayError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const takeawayRemaining = useRemainingSeconds(takeaway?.expiresAt)
  const takeawayExpired = takeawayRemaining === 0
  const takeawayQrUrl = takeaway && !takeawayExpired ? toPublicQrUrl(takeaway.signedUrl) : null

  const doWipe = useCallback(() => {
    clearPrintMaterialSession()
    setWiped(true)
  }, [])

  useEffect(() => {
    if (resultState !== 'completed' || wiped) return
    let n = 60
    setIdleLeft(60)
    const reset = () => {
      n = 60
      setIdleLeft(60)
    }
    const onReset = () => reset()
    window.addEventListener('pointerdown', onReset)
    window.addEventListener('keydown', onReset)
    const timer = window.setInterval(() => {
      n = Math.max(0, n - 1)
      setIdleLeft(n)
      if (n <= 0) {
        window.clearInterval(timer)
        doWipe()
      }
    }, 1000)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', onReset)
      window.removeEventListener('keydown', onReset)
    }
  }, [doWipe, resultState, wiped])

  useEffect(() => {
    if (!taskId) {
      setVerification(null)
      return
    }

    let cancelled = false
    setVerification(null)
    void getPrintJobStatus(taskId)
      .then((result) => {
        if (cancelled) return
        if (result.taskId !== taskId) {
          setVerification({ taskId, result: 'unknown' })
          return
        }
        if (result.status === 'completed') {
          setVerification({ taskId, result: 'completed', ...fileRetentionFromStatus(result) })
          return
        }
        if (result.status === 'failed') {
          setVerification({
            taskId,
            result: 'failed',
            failureReason: result.failureReasonForUser ?? '打印任务未能完成，请联系现场工作人员',
            errorCode: result.errorCode,
            ...fileRetentionFromStatus(result),
          })
          return
        }
        if (ACTIVE_PRINT_STATUSES.some((status) => status === result.status)) {
          navigate('/print/progress', {
            replace: true,
            state: { ...((location.state ?? {}) as object), taskId },
          })
          return
        }
        setVerification({ taskId, result: 'unknown' })
      })
      .catch(() => {
        if (!cancelled) setVerification({ taskId, result: 'unknown' })
      })

    return () => { cancelled = true }
  }, [location.state, navigate, taskId])

  useEffect(() => {
    if (resultState !== 'failed' || API_MODE !== 'http' || !taskId) {
      setTakeaway(null)
      setTakeawayError(null)
      return
    }
    let cancelled = false
    setTakeaway(null)
    setTakeawayError(null)
    void issuePrintJobTakeawayUrl({
      taskId,
      paymentSessionToken: state.paymentSessionToken,
      token: getToken(),
    })
      .then((result) => {
        if (!cancelled) setTakeaway(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTakeawayError(userMessageOf(err, '暂时无法签发带走链接，请联系工作人员'))
        }
      })
    return () => { cancelled = true }
  }, [getToken, resultState, state.paymentSessionToken, taskId])

  useEffect(() => {
    if (resultState !== 'completed' || API_MODE !== 'http' || !state.orderId || !state.paymentSessionToken) {
      setPickupLookup(null)
      return
    }
    const orderId = state.orderId
    const paymentSessionToken = state.paymentSessionToken
    let cancelled = false
    setPickupLookup(null)
    void (async () => {
      try {
        const s = await getPayStatus({ orderId, paymentSessionToken })
        if (!cancelled) {
          setPickupLookup({ orderId, code: s.pickupCode, error: null })
        }
      } catch {
        if (!cancelled) {
          setPickupLookup({ orderId, code: null, error: '取件凭证暂时无法读取，请联系工作人员核验订单' })
        }
      }
    })()
    return () => { cancelled = true }
  }, [resultState, state.orderId, state.paymentSessionToken])

  const totalFaces = file && params
    ? file.pages * params.copies * (params.duplex === 'simplex' ? 1 : 2)
    : null
  const pageCount = file?.pages ?? null

  const navbar = (
    <QxAppNavbar
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )

  const feedbackDialog = canReportIssue ? (
    <KioskFeedbackDialog
      open={feedbackOpen}
      onClose={() => setFeedbackOpen(false)}
      issueOptions={PRINT_DONE_ISSUE_OPTIONS}
      relatedPrintTaskId={taskId}
      showSatisfaction={resultState === 'completed'}
    />
  ) : null

  const handleResubmitPrint = async () => {
    if (!taskId || retrying || isUnconfirmed) return
    setRetrying(true)
    setRetryError(null)
    try {
      await retryPrintJob({
        taskId,
        paymentSessionToken: state.paymentSessionToken,
        token: getToken(),
      })
      navigate('/print/progress', {
        replace: true,
        state: { ...((location.state ?? {}) as object), taskId },
      })
    } catch (err: unknown) {
      setRetryError(userMessageOf(err, '重新提交失败，请联系工作人员补打'))
      setRetrying(false)
    }
  }

  const paidLabel = amountCents != null ? `已付 ${formatCents(amountCents)}` : '订单保留'

  if (wiped) {
    return (
      <QxPageFrame
        title="这趟办完了"
        subtitle="本机上的本次打印文件预览和记录已清除"
        status={{ tone: 'ok', label: '会话已清空' }}
        terminalLabel="就业服务大厅"
        ctabar={
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/')}>
            回首页
          </button>
        }
        navbar={navbar}
      >
        <div data-w2-page="print-done" data-print-flow-step={6} className="qx-scroll pff-page">
          <section className="pff-xq">
            <div className="pff-xq-row">
              <div className="pff-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
                <p className="pff-xq-ask">这趟办完了。</p>
                <p className="pff-xq-doing">本机上的本次打印文件预览和记录<b>已清除</b>。愿你求职顺利，下次再见。</p>
              </div>
            </div>
          </section>
        </div>
      </QxPageFrame>
    )
  }

  if (feeInfoOpen) {
    return (
      <QxPageFrame
        title="费用与订单边界"
        subtitle="本页只展示订单的真实状态，不替你承诺结果"
        status={{ tone: 'warn', label: orderNo ? `订单 ${orderNo}` : '状态未知' }}
        terminalLabel="就业服务大厅"
        ctabar={
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeeInfoOpen(false)}>
              返回上一页
            </button>
            <button type="button" className="qx-btn" data-variant="primary" data-testid="print-fulfill-primary" onClick={() => navigate('/help')}>
              找工作人员登记
            </button>
          </>
        }
        navbar={navbar}
      >
        <div data-w2-page="print-done" data-print-flow-step={6} data-testid="print-fulfill-state-fee-info" className="qx-scroll pff-page">
          <section className="pff-xq">
            <div className="pff-xq-row">
              <div className="pff-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
                <p className="pff-xq-ask">钱的事，<em>一笔一笔说清楚</em>。</p>
                <p className="pff-xq-doing">本页只展示订单的真实状态，不替你承诺结果。</p>
              </div>
            </div>
          </section>
          <div className="pff-inbar">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><CreditGlyph /></span>
              <span>费用与订单边界<small>订单和支付记录都在，不会因为这次异常消失</small></span>
            </div>
            <p className="pff-inbar-b">
              是否处理费用、处理多少、多久到账，<b>以工作人员核查结果为准</b>，本机不承诺自动处理，也不会替你把费用改成别的数。
            </p>
            <div className="pff-inbar-kv">
              {orderNo ? <span>订单 <b>{orderNo}</b></span> : null}
              {amountCents != null ? <span>支付状态 <b>{paidLabel}</b></span> : <span>支付状态 <b>以订单为准</b></span>}
            </div>
          </div>
          <div className="qx-card">
            <div className="pff-step"><span className="pff-step-no">1</span><span className="pff-step-txt">把<b>订单号 {orderNo ?? '（未读取到）'}</b> 和这台机器的位置告诉现场工作人员。</span></div>
            <div className="pff-step"><span className="pff-step-no">2</span><span className="pff-step-txt">说明实际拿到了几页、哪几页没出，<b>已出的纸请一并带上</b>。</span></div>
            <div className="pff-step"><span className="pff-step-no">3</span><span className="pff-step-txt">由工作人员现场登记；<b>是否处理、处理多少，以核查结果为准</b>。</span></div>
          </div>
          <div className="pff-help" data-testid="print-fulfill-fallback">
            <span className="txt">本机<b>不会自动处理费用</b>，也不会把支付异常写成打印状态。</span>
            <button type="button" className="pff-help-btn" onClick={() => navigate('/help')}>联系工作人员</button>
          </div>
        </div>
        {feedbackDialog}
      </QxPageFrame>
    )
  }

  if (resultState === 'loading' || resultState === 'unknown') {
    const isLoading = resultState === 'loading'
    return (
      <QxPageFrame
        title={isLoading ? '正在核验打印结果' : '无法确认打印结果'}
        subtitle={isLoading ? '正在读取真实打印任务状态，请稍候' : '当前未取得可信的任务终态，请勿据此判断已经出纸'}
        status={{ tone: 'unknown', label: '状态未知' }}
        terminalLabel="就业服务大厅"
        ctabar={
          isLoading ? (
            <span className="why">核验完成后将显示真实结果或返回任务进度页</span>
          ) : (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')}>返回首页</button>
              {taskId ? (
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/print-orders')}>查看打印订单</button>
              ) : null}
              {canReportIssue ? (
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeedbackOpen(true)}>反馈问题</button>
              ) : null}
              <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/help')}>使用帮助</button>
            </>
          )
        }
        navbar={navbar}
      >
        <div data-w2-page="print-done" data-print-flow-step={6} data-testid={isLoading ? 'print-fulfill-state-loading' : 'print-fulfill-state-unknown'} className="qx-scroll pff-page">
          <div className="qx-state" data-tone={isLoading ? 'info' : 'error'}>
            <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
            <div>
              <div className="qx-state-t">{isLoading ? '正在向打印服务核验' : '暂未取得可信状态'}</div>
              <div className="qx-state-d">
                {isLoading
                  ? '核验完成后将显示真实结果或返回任务进度页'
                  : taskId
                    ? `任务号 ${taskId} 暂时无法核验，请在打印订单中查看或联系工作人员`
                    : '未找到打印任务上下文，请从打印入口重新开始'}
              </div>
            </div>
          </div>
        </div>
        {feedbackDialog}
      </QxPageFrame>
    )
  }

  if (resultState === 'failed') {
    const jam = visual === 'paper-jam'
    const empty = visual === 'out-of-paper'
    const issueTitle = isUnconfirmed
      ? '打印结果未确认'
      : jam
        ? '打印机卡纸'
        : empty
          ? '打印机缺纸'
          : '打印失败'
    const ask = isUnconfirmed
      ? <>这次打印<em>结果未确认</em>。</>
      : jam
        ? <>纸<em>卡住了</em>，别硬拉。</>
        : empty
          ? <>机器里<em>没纸了</em>。</>
          : <>打印失败，<em>请联系工作人员</em>。</>
    const doing = isUnconfirmed
      ? '系统已经正式登记，工作人员核查后给出结论，不会让你自认倒霉。'
      : jam
        ? '硬拉可能撕坏纸、伤到机器，交给我们来处理。'
        : empty
          ? '不是你操作的问题，纸匣空了，加纸后可以继续。'
          : '订单和支付记录都在，请凭订单找现场工作人员处理。'
    const issueSub = isUnconfirmed
      ? '服务端已明确登记，等待人工核查'
      : jam
        ? '你的订单和已付金额都保留着'
        : empty
          ? '订单保留，加纸后可继续打印'
          : '打印任务已由服务端确认失败'
    return (
      <QxPageFrame
        title={isUnconfirmed ? '打印结果未确认' : jam ? '打印机卡纸' : empty ? '打印机缺纸' : '打印失败'}
        subtitle={isUnconfirmed ? '服务端无法确认本次是否已出纸' : '打印任务已由服务端确认失败'}
        status={{ tone: isUnconfirmed ? 'bad' : 'bad', label: `${paidLabel} · ${issueTitle}` }}
        terminalLabel="就业服务大厅"
        ctabar={
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')}>返回首页</button>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeeInfoOpen(true)}>查看费用说明</button>
            {canReportIssue ? (
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeedbackOpen(true)}>反馈问题</button>
            ) : null}
            {takeaway?.canRetry && !isUnconfirmed ? (
              <button
                type="button"
                className="qx-btn"
                data-variant="teal"
                disabled={retrying}
                onClick={() => { void handleResubmitPrint() }}
              >
                {retrying ? '正在重新提交…' : '重新提交打印'}
              </button>
            ) : null}
            <button type="button" className="qx-btn" data-variant="primary" data-testid="print-fulfill-primary" onClick={() => navigate('/help')}>
              {isUnconfirmed ? '联系工作人员核查' : '使用帮助'}
            </button>
          </>
        }
        navbar={navbar}
      >
        <div
          data-w2-page="print-done" data-print-flow-step={6}
          data-testid={
            isUnconfirmed
              ? 'print-fulfill-state-result-unconfirmed'
              : jam
                ? 'print-fulfill-state-paper-jam'
                : empty
                  ? 'print-fulfill-state-out-of-paper'
                  : 'print-fulfill-state-failed'
          }
          className="qx-scroll pff-page"
        >
          <section className="pff-xq">
            <div className="pff-xq-row">
              <div className="pff-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
                <p className="pff-xq-ask">{ask}</p>
                <p className="pff-xq-doing">{doing}</p>
              </div>
            </div>
          </section>

          <div
            className="pff-issue"
            data-tone={isUnconfirmed ? 'deep' : 'bad'}
            data-testid="print-fulfill-fallback"
          >
            <div className="pff-issue-head">
              <span className="pff-issue-ic">{isUnconfirmed ? <PrinterIcon aria-hidden="true" /> : <AlertTriangleIcon aria-hidden="true" />}</span>
              <div>
                <div className="pff-issue-t">{issueTitle}</div>
                <small>{issueSub}</small>
              </div>
            </div>
            <p className="pff-issue-body">
              {isUnconfirmed
                ? <>设备在断电、失联或硬件异常后，<b>无法确认这次打印的实际结果</b>。系统不猜成功也不猜失败，已登记等待人工核查。请先查看出纸口是否已有纸张。无论有没有，这笔订单都已保留，请凭订单号联系现场工作人员核查处理。{taskId ? `（任务号 ${taskId}）` : null}</>
                : jam
                  ? <>请<b>不要自己打开机器或拽纸</b>。工作人员会取出卡纸并补打受影响的部分，已出的纸你先收好。</>
                  : empty
                    ? <>纸匣已空，<b>剩下没打的部分会在加纸后继续</b>。已出的纸你可以先拿走。加纸后继续打印不需要重新下单。</>
                    : failureReason}
            </p>
            {(jam || empty) && failureReason ? <p className="pff-issue-body">{failureReason}</p> : null}
            {isUnconfirmed ? <span className="pff-inbar-code">errorCode = PRINT_JOB_UNCONFIRMED</span> : null}
          </div>

          {(state.orderId || takeaway?.orderNo) && (
            <p className="pff-out-sub">订单号 {takeaway?.orderNo ?? state.orderId}</p>
          )}
          <p className="pff-out-sub">联系工作人员补打</p>
          {takeawayQrUrl && (
            <div className="print-done-takeaway" role="region" aria-label="文件带走">
              <p className="print-done-takeaway-title">文件带走</p>
              <div className="print-done-takeaway-qr">
                <QRCodeSVG value={takeawayQrUrl} size={168} level="M" marginSize={0} />
              </div>
              {takeawayRemaining >= 0 && (
                <p className="print-done-takeaway-note">
                  剩余 {formatRemainingSeconds(takeawayRemaining)}，请用本人手机扫码保存
                </p>
              )}
            </div>
          )}
          {takeaway && takeawayExpired && (
            <p role="status">带走链接已过期，请联系工作人员补打</p>
          )}
          {takeawayError && <p role="status">{takeawayError}</p>}
          {retryError && <p role="status">{retryError}</p>}
        </div>
        {feedbackDialog}
      </QxPageFrame>
    )
  }

  return (
    <QxPageFrame
      title="打印完成"
      subtitle="文件已从出纸口送出，请核对页数后取走"
      status={{ tone: 'ok', label: amountCents != null ? `${paidLabel} · 打印完成` : '打印完成' }}
      terminalLabel="就业服务大厅"
      ctabar={
        <>
          <button
            type="button"
            className="qx-btn pff-again"
            data-variant="ghost"
            data-testid="print-fulfill-reprint"
            onClick={() => navigate(uploadPath)}
          >
            再印一份
            <small>重新选文件、核价并支付</small>
          </button>
          <button
            type="button"
            className="qx-btn"
            data-variant="danger"
            data-testid="print-fulfill-primary"
            onClick={() => {
              if (wipeArmed) {
                doWipe()
                return
              }
              setWipeArmed(true)
            }}
          >
            {wipeArmed ? '再按一次，确认清空这台机器上的数据' : '我拿走了，结束并清空'}
          </button>
        </>
      }
      navbar={navbar}
    >
      <div data-w2-page="print-done" data-print-flow-step={6} data-testid="print-fulfill-state-completed" className="qx-scroll pff-page">
        <section className="pff-xq">
          <div className="pff-xq-row">
            <div className="pff-xq-face" aria-hidden="true">青</div>
            <div>
              <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
              <p className="pff-xq-ask">都打好了，<em>从出纸口拿走</em>。</p>
              <p className="pff-xq-doing">拿走前记得核一下页数和水印，少页当场能处理。</p>
            </div>
          </div>
        </section>

        <div className="qx-card">
          <div className="pff-done-title">
            <span className="pff-ok"><CheckIcon aria-hidden="true" /></span>
            请取走文件
          </div>
          <div className="pff-paper" role="status">请取走纸张</div>
          <p className="pff-out-sub">
            {totalFaces != null
              ? `共 ${totalFaces} 面已全部打印，请在出纸口取走并核对页数`
              : '文件已全部打印，请在出纸口取走'}
          </p>
          <div className="pff-step">
            <span className="pff-step-no">1</span>
            <span className="pff-step-txt">
              从出纸口取走{pageCount != null ? <> <b>全部 {pageCount} 页</b></> : '全部纸张'}。
            </span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">2</span>
            <span className="pff-step-txt">当场核对<b>页数和清晰度</b>，少页、卡纸、印花了都能当场处理。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">3</span>
            <span className="pff-step-txt">证件页确认带 <b>「仅供求职使用」水印</b>，再离开。</span>
          </div>
          {pickupCode && (
            <div className="pff-pickup">
              <div>
                <div className="pff-pickup-t">取件码（仅接口返回时展示）</div>
                <div className="pff-pickup-s">离开后再来取，或请工作人员凭码取。请勿拍照外传。</div>
              </div>
              <div className="pff-pickup-code">{pickupCode}</div>
            </div>
          )}
          {pickupCodeError && (
            <div className="print-pickup">
              <div className="print-pickup-error">
                <AlertCircleIcon style={{ display: 'inline', width: 16, height: 16, marginRight: 6, verticalAlign: 'middle' }} aria-hidden="true" />
                {pickupCodeError}
              </div>
            </div>
          )}
        </div>

        {(state.taskId || state.orderId) && (
          <div className="pff-meta">
            {state.taskId  && <span className="pff-chip"><b>任务号</b> {state.taskId}</span>}
            {state.orderId && <span className="pff-chip"><b>订单号</b> {state.orderId}</span>}
            <span className="pff-chip"><b>完成</b></span>
          </div>
        )}

        <div className="pff-wipe" data-live="true">
          <div>
            <div className="pff-wipe-t"><ShieldIcon aria-hidden="true" />空闲超时自动清空</div>
            <p className="pff-wipe-s">你不再操作这台机器后，本机上的文件预览和记录会被清除，下一个人看不到。也可以现在手动清。</p>
          </div>
          <div className="pff-wipe-n">
            <div className="n">{idleLeft}</div>
            <div className="u">秒空闲后自动清空</div>
          </div>
        </div>

        <PrintFileRetentionNotice
          retention={{
            fileRetentionAvailable: verification?.fileRetentionAvailable,
            fileExpiresAt: verification?.fileExpiresAt,
            fileRetentionPolicy: verification?.fileRetentionPolicy,
            fileDeletedAt: verification?.fileDeletedAt,
            fileDeleteReason: verification?.fileDeleteReason,
            fileStorageDeletedAt: verification?.fileStorageDeletedAt,
          }}
        />

        <PrintFileDeletionRecords />

        {file && params && (
          <div className="qx-card">
            <b className="pff-info-hd">本次任务摘要</b>
            <div className="pff-i-row"><span className="pff-i-k">文件名</span><span className="pff-i-v">{file.name}</span></div>
            <div className="pff-i-row"><span className="pff-i-k">页数 / 份数</span><span className="pff-i-v">{file.pages} 页 × {params.copies} 份</span></div>
            <div className="pff-i-row"><span className="pff-i-k">打印面</span><span className="pff-i-v">{DUPLEX_LABEL[params.duplex] ?? params.duplex}</span></div>
            <div className="pff-i-row">
              <span className="pff-i-k">色彩 / 质量</span>
              <span className="pff-i-v">
                {params.colorMode === 'color' ? '彩色' : '黑白'} · {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
              </span>
            </div>
          </div>
        )}

        <div className="qx-card">
          <b className="pff-info-hd">打印遇到问题？</b>
          <span className="print-done-card-sub">缺页、卡纸、质量不佳等问题可在此反馈</span>
          <div className="print-done-fb-group">
            {canReportIssue && (
              <button type="button" className="print-done-fb-btn" aria-label="反馈问题" onClick={() => setFeedbackOpen(true)}>
                反馈问题
              </button>
            )}
            <button type="button" className="print-done-fb-btn" aria-label="使用帮助" onClick={() => navigate('/help')}>
              使用帮助
            </button>
            <button type="button" className="print-done-fb-btn" onClick={() => navigate('/me/print-orders')}>
              查看打印订单
            </button>
          </div>
        </div>

        <div className="pff-help" data-testid="print-fulfill-fallback">
          <span className="txt">少了页、印花了、对内容有疑问？<b>现在处理最方便</b>。</span>
          <button type="button" className="pff-help-btn" onClick={() => navigate('/help')}>联系工作人员</button>
        </div>
      </div>
      {feedbackDialog}
    </QxPageFrame>
  )
}

function CreditGlyph() {
  return <FileTextIcon aria-hidden="true" />
}
