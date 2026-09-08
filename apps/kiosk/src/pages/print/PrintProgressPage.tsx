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
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  InfoIcon,
  ShieldIcon,
} from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { API_MODE } from '../../services/api/client'
import { getPrintJobStatus, type BackendJobStatus } from '../../services/print/printJobsApi'
import { wakeLocalPrintQueue } from '../../services/print/localPrintWakeApi'
import type { PrintJobParams } from '@ai-job-print/shared'
import type { PrintFileState } from './printMaterialSession'
import { printUploadPathForSource } from './printMaterialSession'
import { formatCents } from './cashierStatus'
import './styles/print-fulfill-qx.css'

const DUPLEX_LABELS: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面(长边)',
  duplex_short_edge: '双面(短边)',
}

function formatParams(params: Partial<PrintJobParams> | null | undefined): string {
  if (!params) return '—'
  const color = params.colorMode === 'color' ? '彩色' : '黑白'
  const duplex = DUPLEX_LABELS[params.duplex ?? ''] ?? '单面'
  const copies = params.copies ? `${params.copies} 份` : ''
  return [color, duplex, copies].filter(Boolean).join(' · ')
}

function expectedSheets(file: Pick<PrintFileState, 'pages'> | null, params: Partial<PrintJobParams> | null | undefined): string {
  if (!file || file.pages == null || !params) return '待识别'
  const pps = params.pagesPerSheet ?? 1
  const copies = params.copies ?? 1
  const facesPerCopy = Math.ceil(file.pages / pps)
  const isDouble = params.duplex !== 'simplex'
  const sheetsPerCopy = isDouble ? Math.ceil(facesPerCopy / 2) : facesPerCopy
  const totalFaces = facesPerCopy * copies
  const totalSheets = sheetsPerCopy * copies
  return `${totalSheets} 张（${totalFaces} 面）`
}

function formatSubmitTime(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** 返回 tl-done | tl-active | '' */
function tlItemClass(tlIdx: number, currentIdx: number, isRealApi: boolean): string {
  // 0 = 提交任务, 1 = 排队等待, 2 = 打印中, 3 = 完成取件(永远pending)
  if (tlIdx === 3) return ''
  if (tlIdx === 0) {
    return isRealApi || currentIdx > 0 ? 'tl-done' : 'tl-active'
  }
  if (tlIdx < currentIdx) return 'tl-done'
  if (tlIdx === currentIdx) return 'tl-active'
  return ''
}

type Step = 'submitting' | 'queuing' | 'printing'

const STEPS: { key: Step; label: string; duration: number }[] = [
  { key: 'submitting', label: '提交任务', duration: 1200 },
  { key: 'queuing',    label: '排队等待', duration: 1000 },
  { key: 'printing',   label: '打印中',   duration: 2500 },
]

const FAIL_REASONS = [
  '打印机离线，请联系工作人员或稍后重试',
  '打印机缺纸，请联系工作人员补纸',
  '任务处理超时，请稍后重试',
  '文件解析失败，请重新上传文件',
]

const ERROR_CODE_MESSAGES: Record<string, string> = {
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过（上传可能中断或文件已变化），请返回重新上传后再打印',
  PRINTER_NOT_FOUND: '未找到打印机，请联系工作人员检查打印机连接',
  PRINTER_OFFLINE: '打印机离线，请联系工作人员检查电源 / 网线 / USB 后重试',
  PAPER_EMPTY: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试',
  PRINTER_ERROR: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理',
  PRINT_JOB_UNCONFIRMED: '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态',
  PRINT_TIMEOUT: '打印超时，请稍后重试',
  PRINT_COMMAND_FAILED: '打印执行失败，请稍后重试或联系工作人员',
  UNSUPPORTED_FILE_TYPE: '该文件格式暂不支持打印，请上传 PDF 或 JPG / PNG',
  FILE_NOT_FOUND: '打印文件已失效，请返回重新上传',
}

function errorCodeToMessage(code?: string): string | undefined {
  return code ? ERROR_CODE_MESSAGES[code] : undefined
}

const POLL_INTERVAL_MS = 3000
const POLL_FAIL_LIMIT = 5
const REAL_POLL_TIMEOUT_MS = 10 * 60 * 1000
const STATUS_READ_ERROR_TEXT = '暂时无法读取状态'

const stepIndex = (key: Step) => STEPS.findIndex((s) => s.key === key)

function backendStatusToStep(status: BackendJobStatus): Step {
  if (status === 'printing') return 'printing'
  return 'queuing'
}

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
        actionNote: '任务尚未被终端领取；如长时间无响应，请联系现场工作人员',
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
        actionNote: '终端正在准备打印；如遇卡纸或缺纸，请联系现场工作人员',
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
        actionNote: '打印中无法取消任务；如遇卡纸或缺纸，请联系现场工作人员',
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
        actionNote: '正在确认任务状态；如长时间无响应，请联系现场工作人员',
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

    cancelRef.current = false
    setCurrent('queuing')

    if (wakeRequestedTaskIdRef.current !== taskId) {
      wakeRequestedTaskIdRef.current = taskId
      void wakeLocalPrintQueue()
    }

    const tick = async () => {
      if (cancelRef.current) return
      try {
        const result = await getPrintJobStatus(taskId)
        if (cancelRef.current) return

        if (result.status === 'completed') {
          navigateSuccess()
          return
        }
        if (result.status === 'failed') {
          navigateFail(
            result.failureReasonForUser ?? errorCodeToMessage(result.errorCode) ?? FAIL_REASONS[0],
          )
          return
        }
        if (result.status === 'cancelled' || result.status === 'abandoned') {
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
        if (cancelRef.current) return
        pollFailsRef.current += 1
        setStatusReadError(true)
        if (pollFailsRef.current >= POLL_FAIL_LIMIT) {
          navigateFail(`${STATUS_READ_ERROR_TEXT}，请联系工作人员`)
        }
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    const onTimeout = () => {
      if (cancelRef.current) return
      if (backendStatusRef.current === 'printing') { timeoutTimer = setTimeout(onTimeout, REAL_POLL_TIMEOUT_MS); return }
      setTimedOut(true)
    }
    timeoutTimer = setTimeout(onTimeout, REAL_POLL_TIMEOUT_MS)

    return () => {
      cancelRef.current = true
      clearInterval(timer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }, [useRealApi, taskId, navigateFail, navigateSuccess])

  const currentIdx = stepIndex(current)
  const realStatus = realStatusPresentation(backendStatus)

  const file   = (state?.file  as PrintFileState | undefined) ?? null
  const params = (state?.params as PrintJobParams | undefined) ?? null
  const orderNo = typeof state?.orderNo === 'string' ? state.orderNo
                : typeof state?.orderId === 'string' ? state.orderId
                : null
  const amountCents = typeof state?.amountCents === 'number' ? state.amountCents : null
  const isFreeOrder = (typeof state?.amountCents === 'number' ? state.amountCents : 1) === 0
  const submitTimeFormatted = useMemo(() => formatSubmitTime(new Date()), [])
  const pageCount = file?.pages ?? null

  const navbar = (
    <QxAppNavbar
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )

  const pillLabel = isSim
    ? (simDone ? '演示已结束' : '演示进行中')
    : isFreeOrder
      ? '本次未收款 · 系统报价 0 元'
      : amountCents != null
        ? `已付 ${formatCents(amountCents)} · 只收纸张费`
        : realStatus.badge

  const frameStatus = !hasContext || (isHttpMode && !taskId)
    ? { tone: 'unknown' as const, label: '状态未知' }
    : timedOut
      ? { tone: 'warn' as const, label: pillLabel }
      : failed
        ? { tone: 'bad' as const, label: isSim ? '演示失败' : '处理出错' }
        : backendStatus == null && useRealApi
          ? { tone: 'unknown' as const, label: '状态未知' }
          : { tone: 'ok' as const, label: pillLabel }

  if (!hasContext || (!isHttpMode && !canSimulate)) {
    return (
      <QxPageFrame
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

  if (timedOut) {
    return (
      <QxPageFrame
        title="暂时查不到打印结果"
        subtitle="这不代表成功或失败，只是本机暂时没拿到最新状态"
        status={{ tone: 'warn', label: amountCents != null ? `已付 ${formatCents(amountCents)} · 状态查询中` : '状态查询中' }}
        terminalLabel="就业服务大厅"
        ctabar={
          <>
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              data-testid="print-fulfill-primary"
              onClick={() => setTimedOut(false)}
            >
              重新查询状态
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/help')}>
              联系工作人员
            </button>
          </>
        }
        navbar={navbar}
      >
        <div
          data-w2-page="print-progress" data-print-flow-step={6}
          data-testid="print-fulfill-state-client-status-timeout"
          className="qx-scroll pff-page"
        >
          <section className="pff-xq">
            <div className="pff-xq-row">
              <div className="pff-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
                <p className="pff-xq-ask">暂时<em>查不到</em>打印结果。</p>
                <p className="pff-xq-doing">这不代表成功或失败，只是本机暂时没拿到最新状态。</p>
              </div>
            </div>
          </section>
          <div className="pff-issue" data-tone="wheat" data-testid="print-fulfill-fallback">
            <div className="pff-issue-head">
              <span className="pff-issue-ic"><AlertTriangleIcon aria-hidden="true" /></span>
              <div className="pff-issue-t">
                状态暂未确认，请联系工作人员
                <small>本机连续查询 10 分钟没有拿到最终结果</small>
              </div>
            </div>
            <p className="pff-issue-body">
              这只是<b>查询超时</b>：服务端的打印任务状态<b>没有被改变</b>，我们不会猜它成功或失败。
              可以先重新查询，或直接找工作人员现场确认。
              {taskId ? ` 任务编号 ${taskId}。` : null}
            </p>
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
        : isFreeOrder
          ? '已创建打印任务，无需支付，正在排队'
          : '已创建打印任务并完成支付确认',
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
        : '打印机正在出纸，请在出纸口等候',
    },
    {
      key: 'pickup',
      label: isSim ? '演示结束' : '完成取件',
      desc: isSim
        ? '演示：无真实取件结果'
        : '完成后自动跳转，凭取件码核对文件',
    },
  ] as const

  const stageHeading = isSim
    ? (simDone ? '演示流程已结束' : '流程演示中')
    : realStatus.stageTitle
  const stageLine = isSim
    ? (simDone ? '未真实打印，可返回首页或重新上传' : '仅演示进度步骤，未建单、未支付、未出纸')
    : realStatus.stageSubtitle

  const askTitle = isSim
    ? (simDone ? <>演示流程已结束，<em>未真实打印</em>。</> : <>流程演示中，<em>不会出纸</em>。</>)
    : failed
      ? <>处理出错，<em>即将核对结果</em>。</>
      : backendStatus === 'printing'
        ? (isFreeOrder ? <>订单已建立，<em>正在出纸</em>。</> : <>支付成功，<em>正在出纸</em>。</>)
        : <>{realStatus.headerTitle}，<em>请留在机器旁</em>。</>

  // 小青这句必须和顶栏 subtitle 说不同的事：顶栏报状态，小青报「在印什么、你该干嘛」。
  // 稿 15 原文是「两份文件依次打印。你可以先在旁边等，不用贴着机器。」
  // 拿不到真实份数时只给等待指引，不编数字（§9 不伪造）。
  const copiesText = params?.copies && params.copies > 1 ? `${params.copies} 份文件依次打印。` : ''
  const askDoing = isSim
    ? (simDone ? '未真实打印，未创建打印任务' : '当前为演示模式，不会建单、支付或出纸')
    : failed
      ? (isSim ? '仅模拟异常处理，未创建任务、未扣费、未发送打印' : '任务遇到问题，即将跳转至结果页')
      : `${copiesText}你可以先在旁边等，不用贴着机器。`

  return (
    <QxPageFrame
      title={isSim ? (simDone ? '演示流程已结束' : '流程演示中') : realStatus.headerTitle}
      subtitle={
        isSim
          ? (simDone
            ? '未真实打印，未创建打印任务'
            : '当前为演示模式，不会建单、支付或出纸')
          : realStatus.headerSubtitle
      }
      status={frameStatus}
      terminalLabel="就业服务大厅"
      ctabar={
        isSim ? (
          <span className="why">
            {simDone ? '演示流程已结束 · 未真实打印' : '演示模式·非真实打印；动画结束后停留本页'}
          </span>
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
            <button type="button" className="qx-btn" data-variant="danger" disabled aria-disabled="true">
              还在打印，完成后才能结束清空
            </button>
          </>
        )
      }
      navbar={navbar}
    >
    <div
      data-w2-page="print-progress" data-print-flow-step={6}
      data-testid={failed ? 'print-fulfill-state-failed' : 'print-fulfill-state-printing'}
      className="qx-scroll pff-page"
    >
      <section className="pff-xq">
        <div className="pff-xq-row">
          <div className="pff-xq-face" aria-hidden="true">青</div>
          <div>
            <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
            <p className="pff-xq-ask">{askTitle}</p>
            <p className="pff-xq-doing">{askDoing}</p>
          </div>
        </div>
      </section>

      {isSim ? (
        <span className="pp-running-badge pff-sim-banner" role="note">
          <InfoIcon aria-hidden="true" />
          演示模式·非真实打印
        </span>
      ) : (
        <span className="pp-running-badge" role="status" aria-live="polite">
          <ClockIcon aria-hidden="true" />
          任务进行中
        </span>
      )}

      {isSim && (
        <div className="pff-sim-banner" role="note">
          演示模式·非真实打印
        </div>
      )}

      {useRealApi && statusReadError && !failed && (
        <div className="pff-sim-banner" role="status">
          {STATUS_READ_ERROR_TEXT}
        </div>
      )}

      <div className="pff-sec">
        <div className="pff-sec-h">
          <span className="t">打印进度</span>
          <span className="hint">{isSim ? '演示步骤，不是硬件回流' : '状态来自打印服务，每 3 秒更新'}</span>
        </div>
        <div className="pff-jobs" data-testid="print-fulfill-list" role="list" aria-label="打印进度">
          {TL_ITEMS.map((item, tlIdx) => {
            const cls = isSim && simDone && !failed ? 'tl-done' : tlItemClass(tlIdx, currentIdx, useRealApi)
            const isDone   = cls === 'tl-done'
            const isActive = cls === 'tl-active'
            return (
              <div key={item.key} className={`pff-job pp-tl-item ${cls}`} role="listitem">
                <span className="pff-t-rail">
                  <span className="pff-t-dot">
                    {isDone || (isSim && simDone)
                      ? <CheckIcon aria-hidden="true" />
                      : isActive
                        ? <CircleDotIcon aria-hidden="true" />
                        : <ClockIcon aria-hidden="true" />
                    }
                  </span>
                  <span className="pff-t-line" aria-hidden="true" />
                </span>
                <span className="pff-t-body">
                  <b>{item.label}</b>
                  <span>{item.desc}</span>
                  {isActive && !failed && (
                    <span className="animate-pulse" style={{ fontSize: 16, color: 'var(--qx-teal-d)', marginTop: 4, display: 'block' }}>
                      {useRealApi ? realStatus.activeHint : '演示中…'}
                    </span>
                  )}
                </span>
                <span className="pff-job-state">
                  {failed && tlIdx === currentIdx
                    ? (isSim ? '演示失败' : '出错')
                    : isDone || (isSim && simDone)
                      ? (isSim ? '演示结束' : '完成')
                      : isActive
                        ? (isSim ? '演示中' : realStatus.badge)
                        : '排队中'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {isSim && simDone && (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-center text-base font-semibold">未真实打印</p>
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

      {!isSim && (
        <div className="pff-out">
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
            </div>
            <div className="pff-out-sub">
              {stageLine} 纸从<b>屏幕正下方出纸口</b>出来。页数只在服务端文件信息存在时展示，不逐页播报。
            </div>
          </div>
        </div>
      )}

      {isSim && (
        <section className="qx-card pff-info" aria-label="演示说明">
          <b className="pff-info-hd">演示说明</b>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>未创建真实打印任务</li>
            <li>未产生订单或费用</li>
            <li>未向打印机发送文件</li>
            <li>不会产生取件码</li>
          </ul>
        </section>
      )}

      <section className="qx-card pff-info" aria-label="任务信息">
        <b className="pff-info-hd">任务信息</b>
        <div className="pff-i-row">
          <span className="pff-i-k">文件名</span>
          <span className="pff-i-v">{file?.name ?? '—'}</span>
        </div>
        <div className="pff-i-row">
          <span className="pff-i-k">打印参数</span>
          <span className="pff-i-v">{formatParams(params)}</span>
        </div>
        <div className="pff-i-row">
          <span className="pff-i-k">任务号</span>
          <span className="pff-i-v">{taskId ?? '—'}</span>
        </div>
        <div className="pff-i-row">
          <span className="pff-i-k">订单号</span>
          <span className="pff-i-v">{orderNo ?? '—'}</span>
        </div>
        <div className="pff-i-row">
          <span className="pff-i-k">提交时间</span>
          <span className="pff-i-v">{submitTimeFormatted}</span>
        </div>
        {!isSim && (
          <div className="pff-i-row">
            <span className="pff-i-k">预计出纸</span>
            <span className="pff-i-v">{expectedSheets(file, params)}</span>
          </div>
        )}
      </section>

      {!isSim && (
        <section className="qx-card pff-info" aria-label="常见情况处理">
          <b className="pff-info-hd">遇到这些情况怎么办</b>
          <div className="pff-faq">
            <div className="pff-faq-item">
              <AlertTriangleIcon aria-hidden="true" />
              <p><b>打印机缺纸 / 卡纸</b>：任务会提示失败原因，请联系现场工作人员处理后重试。</p>
            </div>
            <div className="pff-faq-item">
              <ClockIcon aria-hidden="true" />
              <p><b>长时间无响应</b>：超过 10 分钟未响应将提示处理超时，凭任务号联系工作人员确认。</p>
            </div>
            <div className="pff-faq-item">
              <FileTextIcon aria-hidden="true" />
              <p><b>文件校验未通过</b>：上传可能中断或文件已变化，请返回重新上传后再打印。</p>
            </div>
            <div className="pff-faq-item">
              <CreditCardIcon aria-hidden="true" />
              <p>
                {isFreeOrder
                  ? <><b>打印失败</b>：任务记录已保存，可在「我的 · 打印订单」查看详情并联系工作人员确认。</>
                  : <><b>已支付但打印失败</b>：订单与支付记录已保存，可在「我的 · 打印订单」查看并联系退款。</>
                }
              </p>
            </div>
          </div>
        </section>
      )}

      {!isSim && (
        <div className="pff-wipe" data-live="false">
          <div>
            <div className="pff-wipe-t"><ShieldIcon aria-hidden="true" />打印期间不会清空</div>
            <p className="pff-wipe-s">全部打完、你拿走之后，才开始会话清空计时。倒计时不是催你走，你可以核对完再离开。</p>
          </div>
        </div>
      )}

      {!isSim && (
        <div className="pff-help" data-testid="print-fulfill-fallback">
          <span className="txt">卡纸、缺纸、没出全？<b>别硬拉纸</b>，找现场工作人员处理。</span>
          <button type="button" className="pff-help-btn" data-testid="print-fulfill-primary" onClick={() => navigate('/help')}>
            联系工作人员
          </button>
        </div>
      )}

      {!isSim && (
        <div className="pp-notice" role="note">
          <InfoIcon className="pp-notice-icon" aria-hidden="true" />
          请勿离开，打印完成后请及时取走文件，避免个人材料遗留在出纸口。
        </div>
      )}

      <span className="pp-status-chip" role="status" aria-live="polite">
        {isSim ? (simDone ? '演示已结束' : '演示进行中') : realStatus.badge}
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
