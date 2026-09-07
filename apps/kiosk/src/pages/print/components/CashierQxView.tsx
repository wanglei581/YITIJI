import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  Clock3Icon,
  CreditCardIcon,
  QrCodeIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from 'lucide-react'
import type { PrintPriceLine } from '@ai-job-print/shared'
import type { CashierView } from '../cashierStatus'
import { formatCents, PAY_CHANNEL_LABEL } from '../cashierStatus'
import type { CashierSnapshot, PaymentMethod } from '../CashierPaymentPanel'
import { CashierPaymentPanel } from '../CashierPaymentPanel'

export const CASHIER_QX_STATES = [
  'no-order',
  'session-expired',
  'free-order',
  'channel-loading',
  'channel-empty',
  'channel-failed',
  'pending',
  'channel-selected',
  'pending-qr',
  'pending-scan',
  'awaiting-code-confirmation',
  'pending-verification',
  'paid',
  'release-failed',
  'display-expired-reconciling',
  'expired',
  'attempt-failed',
  'attempt-channel-unknown',
  'order-failed',
  'closed',
  'refunding',
  'partial-refunded',
  'refunded',
] as const

export type CashierQxState = (typeof CASHIER_QX_STATES)[number]
export type ChannelLoadState = 'loading' | 'ready' | 'empty' | 'error'

interface DeriveCashierQxStateInput {
  hasOrder: boolean
  hasSession: boolean
  amountCents: number | null
  channelState: ChannelLoadState
  channels: string[]
  selectedChannel: string | null
  paymentMethod: PaymentMethod | null
  snapshot: CashierSnapshot | null
  nowMs: number
  releaseFailed: boolean
  reconciling: boolean
}

export function deriveCashierQxState(input: DeriveCashierQxStateInput): CashierQxState {
  if (!input.hasOrder || input.amountCents === null) return 'no-order'
  if (!input.hasSession) return 'session-expired'
  if (input.releaseFailed) return 'release-failed'
  if (input.amountCents <= 0) return 'free-order'

  const { snapshot } = input
  if (snapshot) {
    if (snapshot.payStatus === 'paid') return 'paid'
    if (snapshot.payStatus === 'failed') return 'order-failed'
    if (snapshot.payStatus === 'closed') return 'closed'
    if (snapshot.payStatus === 'refunding') return 'refunding'
    if (snapshot.payStatus === 'partial_refunded') return 'partial-refunded'
    if (snapshot.payStatus === 'refunded') return 'refunded'
    if (snapshot.attempt && !snapshot.attempt.channel) return 'attempt-channel-unknown'
    if (snapshot.attempt?.status === 'failed') return 'attempt-failed'
    if (snapshot.attempt?.status === 'expired' && snapshot.attempt.qrCodeContent === null) return 'pending-verification'
    if (snapshot.attempt?.status === 'expired') return 'expired'
    if (
      snapshot.attempt?.qrCodeContent &&
      snapshot.attempt.expiresAt &&
      new Date(snapshot.attempt.expiresAt).getTime() <= input.nowMs
    ) return 'display-expired-reconciling'
    if (snapshot.attempt?.qrCodeContent) return 'pending-qr'
    if (snapshot.attempt?.status === 'created' || snapshot.attempt?.status === 'pending') {
      return 'awaiting-code-confirmation'
    }
  }

  if (input.channelState === 'loading') return 'channel-loading'
  if (input.channelState === 'empty') return 'channel-empty'
  if (input.channelState === 'error') return 'channel-failed'

  if (!input.selectedChannel) return 'pending'
  if (input.paymentMethod === 'code') return 'pending-scan'
  return 'channel-selected'
}

const STATE_COPY: Record<CashierQxState, { title: string; description: string; tone: 'info' | 'warn' | 'error' | 'ok' }> = {
  'no-order': { title: '没有待支付的订单', description: '收银台只处理已经由服务端建好的订单。这里不会显示金额，也不会生成收款码。', tone: 'warn' },
  'session-expired': { title: '当前支付页面已失效', description: '订单仍然保留，请从我的打印订单重新进入。重新进入不会重复扣款。', tone: 'warn' },
  'free-order': { title: '本次无需付款', description: '订单已经真实创建，可以直接请求服务端建立打印任务。', tone: 'ok' },
  'channel-loading': { title: '正在加载支付方式', description: '读取本机已启用通道后才会列出选项；读取完成前不会替你选择。', tone: 'info' },
  'channel-empty': { title: '当前设备暂不支持在线付款', description: '订单已保留，本次没有发起支付。请联系现场工作人员处理。', tone: 'error' },
  'channel-failed': { title: '支付方式加载失败', description: '本次没有发起支付，也没有产生扣款。请检查网络后重新读取。', tone: 'error' },
  pending: { title: '请先选择支付通道', description: '多通道必须由你明确选择。选定通道后，再选择屏上收款码或付款码。', tone: 'info' },
  'channel-selected': { title: '通道已选，请选择扫码方式', description: '选屏上收款码会立即创建支付尝试；付款码读满并提交后才创建尝试。', tone: 'info' },
  'pending-qr': { title: '请扫码支付', description: '支付尝试已经创建。请勿切换方式、重复付款或重新下单。', tone: 'info' },
  'pending-scan': { title: '请出示手机付款码', description: '现在还没有向支付平台发起收款，读满十八位并提交后才会创建支付尝试。', tone: 'info' },
  'awaiting-code-confirmation': { title: '正在确认付款结果', description: '付款码已提交，但支付成功仍只以服务端订单终态为准。请勿重复出示。', tone: 'info' },
  'pending-verification': { title: '付款结果暂未确认', description: '请先查看支付账单，不要重复付款；仍无法确认时联系工作人员。', tone: 'warn' },
  paid: { title: '付款已由服务端确认', description: '系统正在创建或恢复同一打印任务，不会再次发起收款。', tone: 'ok' },
  'release-failed': { title: '打印任务尚未建立', description: '支付或零元订单状态已经由服务端确认；当前只重试打印任务释放，不会重新收款。', tone: 'warn' },
  'display-expired-reconciling': { title: '收款码到期核验中', description: '显示有效期已到，但渠道结果尚未确认。请勿重复支付。', tone: 'warn' },
  expired: { title: '屏上收款码已过期', description: '服务端确认旧码已经失效，订单尚未关闭，可以沿用锁定金额重新出码。', tone: 'warn' },
  'attempt-failed': { title: '这次支付尝试没有完成', description: '服务端确认旧尝试失败且不能再扣款；订单未关闭，可以重新发起。', tone: 'error' },
  'attempt-channel-unknown': { title: '本次支付通道未确认', description: '本机不猜通道、不出码，也不判断付款成败。请从订单列表重新进入。', tone: 'warn' },
  'order-failed': { title: '订单支付已失败', description: '服务端将订单记为失败终态，不能继续付款或出码。', tone: 'error' },
  closed: { title: '订单已超时关闭', description: '服务端确认订单已经关闭，不能再出码或继续支付。', tone: 'error' },
  refunding: { title: '这一单正在退款', description: '退款尚未完成，这类订单一律不放行出纸。到账时间以支付渠道为准。', tone: 'warn' },
  'partial-refunded': { title: '这一单发生了部分退款', description: '退款金额与剩余金额以服务端订单详情为准，本机不计算，也不放行出纸。', tone: 'warn' },
  refunded: { title: '这一单已经退款', description: '服务端返回退款完成。这张订单不能再出纸，如需打印请重新下单。', tone: 'error' },
}

function StateIcon({ state }: { state: CashierQxState }) {
  if (state === 'paid' || state === 'free-order') return <CheckCircle2Icon aria-hidden="true" />
  if (state === 'channel-selected') return <CreditCardIcon aria-hidden="true" />
  if (state === 'pending-qr') return <QrCodeIcon aria-hidden="true" />
  if (state === 'pending-scan') return <ScanLineIcon aria-hidden="true" />
  if (state.includes('pending') || state.includes('loading') || state.includes('reconciling')) return <Clock3Icon aria-hidden="true" />
  return <AlertTriangleIcon aria-hidden="true" />
}

interface CashierQxViewProps {
  step: 5
  state: CashierQxState
  orderNo?: string
  orderId: string | null
  amountCents: number | null
  priceLines: PrintPriceLine[]
  channels: string[]
  selectedChannel: string | null
  displayedChannel: string | null
  paymentMethod: PaymentMethod | null
  displayedPaymentMethod: PaymentMethod | null
  snapshot: CashierSnapshot | null
  view: CashierView | null
  issuing: boolean
  codeSubmitting: boolean
  authCodeBufferRef: { current: string }
  qrContent: string | null
  remainSec: number | null
  reconciling: boolean
  canReissue: boolean
  canProceed: boolean
  issueError: string | null
  refundAssistanceCopy: string
  isDevSandbox: boolean
  selectionLocked: boolean
  onSelectChannel: (channel: string) => void
  methodLabels: { readonly qr: string; readonly code: string }
  onSelectMethod: (method: PaymentMethod) => void
  onSubmitCode: () => void
  onReconcile: () => void
  onReissue: () => void
  onSimulateSandbox: (result: 'success' | 'failed') => void
}

export function CashierQxView(props: CashierQxViewProps) {
  const copy = STATE_COPY[props.state]
  const amountAvailable = props.amountCents !== null
  const amountLabel = props.state === 'paid' || props.state === 'release-failed' ? '服务端订单金额' : '本次应付'
  const channelLabel = props.displayedChannel ? PAY_CHANNEL_LABEL[props.displayedChannel] ?? props.displayedChannel : '尚未选择'
  const showPickers = ['pending', 'channel-selected', 'pending-scan'].includes(props.state)
  const showPaymentPanel = ['pending-qr', 'pending-scan', 'awaiting-code-confirmation', 'pending-verification', 'display-expired-reconciling', 'expired', 'attempt-failed', 'paid'].includes(props.state)

  return (
    <div className="cashier-qx-page" data-qx-state={props.state}>
      {showPickers ? (
        <section className="cashier-qx-pickers" aria-label="支付方式选择">
          <div className="cashier-qx-picker-group">
            <span className="cashier-qx-picker-label">支付通道</span>
            <div className="cashier-qx-picker-options">
              {props.channels.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  className="cashier-qx-choice"
                  data-active={props.displayedChannel === channel ? 'true' : undefined}
                  disabled={props.issuing || props.codeSubmitting || props.selectionLocked}
                  onClick={() => props.onSelectChannel(channel)}
                >
                  <WalletCardsIcon aria-hidden="true" />
                  <span>{PAY_CHANNEL_LABEL[channel] ?? channel}</span>
                  {channel === 'sandbox' ? <small>非真实收款</small> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="cashier-qx-picker-group">
            <span className="cashier-qx-picker-label">扫码方式</span>
            <div className="cashier-qx-picker-options">
              <button
                type="button"
                className="cashier-qx-choice"
                data-active={props.displayedPaymentMethod === 'qr' ? 'true' : undefined}
                disabled={!props.selectedChannel || props.issuing || props.codeSubmitting || props.selectionLocked}
                onClick={() => props.onSelectMethod('qr')}
              >
                <QrCodeIcon aria-hidden="true" /><span>手机扫屏幕上的码</span>
              </button>
              <button
                type="button"
                className="cashier-qx-choice"
                data-active={props.displayedPaymentMethod === 'code' ? 'true' : undefined}
                disabled={!props.selectedChannel || props.issuing || props.codeSubmitting || props.selectionLocked}
                onClick={() => props.onSelectMethod('code')}
              >
                <ScanLineIcon aria-hidden="true" /><span>{props.methodLabels.code}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="qx-scroll cashier-qx-scroll">
        <section className="qx-state cashier-qx-state" data-tone={copy.tone === 'error' ? 'error' : 'info'}>
          <span className="qx-state-ic"><StateIcon state={props.state} /></span>
          <div>
            <p className="qx-state-t">{copy.title}</p>
            <p className="qx-state-d">{copy.description}</p>
          </div>
        </section>

        <section className="cashier-qx-main">
          <div className="cashier-qx-amount qx-card">
            <span className="cashier-qx-eyebrow">{amountLabel}</span>
            <strong className="qx-num" data-cashier-amount="">
              {amountAvailable ? formatCents(props.amountCents ?? 0) : '状态未知'}
            </strong>
            <p data-cashier-amount-note={props.displayedChannel === 'sandbox' ? 'sandbox' : 'real'}>
              {props.displayedChannel === 'sandbox'
                ? '测试支付通道，不会真实扣款'
                : amountAvailable
                  ? '金额来自服务端已建订单，前端不重新计算'
                  : '未取得服务端订单金额，不显示估算值'}
            </p>
            <div className="cashier-qx-lines">
              {props.priceLines.length > 0 ? props.priceLines.map((line, index) => (
                <div key={`${line.serviceKey}-${index}`}>
                  <span>{line.description ?? line.serviceKey} · {formatCents(line.unitCents)} × {line.quantity}</span>
                  <b>{formatCents(line.subtotalCents)}</b>
                </div>
              )) : <div><span>价目明细</span><b>以服务端订单为准</b></div>}
            </div>
          </div>

          <div className="cashier-qx-order qx-card">
            <div className="qx-sec-h"><span className="t">订单信息</span></div>
            <dl>
              <div><dt>打印流程</dt><dd>第 {props.step} 步 · 支付</dd></div>
              <div><dt>订单号</dt><dd className="qx-num">{props.orderNo ?? props.orderId ?? '状态未知'}</dd></div>
              <div><dt>支付通道</dt><dd>{channelLabel}</dd></div>
              <div><dt>页面状态</dt><dd>{copy.title}</dd></div>
              <div><dt>出纸条件</dt><dd>{props.canProceed ? '服务端已确认 paid' : '尚未满足'}</dd></div>
            </dl>
            <div className="cashier-qx-truth">
              <ShieldCheckIcon aria-hidden="true" />
              <span>支付结果、退款结果与金额均以服务端订单为准；本页不会因倒计时或点击动作自行判成功。{props.refundAssistanceCopy}</span>
            </div>
          </div>
        </section>

        {showPaymentPanel ? (
          <section className="qx-card cashier-qx-payment" data-live="true">
            <CashierPaymentPanel
              paymentMethod={props.paymentMethod}
              attemptPaymentMethod={props.snapshot?.attempt?.qrCodeContent === null ? 'code' : props.snapshot?.attempt ? 'qr' : null}
              snapshot={props.snapshot}
              view={props.view}
              channelsLoading={props.state === 'channel-loading'}
              issuing={props.issuing}
              codeSubmitting={props.codeSubmitting}
              authCodeBufferRef={props.authCodeBufferRef}
              qrContent={props.qrContent}
              remainSec={props.remainSec}
              reconciling={props.reconciling}
              canReissue={props.canReissue}
              isDevSandbox={props.isDevSandbox}
              canProceed={props.canProceed}
              onSubmitCode={props.onSubmitCode}
              onReconcile={props.onReconcile}
              onReissue={props.onReissue}
              onSimulateSandbox={props.onSimulateSandbox}
            />
          </section>
        ) : null}

        <section className="cashier-qx-guidance qx-card qx-grow">
          <CircleHelpIcon aria-hidden="true" />
          <div>
            <h2>付款提示</h2>
            <ol>
              <li><b>核对金额。</b> 只认当前订单返回的实际金额。</li>
              <li><b>只操作一次。</b> 未确认前不要重复扫码或重复出示付款码。</li>
              <li><b>等待服务端结果。</b> 未到 paid 终态，打印任务不会释放。</li>
            </ol>
          </div>
        </section>

        {props.issueError ? (
          <div className="cashier-qx-error" role="alert"><AlertTriangleIcon aria-hidden="true" />{props.issueError}</div>
        ) : null}
      </div>
    </div>
  )
}
