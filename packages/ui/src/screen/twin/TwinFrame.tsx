import { createContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { ScreenHeadingLevel } from '../ScreenFrame'

/**
 * 数字孪生大屏的外壳：页眉（标题 / 页签 / 时钟 / 动作）、桌面档筛选栏、横幅、块位栅格。
 *
 * 两档观看距离由外层 ScreenStage / ScreenDesk 下发的 [data-ops-screen] 决定，
 * 本组件不自己判断档位，只输出结构；块位几何全在 twin-screen-layout.css。
 */

export type TwinLayout = 'city' | 'terminal' | 'full'

/**
 * 同一 layout 下的版式变体，只在招聘内容托管关闭时由机构两屏使用：
 * 岗位类面板整块不渲染，腾出的块位交给真实数据的邻居（块位几何在 twin-screen-layout.css）。
 * org-usage-today：信息使用选「今日」时每日趋势只剩一行状态，底栏收窄、场景长高。
 */
export type TwinVariant = 'org-overview' | 'org-usage' | 'org-usage-today'

/** 面板标题层级 = 页眉层级 + 1：嵌在后台里是 h3，新窗口展示是 h2，不跳级。 */
export const TwinPanelHeadingContext = createContext<2 | 3>(3)
export type TwinSlotName = 'l1' | 'l2' | 'l3' | 'r1' | 'r2' | 'r3' | 'scene' | 'bottom' | 'task' | 'full'

export interface TwinTab {
  key: string
  label: string
  href: string
  current: boolean
}

export interface TwinHeaderProps {
  title: string
  /**
   * 标题渲染成 h1 还是 h2。**必填，刻意不给默认值**：嵌在后台 Page 里时外层已有 h1，
   * 这里必须是 h2；新窗口展示时本页就是整份文档，回到 h1。
   */
  headingLevel: ScreenHeadingLevel
  subtitle: string
  tabs: TwinTab[]
  /** 页签是真链接（可中键新开）；调用方拦截普通点击走前端路由。 */
  onNavigate?: (href: string) => void
  actions?: ReactNode
  /** 标题左侧的标识图形。 */
  logo?: ReactNode
}

const SHANGHAI_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
const SHANGHAI_DATE = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'long',
})

/** 页眉时钟：墙上时钟，按上海时区显示，与数据时间戳是两回事（数据时间在横幅与脚注里）。 */
function TwinClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className="twin-clock" aria-hidden="true">
      <b>{SHANGHAI_TIME.format(now)}</b>
      <span>{SHANGHAI_DATE.format(now)}</span>
    </div>
  )
}

function DefaultLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 20V8l7-4 7 4v12" />
      <path d="M9 20v-6h6v6" />
      <path d="M9 10h6" />
    </svg>
  )
}

export function TwinHeader({ title, headingLevel, subtitle, tabs, onNavigate, actions, logo }: TwinHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const onTab = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    onNavigate(href)
  }
  return (
    <div className="twin-hd">
      <div className="twin-logo">{logo ?? <DefaultLogo />}</div>
      <div className="twin-hd-text">
        <Heading>{title}</Heading>
        <p className="twin-hd-sub">{subtitle}</p>
      </div>
      <div className="twin-hd-spacer" />
      {tabs.length > 0 ? (
        <nav className="twin-tabs" aria-label="大屏页签">
          {tabs.map((tab) => (
            <a
              key={tab.key}
              className="twin-tab"
              href={tab.href}
              aria-current={tab.current ? 'page' : undefined}
              onClick={(event) => onTab(event, tab.href)}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      ) : null}
      <TwinClock />
      {actions ? <div className="twin-actions">{actions}</div> : null}
    </div>
  )
}

export interface TwinScreenProps {
  header: ReactNode
  /** 桌面档筛选栏；舞台档样式上直接隐藏。 */
  toolbar?: ReactNode
  banners?: ReactNode
  layout: TwinLayout
  /** 与页眉一致传入：页眉 h1 → 面板 h2；页眉 h2 → 面板 h3。 */
  headingLevel: ScreenHeadingLevel
  lite?: boolean
  /**
   * 招聘内容托管关闭（托管 a）。根上挂 data-hosting="off"，样式与测试都按它区分两种部署；
   * 托管开启时不挂任何属性，DOM 与原来逐字一致。
   */
  hostingOff?: boolean
  /** 版式变体，挂在栅格的 data-variant 上；不传就不挂。 */
  variant?: TwinVariant
  children: ReactNode
}

export function TwinScreen({ header, toolbar, banners, layout, headingLevel, lite = false, hostingOff = false, variant, children }: TwinScreenProps) {
  return (
    <TwinPanelHeadingContext.Provider value={headingLevel === 1 ? 2 : 3}>
    <div className="twin" data-lite={lite ? '1' : undefined} data-hosting={hostingOff ? 'off' : undefined}>
      {header}
      {toolbar ? (
        <div className="twin-toolbar" role="group" aria-label="筛选">
          {toolbar}
        </div>
      ) : null}
      {banners ? <div className="twin-banners">{banners}</div> : null}
      <div className="twin-body">
        <div className="twin-grid" data-layout={layout} data-variant={variant}>
          {children}
        </div>
      </div>
    </div>
    </TwinPanelHeadingContext.Provider>
  )
}

export interface TwinSlotProps {
  slot: TwinSlotName
  children: ReactNode
}

export function TwinSlot({ slot, children }: TwinSlotProps) {
  return (
    <div className="twin-slot" data-slot={slot}>
      {children}
    </div>
  )
}

export interface TwinSceneBoxProps {
  /** 场景的设计基准尺寸（城区 976×780，单台终端 1404×812）。 */
  baseWidth: number
  baseHeight: number
  label: string
  children: ReactNode
}

/**
 * 场景容器：按所在块位的实际尺寸等比缩放设计基准。
 * 舞台档块位就是基准尺寸，scale=1；桌面档按容器宽高取小，最大不放大。
 */
export function TwinSceneBox({ baseWidth, baseHeight, label, children }: TwinSceneBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = Math.min(el.clientWidth / baseWidth, el.clientHeight / baseHeight, 1)
      setScale(next > 0 ? next : 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [baseWidth, baseHeight])
  return (
    <div className="tw3-box" ref={ref} role="group" aria-label={label}>
      <div
        className="tw3-scene"
        style={{ width: baseWidth, height: baseHeight, ['--tw3-scale' as string]: String(scale) }}
      >
        {children}
      </div>
    </div>
  )
}

export interface TwinBannerProps {
  tone: 'warn' | 'error'
  children: ReactNode
}

export function TwinBanner({ tone, children }: TwinBannerProps) {
  return (
    <div className={cn('twin-banner', tone === 'error' && 'is-error')} role="status">
      {children}
    </div>
  )
}

export interface TwinStatePanelProps {
  title: string
  description: ReactNode
  action?: ReactNode
}

/** 整屏级状态（未登录 / 无权限 / 全局失败 / 演示模式）。一个数字都不出现。 */
export function TwinStatePanel({ title, description, action }: TwinStatePanelProps) {
  return (
    <div className="twin-state" role="status">
      <b>{title}</b>
      <p className="twin-cap">{description}</p>
      {action}
    </div>
  )
}
