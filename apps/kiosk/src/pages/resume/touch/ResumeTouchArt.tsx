/**
 * 简历三条主路用的实物小样插画（稿 ui.js 的 resume / phone / usb / scanPaper）。
 * 全是装饰：aria-hidden，不表示进度，也不是真文件。
 * 颜色取自稿，只在插画内部使用；不进页面样式。
 */
import type { CSSProperties, ReactNode } from 'react'

const INK = '#13231e'
const FAINT = '#b9c3bf'
const LINE = '#d9ded9'
const TEAL = '#1f9e86'
const CLAY = '#b8683c'

const BLOCK: CSSProperties = { display: 'block' }
const SHADOW: CSSProperties = { display: 'block', filter: 'drop-shadow(0 6px 10px rgba(11,36,30,.12))' }

function Lines({ x, y, w, rows, gap, color, widths }: { x: number; y: number; w: number; rows: number; gap: number; color: string; widths: number[] }) {
  const out: ReactNode[] = []
  for (let i = 0; i < rows; i += 1) {
    out.push(<rect key={i} x={x} y={y + i * gap} width={w * widths[i % widths.length]} height={Math.max(3, gap * 0.34)} rx={2} fill={color} />)
  }
  return <>{out}</>
}

export type ResumeArtState = 'plain' | 'annot' | 'blank' | 'fixed'

/** 一张 A4 简历小样。annot 带编号标注，blank 是空白页加笔，fixed 带改好的勾。 */
export function ResumePaperArt({ width = 200, state = 'plain', shadow = true }: { width?: number; state?: ResumeArtState; shadow?: boolean }) {
  const w = width
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const style = shadow ? SHADOW : BLOCK
  if (state === 'blank') {
    return (
      <svg style={style} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <rect width={w} height={h} rx={w * 0.05} fill="#fff" />
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={p} y={p + g * 1.5 * i + g} width={inner * (i % 3 === 0 ? 0.45 : 0.92)} height={2} fill={i % 3 === 0 ? TEAL : LINE} />
        ))}
        <g transform={`translate(${w * 0.58} ${h * 0.62}) rotate(-35)`}>
          <rect x={0} y={0} width={w * 0.5} height={w * 0.1} rx={w * 0.05} fill="#0b241e" />
          <path d={`M0 0 L${-w * 0.09} ${w * 0.05} L0 ${w * 0.1} z`} fill={CLAY} />
        </g>
      </svg>
    )
  }
  const secs = [p + g * 3.4, p + g * 7.6, p + g * 12.2]
  const lw = [1, 0.86, 0.94, 0.72, 0.9, 0.64]
  const marks: Array<[number, number]> = [[secs[0] + g * 1.1, 0.9], [secs[0] + g * 2.66, 0.7], [secs[1] + g * 1.1, 0.8], [secs[1] + g * 3.44, 0.55], [secs[2] + g * 1.88, 0.6]]
  const fixed: Array<[number, number]> = [[secs[0] + g * 1.1, 0.92], [secs[0] + g * 2.66, 0.78], [secs[1] + g * 1.1, 0.84], [secs[2] + g * 1.88, 0.66]]
  return (
    <svg style={style} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <rect x={0} y={0} width={w} height={h} rx={w * 0.05} fill="#fff" />
      <rect x={p} y={p} width={inner * 0.46} height={g * 1.15} rx={3} fill={INK} />
      <rect x={p} y={p + g * 1.7} width={inner * 0.7} height={g * 0.45} rx={2} fill={FAINT} />
      {secs.map((sy, k) => (
        <g key={sy}>
          <rect x={p} y={sy} width={inner * 0.26} height={g * 0.55} rx={2} fill={TEAL} />
          <Lines x={p} y={sy + g * 1.1} w={inner} rows={k === 2 ? 3 : 4} gap={g * 0.78} color={LINE} widths={lw} />
        </g>
      ))}
      {state === 'annot' ? marks.map((m, i) => (
        <g key={i}>
          <rect x={p - 2} y={m[0] - 2} width={inner * m[1] + 4} height={g * 0.34 + 4} rx={3} fill="rgba(184,104,60,.28)" />
          <circle cx={w - p * 0.55} cy={m[0] + g * 0.16} r={g * 0.62} fill={CLAY} />
          <text x={w - p * 0.55} y={m[0] + g * 0.16} dy=".35em" textAnchor="middle" fontSize={g * 0.86} fontWeight={700} fill="#fff" fontFamily="sans-serif">{i + 1}</text>
        </g>
      )) : null}
      {state === 'fixed' ? (
        <>
          {fixed.map((m, i) => (
            <rect key={i} x={p - 2} y={m[0] - 2} width={inner * m[1] + 4} height={g * 0.34 + 4} rx={3} fill="rgba(31,158,134,.30)" />
          ))}
          <circle cx={w - p * 1.2} cy={p + g * 0.6} r={g * 1.05} fill={TEAL} />
          <path d={`M${w - p * 1.2 - g * 0.45} ${p + g * 0.6} l${g * 0.32} ${g * 0.32} l${g * 0.6} ${-g * 0.6}`} stroke="#fff" strokeWidth={g * 0.22} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  )
}

/** 手机上传示意：手机里有一份文件和上传键。 */
export function PhoneArt({ width = 150 }: { width?: number }) {
  const h = Math.round(width * 1.9)
  return (
    <svg style={BLOCK} width={width} height={h} viewBox="0 0 150 285" aria-hidden="true">
      <rect x={6} y={4} width={138} height={277} rx={24} fill={INK} />
      <rect x={14} y={20} width={122} height={245} rx={14} fill="#f5f2e9" />
      <rect x={58} y={10} width={34} height={5} rx={2.5} fill="#33423d" />
      <rect x={34} y={70} width={58} height={76} rx={8} fill="#fff" stroke="#c9d1cd" strokeWidth={2} />
      <path d="M76 70v18h16" fill="none" stroke="#c9d1cd" strokeWidth={2} />
      <rect x={44} y={104} width={38} height={5} rx={2} fill={LINE} />
      <rect x={44} y={116} width={30} height={5} rx={2} fill={LINE} />
      <circle cx={104} cy={180} r={22} fill={TEAL} />
      <path d="M104 192v-24M94 177l10-10 10 10" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x={30} y={222} width={90} height={26} rx={13} fill="#0b241e" />
      <text x={75} y={235} dy=".35em" textAnchor="middle" fill="#f6f3ea" fontSize={13} fontWeight={700} fontFamily="sans-serif">上传</text>
    </svg>
  )
}

/** U 盘示意。 */
export function UsbArt({ width = 150 }: { width?: number }) {
  return (
    <svg style={BLOCK} width={width} height={width} viewBox="0 0 150 150" aria-hidden="true">
      <rect x={18} y={86} width={114} height={46} rx={10} fill="#c9cfcc" />
      <rect x={40} y={100} width={70} height={18} rx={4} fill={INK} />
      <rect x={54} y={20} width={42} height={56} rx={8} fill={TEAL} />
      <rect x={60} y={74} width={30} height={30} rx={3} fill="#dfe5e2" stroke="#9aa6a1" strokeWidth={2} />
      <rect x={66} y={80} width={6} height={6} fill="#9aa6a1" />
      <rect x={78} y={80} width={6} height={6} fill="#9aa6a1" />
      <path d="M75 6v8M68 10l7 7 7-7" stroke={CLAY} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
