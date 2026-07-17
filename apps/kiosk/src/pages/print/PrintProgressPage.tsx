// ============================================================
// PrintProgressPage — W6
//
// Two modes:
//   REAL  — state.taskId is set (API_MODE=http, real job submitted)
//           Polls GET /api/v1/print/jobs/:taskId every 3s.
//           Maps backend status → UI steps.
//   SIM   — no taskId (mock mode or virtual file from W5 enterprise flow)
//           Same setTimeout-based animation as before.
//
// Status mapping (backend → UI step index):
//   pending  / claimed  → step 1 "排队等待"  (step 0 "提交任务" already done)
//   printing            → step 2 "打印中"
//   completed           → navigate to /print/done (success)
//   failed              → navigate to /print/done (failure)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  PrinterIcon,
  XCircleIcon,
} from 'lucide-react'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { API_MODE } from '../../services/api/client'
import { getPrintJobStatus, type BackendJobStatus } from '../../services/print/printJobsApi'
import { printUploadPathForSource } from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// 后端/Agent errorCode → 清晰中文提示。优先按错误码给出可操作文案，
// 再回退到后端 errorMessage，最后回退到默认。
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
const REAL_POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes — guard against Agent never claiming without false timeout

const stepIndex = (key: Step) => STEPS.findIndex((s) => s.key === key)

// ── Status → UI step mapping ──────────────────────────────────────────────────

function backendStatusToStep(status: BackendJobStatus): Step {
  if (status === 'printing') return 'printing'
  return 'queuing'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrintProgressPage() {
  // 打印进行中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(true)

  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null
  const source = state?.source === 'resume' || state?.source === 'document' ? state.source : undefined
  const uploadPath = printUploadPathForSource(source)

  const taskId     = typeof state?.taskId === 'string' ? state.taskId : null
  const isHttpMode = API_MODE === 'http'
  const useRealApi = isHttpMode && Boolean(taskId)

  // 直达守卫：合法流程必带 taskId（真实任务）或 file（mock/上传流程）上下文。
  // 二者皆无 = 用户直接打开 /print/progress，禁止跑模拟动画并伪造"打印成功"。
  const hasFileContext = Boolean((state as { file?: unknown } | null)?.file)
  const hasContext = Boolean(taskId) || hasFileContext
  const canSimulate = !isHttpMode && hasFileContext

  // simulateFailure — dev/mock only
  const shouldFail = canSimulate && state?.simulateFailure === true
  const failReason = typeof state?.failReason === 'string' ? state.failReason : FAIL_REASONS[0]

  const [current, setCurrent]   = useState<Step>(useRealApi ? 'queuing' : 'submitting')
  const [failed, setFailed]     = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const cancelRef               = useRef(false)

  // ── Navigation helpers ────────────────────────────────────────────────────

  const navigateFail = useCallback(
    (reason: string) => {
      setFailed(true)
      setTimeout(() => {
        navigate('/print/done', { state: { ...state, success: false, reason } })
      }, 700)
    },
    [navigate, state],
  )

  const navigateSuccess = useCallback(() => {
    navigate('/print/done', { state: { ...state, success: true } })
  }, [navigate, state])

  // ── DEV helper (sim only) ─────────────────────────────────────────────────

  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[0])
  }, [navigateFail])

  // ── REAL mode: poll backend ───────────────────────────────────────────────

  useEffect(() => {
    if (!useRealApi || !taskId) return

    cancelRef.current = false

    // Step 0 is already "done" — we submitted before landing here.
    // Start showing step 1 immediately.
    setCurrent('queuing')

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
          // 失败原因优先用后端下发的安全文案 failureReasonForUser；
          // 再回退到本地 errorCode 映射；最后默认文案。
          // 不再回退到 result.errorMessage —— 该字段可能承载 Agent 原始排障细节，
          // 前台一律不直接透出（后端亦已收口，此处再做一层防御）。
          navigateFail(
            result.failureReasonForUser ?? errorCodeToMessage(result.errorCode) ?? FAIL_REASONS[0],
          )
          return
        }
        // pending | claimed | printing — update step
        setCurrent(backendStatusToStep(result.status))
      } catch {
        if (cancelRef.current) return
        navigateFail('无法连接打印服务，请联系工作人员')
      }
    }

    // Poll immediately, then on interval
    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)

    // 5-minute hard timeout — if Agent never claims or backend is unresponsive
    const timeoutTimer = setTimeout(() => {
      if (cancelRef.current) return
      cancelRef.current = true
      clearInterval(timer)
      setTimedOut(true)
    }, REAL_POLL_TIMEOUT_MS)

    return () => {
      cancelRef.current = true
      clearInterval(timer)
      clearTimeout(timeoutTimer)
    }
  }, [useRealApi, taskId, navigateFail, navigateSuccess])

  // ── SIM mode: setTimeout animation ───────────────────────────────────────

  useEffect(() => {
    if (useRealApi || !canSimulate) return

    cancelRef.current = false

    const advance = (idx: number) => {
      if (idx >= STEPS.length) {
        if (!cancelRef.current) navigateSuccess()
        return
      }
      const step = STEPS[idx]
      const duration = shouldFail && step.key === 'printing' ? 1200 : step.duration

      setTimeout(() => {
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
    return () => { cancelRef.current = true }
  }, [useRealApi, canSimulate, navigateFail, navigateSuccess, shouldFail, failReason])

  // ── Render ────────────────────────────────────────────────────────────────

  const currentIdx = stepIndex(current)

  // Guard：直达 /print/progress（无任务上下文）—— 不展示进度/不伪造成功，引导重新上传。
  if (!hasContext) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircleIcon className="h-10 w-10 text-warning" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-neutral-900">未找到打印任务</p>
          <p className="mt-2 text-sm text-neutral-500">请从上传文件重新开始打印流程</p>
        </div>
        <button
          onClick={() => navigate(uploadPath)}
          className="rounded-xl bg-primary-600 px-8 py-4 text-base font-semibold text-white hover:bg-primary-700 min-h-[56px]"
        >
          重新上传文件
        </button>
      </div>
    )
  }

  // 生产 / http 模式必须依赖真实后端任务。即使存在 file 上下文，
  // 没有 taskId 也不能回退到 SIM 动画并展示成功。
  if (isHttpMode && !taskId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircleIcon className="h-10 w-10 text-warning" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-neutral-900">打印任务尚未创建</p>
          <p className="mt-2 text-sm text-neutral-500">请返回确认页重试</p>
        </div>
        <button
          onClick={() => navigate('/print/confirm', { state })}
          className="rounded-xl bg-primary-600 px-8 py-4 text-base font-semibold text-white hover:bg-primary-700 min-h-[56px]"
        >
          返回确认页
        </button>
      </div>
    )
  }

  // Timeout screen — Agent never responded within 5 minutes
  if (timedOut) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-warning-bg">
          <ClockIcon className="h-12 w-12 text-warning" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">处理超时</h1>
          <p className="mt-3 text-base text-neutral-500 max-w-xs">
            打印终端长时间未响应，任务可能仍在队列中。
            <br />
            请联系工作人员确认打印机状态。
          </p>
          {taskId && (
            <p className="mt-3 text-xs text-neutral-400">任务编号：{taskId}</p>
          )}
        </div>
        <button
          onClick={() => navigate('/')}
          className="rounded-xl bg-primary-600 px-8 py-4 text-base font-semibold text-white hover:bg-primary-700 min-h-[56px]"
        >
          返回首页
        </button>
      </div>
    )
  }

  return (
    <div className="print-proto flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="正在打印"
        subtitle="任务已提交，正在等待终端处理"
        step={7}
        backLabel="返回首页"
        onBack={() => navigate('/')}
      />
      <main className="relative flex flex-1 flex-col items-center justify-center p-8">
      {/* 状态图标 */}
      <div
        className={[
          'mb-10 flex h-24 w-24 items-center justify-center rounded-full',
          failed ? 'bg-error-bg' : 'bg-primary-50',
        ].join(' ')}
      >
        {failed ? (
          <XCircleIcon className="h-12 w-12 text-error-fg" />
        ) : (
          <PrinterIcon className="h-12 w-12 text-primary-600" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-neutral-900">
        {failed ? '处理出错' : '正在处理'}
      </h1>
      <p className="mt-2 text-base text-neutral-500">
        {failed
          ? '任务遇到问题，即将跳转…'
          : useRealApi
          ? '任务已提交，正在等待终端处理…'
          : '请勿离开，任务处理中…'}
      </p>
      <div className="mt-4 flex min-h-[48px] items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 text-sm font-medium text-primary-700">
        <span className="h-2.5 w-2.5 rounded-full bg-primary-600" aria-hidden="true" />
        Terminal Agent：{useRealApi ? '正在接收打印状态' : '演示模式'}
      </div>

      {/* 步骤列表 */}
      <div className="mt-12 w-full max-w-sm space-y-4">
        {STEPS.map((step, idx) => {
          // In real mode, step 0 ("提交任务") is always done on arrival.
          const done   = useRealApi ? (idx === 0 || idx < currentIdx) : idx < currentIdx
          const active = useRealApi ? (idx === currentIdx && idx > 0) : idx === currentIdx
          const isFailed = failed && active

          return (
            <div key={step.key} className="flex items-center gap-4">
              <div
                className={[
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isFailed
                    ? 'border-error-fg bg-error text-white'
                    : done
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : active
                    ? 'border-primary-600 bg-white text-primary-600'
                    : 'border-neutral-200 bg-white text-neutral-300',
                ].join(' ')}
              >
                {isFailed ? (
                  <AlertCircleIcon className="h-5 w-5" />
                ) : done ? (
                  <CheckIcon className="h-5 w-5" />
                ) : active ? (
                  <CircleDotIcon className="h-5 w-5" />
                ) : (
                  <ClockIcon className="h-5 w-5" />
                )}
              </div>

              <div className="flex-1">
                <p
                  className={[
                    'text-base font-medium',
                    isFailed
                      ? 'text-error-fg'
                      : done || active
                      ? 'text-neutral-900'
                      : 'text-neutral-400',
                  ].join(' ')}
                >
                  {step.label}
                </p>
                {active && !failed && (
                  <p className="mt-0.5 animate-pulse text-sm text-primary-600">
                    {useRealApi ? '等待终端响应…' : '处理中…'}
                  </p>
                )}
                {isFailed && (
                  <p className="mt-0.5 text-sm text-error-fg">任务中断</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* DEV 专用：模拟失败按钮（sim 模式 + 生产构建自动移除） */}
      {import.meta.env.DEV && canSimulate && !failed && (
        <div className="absolute bottom-24 right-6">
          <button
            onClick={handleDevFail}
            className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-xs text-error-fg hover:bg-error/20"
          >
            [DEV] 模拟失败
          </button>
        </div>
      )}

      {/* DEV 专用：显示当前任务 ID（real 模式） */}
      {import.meta.env.DEV && useRealApi && taskId && (
        <div className="absolute bottom-6 left-0 right-0 text-center">
          <p className="text-xs text-neutral-400">taskId: {taskId}</p>
        </div>
      )}
      </main>
    </div>
  )
}
