// ============================================================
// PrintCashierPage — C5-3 Kiosk 收银 / 支付状态轮询
//
// 流程（仅 API_MODE==='http'，付费单 amountCents>0）：
//   进入本页 → POST /orders/:id/pay 出码 → 展示价目明细 + 屏上动态码
//   → 每 2.5s 轮询 GET /orders/:id/pay-status → paid → 进入 /print/progress 履约。
//
// 合规硬约束（CLAUDE.md §9/§12 + 决策 3）：
// - 仅 paid 才允许进入出纸/取件（deriveCashierView.canProceed）；unpaid/paying/closed/refunded 不放行。
// - 沙箱为**测试支付通道**，页面明示；DEV 构建才渲染「模拟支付」控件，生产构建自动移除。
// - 不自助退款（C5-4）：仅静态展示退款/重试规则文案，不放假的退款入口。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, InfoIcon, LoaderIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react'
import type { PrintJobParams, PrintPriceLine } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { API_MODE } from '../../services/api/client'
import { createPayAttempt, getPayStatus, simulateSandboxPayment } from '../../services/print/paymentApi'
import { deriveCashierView, formatCents, type CashierView } from './cashierStatus'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'

interface CashierLocationState {
  orderId?: string
  orderNo?: string
  amountCents?: number
  priceLines?: PrintPriceLine[]
  taskId?: string
  file?: unknown
  params?: PrintJobParams
  source?: PrintMaterialSource
  [k: string]: unknown
}

/** 支付尝试快照（出码响应与轮询响应共用的最小形态，喂给 deriveCashierView）。 */
type Snapshot = {
  payStatus: string
  attempt: { attemptId: string; status: 'created' | 'pending' | 'success' | 'failed' | 'expired'; qrCodeContent: string | null; expiresAt: string | null } | null
}

const POLL_INTERVAL_MS = 2500

const SERVICE_KEY_LABEL: Record<string, string> = {
  print_bw_page: '黑白打印',
  print_color_page: '彩色打印',
  print_duplex_surcharge: '双面附加',
}

const TONE_BOX: Record<CashierView['tone'], string> = {
  info: 'border-primary-200 bg-primary-50 text-primary-700',
  success: 'border-success/30 bg-success-bg text-success-fg',
  warning: 'border-warning/30 bg-warning-bg text-warning-fg',
  error: 'border-error/30 bg-error-bg text-error-fg',
}

function lineLabel(line: PrintPriceLine): string {
  return SERVICE_KEY_LABEL[line.serviceKey] ?? line.description ?? line.serviceKey
}

export function PrintCashierPage() {
  // 收银进行中：禁止进入待机宣传屏（与打印进度一致）。
  useBusyLock(true)

  const navigate = useNavigate()
  const location = useLocation()
  const state = useMemo(() => (location.state ?? {}) as CashierLocationState, [location.state])

  const orderId = typeof state.orderId === 'string' ? state.orderId : null
  const amountCents = typeof state.amountCents === 'number' ? state.amountCents : null
  const priceLines = Array.isArray(state.priceLines) ? state.priceLines : []
  const uploadPath = printUploadPathForSource(state.source)

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const navigatedRef = useRef(false)
  const cancelRef = useRef(false)

  const proceedToPrint = useCallback(() => {
    if (navigatedRef.current) return
    navigatedRef.current = true
    cancelRef.current = true
    // taskId 已在建单时创建（pending）；paid 后门控放行，Agent 方可 claim 出纸。
    navigate('/print/progress', { state: { ...state } })
  }, [navigate, state])

  // ── 出码（建/幂等复用支付尝试）──
  const issue = useCallback(async () => {
    if (!orderId) return
    setIssuing(true)
    try {
      const res = await createPayAttempt(orderId)
      if (cancelRef.current) return
      setSnapshot({
        payStatus: res.orderPayStatus,
        attempt: { attemptId: res.attemptId, status: res.status, qrCodeContent: res.qrCodeContent, expiresAt: res.expiresAt },
      })
      setIssueError(null)
    } catch (err) {
      if (cancelRef.current) return
      // 出码失败不阻断轮询（订单可能已 paid/closed，轮询会反映真实状态）；仅提示。
      setIssueError(err instanceof Error ? err.message : '出码失败，请重试')
    } finally {
      if (!cancelRef.current) setIssuing(false)
    }
  }, [orderId])

  // 首次进入：出码一次。
  useEffect(() => {
    if (API_MODE !== 'http' || !orderId || amountCents === null || amountCents <= 0) return
    cancelRef.current = false
    void issue()
    return () => {
      cancelRef.current = true
    }
  }, [orderId, amountCents, issue])

  // ── 轮询支付状态 ──
  useEffect(() => {
    if (API_MODE !== 'http' || !orderId) return
    const tick = async () => {
      if (cancelRef.current) return
      try {
        const s = await getPayStatus(orderId)
        if (cancelRef.current) return
        setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
        if (s.payStatus === 'paid') proceedToPrint()
      } catch {
        /* 网络抖动：保留上次快照，下个周期重试，不伪造状态 */
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [orderId, proceedToPrint])

  // 1s 心跳：驱动倒计时 + 动态码过期本地即时翻面（不必等下次轮询）。
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const view = useMemo<CashierView | null>(
    () => (snapshot ? deriveCashierView(snapshot, nowMs) : null),
    [snapshot, nowMs],
  )

  const qrContent = view?.showQr ? snapshot?.attempt?.qrCodeContent ?? null : null
  const expiresAt = snapshot?.attempt?.expiresAt ?? null
  const remainSec = useMemo(() => {
    if (!view?.showQr || !expiresAt) return null
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000))
  }, [view, expiresAt, nowMs])

  const handleReissue = useCallback(() => {
    setSnapshot(null)
    void issue()
  }, [issue])

  const devSimulate = useCallback(
    async (result: 'success' | 'failed') => {
      const attemptId = snapshot?.attempt?.attemptId
      if (!attemptId) return
      try {
        await simulateSandboxPayment(attemptId, result)
        if (orderId) {
          const s = await getPayStatus(orderId)
          setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
          if (s.payStatus === 'paid') proceedToPrint()
        }
      } catch (err) {
        setIssueError(err instanceof Error ? err.message : '模拟支付失败')
      }
    },
    [snapshot, orderId, proceedToPrint],
  )

  // ── 守卫：直达 / 非法进入 ──
  if (!orderId || amountCents === null) {
    return (
      <GuardScreen
        title="未找到待支付订单"
        hint="请从上传文件重新开始打印流程"
        actionLabel="重新上传文件"
        onAction={() => navigate(uploadPath)}
      />
    )
  }
  if (amountCents <= 0) {
    // 免费单不应进入收银页；纠偏到履约（不伪造支付）。
    return (
      <GuardScreen
        title="该订单无需支付"
        hint="正在进入打印…"
        actionLabel="继续"
        onAction={() => navigate('/print/progress', { state: { ...state } })}
      />
    )
  }
  if (API_MODE !== 'http') {
    return (
      <GuardScreen
        title="收银功能需连接后端"
        hint="当前为演示模式，未连接支付服务"
        actionLabel="返回首页"
        onAction={() => navigate('/')}
      />
    )
  }

  const total = formatCents(amountCents)
  const canProceed = view?.canProceed ?? false
  const canReissue = view?.canReissue ?? false

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader title="订单支付" subtitle="请完成支付后开始打印" />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* 价目明细 */}
        <Card className="overflow-hidden p-0">
          <table className="w-full">
            <tbody>
              {priceLines.length === 0 ? (
                <tr>
                  <td className="px-5 py-3.5 text-sm text-neutral-500">打印费用</td>
                  <td className="px-5 py-3.5 text-right text-sm font-medium text-neutral-900">{total}</td>
                </tr>
              ) : (
                priceLines.map((line, i) => (
                  <tr key={`${line.serviceKey}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-neutral-50'}>
                    <td className="border-b border-neutral-100 px-5 py-3 text-sm text-neutral-500">
                      {lineLabel(line)}
                      <span className="ml-2 text-xs text-neutral-400">
                        {formatCents(line.unitCents)} × {line.quantity}
                      </span>
                    </td>
                    <td className="border-b border-neutral-100 px-5 py-3 text-right text-sm font-medium text-neutral-900">
                      {formatCents(line.subtotalCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-baseline justify-between px-5 py-4">
            <span className="text-sm font-medium text-neutral-700">应付金额</span>
            <span className="text-2xl font-bold text-neutral-900">{total}</span>
          </div>
        </Card>

        {/* 状态 + 动态码 */}
        <Card className="flex flex-col items-center gap-4 p-6">
          {!view ? (
            <div className="flex flex-col items-center gap-3 py-8 text-neutral-500">
              <LoaderIcon className="h-8 w-8 animate-spin text-primary-600" />
              <p className="text-sm">{issuing ? '正在生成支付码…' : '正在获取支付状态…'}</p>
            </div>
          ) : (
            <>
              <div className={['w-full rounded-lg border px-4 py-3 text-center text-sm', TONE_BOX[view.tone]].join(' ')}>
                <p className="font-semibold">{view.title}</p>
                <p className="mt-1 leading-relaxed">{view.hint}</p>
              </div>

              {qrContent && (
                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <QRCodeSVG value={qrContent} size={220} level="M" marginSize={1} />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <ShieldCheckIcon className="h-3.5 w-3.5" />
                    测试支付通道 · 非真实收款
                  </div>
                  {remainSec !== null && (
                    <p className="text-xs text-neutral-400">支付码有效期剩余 {remainSec} 秒</p>
                  )}
                </div>
              )}

              {canReissue && (
                <Button variant="secondary" size="lg" disabled={issuing} onClick={handleReissue}>
                  <span className="flex items-center gap-2">
                    <RefreshCwIcon className={['h-4 w-4', issuing ? 'animate-spin' : ''].join(' ')} />
                    重新出码
                  </span>
                </Button>
              )}
            </>
          )}
        </Card>

        {/* 退款 / 重试规则（静态说明；不自助退款，C5-4）*/}
        <div className="flex items-start gap-2 rounded-lg bg-neutral-50 px-4 py-3 text-xs leading-relaxed text-neutral-500">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            支付码 5 分钟内有效，过期可点击「重新出码」重新生成；订单超时未支付将自动关闭。
            如需退款请联系现场工作人员协助处理。
          </span>
        </div>

        {issueError && (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            <span>{issueError}</span>
          </div>
        )}

        {/* DEV 专用：沙箱模拟支付（生产构建自动移除） */}
        {import.meta.env.DEV && snapshot?.attempt?.attemptId && !canProceed && (
          <div className="flex gap-2 rounded-lg border border-dashed border-warning/40 bg-warning-bg/40 p-3">
            <span className="self-center text-xs text-warning-fg">[DEV] 沙箱模拟</span>
            <button
              onClick={() => void devSimulate('success')}
              className="rounded-md border border-success/40 bg-success-bg px-3 py-1.5 text-xs text-success-fg"
            >
              模拟支付成功
            </button>
            <button
              onClick={() => void devSimulate('failed')}
              className="rounded-md border border-error/40 bg-error-bg px-3 py-1.5 text-xs text-error-fg"
            >
              模拟支付失败
            </button>
          </div>
        )}
      </div>

      {/* 底部动作 */}
      <div className="mt-4 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/')}>
          取消
        </Button>
        <Button size="lg" className="flex-1" disabled={!canProceed} onClick={proceedToPrint}>
          {canProceed ? '开始打印' : '等待支付…'}
        </Button>
      </div>
    </div>
  )
}

// ── 守卫 / 直达占位屏 ──
function GuardScreen(props: { title: string; hint: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
        <AlertCircleIcon className="h-10 w-10 text-warning" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-neutral-900">{props.title}</p>
        <p className="mt-2 text-sm text-neutral-500">{props.hint}</p>
      </div>
      <Button size="lg" onClick={props.onAction}>
        {props.actionLabel}
      </Button>
    </div>
  )
}
