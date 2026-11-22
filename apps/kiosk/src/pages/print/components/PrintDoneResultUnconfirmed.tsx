// ============================================================
// PrintDoneResultUnconfirmed —— /print/done 的「打印结果未确认」态（errorCode = PRINT_JOB_UNCONFIRMED）。
//
// 对应触屏稿 st-unconfirmed（screens3.js:227-263）：
//   紧凑意图带 → 三步（数字步骤）→ 订单摘要 → 出口 → 行链接「查看打印订单」（仅登录）→ 小字；
//   底栏用触屏三槽（返回首页 / 问小青 / 使用帮助）。
//
// 只收页面已经向服务端核验过的真值：不发请求、不判定任务状态、不改金额，不猜成功也不猜失败。
// ============================================================

import type { ReactNode } from 'react'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { PrintTouchFrame, printAsk } from '../PrintTouchFrame'
import type { OutOfPaperMoney } from '../printProgressModel'
import { CONTACT_ENTRY_LABEL } from './printContactEntry'

const ASK_LABEL = '问小青：取纸或异常怎么办'
const ASK_DRAFT = '这次打印结果未确认。请说明取纸或遇到异常时怎么做。不要猜成功或失败，也不要让我重复打印。'

const PAID_REFUND_TITLE = '核查之后才退'
const PAID_REFUND_DESC = '核查确认没出纸后，钱自动退回原付款账户，到账时间以支付渠道为准。'

/** 仅确认收过钱（收款事实为 paid 且 amountCents > 0）才展示核查后退回提示；0 元免费机与金额未知严格不展示。 */
function isPaidUnconfirmedPrint(money: OutOfPaperMoney): boolean {
  return (
    money.fact === 'paid' &&
    typeof money.amountCents === 'number' &&
    Number.isFinite(money.amountCents) &&
    money.amountCents > 0
  )
}

export interface PrintDoneResultUnconfirmedProps {
  orderNo: string | null
  fileName: string | null
  paramLine: string | null
  money: OutOfPaperMoney
  helpLine: string
  canReportIssue: boolean
  isLoggedIn: boolean
  onFeeInfo: () => void
  onFeedback: () => void
  onHome: () => void
  onHelp: () => void
  onOrders: () => void
  onContact?: () => void
  navbar?: ReactNode
  dialog?: ReactNode
}

export function PrintDoneResultUnconfirmed({
  orderNo,
  fileName,
  paramLine,
  money,
  helpLine,
  canReportIssue,
  isLoggedIn,
  onFeeInfo,
  onFeedback,
  onHome,
  onHelp,
  onOrders,
  onContact,
  navbar,
  dialog,
}: PrintDoneResultUnconfirmedProps) {
  const showRefundBar = isPaidUnconfirmedPrint(money)
  return (
    <PrintTouchFrame
      page="print-unconfirmed"
      legacyBody={false}
      eyebrow="打印结果"
      kind="compact"
      seal={null}
      title="这次打印结果未确认。"
      subtitle="系统已明确登记，等待人工核查"
      status={{ tone: 'warn', label: '打印结果未确认' }}
      terminalLabel="就业服务大厅"
      back={{ label: '返回首页', onBack: onHome }}
      ask={printAsk(ASK_LABEL, ASK_DRAFT)}
      primary={{
        label: '使用帮助',
        testId: 'print-fulfill-primary',
        onClick: onHelp,
      }}
      navbar={navbar}
    >
      <div
        data-w2-page="print-done"
        data-print-flow-step={6}
        data-testid="print-fulfill-state-result-unconfirmed"
        className="qx-scroll pff-page pft-unc"
      >
        <ol className="qxt-steps qxt-steps-big pft-unc-steps" style={{ gridTemplateColumns: '1fr' }}>
          <li className="qxt-step">
            <span className="qxt-step-n">1</span>
            <b>先看出纸口是否已有纸张</b>
            <small>设备在断电、失联或硬件异常后，无法确认这次打印的实际结果。</small>
          </li>
          <li className="qxt-step">
            <span className="qxt-step-n">2</span>
            <b>无论有没有，这笔订单都已保留，不要重复打印</b>
            <small>不猜成功也不猜失败，已登记等待人工核查。</small>
          </li>
          <li className="qxt-step">
            <span className="qxt-step-n">3</span>
            <b>
              {helpLine}
              {orderNo ? `，报订单号 ${orderNo}` : '，请报这一单的订单号'}
            </b>
            <small>报这一单的订单号。本机不猜成功或失败。</small>
          </li>
        </ol>
        <dl className="qxt-sum pft-unc-sum">
          {orderNo ? <div className="qxt-sum-r"><dt>订单号</dt><dd>{orderNo}</dd><span /></div> : null}
          {fileName ? <div className="qxt-sum-r"><dt>文件</dt><dd>{fileName}</dd><span /></div> : null}
          {paramLine ? <div className="qxt-sum-r"><dt>参数</dt><dd>{paramLine}</dd><span /></div> : null}
        </dl>
        <div className="qxt-exits pft-unc-exits">
          <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit pft-unc-action" onClick={onFeeInfo}>查看订单说明</button>
          {canReportIssue ? <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit pft-unc-action" onClick={onFeedback}>反馈问题</button> : null}
          {onContact ? (
            <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit pft-contact-entry" data-testid="print-contact-entry" onClick={onContact}>{CONTACT_ENTRY_LABEL}</button>
          ) : null}
        </div>
        {isLoggedIn ? (
          <button type="button" className="qxt-rowlink pft-unc-row" onClick={onOrders}>
            <QxTouchIcon name="receipt" size={32} />
            <span><b>查看打印订单</b></span>
            <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
          </button>
        ) : null}
        <p className="pft-unc-fine qxt-fine" data-testid="print-fulfill-fallback">
          这次结果已登记，等待人工核查；订单保留。
        </p>
        {showRefundBar ? (
          <div className="pft-unc-refund" data-testid="print-unconfirmed-refund-bar">
            <b>{PAID_REFUND_TITLE}</b>
            <span>{PAID_REFUND_DESC}</span>
          </div>
        ) : null}
      </div>
      {dialog}
    </PrintTouchFrame>
  )
}
