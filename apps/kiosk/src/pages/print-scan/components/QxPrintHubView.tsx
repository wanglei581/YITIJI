// QxPrintHubView — 打印扫描 Hub 表现层。
//
// 结构对照 docs/design/kiosk-redesign-2026-08/10-print-hub.html。
// 置灰口径不变：能力门禁型停用一律 aria-disabled + 常显原因 + onClick 短路，
// 不用原生 disabled、不用 title（触屏没有 hover）。

import { type ReactNode } from 'react'
import {
  ArrowRightIcon,
  CopyIcon,
  HomeIcon,
  InfoIcon,
  LockIcon,
  SparklesIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  HUB_ASK,
  HUB_TRUTH,
  type HubUiState,
  type MfpStatus,
  type ProbeStatus,
} from '../printHubContent'

export interface QxPrintCapabilityView {
  key: string
  icon: LucideIcon
  title: string
  description: string
  iconTone: 'teal' | 'slate' | 'clay' | 'wheat'
  wide?: boolean
  available: boolean
  actionable: boolean
  stateNote?: string
  unavailableBadge?: string
  note?: string
}

export interface QxPrintQuickLinkView {
  key: string
  icon: LucideIcon
  title: string
  description: string
}

export interface QxPrintArrivalCodeView {
  key: string
  icon: LucideIcon
  title: string
  description: string
  stateNote?: string
}

interface QxPrintHubViewProps {
  hubState: Exclude<HubUiState, 'feature-id-photo' | 'feature-not-found'>
  probe: ProbeStatus
  mfp: MfpStatus
  colorDuplexLabel: string
  capabilities: readonly QxPrintCapabilityView[]
  arrivalCode: QxPrintArrivalCodeView
  quickLinks: readonly QxPrintQuickLinkView[]
  capabilityGroupHint: string
  recordsGroupHint: string
  notices: readonly string[]
  onRetry: () => void
  onHelp: () => void
  onCapability: (key: string) => void
  onArrivalCode: () => void
  onQuickLink: (key: string) => void
}

export function PrintHubNavbar({
  onHome,
  onAdvisor,
  onProfile,
}: {
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
}) {
  return (
    <>
      <button type="button" className="qx-nav-item" onClick={onHome} data-route="/">
        <HomeIcon size={34} aria-hidden />
        首页
      </button>
      <button type="button" className="qx-nav-item" onClick={onAdvisor} data-route="/assistant">
        <SparklesIcon size={34} aria-hidden />
        AI 顾问
      </button>
      <button type="button" className="qx-nav-item" onClick={onProfile} data-route="/profile">
        <UserIcon size={34} aria-hidden />
        我的
      </button>
    </>
  )
}

export function PrintHubHero({ state, doing }: { state: HubUiState; doing: ReactNode }) {
  const ask = HUB_ASK[state]
  const i = ask.text.indexOf(ask.em)
  return (
    <section className="ph-xq" aria-hidden="false">
      <div className="ph-xq-row">
        <div className="ph-xq-face" aria-hidden="true">青</div>
        <div>
          <div className="ph-xq-eyebrow">PRINT &amp; SCAN</div>
          <h2 className="ph-xq-ask">
            {i < 0 ? (
              ask.text
            ) : (
              <>
                {ask.text.slice(0, i)}
                <em>{ask.em}</em>
                {ask.text.slice(i + ask.em.length)}
              </>
            )}
          </h2>
          <p className="ph-xq-doing">{doing}</p>
        </div>
      </div>
    </section>
  )
}

export function PrintHubTruth() {
  return (
    <div className="ph-truth" data-disclaimer="true" data-testid="print-hub-truth">
      {HUB_TRUTH.map((row) => (
        <div key={row.k}>
          <b>{row.k}</b>
          {row.v}
        </div>
      ))}
    </div>
  )
}

function hubDoing(state: Exclude<HubUiState, 'feature-id-photo' | 'feature-not-found'>): ReactNode {
  switch (state) {
    case 'capability-loading':
      return '读到配置之前八项一律不开。到机码核销不受影响。'
    case 'capability-error':
      return '读不到就不放行 —— 八项全关。到机码核销的是已有订单，不受影响。'
    case 'locked':
      return '理由直接来自能力配置，不是我猜的。'
    case 'device-off':
      return '要打印机的停了，不用打印机的照常。'
    default:
      return (
        <>
          打印、扫描、图片转 PDF、签名盖章都在这台机器上。
          <b>能不能办，进入后按真实状态确认。</b>
        </>
      )
  }
}

function axisChips(probe: ProbeStatus, mfp: MfpStatus, colorDuplexLabel: string) {
  const capTone = probe === 'ok' ? 'ok' : probe === 'error' ? 'bad' : undefined
  const capText =
    probe === 'ok' ? '能力配置 · 已读取' : probe === 'loading' ? '能力配置 · 读取中' : '能力配置 · 读不到'
  const mfpTone = probe !== 'ok' ? undefined : mfp === 'unavailable' ? 'warn' : undefined
  const mfpText =
    probe !== 'ok'
      ? '一体机状态 · 未查询'
      : mfp === 'unavailable'
        ? '一体机 · 确认离线'
        : '一体机状态 · 以办理时确认'
  return (
    <div className="ph-axes" data-testid="print-hub-axes">
      <span className="ph-chip" data-tone={capTone}>{capText}</span>
      <span className="ph-chip" data-tone={mfpTone}>{mfpText}</span>
      <span className="ph-chip">纸张 · 仅 A4</span>
      <span className="ph-chip">{colorDuplexLabel}</span>
      <span className="ph-chip">U 盘网桥 · Windows 真机未验收</span>
    </div>
  )
}

export function QxPrintHubView({
  hubState,
  probe,
  mfp,
  colorDuplexLabel,
  capabilities,
  arrivalCode,
  quickLinks,
  capabilityGroupHint,
  recordsGroupHint,
  notices,
  onRetry,
  onHelp,
  onCapability,
  onArrivalCode,
  onQuickLink,
}: QxPrintHubViewProps) {
  const ArrivalIcon = arrivalCode.icon
  const showBanner = hubState !== 'default'

  return (
    <div
      className="qx-scroll ph-page"
      data-w2-page="print-scan-home"
      data-qx-page="print-hub"
      data-state={hubState}
      data-testid={`print-hub-state-${hubState}`}
    >
      <PrintHubHero state={hubState} doing={hubDoing(hubState)} />

      {showBanner ? (
        <section className="ph-fallback">
          {hubState === 'capability-loading' ? (
            <div className="qx-state" data-tone="info" data-testid="print-hub-fallback">
              <span className="qx-state-ic"><span className="ph-dot ph-dot--breathe" /></span>
              <span>
                <div className="qx-state-t">正在检查本机能力</div>
                <p className="qx-state-d">
                  读到配置之前，八项能力<b>一律不开</b>。这不是坏了，是不想让你点进去才发现办不了。到机码核销不受影响。
                </p>
              </span>
            </div>
          ) : null}
          {hubState === 'capability-error' ? (
            <div className="qx-state" data-tone="error" data-testid="print-hub-fallback">
              <span className="qx-state-ic"><InfoIcon size={28} aria-hidden /></span>
              <span>
                <div className="qx-state-t">服务状态无法确认</div>
                <p className="qx-state-d">
                  暂时无法确认这台机器开放了哪些服务，因此<b>八项能力先不开放</b>，避免你点进去后才发现办不了。
                </p>
                <p className="qx-state-d">已经下单的用户仍可使用到机码核销，不受本次读取失败影响。</p>
                <div className="ph-fallback-actions">
                  <button type="button" className="qx-btn" data-variant="ghost" onClick={onRetry}>
                    重新检测
                  </button>
                  <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>
                    联系工作人员
                  </button>
                </div>
              </span>
            </div>
          ) : null}
          {hubState === 'locked' ? (
            <div className="qx-state" data-tone="info" data-testid="print-hub-fallback">
              <span className="qx-state-ic"><LockIcon size={28} aria-hidden /></span>
              <span>
                <div className="qx-state-t">有几项被管理员关掉了</div>
                <p className="qx-state-d">卡面上的理由直接来自能力配置，不是本机猜的。不受影响的项照常进。</p>
              </span>
            </div>
          ) : null}
          {hubState === 'device-off' ? (
            <div className="qx-state" data-tone="empty" data-testid="print-hub-fallback">
              <span className="qx-state-ic"><InfoIcon size={28} aria-hidden /></span>
              <span>
                <div className="qx-state-t">打印扫描一体机离线 —— 要出纸的停了，其余照常</div>
                <p className="qx-state-d">
                  这一条来自设备状态轮询的<b>确定离线</b>结果。手机扫码上传、格式转换、签名盖章不经过这台打印机，照常可用。
                </p>
                <div className="ph-fallback-actions">
                  <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>
                    联系工作人员
                  </button>
                </div>
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="ph-sec ph-sec--grow">
        <div className="ph-sec-h">
          <span className="ph-no">01</span>
          <span className="t">要办什么</span>
          <span className="hint">{capabilityGroupHint}</span>
        </div>
        {showBanner ? null : axisChips(probe, mfp, colorDuplexLabel)}
        <div className="ph-grid">
          {capabilities.map((capability) => {
            const Icon = capability.icon
            const closed = !capability.actionable
            const reason = capability.note ?? capability.unavailableBadge
            const foot = closed ? reason : capability.stateNote
            return (
              <button
                key={capability.key}
                type="button"
                className={`ph-cap${capability.wide ? ' ph-cap--wide' : ''}`}
                data-testid={`print-hub-cap-${capability.key}`}
                aria-disabled={closed || undefined}
                aria-label={closed ? `${capability.title}（${foot ?? '暂不可用'}）` : capability.title}
                onClick={closed ? undefined : () => onCapability(capability.key)}
              >
                <span className="ph-cap-ic" data-tone={capability.iconTone} aria-hidden="true">
                  <Icon size={32} />
                </span>
                {capability.wide ? (
                  <span className="ph-cap-body">
                    <span className="ph-cap-name">{capability.title}</span>
                    <span className="ph-cap-desc">{capability.description}</span>
                  </span>
                ) : (
                  <>
                    <span className="ph-cap-name">{capability.title}</span>
                    <span className="ph-cap-desc">{capability.description}</span>
                  </>
                )}
                <span className="ph-cap-foot">
                  {closed ? (
                    <>
                      <span className="ph-badge-off">{capability.unavailableBadge ?? '暂不可用'}</span>
                      {capability.note ? <span>{capability.note}</span> : null}
                    </>
                  ) : (
                    foot
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="ph-sec">
        <div className="ph-sec-h">
          <span className="ph-no">02</span>
          <span className="t">已下过单 · 我的文件</span>
          <span className="hint">{recordsGroupHint}</span>
        </div>
        <button
          type="button"
          className="ph-src"
          data-testid="print-hub-primary"
          data-arrival="true"
          onClick={onArrivalCode}
        >
          <span className="ph-src-ic" data-tone="clay" aria-hidden="true">
            <ArrivalIcon size={42} />
          </span>
          <span className="ph-src-main">
            <span className="ph-src-name">
              {arrivalCode.title}
              <span className="ph-tag">不是取件码</span>
            </span>
            <span className="ph-src-desc">{arrivalCode.description}</span>
            {arrivalCode.stateNote ? (
              <span className="ph-src-reason">{arrivalCode.stateNote}</span>
            ) : null}
          </span>
          <span className="ph-src-go" aria-hidden="true">
            <ArrowRightIcon size={28} />
          </span>
        </button>
        <div className="ph-stack" />
        <div className="ph-notes">
          {quickLinks.map((link) => {
            const Icon = link.icon
            return (
              <button
                key={link.key}
                type="button"
                className="ph-note"
                data-testid={`print-hub-quick-${link.key}`}
                onClick={() => onQuickLink(link.key)}
              >
                <span className="ph-note-ic" aria-hidden="true"><Icon size={26} /></span>
                <span>
                  <b>{link.title}</b>
                  <span className="d">{link.description}</span>
                  <span className="ph-note-go">查看 →</span>
                </span>
              </button>
            )
          })}
          <div className="ph-note" role="group" data-testid="print-hub-copy-note" data-disclaimer="true" data-static="true">
            <span className="ph-note-ic" data-tone="wheat" aria-hidden="true">
              <CopyIcon size={26} />
            </span>
            <span>
              <b>复印</b>
              <span className="d">请直接在奔图机器面板上操作。本机网页没有复印流程，也不代收费。</span>
            </span>
          </div>
        </div>
      </section>

      {notices.length > 0 ? (
        <p className="ph-notices" data-disclaimer="true">
          {notices.join(' ')}
        </p>
      ) : null}

      <PrintHubTruth />
    </div>
  )
}
