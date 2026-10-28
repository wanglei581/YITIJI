// 从零生成每一步下面的预览卡：左边是一张纸的小样，右边只复述这一步已经填上的内容。
// 没填的格子写「未填」「不填写」，不放示例岗位、示例学校或示例数字。
import { ResumeTouchArt, type ResumeTouchArtKind } from './ResumeTouchArt'

export function ResumeStepPreview({
  kicker,
  title,
  lines,
  note,
  need = false,
  art = 'resume',
  className,
}: {
  kicker: string
  title: string
  lines: readonly string[]
  note?: string
  /** 必填的格子还空着时，标题用赭色提醒。 */
  need?: boolean
  /** 小样的纸型。不传是简历。 */
  art?: ResumeTouchArtKind
  /** 追加到卡片上的类名（如 rtp-hero-min：纸张区至少 190 高，内容多时整屏滚动而不是把纸收没）。 */
  className?: string
}) {
  return (
    <aside className={className ? `rtp-hero ${className}` : 'rtp-hero'} aria-label={kicker}>
      <div className="rtp-hero-art"><ResumeTouchArt kind={art} /></div>
      <div className="rtp-hero-tx">
        <p className="rtp-hero-k">{kicker}</p>
        <b className={need ? 'rtp-hero-need' : undefined}>{title}</b>
        {lines.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}
        {note ? <small>{note}</small> : null}
      </div>
    </aside>
  )
}
