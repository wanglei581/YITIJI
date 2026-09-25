import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ScreenDesk, ScreenStage } from '@ai-job-print/ui'
import { Page } from '../Page'
import { redirectToLogin } from '../../services/auth'
import { GovGrid } from './GovGrid'
import { OpsView } from './OpsView'
import { TerminalTwinView } from './TerminalTwinView'
import { UsageView } from './UsageView'
import { ADMIN_SCREEN_TABS, normalizeAdminTab, screenHref } from './screenTabs'
import type { ScreenChrome } from './screenView'

/**
 * 管理员数据大屏 —— `/screen/:tab`（gov 政务总览 / usage 服务调用 / ops 运营看板 / terminal 终端孪生）。
 *
 * 两种观看距离，同一份数据、同一套组件：
 *   桌面档 —— 默认，嵌在后台内容区里，带筛选栏；
 *   展示档 —— 地址加 display=1，由「新窗口展示」打开：1920×1080 舞台等比铺满窗口，
 *            隐藏筛选栏与后台菜单，适合挂在展厅大屏上无人值守。
 *
 * 取数失败的说法（mock 演示模式不展示大屏数值 / 登录过期要「重新登录」/ kind === 'unauthorized'
 * 不自动跳走）统一在 screenView.tsx；这里只管页签、档位与展示窗口的生命周期。
 */

/** 防烧屏：展示档每 4 分钟把整屏挪几个像素，一小时回到原位。 */
const DRIFT = [
  [0, 0],
  [3, 2],
  [-2, 3],
  [2, -3],
  [-3, -2],
] as const

function useBurnInDrift(enabled: boolean): readonly [number, number] {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setStep((s) => (s + 1) % DRIFT.length), 4 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
  return DRIFT[step]
}

/** 展示档每天凌晨 3 点重新加载一次，释放长时间运行积累的内存；断网时由轮询横幅说明。 */
function useNightlyReload(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const openedAt = Date.now()
    const timer = window.setInterval(() => {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date()),
      )
      if (hour === 3 && Date.now() - openedAt > 60 * 60 * 1000 && navigator.onLine) window.location.reload()
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
}

export default function AdminScreenPage() {
  const { tab: rawTab } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const legacyProfile = searchParams.get('profile')
  const tab = normalizeAdminTab(rawTab, legacyProfile)
  const presenting = searchParams.get('display') === '1'
  const lite = searchParams.get('lite') === '1'
  // 动效可显式关掉（低性能机 / 录屏）。关掉后纵深层次保留，只是静止。
  const [motion, setMotion] = useState(true)
  const drift = useBurnInDrift(presenting)
  useNightlyReload(presenting)

  // 旧地址 /screen?profile=ops、缺省或非法页签：就地改写成规范地址，地址栏与实际视图一致。
  useEffect(() => {
    if (rawTab !== tab || legacyProfile !== null) {
      navigate(screenHref(tab, searchParams, { profile: null }, true), { replace: true })
    }
  }, [rawTab, tab, legacyProfile, navigate, searchParams])

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (value === null) next.delete(key)
      else next.set(key, value)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const openDisplayWindow = () => {
    window.open(screenHref(tab, searchParams, { display: '1' }, true), '_blank', 'noopener')
  }
  const exitDisplay = () => {
    window.close()
    // 不是脚本打开的窗口关不掉：回到桌面档，不留空白页
    navigate(screenHref(tab, searchParams, { display: null }, true), { replace: true })
  }
  const enterFullscreen = () => {
    const el = document.documentElement
    if (el.requestFullscreen && !document.fullscreenElement) void el.requestFullscreen().catch(() => undefined)
  }

  // 页眉标题层级：嵌在后台 Page 里外层 PageHeader 已是 h1，这里降 h2；展示窗口里整份文档就是大屏，回到 h1。
  const headingLevel = presenting ? 1 : 2

  const pageActions = presenting ? (
    <>
      <button type="button" className="twin-btn" onClick={enterFullscreen}>
        全屏
      </button>
      <button type="button" className="twin-btn" onClick={exitDisplay}>
        退出展示
      </button>
    </>
  ) : (
    <>
      <button type="button" className="twin-btn" aria-pressed={!motion} onClick={() => setMotion(!motion)}>
        {motion ? '关闭动效' : '开启动效'}
      </button>
      <button type="button" className="twin-btn" aria-pressed={lite} onClick={() => setParam('lite', lite ? null : '1')}>
        轻量模式
      </button>
      <button type="button" className="twin-btn is-primary" onClick={openDisplayWindow}>
        新窗口展示
      </button>
    </>
  )

  const chrome: ScreenChrome = {
    headingLevel,
    presenting,
    lite,
    tabs: ADMIN_SCREEN_TABS.map((item) => ({
      key: item.key,
      label: item.label,
      href: screenHref(item.key, searchParams),
      current: item.key === tab,
    })),
    onNavigate: (href) => navigate(href),
    pageActions,
    params: searchParams,
    setParam,
    onRelogin: () => redirectToLogin(),
  }

  const content =
    tab === 'ops' ? (
      <OpsView chrome={chrome} />
    ) : tab === 'terminal' ? (
      <TerminalTwinView chrome={chrome} />
    ) : tab === 'usage' ? (
      <UsageView chrome={chrome} />
    ) : (
      <GovGrid chrome={chrome} />
    )

  if (presenting) {
    return (
      <ScreenStage label="数据大屏（展示）" motion={motion} onExit={exitDisplay}>
        <div style={{ transform: `translate(${drift[0]}px, ${drift[1]}px)` }}>{content}</div>
      </ScreenStage>
    )
  }

  return (
    <Page
      title="数据大屏"
      subtitle="面向领导展示与日常巡检的只读视图：全部数值来自真实取数，未接入的指标如实标注。"
    >
      <ScreenDesk label="数据大屏" motion={motion}>
        {content}
      </ScreenDesk>
    </Page>
  )
}
