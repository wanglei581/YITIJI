import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  PrinterIcon,
  ShieldIcon,
  SmartphoneIcon,
} from 'lucide-react'
import type { PrintJobParams, PrintJobTakeawayUrl } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { formatRemainingSeconds, useRemainingSeconds } from '../../hooks/useCountdown'
import {
  helpNeededLine,
  machineCannotPrintLine,
  machineUnusableLine,
  preferUnattended,
  printProblemLine,
  refundApplyLine,
} from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import {
  getPrintJobStatus,
  issuePrintJobTakeawayUrl,
  retryPrintJob,
  type PrintJobStatusResult,
} from '../../services/print/printJobsApi'
import { KioskFeedbackDialog } from '../../components/KioskFeedbackDialog'
import { PRINT_DONE_ISSUE_OPTIONS } from '../../services/api/kioskFeedback'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { PrintAiHelp } from './components/PrintAiHelp'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import {
  PrintDoneRecordSection,
  PrintDoneXq,
  PrintFeeBoundaryBar,
  PrintOutOfPaperPanel,
} from './components/PrintDoneSections'
import { doneTakeaway, outOfPaperDoing, outOfPaperMoneyOf, outOfPaperPill, publicOrderNo, reprintHint } from './printProgressModel'
import { formatCents } from './cashierStatus'
import './styles/print-fulfill-qx.css'

interface PrintFile {
  name:     string
  size:     string
  pages:    number | null
  fileUrl?: string
}

interface PrintJobState {
  file?:                PrintFile
  params?:              Partial<PrintJobParams>
  returnUrl?:           string
  returnLabel?:         string
  taskId?:              string
  orderId?:             string
  orderNo?:             string
  amountCents?:         number
  paymentSessionToken?: string
  pickupSource?:        boolean
  source?:              PrintMaterialSource
  /** 建单响应的真信号；缺省（刷新 / 旧 state / 从别处进来）时整条提示不渲染。 */
  hasEndUser?:          boolean
  /** 只有证件扫描或证件用途才为 true。缺省不提示水印。 */
  idDocument?:          boolean
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
 * 服务端在任何写入之前拒绝重排以防重复出纸（`PRINT_RETRY_UNCONFIRMED_FORBIDDEN`），
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

const ACTIVE_PRINT_STATUSES = ['pending', 'claimed', 'printing'] as const

function failVisual(errorCode?: string): 'paper-jam' | 'out-of-paper' | 'result-unconfirmed' | 'failed' {
  if (errorCode === PRINT_JOB_UNCONFIRMED) return 'result-unconfirmed'
  if (errorCode === 'PAPER_EMPTY') return 'out-of-paper'
  if (errorCode === 'PRINTER_ERROR') return 'paper-jam'
  return 'failed'
}

export function PrintDonePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken, isLoggedIn } = useAuth()
  const { endKioskUse } = useKioskSessionControl()
  const state = (location.state ?? {}) as PrintJobState

  const { file, params } = state
  const taskId = typeof state.taskId === 'string' && state.taskId.trim() ? state.taskId.trim() : null
  const uploadPath = printUploadPathForSource(state.source)
  const amountCents = typeof state.amountCents === 'number' ? state.amountCents : null
  const contact = useSupportContact()
  const faultLine = machineCannotPrintLine(contact, { orderKept: Boolean(taskId) })
  const paidRefund = amountCents != null && amountCents > 0 ? refundApplyLine(contact) : null
  const displayOrderNo = publicOrderNo(typeof state.orderNo === 'string' ? state.orderNo : null)
  const idDocument = state.idDocument === true

  const canReportIssue = taskId !== null
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feeInfoOpen, setFeeInfoOpen] = useState(false)
  const [endArmed, setEndArmed] = useState(false)
  const [idleLeft, setIdleLeft] = useState(60)

  const [verification, setVerification] = useState<PrintVerification | null>(null)
  const resultState: PrintResultState = !taskId
    ? 'unknown'
    : verification?.taskId === taskId
      ? verification.result
      : 'loading'
  const failureReason = verification?.taskId === taskId && verification.failureReason
    ? preferUnattended(verification.failureReason, faultLine)
    : faultLine
  const isUnconfirmed =
    verification?.taskId === taskId && verification.errorCode === PRINT_JOB_UNCONFIRMED
  const visual = resultState === 'failed' ? failVisual(verification?.errorCode) : resultState

  const [takeaway, setTakeaway] = useState<PrintJobTakeawayUrl | null>(null)
  const [takeawayError, setTakeawayError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const takeawayRemaining = useRemainingSeconds(takeaway?.expiresAt)
  const takeawayExpired = takeawayRemaining === 0
  const takeawayQrUrl = takeaway && !takeawayExpired ? toPublicQrUrl(takeaway.signedUrl) : null

  /* W-43（产品负责人 9/29）：完成页到点 = 真的结束这次使用。
   * 以前到点只收起打印预览、账号还登录着，下一位走上来点「我的」就是上一位的文件和订单。
   * 现在到点走统一的 endKioskUse：结束人次 → 清本机数据 → 退出登录 → 回首页。 */
  const endOnTimeout = useCallback(() => {
    endKioskUse('print_done_timeout')
  }, [endKioskUse])

  useEffect(() => {
    if (resultState !== 'completed') return
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
        endOnTimeout()
      }
    }, 1000)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', onReset)
      window.removeEventListener('keydown', onReset)
    }
  }, [endOnTimeout, resultState])

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
            failureReason: result.failureReasonForUser,
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
          setTakeawayError(userMessageOf(err, `暂时无法签发带走链接。${helpNeededLine()}`))
        }
      })
    return () => { cancelled = true }
  }, [getToken, resultState, state.paymentSessionToken, taskId])

  const takeawayCopy = doneTakeaway(file ? { pages: file.pages } : null, params)

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
      setRetryError(errorCodeOf(err) === 'PRINT_RETRY_AGENT_VERSION'
        ? `这台机器的打印程序需要升级后才能重新提交。${machineUnusableLine()}`
        : userMessageOf(err, `重新提交失败。${helpNeededLine()}`))
      setRetrying(false)
    }
  }

  const paidLabel = amountCents === 0
    ? '免费试运营，本单 0 元'
    : amountCents != null
      ? `已付 ${formatCents(amountCents)}`
      : '订单保留'

  if (feeInfoOpen) {
    return (
      <QxPageFrame
        title={amountCents === 0 ? '订单记录' : '费用与订单边界'}
        subtitle="本页只展示订单的真实状态，不替你承诺结果"
        status={{ tone: 'warn', label: displayOrderNo ? `订单 ${displayOrderNo}` : '状态未知' }}
        terminalLabel="就业服务大厅"
        ctabar={
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeeInfoOpen(false)}>
              返回上一页
            </button>
            <button type="button" className="qx-btn" data-variant="primary" data-testid="print-fulfill-primary" onClick={() => navigate('/help')}>
              问小青
            </button>
          </>
        }
        navbar={navbar}
      >
        <div data-w2-page="print-done" data-print-flow-step={6} data-testid="print-fulfill-state-fee-info" className="qx-scroll pff-page">
          <PrintDoneXq ask={amountCents === 0 ? <>订单记录，<em>一项一项核对</em>。</> : <>钱的事，<em>一笔一笔说清楚</em>。</>} doing="本页只展示订单的真实状态，不替你承诺结果。" />
          <PrintFeeBoundaryBar
            free={amountCents === 0}
            sub={amountCents === 0 ? '订单记录保留，不会因为这次异常消失' : '订单和支付记录都在，不会因为这次异常消失'}
            body={paidRefund ? <>{paidRefund}</> : <>订单记录保留。是否补打，回到订单重新打印。</>}
            facts={
              <>
                {displayOrderNo ? <span>订单 <b>{displayOrderNo}</b></span> : null}
                {amountCents != null ? <span>{amountCents === 0 ? '办理方式' : '支付状态'} <b>{paidLabel}</b></span> : <span>支付状态 <b>以订单为准</b></span>}
              </>
            }
          />
          <div className="qx-card">
            <div className="pff-step"><span className="pff-step-no">1</span><span className="pff-step-txt">{displayOrderNo ? <>记下<b>订单号 {displayOrderNo}</b>。</> : <>先看出纸口里已经出来的纸。</>}</span></div>
            <div className="pff-step"><span className="pff-step-no">2</span><span className="pff-step-txt">说明实际拿到了几页、哪几页没出，<b>已出的纸请一并带上</b>。</span></div>
            <div className="pff-step"><span className="pff-step-no">3</span><span className="pff-step-txt">{paidRefund ?? helpNeededLine(contact)}</span></div>
          </div>
          <div className="pff-help" data-testid="print-fulfill-fallback">
            <span className="txt">{paidRefund ?? '订单记录保留。是否补打，回到订单重新打印。'}</span>
            <button type="button" className="pff-help-btn" onClick={() => navigate('/help')}>问小青</button>
          </div>
          <PrintAiHelp
            label="问小青：取纸或异常怎么办 →"
            draft="打印时取纸或遇到异常该怎么办？请告诉我现在可以做的事，不要替我判断有没有打出来。"
          />
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
                    ? `暂时无法核验这一单，请在打印订单中查看。${helpNeededLine(contact)}`
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
    const feedbackButton = canReportIssue ? (
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeedbackOpen(true)}>反馈问题</button>
    ) : null
    const retryButton = takeaway?.canRetry && !isUnconfirmed ? (
      <>
        <button
          type="button"
          className="qx-btn"
          data-variant="teal"
          disabled={retrying}
          onClick={() => { void handleResubmitPrint() }}
        >
          {retrying ? '正在重新提交…' : '重新提交打印'}
        </button>
        {retryError && (
          <p role="alert" className="qx-state-d" style={{ flex: '1 1 100%', order: -1, margin: 0 }}>
            {retryError}
          </p>
        )}
      </>
    ) : null
    const takeawayNotices = (
      <>
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
          <p role="status">带走链接已过期。{helpNeededLine(contact)}</p>
        )}
        {takeawayError && <p role="status">{takeawayError}</p>}
      </>
    )

    if (visual === 'out-of-paper') {
      // 稿 15 out-of-paper：小青区即页头 → 任务卡（单文件 + 缺纸说明 + 费用边界）→ 现场三步 → 底栏两出口。
      // 稿里「加纸后继续」「已出 1 份」在真实合同里都不成立，改写理由见 PrintOutOfPaperPanel 头注。
      const money = outOfPaperMoneyOf(takeaway, amountCents)
      const faultOrderNo = publicOrderNo(takeaway?.orderNo) ?? displayOrderNo
      return (
        <QxPageFrame
          back={{ label: '返回首页', onBack: () => navigate('/') }}
          title="打印机缺纸"
          subtitle="已经登记缺纸，这次打印不会在加纸后自动续打"
          status={{ tone: 'bad', label: outOfPaperPill(money) }}
          terminalLabel="就业服务大厅"
          ctabar={
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeeInfoOpen(true)}>{amountCents === 0 ? '查看订单说明' : '查看费用说明'}</button>
              {feedbackButton}
              {retryButton}
              <button type="button" className="qx-btn" data-variant="primary" data-testid="print-fulfill-primary" onClick={() => navigate('/help')}>
                问小青
              </button>
            </>
          }
          navbar={navbar}
        >
          <div
            data-w2-page="print-done" data-print-flow-step={6}
            data-pff-head="xq"
            data-screen="print-fulfill"
            data-state="out-of-paper"
            data-testid="print-fulfill-state-out-of-paper"
            className="qx-scroll pff-page pfp-page pfd-page"
          >
            <PrintDoneXq mainClassName="pfp-xq-main" ask={<>机器里<em>没纸了</em>。</>} doing={outOfPaperDoing(money, contact)} />
            <PrintOutOfPaperPanel
              file={file ?? null}
              params={params ?? null}
              taskId={taskId}
              orderNo={faultOrderNo}
              failureReason={failureReason}
              money={money}
              canRetry={Boolean(takeaway?.canRetry)}
              takeaway={takeawayNotices}
            />
            <PrintAiHelp
              label="问小青：取纸或异常怎么办 →"
              draft="打印时取纸或遇到异常该怎么办？请告诉我现在可以做的事，不要替我判断有没有打出来。"
            />
          </div>
          {feedbackDialog}
        </QxPageFrame>
      )
    }

    const jam = visual === 'paper-jam'
    const issueTitle = isUnconfirmed ? '打印结果未确认' : jam ? '打印机卡纸' : '打印失败'
    const ask = isUnconfirmed
      ? <>这次打印<em>结果未确认</em>。</>
      : jam
        ? <>纸<em>卡住了</em>，别硬拉。</>
        : <>打印<em>没有完成</em>。</>
    const doing = faultLine
    const issueSub = isUnconfirmed
      ? '系统已登记，不把没确认的结果说成成功或失败'
      : jam
        ? (amountCents != null && amountCents > 0 ? '订单和支付记录都保留着' : '订单记录保留着')
        : '打印任务已经确认失败'
    return (
      <QxPageFrame
        title={issueTitle}
        subtitle={isUnconfirmed ? '这次无法确认是否已经出纸' : '打印任务已经确认失败'}
        status={{ tone: 'bad', label: `${paidLabel} · ${issueTitle}` }}
        terminalLabel="就业服务大厅"
        ctabar={
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')}>返回首页</button>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeeInfoOpen(true)}>{amountCents === 0 ? '查看订单说明' : '查看费用说明'}</button>
            {feedbackButton}
            {retryButton}
            <button type="button" className="qx-btn" data-variant="primary" data-testid="print-fulfill-primary" onClick={() => navigate('/assistant')}>
              {isUnconfirmed ? printProblemLine(contact) : '问小青'}
            </button>
          </>
        }
        navbar={navbar}
      >
        <div
          data-w2-page="print-done" data-print-flow-step={6}
          data-pff-head="xq"
          data-testid={
            isUnconfirmed
              ? 'print-fulfill-state-result-unconfirmed'
              : jam
                ? 'print-fulfill-state-paper-jam'
                : 'print-fulfill-state-failed'
          }
          className="qx-scroll pff-page"
        >
          <PrintDoneXq ask={ask} doing={doing} />

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
                ? <>设备在断电、失联或硬件异常后，<b>无法确认这次打印的实际结果</b>。不猜成功也不猜失败。请先查看出纸口是否已有纸张。{faultLine}</>
                : jam
                  ? <>请<b>不要自己打开机器或拽纸</b>。已出的纸你先收好。{faultLine}</>
                  : failureReason}
            </p>
            {jam && failureReason ? <p className="pff-issue-body">{failureReason}</p> : null}
          </div>

          {(publicOrderNo(takeaway?.orderNo) ?? displayOrderNo) ? (
            <p className="pff-out-sub">订单号 {publicOrderNo(takeaway?.orderNo) ?? displayOrderNo}</p>
          ) : null}
          {paidRefund ? <p className="pff-out-sub">{paidRefund}</p> : null}
          {takeawayNotices}
        </div>
        {feedbackDialog}
      </QxPageFrame>
    )
  }

  // 成功态才到这里：loading / unknown / failed / feeInfo 均已 return。
  // 以建单响应 hasEndUser 为准；本地 token 不能证明后端认了会话。事后登录也不会把这单追认回去。
  const hasEndUser = state.hasEndUser

  return (
    <QxPageFrame
      title="打印完成"
      subtitle="文件已从出纸口送出，请核对页数后取走"
      status={{ tone: 'ok', label: amountCents != null ? `${paidLabel} · 打印完成` : '打印完成' }}
      terminalLabel="就业服务大厅"
      ctabar={
        <>
          {state.pickupSource && contact.miniappPublished ? <p>要再打一份请在手机上重新下单</p> : <button
            type="button"
            className="qx-btn pff-again"
            data-variant="ghost"
            data-testid="print-fulfill-reprint"
            onClick={() => navigate(uploadPath)}
          >
            再印一份
            <small>{reprintHint(amountCents)}</small>
          </button>}
          <button
            type="button"
            className="qx-btn"
            data-variant="danger"
            data-testid="print-fulfill-primary"
            onClick={() => {
              if (endArmed) {
                endKioskUse('end_use')
                return
              }
              setEndArmed(true)
            }}
          >
            {endArmed ? '再按一次，确认结束使用' : '我拿走了，结束使用'}
          </button>
        </>
      }
      navbar={navbar}
    >
      <div data-w2-page="print-done" data-print-flow-step={6} data-pff-head="xq" data-testid="print-fulfill-state-completed" className="qx-scroll pff-page">
        <PrintDoneXq ask={<>都打好了，<em>从出纸口拿走</em>。</>} doing={idDocument ? '拿走前记得核一下页数，证件原件和复印件一起带走。' : '拿走前记得核一下页数，少页当场能处理。'} />

        <div className="qx-card">
          <div className="pff-done-title" role="status">
            <span className="pff-ok"><CheckIcon aria-hidden="true" /></span>
            都打好了，拿走前核一下
          </div>
          <p className="pff-out-sub">
            {takeawayCopy.facesLabel}
          </p>
          <div className="pff-step">
            <span className="pff-step-no">1</span>
            <span className="pff-step-txt">
              从出纸口取走 <b>{takeawayCopy.pagesLabel}</b>。
            </span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">2</span>
            <span className="pff-step-txt">当场核对<b>页数和清晰度</b>，少页、卡纸、印花了都能当场处理。</span>
          </div>
          {idDocument ? (
            <div className="pff-step">
              <span className="pff-step-no">3</span>
              <span className="pff-step-txt">证件<b>原件和复印件一起带走</b>，别留在机器旁；复印件只用于本人求职等正当用途。</span>
            </div>
          ) : null}
          <p className="pff-out-sub">已在本机出纸</p>
        </div>

        {typeof hasEndUser === 'boolean' && contact.miniappPublished && (
          <div className="pff-inbar" role="status">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><SmartphoneIcon aria-hidden="true" /></span>
              <span>
                {hasEndUser
                  ? <>这单已经在你的小程序里<small>打开「我的 → 打印订单」就能看到</small></>
                  : <>本次打印未关联账号<small>如需在小程序留存订单记录，下次打印前可先登录</small></>}
              </span>
            </div>
          </div>
        )}

        {displayOrderNo ? (
          <div className="pff-meta">
            <span className="pff-chip"><b>订单号</b> {displayOrderNo}</span>
            <span className="pff-chip"><b>完成</b></span>
          </div>
        ) : null}

        <div className="pff-wipe" data-live="true">
          <div>
            <div className="pff-wipe-t"><ShieldIcon aria-hidden="true" />一会儿结束本次使用</div>
            <p className="pff-wipe-s">
              {isLoggedIn
                ? '不再点屏幕，到点会结束本次使用并退出登录，本机这次的打印预览一并收起。也可以现在就结束。'
                : '不再点屏幕，到点会结束本次使用，本机这次的打印预览一并收起。也可以现在就结束。'}
            </p>
          </div>
          <div className="pff-wipe-n">
            <div className="n">{idleLeft}</div>
            <div className="u">秒后结束使用</div>
          </div>
        </div>

        <div className="pff-help" data-testid="print-fulfill-fallback">
          <span className="txt">少了页、印花了、对内容有疑问？<b>现在处理最方便</b>。</span>
          <button type="button" className="pff-help-btn" onClick={() => navigate('/help')}>问小青</button>
        </div>
        <PrintAiHelp
          label="问小青：取纸或异常怎么办 →"
          draft="打印时取纸或遇到异常该怎么办？请告诉我现在可以做的事，不要替我判断有没有打出来。"
        />

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

        <PrintDoneRecordSection
          file={file}
          params={params}
          retention={{
            fileRetentionAvailable: verification?.fileRetentionAvailable,
            fileExpiresAt: verification?.fileExpiresAt,
            fileRetentionPolicy: verification?.fileRetentionPolicy,
            fileDeletedAt: verification?.fileDeletedAt,
            fileDeleteReason: verification?.fileDeleteReason,
            fileStorageDeletedAt: verification?.fileStorageDeletedAt,
          }}
        />
      </div>
      {feedbackDialog}
    </QxPageFrame>
  )
}
