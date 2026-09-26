import type { ReactNode } from 'react'
import { AlertTriangleIcon, FileXIcon, QrCodeIcon, ScanLineIcon } from 'lucide-react'
import type { PrintJobParams, PrintPriceLine } from '@ai-job-print/shared'
import type { CashierView } from '../cashierStatus'
import { formatCents } from '../cashierStatus'
import type { CashierSnapshot, PaymentMethod } from '../CashierPaymentPanel'
import { CashierPaymentPanel } from '../CashierPaymentPanel'
import { COLOR_MODE_LABEL, DUPLEX_LABEL } from '../printConfirmModel'
import type { PrintFileState } from '../printMaterialSession'
import {
  channelLabelOf,
  copyFor,
  INSTRUMENT_STATES,
  pickerNote,
  PICKERS_ENABLED,
  TERMINAL_CARD,
  type CashierQxState,
  type CopyContext,
  type Row,
} from '../cashierQxModel'

interface CashierQxViewProps {
  step: 5
  state: CashierQxState
  orderNo?: string
  orderId: string | null
  amountCents: number | null
  priceLines: PrintPriceLine[]
  file: PrintFileState | null
  params: PrintJobParams | null
  channels: string[]
  selectedChannel: string | null
  displayedChannel: string | null
  paymentMethod: PaymentMethod | null
  displayedPaymentMethod: PaymentMethod | null
  snapshot: CashierSnapshot | null
  view: CashierView | null
  /** 这一单是否已经创建过支付尝试。 */
  amountLocked: boolean
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
  methodLabels: {
    readonly qr: { readonly name: string; readonly action: string; readonly desc: string }
    readonly code: { readonly name: string; readonly action: string; readonly desc: string }
  }
  onSelectMethod: (method: PaymentMethod) => void
  onSubmitCode: () => void
  onReconcile: () => void
  onReissue: () => void
  onSimulateSandbox: (result: 'success' | 'failed') => void
}
export function CashierQxView(props: CashierQxViewProps) {
  const { state } = props
  const attemptChannel = props.snapshot?.attempt?.channel || null
  const channelKey = state === 'attempt-channel-unknown' ? null : attemptChannel ?? props.displayedChannel
  const label = channelLabelOf(channelKey)
  const free = (props.amountCents ?? 1) <= 0
  const ctx: CopyContext = {
    label,
    enabledNames: props.channels.map(channelLabelOf).join('或') || '支付通道',
    single: props.channels.length === 1,
    multi: props.channels.length > 1,
    sandbox: channelKey === 'sandbox',
    locked: props.amountLocked,
    free,
  }
  const copy = copyFor(state, ctx)
  const instrument = INSTRUMENT_STATES.has(state)
  // 解释卡放在较矮的那一栏（稿 32 的做法）：付款码读取卡比右栏矮，所以 pending-scan 放左栏。
  const noteInPaycol = !instrument || state === 'pending-scan'
  const pickersEnabled = PICKERS_ENABLED.has(state) && !props.selectionLocked
  const activeMethod = props.displayedPaymentMethod
    ?? (props.snapshot?.attempt ? (props.snapshot.attempt.qrCodeContent === null ? 'code' : 'qr') : null)

  return (
    <div className="cashier-qx-page" data-qx-state={state}>
      <div className="qx-scroll cashier-qx-scroll">
        <section className="cashier-qx-xq" aria-label="小青提示">
          <div className="cashier-qx-xq-row">
            <div className="cashier-qx-xq-face" aria-hidden="true">青</div>
            <div className="cashier-qx-xq-main">
              <div className="cashier-qx-xq-eyebrow">CASHIER · 打印第 {props.step} 步 · 支付</div>
              <p className="cashier-qx-xq-ask">{copy.ask[0]}</p>
              <p className="cashier-qx-xq-doing">{copy.ask[1]}</p>
            </div>
          </div>
        </section>

        <Pickers
          {...props}
          enabled={pickersEnabled}
          activeChannel={channelKey}
          activeMethod={activeMethod}
          note={pickerNote(state, free, props.channels.length)}
        />

        <section className="cashier-qx-state" data-kind={copy.kind}>
          <h2 className="cashier-qx-state-h">
            {copy.icon}
            <span className="qx-state-t">{copy.title}</span>
          </h2>
          {copy.paras.map((para, index) => <p key={index} className="cashier-qx-p">{para}</p>)}
          {copy.chips.length > 0 ? (
            <div className="cashier-qx-chips">
              {copy.chips.map(([tone, text]) => <span key={text} className="cashier-qx-chip" data-tone={tone}>{text}</span>)}
            </div>
          ) : null}
        </section>

        {state === 'no-order' ? null : (
          <section className="cashier-qx-paywrap">
            <div className="cashier-qx-paycol">
              {instrument ? <Instrument {...props} ctx={ctx} /> : <AmountCard {...props} free={free} />}
              {noteInPaycol ? <SideNote state={state} ctx={ctx} /> : null}
            </div>
            <div className="cashier-qx-side">
              {instrument ? <AmountCard {...props} free={free} /> : null}
              <OrderInfo {...props} channelLabel={label} rows={copy.rows} />
              {noteInPaycol ? null : <SideNote state={state} ctx={ctx} />}
            </div>
          </section>
        )}

        <Closure state={state} ctx={ctx} />

        {props.issueError ? (
          <div className="cashier-qx-error" role="alert"><AlertTriangleIcon aria-hidden="true" />{props.issueError}</div>
        ) : null}
      </div>
    </div>
  )
}

/* ── 两层选择条 ───────────────────────────────────────────────────
 * 只渲染服务端已启用的通道；没有通道时整格换成说明，不摆假按钮。
 * 可点与否沿用真实状态机（PICKERS_ENABLED + 支付尝试锁），锁定后仍亮出本单用的是哪一个。 */
function Pickers(props: CashierQxViewProps & {
  enabled: boolean
  activeChannel: string | null
  activeMethod: PaymentMethod | null
  note: readonly [string, string] | null
}) {
  const busy = props.issuing || props.codeSubmitting
  const channelDisabled = !props.enabled || busy
  const methodDisabled = !props.enabled || busy || !props.selectedChannel
  const showChannels = !props.note
  return (
    <section className="cashier-qx-modes" aria-label="支付方式选择">
      <div className="cashier-qx-picker" data-kind="channels">
        <span className="cashier-qx-picker-label">支付通道</span>
        {showChannels ? props.channels.map((channel) => (
          <button
            key={channel}
            type="button"
            className="cashier-qx-channel"
            data-active={props.activeChannel === channel ? 'true' : undefined}
            aria-pressed={props.activeChannel === channel}
            disabled={channelDisabled}
            onClick={() => props.onSelectChannel(channel)}
          >
            <span>{channelLabelOf(channel)}</span>
            {channel === 'sandbox' ? <small>非真实收款</small> : null}
          </button>
        )) : <span className="cashier-qx-picker-note">{props.note?.[0]}</span>}
      </div>
      <div className="cashier-qx-picker" data-kind="methods">
        <span className="cashier-qx-picker-label">扫码方式</span>
        {showChannels ? (['qr', 'code'] as const).map((method) => {
          const labels = props.methodLabels[method]
          return (
            <button
              key={method}
              type="button"
              className="cashier-qx-mode"
              data-active={props.activeMethod === method ? 'true' : undefined}
              aria-pressed={props.activeMethod === method}
              disabled={methodDisabled}
              onClick={() => props.onSelectMethod(method)}
            >
              <span className="cashier-qx-mode-ic">{method === 'qr' ? <QrCodeIcon aria-hidden="true" /> : <ScanLineIcon aria-hidden="true" />}</span>
              <span className="cashier-qx-mode-tx">
                <b>{labels.action}</b>
                <small>{labels.name} · {labels.desc}</small>
              </span>
            </button>
          )
        }) : <span className="cashier-qx-picker-note">{props.note?.[1]}</span>}
      </div>
    </section>
  )
}

function AmountCard(props: CashierQxViewProps & { free: boolean }) {
  const { state } = props
  const known = props.amountCents !== null && state !== 'session-expired' && state !== 'attempt-channel-unknown'
  const label = state === 'paid' || (state === 'release-failed' && !props.free)
    ? '已付金额'
    : state === 'order-failed' || state === 'closed'
      ? '原应付金额'
      : state === 'refunding' || state === 'partial-refunded' || state === 'refunded'
        ? '原订单金额'
        : '本次应付'
  const sandbox = props.displayedChannel === 'sandbox' || props.snapshot?.attempt?.channel === 'sandbox'
  const note = sandbox
    ? '测试支付通道，不会真实扣款'
    : !known
      ? '金额暂不可用，请从我的打印订单重新进入查看。'
      : props.free
        ? '本单实付 0 元 · 服务端报价为 0，本次未收款'
        : state === 'refunding' || state === 'partial-refunded' || state === 'refunded'
          ? '本单实付金额来自服务端订单；退款金额与到账时间以支付渠道账单为准，本机不估算'
          : state === 'expired' || state === 'attempt-failed'
            ? '本单实付金额来自服务端已建订单；重新发起仍按这一金额收款'
            : '本单实付金额 · 来自服务端已建订单，前端不重新计算'
  return (
    <div className="cashier-qx-amount">
      <div className="cashier-qx-amount-lb">{label}</div>
      {known ? (
        <strong className="cashier-qx-amount-num" data-cashier-amount="" data-quote-status="known">
          {formatCents(props.amountCents ?? 0)}
        </strong>
      ) : (
        <strong className="cashier-qx-amount-num" data-quote-status="unavailable">金额暂不可用</strong>
      )}
      <p className="cashier-qx-amount-src" data-cashier-amount-note={sandbox ? 'sandbox' : 'real'}>{note}</p>
      {known && props.priceLines.length > 0 ? (
        <div className="cashier-qx-ledger" aria-label="价目明细">
          {props.priceLines.map((line, index) => (
            <div key={`${line.serviceKey}-${index}`}>
              <span>{priceLineLabel(line)} · {formatCents(line.unitCents)} × {line.quantity}</span>
              <b>{formatCents(line.subtotalCents)}</b>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 价目行只写服务项本身。后台价目的 description 是给运营看的（曾出现「免费试运营 0 元/页」
 *  与实收单价并存的情况），照抄到收银台会让用户看到与金额矛盾的说法。 */
function priceLineLabel(line: PrintPriceLine): string {
  if (line.serviceKey === 'print_bw_page') return '黑白打印'
  if (line.serviceKey === 'print_color_page') return '彩色打印'
  return line.description ?? line.serviceKey
}

function OrderInfo(props: CashierQxViewProps & { channelLabel: string; rows: Row[] }) {
  const rows: Row[] = [['订单号', props.orderNo ?? props.orderId ?? '状态未知']]
  if (props.file?.name) {
    const parts = [props.file.name]
    if (props.file.pages !== null && props.file.pages !== undefined) parts.push(`${props.file.pages} 页`)
    if (props.params?.copies) parts.push(`${props.params.copies} 份`)
    rows.push(['内容', parts.join(' · ')])
  }
  if (props.params) {
    const params = [
      props.params.paperSize,
      COLOR_MODE_LABEL[props.params.colorMode] ?? null,
      DUPLEX_LABEL[props.params.duplex] ?? null,
    ].filter(Boolean)
    if (params.length > 0) rows.push(['参数', params.join(' · ')])
  }
  if (props.channelLabel && !props.rows.some(([key]) => key === '支付通道')) rows.push(['支付通道', props.channelLabel])
  rows.push(...props.rows)
  return (
    <section className="cashier-qx-group" aria-label="订单信息">
      <h3>订单信息</h3>
      <dl className="cashier-qx-kv">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd className={key === '订单号' ? 'qx-num' : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="cashier-qx-p">{props.refundAssistanceCopy}。</p>
    </section>
  )
}

/** 付款列：真实屏上码 / 扫码器读付款码 / 已失效的码，全部由 CashierPaymentPanel 按服务端快照渲染。 */
function Instrument(props: CashierQxViewProps & { ctx: CopyContext }) {
  const { state } = props
  const waiting = state === 'awaiting-code-confirmation' || state === 'pending-verification'
  return (
    <>
      {waiting ? <ProgressSteps state={state} /> : null}
      <div className={`cashier-qx-instrument${state === 'pending-scan' ? ' cashier-qx-hid' : ''}`} data-live={state === 'pending-qr' || state === 'pending-scan' ? 'true' : undefined}>
        <CashierPaymentPanel
          titleShownByPage
          terminalTitle={TERMINAL_CARD[state]?.[0]}
          terminalDescription={TERMINAL_CARD[state]?.[1]}
          terminalActionShownByPage={state === 'expired' || state === 'attempt-failed'}
          paymentMethod={props.paymentMethod}
          attemptPaymentMethod={props.snapshot?.attempt?.qrCodeContent === null ? 'code' : props.snapshot?.attempt ? 'qr' : null}
          snapshot={props.snapshot}
          view={props.view}
          channelsLoading={false}
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
      </div>
    </>
  )
}

/** 到账进度（稿 37 confirming）。三步的状态只由「已有支付尝试、尚未 paid」这两个服务端事实推出。 */
function ProgressSteps({ state }: { state: CashierQxState }) {
  const steps = [
    { title: '付款码已提交', desc: '本次支付尝试已由服务端创建', status: 'done', text: '已提交' },
    {
      title: '等待支付平台回执',
      desc: state === 'pending-verification' ? '渠道结果暂未确认，请先查账单' : '回执到达前不显示任何支付结论',
      status: 'now',
      text: state === 'pending-verification' ? '待核实' : '等待中',
    },
    { title: '服务端确认后释放出纸', desc: '只有服务端确认已付才会创建打印任务', status: 'todo', text: '未开始' },
  ] as const
  return (
    <section className="cashier-qx-group" aria-label="到账进度">
      <h3>到账进度</h3>
      <ol className="cashier-qx-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="cashier-qx-step" data-step={step.status}>
            <span className="cashier-qx-step-ic" aria-hidden="true">{index + 1}</span>
            <span className="cashier-qx-step-tx"><b>{step.title}</b><span>{step.desc}</span></span>
            <span className="cashier-qx-step-st">{step.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** 稿 32 的「第二遍解释」卡：只在它讲的事上面没讲过时出现。 */
function SideNote({ state, ctx }: { state: CashierQxState; ctx: CopyContext }) {
  const note: readonly [string, ReactNode] | null =
    state === 'pending' && !ctx.locked
      ? ['为什么分两步选择', '支付通道决定由哪个支付平台收款；扫码方式决定是你扫屏幕，还是本机读取你的付款码。']
      : state === 'channel-selected' && !ctx.locked
        ? ctx.single
          ? ['为什么只有一个', '页面只列出本机已启用的支付通道；没启用的不会摆在这里让你白点。']
          : ['还可以改通道', '本次还没有向支付平台发起收款，所以仍可改选其他通道；出码或提交付款码之后才锁定。']
        : state === 'pending-qr'
          ? ['付款完成后', `页面会自动确认结果。长时间未更新时，可以手动刷新，刷新仍然查这一次${ctx.label}的结果。`]
          : state === 'pending-scan'
            ? ['还能改', '本次还没有发起支付，所以通道和扫码方式都仍可改：可以改回屏幕上的码，也可以在上方换一个通道。付款码提交之后才会锁定。']
            : state === 'display-expired-reconciling'
              ? ['请稍候', '你可能刚好在最后一秒完成付款。确认结果前，请勿再次支付。']
              : state === 'release-failed'
                ? ctx.free
                  ? ['会不会扣钱', '这一单报价为 0，本来就不收款；重试只重新创建打印任务。']
                  : ['为什么不会重新收款', '这里只重试服务端的幂等任务释放，不会再次创建支付尝试。']
                : state === 'attempt-channel-unknown'
                  ? ['为什么不替你挑一个', '猜错会让你扫到一张不属于这一单的码，也可能把别人的付款结果当成你的。宁可这里停住。']
                  : null
  if (!note) return null
  return (
    <section className="cashier-qx-group" aria-label={note[0]}>
      <h3>{note[0]}</h3>
      <p className="cashier-qx-p">{note[1]}</p>
    </section>
  )
}

/** 收尾卡（稿 32 closerScan / closerCard）：吸收竖屏余量，只放判定依据与三条通用动作。 */
function Closure({ state, ctx }: { state: CashierQxState; ctx: CopyContext }) {
  if (state === 'no-order') {
    return (
      <section className="cashier-qx-closure qx-grow" aria-label="没有订单上下文">
        <div className="cashier-qx-empty">
          <span className="cashier-qx-empty-ic"><FileXIcon aria-hidden="true" /></span>
          <span>没有订单上下文。<br /><b>这里不显示金额，也不出码 —— 出一张扫不通的码只会让你白扫。</b></span>
        </div>
      </section>
    )
  }
  if (state === 'display-expired-reconciling') {
    return (
      <section className="cashier-qx-state cashier-qx-closure qx-grow" data-kind="warn" aria-label="请勿重复付款">
        <h2 className="cashier-qx-state-h"><AlertTriangleIcon aria-hidden="true" />请勿重复付款</h2>
        <p className="cashier-qx-p">结果未确认前再次付款，可能产生重复扣款。仍未更新时请查看{ctx.label || '支付'}账单。</p>
        <div className="cashier-qx-chips" style={{ marginTop: 'auto' }}>
          <span className="cashier-qx-chip" data-tone="warn">正在确认</span>
          <span className="cashier-qx-chip" data-tone="bad">勿重复支付</span>
        </div>
      </section>
    )
  }
  const scan = state === 'pending-qr' || state === 'pending-scan'
  const basis = scan
    ? state === 'pending-qr'
      ? '支付尝试已经创建。请勿切换方式、重复付款或重新下单。'
      : '读满十八位并提交后才会向支付平台发起；在那之前仍可改回屏幕上的码或更换通道。'
    : state === 'free-order' || state === 'release-failed'
      ? '本次只恢复或创建打印任务，不进入收款流程。'
      : state === 'paid'
        ? '付款已由服务端确认；接下来去打印进度页查看出纸。'
        : '请按页面提示处理；支付结果长时间未更新时，先查看支付账单。'
  const flow = scan
    ? [['1. 核对金额', '只认当前订单返回的实际金额。'], ['2. 只操作一次', '请勿重复扫码或重复出示手机付款码。'], ['3. 等待结果确认', '付款码不会完整显示或保存在这台机器上。']]
    : [['1. 看清本页结果', '先确认是等待、成功、失败、关闭还是退款。'], ['2. 不重复付款', '结果异常或长时间未更新时，先查看支付账单。'], ['3. 按底部按钮继续', '当前可用的处理动作已经放在屏幕下方。']]
  return (
    <section className="cashier-qx-closure qx-grow" aria-label={scan ? '付款提示' : '接下来怎么办'}>
      <h2>{scan ? '付款提示' : '接下来怎么办'}</h2>
      <p className="cashier-qx-p">{basis}</p>
      <ol className="cashier-qx-flow">
        {flow.map(([title, desc]) => <li key={title}><b>{title}</b><span>{desc}</span></li>)}
      </ol>
    </section>
  )
}

/* ── 底部：禁用原因 / 操作条 / 事实说明条（稿 32 .cta-reason + .ctabar + .truth）── */
export function CashierQxDock({
  reason,
  children,
  billingChannel,
}: {
  reason: string | null
  children: ReactNode
  /** 这一次真的可能扣款的通道；未确认时为 null，不点名任何一家。 */
  billingChannel: string | null
}) {
  return (
    <>
      {reason ? <p className="cashier-qx-cta-reason">{reason}</p> : null}
      <div className="cashier-qx-cta-row">{children}</div>
      <div className="cashier-qx-truth" data-disclaimer="true">
        <p><b>付款安全</b>请勿重复付款；页面会在系统确认结果后更新。付款码不会在屏幕上完整显示或保存。</p>
        <p><b>金额确认</b>只有订单金额明确后才会生成收款码或读取付款码。</p>
        <p>
          <b>异常处理</b>
          {billingChannel === 'sandbox'
            ? '本次走的是测试支付通道，不产生真实账单；结果长时间未更新时请联系工作人员。'
            : `结果长时间未更新时，请先查看你的${channelLabelOf(billingChannel) || '支付'}账单，再联系工作人员。`}
        </p>
      </div>
    </>
  )
}
