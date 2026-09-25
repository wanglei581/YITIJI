import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ScreenDesk, ScreenStage, useTwinBurnInDrift, useTwinNightlyReload } from '@ai-job-print/ui'
import { FRONTEND_HINT, Page, withFrontendHint } from '../Page'
import { redirectToLogin } from '../../services/auth'
import { PartnerGrid } from './PartnerGrid'
import { PartnerTerminalView } from './PartnerTerminalView'
import { PartnerUsageView } from './PartnerUsageView'
import { PARTNER_SCREEN_TABS, normalizePartnerTab, screenHref } from './screenTabs'
import { describePartnerForbidden, type ScreenChrome } from './screenView'

/**
 * 合作机构数据大屏 —— `/screen/:tab`（overview 机构总览 / usage 信息使用 / terminal 终端孪生）。
 *
 * 与管理员版同一套外壳与组件，差别在三处：只有本机构的三个页签；数据全部按本机构收窄
 * （服务端只从鉴权用户回源，地址与请求里一个机构标识都没有）；账号没绑机构时单独提示
 * （403 ORG_REQUIRED 与「角色不符」不是一回事，否则机构管理员会以为是权限没开）。
 *
 * 两种观看距离：桌面档嵌在后台内容区里，带筛选栏；展示档由「新窗口展示」打开（地址加 display=1），
 * 1920×1080 舞台等比铺满窗口，适合挂在服务点位的屏上无人值守。
 * 取数失败的说法（mock 演示模式不展示大屏数值 / 登录过期要「重新登录」/ kind === 'unauthorized'
 * 不自动跳走）统一在 @ai-job-print/ui 的 TwinShell。
 */

export default function PartnerScreenPage() {
  const { tab: rawTab } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = normalizePartnerTab(rawTab)
  const presenting = searchParams.get('display') === '1'
  const lite = searchParams.get('lite') === '1'
  // 动效可显式关掉（低性能机 / 录屏）。关掉后纵深层次保留，只是静止。
  const [motion, setMotion] = useState(true)
  const drift = useTwinBurnInDrift(presenting)
  useTwinNightlyReload(presenting)

  // 旧地址 /screen、缺省或非法页签：就地改写成规范地址，地址栏与实际视图一致。
  useEffect(() => {
    if (rawTab !== tab) navigate(screenHref(tab, searchParams, {}, true), { replace: true })
  }, [rawTab, tab, navigate, searchParams])

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
    tabs: PARTNER_SCREEN_TABS.map((item) => ({
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
    describeForbidden: describePartnerForbidden,
  }

  const content =
    tab === 'terminal' ? (
      <PartnerTerminalView chrome={chrome} />
    ) : tab === 'usage' ? (
      <PartnerUsageView chrome={chrome} />
    ) : (
      <PartnerGrid chrome={chrome} />
    )

  if (presenting) {
    return (
      <ScreenStage label="本机构数据大屏（展示）" motion={motion} onExit={exitDisplay}>
        <div style={{ transform: `translate(${drift[0]}px, ${drift[1]}px)` }}>{content}</div>
      </ScreenStage>
    )
  }

  return (
    <Page
      title="数据大屏"
      subtitle={withFrontendHint(
        '本机构终端与信息的只读视图，可新窗口展示；全部数值来自真实取数，给不出机构维度的指标如实标注',
        FRONTEND_HINT.screen,
      )}
    >
      <ScreenDesk label="本机构数据大屏" motion={motion}>
        {content}
      </ScreenDesk>
    </Page>
  )
}
