import type { ReactNode } from 'react'

/** 稿 21 小青任务头的四步轨。取件页与解析页共用同一张表，文字只在这里写一次。 */
export const RESUME_FLOW_STEPS = ['上传与方向', 'AI 解析', '诊断报告', '优化打印'] as const

/**
 * 每一步在当前状态下的真实标记。
 * current 只给「你正在这一步、而且这一步确实在进行」—— 缺文件、等授权、结果未知都不算。
 */
export type RailMark = 'done' | 'current' | 'wait' | 'bad' | 'todo'

/** 只给「暂停」「没办成」补读屏说明；这两种最容易被当成「正在进行」。 */
const MARK_NOTE: Partial<Record<RailMark, string>> = {
  wait: '暂停',
  bad: '没办成',
}

interface ResumeTriageHeroProps {
  eyebrow: string
  /** 小青的话，`<em>` 部分以翡翠色强调。 */
  ask: ReactNode
  doing: ReactNode
  /** 右侧旗标；warn 时换成米白描边，不用翡翠色冒充「一切正常」。 */
  flag: string
  warn?: boolean
  rail: readonly RailMark[]
}

/** 稿 21 `.xq`：深底小青任务头 + 四步轨。页面唯一的 h1 仍在 QxPageFrame 页头，这里不另起标题。 */
export function ResumeTriageHero({ eyebrow, ask, doing, flag, warn = false, rail }: ResumeTriageHeroProps) {
  return (
    <header className="qx-rt-xq">
      <div className="qx-rt-xq-row">
        <span className="qx-rt-face" aria-hidden="true">青</span>
        <div className="qx-rt-xq-main">
          <p className="qx-rt-eyebrow">{eyebrow}</p>
          <p className="qx-rt-title">{ask}</p>
          <p className="qx-rt-doing">{doing}</p>
        </div>
        <span className="qx-rt-flag" data-tone={warn ? 'warn' : undefined}>{flag}</span>
      </div>
      <ol className="qx-rt-rail" aria-label="简历服务流程：上传与方向、AI 解析、诊断报告、优化打印">
        {RESUME_FLOW_STEPS.map((step, i) => {
          const mark = rail[i] ?? 'todo'
          return (
            <li
              key={step}
              data-mark={mark}
              data-done={mark === 'done' ? '1' : undefined}
              aria-current={mark === 'current' ? 'step' : undefined}
            >
              <i aria-hidden="true">{i + 1}</i>
              {step}
              {MARK_NOTE[mark] ? <span className="sr-only-qx">（{MARK_NOTE[mark]}）</span> : null}
            </li>
          )
        })}
      </ol>
    </header>
  )
}
