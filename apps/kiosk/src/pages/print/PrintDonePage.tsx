import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AlertCircleIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { getPayStatus } from '../../services/print/paymentApi'
import { getPrintJobStatus } from '../../services/print/printJobsApi'
import { KioskFeedbackDialog } from '../../components/KioskFeedbackDialog'
import { PRINT_DONE_ISSUE_OPTIONS } from '../../services/api/kioskFeedback'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'

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
  paymentSessionToken?: string
  source?:              PrintMaterialSource
}

type PrintResultState = 'loading' | 'completed' | 'failed' | 'unknown'

interface PrintVerification {
  taskId: string
  result: Exclude<PrintResultState, 'loading'>
  failureReason?: string
  errorCode?: string
}

/**
 * Agent 在派发已开始、但重启后无法确认纸到底出没出时上报的码
 * （`terminal-agent/src/agent/task-runner.ts`）。整条链路对它的口径都是「**无法确认**」：
 * 服务端在任何写入之前拒绝重排以防重复出纸（`PRINT_SCAN_RETRY_UNCONFIRMED_FORBIDDEN`），
 * Admin 也只引导人工核查后决定退款。
 *
 * 唯独本页此前把它和普通失败混在一起，标题写「打印失败」、副标题写
 * 「打印任务已由服务端确认失败」—— 服务端恰恰没有确认任何事。这句话两个方向都会害人：
 * 纸真出来了，用户以为失败去要退款；纸没出来，他也拿不到「系统承认不确定、请找人核查」
 * 这个说法。属 CLAUDE.md §9「不得展示未经证实的结论」。
 */
const PRINT_JOB_UNCONFIRMED = 'PRINT_JOB_UNCONFIRMED'

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

export function PrintDonePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as PrintJobState

  const { file, params } = state
  const taskId = typeof state.taskId === 'string' && state.taskId.trim() ? state.taskId.trim() : null
  const uploadPath = printUploadPathForSource(state.source)

  // 反馈入口走匿名端点 POST /kiosk/feedback，不再跳 /me/feedback。
  // 旧实现跳会员面，而会员面必须登录：刚打印失败的人绝大多数没登录，
  // 按钮对他们是死的。仍以 taskId 为前提 —— 没有任务上下文就没有可核实的打印记录。
  const canReportIssue = taskId !== null
  const [feedbackOpen, setFeedbackOpen] = useState(false)

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

  // C5-3：paid 后展示取件凭证码。取件码可见性完全由后端 pickupCodeVisibleFor 决定
  // （paid + 未退款 + 任务未进终态），前端只透传后端返回值，不自行编造。
  const [pickupLookup, setPickupLookup] = useState<PickupLookup | null>(null)
  const pickupCode = state.orderId && pickupLookup?.orderId === state.orderId ? pickupLookup.code : null
  const pickupCodeError = state.orderId && pickupLookup?.orderId === state.orderId ? pickupLookup.error : null

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
          setVerification({ taskId, result: 'completed' })
          return
        }
        if (result.status === 'failed') {
          setVerification({
            taskId,
            result: 'failed',
            failureReason: result.failureReasonForUser ?? '打印任务未能完成，请联系现场工作人员',
            errorCode: result.errorCode,
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

  // 三个结果分支各自 return，共用同一个弹层实例定义。
  // 满意度只在确认完成时收：打印失败还要用户打分是打扰，且评分对故障定位没有帮助。
  const feedbackDialog = canReportIssue ? (
    <KioskFeedbackDialog
      open={feedbackOpen}
      onClose={() => setFeedbackOpen(false)}
      issueOptions={PRINT_DONE_ISSUE_OPTIONS}
      relatedPrintTaskId={taskId}
      showSatisfaction={resultState === 'completed'}
    />
  ) : null

  /* ── 核验中 / 无法确认 ── */
  if (resultState === 'loading' || resultState === 'unknown') {
    const isLoading = resultState === 'loading'
    return (
      <PrintPageFrame><div data-w2-page="print-done" className="flex min-h-full flex-col">
        <PrintPrototypeHeader
          title={isLoading ? '正在核验打印结果' : '无法确认打印结果'}
          subtitle={isLoading ? '正在读取真实打印任务状态，请稍候' : '当前未取得可信的任务终态，请勿据此判断已经出纸'}
          step={6}
          backLabel="返回首页"
          onBack={() => navigate('/')}
        />
        <div className="print-done-fail">
          <div className="print-done-fail-icon">
            <AlertCircleIcon aria-hidden="true" />
          </div>
          <div className="print-done-fail-title">
            {isLoading ? '正在向打印服务核验' : '暂未取得可信状态'}
          </div>
          <div className="print-done-fail-reason">
            {isLoading
              ? '核验完成后将显示真实结果或返回任务进度页'
              : taskId
                ? `任务号 ${taskId} 暂时无法核验，请在打印订单中查看或联系工作人员`
                : '未找到打印任务上下文，请从打印入口重新开始'}
          </div>
          {!isLoading && (
            <div className="print-done-fail-actions">
              <button type="button" className="print-done-action-btn ghost" onClick={() => navigate('/')}>
                返回首页
              </button>
              {taskId && (
                <button type="button" className="print-done-action-btn ghost" onClick={() => navigate('/me/print-orders')}>
                  查看打印订单
                </button>
              )}
              {canReportIssue && (
                <button type="button" className="print-done-action-btn ghost" onClick={() => setFeedbackOpen(true)}>
                  反馈问题
                </button>
              )}
              <button type="button" className="print-done-action-btn primary" onClick={() => navigate('/help')}>
                使用帮助
              </button>
            </div>
          )}
        </div>
        {feedbackDialog}
      </div></PrintPageFrame>
    )
  }

  /* ── 后端确认失败 ── */
  if (resultState === 'failed') {
    return (
      <PrintPageFrame><div data-w2-page="print-done" className="flex min-h-full flex-col">
        <PrintPrototypeHeader
          title={isUnconfirmed ? '打印结果未确认' : '打印失败'}
          subtitle={isUnconfirmed ? '服务端无法确认本次是否已出纸' : '打印任务已由服务端确认失败'}
          step={6}
          backLabel="返回首页"
          onBack={() => navigate('/')}
        />
        <div className="print-done-fail">
          <div className="print-done-fail-icon">
            <AlertCircleIcon aria-hidden="true" />
          </div>
          <div className="print-done-fail-title">{isUnconfirmed ? '打印结果未确认' : '打印失败'}</div>
          <div className="print-done-fail-reason">
            {failureReason}
          </div>
          {/* 「无法确认」不等于「没出纸」，也不等于「已出纸」。这里只能给用户两件确定的事：
              纸要现场看，钱还在订单上、需要工作人员核查后处理 —— 不承诺退款，也不否认出纸。
              本机不提供自助退款（PrintCashierPage 已有同口径声明），所以只给核查路径。 */}
          {isUnconfirmed && (
            <div className="print-done-fail-reason" role="status">
              请先查看出纸口是否已有纸张。无论有没有，这笔订单都已保留，
              请凭订单号联系现场工作人员核查后处理；本机不提供自助退款。
              {taskId ? `（任务号 ${taskId}）` : null}
            </div>
          )}
          <div className="print-done-fail-actions">
            <button type="button" className="print-done-action-btn ghost" onClick={() => navigate('/')}>
              返回首页
            </button>
            {canReportIssue && (
              <button type="button" className="print-done-action-btn ghost" onClick={() => setFeedbackOpen(true)}>
                反馈问题
              </button>
            )}
            <button type="button" className="print-done-action-btn primary" onClick={() => navigate('/help')}>
              使用帮助
            </button>
          </div>
        </div>
        {feedbackDialog}
      </div></PrintPageFrame>
    )
  }

  /* ── 成功态 ── */
  return (
    <PrintPageFrame><div data-w2-page="print-done" className="flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="打印完成"
        subtitle="文件已从出纸口送出，请核对页数后取走"
        step={6}
        backLabel="返回首页"
        onBack={() => navigate('/')}
      />

      <section className="print-done-content">
        <div className="print-done-split">

          {/* 左列：成功勾 + 取件凭证码 */}
          <section className="print-done-left" aria-label="打印完成">
            {/* 190px 成功勾圆 */}
            <div className="print-done-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
            </div>

            <div className="print-done-title">请取走文件</div>

            <div className="print-done-sub">
              {totalFaces != null
                ? `共 ${totalFaces} 面已全部打印，请在出纸口取走并核对页数`
                : '文件已全部打印，请在出纸口取走'}
            </div>

            {/* 取件凭证码 */}
            {pickupCode && (
              <div className="print-pickup">
                <div className="print-pickup-label">取件凭证码</div>
                <div className="print-pickup-code">{pickupCode}</div>
                <div className="print-pickup-note">如需现场核验取件或补打，请向工作人员出示此凭证码</div>
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

            {/* 任务元信息 */}
            {(state.taskId || state.orderId) && (
              <div className="print-done-task-meta">
                {state.taskId  && <span className="print-done-task-chip"><b>任务号</b> {state.taskId}</span>}
                {state.orderId && <span className="print-done-task-chip"><b>订单号</b> {state.orderId}</span>}
                <span className="print-done-task-chip ok"><b>完成</b></span>
              </div>
            )}
          </section>

          {/* 右列 */}
          <div className="print-done-right">

            {/* 任务摘要 */}
            {file && params && (
              <div className="print-done-card a-slate">
                <b className="print-done-card-hd">本次任务摘要</b>
                <div className="print-done-i-row">
                  <span className="k">文件名</span>
                  <span className="v">{file.name}</span>
                </div>
                <div className="print-done-i-row">
                  <span className="k">页数 / 份数</span>
                  <span className="v">{file.pages} 页 × {params.copies} 份</span>
                </div>
                <div className="print-done-i-row">
                  <span className="k">打印面</span>
                  <span className="v">{DUPLEX_LABEL[params.duplex] ?? params.duplex}</span>
                </div>
                <div className="print-done-i-row">
                  <span className="k">色彩 / 质量</span>
                  <span className="v">
                    {params.colorMode === 'color' ? '彩色' : '黑白'} · {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
                  </span>
                </div>
              </div>
            )}

            {/* 问题反馈 */}
            <div className="print-done-card">
              <b className="print-done-card-hd">打印遇到问题？</b>
              <span className="print-done-card-sub">缺页、卡纸、质量不佳等问题可在此反馈</span>
              <div className="print-done-fb-group">
                {canReportIssue && (
                  <button type="button" className="print-done-fb-btn" aria-label="反馈问题" onClick={() => setFeedbackOpen(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z" />
                      <path d="M9 12h.01M13 12h.01M17 12h.01" />
                    </svg>
                    反馈问题
                  </button>
                )}
                <button type="button" className="print-done-fb-btn" aria-label="使用帮助" onClick={() => navigate('/help')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9.3a2.5 2.5 0 014.9.7c0 1.7-2.4 2.1-2.4 3.5M12 16.8v.4" />
                  </svg>
                  使用帮助
                </button>
              </div>
            </div>

            {/* 接下来 */}
            <div className="print-done-card" style={{ flex: 1 }}>
              <b className="print-done-card-hd">接下来</b>
              <div className="print-done-next-list">
                <button type="button" className="print-done-tile primary" onClick={() => navigate(uploadPath)}>
                  <span className="print-done-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M6 9V3h12v6M6 18h-2a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 15h12v6H6z" />
                    </svg>
                  </span>
                  <span className="print-done-tile-text">
                    <b>继续打印</b>
                    <span>再打一份或换一个文件</span>
                  </span>
                </button>
                <button type="button" className="print-done-tile" onClick={() => navigate('/me/print-orders')}>
                  <span className="print-done-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M7 3h8l4 4v14H7z" />
                      <path d="M15 3v4h4M10 12h6M10 16h6" />
                    </svg>
                  </span>
                  <span className="print-done-tile-text">
                    <b>查看打印订单</b>
                    <span>在「我的」查看记录与凭证码</span>
                  </span>
                </button>
                <button type="button" className="print-done-tile" onClick={() => navigate('/')}>
                  <span className="print-done-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" />
                    </svg>
                  </span>
                  <span className="print-done-tile-text">
                    <b>返回首页</b>
                    <span>回到功能大厅</span>
                  </span>
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* 底部提示 */}
        <div className="print-done-notice" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.5" />
          </svg>
          如遇卡纸或缺页，请联系现场工作人员，凭任务号与取件凭证码可协助核验补打；打印文件请妥善保管，勿遗留在机器旁。
        </div>
      </section>
      {feedbackDialog}
    </div></PrintPageFrame>
  )
}
