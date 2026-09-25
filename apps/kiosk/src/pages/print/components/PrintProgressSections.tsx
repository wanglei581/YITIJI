// ============================================================
// PrintProgressSections —— /print/progress（稿 15-print-fulfill）的纯展示分区
//
// 只收 PrintProgressPage 已经算好的真值：不发请求、不轮询、不判定任务状态。
//   PrintJobRow              任务卡首行（文件名 / 参数 / 任务号·订单号 / 状态签），printing 与超时两态共用
//   PrintStatusTimeoutPanel  client-status-timeout 态正文：查询超时只是没拿到状态，不改服务端、不猜结果
//
// 状态签文案、超时判定、轮询与跳转仍在页面里，门禁按页面文件取证。
// ============================================================

import type { ReactNode } from 'react'
import { AlertTriangleIcon, FileTextIcon, WalletIcon } from 'lucide-react'
import { formatCents } from '../cashierStatus'
import type { PaymentFact } from '../printProgressModel'

export interface PrintJobState {
  tone: 'doing' | 'wait' | 'err'
  label: string
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

export function PrintStatusTimeoutPanel({ jobRow, payment, amountCents, orderNo, taskId }: {
  jobRow: ReactNode
  payment: PaymentFact
  amountCents: number | null
  orderNo: string | null
  taskId: string | null
}) {
  const isFreeOrder = payment === 'free'
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
                状态暂未确认，请联系工作人员
                <small>本机连续查询 10 分钟没有拿到最终结果</small>
              </span>
            </div>
            <p className="pff-inbar-b">
              这只是<b>查询超时</b>：服务端的打印任务状态<b>没有被改变</b>，我们不会猜它成功或失败。
              可以先重新查询，或直接找工作人员现场确认。
            </p>
          </div>
          <div className="pff-inbar">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><WalletIcon aria-hidden="true" /></span>
              <span>
                费用与订单边界
                <small>
                  {isFreeOrder
                    ? '本次未收款，订单记录保留'
                    : payment === 'paid'
                      ? '订单和支付记录都在，不会因为查询超时消失'
                      : '订单记录保留，不会因为查询超时消失'}
                </small>
              </span>
            </div>
            <p className="pff-inbar-b">
              {isFreeOrder
                ? <>这次到底出没出纸、要不要补打，<b>都等工作人员现场核查</b>。本次系统报价 0 元，没有收款。</>
                : payment === 'paid'
                  ? <>这次到底出没出纸、要不要补打或退费，<b>都等工作人员现场核查</b>。是否退款、退多少、多久到账，<b>以工作人员核查结果为准</b>，本机不承诺自动退款。</>
                  : <>这次到底出没出纸，<b>都等工作人员现场核查</b>；费用以订单记录和工作人员核查结果为准。</>}
            </p>
            <div className="pff-inbar-kv">
              {orderNo ? <span>订单 <b>{orderNo}</b></span> : null}
              {taskId ? <span>任务号 <b>{taskId}</b></span> : null}
              {payment === 'paid' && amountCents != null ? <span>支付状态 <b>已支付 {formatCents(amountCents)}</b></span> : null}
              {isFreeOrder ? <span>支付状态 <b>本次未收款</b></span> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="pff-sec" aria-label="这一刻你可以做的三件">
        <div className="pff-sec-h">
          <span className="t">这一刻你可以做的三件</span>
          <span className="hint">赶时间就直接找人</span>
        </div>
        <div className="pfp-card pfp-todo">
          <div className="pff-step">
            <span className="pff-step-no">1</span>
            <span className="pff-step-txt">看一眼出纸口：<b>已经出来的纸先取走收好</b>，它和这次查询结果无关。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">2</span>
            <span className="pff-step-txt">点下方<b>重新查询状态</b>，这只是再问服务端一次，不会重下单、不会重复扣费。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">3</span>
            <span className="pff-step-txt">
              还是查不到就把<b>{orderNo ? `订单号 ${orderNo}` : `任务号 ${taskId ?? ''}`}</b>告诉工作人员，后台能直接查到这一单。
            </span>
          </div>
        </div>
      </section>
    </>
  )
}
