// 自我探索结果页的呈现件：一个方向一行（强度 n/5 + 细线 + 依据题号 + 可选的 AI 解读）。
// 用户可见的中文都由 SelfAssessmentFlow 传入（那个文件是合规关键词扫描点名的文件），这里不放文案。
import type { ReactNode } from 'react'
import './resume-sa.css'

export function SaDimRow({ label, strength, max = 5, strengthLabel, evidence, children }: {
  label: string
  strength: number
  max?: number
  /** 读屏名，如「强度 4/5」。 */
  strengthLabel: string
  evidence: string
  /** 这个方向的 AI 解读，或「这段解读没生成」的说明。 */
  children?: ReactNode
}) {
  const pct = Math.max(0, Math.min(100, (strength / max) * 100))
  return (
    <section className="rtp-sa-row">
      <div className="rtp-sa-top">
        <b>{label}</b>
        <span>{strength} / {max}</span>
      </div>
      <div className="rtp-sa-bar" role="img" aria-label={strengthLabel}><i style={{ width: `${pct}%` }} /></div>
      <small>{evidence}</small>
      {children}
    </section>
  )
}
