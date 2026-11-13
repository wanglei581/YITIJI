// 「带走什么」的实物小样：一张纸的轮廓，只表示这一屏最后会交出什么，不是用户的内容，也不放示例文字。
// 颜色全在 resume-touch.css 里按令牌上色（.rtp-paper-*），这里只出形状。
import type { ReactNode } from 'react'

export type ResumeDocArtKind = 'resume' | 'report' | 'checklist'

const W = 200
const H = 283
const P = 20
const INNER = W - P * 2
const G = 10.4

function bars(rows: number, y: number, widths: readonly number[], className: string, x = P, span = INNER): ReactNode[] {
  const gap = G * 0.78
  return Array.from({ length: rows }, (_, i) => (
    <rect
      key={`${className}-${x}-${y}-${i}`}
      className={className}
      x={x}
      y={y + i * gap}
      width={span * widths[i % widths.length]}
      height={Math.max(3, gap * 0.34)}
      rx={2}
    />
  ))
}

function ResumeSheet(): ReactNode {
  const widths = [1, 0.86, 0.94, 0.72, 0.9, 0.64] as const
  const sections = [P + G * 3.4, P + G * 7.6, P + G * 12.2, P + G * 16.8] as const
  return (
    <>
      <rect className="rtp-paper-ink" x={P} y={P} width={INNER * 0.46} height={G * 1.15} rx={3} />
      <rect className="rtp-paper-sub" x={P} y={P + G * 1.7} width={INNER * 0.7} height={G * 0.45} rx={2} />
      {sections.map((top, k) => (
        <g key={top}>
          <rect className="rtp-paper-accent" x={P} y={top} width={INNER * 0.26} height={G * 0.55} rx={2} />
          {bars(k === 2 ? 3 : 4, top + G * 1.1, widths, 'rtp-paper-line')}
        </g>
      ))}
    </>
  )
}

/** 双栏：左窄栏放姓名与联系方式一类的短条，右宽栏放各段经历。只表示「这是双栏」，不是任何人的内容。 */
function ResumeTwoColSheet(): ReactNode {
  const widths = [1, 0.84, 0.94, 0.72, 0.9] as const
  const left = P
  const leftSpan = INNER * 0.3
  const right = P + INNER * 0.36
  const rightSpan = INNER * 0.64
  const sections = [P + G * 1.2, P + G * 6.2, P + G * 11.2, P + G * 16.2] as const
  return (
    <>
      <rect className="rtp-paper-sub" x={left} y={P} width={leftSpan} height={G * 6.4} rx={3} opacity={0.35} />
      <rect className="rtp-paper-ink" x={left + 4} y={P + 6} width={leftSpan * 0.7} height={G * 0.9} rx={3} />
      {bars(5, P + G * 2.4, widths, 'rtp-paper-line', left + 4, leftSpan - 8)}
      <rect className="rtp-paper-accent" x={left} y={P + G * 8.2} width={leftSpan * 0.7} height={G * 0.5} rx={2} />
      {bars(4, P + G * 9.4, widths, 'rtp-paper-line', left, leftSpan)}
      <rect className="rtp-paper-ink" x={right} y={P} width={rightSpan * 0.55} height={G * 1.05} rx={3} />
      {sections.map((top, k) => (
        <g key={top}>
          <rect className="rtp-paper-accent" x={right} y={top + G * 0.6} width={rightSpan * 0.32} height={G * 0.5} rx={2} />
          {bars(k === 3 ? 3 : 4, top + G * 1.7, widths, 'rtp-paper-line', right, rightSpan)}
        </g>
      ))}
    </>
  )
}

function ReportSheet(): ReactNode {
  const meters = [
    [0.82, 'rtp-paper-accent'],
    [0.64, 'rtp-paper-accent'],
    [0.48, 'rtp-paper-clay'],
  ] as const
  const dotWidths = [0.8, 0.66, 0.74, 0.7, 0.58, 0.72, 0.62, 0.68, 0.5] as const
  return (
    <>
      <rect className="rtp-paper-ink" x={P} y={P} width={INNER * 0.62} height={G * 1.1} rx={3} />
      <rect className="rtp-paper-sub" x={P} y={P + G * 1.7} width={INNER * 0.42} height={G * 0.45} rx={2} />
      {meters.map(([ratio, tone], i) => {
        const y = P + G * (3.4 + i * 1.5)
        return (
          <g key={`m-${i}`}>
            <rect className="rtp-paper-track" x={P} y={y} width={INNER} height={G * 0.62} rx={G * 0.31} />
            <rect className={tone} x={P} y={y} width={INNER * ratio} height={G * 0.62} rx={G * 0.31} />
          </g>
        )
      })}
      {dotWidths.map((ratio, i) => {
        const y = P + G * (8.6 + i * 1.45)
        return (
          <g key={`d-${i}`}>
            <circle className={i < 5 ? 'rtp-paper-accent' : 'rtp-paper-clay'} cx={P + G * 0.4} cy={y + G * 0.2} r={G * 0.32} />
            <rect className="rtp-paper-line" x={P + G * 1.2} y={y} width={INNER * ratio} height={G * 0.4} rx={2} />
          </g>
        )
      })}
    </>
  )
}

function ChecklistSheet(): ReactNode {
  const ratios = [0.7, 0.54, 0.76, 0.6, 0.66, 0.5, 0.62, 0.72, 0.56, 0.68, 0.52] as const
  return (
    <>
      <rect className="rtp-paper-ink" x={P} y={P} width={INNER * 0.56} height={G * 1.1} rx={3} />
      <rect className="rtp-paper-slate" x={P} y={P + G * 1.7} width={INNER * 0.36} height={G * 0.45} rx={2} />
      {ratios.map((ratio, i) => {
        const y = P + G * (3.6 + i * 1.6)
        return (
          <g key={`c-${i}`}>
            <rect className="rtp-paper-box" x={P} y={y} width={G * 0.9} height={G * 0.9} rx={3} />
            {i < 5 ? (
              <path className="rtp-paper-tick" d={`M${P + G * 0.2} ${y + G * 0.48} l${G * 0.22} ${G * 0.22} l${G * 0.38} ${-G * 0.42}`} />
            ) : null}
            <rect className="rtp-paper-line" x={P + G * 1.5} y={y + G * 0.25} width={INNER * ratio} height={G * 0.42} rx={2} />
          </g>
        )
      })}
    </>
  )
}

/** 纯装饰：读屏跳过。大小由外层 .rtp-art / .rtp-hero-art 的高度决定。columns 只对简历纸有效：2 是双栏。 */
export function ResumeDocArt({ kind = 'resume', columns = 1 }: { kind?: ResumeDocArtKind; columns?: 1 | 2 }) {
  return (
    <svg className="rtp-paper" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <rect className="rtp-paper-sheet" x={0} y={0} width={W} height={H} rx={W * 0.05} />
      {kind === 'report' ? <ReportSheet /> : kind === 'checklist' ? <ChecklistSheet /> : columns === 2 ? <ResumeTwoColSheet /> : <ResumeSheet />}
    </svg>
  )
}
