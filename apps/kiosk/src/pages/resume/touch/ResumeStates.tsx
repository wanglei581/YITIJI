// 简历其余页的三种状态版式。照稿「状态样式板」：
//   st-loading      读取中 / 生成中 / 分析中 → ResumeWaitState：一张等待卡 + 一句边界声明 + 「带走什么」的纸张小样（只吃余量）
//   st-error        失败 / 读不出 / 打印失败 → ResumeErrorState：一张原因卡 + 两张大行动卡 + 求助句
//   st-unconfirmed  打印文件还在等生成       → ResumeStepsState：三步大步骤 + 摘要行 + 一句边界声明
// 只组合共享的触屏件和样式类，不改共享件。文案由各页传入；这里不写路由，也不写「找 / 联系工作人员」。
import type { ReactNode } from 'react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { Waiting } from '../jobFit/jobFitQxKit'
import { ResumeStepPreview } from './ResumeStepPreview'
import { ResumeTouchActs, type ResumeTouchActItem } from './ResumeTouchActs'
import type { ResumeDocArtKind } from './ResumeDocArt'
import './resume-states.css'

export function ResumeWaitState({ icon, title, desc, tag, fine, take }: {
  icon: ReactNode
  title: string
  desc: string
  /** 等待卡下面那一行小字：只表达整体等待，不写百分比、不写预计时间。 */
  tag: string
  fine: string
  take: { art: ResumeDocArtKind; kicker: string; title: string; lines: readonly string[] }
}) {
  return (
    <div className="rtp-state">
      <Waiting icon={icon} title={title} desc={desc} tag={tag} />
      <QxTouchCallout kind="fine">{fine}</QxTouchCallout>
      <ResumeStepPreview art={take.art} kicker={`${take.kicker} · 示例版式`} title={take.title} lines={take.lines} />
    </div>
  )
}

export function ResumeErrorState({ reasonTitle, reason, rows, region, alert = false, note, acts, fine, onHelp }: {
  /** 原因卡的小标题。不传就不画原因卡（原因已经由 region 自己说清时）。 */
  reasonTitle?: string
  /** 一段原因（可以带节点）。 */
  reason?: ReactNode
  /** 合在原因卡里的几行：几种可能的原因，或这一次已经确认的几件事，一行一条。 */
  rows?: ReadonlyArray<{ title: string; desc: string }>
  /** 原因卡下面紧跟的一整块（如 AI 任务区的「这次没能生成」说明和它自带的出路按钮）。 */
  region?: ReactNode
  /** 原因是这次请求刚刚返回的真实失败说明时，用 alert 让读屏立刻读出。 */
  alert?: boolean
  /** 不用原因卡、一句话就能说清时用：放在大卡上面的一句说明（如「AI 暂时不可用，这次没有行动清单。」）。 */
  note?: string
  acts: ReadonlyArray<ResumeTouchActItem>
  fine?: string
  /** 传了就在求助句后面补一个「帮助中心」按钮（站内自助常见问题页，不是人工入口）。 */
  onHelp?: () => void
}) {
  const reasonBox = reasonTitle ? (
    <div className="qxt-reason-box qxt-rise" role={alert ? 'alert' : undefined}>
      <h4><QxTouchIcon name="alert" size={30} strokeWidth={2} />{reasonTitle}</h4>
      {reason ? <div className="qxt-reason">{reason}</div> : null}
      {rows ? (
        <ul className="rtp-causes">
          {rows.map((row) => (
            <li key={row.title}>
              <b>{row.title}</b>
              <span>{row.desc}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  ) : null
  const help = (
    <QxTouchCallout kind="remind" icon="call">
      {helpNeededLine()}
      {onHelp ? <button type="button" className="rtp-help-link" data-route="/help" onClick={onHelp}>帮助中心</button> : null}
    </QxTouchCallout>
  )
  return <ResumeTouchActs before={<>{reasonBox}{region}</>} note={note} items={acts} after={help} fine={fine} />
}

export function ResumeStepsState({ steps, summary, fine, take }: {
  /** now 为真的那一步是「现在停在这里」，读屏读作当前步骤。 */
  steps: ReadonlyArray<{ title: string; detail: string; now?: boolean }>
  summary: ReadonlyArray<{ label: string; value: string }>
  fine: string
  /** 「带走什么」的纸张小样，只吃三步和摘要下面剩下的高度。 */
  take: { art: ResumeDocArtKind; kicker: string; title: string; lines: readonly string[] }
}) {
  return (
    <div className="rtp-state rtp-state-steps">
      <div className="qxt-steps qxt-steps-big" role="list" aria-label="打印这件事现在到哪一步">
        {steps.map((step, index) => (
          <div className="qxt-step" key={step.title} role="listitem" aria-current={step.now ? 'step' : undefined} data-now={step.now ? 'true' : undefined}>
            <span className="qxt-step-n">{index + 1}</span>
            <b>{step.title}</b>
            <small>{step.detail}</small>
          </div>
        ))}
      </div>
      <div className="qxt-sum">
        {summary.map((row) => (
          <div className="qxt-sum-r" key={row.label}>
            <span>{row.label}</span>
            <b>{row.value}</b>
            <span />
          </div>
        ))}
      </div>
      <QxTouchCallout kind="fine">{fine}</QxTouchCallout>
      <ResumeStepPreview art={take.art} kicker={`${take.kicker} · 示例版式`} title={take.title} lines={take.lines} />
    </div>
  )
}
