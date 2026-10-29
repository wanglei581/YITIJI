// ============================================================
// PrintProgressSections —— /print/progress（稿 15-print-fulfill）的纯展示分区
//
// 只收 PrintProgressPage 已经算好的真值：不发请求、不轮询、不判定任务状态。
//   PrintJobRow              任务卡首行（文件名 / 参数 / 订单号 / 状态签），printing 态用
//   PrintStatusTimeoutPanel  client-status-timeout 态正文（稿 st-unconfirmed 骨架：三步 + 摘要 + 出口 + 小字）：
//                            查询超时只是没拿到状态，不改服务端、不猜结果
//   PrintProgressFailureNote 已知失败的红条：只写出路，原因留在顶栏和步骤卡
//   PrintProgressFailureActions 失败的出口：说明行在上，使用帮助、查看订单在下；主按钮「重新打印」在触屏底栏
//
// 状态签文案、超时判定、轮询与跳转仍在页面里，门禁按页面文件取证。
// ============================================================

import { AlertCircleIcon, FileTextIcon } from 'lucide-react'
import { PrintFillArt } from '../art/PrintFillArt'
import { FailSteps, FailSummary } from './PrintFailParts'
import type { FailureStep, SummaryRow } from './printDoneFailedModel'

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

/** 失败的出口。价目说明独占一行，下面两颗次按钮；主按钮「重新打印」是触屏底栏的主键，不在这里。 */
export function PrintProgressFailureActions({
  hint,
  onHelp,
  onOrders,
}: {
  hint: string
  onHelp: () => void
  onOrders: () => void
}) {
  return (
    <div className="pfp-fail-actions">
      <p className="qxt-fine">{hint}</p>
      <div className="qxt-exits pft-fail-exits">
        <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={onHelp}>使用帮助</button>
        <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={onOrders}>查看订单</button>
      </div>
    </div>
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

/** 查询超时：三步 + 摘要 + 使用帮助 + 小字。「重新查询状态」是触屏底栏的主键。 */
export function PrintStatusTimeoutPanel({ steps, stepsLabel, rows, fine, onHelp }: {
  steps: FailureStep[]
  stepsLabel: string
  rows: SummaryRow[]
  fine: string
  onHelp: () => void
}) {
  return (
    <>
      <FailSteps steps={steps} label={stepsLabel} />
      {/* 内容少，沿用未确认页的大尺寸三步与摘要行；不够高的地方用实物小样吃掉，不在底栏上方留整块空白。 */}
      <FailSummary rows={rows} testId="print-fulfill-list" compact={false} />
      <div className="qxt-exits pft-unc-exits pft-fail-exits">
        <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={onHelp}>使用帮助</button>
      </div>
      <p className="pft-unc-fine qxt-fine" data-testid="print-fulfill-fallback">{fine}</p>
      <PrintFillArt name="stack" />
    </>
  )
}
