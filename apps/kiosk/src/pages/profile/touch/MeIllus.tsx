import type { ReactNode } from 'react'

/**
 * 我的与权益各屏的插画。形状与触屏稿 ui.js 相同，填色一律走令牌：
 * 通用色用 --qx-* / --qxt-*，只有插画才用的浅灰深灰放在 me-tokens.css 的 --me-art-*。
 */

function rules(x: number, y: number, w: number, rows: number, gap: number, fill: string, widths: number[]): ReactNode[] {
  return Array.from({ length: rows }, (_, i) => (
    <rect key={`${y}-${i}`} x={x} y={y + i * gap} width={w * widths[i % widths.length]} height={Math.max(3, gap * 0.34)} rx={2} fill={fill} />
  ))
}

function Paper({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <svg className="me-art me-art-paper" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <rect width={w} height={h} rx={w * 0.05} fill="var(--qx-on-solid)" />
      {children}
    </svg>
  )
}

export function MeArtResume({ width = 150 }: { width?: number }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const secs = [p + g * 3.4, p + g * 7.6, p + g * 12.2]
  const widths = [1, 0.86, 0.94, 0.72, 0.9, 0.64]
  return (
    <Paper w={w} h={h}>
      <rect x={p} y={p} width={inner * 0.46} height={g * 1.15} rx={3} fill="var(--qxt-ink)" />
      <rect x={p} y={p + g * 1.7} width={inner * 0.7} height={g * 0.45} rx={2} fill="var(--me-art-mist)" />
      {secs.map((sy, k) => (
        <g key={sy}>
          <rect x={p} y={sy} width={inner * 0.26} height={g * 0.55} rx={2} fill="var(--qx-teal)" />
          {rules(p, sy + g * 1.1, inner, k === 2 ? 3 : 4, g * 0.78, 'var(--me-art-rule)', widths)}
        </g>
      ))}
    </Paper>
  )
}

export function MeArtReport({ width = 150 }: { width?: number }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const bars: [number, string][] = [[0.82, 'var(--qx-teal)'], [0.64, 'var(--qx-teal)'], [0.48, 'var(--qxt-clay)']]
  const widths = [0.8, 0.66, 0.74, 0.7, 0.58]
  return (
    <Paper w={w} h={h}>
      <rect x={p} y={p} width={inner * 0.62} height={g * 1.1} rx={3} fill="var(--qxt-ink)" />
      <rect x={p} y={p + g * 1.7} width={inner * 0.42} height={g * 0.45} rx={2} fill="var(--me-art-mist)" />
      {bars.map(([ratio, fill], i) => {
        const y = p + g * (3.4 + i * 1.5)
        return (
          <g key={y}>
            <rect x={p} y={y} width={inner} height={g * 0.62} rx={g * 0.31} fill="var(--me-art-track)" />
            <rect x={p} y={y} width={inner * ratio} height={g * 0.62} rx={g * 0.31} fill={fill} />
          </g>
        )
      })}
      {widths.map((ratio, i) => {
        const y = p + g * (8.6 + i * 1.45)
        return (
          <g key={y}>
            <circle cx={p + g * 0.4} cy={y + g * 0.2} r={g * 0.32} fill={i < 3 ? 'var(--qx-teal)' : 'var(--qxt-clay)'} />
            <rect x={p + g * 1.2} y={y} width={inner * ratio} height={g * 0.4} rx={2} fill="var(--me-art-rule)" />
          </g>
        )
      })}
    </Paper>
  )
}

export function MeArtChecklist({ width = 150 }: { width?: number }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const widths = [0.7, 0.54, 0.76, 0.6, 0.66, 0.5, 0.62]
  return (
    <Paper w={w} h={h}>
      <rect x={p} y={p} width={inner * 0.56} height={g * 1.1} rx={3} fill="var(--qxt-ink)" />
      <rect x={p} y={p + g * 1.7} width={inner * 0.36} height={g * 0.45} rx={2} fill="var(--qx-slate)" />
      {widths.map((ratio, i) => {
        const y = p + g * (3.6 + i * 1.6)
        return (
          <g key={y}>
            <rect x={p} y={y} width={g * 0.9} height={g * 0.9} rx={3} fill="none" stroke="var(--qx-slate)" strokeWidth={2} />
            {i < 3 ? <path d={`M${p + g * 0.2} ${y + g * 0.48} l${g * 0.22} ${g * 0.22} l${g * 0.38} ${-g * 0.42}`} stroke="var(--qx-slate)" strokeWidth={2.4} fill="none" strokeLinecap="round" /> : null}
            <rect x={p + g * 1.5} y={y + g * 0.25} width={inner * ratio} height={g * 0.42} rx={2} fill="var(--me-art-rule)" />
          </g>
        )
      })}
    </Paper>
  )
}

export function MeArtStack({ width = 150, count = 3 }: { width?: number; count?: number }) {
  const w = width
  const h = Math.round(w * 1.2)
  return (
    <svg className="me-art" width={w + 30} height={h + 30} viewBox={`0 0 ${w + 30} ${h + 30}`} aria-hidden="true" focusable="false">
      {Array.from({ length: count }, (_, k) => count - 1 - k).map((i) => (
        <rect key={i} x={i * 12} y={30 - i * 12} width={w} height={h} rx={10} fill={i === 0 ? 'var(--qx-on-solid)' : 'var(--me-art-sheet)'} stroke="var(--me-art-sheet-edge)" strokeWidth={1.5} />
      ))}
      {rules(w * 0.12, 30 + h * 0.14, w * 0.76, 7, h * 0.1, 'var(--me-art-rule)', [1, 0.8, 0.92, 0.7])}
    </svg>
  )
}

export function MeArtPhone({ width = 140 }: { width?: number }) {
  const h = Math.round(width * 1.9)
  return (
    <svg className="me-art" width={width} height={h} viewBox="0 0 150 285" aria-hidden="true" focusable="false">
      <rect x={6} y={4} width={138} height={277} rx={24} fill="var(--qxt-ink)" />
      <rect x={14} y={20} width={122} height={245} rx={14} fill="var(--qx-paper)" />
      <rect x={58} y={10} width={34} height={5} rx={2.5} fill="var(--me-art-bezel)" />
      <rect x={34} y={70} width={58} height={76} rx={8} fill="var(--qx-on-solid)" stroke="var(--me-art-edge)" strokeWidth={2} />
      <path d="M76 70v18h16" fill="none" stroke="var(--me-art-edge)" strokeWidth={2} />
      <rect x={44} y={104} width={38} height={5} rx={2} fill="var(--me-art-rule)" />
      <rect x={44} y={116} width={30} height={5} rx={2} fill="var(--me-art-rule)" />
      <circle cx={104} cy={180} r={22} fill="var(--qx-teal)" />
      <path d="M104 192v-24M94 177l10-10 10 10" stroke="var(--qx-on-solid)" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x={30} y={222} width={90} height={26} rx={13} fill="var(--qx-deep)" />
      <text x={75} y={235} dy=".35em" textAnchor="middle" fill="var(--qxt-cream)" fontSize={13} fontWeight={700}>上传</text>
    </svg>
  )
}

export function MeArtUsb({ width = 120 }: { width?: number }) {
  return (
    <svg className="me-art" width={width} height={width} viewBox="0 0 150 150" aria-hidden="true" focusable="false">
      <rect x={18} y={86} width={114} height={46} rx={10} fill="var(--me-art-body)" />
      <rect x={40} y={100} width={70} height={18} rx={4} fill="var(--qxt-ink)" />
      <rect x={54} y={20} width={42} height={56} rx={8} fill="var(--qx-teal)" />
      <rect x={60} y={74} width={30} height={30} rx={3} fill="var(--me-art-key)" stroke="var(--me-art-body-2)" strokeWidth={2} />
      <rect x={66} y={80} width={6} height={6} fill="var(--me-art-body-2)" />
      <rect x={78} y={80} width={6} height={6} fill="var(--me-art-body-2)" />
      <path d="M75 6v8M68 10l7 7 7-7" stroke="var(--qxt-clay)" strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MeArtScan({ width = 150 }: { width?: number }) {
  return (
    <svg className="me-art" width={width} height={width} viewBox="0 0 150 150" aria-hidden="true" focusable="false">
      <rect x={10} y={64} width={130} height={62} rx={12} fill="var(--me-art-body)" />
      <rect x={10} y={52} width={130} height={18} rx={7} fill="var(--me-art-body-2)" />
      <g transform="rotate(-8 69 46)">
        <rect x={34} y={18} width={70} height={56} rx={6} fill="var(--qx-on-solid)" stroke="var(--me-art-edge)" strokeWidth={2} />
        <rect x={46} y={32} width={40} height={5} rx={2} fill="var(--me-art-rule)" />
        <rect x={46} y={44} width={30} height={5} rx={2} fill="var(--me-art-rule)" />
      </g>
      <rect x={22} y={96} width={106} height={6} rx={3} fill="var(--qx-emerald)" />
    </svg>
  )
}

export type MeArtName = 'resume' | 'report' | 'checklist' | 'stack' | 'phone' | 'usb' | 'scan'

/** 出口卡与大卡左边的插画。宽度按稿，高度随比例。 */
export function MeArt({ name, width }: { name: MeArtName; width?: number }) {
  switch (name) {
    case 'resume': return <MeArtResume width={width} />
    case 'report': return <MeArtReport width={width} />
    case 'checklist': return <MeArtChecklist width={width} />
    case 'stack': return <MeArtStack width={width} />
    case 'phone': return <MeArtPhone width={width} />
    case 'usb': return <MeArtUsb width={width} />
    case 'scan': return <MeArtScan width={width} />
  }
}
