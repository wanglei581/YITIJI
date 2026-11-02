import type { ReactNode } from 'react'

/** 首页四张「带走什么」插画。路径与 ui.js 66–136 相同，填色走令牌。 */

function rules(x: number, y: number, w: number, rows: number, gap: number, color: string, widths: number[]) {
  const nodes: ReactNode[] = []
  for (let i = 0; i < rows; i++) {
    nodes.push(
      <rect
        key={`${y}-${i}`}
        x={x}
        y={y + i * gap}
        width={w * widths[i % widths.length]}
        height={Math.max(3, gap * 0.34)}
        rx={2}
        fill={color}
      />,
    )
  }
  return nodes
}

export function QxTouchArtResume({ width = 150 }: { width?: number }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const secs = [p + g * 3.4, p + g * 7.6, p + g * 12.2]
  const widths = [1, 0.86, 0.94, 0.72, 0.9, 0.64]
  const marks: Array<[number, number]> = [
    [secs[0] + g * 1.1, 0.9],
    [secs[0] + g * 2.66, 0.7],
    [secs[1] + g * 1.1, 0.8],
    [secs[1] + g * 3.44, 0.55],
    [secs[2] + g * 1.88, 0.6],
  ]
  return (
    <svg className="qxt-illus qxt-paper" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <rect width={w} height={h} rx={w * 0.05} fill="var(--qx-on-solid)" />
      <rect x={p} y={p} width={inner * 0.46} height={g * 1.15} rx={3} fill="var(--qxt-ink)" />
      <rect x={p} y={p + g * 1.7} width={inner * 0.7} height={g * 0.45} rx={2} fill="var(--qxt-art-mist)" />
      {secs.map((sy, k) => (
        <g key={sy}>
          <rect x={p} y={sy} width={inner * 0.26} height={g * 0.55} rx={2} fill="var(--qx-teal)" />
          {rules(p, sy + g * 1.1, inner, k === 2 ? 3 : 4, g * 0.78, 'var(--qxt-art-rule)', widths)}
        </g>
      ))}
      {marks.map((mark, i) => (
        <g key={mark[0]}>
          <rect x={p - 2} y={mark[0] - 2} width={inner * mark[1] + 4} height={g * 0.34 + 4} rx={3} fill="var(--qxt-art-annot)" />
          <circle cx={w - p * 0.55} cy={mark[0] + g * 0.16} r={g * 0.62} fill="var(--qxt-clay)" />
          <text x={w - p * 0.55} y={mark[0] + g * 0.16} dy=".35em" textAnchor="middle" fontSize={g * 0.86} fontWeight={700} fill="var(--qx-on-solid)" fontFamily="var(--qx-sans)">{i + 1}</text>
        </g>
      ))}
    </svg>
  )
}

export function QxTouchArtReport({ width = 150 }: { width?: number }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const bars: Array<[number, string]> = [[0.82, 'var(--qx-teal)'], [0.64, 'var(--qx-teal)'], [0.48, 'var(--qxt-clay)']]
  const widths = [0.8, 0.66, 0.74, 0.7, 0.58]
  return (
    <svg className="qxt-illus qxt-paper" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <rect width={w} height={h} rx={w * 0.05} fill="var(--qx-on-solid)" />
      <rect x={p} y={p} width={inner * 0.62} height={g * 1.1} rx={3} fill="var(--qxt-ink)" />
      <rect x={p} y={p + g * 1.7} width={inner * 0.42} height={g * 0.45} rx={2} fill="var(--qxt-art-mist)" />
      {bars.map((bar, i) => {
        const y = p + g * (3.4 + i * 1.5)
        return (
          <g key={y}>
            <rect x={p} y={y} width={inner} height={g * 0.62} rx={g * 0.31} fill="var(--qxt-art-track)" />
            <rect x={p} y={y} width={inner * bar[0]} height={g * 0.62} rx={g * 0.31} fill={bar[1]} />
          </g>
        )
      })}
      {widths.map((widthRatio, i) => {
        const y = p + g * (8.6 + i * 1.45)
        return (
          <g key={y}>
            <circle cx={p + g * 0.4} cy={y + g * 0.2} r={g * 0.32} fill={i < 3 ? 'var(--qx-teal)' : 'var(--qxt-clay)'} />
            <rect x={p + g * 1.2} y={y} width={inner * widthRatio} height={g * 0.4} rx={2} fill="var(--qxt-art-rule)" />
          </g>
        )
      })}
    </svg>
  )
}

export function QxTouchArtChecklist({ width = 150 }: { width?: number }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const widths = [0.7, 0.54, 0.76, 0.6, 0.66, 0.5, 0.62]
  return (
    <svg className="qxt-illus qxt-paper" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <rect width={w} height={h} rx={w * 0.05} fill="var(--qx-on-solid)" />
      <rect x={p} y={p} width={inner * 0.56} height={g * 1.1} rx={3} fill="var(--qxt-ink)" />
      <rect x={p} y={p + g * 1.7} width={inner * 0.36} height={g * 0.45} rx={2} fill="var(--qxt-art-slate)" />
      {widths.map((widthRatio, i) => {
        const y = p + g * (3.6 + i * 1.6)
        return (
          <g key={y}>
            <rect x={p} y={y} width={g * 0.9} height={g * 0.9} rx={3} fill="none" stroke="var(--qxt-art-slate)" strokeWidth={2} />
            {i < 3 ? (
              <path d={`M${p + g * 0.2} ${y + g * 0.48} l${g * 0.22} ${g * 0.22} l${g * 0.38} ${-g * 0.42}`} stroke="var(--qxt-art-slate)" strokeWidth={2.4} fill="none" strokeLinecap="round" />
            ) : null}
            <rect x={p + g * 1.5} y={y + g * 0.25} width={inner * widthRatio} height={g * 0.42} rx={2} fill="var(--qxt-art-rule)" />
          </g>
        )
      })}
    </svg>
  )
}

export function QxTouchArtStack({ width = 132, count = 3 }: { width?: number; count?: number }) {
  const w = width
  const h = Math.round(w * 1.2)
  const sheets: ReactNode[] = []
  for (let i = count - 1; i >= 0; i--) {
    sheets.push(
      <rect
        key={i}
        x={i * 12}
        y={30 - i * 12}
        width={w}
        height={h}
        rx={10}
        fill={i === 0 ? 'var(--qx-on-solid)' : 'var(--qxt-art-stack)'}
        stroke="var(--qxt-art-edge)"
        strokeWidth={1.5}
      />,
    )
  }
  return (
    <svg className="qxt-illus" width={w + 30} height={h + 30} viewBox={`0 0 ${w + 30} ${h + 30}`} aria-hidden="true">
      {sheets}
      {rules(w * 0.12, 30 + h * 0.14, w * 0.76, 7, h * 0.1, 'var(--qxt-art-rule)', [1, 0.8, 0.92, 0.7])}
    </svg>
  )
}
