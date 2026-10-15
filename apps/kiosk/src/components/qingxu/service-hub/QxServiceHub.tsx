// QxServiceHub — 青序流光服务中心（五个域共用一个宿主）。
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/16-service-hubs.html
//   稿里五个 hub 共用同一个 HTML，只换 ?hub= 的数据；运行时同理——
//   /resume-service /jobs-service /fairs-service /interview-service /policy-service
//   各自的页面文件只声明本域的入口表与文案，渲染全部走这里，不各抄一份。
//
// 本页只负责分流，不预报在线、名额、价格或办理结果（稿 .notice 原文）。
// 两条真实状态轴：
//   ① 在线服务 useApiReadiness —— 探测完成前 / 失败时，需要在线处理的入口一律不开；
//   ② 本机设备（KioskRoot 的 Outlet context）—— 只用于如实提示，不替进入后的
//      具体流程做设备判定。拿不到就说「以办理时确认为准」，绝不写「设备正常」。
// 稿里的 first（目标选择）与 ai-down 两态不落地：前者与能力卡同址，是重复入口；
// 后者在 hub 层没有真实的 AI 可用性信号，画出来就是伪造状态。

import { type ReactNode } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { ChevronRightIcon, type LucideIcon } from 'lucide-react'
import { ServiceReadinessStrip } from '../../ServiceReadinessStrip'
import { QxAppNavbar } from '../QxAppNavbar'
import { QxPageFrame } from '../QxPageFrame'
import { useApiReadiness } from '../../../hooks/useApiReadiness'
import type { TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'
import { getTerminalCode } from '../../../services/api/terminalConfig'
import './service-hub-qx.css'

export type QxHubKey = 'resume' | 'jobs' | 'fairs' | 'interview' | 'policy'

export interface QxHubCard {
  key: string
  icon: LucideIcon
  title: string
  description: string
  /** 稿 .badge：来源 / AI 角色 / 设备依赖，只写事实，不写营销词。 */
  badge: string
  to: string
  state?: Record<string, unknown>
  /** 稿 data-kind：ai 走梅紫、info 走石青、device 走青绿。 */
  kind: 'ai' | 'info' | 'device'
  /** false = 不需要在线服务也能进入（静态指引、外部平台二维码目录）。默认需要。 */
  requiresApi?: boolean
}

export interface QxHubQuickLink {
  key: string
  icon: LucideIcon
  title: string
  description: string
  to: string
}

export interface QxServiceHubProps {
  hub: QxHubKey
  /** 域名。落在 QxPageFrame 的 h1（读屏与门禁锚点），视觉上由 hero 承载。 */
  domainTitle: string
  domainSubtitle: string
  hero: { eyebrow: string; title: string; subtitle: string; noteTitle: string; note: string }
  section: { title: string; hint: string }
  cards: readonly QxHubCard[]
  quickTitle: string
  quickHint: string
  quickLinks: readonly QxHubQuickLink[]
  /** 稿 .truth 第一栏：本域的合规边界。 */
  boundary: { title: string; copy: ReactNode }
}

function isDeviceDown(device: TerminalDeviceStatusView | undefined): boolean {
  return !!device && !device.loading && (device.kind === 'offline' || device.kind === 'error')
}

export function QxServiceHub({
  hub,
  domainTitle,
  domainSubtitle,
  hero,
  section,
  cards,
  quickTitle,
  quickHint,
  quickLinks,
  boundary,
}: QxServiceHubProps) {
  const navigate = useNavigate()
  const device = useOutletContext<TerminalDeviceStatusView | undefined>()
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const apiBlocked = apiStatus !== 'ready'
  const deviceDown = isDeviceDown(device)
  const terminalCode = getTerminalCode() || '设备未绑定'

  const pill =
    apiStatus === 'unavailable'
      ? { tone: 'warn' as const, label: '在线服务暂不可用，本页入口暂停' }
      : deviceDown
        ? { tone: 'warn' as const, label: '本机设备不可用，信息与AI服务仍可进入' }
        : { tone: 'unknown' as const, label: '能力与设备状态以办理时确认为准' }

  const chips = deviceDown
    ? ['能力配置 · 以办理时确认', '本机设备 · 暂不可用', '信息与AI · 进入后确认']
    : ['能力配置 · 以办理时确认', '来源与流程 · 进入后确认', '本页只做分流']

  return (
    <QxPageFrame
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      title={domainTitle}
      subtitle={domainSubtitle}
      status={pill}
      terminalLabel={`就业服务大厅 · ${terminalCode}`}
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <div
        className="qx-hub"
        data-hub={hub}
        data-testid={`${hub}-hub`}
        data-card-count={cards.length}
        data-readiness={apiStatus}
        data-device={deviceDown ? 'down' : 'unconfirmed'}
      >
        <section className="qx-hub-hero" aria-labelledby={`${hub}-hub-hero-title`}>
          <span className="qx-hub-avatar" aria-hidden="true">青</span>
          <div className="qx-hub-hero-main">
            <p className="qx-hub-eyebrow">{hero.eyebrow}</p>
            <h2 id={`${hub}-hub-hero-title`}>{hero.title}</h2>
            <p className="qx-hub-hero-sub">{hero.subtitle}</p>
            <p className="qx-hub-hero-note">
              <b>{hero.noteTitle}</b>
              <span>{hero.note}</span>
            </p>
          </div>
        </section>

        <ServiceReadinessStrip status={apiStatus} onRetry={retryApi} />
        {deviceDown ? (
          <p className="qx-hub-device-note" role="note">
            <b>本机设备当前不可用。</b>
            信息浏览和AI服务仍可进入；涉及出纸或扫描的具体步骤请稍后再试。
          </p>
        ) : null}

        <section className="qx-hub-sec" aria-labelledby={`${hub}-hub-section-title`}>
          <div className="qx-hub-sec-h">
            <span className="no" aria-hidden="true">01</span>
            <h2 id={`${hub}-hub-section-title`}>{section.title}</h2>
            <span className="hint">{section.hint}</span>
            <b className="count">{cards.length}项</b>
          </div>
          <div className="qx-hub-chips">
            {chips.map((chip) => (
              <span key={chip} className="qx-hub-chip">{chip}</span>
            ))}
          </div>
          <div className="qx-hub-grid">
            {cards.map((card) => {
              const Icon = card.icon
              const blocked = apiBlocked && card.requiresApi !== false
              return (
                <button
                  key={card.key}
                  type="button"
                  className="qx-hub-card"
                  data-kind={card.kind}
                  data-route={card.to}
                  data-blocked={blocked ? 'true' : undefined}
                  disabled={blocked}
                  onClick={() => {
                    if (!blocked) navigate(card.to, card.state ? { state: card.state } : undefined)
                  }}
                >
                  <span className="qx-hub-card-head">
                    <span className="qx-hub-card-ic"><Icon size={28} aria-hidden /></span>
                    <h3>{card.title}</h3>
                  </span>
                  <span className="qx-hub-card-desc">{card.description}</span>
                  <span className="qx-hub-card-foot">
                    <span className="qx-hub-badge">{card.badge}</span>
                    <span className="qx-hub-go">
                      {blocked ? '等待服务' : '进入'}
                      <ChevronRightIcon size={20} aria-hidden />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="qx-hub-quick-sec" aria-labelledby={`${hub}-hub-quick-title`}>
          <div className="qx-hub-quick-h">
            <span className="no" aria-hidden="true">02</span>
            <h2 id={`${hub}-hub-quick-title`}>{quickTitle}</h2>
            <span>{quickHint}</span>
          </div>
          <div className="qx-hub-quick" data-count={quickLinks.length}>
            {quickLinks.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.key}
                  type="button"
                  className="qx-hub-quick-item"
                  data-route={link.to}
                  data-blocked={apiBlocked ? 'true' : undefined}
                  disabled={apiBlocked}
                  onClick={() => {
                    if (!apiBlocked) navigate(link.to)
                  }}
                >
                  <Icon size={27} aria-hidden />
                  <span>
                    <b>{link.title}</b>
                    <span>{link.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <footer className="qx-hub-truth" data-testid={`${hub}-hub-boundary`}>
          <div>
            <b>{boundary.title}</b>
            <span>{boundary.copy}</span>
          </div>
          <div>
            <b>能力</b>
            <span>进入具体服务后按实际状态确认，不以本页为准。</span>
          </div>
          <div>
            <b>隐私</b>
            <span>结束会话或闲置超时清除本机登录态与临时会话信息。</span>
          </div>
        </footer>
      </div>
    </QxPageFrame>
  )
}
