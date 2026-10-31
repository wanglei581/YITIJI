/**
 * 公共与系统页插画：稿 `ui.js` 里 resume / report / checklist / stack / phone / mfp 的 React 版。
 * 颜色全走 public-touch.css 里的 .pi-* 类（取自 --qxt-* / --qx-* 令牌），这里不写色值。
 */
import type { ReactNode } from 'react'

function Lines({ x, y, w, rows, gap, cls, widths }: { x: number; y: number; w: number; rows: number; gap: number; cls: string; widths?: readonly number[] }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <rect key={i} className={cls} x={x} y={y + i * gap} width={w * (widths ? (widths[i % widths.length] ?? 1) : 1)} height={Math.max(3, gap * 0.34)} rx={2} />
      ))}
    </>
  )
}

function Paper({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <svg className="qxp-illus qxp-paper-shadow" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <rect className="pi-paper" x={0} y={0} width={w} height={h} rx={w * 0.05} />
      {children}
    </svg>
  )
}

/** 简历小样；annot 带 5 个批注点（稿「简历与求职材料」用）。 */
export function IllusResume({ w = 200, annot = false }: { w?: number; annot?: boolean }) {
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const secs = [p + g * 3.4, p + g * 7.6, p + g * 12.2]
  const lw = [1, 0.86, 0.94, 0.72, 0.9, 0.64]
  const marks: readonly (readonly [number, number])[] = [
    [secs[0]! + g * 1.1, 0.9], [secs[0]! + g * 2.66, 0.7], [secs[1]! + g * 1.1, 0.8], [secs[1]! + g * 3.44, 0.55], [secs[2]! + g * 1.88, 0.6],
  ]
  return (
    <Paper w={w} h={h}>
      <rect className="pi-ink" x={p} y={p} width={inner * 0.46} height={g * 1.15} rx={3} />
      <rect className="pi-grey" x={p} y={p + g * 1.7} width={inner * 0.7} height={g * 0.45} rx={2} />
      {secs.map((sy, k) => (
        <g key={k}>
          <rect className="pi-teal" x={p} y={sy} width={inner * 0.26} height={g * 0.55} rx={2} />
          <Lines x={p} y={sy + g * 1.1} w={inner} rows={k === 2 ? 3 : 4} gap={g * 0.78} cls="pi-line" widths={lw} />
        </g>
      ))}
      {annot ? marks.map((m, i) => (
        <g key={i}>
          <rect className="pi-mark" x={p - 2} y={m[0] - 2} width={inner * m[1] + 4} height={g * 0.34 + 4} rx={3} />
          <circle className="pi-clay" cx={w - p * 0.55} cy={m[0] + g * 0.16} r={g * 0.62} />
          <text className="pi-num" x={w - p * 0.55} y={m[0] + g * 0.16} dy=".35em" textAnchor="middle" fontSize={g * 0.86} fontWeight={700}>{i + 1}</text>
        </g>
      )) : null}
    </Paper>
  )
}

/** 报告小样：三条进度加五个要点。 */
export function IllusReport({ w = 200 }: { w?: number }) {
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const bars: readonly (readonly [number, string])[] = [[0.82, 'pi-teal'], [0.64, 'pi-teal'], [0.48, 'pi-clay']]
  const widths = [0.8, 0.66, 0.74, 0.7, 0.58]
  return (
    <Paper w={w} h={h}>
      <rect className="pi-ink" x={p} y={p} width={inner * 0.62} height={g * 1.1} rx={3} />
      <rect className="pi-grey" x={p} y={p + g * 1.7} width={inner * 0.42} height={g * 0.45} rx={2} />
      {bars.map((b, i) => {
        const y = p + g * (3.4 + i * 1.5)
        return (
          <g key={i}>
            <rect className="pi-track" x={p} y={y} width={inner} height={g * 0.62} rx={g * 0.31} />
            <rect className={b[1]} x={p} y={y} width={inner * b[0]} height={g * 0.62} rx={g * 0.31} />
          </g>
        )
      })}
      {widths.map((ww, i) => {
        const y = p + g * (8.6 + i * 1.45)
        return (
          <g key={i}>
            <circle className={i < 3 ? 'pi-teal' : 'pi-clay'} cx={p + g * 0.4} cy={y + g * 0.2} r={g * 0.32} />
            <rect className="pi-line" x={p + g * 1.2} y={y} width={inner * ww} height={g * 0.4} rx={2} />
          </g>
        )
      })}
    </Paper>
  )
}

/** 清单小样：七行勾选框，前三行已勾。 */
export function IllusChecklist({ w = 200 }: { w?: number }) {
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  const widths = [0.7, 0.54, 0.76, 0.6, 0.66, 0.5, 0.62]
  return (
    <Paper w={w} h={h}>
      <rect className="pi-ink" x={p} y={p} width={inner * 0.56} height={g * 1.1} rx={3} />
      <rect className="pi-blue" x={p} y={p + g * 1.7} width={inner * 0.36} height={g * 0.45} rx={2} />
      {widths.map((ww, i) => {
        const y = p + g * (3.6 + i * 1.6)
        return (
          <g key={i}>
            <rect className="pi-box" x={p} y={y} width={g * 0.9} height={g * 0.9} rx={3} />
            {i < 3 ? <path className="pi-tick" d={`M${p + g * 0.2} ${y + g * 0.48} l${g * 0.22} ${g * 0.22} l${g * 0.38} ${-g * 0.42}`} /> : null}
            <rect className="pi-line" x={p + g * 1.5} y={y + g * 0.25} width={inner * ww} height={g * 0.42} rx={2} />
          </g>
        )
      })}
    </Paper>
  )
}

/** 一叠纸。 */
export function IllusStack({ w = 200, n = 3 }: { w?: number; n?: number }) {
  const h = Math.round(w * 1.2)
  return (
    <svg className="qxp-illus" width={w + 30} height={h + 30} viewBox={`0 0 ${w + 30} ${h + 30}`} aria-hidden="true" focusable="false">
      {Array.from({ length: n }, (_, k) => n - 1 - k).map((i) => (
        <rect key={i} className={i === 0 ? 'pi-sheet pi-sheet-top' : 'pi-sheet'} x={i * 12} y={30 - i * 12} width={w} height={h} rx={10} />
      ))}
      <Lines x={w * 0.12} y={30 + h * 0.14} w={w * 0.76} rows={7} gap={h * 0.1} cls="pi-line" widths={[1, 0.8, 0.92, 0.7]} />
    </svg>
  )
}

/** 手机上传小样。 */
export function IllusPhone({ w = 150 }: { w?: number }) {
  const h = Math.round(w * 1.9)
  return (
    <svg className="qxp-illus" width={w} height={h} viewBox="0 0 150 285" aria-hidden="true" focusable="false">
      <rect className="pi-ink" x={6} y={4} width={138} height={277} rx={24} />
      <rect className="pi-screen" x={14} y={20} width={122} height={245} rx={14} />
      <rect className="pi-notch" x={58} y={10} width={34} height={5} rx={2.5} />
      <rect className="pi-doc" x={34} y={70} width={58} height={76} rx={8} />
      <path className="pi-fold" d="M76 70v18h16" />
      <rect className="pi-line" x={44} y={104} width={38} height={5} rx={2} />
      <rect className="pi-line" x={44} y={116} width={30} height={5} rx={2} />
      <circle className="pi-teal" cx={104} cy={180} r={22} />
      <path className="pi-up" d="M104 192v-24M94 177l10-10 10 10" />
      <rect className="pi-ink" x={30} y={222} width={90} height={26} rx={13} />
      <text className="pi-cream" x={75} y={235} dy=".35em" textAnchor="middle" fontSize={13} fontWeight={700}>上传</text>
    </svg>
  )
}

/** 一体机正面示意：上盖、操作面板、出纸口、出纸托盘。 */
export function IllusMachine() {
  return (
    <svg className="qxp-illus" width={520} height={510} viewBox="50 30 520 510" aria-hidden="true" focusable="false">
      <rect className="pi-lid" x={70} y={40} width={480} height={70} rx={18} />
      <rect className="pi-body" x={60} y={100} width={500} height={380} rx={30} />
      <rect className="pi-ink" x={420} y={128} width={112} height={64} rx={12} />
      <rect className="pi-teal pi-dim" x={432} y={140} width={62} height={40} rx={6} />
      <circle className="pi-mint" cx={512} cy={160} r={8} />
      <rect className="pi-ink" x={130} y={250} width={360} height={22} rx={11} />
      <rect className="pi-mint pi-glow" x={150} y={256} width={320} height={10} rx={5} />
      <path className="pi-tray" d="M110 440h400l-30 70H140z" />
      <rect className="pi-base" x={90} y={505} width={440} height={22} rx={11} />
    </svg>
  )
}
