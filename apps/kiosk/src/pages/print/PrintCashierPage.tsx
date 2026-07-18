// ============================================================
// PrintCashierPage — C5-3 Kiosk 收银 / 支付状态轮询（C5-6 扩微信/支付宝真实通道）
//
// 流程（仅 API_MODE==='http'，付费单 amountCents>0）：
//   进入本页 → GET /payment/channels 取已启用通道（多通道时用户显式选择）
//   → POST /orders/:id/pay 出码 → 展示价目明细 + 屏上动态码
//   → 每 2.5s 轮询 GET /orders/:id/pay-status → paid → 进入 /print/progress 履约；
//   真实通道另提供「已支付但未跳转？」reconcile 兜底（服务端按渠道账本核实，限最小间隔）。
//
// 合规硬约束（CLAUDE.md §9/§12 + 决策 3）：
// - 仅 paid 才允许进入出纸/取件（deriveCashierView.canProceed）；unpaid/paying/closed/refunded 不放行。
// - sandbox 为**测试支付通道**，页面明示「非真实收款」；wechat/alipay 展示真实品牌指引。
// - DEV 构建且当前尝试为 sandbox 时才渲染「模拟支付」控件，生产构建自动移除；真实通道无任何模拟入口。
// - 不自助退款（C5-4）：仅静态展示退款/重试规则文案，不放假的退款入口。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon, CreditCardIcon, FileTextIcon, InfoIcon, QrCodeIcon, ScanLineIcon, XCircleIcon } from 'lucide-react'
import type { PrintJobParams, PrintPriceLine } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { API_MODE } from '../../services/api/client'
import {
  createCodePayAttempt,
  createPayAttempt,
  fetchPaymentChannels,
  getPayStatus,
  reconcilePayment,
  simulateSandboxPayment,
} from '../../services/print/paymentApi'
import {
  deriveCashierView,
  formatCents,
  isPaymentAttemptSelectionLocked,
  PAY_CHANNEL_LABEL,
  paymentMethodForAttempt,
  type CashierView,
} from './cashierStatus'
import { CashierPaymentPanel, type CashierSnapshot, type PaymentMethod } from './CashierPaymentPanel'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'

interface CashierLocationState {
  orderId?: string
  orderNo?: string
  amountCents?: number
  priceLines?: PrintPriceLine[]
  paymentSessionToken?: string
  taskId?: string
  file?: unknown
  params?: PrintJobParams
  source?: PrintMaterialSource
  [k: string]: unknown
}

const POLL_INTERVAL_MS = 2500
const AUTO_RECONCILE_INTERVAL_MS = 3500

const SERVICE_KEY_LABEL: Record<string, string> = {
  print_bw_page: '黑白打印',
  print_color_page: '彩色打印',
  print_duplex_surcharge: '双面附加',
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
  const paymentSessionToken = typeof state.paymentSessionToken === 'string' ? state.paymentSessionToken : null
  const amountCents = typeof state.amountCents === 'number' ? state.amountCents : null
  const priceLines = Array.isArray(state.priceLines) ? state.priceLines : []
  const uploadPath = printUploadPathForSource(state.source)

  const [snapshot, setSnapshot] = useState<CashierSnapshot | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  /** 服务端已启用通道；null=加载中。多通道时用户显式选择后才出码。 */
  const [channels, setChannels] = useState<string[] | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [codeSubmitting, setCodeSubmitting] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const navigatedRef = useRef(false)
  const cancelRef = useRef(false)
  const codeSubmitLockRef = useRef(false)
  const lastAutoReconcileAtRef = useRef(0)

  const proceedToPrint = useCallback(() => {
    if (navigatedRef.current) return
    navigatedRef.current = true
    cancelRef.current = true
    // taskId 已在建单时创建（pending）；paid 后门控放行，Agent 方可 claim 出纸。
    navigate('/print/progress', { state: { ...state } })
  }, [navigate, state])

  // ── 出码（建/幂等复用支付尝试；channel 只能取服务端已启用通道）──
  const issue = useCallback(
    async (channel: string) => {
      if (!orderId || !paymentSessionToken) return
      setIssuing(true)
      try {
        const res = await createPayAttempt({ orderId, paymentSessionToken, channel })
        if (cancelRef.current) return
        setSnapshot({
          payStatus: res.orderPayStatus,
          attempt: {
            attemptId: res.attemptId,
            channel: res.channel,
            status: res.status,
            qrCodeContent: res.qrCodeContent,
            expiresAt: res.expiresAt,
          },
        })
        setIssueError(null)
      } catch (err) {
        if (cancelRef.current) return
        // 出码失败不阻断轮询（订单可能已 paid/closed，轮询会反映真实状态）；仅提示。
        setIssueError(err instanceof Error ? err.message : '出码失败，请重试')
      } finally {
        if (!cancelRef.current) setIssuing(false)
      }
    },
    [orderId, paymentSessionToken],
  )

  // 首次进入只取通道。用户先选支付方式再建尝试，避免二维码与付款码同时可支付。
  useEffect(() => {
    if (API_MODE !== 'http' || !orderId || !paymentSessionToken || amountCents === null || amountCents <= 0) return
    cancelRef.current = false
    void (async () => {
      try {
        const list = await fetchPaymentChannels()
        if (cancelRef.current) return
        setChannels(list)
        const first = list[0] ?? null
        setSelectedChannel(first)
        if (!first) {
          setIssueError('线上支付未开通，请联系现场工作人员')
        }
      } catch (err) {
        if (cancelRef.current) return
        setChannels([])
        setIssueError(err instanceof Error ? err.message : '获取支付通道失败')
      }
    })()
    return () => {
      cancelRef.current = true
    }
  }, [orderId, paymentSessionToken, amountCents, issue])

  const attemptPaymentMethod = paymentMethodForAttempt(snapshot?.attempt ?? null)
  const hasActivePaymentAttempt = isPaymentAttemptSelectionLocked(snapshot?.attempt ?? null, nowMs)
  const displayedChannel = hasActivePaymentAttempt ? snapshot?.attempt?.channel ?? selectedChannel : selectedChannel
  const displayedPaymentMethod = hasActivePaymentAttempt ? attemptPaymentMethod ?? paymentMethod : paymentMethod

  // 切换通道只能在未发起支付前进行，避免两个通道同时处于可扣款状态。
  const switchChannel = useCallback(
    (channel: string) => {
      if ((channel === selectedChannel && !snapshot?.attempt) || issuing || codeSubmitting || hasActivePaymentAttempt) return
      setSelectedChannel(channel)
      setSnapshot(null)
      setPaymentMethod(null)
      setIssueError(null)
    },
    [selectedChannel, snapshot, issuing, codeSubmitting, hasActivePaymentAttempt],
  )

  const selectPaymentMethod = useCallback(
    (method: PaymentMethod) => {
      if (!selectedChannel || issuing || codeSubmitting || hasActivePaymentAttempt) return
      if (method === paymentMethod && !snapshot?.attempt) return
      setPaymentMethod(method)
      setSnapshot(null)
      setIssueError(null)
      if (method === 'qr') void issue(selectedChannel)
    },
    [selectedChannel, paymentMethod, snapshot, issuing, codeSubmitting, hasActivePaymentAttempt, issue],
  )

  const submitCodePayment = useCallback(async (inputCode?: string) => {
    if (!orderId || !paymentSessionToken || !selectedChannel || codeSubmitting || codeSubmitLockRef.current) return
    const submittedCode = (inputCode ?? authCode).trim()
    if (!/^\d{18}$/.test(submittedCode)) {
      setIssueError('请输入 18 位数字付款码')
      return
    }
    codeSubmitLockRef.current = true
    setCodeSubmitting(true)
    setIssueError(null)
    try {
      const result = await createCodePayAttempt({
        orderId,
        paymentSessionToken,
        channel: selectedChannel,
        authCode: submittedCode,
      })
      setAuthCode('')
      if (result.status === 'success') {
        if (cancelRef.current) return
        setSnapshot({
          payStatus: 'paid',
          attempt: {
            attemptId: result.attemptId,
            channel: selectedChannel,
            status: 'success',
            qrCodeContent: null,
            expiresAt: null,
          },
        })
        // 服务端只有完成金额校验并幂等入账后才返回 success，直接进入打印进度，避免成功后的状态查询网络抖动阻塞用户。
        proceedToPrint()
        return
      }
      setSnapshot({
        payStatus: result.status === 'paying' ? 'paying' : 'unpaid',
        attempt: {
          attemptId: result.attemptId,
          channel: selectedChannel,
          status: result.status === 'paying' ? 'pending' : 'failed',
          qrCodeContent: null,
          expiresAt: null,
        },
      })
      if (result.status === 'failed') setIssueError(result.failReason ?? '支付未完成，请重新扫码')
    } catch (error) {
      setAuthCode('')
      const message = error instanceof Error ? error.message : ''
      setIssueError(
        message.includes('PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED')
          ? '检测到上一笔支付待核实，请先等待自动确认或点击核实'
          : message.includes('PAYMENT_ATTEMPT_PENDING')
            ? '已有支付正在处理中，请勿重复扫码'
            : '付款码支付未完成，请重新扫码',
      )
    } finally {
      codeSubmitLockRef.current = false
      if (!cancelRef.current) setCodeSubmitting(false)
    }
  }, [orderId, paymentSessionToken, selectedChannel, authCode, codeSubmitting, proceedToPrint])

  // ── 轮询支付状态 ──
  useEffect(() => {
    if (API_MODE !== 'http' || !orderId || !paymentSessionToken) return
    const tick = async () => {
      if (cancelRef.current) return
      try {
        const s = await getPayStatus({ orderId, paymentSessionToken })
        if (cancelRef.current) return
        setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
        if (s.payStatus === 'paid') proceedToPrint()
        // 回调是首选路径；回调延迟/丢失时，所有真实 pending 尝试（屏上收款码和付款码）
        // 都按服务端最小间隔主动查账。sandbox 没有真实渠道账本，绝不伪造查单能力。
        const shouldAutoReconcile =
          s.payStatus !== 'paid' &&
          s.attempt?.status === 'pending' &&
          s.attempt.channel !== 'sandbox' &&
          Date.now() - lastAutoReconcileAtRef.current >= AUTO_RECONCILE_INTERVAL_MS
        if (shouldAutoReconcile) {
          lastAutoReconcileAtRef.current = Date.now()
          try {
            const reconciled = await reconcilePayment({ orderId, paymentSessionToken })
            if (cancelRef.current) return
            setSnapshot({ payStatus: reconciled.payStatus, attempt: reconciled.attempt })
            if (reconciled.payStatus === 'paid') proceedToPrint()
          } catch {
            // 自动查单失败不覆盖当前状态；下一周期继续以服务端限流为准重试。
          }
        }
      } catch {
        /* 网络抖动：保留上次快照，下个周期重试，不伪造状态 */
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [orderId, paymentSessionToken, proceedToPrint])

  // 1s 心跳：驱动倒计时 + 动态码过期本地即时翻面（不必等下次轮询）。
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const view = useMemo<CashierView | null>(
    () => (snapshot && (paymentMethod !== null || snapshot.attempt) ? deriveCashierView(snapshot, nowMs) : null),
    [snapshot, paymentMethod, nowMs],
  )

  const qrContent = view?.showQr ? snapshot?.attempt?.qrCodeContent ?? null : null
  const expiresAt = snapshot?.attempt?.expiresAt ?? null
  const remainSec = useMemo(() => {
    if (!view?.showQr || !expiresAt) return null
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000))
  }, [view, expiresAt, nowMs])

  const handleReissue = useCallback(() => {
    const channel = snapshot?.attempt?.channel ?? selectedChannel
    const method = attemptPaymentMethod ?? paymentMethod
    if (!channel || !method) return
    setSelectedChannel(channel)
    setPaymentMethod(method)
    setSnapshot(null)
    setIssueError(null)
    if (method === 'qr') void issue(channel)
  }, [attemptPaymentMethod, issue, paymentMethod, selectedChannel, snapshot])

  // ── reconcile 兜底（仅真实通道）：回调丢失/延迟时按渠道账本核实；绝不在前端伪造已支付 ──
  const handleReconcile = useCallback(async () => {
    if (!orderId || !paymentSessionToken || reconciling) return
    setReconciling(true)
    try {
      const s = await reconcilePayment({ orderId, paymentSessionToken })
      if (cancelRef.current) return
      setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
      if (s.payStatus === 'paid') proceedToPrint()
      else setIssueError(null)
    } catch (err) {
      if (cancelRef.current) return
      const msg = err instanceof Error ? err.message : ''
      setIssueError(msg.includes('RECONCILE_TOO_FREQUENT') ? '核实过于频繁，请稍候几秒再试' : '暂未查到支付结果，请稍候或继续等待自动确认')
    } finally {
      if (!cancelRef.current) setReconciling(false)
    }
  }, [orderId, paymentSessionToken, reconciling, proceedToPrint])

  const devSimulate = useCallback(
    async (result: 'success' | 'failed') => {
      const attemptId = snapshot?.attempt?.attemptId
      if (!attemptId) return
      try {
        await simulateSandboxPayment(attemptId, result)
        if (orderId && paymentSessionToken) {
          const s = await getPayStatus({ orderId, paymentSessionToken })
          setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
          if (s.payStatus === 'paid') proceedToPrint()
        }
      } catch (err) {
        setIssueError(err instanceof Error ? err.message : '模拟支付失败')
      }
    },
    [snapshot, orderId, paymentSessionToken, proceedToPrint],
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
  if (!paymentSessionToken) {
    return (
      <GuardScreen
        title="支付会话已失效"
        hint="请返回确认页重新创建订单"
        actionLabel="返回确认页"
        onAction={() => navigate('/print/confirm', { state })}
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
    <div className="print-proto flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="订单支付"
        subtitle="请完成支付后开始打印；支付结果由系统自动确认"
        step={6}
        backLabel="返回确认"
        onBack={() => navigate('/print/confirm', { state })}
      />

      <div className="cashier-split mt-4 flex-1">
        {/* ── 左列：价目明细 + 规则 + 提示 ── */}
        <div className="cashier-left">
          {/* 价目明细 */}
          <div className="cashier-detail-card">
            <div className="cashier-card-head">
              <span className="cashier-card-icon">
                <FileTextIcon aria-hidden="true" />
              </span>
              <div>
                <div className="cashier-card-title">价目明细</div>
                <div className="cashier-card-sub">
                  {state.orderNo ? `订单号 ${state.orderNo}` : orderId ? `订单 ${orderId}` : '打印订单'}
                </div>
              </div>
            </div>
            {priceLines.length === 0 ? (
              <div className="cashier-sum-row">
                <span className="cashier-sum-key">打印费用</span>
                <span className="cashier-sum-val">{total}</span>
              </div>
            ) : (
              priceLines.map((line, i) => (
                <div key={`${line.serviceKey}-${i}`} className="cashier-sum-row">
                  <span className="cashier-sum-key">
                    {lineLabel(line)}
                    <small>
                      {formatCents(line.unitCents)} × {line.quantity}
                    </small>
                  </span>
                  <span className="cashier-sum-val">{formatCents(line.subtotalCents)}</span>
                </div>
              ))
            )}
            <div className="cashier-amount-row">
              <span className="cashier-amount-label">
                应付金额
                <br />
                示例金额 · 以现场公示价为准
              </span>
              <span className="cashier-amount-num">
                <small>¥</small>
                {total.replace('¥', '')}
              </span>
            </div>
          </div>

          {/* 支付与退款规则 */}
          <div className="cashier-rule-card">
            <h3>支付与退款规则</h3>
            <ul>
              <li>屏上收款码有效期 5 分钟；到期后重新出码或切换支付方式会先关闭旧码。</li>
              <li>付款码支付如提示待核实，请勿重复扫码，等待系统查单。</li>
              <li>订单超时未支付将自动关闭，不会扣款。</li>
              <li>如需退款请联系现场工作人员协助处理，本机不提供自助退款。</li>
            </ul>
          </div>

          {/* 提示条 */}
          <div className="cashier-notice">
            <InfoIcon aria-hidden="true" />
            支付完成后自动进入打印，请勿离开；若长时间未响应，请联系现场工作人员。
          </div>
        </div>

        {/* ── 右列：通道 + 方式 + 收款码 ── */}
        <div className="cashier-pay-card">
          <div className="cashier-card-head">
            <span className="cashier-card-icon">
              <CreditCardIcon aria-hidden="true" />
            </span>
            <div>
              <div className="cashier-card-title">选择支付方式</div>
              <div className="cashier-card-sub">先选通道，再选扫码方式</div>
            </div>
          </div>

          {/* 通道切换（全部已启用通道均展示） */}
          {channels !== null && channels.length > 0 && (
            <div className="cashier-ch-row">
              {channels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  data-active={displayedChannel === ch ? 'true' : undefined}
                  onClick={() => switchChannel(ch)}
                  disabled={issuing || codeSubmitting || hasActivePaymentAttempt}
                  className="cashier-ch-btn"
                >
                  {PAY_CHANNEL_LABEL[ch] ?? ch}
                </button>
              ))}
            </div>
          )}

          {/* 支付方式 */}
          <div className="cashier-mode-row">
            <button
              type="button"
              data-active={displayedPaymentMethod === 'qr' ? 'true' : undefined}
              onClick={() => selectPaymentMethod('qr')}
              disabled={!selectedChannel || issuing || codeSubmitting || hasActivePaymentAttempt}
              className="cashier-mode-btn"
            >
              <QrCodeIcon aria-hidden="true" />
              屏上收款码
            </button>
            <button
              type="button"
              data-active={displayedPaymentMethod === 'code' ? 'true' : undefined}
              onClick={() => selectPaymentMethod('code')}
              disabled={!selectedChannel || issuing || codeSubmitting || hasActivePaymentAttempt}
              className="cashier-mode-btn"
            >
              <ScanLineIcon aria-hidden="true" />
              扫付款码
            </button>
          </div>

          <CashierPaymentPanel
            paymentMethod={paymentMethod}
            attemptPaymentMethod={attemptPaymentMethod}
            snapshot={snapshot}
            view={view}
            channelsLoading={channels === null}
            issuing={issuing}
            codeSubmitting={codeSubmitting}
            authCode={authCode}
            qrContent={qrContent}
            remainSec={remainSec}
            reconciling={reconciling}
            canReissue={canReissue}
            isDevSandbox={import.meta.env.DEV && snapshot?.attempt?.channel === 'sandbox'}
            canProceed={canProceed}
            onAuthCodeChange={setAuthCode}
            onSubmitCode={(code) => void submitCodePayment(code)}
            onReconcile={() => void handleReconcile()}
            onReissue={handleReissue}
            onSimulateSandbox={(result) => void devSimulate(result)}
          />

          {issueError && (
            <div className="cashier-error-strip">
              <AlertCircleIcon aria-hidden="true" />
              <span>{issueError}</span>
            </div>
          )}
        </div>
      </div>

      {/* 底部行动条 */}
      <div className="cashier-actionbar">
        <button type="button" className="cashier-btn-ghost" onClick={() => navigate('/')}>
          <XCircleIcon aria-hidden="true" />
          退出支付
        </button>
        <span className="cashier-bar-note">
          支付确认到账后自动进入打印；退出后订单超时未支付将自动关闭，不会扣款
        </span>
        <button type="button" className="cashier-btn-primary" disabled={!canProceed} onClick={proceedToPrint}>
          {canProceed ? '开始打印' : '等待支付…'}
        </button>
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
