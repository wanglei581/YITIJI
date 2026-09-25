import { cn } from '../../lib/cn'
import type { TwinState } from './TwinCharts'

/**
 * 单台终端孪生：一体机三维模型 + 部件标注。
 *
 * 模型是示意外形（屏幕、扫码口、出纸口、纸盒），不代表具体机型；
 * 屏幕里写的是**终端状态**，不是一体机屏上此刻真实显示的页面（那个没有上报）。
 * 每条标注的内容都来自终端孪生接口；没有数据源的部件（纸盒 / 碳粉）写「待接入」。
 */

export const TWIN_DEVICE_W = 1404
export const TWIN_DEVICE_H = 812

export type TwinDeviceCalloutKey = 'terminal' | 'printer' | 'scanner' | 'network' | 'supplies'

export interface TwinDeviceCallout {
  key: TwinDeviceCalloutKey
  label: string
  value: string
  /** pend = 数据层缺口（虚线陶色标签）；failed = 本次取数失败（实线朱色标签）。 */
  tone: 'ok' | 'warn' | 'err' | 'pend' | 'failed' | 'muted'
}

export interface TwinDeviceProps {
  code: string
  state: TwinState
  /** 屏幕上的状态行，例「正在打印 · 共 12 页」「在线待机」「离线」。 */
  screenTitle: string
  screenLine: string
  printing: boolean
  callouts: TwinDeviceCallout[]
}

// 设备在场景里的位置与部件锚点（场景坐标 1404×812）
const DEV_X = 453
const DEV_Y = 64
const W = 250
const D = 150
const H = 610

/** 左侧标注框右缘对齐到 LEFT_EDGE，右侧标注框左缘从 RIGHT_EDGE 开始；引线落在框边上。 */
const LEFT_EDGE = 410
const RIGHT_EDGE = 900
const ANCHOR: Record<TwinDeviceCalloutKey, { from: [number, number]; y: number; side: 'left' | 'right' }> = {
  terminal: { from: [DEV_X - 20, DEV_Y + 150], y: 150, side: 'left' },
  printer: { from: [DEV_X + 23, DEV_Y + 492], y: 500, side: 'left' },
  network: { from: [DEV_X + 207, DEV_Y + 32], y: 96, side: 'right' },
  scanner: { from: [DEV_X + 122, DEV_Y + 428], y: 330, side: 'right' },
  supplies: { from: [DEV_X + 172, DEV_Y + 572], y: 564, side: 'right' },
}

const TONE_STROKE: Record<TwinDeviceCallout['tone'], string> = {
  ok: 'var(--tw-acc)',
  warn: '#e8b45c',
  err: '#e88b7d',
  pend: '#e8b45c',
  failed: '#e88b7d',
  muted: '#7d8f89',
}

const STATE_GLOW: Record<TwinState, string> = {
  ok: 'rgba(46,230,168,.45)',
  pr: 'rgba(114,214,255,.6)',
  wa: 'rgba(232,180,92,.6)',
  off: 'rgba(232,139,125,.55)',
  un: 'rgba(125,143,137,.5)',
}

function Model({ state, screenTitle, screenLine, printing }: Pick<TwinDeviceProps, 'state' | 'screenTitle' | 'screenLine' | 'printing'>) {
  const glow = STATE_GLOW[state]
  return (
    <div className="tw3-bob" style={{ left: 0, top: 0, width: W, height: H }}>
      <div className="tw3-devgrp" style={{ left: 0, top: 0, width: W, height: H }}>
        <div
          className="tw3-face"
          style={{
            left: 0,
            top: 0,
            width: W,
            height: H,
            transform: `translateZ(${D / 2}px)`,
            borderRadius: 16,
            background: 'linear-gradient(180deg,#123f33,#0a2a22 60%,#082119)',
            border: `2px solid ${glow}`,
            boxShadow: `inset 0 0 40px rgba(46,230,168,.18), 0 0 24px ${glow}`,
          }}
        >
          <div style={{ position: 'absolute', left: 18, top: 22, width: 214, height: 360, borderRadius: 10, background: '#041a14', border: '2px solid #1e5a4a', overflow: 'hidden', boxShadow: 'inset 0 0 30px rgba(46,230,168,.25)' }}>
            <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13, fontWeight: 700, color: '#cfeee4', background: 'linear-gradient(90deg,#0b3a2f,#07251e)' }}>职易达 · 终端状态</div>
            <div style={{ padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#eaf8ff' }}>{screenTitle}</div>
              <div style={{ fontSize: 14, color: '#9cc2b6', lineHeight: 1.5 }}>{screenLine}</div>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{ width: printing ? '100%' : '0%', height: '100%', background: '#72d6ff', boxShadow: '0 0 10px #72d6ff', opacity: printing ? 0.9 : 0 }} />
              </div>
            </div>
          </div>
          <div style={{ position: 'absolute', left: 88, top: 396, width: 74, height: 30, borderRadius: 6, background: '#041a14', border: '1.5px solid rgba(114,214,255,.6)', boxShadow: '0 0 12px rgba(114,214,255,.45)' }} />
          <div style={{ position: 'absolute', left: 30, top: 446, width: 190, height: 16, borderRadius: 4, background: '#020f0c', border: '1px solid rgba(46,230,168,.35)' }} />
          {printing ? (
            <div className="tw3-paper" style={{ position: 'absolute', left: 44, top: 452, width: 162, height: 60, borderRadius: 2, background: 'linear-gradient(180deg,#f6fbf9,#d9e7e2)' }} />
          ) : null}
          <div style={{ position: 'absolute', left: 30, top: 530, width: 190, height: 50, borderRadius: 8, background: '#06211a', border: '1px solid rgba(46,230,168,.25)' }} />
        </div>
        <div
          className="tw3-face"
          style={{ left: (W - D) / 2, top: 0, width: D, height: H, transform: `rotateY(90deg) translateZ(${W / 2}px)`, borderRadius: 12, background: 'linear-gradient(90deg,#0a2a22,#06201a)', border: '2px solid rgba(46,230,168,.3)' }}
        >
          <div style={{ position: 'absolute', left: 20, right: 20, top: 60, height: 180, background: 'repeating-linear-gradient(0deg,rgba(46,230,168,.18) 0 3px,transparent 3px 12px)' }} />
        </div>
        <div
          className="tw3-face"
          style={{ left: 0, top: (H - D) / 2, width: W, height: D, transform: `rotateX(90deg) translateZ(${H / 2}px)`, borderRadius: 14, background: '#134a3c', border: '2px solid rgba(46,230,168,.5)' }}
        />
      </div>
    </div>
  )
}

export function TwinDevice({ code, state, screenTitle, screenLine, printing, callouts }: TwinDeviceProps) {
  return (
    <div className="tw3-stage" aria-hidden="false">
      <div className="tw3-plat" style={{ left: DEV_X - 105, top: 700, width: 460, height: 120 }} />
      <div className="tw3-plat" style={{ left: DEV_X - 45, top: 722, width: 340, height: 76, borderStyle: 'dashed', opacity: 0.6 }} />
      <div className="tw3-dev" style={{ left: DEV_X, top: DEV_Y, width: W, height: H + 30 }} role="img" aria-label={`${code} 终端模型，${screenTitle}`}>
        <Model state={state} screenTitle={screenTitle} screenLine={screenLine} printing={printing} />
      </div>
      <svg className="tw3-flows" width={TWIN_DEVICE_W} height={TWIN_DEVICE_H} viewBox={`0 0 ${TWIN_DEVICE_W} ${TWIN_DEVICE_H}`} aria-hidden="true">
        {callouts.map((c) => {
          const a = ANCHOR[c.key]
          const boxX = a.side === 'left' ? LEFT_EDGE : RIGHT_EDGE
          const boxY = a.y + 22
          const midX = a.side === 'left' ? boxX + 50 : boxX - 70
          return (
            <path
              key={c.key}
              className="tw3-fl"
              d={`M${a.from[0]} ${a.from[1]} L${midX} ${boxY} L${boxX} ${boxY}`}
              style={{ stroke: TONE_STROKE[c.tone] }}
            />
          )
        })}
      </svg>
      {callouts.map((c) => {
        const a = ANCHOR[c.key]
        return (
          <div
            key={c.key}
            className={cn('tw3-callout', (c.tone === 'warn' || c.tone === 'pend') && 'is-warn', (c.tone === 'err' || c.tone === 'failed') && 'is-err')}
            style={a.side === 'left' ? { right: TWIN_DEVICE_W - LEFT_EDGE, top: a.y, maxWidth: 400 } : { left: RIGHT_EDGE, top: a.y, maxWidth: 480 }}
          >
            <span className="k">{c.label}</span>
            {c.tone === 'pend' || c.tone === 'failed' ? <span className={cn('twin-pend', c.tone === 'failed' && 'is-failed')}>{c.value}</span> : <b>{c.value}</b>}
          </div>
        )
      })}
    </div>
  )
}
