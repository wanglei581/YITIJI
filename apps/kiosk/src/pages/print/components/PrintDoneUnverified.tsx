// ============================================================
// PrintDoneUnverified —— /print/done 里「还没拿到可信结果」的两态：
//   loading  正在核验打印结果（已有 taskId，状态请求还没回来）
//   unknown  无法确认打印结果（没有任务上下文，或状态请求失败、任务号对不上、状态不认识）
//
// 稿里没有这两态，照同页失败各态与稿 st-unconfirmed 的做法：紧凑意图带 + 底栏用触屏三槽（返回首页 / 问小青 / 主按钮），
// 不再传旧的小号 ctabar。「查看打印订单」「反馈问题」原先挤在 ctabar 里，现在放进正文出口，一个不丢。
//
// 只摆版式、不判定任务状态：谁是 loading、谁是 unknown 由页面按真实核验结果算好传进来。
// 两态都不说「已出纸」，也不说「没有订单 / 没有扣费」（订单可能已建，见 PrintMissResume 的 orderMayExist）。
// ============================================================

import type { ReactNode } from 'react'
import { AlertCircleIcon } from 'lucide-react'
import { PrintTouchFrame, printAsk } from '../PrintTouchFrame'
import { PrintFillArt } from '../art/PrintFillArt'
import { PrintMissResume } from './PrintMissResume'
import {
  LOADING_ASK_DRAFT,
  LOADING_ASK_LABEL,
  LOADING_PRIMARY_LABEL,
  LOADING_PRIMARY_WHY,
  UNKNOWN_ASK_DRAFT,
  UNKNOWN_ASK_LABEL,
} from './printDoneUnverifiedCopy'

const LOADING_WHY_ID = 'print-done-loading-why'

export function PrintDoneUnverified({
  loading,
  hasTask,
  title,
  subtitle,
  onHome,
  onHelp,
  onUpload,
  onOrders,
  onFeedback,
  dialog,
}: {
  loading: boolean
  /** 路由里带着真实 taskId。没有时没有「反馈问题」（没有可关联的任务）和「查看打印订单」。 */
  hasTask: boolean
  title: string
  subtitle: string
  onHome: () => void
  onHelp: () => void
  onUpload: () => void
  onOrders: () => void
  onFeedback: () => void
  /** 反馈弹层：挂在触屏壳里面，由页面持有开关。 */
  dialog?: ReactNode
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
      status={{ tone: 'unknown', label: '状态未知' }}
      terminalLabel="就业服务大厅"
      back={{ label: '返回首页', onBack: onHome }}
      ask={loading ? printAsk(LOADING_ASK_LABEL, LOADING_ASK_DRAFT) : printAsk(UNKNOWN_ASK_LABEL, UNKNOWN_ASK_DRAFT)}
      /* 核验期间没有可做的下一步：主按钮写状态、不可点，原因写在它上面那行小字里（aria-describedby 连着）。 */
      primary={loading ? undefined : { label: '使用帮助', testId: 'print-fulfill-primary', onClick: onHelp }}
      primaryNode={loading ? (
        <button
          type="button"
          className="qxt-btn qxt-btn-pri"
          data-testid="print-fulfill-primary"
          disabled
          aria-describedby={LOADING_WHY_ID}
        >
          {LOADING_PRIMARY_LABEL}
        </button>
      ) : undefined}
      nav
    >
      <div
        data-w2-page="print-done"
        data-print-flow-step={6}
        data-testid={loading ? 'print-fulfill-state-loading' : 'print-fulfill-state-unknown'}
        className={['qx-scroll pff-page pfp-miss', !loading && hasTask ? 'pfp-miss-more' : ''].filter(Boolean).join(' ')}
      >
        <div className="qx-state" data-tone={loading ? 'info' : 'error'}>
          <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
          <div>
            <div className="qx-state-t">{loading ? '正在向打印服务核验' : '暂未取得可信状态'}</div>
            <div className="qx-state-d">
              {loading
                ? '核验完成后将显示真实结果或返回任务进度页'
                : hasTask
                  ? '暂时无法核验这一单，请在打印订单中查看。'
                  : '未找到打印任务上下文，请从打印入口重新开始'}
            </div>
          </div>
        </div>
        {loading ? null : (
          <PrintMissResume
            orderMayExist
            onUpload={onUpload}
            note="这一页不会把没核验到的结果说成已经出纸。"
          />
        )}
        {!loading && hasTask ? (
          <div className="qxt-exits pft-unc-exits pft-fail-exits">
            <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={onFeedback}>反馈问题</button>
            <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={onOrders}>查看打印订单</button>
          </div>
        ) : null}
        <PrintFillArt name="stack" />
        {loading ? <p id={LOADING_WHY_ID} className="pft-wait-why">{LOADING_PRIMARY_WHY}</p> : null}
      </div>
      {dialog}
    </PrintTouchFrame>
  )
}
