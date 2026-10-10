// ============================================================
// PrintProgressSections —— /print/progress（稿 15-print-fulfill）的纯展示分区
//
// 只收 PrintProgressPage 已经算好的真值：不发请求、不轮询、不判定任务状态。
//   PrintJobRow              任务卡首行（文件名 / 参数 / 任务号·订单号 / 状态签），printing 与超时两态共用
//   PrintStatusTimeoutPanel  client-status-timeout 态正文：查询超时只是没拿到状态，不改服务端、不猜结果
//   PrintProgressFailureNote 已知失败的红条：只写出路，原因留在顶栏和步骤卡
//   PrintProgressFailureActions 失败底栏：说明行在按钮上方，「重新打印」单独一行字
//
// 状态签文案、超时判定、轮询与跳转仍在页面里，门禁按页面文件取证。
// ============================================================

import type { ReactNode } from 'react'
import { AlertCircleIcon, AlertTriangleIcon, FileTextIcon, WalletIcon } from 'lucide-react'
import { helpNeededLine, machineCannotPrintLine, refundApplyLine } from '../../../copy/unattendedCopy'
import { formatCents } from '../cashierStatus'
import type { PaymentFact } from '../printProgressModel'
import {
  OFFLINE_DETAIL,
  OFFLINE_TITLE,
  STATUS_READ_ERROR_TEXT,
  UNCONFIRMED_COPY,
} from '../printProgressPolling'

export interface PrintJobState {
  tone: 'doing' | 'wait' | 'err'
  label: string
}

/** 红条不重复失败原因，只留下面三个按钮的一句出路。 */
export function PrintProgressFailureNote({ wayOut }: { wayOut: string }) {
  return (
    <div className="pff-inbar" data-tone="bad" data-testid="print-progress-failure">
      <div className="pff-inbar-h">
        <span className="pff-inbar-ic"><AlertCircleIcon aria-hidden="true" /></span>
        <span>{wayOut}</span>
      </div>
    </div>
  )
}

/** 失败底栏。价目说明独占一行，主按钮只写「重新打印」。 */
export function PrintProgressFailureActions({
  hint,
  onHelp,
  onOrders,
  onReprint,
}: {
  hint: string
  onHelp: () => void
  onOrders: () => void
  onReprint: () => void
}) {
  return (
    <>
      <p className="why">{hint}</p>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>
        问小青
      </button>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onOrders}>
        查看订单
      </button>
      <button
        type="button"
        className="qx-btn"
        data-variant="primary"
        data-testid="print-fulfill-reprint"
        onClick={onReprint}
      >
        重新打印
      </button>
    </>
  )
}

export function PrintJobRow({ fileName, subline, idLine, state }: {
  fileName: string
  subline: string
  /** 任务号 / 订单号拼好的一行；两者都没有时传空串，不渲染。 */
  idLine: string
  state: PrintJobState
}) {
  return (
    <div className="pfp-job">
      <span className="pfp-job-ic"><FileTextIcon aria-hidden="true" /></span>
      <span className="pfp-job-main">
        <b className="pfp-job-name">{fileName}</b>
        <span className="pfp-job-sub">{subline}</span>
        {idLine ? <span className="pfp-job-id">{idLine}</span> : null}
      </span>
      <span className="pfp-job-state" data-tone={state.tone}>{state.label}</span>
    </div>
  )
}

export function PrintStatusTimeoutPanel({ jobRow, payment, amountCents, orderNo }: {
  jobRow: ReactNode
  payment: PaymentFact
  amountCents: number | null
  orderNo: string | null
  /** 调用方仍传入，页面不再把内部任务号展示给用户。 */
  taskId: string | null
}) {
  const isFreeOrder = payment === 'free'
  const paid = payment === 'paid' && typeof amountCents === 'number' && amountCents > 0
  const fault = machineCannotPrintLine(undefined, { orderKept: true })
  return (
    <>
      <section className="pff-sec" aria-label="这一单现在的状态">
        <div className="pff-sec-h">
          <span className="t">这一单现在的状态</span>
          <span className="hint">本机连续查询 10 分钟没有拿到最终结果</span>
        </div>
        <div className="pfp-card" data-testid="print-fulfill-list">
          {jobRow}
          <div className="pff-inbar" data-tone="wheat" data-testid="print-fulfill-fallback">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><AlertTriangleIcon aria-hidden="true" /></span>
              <span>
                状态暂未确认
                <small>本机连续查询 10 分钟没有拿到最终结果</small>
              </span>
            </div>
            <p className="pff-inbar-b">
              这只是<b>查询超时</b>：系统的打印任务状态<b>没有被改变</b>，我们不会猜它成功或失败。
              可以先重新查询。{fault}
            </p>
          </div>
          <div className="pff-inbar">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><WalletIcon aria-hidden="true" /></span>
              <span>
                {isFreeOrder ? '订单记录' : '费用与订单边界'}
                <small>
                  {isFreeOrder
                    ? '免费试运营，订单记录保留'
                    : payment === 'paid'
                      ? '订单和支付记录都在，不会因为查询超时消失'
                      : '订单记录保留，不会因为查询超时消失'}
                </small>
              </span>
            </div>
            <p className="pff-inbar-b">
              {paid
                ? <>请先看出纸口。{refundApplyLine()}</>
                : <>请先看出纸口。{fault}</>}
            </p>
            <div className="pff-inbar-kv">
              {orderNo ? <span>订单 <b>{orderNo}</b></span> : null}
              {payment === 'paid' && amountCents != null ? <span>支付状态 <b>已支付 {formatCents(amountCents)}</b></span> : null}
              {isFreeOrder ? <span>免费试运营</span> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="pff-sec" aria-label="这一刻你可以做的三件">
        <div className="pff-sec-h">
          <span className="t">这一刻你可以做的三件</span>
          <span className="hint">先看出纸口</span>
        </div>
        <div className="pfp-card pfp-todo">
          <div className="pff-step">
            <span className="pff-step-no">1</span>
            <span className="pff-step-txt">看一眼出纸口：<b>已经出来的纸先取走收好</b>，它和这次查询结果无关。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">2</span>
            <span className="pff-step-txt">点下方<b>重新查询状态</b>，这只是再问系统一次，不会重下单、不会重复扣费。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">3</span>
            <span className="pff-step-txt">
              {orderNo
                ? <>还是查不到就记下<b>订单号 {orderNo}</b>。{helpNeededLine()}</>
                : <>还是查不到就先停在这一页。{helpNeededLine()}</>}
            </span>
          </div>
        </div>
      </section>
    </>
  )
}

/** 断网 / 结果未确认。读不到状态，不写成打印失败，也不给重新打印。 */
export function PrintProgressLinkNotice({ phase }: { phase: 'offline' | 'unconfirmed' }) {
  const unconfirmed = phase === 'unconfirmed'
  return (
    <div
      className="pff-inbar"
      data-tone="wheat"
      role="status"
      data-testid={unconfirmed ? 'print-progress-unconfirmed' : 'print-progress-offline'}
    >
      <div className="pff-inbar-h">
        <span className="pff-inbar-ic"><AlertTriangleIcon aria-hidden="true" /></span>
        <span>
          {unconfirmed ? UNCONFIRMED_COPY : OFFLINE_TITLE}
          {unconfirmed ? null : <small>{STATUS_READ_ERROR_TEXT}。{OFFLINE_DETAIL}</small>}
        </span>
      </div>
    </div>
  )
}
