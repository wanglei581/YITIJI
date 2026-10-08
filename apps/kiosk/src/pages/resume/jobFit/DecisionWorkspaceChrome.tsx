// 稿 46 英雄区与单行真话栏。四条路由共用，QxPageFrame 页头只做视觉隐藏，保留全页唯一的 h1 给读屏与门禁。
// 英雄区用 p 承担可见标题；与页头同句时对读屏隐藏，不同句的引导语仍留给读屏。
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import '../resume-decision-hero.css'

export type DecisionEyebrow = '简历对照' | '行动清单' | '职业规划' | '简历模板'

const STEPS = [
  ['1', '要求自己写，不从列表里选'],
  ['2', '小青对照你的简历'],
  ['3', '带走下一步，或去打印'],
] as const

export function DecisionHero({
  eyebrow,
  title,
  copy,
  echoesPageHead,
}: {
  eyebrow: DecisionEyebrow
  title: ReactNode
  copy?: ReactNode
  /** 可见标题和框架页头的 h1 是同一句，读屏已经读过页头那一遍，这里不再重复。 */
  echoesPageHead?: boolean
}) {
  return (
    <section className="jfq-hero" data-testid="resume-decision-hero" aria-label={eyebrow}>
      <div className="jfq-hero-mark" aria-hidden="true">青</div>
      <p className="jfq-hero-eyebrow">{eyebrow}</p>
      <p className="jfq-hero-title" aria-hidden={echoesPageHead ? true : undefined}>{title}</p>
      {copy ? <p className="jfq-hero-copy">{copy}</p> : null}
      <ol className="jfq-hero-steps">
        {STEPS.map(([no, text]) => (
          <li key={no}><b>{no}</b>{text}</li>
        ))}
      </ol>
    </section>
  )
}

/** 稿 46 底部单行真话。帮助入口去既有 /help，不写死号码。 */
export function DecisionTruthBar() {
  const navigate = useNavigate()
  return (
    <div className="jfq-truth" data-testid="resume-decision-truth">
      <span className="jfq-truth-ic" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7.5 3v6.2c0 4.4-3.1 7.6-7.5 8.8-4.4-1.2-7.5-4.4-7.5-8.8V6z" />
        </svg>
      </span>
      <p><b>只供本人准备</b>不提供给企业 · 结果以实际记录为准 · 结束这次办理会清除本机登录</p>
      <button type="button" className="jfq-truth-help" data-testid="resume-decision-truth-help" onClick={() => navigate('/help')}>
        使用说明
      </button>
    </div>
  )
}

/** 真话栏独占操作条换行后的一整行，仍在底栏之上。 */
export function DecisionCta({ children }: { children: ReactNode }) {
  return <>{children}<DecisionTruthBar /></>
}
