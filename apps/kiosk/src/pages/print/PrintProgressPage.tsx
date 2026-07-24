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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { KioskActionBar } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  InfoIcon,
  PrinterIcon,
  XCircleIcon,
} from 'lucide-react'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { API_MODE } from '../../services/api/client'
import { getPrintJobStatus, type BackendJobStatus } from '../../services/print/printJobsApi'
import type { PrintJobParams } from '@ai-job-print/shared'
import type { PrintFileState } from './printMaterialSession'
import { printUploadPathForSource } from './printMaterialSession'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'

// ── Display helpers ────────────────────────────────────────────────────────────

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

  // 任务信息展示字段
  const file   = (state?.file  as PrintFileState | undefined) ?? null
  const params = (state?.params as PrintJobParams | undefined) ?? null
  const orderNo = typeof state?.orderNo === 'string' ? state.orderNo
                : typeof state?.orderId === 'string' ? state.orderId
                : null
  // amountCents=0（免费单 / PAYMENT_PROVIDER=sandbox 默认路径）→ 不展示支付相关文案。
  const isFreeOrder = (typeof state?.amountCents === 'number' ? state.amountCents : 1) === 0

  const submitTimeFormatted = useMemo(() => formatSubmitTime(new Date()), [])

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

  // Timeout screen — Agent never responded within 10 minutes
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

  // ── 4步时间线定义 ──────────────────────────────────────────────────────────
  const TL_ITEMS = [
    {
      key: 'submit',
      label: '提交任务',
      desc: isFreeOrder ? '已创建打印任务，无需支付，正在排队' : '已创建打印任务并完成支付确认',
    },
    { key: 'queue',   label: '排队等待', desc: '终端已接收任务，文件校验通过' },
    { key: 'print',   label: '打印中',   desc: '打印机正在出纸，请在出纸口等候' },
    { key: 'pickup',  label: '完成取件', desc: '完成后自动跳转，凭取件码核对文件' },
  ] as const

  // ── 主体：两栏布局 ─────────────────────────────────────────────────────────
  return (
    <PrintPageFrame>
    <div data-w2-page="print-progress" className="flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="正在处理"
        subtitle="任务已提交，正在等待终端处理，请留在机器旁"
        step={7}
        aside={
          <span className="pp-running-badge" role="status" aria-live="polite">
            <ClockIcon aria-hidden="true" />
            任务进行中
          </span>
        }
      />

      {/* 主内容 */}
      <div className="pp-main-content">
        <div className="pp-split">

          {/* 左：状态时间线卡片 */}
          <div className="pp-left-col">
            <div className="pp-stage-card">
              {/* 大图标 */}
              <div className="pp-stage-icon" aria-hidden="true">
                {failed
                  ? <XCircleIcon />
                  : <PrinterIcon />
                }
              </div>
              <div className="pp-stage-title">
                {failed ? '处理出错' : '正在打印'}
              </div>
              <div className="pp-stage-sub">
                {failed
                  ? '任务遇到问题，即将跳转至结果页'
                  : '状态每秒自动刷新，完成后自动进入取件页'}
              </div>

              {/* 时间线 */}
              <div className="pp-tl" role="list" aria-label="打印进度">
                {TL_ITEMS.map((item, tlIdx) => {
                  const cls = tlItemClass(tlIdx, currentIdx, useRealApi)
                  const isDone   = cls === 'tl-done'
                  const isActive = cls === 'tl-active'
                  return (
                    <div key={item.key} className={`pp-tl-item ${cls}`} role="listitem">
                      <span className="pp-t-rail">
                        <span className="pp-t-dot">
                          {isDone
                            ? <CheckIcon />
                            : isActive
                              ? <CircleDotIcon />
                              : <ClockIcon />
                          }
                        </span>
                        <span className="pp-t-line" aria-hidden="true" />
                      </span>
                      <span className="pp-t-body">
                        <b>{item.label}</b>
                        <span>{item.desc}</span>
                        {isActive && !failed && (
                          <span className="animate-pulse" style={{ fontSize: 16, color: 'var(--print-teal-deep)', marginTop: 4, display: 'block' }}>
                            {useRealApi ? '等待终端响应…' : '处理中…'}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 右：任务信息 + 常见情况 + 提示 */}
          <div className="pp-side-col">
            {/* 任务信息 */}
            <section className="pp-info-card" aria-label="任务信息">
              <b className="pp-info-hd">任务信息</b>
              <div className="pp-i-row">
                <span className="pp-i-k">文件名</span>
                <span className="pp-i-v">{file?.name ?? '—'}</span>
              </div>
              <div className="pp-i-row">
                <span className="pp-i-k">打印参数</span>
                <span className="pp-i-v">{formatParams(params)}</span>
              </div>
              <div className="pp-i-row">
                <span className="pp-i-k">任务号</span>
                <span className="pp-i-v">{taskId ?? '—'}</span>
              </div>
              <div className="pp-i-row">
                <span className="pp-i-k">订单号</span>
                <span className="pp-i-v">{orderNo ?? '—'}</span>
              </div>
              <div className="pp-i-row">
                <span className="pp-i-k">提交时间</span>
                <span className="pp-i-v">{submitTimeFormatted}</span>
              </div>
              <div className="pp-i-row">
                <span className="pp-i-k">预计出纸</span>
                <span className="pp-i-v">{expectedSheets(file, params)}</span>
              </div>
            </section>

            {/* 常见情况 */}
            <section className="pp-faq-card" aria-label="常见情况处理">
              <b className="pp-faq-hd">遇到这些情况怎么办</b>
              <div className="pp-faq-item">
                <AlertTriangleIcon className="pp-faq-icon" aria-hidden="true" />
                <p className="pp-faq-text">
                  <b>打印机缺纸 / 卡纸</b>：任务会提示失败原因，请联系现场工作人员处理后重试。
                </p>
              </div>
              <div className="pp-faq-item">
                <ClockIcon className="pp-faq-icon" aria-hidden="true" />
                <p className="pp-faq-text">
                  <b>长时间无响应</b>：超过 10 分钟未响应将提示处理超时，凭任务号联系工作人员确认。
                </p>
              </div>
              <div className="pp-faq-item">
                <FileTextIcon className="pp-faq-icon" aria-hidden="true" />
                <p className="pp-faq-text">
                  <b>文件校验未通过</b>：上传可能中断或文件已变化，请返回重新上传后再打印。
                </p>
              </div>
              <div className="pp-faq-item">
                <CreditCardIcon className="pp-faq-icon" aria-hidden="true" />
                <p className="pp-faq-text">
                  {isFreeOrder
                    ? <><b>打印失败</b>：任务记录已保存，可在「我的 · 打印订单」查看详情并联系工作人员确认。</>
                    : <><b>已支付但打印失败</b>：订单与支付记录已保存，可在「我的 · 打印订单」查看并联系退款。</>
                  }
                </p>
              </div>
            </section>

            {/* 提示条 */}
            <div className="pp-notice" role="note">
              <InfoIcon className="pp-notice-icon" aria-hidden="true" />
              请勿离开，打印完成后请及时取走文件，避免个人材料遗留在出纸口。
            </div>
          </div>
        </div>
      </div>

      {/* 底部行动条 */}
      <KioskActionBar className="pp-actionbar">
        <span className="pp-actionbar-note">
          打印中无法取消任务；如遇卡纸或缺纸，请联系现场工作人员协助处理
        </span>
        <span className="pp-status-chip" role="status" aria-live="polite">
          <i aria-hidden="true" />
          状态自动刷新中
        </span>
      </KioskActionBar>

      {/* DEV 专用：模拟失败按钮 */}
      {import.meta.env.DEV && canSimulate && !failed && (
        <button
          onClick={handleDevFail}
          style={{ position: 'fixed', bottom: 100, right: 16, zIndex: 50 }}
          className="rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-xs text-error-fg hover:bg-error/20"
        >
          [DEV] 模拟失败
        </button>
      )}

      {/* DEV 专用：任务 ID */}
      {import.meta.env.DEV && useRealApi && taskId && (
        <div style={{ position: 'fixed', bottom: 60, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
          <p className="text-xs text-neutral-400">taskId: {taskId}</p>
        </div>
      )}
    </div>
    </PrintPageFrame>
  )
}
