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
import { CircleHelpIcon, FilePlus2Icon, ListOrderedIcon, QrCodeIcon, RefreshCwIcon, XCircleIcon } from 'lucide-react'
import type { PrintJobParams, PrintPriceLine } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { API_MODE } from '../../services/api/client'
import {
  createCodePayAttempt,
  createPayAttempt,
  fetchPaymentChannels,
  getPayStatus,
  reconcilePayment,
  releasePickupOrder,
  simulateSandboxPayment,
} from '../../services/print/paymentApi'
import { userMessageOf } from '../../services/api/userErrorMessage'
import {
  deriveCashierView,
  isPaymentAttemptSelectionLocked,
  paymentMethodForAttempt,
  type CashierView,
} from './cashierStatus'
import type { CashierSnapshot, PaymentMethod } from './CashierPaymentPanel'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'
import {
  CashierQxView,
  deriveCashierQxState,
  type ChannelLoadState,
} from './components/CashierQxView'
import './styles/cashier-qx.css'

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

// 到这些状态后订单不会再变成 paid，轮询应停止（重开收银由用户动作触发，不靠轮询）。
const PAY_POLL_TERMINAL: ReadonlySet<string> = new Set(['closed', 'failed', 'refunded', 'refunding', 'partial_refunded'])
const POLL_INTERVAL_MS = 2500
const AUTO_RECONCILE_INTERVAL_MS = 3500
/** 两种收银方式的用户可见文案。稿 32-cashier 把「方式名」与「按钮动作」分开用：
 *    name   —— 方式名，出现在正文与状态里（「选『屏上收款码』立刻出码」「屏上收款码已过期」）
 *    action —— 按钮上的动作文案（稿的选项表写的是「手机扫屏幕上的码」「出示你的付款码」）
 *  两者都真实渲染：action 上按钮、name 进状态说明。放在页面而不是呈现层，
 *  因为文案属于业务口径（付款码是一次性凭证、屏上收款码即时出码）。 */
const PAYMENT_METHOD_LABELS = {
  qr: { name: '屏上收款码', action: '手机扫屏幕上的码' },
  code: { name: '扫付款码', action: '出示你的付款码' },
} as const

const REFUND_ASSISTANCE_COPY = '如需退款请联系现场工作人员协助处理，本机不提供自助退款'

export function PrintCashierPage() {
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
  const [channelLoadState, setChannelLoadState] = useState<ChannelLoadState>('loading')
  const [channelReloadKey, setChannelReloadKey] = useState(0)
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [codeSubmitting, setCodeSubmitting] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [releaseFailed, setReleaseFailed] = useState(false)
  const navigatedRef = useRef(false)
  const cancelRef = useRef(false)
  const codeSubmitLockRef = useRef(false)
  /**
   * 付款码「仅内存缓冲区」。付款码是一次性支付凭证、等同现金，而一体机是 27 寸
   * 公共竖屏 —— 它绝不能进 React state（会随渲染树外泄、会被 DevTools/错误边界
   * 序列化），也绝不能进 DOM、URL、日志或 storage。只在提交的同步段读一次，读完清空。
   */
  const authCodeBufferRef = useRef('')
  const lastAutoReconcileAtRef = useRef(0)

  const proceedToPrint = useCallback(async () => {
    if (navigatedRef.current) return
    navigatedRef.current = true
    setReleaseFailed(false)
    let nextState = state
    try {
      // 小程序 Order-only 流程在付款前没有 PrintTask；支付成功后由服务端原子释放且幂等返回同一任务。
      if (!state.taskId && orderId && paymentSessionToken) {
        const released = await releasePickupOrder({ orderId, paymentSessionToken })
        nextState = { ...state, ...released, taskId: released.taskId, paymentSessionToken: released.paymentSessionToken }
      }
      cancelRef.current = true
      navigate('/print/progress', { state: nextState })
    } catch (error) {
      navigatedRef.current = false
      setReleaseFailed(true)
      setIssueError(userMessageOf(error, '订单已付款，但创建打印任务失败，请重试或联系现场工作人员'))
    }
  }, [navigate, state, orderId, paymentSessionToken])

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
        setIssueError(userMessageOf(err, '出码失败，请稍后重试或联系现场工作人员'))
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
        setChannelLoadState(list.length === 0 ? 'empty' : 'ready')
        // 单通道可由服务端唯一事实直接采用；多通道必须由用户显式选择，绝不默认第一项。
        const first = list.length === 1 ? list[0] ?? null : null
        setSelectedChannel(first)
        if (list.length === 0) {
          setIssueError('线上支付未开通，请联系现场工作人员')
        }
      } catch (err) {
        if (cancelRef.current) return
        setChannels([])
        setChannelLoadState('error')
        setIssueError(userMessageOf(err, '获取支付通道失败，请检查网络后重试'))
      }
    })()
    return () => {
      cancelRef.current = true
    }
  }, [orderId, paymentSessionToken, amountCents, channelReloadKey])

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

  const resetChannelSelection = useCallback(() => {
    if (issuing || codeSubmitting || hasActivePaymentAttempt) return
    setSelectedChannel(null)
    setPaymentMethod(null)
    setSnapshot(null)
    setIssueError(null)
  }, [issuing, codeSubmitting, hasActivePaymentAttempt])

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

  const submitCodePayment = useCallback(async () => {
    if (!orderId || !paymentSessionToken || !selectedChannel || codeSubmitting || codeSubmitLockRef.current) return
    // 同步段读走缓冲区并立刻清空：付款码在本函数之外不再有第二个副本。
    const submittedCode = authCodeBufferRef.current.trim()
    authCodeBufferRef.current = ''
    if (!/^\d{18}$/.test(submittedCode)) {
      // 错误提示只描述状态，绝不回显原值。
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
      if (result.status === 'success') {
        if (cancelRef.current) return
        setSnapshot({
          payStatus: 'paying',
          attempt: {
            attemptId: result.attemptId,
            channel: selectedChannel,
            status: 'pending',
            qrCodeContent: null,
            expiresAt: null,
          },
        })
        // code-pay 的尝试结果不直接驱动出纸。必须再读取订单 pay-status，只有服务端订单终态
        // 明确为 paid 才能进入 release；网络失败或仍在 paying 都留在本页继续轮询。
        try {
          const confirmed = await getPayStatus({ orderId, paymentSessionToken })
          if (cancelRef.current) return
          setSnapshot({ payStatus: confirmed.payStatus, attempt: confirmed.attempt })
          if (confirmed.payStatus === 'paid') void proceedToPrint()
        } catch (error) {
          if (!cancelRef.current) {
            setIssueError(userMessageOf(error, '付款码已提交，暂未取得付款结果，请勿重复扫码'))
          }
        }
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
      authCodeBufferRef.current = ''
      setIssueError(userMessageOf(error, '付款码支付未完成，请重新扫码'))
    } finally {
      codeSubmitLockRef.current = false
      if (!cancelRef.current) setCodeSubmitting(false)
    }
  }, [orderId, paymentSessionToken, selectedChannel, codeSubmitting, proceedToPrint])

  const reloadChannels = useCallback(() => {
    setChannels(null)
    setChannelLoadState('loading')
    setSelectedChannel(null)
    setPaymentMethod(null)
    setSnapshot(null)
    setIssueError(null)
    setChannelReloadKey((value) => value + 1)
  }, [])

  // ── 轮询支付状态 ──
  useEffect(() => {
    if (API_MODE !== 'http' || !orderId || !paymentSessionToken) return
    let timer: ReturnType<typeof setInterval> | null = null
    const tick = async () => {
      if (cancelRef.current) return
      try {
        const s = await getPayStatus({ orderId, paymentSessionToken })
        if (cancelRef.current) return
        setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
        // 支付终态（关闭 / 失败 / 已退款）后再轮询没有意义：停掉，不再每 2.5s 打 pay-status。
        if (PAY_POLL_TERMINAL.has(s.payStatus) && timer) { clearInterval(timer); timer = null; return }
        if (s.payStatus === 'paid' && !releaseFailed) void proceedToPrint()
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
            if (reconciled.payStatus === 'paid' && !releaseFailed) proceedToPrint()
          } catch {
            // 自动查单失败不覆盖当前状态；下一周期继续以服务端限流为准重试。
          }
        }
      } catch {
        /* 网络抖动：保留上次快照，下个周期重试，不伪造状态 */
      }
    }
    void tick()
    timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => { if (timer) clearInterval(timer) }
  }, [orderId, paymentSessionToken, proceedToPrint, releaseFailed])

  // 1s 心跳：驱动倒计时 + 动态码过期本地即时翻面（不必等下次轮询）。
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const view = useMemo<CashierView | null>(
    () => (snapshot && (paymentMethod !== null || snapshot.attempt) ? deriveCashierView(snapshot, nowMs) : null),
    [snapshot, paymentMethod, nowMs],
  )
  const isPaymentPending = view?.phase === 'awaiting_scan' || view?.phase === 'awaiting_code_confirmation'
  useBusyLock(issuing || codeSubmitting || reconciling || isPaymentPending)

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
      setIssueError(userMessageOf(err, '暂未查到支付结果，请稍候或继续等待自动确认'))
    } finally {
      if (!cancelRef.current) setReconciling(false)
    }
  }, [orderId, paymentSessionToken, reconciling, proceedToPrint])

  const refreshStatus = useCallback(async () => {
    if (!orderId || !paymentSessionToken || reconciling) return
    setReconciling(true)
    try {
      const s = await getPayStatus({ orderId, paymentSessionToken })
      if (cancelRef.current) return
      setSnapshot({ payStatus: s.payStatus, attempt: s.attempt })
      setIssueError(null)
      if (s.payStatus === 'paid' && !releaseFailed) void proceedToPrint()
    } catch (err) {
      if (!cancelRef.current) setIssueError(userMessageOf(err, '暂未取得最新支付结果，请稍后重试'))
    } finally {
      if (!cancelRef.current) setReconciling(false)
    }
  }, [orderId, paymentSessionToken, reconciling, proceedToPrint, releaseFailed])

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
        setIssueError(userMessageOf(err, '模拟支付失败，请稍后重试'))
      }
    },
    [snapshot, orderId, paymentSessionToken, proceedToPrint],
  )

  const canProceed = view?.canProceed ?? false
  const canReissue = view?.canReissue ?? false

  const qxState = deriveCashierQxState({
    hasOrder: Boolean(orderId),
    hasSession: Boolean(paymentSessionToken),
    amountCents,
    channelState: API_MODE === 'http' ? channelLoadState : 'error',
    channels: channels ?? [],
    selectedChannel,
    paymentMethod,
    snapshot,
    nowMs,
    releaseFailed,
    reconciling,
  })

  const status = (() => {
    if (qxState === 'paid') return { tone: 'ok' as const, label: '服务端确认已付' }
    if (qxState === 'free-order') return { tone: 'ok' as const, label: '无需付款 · 订单已建立' }
    if (['channel-empty', 'channel-failed', 'attempt-failed', 'order-failed', 'closed', 'refunded'].includes(qxState)) {
      return { tone: 'bad' as const, label: qxState === 'closed' ? '订单已超时关闭' : '当前不可继续支付' }
    }
    if (['pending-verification', 'release-failed', 'display-expired-reconciling', 'expired', 'attempt-channel-unknown', 'refunding', 'partial-refunded'].includes(qxState)) {
      return { tone: 'warn' as const, label: qxState === 'release-failed' ? '打印任务待恢复' : '支付状态需处理' }
    }
    return { tone: 'unknown' as const, label: qxState === 'channel-loading' ? '正在读取支付通道' : '支付尚未确认' }
  })()

  const secondaryAction = (() => {
    if (['no-order', 'free-order', 'refunding', 'partial-refunded', 'refunded', 'paid', 'pending-qr'].includes(qxState)) {
      return { label: '我的打印订单', icon: <ListOrderedIcon aria-hidden="true" />, run: () => navigate('/me/print-orders') }
    }
    if (qxState === 'channel-empty') return { label: '改天再打', icon: <XCircleIcon aria-hidden="true" />, run: () => navigate(uploadPath) }
    if (qxState === 'expired') return { label: '重新下单修改参数', icon: <FilePlus2Icon aria-hidden="true" />, run: () => navigate(uploadPath) }
    if (qxState === 'attempt-channel-unknown' || qxState === 'session-expired') return { label: '联系工作人员', icon: <CircleHelpIcon aria-hidden="true" />, run: () => navigate('/help') }
    if (qxState === 'attempt-failed' && (channels?.length ?? 0) > 1) return { label: '换个支付通道', icon: <ListOrderedIcon aria-hidden="true" />, run: resetChannelSelection }
    if (qxState === 'pending-scan') return { label: '改用屏上收款码', icon: <QrCodeIcon aria-hidden="true" />, run: () => selectPaymentMethod('qr') }
    if (qxState === 'channel-selected' && (channels?.length ?? 0) > 1) return { label: '重新选通道', icon: <RefreshCwIcon aria-hidden="true" />, run: resetChannelSelection }
    if (['pending', 'channel-selected', 'channel-loading'].includes(qxState)) {
      return { label: '返回确认页', icon: <XCircleIcon aria-hidden="true" />, run: () => navigate('/print/confirm', { state }) }
    }
    return { label: '联系工作人员', icon: <CircleHelpIcon aria-hidden="true" />, run: () => navigate('/help') }
  })()

  const primaryAction = (() => {
    if (qxState === 'no-order') return { label: '重新发起打印', run: () => navigate(uploadPath), disabled: false }
    if (qxState === 'session-expired' || qxState === 'attempt-channel-unknown') return { label: '从我的打印订单重进', run: () => navigate('/me/print-orders'), disabled: false }
    if (qxState === 'free-order' || qxState === 'paid' || qxState === 'release-failed') return { label: qxState === 'release-failed' ? '重试创建打印任务' : '开始打印', run: () => void proceedToPrint(), disabled: false }
    if (qxState === 'channel-failed') return { label: '重新读取支付通道', run: reloadChannels, disabled: false }
    if (qxState === 'channel-empty' || qxState === 'refunding' || qxState === 'partial-refunded') return { label: '联系工作人员', run: () => navigate('/help'), disabled: false }
    if (qxState === 'pending-qr' || qxState === 'awaiting-code-confirmation' || qxState === 'pending-verification' || qxState === 'display-expired-reconciling') return { label: reconciling ? '正在刷新付款结果' : '刷新付款结果', run: () => void refreshStatus(), disabled: reconciling }
    if (qxState === 'expired' || qxState === 'attempt-failed') return { label: '重新发起支付', run: handleReissue, disabled: issuing }
    if (qxState === 'order-failed' || qxState === 'closed' || qxState === 'refunded') return { label: '重新发起打印', run: () => navigate(uploadPath), disabled: false }
    return { label: qxState === 'pending-scan' ? '等待读取付款码' : qxState === 'channel-selected' ? '选择上方扫码方式' : '选择上方支付通道', run: () => undefined, disabled: true }
  })()

  return (
    <div data-w2-page="print-cashier" className="cashier-qx-route">
    <QxPageFrame
      title="订单支付"
      subtitle="选择服务端已启用通道；支付确认到账后才会释放打印任务"
      terminalLabel={state.orderNo ? `订单 ${state.orderNo}` : '就业服务大厅'}
      status={status}
      ctabar={
        <>
          <button type="button" className="qx-btn cashier-qx-cta-secondary" data-variant="ghost" onClick={secondaryAction.run}>
            {secondaryAction.icon}{secondaryAction.label}
          </button>
          {qxState === 'attempt-failed' ? (
            <button type="button" className="qx-btn cashier-qx-cta-secondary" data-variant="ghost" onClick={() => navigate(uploadPath)}>
              <FilePlus2Icon aria-hidden="true" />重新下单修改参数
            </button>
          ) : <p className="why">金额与状态均来自服务端；未确认 paid 前不会出纸。</p>}
          <button
            type="button"
            className="qx-btn cashier-qx-cta-primary"
            data-variant="primary"
            disabled={primaryAction.disabled}
            onClick={primaryAction.run}
          >
            {primaryAction.disabled ? null : ['channel-failed', 'expired', 'attempt-failed', 'release-failed'].includes(qxState) ? <RefreshCwIcon aria-hidden="true" /> : <FilePlus2Icon aria-hidden="true" />}
            {primaryAction.label}
          </button>
        </>
      }
    >
      <CashierQxView
        step={5}
        state={qxState}
        orderNo={state.orderNo}
        orderId={orderId}
        amountCents={amountCents}
        priceLines={priceLines}
        channels={channels ?? []}
        selectedChannel={selectedChannel}
        displayedChannel={displayedChannel}
        paymentMethod={paymentMethod}
        displayedPaymentMethod={displayedPaymentMethod}
        snapshot={snapshot}
        view={view}
        issuing={issuing}
        codeSubmitting={codeSubmitting}
        authCodeBufferRef={authCodeBufferRef}
        qrContent={qrContent}
        remainSec={remainSec}
        reconciling={reconciling}
        canReissue={canReissue}
        canProceed={canProceed}
        issueError={issueError}
        refundAssistanceCopy={REFUND_ASSISTANCE_COPY}
        isDevSandbox={import.meta.env.DEV && snapshot?.attempt?.channel === 'sandbox'}
        selectionLocked={hasActivePaymentAttempt}
        onSelectChannel={switchChannel}
        methodLabels={PAYMENT_METHOD_LABELS}
        onSelectMethod={selectPaymentMethod}
        onSubmitCode={() => void submitCodePayment()}
        onReconcile={() => void handleReconcile()}
        onReissue={handleReissue}
        onSimulateSandbox={(result) => void devSimulate(result)}
      />
    </QxPageFrame>
    </div>
  )
}
