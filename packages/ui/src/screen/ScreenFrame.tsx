import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 大屏外壳：页眉、整屏级横幅、两档容器。
 *
 * 两档不是同一个东西缩放出来的：
 *   wall —— 固定 1080 高的舞台，按视口等比缩放居中。1920×1080 全屏时 scale=1，
 *           与设计稿逐像素一致。字阶按 3 米可读定（下限 13px）。
 *   desk —— 嵌在后台内容区里的流式栅格，字阶按 60cm 定（下限 12px）。
 *           **刻意不复用舞台缩放**：1440 宽带侧栏时内容盒约 1200px，
 *           把 1920 舞台缩到 0.62 会让 13px 变成 8px，直接破可读下限。
 */

const STAGE_W = 1920
const STAGE_H = 1080

export type ScreenMode = 'wall' | 'desk'

function useStageScale(enabled: boolean): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const measure = () => {
      const next = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)
      setScale(next > 0 ? next : 1)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [enabled])
  return scale
}

/**
 * 是否播放动效。
 *
 * 三个来源，任一为「不要」就不播：系统 prefers-reduced-motion、
 * 调用方显式关闭、以及无 matchMedia 的环境（保守不播）。
 * 关掉动效后布局与配色完全不变，只是静止 —— 降级不掉信息。
 */
export function useScreenMotion(enabled: boolean): 'on' | 'off' {
  const [reduced, setReduced] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return enabled && !reduced ? 'on' : 'off'
}

export interface ScreenStageProps {
  label: string
  onExit: () => void
  /** 关掉空间动效（低性能机 / 演示录屏）。纵深层次保留，只是不动。 */
  motion?: boolean
  children: ReactNode
}

/** 全屏演示覆盖层。浏览器拒绝原生全屏时仍然可用，Esc 退出。 */
export function ScreenStage({ label, onExit, motion = true, children }: ScreenStageProps) {
  const scale = useStageScale(true)
  const motionState = useScreenMotion(motion)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])
  return (
    <div
      className="ops-stage-host"
      data-ops-screen="wall"
      data-ops-motion={motionState}
      role="region"
      aria-label={label}
    >
      <div
        className="ops-stage-scaler"
        style={{ width: STAGE_W * scale, height: STAGE_H * scale }}
      >
        <div className="ops-stage" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export interface ScreenDeskProps {
  label: string
  motion?: boolean
  children: ReactNode
}

export function ScreenDesk({ label, motion = true, children }: ScreenDeskProps) {
  const motionState = useScreenMotion(motion)
  return (
    <div data-ops-screen="desk" data-ops-motion={motionState} role="region" aria-label={label}>
      {children}
    </div>
  )
}

export interface ScreenBodyProps {
  children: ReactNode
}

/** 屏体：页眉 + 横幅 + 栅格的纵向容器。wall 档它是 1080 定高。 */
export function ScreenBody({ children }: ScreenBodyProps) {
  return <div className="ops-screen">{children}</div>
}

export interface ScreenGridProps {
  /** 决定 wall 档的行高模板；desk 档三者一致，都走自适应行。 */
  layout: 'gov' | 'ops' | 'partner'
  children: ReactNode
}

export function ScreenGrid({ layout, children }: ScreenGridProps) {
  return <div className={cn('ops-grid', `ops-grid-${layout}`)}>{children}</div>
}

export interface ScreenHeaderProps {
  title: string
  subtitle: string
  /** 已格式化的数据时间戳文案；缺省时不渲染时间行。 */
  generatedAtText?: string
  /** 口径行：在线窗口、时区、刷新节奏。全部从响应渲染，不硬编码。 */
  windowText?: string
  /** 上次刷新失败：时间戳转陶色并加一句说明。 */
  stale?: boolean
  staleText?: string
  actions?: ReactNode
}

export function ScreenHeader({
  title,
  subtitle,
  generatedAtText,
  windowText,
  stale = false,
  staleText,
  actions,
}: ScreenHeaderProps) {
  return (
    <div className="ops-hd">
      <div>
        <h1>{title}</h1>
        <p className="ops-sub">{subtitle}</p>
      </div>
      <div className="ops-hd-actions">
        <div className={cn('ops-stamp', stale && 'is-stale')}>
          {generatedAtText ? (
            <span>
              数据时间 <b>{generatedAtText}</b>
              {stale && staleText ? <> · {staleText}</> : null}
            </span>
          ) : null}
          {windowText ? <span className="ops-win">{windowText}</span> : null}
        </div>
        {actions}
      </div>
    </div>
  )
}

export type ScreenBannerTone = 'info' | 'warn' | 'error'

export interface ScreenBannerProps {
  tone: ScreenBannerTone
  children: ReactNode
}

export function ScreenBanner({ tone, children }: ScreenBannerProps) {
  return (
    <div
      className={cn('ops-banner', tone === 'warn' && 'is-warn', tone === 'error' && 'is-error')}
      role={tone === 'info' ? 'note' : 'status'}
    >
      <span className="ops-banner-dot" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export interface ScreenStatePanelProps {
  title: string
  description: ReactNode
  action?: ReactNode
}

/** 整屏级状态（未登录 / 无权限 / 全局失败 / 演示模式）。一个数字都不出现。 */
export function ScreenStatePanel({ title, description, action }: ScreenStatePanelProps) {
  return (
    <div className="ops-panel-state" role="status">
      <p className="ops-ps-t">{title}</p>
      <p className="ops-ps-d">{description}</p>
      {action}
    </div>
  )
}

/**
 * 全屏演示开关。原生全屏被拒（权限 / 非用户手势）也照样进覆盖层，
 * 不把功能吊死在 Fullscreen API 上。
 */
export function useScreenPresent(): {
  presenting: boolean
  setPresenting: (next: boolean) => void
} {
  const [presenting, setPresentingState] = useState(false)
  const setPresenting = useCallback((next: boolean) => {
    setPresentingState(next)
    if (typeof document === 'undefined') return
    try {
      if (next && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => undefined)
      } else if (!next && document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined)
      }
    } catch {
      /* 原生全屏不可用时保持覆盖层行为 */
    }
  }, [])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = () => {
      if (!document.fullscreenElement) setPresentingState(false)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  return { presenting, setPresenting }
}
