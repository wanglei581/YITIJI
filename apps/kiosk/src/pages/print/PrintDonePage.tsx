import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { PrintJobParams, PrintJobTakeawayUrl } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { useRemainingSeconds } from '../../hooks/useCountdown'
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
import { helpNeededLine, peekSupportContact, preferUnattended, printProblemLine } from '../../copy/unattendedCopy'
import { PrintTouchFrame, printAsk } from './PrintTouchFrame'
import { PrintArt } from './art/PrintArt'
import { PrintIcon } from './art/PrintIcon'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PrintDoneUnverified } from './components/PrintDoneUnverified'
import { PrintDoneFailed, PrintDoneFeeInfo } from './components/PrintDoneFailed'
import { failureCopy, failureSummaryRows, feeInfoCopy, paymentRow, type FailureVariant } from './components/printDoneFailedModel'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { PrintDoneRecordSection } from './components/PrintDoneSections'
import { doneTakeaway, jobSubline, outOfPaperMoneyOf, paymentFactOf, publicOrderNo, reprintHint, type OutOfPaperMoney } from './printProgressModel'
import './styles/print-fulfill-qx.css'
import './styles/print-done-touch.css'

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
  const displayOrderNo = publicOrderNo(typeof state.orderNo === 'string' ? state.orderNo : null)
  const idDocument = state.idDocument === true

  const canReportIssue = taskId !== null
  const support = useSupportContact()
  const problem = printProblemLine(support)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feeInfoOpen, setFeeInfoOpen] = useState(false)
  const [idleLeft, setIdleLeft] = useState(60)

  const [verification, setVerification] = useState<PrintVerification | null>(null)
  const resultState: PrintResultState = !taskId
    ? 'unknown'
    : verification?.taskId === taskId
      ? verification.result
      : 'loading'
  const failureReason = verification?.taskId === taskId
    ? preferUnattended(verification.failureReason ?? '', problem)
    : problem
  const isUnconfirmed =
    verification?.taskId === taskId && verification.errorCode === PRINT_JOB_UNCONFIRMED
  const visual = resultState === 'failed' ? failVisual(verification?.errorCode) : resultState

  const [takeaway, setTakeaway] = useState<PrintJobTakeawayUrl | null>(null)
  const [takeawayError, setTakeawayError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const takeawayRemaining = useRemainingSeconds(takeaway?.expiresAt)
  const takeawayExpired = takeawayRemaining === 0
  const takeawayQrUrl = typeof takeaway?.signedUrl === 'string' && takeaway.signedUrl.length > 0 && !takeawayExpired
    ? toPublicQrUrl(takeaway.signedUrl)
    : null

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
            failureReason: result.failureReasonForUser ?? '',
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
          setTakeawayError(preferUnattended(userMessageOf(err, `带走链接没取到。${printProblemLine()}`), `带走链接没取到。${printProblemLine()}`))
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
        ? `这台机器的打印程序需要升级后才能重新提交。${printProblemLine()}`
        : preferUnattended(userMessageOf(err, `重新提交失败。${printProblemLine()}`), `重新提交失败。${printProblemLine()}`))
      setRetrying(false)
    }
  }

  if (feeInfoOpen) {
    const fee = feeInfoCopy({ free: amountCents === 0, orderNo: displayOrderNo })
    return (
      <PrintDoneFeeInfo
        title={fee.title}
        subtitle={fee.subtitle}
        pill={displayOrderNo ? `订单 ${displayOrderNo}` : '状态未知'}
        steps={fee.steps}
        stepsLabel={fee.stepsLabel}
        rows={[
          ...(displayOrderNo ? [{ key: 'order', label: '订单号', value: displayOrderNo }] : []),
          paymentRow({ fact: paymentFactOf(amountCents), amountCents }),
        ]}
        fine={fee.fine}
        onBack={() => setFeeInfoOpen(false)}
        onHelp={() => navigate('/help')}
      />
    )
  }

  if (resultState === 'loading' || resultState === 'unknown') {
    const isLoading = resultState === 'loading'
    return (
      <PrintDoneUnverified
        loading={isLoading}
        hasTask={taskId !== null}
        title={isLoading ? '正在核验打印结果' : '无法确认打印结果'}
        subtitle={isLoading ? '正在读取真实打印任务状态，请稍候' : '当前未取得可信的任务终态，请勿据此判断已经出纸'}
        onHome={() => navigate('/')}
        onHelp={() => navigate('/help')}
        onUpload={() => navigate(uploadPath)}
        onOrders={() => navigate('/me/print-orders')}
        onFeedback={() => setFeedbackOpen(true)}
        dialog={feedbackDialog}
      />
    )
  }

  if (resultState === 'failed') {
    const feedbackButton = canReportIssue ? (
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setFeedbackOpen(true)}>反馈问题</button>
    ) : null

    if (isUnconfirmed) {
      const paramLine = params ? jobSubline(file ? { pages: file.pages } : null, params) : null
      return (
        <PrintTouchFrame
          page="print-unconfirmed"
          legacyBody={false}
          eyebrow="打印结果"
          kind="compact"
          seal={null}
          title="这次打印结果未确认。"
          subtitle="系统已明确登记，等待人工核查"
          status={{ tone: 'warn', label: '打印结果未确认' }}
          terminalLabel="就业服务大厅"
          back={{ label: '返回首页', onBack: () => navigate('/') }}
          ask={printAsk('问小青：取纸或异常怎么办', '这次打印结果未确认。请说明取纸或遇到异常时怎么做。不要猜成功或失败，也不要让我重复打印。')}
          primary={{
            label: '使用帮助',
            testId: 'print-fulfill-primary',
            onClick: () => navigate('/help'),
          }}
          navbar={navbar}
        >
          <div
            data-w2-page="print-done"
            data-print-flow-step={6}
            data-testid="print-fulfill-state-result-unconfirmed"
            className="qx-scroll pff-page pft-unc"
          >
            <ol className="qxt-steps qxt-steps-big pft-unc-steps" style={{ gridTemplateColumns: '1fr' }}>
              <li className="qxt-step">
                <span className="qxt-step-n">1</span>
                <b>先看出纸口是否已有纸张</b>
                <small>设备在断电、失联或硬件异常后，无法确认这次打印的实际结果。</small>
              </li>
              <li className="qxt-step">
                <span className="qxt-step-n">2</span>
                <b>无论有没有，这笔订单都已保留，不要重复打印</b>
                <small>不猜成功也不猜失败，已登记等待人工核查。</small>
              </li>
              <li className="qxt-step">
                <span className="qxt-step-n">3</span>
                <b>
                  {helpNeededLine()}
                  {displayOrderNo ? `，报订单号 ${displayOrderNo}` : '，请报这一单的订单号'}
                </b>
                <small>报这一单的订单号。本机不猜成功或失败。</small>
              </li>
            </ol>
            <dl className="qxt-sum pft-unc-sum">
              {displayOrderNo ? <div className="qxt-sum-r"><dt>订单号</dt><dd>{displayOrderNo}</dd><span /></div> : null}
              {file?.name ? <div className="qxt-sum-r"><dt>文件</dt><dd>{file.name}</dd><span /></div> : null}
              {paramLine ? <div className="qxt-sum-r"><dt>参数</dt><dd>{paramLine}</dd><span /></div> : null}
            </dl>
            <div className="qxt-exits pft-unc-exits">
              <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={() => setFeeInfoOpen(true)}>查看订单说明</button>
              {feedbackButton}
            </div>
            {isLoggedIn ? (
              <button type="button" className="qxt-rowlink pft-unc-row" onClick={() => navigate('/me/print-orders')}>
                <QxTouchIcon name="receipt" size={32} />
                <span><b>查看打印订单</b></span>
                <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
              </button>
            ) : null}
            <p className="pft-unc-fine qxt-fine" data-testid="print-fulfill-fallback">
              这次结果已登记，等待人工核查；订单保留。
            </p>
          </div>
          {feedbackDialog}
        </PrintTouchFrame>
      )
    }

    // 普通失败、卡纸、缺纸三态共用一块版式（PrintDoneFailed）。收款事实：缺纸页优先用服务端回执，其余按进页时带来的金额。
    const variant: FailureVariant = visual === 'out-of-paper' ? 'out-of-paper' : visual === 'paper-jam' ? 'paper-jam' : 'failed'
    const money: OutOfPaperMoney = variant === 'out-of-paper'
      ? outOfPaperMoneyOf(takeaway, amountCents)
      : { fact: paymentFactOf(amountCents), amountCents }
    const faultOrderNo = publicOrderNo(takeaway?.orderNo) ?? displayOrderNo
    const canRetry = Boolean(takeaway?.canRetry)
    return (
      <PrintDoneFailed
        variant={variant}
        copy={failureCopy({ variant, money, orderNo: faultOrderNo, canRetry })}
        rows={failureSummaryRows({ orderNo: faultOrderNo, file: file ?? null, params: params ?? null, money, reason: failureReason })}
        free={amountCents === 0}
        retry={{ available: canRetry, busy: retrying, error: retryError, onRetry: () => { void handleResubmitPrint() } }}
        takeaway={{
          qrUrl: takeawayQrUrl,
          remaining: takeawayRemaining,
          expired: Boolean(takeaway && takeawayExpired),
          error: takeawayError && takeawayError !== printProblemLine() ? takeawayError : null,
        }}
        expiredLine={`带走链接已过期。${printProblemLine()}`}
        canReportIssue={canReportIssue}
        isLoggedIn={isLoggedIn}
        onFeeInfo={() => setFeeInfoOpen(true)}
        onFeedback={() => setFeedbackOpen(true)}
        onHome={() => navigate('/')}
        onHelp={() => navigate('/help')}
        onOrders={() => navigate('/me/print-orders')}
        dialog={feedbackDialog}
      />
    )
  }

  // 成功态才到这里：loading / unknown / failed / feeInfo 均已 return。
  // 以建单响应 hasEndUser 为准；本地 token 不能证明后端认了会话。事后登录也不会把这单追认回去。
  const hasEndUser = state.hasEndUser
  const miniappPublished = peekSupportContact().miniappPublished

  return (
    <PrintTouchFrame
      page="print-done"
      legacyBody={false}
      eyebrow="打印完成"
      title="都打好了，拿走前核一下"
      subtitle="文件已从出纸口送出，请核对页数后取走"
      status={{ tone: 'ok', label: '已在本机出纸' }}
      titleRole="status"
      terminalLabel="就业服务大厅"
      seal={null}
      sealNode={<DoneCheckMark />}
      back={undefined}
      ask={printAsk('问小青：怎么取纸', '怎么取纸？请告诉我核对页数和从出纸口取走时可以做的事。不要替我判断有没有打出来。')}
      dockLeft={
        <div className="pft-count" aria-hidden="true">
          <PrintArt name="ring" size={96} stroke={8} pct={idleLeft / 60} />
          <b>{idleLeft}</b>
        </div>
      }
      primaryNode={
        <button
          type="button"
          className="qxt-btn qxt-btn-danger qxt-wide"
          data-testid="print-fulfill-primary"
          onClick={() => {
            endKioskUse('end_use')
          }}
        >
          <PrintIcon name="erase" size={32} strokeWidth={2.2} />
          我拿走了，结束使用
        </button>
      }
      nav
    >
      <div data-w2-page="print-done" data-print-flow-step={6} data-pff-head="xq" data-testid="print-fulfill-state-completed" className="pft-done">
        <div className="pft-take" role="status">
          <PrintArt name="stack" size={340} count={2} />
          <div className="pft-take-tx">
            <b>从出纸口取走</b>
            <span>
              {idDocument ? '拿走前记得核一下页数，证件原件和复印件一起带走。' : '拿走前记得核一下页数。'}
              {' '}
              {takeawayCopy.pagesLabel}{takeawayCopy.facesLabel ? ` · ${takeawayCopy.facesLabel}` : ''}
            </span>
          </div>
        </div>
        {idDocument ? (
          <p className="pft-note">证件原件和复印件一起带走，别留在机器旁。</p>
        ) : null}
        <p className="pft-tray"><PrintIcon name="arrowD" size={72} strokeWidth={2.4} /><span>出纸口在下面</span></p>

        {/* 「这一单的记录」只在建单响应确认这一单关联了账号时才成立；没关联（false）或不知道（未知）时只说登录后看你的订单，不多承诺一层。 */}
        {hasEndUser === false ? <p className="pft-dest" role="status">本次打印未关联账号</p> : null}
        {hasEndUser === true && miniappPublished ? <p className="pft-dest" role="status">这单在手机『我的 → 打印订单』里能看到</p> : null}

        <div className="pft-tiles">
          <button type="button" className="qxt-tile qxt-tile-stack" onClick={() => navigate('/me/print-orders')}>
            <span className="qxt-ic"><QxTouchIcon name="receipt" size={34} /></span>
            <span className="qxt-tx"><b>查看打印订单</b><small>{hasEndUser === true ? '这一单的记录' : '登录后看你的订单'}</small></span>
          </button>
          <button type="button" className="qxt-tile qxt-tile-stack" onClick={() => navigate('/help')}>
            <span className="qxt-ic"><PrintIcon name="help" size={34} /></span>
            <span className="qxt-tx"><b>使用帮助</b><small>常见问题、服务电话</small></span>
          </button>
          {canReportIssue ? (
            <button type="button" className="qxt-tile qxt-tile-stack" onClick={() => setFeedbackOpen(true)}>
              <span className="qxt-ic qxt-ic-slate"><PrintIcon name="message" size={34} /></span>
              <span className="qxt-tx"><b>反馈问题</b><small>不用登录也能写</small></span>
            </button>
          ) : null}
        </div>

        {state.pickupSource ? <p className="pft-again-note">要再打一份请在手机上重新下单</p> : (
          <>
            <button
              type="button"
              className="qxt-btn qxt-btn-sec pft-again"
              data-testid="print-fulfill-reprint"
              onClick={() => navigate(uploadPath)}
            >
              再印一份
            </button>
            <p className="qxt-fine">{reprintHint(amountCents)}</p>
          </>
        )}

        <div className="pff-help" data-testid="print-fulfill-fallback">
          <span className="txt">少了页、印花了、对内容有疑问？{helpNeededLine()} 不再点屏幕，60 秒后结束本次使用；点一下屏幕重新计时。{isLoggedIn ? '到点会结束本次使用并退出登录，本机这次的打印预览一并收起。' : '到点会结束本次使用，本机这次的打印预览一并收起。'}</span>
        </div>

        <details className="pft-record">
          <summary>本次打印记录{displayOrderNo ? ` · 订单 ${displayOrderNo}` : ''}</summary>
          {displayOrderNo ? (
            <div className="pff-meta">
              <span className="pff-chip"><b>订单号</b> {displayOrderNo}</span>
              <span className="pff-chip"><b>完成</b></span>
            </div>
          ) : null}
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
        </details>
      </div>
      {feedbackDialog}
    </PrintTouchFrame>
  )
}

/** 稿 done 意图带右侧的对勾章：一笔画出。 */
function DoneCheckMark() {
  return (
    <svg className="pft-check" viewBox="0 0 150 150" width="130" height="130" aria-hidden="true">
      <circle className="pft-check-ring" cx="75" cy="75" r="68" fill="none" strokeWidth="7" />
      <path className="pft-check-tick" d="M46 77l20 20 40-42" fill="none" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
