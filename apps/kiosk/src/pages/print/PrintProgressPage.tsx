// ============================================================
// PrintProgressPage — 青序流光 15-print-fulfill /print/progress
//
// Two modes:
//   REAL  — state.taskId is set (API_MODE=http, real job submitted)
//           Polls GET /api/v1/print/jobs/:taskId every 3s.
//           Maps backend status → UI steps. Agent 硬件回流为唯一进度真值。
//   SIM   — no taskId (mock mode or virtual file from W5 enterprise flow)
//           Same setTimeout-based animation as before；演示结束停留本页，不跳成功。
//
// Status mapping (backend → UI step index):
//   pending  / claimed  → step 1 "排队等待"  (step 0 "提交任务" already done)
//   printing            → step 2 "打印中"
//   completed           → navigate to /print/done (success)
//   failed / cancelled / abandoned → navigate to /print/done (failure / 终态)
//
// 稿 15 九态里本页只承接 printing 与 client-status-timeout，其余七态怎么落见 printProgressModel 头注。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  ShieldIcon,
} from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { truncateFileNameMiddle, FILE_NAME_BUDGET_COMPACT } from '../../lib/fileName'
import { API_MODE } from '../../services/api/client'
import { getPrintJobStatus, type BackendJobStatus } from '../../services/print/printJobsApi'
import { wakeLocalPrintQueue } from '../../services/print/localPrintWakeApi'
import type { PrintJobParams } from '@ai-job-print/shared'
import type { PrintFileState } from './printMaterialSession'
import { printUploadPathForSource } from './printMaterialSession'
import { formatCents } from './cashierStatus'
import { PrintJobRow, PrintStatusTimeoutPanel, type PrintJobState } from './components/PrintProgressSections'
import './styles/print-fulfill-qx.css'
import {
  FAIL_REASONS,
  STEPS,
  backendStatusToStep,
  errorCodeToMessage,
  expectedSheets,
  jobSubline,
  pagesPerCopy,
  paymentFactOf,
  paymentLead,
  paymentPill,
  stepIndex,
  tlItemClass,
  type Step,
} from './printProgressModel'

const POLL_INTERVAL_MS = 3000
const POLL_FAIL_LIMIT = 5
const REAL_POLL_TIMEOUT_MS = 10 * 60 * 1000
const STATUS_READ_ERROR_TEXT = '暂时无法读取状态'

function realStatusPresentation(status: BackendJobStatus | null) {
  switch (status) {
    case 'pending':
      return {
        headerTitle: '等待终端领取',
        headerSubtitle: '任务已进入队列，终端尚未领取，请留在机器旁',
        stageTitle: '等待终端领取',
        stageSubtitle: '任务正在队列中等待，尚未发送到打印机',
        queueLabel: '等待终端领取',
        queueDesc: '任务正在队列中，终端尚未领取',
        activeHint: '等待终端领取…',
        askPhase: '等待终端领取',
        badge: '排队等待中',
      }
    case 'claimed':
      return {
        headerTitle: '终端已领取任务',
        headerSubtitle: '终端正在准备打印，请留在机器旁',
        stageTitle: '终端已领取任务',
        stageSubtitle: '终端已领取任务，正在准备打印',
        queueLabel: '终端已领取',
        queueDesc: '终端已领取任务，正在准备打印',
        activeHint: '终端准备中…',
        askPhase: '终端准备打印',
        badge: '终端准备中',
      }
    case 'printing':
      return {
        headerTitle: '正在打印',
        headerSubtitle: '打印机正在出纸，请留在机器旁及时取件',
        stageTitle: '正在打印',
        stageSubtitle: '打印机正在出纸，请在出纸口等候',
        queueLabel: '终端已领取',
        queueDesc: '终端已领取任务并进入打印阶段',
        activeHint: '打印机正在出纸…',
        askPhase: '正在出纸',
        badge: '打印进行中',
      }
    default:
      return {
        headerTitle: '正在确认任务状态',
        headerSubtitle: '任务已提交，正在读取终端状态，请留在机器旁',
        stageTitle: '正在确认任务状态',
        stageSubtitle: '尚未收到终端处理状态',
        queueLabel: '等待状态更新',
        queueDesc: '正在向服务端确认任务是否已被终端领取',
        activeHint: '正在读取状态…',
        askPhase: '正在确认状态',
        badge: '状态确认中',
      }
  }
}

export function PrintProgressPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null
  const source = state?.source === 'resume' || state?.source === 'document' ? state.source : undefined
  const uploadPath = printUploadPathForSource(source)

  const taskId     = typeof state?.taskId === 'string' ? state.taskId : null
  const isHttpMode = API_MODE === 'http'
  const useRealApi = isHttpMode && Boolean(taskId)

  const hasFileContext = Boolean((state as { file?: unknown } | null)?.file)
  const hasContext = Boolean(taskId) || hasFileContext
  const canSimulate = !isHttpMode && hasFileContext
  const isSim = canSimulate

  const shouldFail = canSimulate && state?.simulateFailure === true
  const failReason = typeof state?.failReason === 'string' ? state.failReason : FAIL_REASONS[0]

  const [current, setCurrent]   = useState<Step>(useRealApi ? 'queuing' : 'submitting')
  const [backendStatus, setBackendStatus] = useState<BackendJobStatus | null>(null)
  const backendStatusRef = useRef<BackendJobStatus | null>(null)
  const [failed, setFailed]     = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [simDone, setSimDone]   = useState(false)
  const [statusReadError, setStatusReadError] = useState(false)
  // 「重新查询状态」只是让轮询从头再来一轮（立即查一次 + 重新计 10 分钟），不重下单、不重复扣费。
  const [pollEpoch, setPollEpoch] = useState(0)
  const cancelRef               = useRef(false)
  const pollFailsRef            = useRef(0)
  const simTimerRef             = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failTimerRef            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wakeRequestedTaskIdRef  = useRef<string | null>(null)

  useBusyLock(
    (useRealApi && !failed && !timedOut) ||
    (isSim && !failed && !simDone),
  )

  const navigateFail = useCallback(
    (reason: string) => {
      setFailed(true)
      if (isSim) {
        setSimDone(true)
        return
      }
      failTimerRef.current = setTimeout(() => {
        navigate('/print/done', { state: { ...state, success: false, reason } })
      }, 700)
    },
    [isSim, navigate, state],
  )

  useEffect(() => () => {
    if (failTimerRef.current) clearTimeout(failTimerRef.current)
  }, [])

  const navigateSuccess = useCallback(() => {
    navigate('/print/done', { state: { ...state, success: true } })
  }, [navigate, state])

  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[0])
  }, [navigateFail])

  const recheckStatus = useCallback(() => {
    setTimedOut(false)
    setPollEpoch((epoch) => epoch + 1)
  }, [])

  useEffect(() => {
    if (useRealApi || !canSimulate) return

    cancelRef.current = false

    const advance = (idx: number) => {
      if (idx >= STEPS.length) {
        if (!cancelRef.current) setSimDone(true)
        return
      }
      const step = STEPS[idx]
      const duration = shouldFail && step.key === 'printing' ? 1200 : step.duration

      simTimerRef.current = setTimeout(() => {
        if (cancelRef.current) return
        if (shouldFail && step.key === 'printing') {
          navigateFail(failReason)
          return
        }
        const next = STEPS[idx + 1]
        if (next) setCurrent(next.key)
        advance(idx + 1)
      }, duration)
    }

    advance(0)
    return () => {
      cancelRef.current = true
      if (simTimerRef.current) clearTimeout(simTimerRef.current)
    }
  }, [useRealApi, canSimulate, navigateFail, shouldFail, failReason])

  useEffect(() => {
    if (!useRealApi || !taskId) return

    // 每一轮轮询自带停止标记：重新查询 / 离页时，上一轮在飞的请求回来也不再改页面。
    let stopped = false
    pollFailsRef.current = 0
    if (backendStatusRef.current === null) setCurrent('queuing')

    if (wakeRequestedTaskIdRef.current !== taskId) {
      wakeRequestedTaskIdRef.current = taskId
      void wakeLocalPrintQueue()
    }

    const tick = async () => {
      if (stopped) return
      try {
        const result = await getPrintJobStatus(taskId)
        if (stopped) return

        if (result.status === 'completed') {
          stopped = true
          navigateSuccess()
          return
        }
        if (result.status === 'failed') {
          stopped = true
          navigateFail(
            result.failureReasonForUser ?? errorCodeToMessage(result.errorCode) ?? FAIL_REASONS[0],
          )
          return
        }
        if (result.status === 'cancelled' || result.status === 'abandoned') {
          stopped = true
          navigateFail(
            result.failureReasonForUser
              ?? (result.status === 'cancelled'
                ? '任务已取消，请联系现场工作人员确认订单'
                : '任务已结束，请联系现场工作人员确认订单'),
          )
          return
        }
        pollFailsRef.current = 0
        setStatusReadError(false)
        backendStatusRef.current = result.status
        setBackendStatus(result.status)
        if (result.status === 'printing') setTimedOut(false)
        setCurrent(backendStatusToStep(result.status))
      } catch {
        if (stopped) return
        pollFailsRef.current += 1
        setStatusReadError(true)
        if (pollFailsRef.current >= POLL_FAIL_LIMIT) {
          stopped = true
          navigateFail(`${STATUS_READ_ERROR_TEXT}，请联系工作人员`)
        }
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    const onTimeout = () => {
      if (stopped) return
      if (backendStatusRef.current === 'printing') { timeoutTimer = setTimeout(onTimeout, REAL_POLL_TIMEOUT_MS); return }
      setTimedOut(true)
    }
    timeoutTimer = setTimeout(onTimeout, REAL_POLL_TIMEOUT_MS)

    return () => {
      stopped = true
      clearInterval(timer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }, [useRealApi, taskId, navigateFail, navigateSuccess, pollEpoch])

  const currentIdx = stepIndex(current)
  const realStatus = realStatusPresentation(backendStatus)

  const file   = (state?.file  as PrintFileState | undefined) ?? null
  const params = (state?.params as PrintJobParams | undefined) ?? null
  // 订单号只认运营单号；orderId 是内部 cuid，拿它冒充「订单号」工作人员也查不到。
  const orderNo = typeof state?.orderNo === 'string' ? state.orderNo : null
  const amountCents = typeof state?.amountCents === 'number' ? state.amountCents : null
  const payment = paymentFactOf(amountCents)
  const isFreeOrder = payment === 'free'
  const pageCount = pagesPerCopy(file, params)
  const sheets = expectedSheets(file, params)
  const fileName = file?.name ? truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_COMPACT }) : '本次打印任务'

  const navbar = (
    <QxAppNavbar
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )

  const pillLabel = isSim
    ? (simDone ? '演示已结束' : '演示进行中')
    : paymentPill(payment, amountCents, realStatus.badge)

  const timeoutPill = payment === 'paid' && amountCents != null
    ? `已付 ${formatCents(amountCents)} · 状态查询中`
    : isFreeOrder ? '本次未收款 · 状态查询中' : '状态查询中'
  const frameStatus = timedOut
    ? { tone: 'warn' as const, label: timeoutPill }
    : failed
      ? { tone: 'bad' as const, label: isSim ? '演示失败' : '处理出错' }
      : backendStatus == null && useRealApi
        ? { tone: 'unknown' as const, label: '状态未知' }
        : { tone: 'ok' as const, label: pillLabel }

  if (!hasContext || (!isHttpMode && !canSimulate)) {
    return (
      <QxPageFrame
        /* 稿 15-print-fulfill 原文：aria-label="返回首页"。
       *  返回 ≠ 取消：打印任务在服务端，离开这一屏不会终止它，
       *  用户可以从「我的打印订单」再回来看进度。 */
        back={{ label: '返回首页', onBack: () => navigate('/') }}
        title="未找到打印任务"
        subtitle="请从上传文件重新开始打印流程"
        status={{ tone: 'unknown', label: '状态未知' }}
        terminalLabel="就业服务大厅"
        ctabar={
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(uploadPath)}>
            重新上传文件
          </button>
        }
        navbar={navbar}
      >
        <div data-w2-page="print-progress" data-print-flow-step={6} data-testid="print-fulfill-state-missing-context" className="qx-scroll pff-page">
          <div className="qx-state" data-tone="empty">
            <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
            <div>
              <div className="qx-state-t">未找到打印任务</div>
              <div className="qx-state-d">请从上传文件重新开始打印流程。本页不会编造进度或打印结果。</div>
            </div>
          </div>
        </div>
      </QxPageFrame>
    )
  }

  if (isHttpMode && !taskId) {
    return (
      <QxPageFrame
        back={{ label: '返回确认页', onBack: () => navigate('/print/confirm', { state }) }}
        title="打印任务尚未创建"
        subtitle="请返回确认页重试"
        status={{ tone: 'unknown', label: '状态未知' }}
        terminalLabel="就业服务大厅"
        ctabar={
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/confirm', { state })}>
            返回确认页
          </button>
        }
        navbar={navbar}
      >
        <div data-w2-page="print-progress" data-print-flow-step={6} data-testid="print-fulfill-state-missing-context" className="qx-scroll pff-page">
          <div className="qx-state" data-tone="error">
            <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
            <div>
              <div className="qx-state-t">打印任务尚未创建</div>
              <div className="qx-state-d">没有真实 taskId，不能展示打印进度，也不会假装已经出纸。</div>
            </div>
          </div>
        </div>
      </QxPageFrame>
    )
  }

  const TL_ITEMS = [
    {
      key: 'submit',
      label: '提交任务',
      desc: isSim
        ? '演示：未建单、未支付，仅流程演示'
        : payment === 'free'
          ? '已创建打印任务，本次无需支付'
          : payment === 'paid'
            ? '已创建打印任务并完成支付确认'
            : '已创建打印任务',
    },
    {
      key: 'queue',
      label: isSim ? '排队等待演示' : realStatus.queueLabel,
      desc: isSim
        ? '演示：终端未接收、未校验'
        : realStatus.queueDesc,
    },
    {
      key: 'print',
      label: isSim ? '打印演示' : '打印中',
      desc: isSim
        ? '演示：未出纸，无真实打印动作'
        : backendStatus === 'printing'
          ? '打印机正在出纸，请在出纸口等候'
          : '终端开始打印后才会出纸',
    },
    {
      key: 'pickup',
      label: isSim ? '演示结束' : '完成取件',
      desc: isSim
        ? '演示：无真实取件结果'
        : '服务端确认完成后自动转到取件核对',
    },
  ] as const

  const stageHeading = isSim
    ? (simDone ? '演示流程已结束' : '流程演示中')
    : realStatus.stageTitle
  const stageLine = isSim
    ? (simDone ? '未真实打印，可返回首页或重新上传' : '仅演示进度步骤，未建单、未支付、未出纸')
    : realStatus.stageSubtitle

  // 小青区就是本页的页头（稿 15 没有独立页头）：首句报「钱的事实 + 任务阶段」，
  // 次句报「你现在该干嘛」。拿不到真实份数时只给等待指引，不编数字（§9 不伪造）。
  const copiesText = params?.copies && params.copies > 1 ? `${params.copies} 份依次打印。` : ''
  const askTitle = isSim
    ? (simDone ? <>演示流程已结束，<em>未真实打印</em>。</> : <>流程演示中，<em>不会出纸</em>。</>)
    : timedOut
      ? <>暂时<em>查不到</em>打印结果。</>
      : failed
        ? <>打印遇到问题，<em>正在核对结果</em>。</>
        : <>{paymentLead(payment)}<em>{realStatus.askPhase}</em>。</>
  const askDoing = isSim
    ? (simDone ? '未真实打印，未创建打印任务' : '当前为演示模式，不会建单、支付或出纸')
    : timedOut
      ? '这不代表成功或失败，只是本机暂时没拿到最新状态。'
      : failed
        ? '马上转到结果页，按服务端登记说明原因和下一步。'
        : backendStatus === 'printing'
          ? `${copiesText}你可以先在旁边等，不用贴着机器。`
          : realStatus.headerSubtitle

  const view = isSim ? 'demo' : timedOut ? 'client-status-timeout' : failed ? 'failed' : 'printing'
  const jobState: PrintJobState = isSim
    ? { tone: simDone ? 'wait' : 'doing', label: simDone ? '演示结束' : '演示中' }
    : timedOut
      ? { tone: 'wait', label: '状态查询中' }
      : failed
        ? { tone: 'err', label: '出错' }
        : { tone: backendStatus === 'printing' ? 'doing' : 'wait', label: realStatus.badge }
  const endLabel = failed
    ? '正在核对结果，暂不能结束清空'
    : backendStatus === 'printing'
      ? '还在打印，完成后才能结束清空'
      : '任务还没打完，完成后才能结束清空'
  const idLine = [taskId ? `任务号 ${taskId}` : '', orderNo ? `订单号 ${orderNo}` : ''].filter(Boolean).join(' · ')

  const jobRow = <PrintJobRow fileName={fileName} subline={jobSubline(file, params)} idLine={idLine} state={jobState} />

  return (
    <QxPageFrame
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      title={isSim ? (simDone ? '演示流程已结束' : '流程演示中') : timedOut ? '暂时查不到打印结果' : realStatus.headerTitle}
      status={frameStatus}
      terminalLabel="就业服务大厅"
      ctabar={
        isSim ? (
          <span className="why">
            {simDone ? '演示流程已结束 · 未真实打印' : '演示模式·非真实打印；动画结束后停留本页'}
          </span>
        ) : (timedOut ? (
          <>
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              data-testid="print-fulfill-primary"
              onClick={recheckStatus}
            >
              重新查询状态
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/help')}>
              联系工作人员
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="qx-btn pff-again"
              data-variant="ghost"
              data-testid="print-fulfill-reprint"
              onClick={() => navigate(uploadPath)}
            >
              再印一份
              <small>重新选文件、核价并支付 · 不免费</small>
            </button>
            <button type="button" className="qx-btn pfp-end" data-variant="ghost" disabled aria-disabled="true">
              {endLabel}
            </button>
          </>
        ))
      }
      navbar={navbar}
    >
    <div
      data-w2-page="print-progress" data-print-flow-step={6}
      data-pff-head="xq"
      data-screen="print-fulfill"
      data-state={view}
      data-testid={timedOut ? 'print-fulfill-state-client-status-timeout' : failed ? 'print-fulfill-state-failed' : 'print-fulfill-state-printing'}
      className="qx-scroll pff-page pfp-page"
    >
      <section className="pff-xq">
        <div className="pff-xq-row">
          <div className="pff-xq-face" aria-hidden="true">青</div>
          <div className="pfp-xq-main">
            <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
            <p className="pff-xq-ask">{askTitle}</p>
            <p className="pff-xq-doing">{askDoing}</p>
          </div>
        </div>
      </section>

      {isSim && (
        <div className="pff-sim-banner" role="note">
          演示模式·非真实打印
        </div>
      )}

      {timedOut ? (
        <PrintStatusTimeoutPanel
          jobRow={jobRow}
          payment={payment}
          amountCents={amountCents}
          orderNo={orderNo}
          taskId={taskId}
        />
      ) : (
        <section className="pff-sec" aria-label="打印进度">
          <div className="pff-sec-h">
            <span className="t">打印进度</span>
            <span className="hint">{isSim ? '演示步骤，不是硬件回流' : '状态来自打印服务，每 3 秒更新'}</span>
          </div>
          <div className="pfp-card">
            {jobRow}
            <div className="pfp-steps" data-testid="print-fulfill-list" role="list" aria-label="打印进度">
              {TL_ITEMS.map((item, tlIdx) => {
                const cls = isSim && simDone && !failed ? 'tl-done' : tlItemClass(tlIdx, currentIdx, useRealApi)
                const isDone   = cls === 'tl-done'
                const isActive = cls === 'tl-active'
                const isFailedStep = failed && tlIdx === currentIdx
                return (
                  <div key={item.key} className={`pfp-step ${cls}`} data-failed={isFailedStep} role="listitem">
                    <span className="pfp-step-top">
                      <span className="pfp-step-dot">
                        {isFailedStep
                          ? <AlertCircleIcon aria-hidden="true" />
                          : isDone || (isSim && simDone)
                            ? <CheckIcon aria-hidden="true" />
                            : isActive
                              ? <CircleDotIcon aria-hidden="true" />
                              : <ClockIcon aria-hidden="true" />
                        }
                      </span>
                      <span className="pfp-step-st">
                        {isFailedStep
                          ? (isSim ? '演示失败' : '出错')
                          : isDone || (isSim && simDone)
                            ? (isSim ? '演示结束' : '完成')
                            : isActive
                              ? (useRealApi ? realStatus.activeHint : '演示中…')
                              : '未开始'}
                      </span>
                    </span>
                    <b>{item.label}</b>
                    <span className="pfp-step-d">{item.desc}</span>
                  </div>
                )
              })}
            </div>
            {useRealApi && statusReadError && !failed && (
              <div className="pff-inbar" data-tone="wheat" role="status">
                <div className="pff-inbar-h">
                  <span className="pff-inbar-ic"><AlertTriangleIcon aria-hidden="true" /></span>
                  <span>
                    {STATUS_READ_ERROR_TEXT}
                    <small>正在自动重试；读不到状态不代表打印失败</small>
                  </span>
                </div>
              </div>
            )}
            {failed && !isSim && (
              <div className="pff-inbar" data-tone="bad">
                <div className="pff-inbar-h">
                  <span className="pff-inbar-ic"><AlertCircleIcon aria-hidden="true" /></span>
                  <span>
                    打印遇到问题
                    <small>正在转到结果页，按服务端登记说明原因</small>
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {isSim && simDone && (
        <div className="pfp-sim-end">
          <p className="pfp-sim-end-t">未真实打印</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="qx-btn"
            data-variant="primary"
          >
            返回首页
          </button>
          <button
            type="button"
            onClick={() => navigate(uploadPath)}
            className="qx-btn"
            data-variant="ghost"
          >
            重新上传
          </button>
        </div>
      )}

      {!timedOut && !failed && (
        <div className="pff-out pfp-out">
          <div className="pff-out-stage" aria-hidden="true">
            <div className="pff-out-slot" />
            <div className="pff-out-paper" />
            <div className="pff-out-tray" />
          </div>
          <div className="pff-out-main">
            <div className="pff-out-status">
              {backendStatus === 'printing' ? (
                <span className="pff-pulse"><i /><i /><i />正在出纸</span>
              ) : (
                stageHeading
              )}
              {pageCount != null ? <span className="pages">共 {pageCount} 页</span> : null}
              {!isSim && (sheets != null ? <span className="pages">预计出纸 {sheets}</span> : null)}
            </div>
            <div className="pff-out-sub">
              {/* 出纸中时标题已经在说「正在出纸」，副文案只讲取纸位置（稿 .out-sub），不再复述阶段。 */}
              {isSim || backendStatus !== 'printing' ? <>{stageLine}。</> : null}
              {!isSim && (backendStatus === 'printing'
                ? <>纸从<b>打印机出纸口</b>出来，出来一张拿一张也行，全部打完一起拿也行。</>
                : <>开始出纸后，纸从<b>打印机出纸口</b>出来。</>)}
            </div>
            {!isSim && (
              <p className="pfp-out-note">请勿离开，打印完成后请及时取走文件，避免个人材料遗留在出纸口。页数来自文件信息，不逐页播报。</p>
            )}
          </div>
        </div>
      )}

      {/* 查询超时时 busy lock 已释放、空闲清场会照常计时，「打印期间不会清空」不再成立，
          求助也改由底部两枚按钮承接（稿 client-status-timeout 态同样没有这两节）。 */}
      {!isSim && (timedOut ? null : (
        <>
        <section className="pff-sec" aria-label="你的文件，走完就清">
          <div className="pff-sec-h"><span className="t">你的文件，走完就清</span></div>
          <div className="pff-wipe" data-live="false">
            <div>
              <div className="pff-wipe-t"><ShieldIcon aria-hidden="true" />打印期间不会清空</div>
              <p className="pff-wipe-s">全部打完、你拿走之后，才开始会话清空计时。倒计时不是催你走，你可以核对完再离开。</p>
            </div>
          </div>
        </section>

        <section className="pff-sec" aria-label="常见情况处理">
          <div className="pff-sec-h">
            <span className="t">遇到这些情况怎么办</span>
            <span className="hint">找现场工作人员最快</span>
          </div>
          <div className="pfp-card pfp-faq-card">
            <ul className="pfp-faq">
              <li><AlertTriangleIcon aria-hidden="true" /><p><b>打印机缺纸 / 卡纸</b>：别硬拉纸；设备上报后本页会转到结果页说明原因。</p></li>
              <li><ClockIcon aria-hidden="true" /><p><b>长时间无响应</b>：本机连续查 10 分钟仍无结果会提示，凭任务号找工作人员。</p></li>
              <li><FileTextIcon aria-hidden="true" /><p><b>文件校验未通过</b>：上传可能中断或文件已变化，需返回重新上传。</p></li>
              <li>
                <CreditCardIcon aria-hidden="true" />
                <p>
                  {isFreeOrder
                    ? <><b>打印失败</b>：本次未收款，任务记录已保存，工作人员可凭任务号核查。</>
                    : payment === 'paid'
                      ? <><b>已支付但打印失败</b>：订单与支付记录都在，退款以工作人员核查为准。</>
                      : <><b>打印失败</b>：订单记录已保存，费用以工作人员核查结果为准。</>
                  }
                </p>
              </li>
            </ul>
            <div className="pff-help" data-testid="print-fulfill-fallback">
              <span className="txt">卡纸、缺纸、没出全？<b>别硬拉纸</b>，找现场工作人员处理。</span>
              <button type="button" className="pff-help-btn" data-testid="print-fulfill-primary" onClick={() => navigate('/help')}>
                联系工作人员
              </button>
            </div>
          </div>
        </section>
        </>
      ))}

      {isSim && (
        <section className="qx-card pff-info" aria-label="演示说明">
          <b className="pff-info-hd">演示说明</b>
          <ul className="pfp-demo-list">
            <li>未创建真实打印任务</li>
            <li>未产生订单或费用</li>
            <li>未向打印机发送文件</li>
            <li>不会产生取件码</li>
          </ul>
        </section>
      )}

      <span className="pfp-live" role="status" aria-live="polite">
        {isSim ? (simDone ? '演示已结束' : '演示进行中') : timedOut ? '状态查询超时' : realStatus.badge}
      </span>

      {import.meta.env.DEV && canSimulate && !failed && (
        <button
          onClick={handleDevFail}
          type="button"
          className="qx-btn"
          data-variant="ghost"
        >
          [DEV] 模拟失败
        </button>
      )}
    </div>
    </QxPageFrame>
  )
}
