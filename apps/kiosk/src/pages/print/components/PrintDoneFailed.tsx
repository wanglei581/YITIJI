// ============================================================
// PrintDoneFailed —— /print/done 的少见失败态：普通失败、卡纸、缺纸，以及「查看费用说明」那一屏。
//
// 版式照稿 st-unconfirmed 的骨架（稿里没有这几态，不发明新词汇）：
//   紧凑意图带 → 三步（数字步骤）→ 订单摘要 → 出口 → 「文件带走」卡 → 行链接「查看打印订单」→ 小字；
//   底栏用触屏三槽（返回首页 / 问小青 / 使用帮助），不再传旧的小号 ctabar。
//
// 只收页面已经向服务端核验过的真值：不发请求、不判定任务状态、不改金额。
// 结果判定（completed / failed / errorCode 分态）、带走链接、重试与清场仍在 PrintDonePage 里，门禁按页面文件取证。
// 文案红线与 PrintDonePage 同一套：不写「已支付」（用「已付」）、不出现退款 / 赔付字样、不让用户去找现场的人。
// ============================================================

import type { ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { formatRemainingSeconds } from '../../../hooks/useCountdown'
import { PrintTouchFrame, printAsk } from '../PrintTouchFrame'
import { PrintFillArt } from '../art/PrintFillArt'
import type { FailureCopy, FailureStep, SummaryRow, FailureVariant } from './printDoneFailedModel'

const ASK_LABEL = '问小青：取纸或异常怎么办'
const ASK_DRAFT = '打印时取纸或遇到异常该怎么办？请告诉我现在可以做的事，不要替我判断有没有打出来。'

/** 「文件带走」二维码的二维码边长（不小于 168）。 */
const TAKEAWAY_QR_SIZE = 188

export interface TakeawayCardState {
  /** 已换成可扫的完整地址；没有（还没签发、已过期、签发失败）为 null。 */
  qrUrl: string | null
  /** 剩余秒数；未知或没有链接时为 -1。 */
  remaining: number
  expired: boolean
  /** 签发失败时给用户看的一句话（已换成无人值守标准句）；没有为 null。 */
  error: string | null
}

export interface PrintDoneFailedProps {
  variant: FailureVariant
  copy: FailureCopy
  rows: SummaryRow[]
  /** 0 元单写「查看订单说明」，其余写「查看费用说明」。 */
  free: boolean
  retry: {
    /** takeaway-url 给出 canRetry 且不是「结果未确认」才有这个出口。 */
    available: boolean
    busy: boolean
    /** 重提被拒时的一句话（含版本门槛提示）；放在按钮栏第一行，不滚动就能看到。 */
    error: string | null
    onRetry: () => void
  }
  takeaway: TakeawayCardState
  canReportIssue: boolean
  isLoggedIn: boolean
  onFeeInfo: () => void
  onFeedback: () => void
  onHome: () => void
  onHelp: () => void
  onOrders: () => void
  /** 反馈弹层：挂在触屏壳里面（与其余各态一致），由页面持有开关。 */
  dialog?: ReactNode
}

function Steps({ steps, label }: { steps: FailureStep[]; label: string }) {
  return (
    <section aria-label={label}>
      <ol className="qxt-steps qxt-steps-big pft-unc-steps" style={{ gridTemplateColumns: '1fr' }}>
        {steps.map((step, index) => (
          <li key={step.title} className="qxt-step">
            <span className="qxt-step-n">{index + 1}</span>
            <b>{step.title}</b>
            <small>{step.detail}</small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Summary({ rows, testId, compact = true }: { rows: SummaryRow[]; testId?: string; compact?: boolean }) {
  return (
    <dl className={compact ? 'qxt-sum pft-unc-sum pft-fail-sum' : 'qxt-sum pft-unc-sum'} data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} className="qxt-sum-r">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
          <span />
        </div>
      ))}
    </dl>
  )
}

/** 「文件带走」一张触屏卡：标题 + 二维码（不小于 168）+ 剩余时间 + 说明。过期与签发失败只说一句，不放二维码。 */
function TakeawayCard({ takeaway, expiredLine }: { takeaway: TakeawayCardState; expiredLine: string }) {
  return (
    <>
      {takeaway.qrUrl ? (
        <section className="pft-take-card" role="region" aria-label="文件带走">
          <div className="pft-take-card-qr">
            <QRCodeSVG value={takeaway.qrUrl} size={TAKEAWAY_QR_SIZE} level="M" marginSize={0} />
          </div>
          <div className="pft-take-card-tx">
            <b>文件带走</b>
            {takeaway.remaining >= 0 ? <span className="pft-take-card-left">剩余 {formatRemainingSeconds(takeaway.remaining)}</span> : null}
            <small>请用本人手机扫码保存</small>
          </div>
        </section>
      ) : null}
      {takeaway.expired ? <p role="status" className="pft-unc-fine qxt-fine">{expiredLine}</p> : null}
      {takeaway.error ? <p role="status" className="pft-unc-fine qxt-fine">{takeaway.error}</p> : null}
    </>
  )
}

function OrdersRowLink({ onOrders }: { onOrders: () => void }) {
  return (
    <button type="button" className="qxt-rowlink pft-unc-row" onClick={onOrders}>
      <QxTouchIcon name="receipt" size={32} />
      <span><b>查看打印订单</b></span>
      <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
    </button>
  )
}

const TESTID_BY_VARIANT: Record<FailureVariant, string> = {
  failed: 'print-fulfill-state-failed',
  'paper-jam': 'print-fulfill-state-paper-jam',
  'out-of-paper': 'print-fulfill-state-out-of-paper',
}

/** 带走链接过期时的一句话（标准求助句由调用方拼进 expiredLine）。 */
export function PrintDoneFailed(props: PrintDoneFailedProps & { expiredLine: string }) {
  const { variant, copy, rows, free, retry, takeaway, canReportIssue, isLoggedIn } = props
  return (
    <PrintTouchFrame
      page="print-done"
      legacyBody={false}
      eyebrow="打印结果"
      kind="compact"
      seal={null}
      title={copy.title}
      subtitle={copy.subtitle}
      status={{ tone: 'bad', label: copy.pill }}
      statusClassName={variant === 'out-of-paper' ? 'qx-pill' : undefined}
      terminalLabel="就业服务大厅"
      back={{ label: '返回首页', onBack: props.onHome }}
      ask={printAsk(ASK_LABEL, ASK_DRAFT)}
      primary={{ label: '使用帮助', testId: 'print-fulfill-primary', onClick: props.onHelp }}
      nav
    >
      <div
        data-w2-page="print-done"
        data-print-flow-step={6}
        data-testid={TESTID_BY_VARIANT[variant]}
        className="qx-scroll pff-page pft-unc pft-fail"
      >
        <Steps steps={copy.steps} label={copy.stepsLabel} />
        <Summary rows={rows} testId="print-fulfill-list" />
        <div className="qxt-exits pft-unc-exits pft-fail-exits">
          {retry.error ? (
            <p role="alert" className="pft-fail-alert">{retry.error}</p>
          ) : null}
          <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={props.onFeeInfo}>
            {free ? '查看订单说明' : '查看费用说明'}
          </button>
          {canReportIssue ? (
            <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={props.onFeedback}>反馈问题</button>
          ) : null}
          {retry.available ? (
            <button
              type="button"
              className="qxt-btn qxt-btn-sec qxt-btn-exit pft-fail-retry"
              disabled={retry.busy}
              onClick={retry.onRetry}
            >
              {retry.busy ? '正在重新提交…' : '重新提交打印'}
            </button>
          ) : null}
        </div>
        <TakeawayCard takeaway={takeaway} expiredLine={props.expiredLine} />
        {isLoggedIn ? <OrdersRowLink onOrders={props.onOrders} /> : null}
        <p className="pft-unc-fine qxt-fine" data-testid="print-fulfill-fallback">{copy.fine}</p>
      </div>
      {props.dialog}
    </PrintTouchFrame>
  )
}

/** 「查看费用说明 / 查看订单说明」：从任一失败态点进来；底栏返回的是上一屏，不是首页。 */
export function PrintDoneFeeInfo({
  title,
  subtitle,
  pill,
  steps,
  stepsLabel,
  rows,
  fine,
  onBack,
  onHelp,
}: {
  title: string
  subtitle: string
  pill: string
  steps: FailureStep[]
  stepsLabel: string
  rows: SummaryRow[]
  fine: string
  onBack: () => void
  onHelp: () => void
}) {
  return (
    <PrintTouchFrame
      page="print-done"
      legacyBody={false}
      eyebrow="打印结果"
      kind="compact"
      seal={null}
      title={title}
      subtitle={subtitle}
      status={{ tone: 'warn', label: pill }}
      terminalLabel="就业服务大厅"
      back={{ label: '返回上一页', onBack }}
      ask={printAsk(ASK_LABEL, ASK_DRAFT)}
      primary={{ label: '使用帮助', testId: 'print-fulfill-primary', onClick: onHelp }}
      nav
    >
      <div
        data-w2-page="print-done"
        data-print-flow-step={6}
        data-testid="print-fulfill-state-fee-info"
        className="qx-scroll pff-page pft-unc"
      >
        {/* 这一屏内容少，沿用未确认页的大尺寸三步与摘要行，不用失败态的紧凑尺寸，免得整屏留白。 */}
        <Steps steps={steps} label={stepsLabel} />
        <Summary rows={rows} compact={false} />
        <p className="pft-unc-fine qxt-fine" data-testid="print-fulfill-fallback">{fine}</p>
        {/* 内容不够高时，用一块实物小样吃掉剩下的高度（够放不下就不画），不在底栏上方留整块空白。 */}
        <PrintFillArt name="stack" />
      </div>
    </PrintTouchFrame>
  )
}
