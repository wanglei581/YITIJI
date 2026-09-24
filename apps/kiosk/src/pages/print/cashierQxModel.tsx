// 收银台 · 青序流光的状态与文案真值（稿 32-cashier / 37-pay-states）。
// 状态推导只读服务端快照与页面已知事实；文案里的通道名、金额都来自服务端，
// 呈现组件在 components/CashierQxView.tsx，本文件不渲染页面结构。
import type { ReactNode } from 'react'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  FileXIcon,
  InfoIcon,
  LockIcon,
  QrCodeIcon,
  ScanLineIcon,
  Undo2Icon,
} from 'lucide-react'
import { PAY_CHANNEL_LABEL } from './cashierStatus'
import type { CashierSnapshot, PaymentMethod } from './CashierPaymentPanel'

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

/* ── 文案真值 ─────────────────────────────────────────────────────
 * 逐态对齐稿 32-cashier 的 ASK（小青意图带）/ PILL（顶栏胶囊）/ 状态块 / 订单行。
 * 只用服务端给的事实：通道名来自已启用通道与支付尝试，金额来自已建订单；
 * 没拿到的就不写（通道未知时不点名任何一家，不猜）。 */

export type Kind = 'info' | 'warn' | 'error' | 'lock'
export type ChipTone = 'ok' | 'warn' | 'bad' | undefined
export type Row = readonly [string, string]

export interface CopyContext {
  /** 本次通道展示名；未确认时为空串。 */
  label: string
  /** 本机已启用通道的展示名，「或」连接。 */
  enabledNames: string
  single: boolean
  sandbox: boolean
  /** 这一单是否已经创建过支付尝试（金额已随订单锁定，改参数只能重新下单）。 */
  locked: boolean
  free: boolean
  multi: boolean
}

export interface StateCopy {
  kind: Kind
  icon: ReactNode
  title: string
  paras: ReactNode[]
  chips: Array<readonly [ChipTone, string]>
  ask: readonly [ReactNode, ReactNode]
  rows: Row[]
}

const LOCKED_NOTE = (
  <>这一单<b>已经创建过支付尝试</b>：金额沿用本单已建订单的结果，不会重新报价；要改打印参数，只能<b>重新下单</b>，从选文件那一步重走一遍。</>
)

export function copyFor(state: CashierQxState, c: CopyContext): StateCopy {
  const ch = c.label
  switch (state) {
    case 'no-order':
      return {
        kind: 'warn', icon: <FileXIcon aria-hidden="true" />, title: '没有待支付的订单',
        paras: [
          <>收银台要有<b>已经建好的订单</b>才能收款。你可能是从旧链接直接进来的，或者这一单已经办完了。</>,
          '想查已经下过的单，去「我的打印订单」；想重新打，回选文件那一步。',
        ],
        chips: [], rows: [],
        ask: [<>这里<em>没有订单</em>。</>, '没有订单就没有收款。回上一步重新发起，或去我的打印订单查。'],
      }
    case 'session-expired':
      return {
        kind: 'warn', icon: <Clock3Icon aria-hidden="true" />, title: '当前支付页面已失效',
        paras: [<>订单仍然保留，请从「我的打印订单」重新进入。<b>重新进入不会重复扣款。</b></>],
        chips: [['warn', '当前页面已失效'], [undefined, '订单仍保留']],
        rows: [['下一步', '从订单列表重新进入']],
        ask: [<>这单的<em>会话过期了</em>。</>, '订单还在服务端，只是这台机器暂时查不到。重新进一次就行。'],
      }
    case 'free-order':
      return {
        kind: 'info', icon: <CheckCircle2Icon aria-hidden="true" />, title: '本次无需付款',
        paras: ['订单已经创建，可以直接开始打印。'],
        chips: [['ok', '订单已建立'], [undefined, '无需付款'], [undefined, '本次未收款']],
        rows: [['收款情况', '本次未收款'], ['下一步', '开始打印']],
        ask: [<>这一单<em>不用付款</em>。</>, <>服务端报价为 0。<b>订单已经建好了</b>，我只负责把任务释放给打印机。</>],
      }
    case 'channel-loading':
      return {
        kind: 'info', icon: <Clock3Icon aria-hidden="true" />, title: '正在加载支付方式',
        paras: [<>读到本机已启用的支付通道后，才会列出可选项；再选择扫屏幕码或出示付款码。<b>没读到之前不会替你选。</b></>],
        chips: [[undefined, '正在加载'], [undefined, '尚未发起支付']],
        rows: [['支付状态', '尚未发起支付']],
        ask: [<>正在看<em>能怎么付</em>。</>, '读到已启用的通道之前不出码，免得你扫到一张废码。'],
      }
    case 'channel-empty':
      return {
        kind: 'lock', icon: <LockIcon aria-hidden="true" />, title: '当前设备暂不支持在线付款',
        paras: ['订单已保留，本次没有发起支付。请联系现场工作人员处理。'],
        chips: [['bad', '暂不支持在线付款'], [undefined, '订单已保留']],
        rows: [['可用通道', '无'], ['本机是否发起支付', '否']],
        ask: [<>这台机器<em>收不了款</em>。</>, '管理员还没开通任何收款方式。订单在，本机没有发起支付。'],
      }
    case 'channel-failed':
      return {
        kind: 'error', icon: <AlertTriangleIcon aria-hidden="true" />, title: '支付方式加载失败',
        paras: ['本次没有发起支付。请检查网络后重新读取支付通道。'],
        chips: [['bad', '加载失败'], [undefined, '尚未发起支付']],
        rows: [['通道请求', '失败'], ['本机是否发起支付', '否']],
        ask: [<>支付通道<em>没读到</em>。</>, '读不到就不出码。这个状态下本机没有发起任何支付。'],
      }
    case 'pending':
      return {
        kind: 'info', icon: <InfoIcon aria-hidden="true" />,
        title: c.locked ? '请重新选择支付通道' : '请先选择支付通道',
        paras: [
          <>本机当前已启用{c.enabledNames}，请在上方选一个。{c.locked ? null : <b>选定通道后再选扫码方式，创建支付尝试后两者都会锁定。</b>}</>,
          ...(c.locked ? [LOCKED_NOTE] : []),
        ],
        chips: c.locked
          ? [['warn', '上一次尝试已结束'], [undefined, '金额已锁定'], [undefined, '先选通道']]
          : [['ok', '尚未发起支付'], [undefined, '先选通道']],
        rows: [['支付状态', c.locked ? '上一次尝试已结束，本次尚未重新出码' : '尚未发起'], ['下一步', '选择一个支付通道']],
        ask: c.locked
          ? [<>这一单<em>再付一次</em>。</>, <>上一次尝试已经结束。<b>金额沿用这一单已建订单的结果</b>，通道和扫码方式可以重新选。</>]
          : [<>先选<em>支付通道</em>。</>, `本机已启用${c.enabledNames}。选完再选扫码方式，创建尝试前都可以改。`],
      }
    case 'channel-selected':
      return {
        kind: 'info', icon: <InfoIcon aria-hidden="true" />, title: '通道已选，请选择扫码方式',
        paras: [
          <>
            {c.single ? `本机当前只启用了${ch}，已经直接用它。` : `当前选择${ch}。`}
            现在选择“手机扫屏幕上的码”或“出示你的付款码”。
            <b>选屏幕上的码会立刻出码并锁定通道与方式；选付款码只是开始等扫码器读数，读满并提交后才锁定。</b>
          </>,
          ...(c.sandbox ? [<><b>{ch}不会真实收款</b>，只用于内部联调；正式对外营业不会出现这个通道。</>] : []),
          ...(c.locked ? [LOCKED_NOTE] : []),
        ],
        chips: [['ok', ch], [undefined, '尚未创建尝试']],
        rows: [['下一步', '选择扫码方式']],
        ask: c.locked
          ? [<>这一单<em>再付一次</em>。</>, <>上一次尝试已经结束。<b>金额沿用这一单已建订单的结果</b>，扫码方式可以重新选。</>]
          : c.single
            ? [<>本机只有<em>{ch}</em>。</>, '没启用的通道不会摆出来。选屏幕上的码会立刻出码并锁定；选付款码要等读满并提交后才锁定。']
            : [<>再选<em>扫码方式</em>。</>, '通道已经选好。选屏幕上的码会立刻出码并锁定；选付款码要等机器读满并提交后才锁定。'],
      }
    case 'pending-qr':
      return {
        kind: 'info', icon: <QrCodeIcon aria-hidden="true" />, title: '请扫码支付',
        paras: [<>支付尝试已经创建。<b>请勿切换方式、重复付款或重新下单。</b></>],
        chips: [], rows: [['支付状态', '等待付款']],
        ask: [<>付款<em>成没成</em>，服务端说了算。</>, <>屏幕上这张码，<b>本机看不到你扫没扫</b>。只有服务端支付状态变成已付，才会去出纸。</>],
      }
    case 'pending-scan':
      return {
        kind: 'info', icon: <ScanLineIcon aria-hidden="true" />, title: '请出示手机付款码',
        paras: [<>把{ch}付款码对准设备扫码窗口。<b>现在还没有向支付平台发起收款</b>，读满十八位并提交后才会创建支付尝试。</>],
        chips: [], rows: [['扫码方式', '出示付款码'], ['支付状态', '尚未提交付款码']],
        ask: [<>这次是<em>机器扫你</em>。</>, <>把手机付款码对准扫码窗口。<b>现在还没有发起支付</b>，读满并提交后才送出，送出也不代表付成了。</>],
      }
    case 'awaiting-code-confirmation':
      return {
        kind: 'info', icon: <Clock3Icon aria-hidden="true" />, title: '正在确认付款结果',
        paras: [<>付款码已提交，支付平台正在确认。<b>请勿重复出示付款码或重新下单。</b></>],
        chips: [[undefined, '确认中'], ['warn', '请勿重复出示']],
        rows: [['付款码', '已提交，不会保存在页面'], ['支付状态', '正在确认']],
        ask: [<>码送出去了，<em>等回话</em>。</>, '别重复出示，也别重新下单。结果只认服务端。'],
      }
    case 'pending-verification':
      return {
        kind: 'warn', icon: <AlertTriangleIcon aria-hidden="true" />, title: '付款结果暂未确认',
        paras: [<>请先查看你的{ch || '支付'}账单，<b>不要重复付款</b>。仍无法确认时请联系工作人员。</>],
        chips: [['warn', '结果未确认'], ['bad', '请勿重复扫码']],
        rows: [['本次支付', '结果暂未确认'], ['下一步', `先查${ch || '支付'}账单`]],
        ask: [<>结果<em>还没定</em>。</>, <>渠道可能还在处理。<b>先核实，别重复扫码。</b></>],
      }
    case 'paid':
      return {
        kind: 'info', icon: <CheckCircle2Icon aria-hidden="true" />, title: '付款已由服务端确认',
        paras: ['系统正在创建或恢复同一打印任务，不会再次发起收款。'],
        chips: [['ok', '已付款（服务端确认）'], [undefined, '正在准备打印']],
        rows: [['支付状态', '已付款（服务端确认）'], ['下一步', '进入打印进度']],
        ask: [<>服务端说<em>已付</em>。</>, '这是服务端确认的最终结果，不是我猜的。接下来创建并查看打印任务。'],
      }
    case 'release-failed':
      return c.free
        ? {
            kind: 'warn', icon: <AlertTriangleIcon aria-hidden="true" />, title: '本次无需付款，打印任务尚未建立',
            paras: [
              <>订单已经创建，<b>本机没有向你收过钱</b>，只是这次创建打印任务没有完成。</>,
              <>重试只会重新创建同一个打印任务，<b>不会发起收款，也不会另开新订单</b>。</>,
            ],
            chips: [['ok', '订单已建立'], [undefined, '本次未收款'], ['warn', '打印任务待恢复']],
            rows: [['收款情况', '本次未收款'], ['打印任务', '尚未建立']],
            ask: [<>这一单<em>本来就没收钱</em>，任务没建成。</>, '本次未收款。这里只重试创建同一打印任务，不会向你收款。'],
          }
        : {
            kind: 'warn', icon: <AlertTriangleIcon aria-hidden="true" />, title: '付款已确认，打印任务尚未建立',
            paras: [<>服务端已经确认这笔{ch}付款成功，但本次创建打印任务没有完成。<b>不要重新付款</b>，请重试创建同一打印任务。</>],
            chips: [['ok', '已付款'], ['warn', '打印任务待恢复']],
            rows: [['支付状态', '已付款（服务端确认）'], ['打印任务', '尚未建立']],
            ask: [<>钱已付，<em>任务没建成</em>。</>, '不要再付款。这里只重试创建同一打印任务。'],
          }
    case 'display-expired-reconciling':
      return {
        kind: 'warn', icon: <Clock3Icon aria-hidden="true" />, title: '收款码到期核验中',
        paras: [<>收款码的显示有效期已到，但这不代表渠道已经关单。<b>正在确认付款结果，请勿重复支付。</b></>],
        chips: [['warn', '正在确认'], ['bad', '勿重复支付']],
        rows: [['支付状态', '正在确认']],
        ask: [<>这张码<em>不显示了</em>。</>, <>但不代表渠道已经关单。<b>先对账，未确认前别重复支付。</b></>],
      }
    case 'expired':
      return {
        kind: 'warn', icon: <Clock3Icon aria-hidden="true" />, title: '屏上收款码已过期',
        paras: [
          <>服务端确认这张收款码已经失效。<b>订单本身还在，可以重新出一张码。</b></>,
          '这和「订单已超时关闭」不是一回事：那种情况订单已经关了，不能再出码。',
          LOCKED_NOTE,
        ],
        chips: [['warn', '收款码过期'], ['ok', '订单未关闭'], [undefined, '可重新出码'], [undefined, '金额已锁定']],
        rows: [['收款码状态', '已过期（服务端确认）'], ['订单状态', '未关闭，可重新出码']],
        ask: [<>收款码<em>过期了</em>。</>, '订单还在，重新出一张码就行。'],
      }
    case 'attempt-failed':
      return {
        kind: 'error', icon: <AlertTriangleIcon aria-hidden="true" />, title: '这次支付尝试没有完成',
        paras: [
          <>服务端确认上一次{ch}支付尝试已经失败，<b>旧码不能再扣款</b>。订单本身仍未关闭，可以重新发起一次。</>,
          LOCKED_NOTE,
        ],
        chips: [['bad', '旧尝试已失败'], ['ok', '订单未关闭'], [undefined, '可重新支付'], [undefined, '金额已锁定']],
        rows: [['支付尝试', '失败（服务端确认）'], ['订单状态', '未关闭，可重试']],
        ask: [<>旧尝试<em>已经失败</em>。</>, c.multi ? '服务端确认旧码不能再扣款，订单还在，可以重新发起或换个通道。' : '服务端确认旧码不能再扣款，订单还在，可以重新发起。'],
      }
    case 'attempt-channel-unknown':
      return {
        kind: 'warn', icon: <AlertTriangleIcon aria-hidden="true" />, title: '这一单用的哪个支付通道，本机没确认',
        paras: [
          <>本机没有拿到这次支付使用的支付通道，所以<b>不出码，也不判断这次付款成没成</b>。</>,
          <>请从「我的打印订单」重新进入这一单查看最新结果。<b>已经付过的钱不会因为这个页面丢失。</b></>,
        ],
        chips: [['warn', '通道未确认'], [undefined, '不出码'], [undefined, '不判成败']],
        rows: [['支付通道', '本机未确认'], ['能否出码', '否']],
        ask: [<>这一单<em>走哪个通道，我没确认</em>。</>, '没确认就不出码、不判成败。从我的打印订单重新进这一单。'],
      }
    case 'order-failed':
      return {
        kind: 'error', icon: <AlertTriangleIcon aria-hidden="true" />, title: '订单支付已失败',
        paras: [<>服务端把订单支付状态记为失败终态。<b>这张订单不能继续付款，也不能再出码。</b>如支付账单有扣款记录，请联系工作人员核对。</>],
        chips: [['bad', '订单支付失败'], [undefined, '禁止重新付款']],
        rows: [['订单支付状态', '失败（服务端确认）'], ['能否再付', '不能，需重新下单']],
        ask: [<>订单支付<em>已经失败</em>。</>, '这是订单终态，不能再付；要打印请重新下单。'],
      }
    case 'closed':
      return {
        kind: 'error', icon: <AlertTriangleIcon aria-hidden="true" />, title: '订单已超时关闭',
        paras: [
          '服务端确认这张订单已经关闭。这张订单不能再出收款码，也不能继续支付。',
          '要打的话，回去重新发起一次打印，重新报价、重新下单。如果你的支付账单里确实有这一笔，请拿订单号找工作人员核对。',
        ],
        chips: [['bad', '订单已关闭'], [undefined, '不能再出码']],
        rows: [['订单状态', '已关闭（服务端确认）'], ['能否再付', '不能，需重新下单']],
        ask: [<>订单<em>已经关了</em>。</>, '不能再付。要打的话重新来一次。'],
      }
    case 'refunding':
      return {
        kind: 'warn', icon: <Undo2Icon aria-hidden="true" />, title: '这一单正在退款',
        paras: [
          <>服务端返回订单处于<b>退款处理中</b>。退款尚未完成，这类订单一律不放行出纸。</>,
          '退款到账时间以支付渠道为准，本机不预告到账时间，也不代为催办。',
        ],
        chips: [['warn', '退款处理中'], [undefined, '不放行出纸']],
        rows: [['订单状态', '退款处理中（服务端确认）'], ['能否出纸', '否']],
        ask: [<>这单<em>正在退款</em>。</>, '退款尚未完成，不能出纸。到账时间以渠道为准。'],
      }
    case 'partial-refunded':
      return {
        kind: 'warn', icon: <Undo2Icon aria-hidden="true" />, title: '这一单发生了部分退款',
        paras: [
          <>服务端返回订单处于<b>部分退款</b>状态。订单金额只退回了一部分，但这类订单仍然一律不放行出纸。</>,
          '具体退款金额、剩余金额与到账结果以订单详情和支付渠道账单为准。本机不自行计算，也不提供继续支付或继续打印入口。',
        ],
        chips: [['warn', '部分退款'], [undefined, '不放行出纸']],
        rows: [['订单状态', '部分退款（服务端确认）'], ['能否出纸', '否']],
        ask: [<>这单<em>只退了一部分</em>。</>, '部分退款后同样不能出纸。金额只认服务端订单详情与支付渠道账单。'],
      }
    case 'refunded':
      return {
        kind: 'error', icon: <Undo2Icon aria-hidden="true" />, title: '这一单已经退款',
        paras: [
          <>服务端返回订单<b>退款已完成</b>。这张订单不能再出纸；如需打印，请重新发起一张新订单。</>,
          '实际到账以支付渠道账单为准，本机不预告到账时间。',
        ],
        chips: [['bad', '退款已完成'], [undefined, '不放行出纸']],
        rows: [['订单状态', '已退款（服务端确认）'], ['能否出纸', '否']],
        ask: [<>这单<em>已经退款</em>。</>, '退款完成，不能出纸；需要打印请重新下单。'],
      }
  }
}

/** 顶栏胶囊（稿 32 PILL / pillFor）。拿不到确定结论的一律 unknown，不默认 ok。 */
export function cashierQxPill(state: CashierQxState, opts: { locked: boolean; free: boolean; single: boolean }): {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
} {
  if (opts.locked && (state === 'pending' || state === 'channel-selected')) return { tone: 'warn', label: '重新出码 · 沿用本单金额' }
  if (state === 'release-failed' && opts.free) return { tone: 'warn', label: '无需付款 · 打印任务待恢复' }
  if (state === 'channel-selected' && opts.single) return { tone: 'unknown', label: '唯一可用通道 · 请选择扫码方式' }
  const PILL: Record<CashierQxState, readonly ['ok' | 'warn' | 'bad' | 'unknown', string]> = {
    'no-order': ['warn', '没有待支付的订单'],
    'session-expired': ['warn', '支付会话已过期'],
    'free-order': ['ok', '无需付款 · 订单已建立'],
    'channel-loading': ['unknown', '正在读取支付通道'],
    'channel-empty': ['bad', '未启用任何支付通道'],
    'channel-failed': ['bad', '支付通道读取失败'],
    pending: ['unknown', '请选择支付通道'],
    'channel-selected': ['unknown', '通道已选 · 请选择扫码方式'],
    'pending-qr': ['unknown', '等待支付 · 未确认'],
    'pending-scan': ['unknown', '等待读取付款码 · 未发起支付'],
    'awaiting-code-confirmation': ['unknown', '渠道确认中 · 未确认'],
    'pending-verification': ['warn', '支付状态待核实'],
    paid: ['ok', '服务端确认已付'],
    'release-failed': ['warn', '已付款 · 打印任务待恢复'],
    'display-expired-reconciling': ['warn', '收款码到期核验中'],
    expired: ['warn', '收款码已过期'],
    'attempt-failed': ['bad', '旧支付尝试已失败'],
    'attempt-channel-unknown': ['warn', '支付通道未确认'],
    'order-failed': ['bad', '订单支付已失败'],
    closed: ['bad', '订单已超时关闭'],
    refunding: ['warn', '退款处理中'],
    'partial-refunded': ['warn', '订单已部分退款'],
    refunded: ['bad', '退款已完成'],
  }
  const [tone, label] = PILL[state]
  return { tone, label }
}

/** 付款列放「支付工具」（屏上码 / 扫码器 / 已失效的码）的状态；其余状态付款列放金额卡。 */
export const INSTRUMENT_STATES: ReadonlySet<CashierQxState> = new Set([
  'pending-qr',
  'pending-scan',
  'awaiting-code-confirmation',
  'pending-verification',
  'display-expired-reconciling',
  'expired',
  'attempt-failed',
])
/** 两层选择条上用哪一种扫码方式（稿 32 MODE）：已有尝试时以服务端尝试为准。 */
export const PICKERS_ENABLED: ReadonlySet<CashierQxState> = new Set(['pending', 'channel-selected', 'pending-scan'])
/** 没有通道可摆时，两格各换成一句说明（稿 32 picker-note）；不摆假按钮。 */
export function pickerNote(state: CashierQxState, free: boolean, channelCount: number): readonly [string, string] | null {
  if (free || state === 'no-order' || state === 'session-expired') return ['本次不涉及付款', '本次不需要扫码']
  if (state === 'channel-loading') return ['正在读取本机可用的支付通道', '读到通道后才能选择']
  if (state === 'channel-failed') return ['暂时读不到本机可用的支付通道', '没有可用支付通道，暂不能扫码']
  if (state === 'channel-empty') return ['本机未启用任何支付通道', '没有可用支付通道，暂不能扫码']
  if (channelCount === 0) return ['当前没有可选的支付通道', '当前不能扫码']
  return null
}

/** 付款列里那张「已经不能用的码 / 尝试」卡：页面状态块讲结论，这张卡只讲这张码本身。 */
export const TERMINAL_CARD: Partial<Record<CashierQxState, readonly [string, string]>> = {
  expired: ['这张收款码已失效', '服务端已确认这张码不能再付款，屏幕上不再显示可扫的码。重新出码沿用本单金额。'],
  'display-expired-reconciling': ['收款码已停止显示', '显示有效期已到，屏幕上不再显示这张码；渠道是否已经关单仍在核实，确认前请勿重复支付。'],
  'attempt-failed': ['上一次支付尝试已结束', '服务端确认这次尝试已失败，旧码不能再扣款。'],
}

export function channelLabelOf(key: string | null | undefined): string {
  return key ? PAY_CHANNEL_LABEL[key] ?? key : ''
}
