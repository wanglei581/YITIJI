// QxPrintHubView — 打印扫描 Hub 表现层。
//
// 结构对照 docs/design/kiosk-redesign-2026-08/10-print-hub.html：
//   小青横幅 → （异常态）状态块 → 01 要办什么（能力卡栅格）→ 02 已下过单（到机码 + 三张记录卡）→ 底注。
// 置灰口径不变：能力门禁型停用一律 aria-disabled + 常显原因 + onClick 短路，
// 不用原生 disabled、不用 title（触屏没有 hover）。
//
// 动效只做三件事：入场逐卡浮现、按压回弹、探测中的扫光。全部在 CSS 里，
// 不驱动任何业务状态；prefers-reduced-motion 下由 shell 与本页样式一并关掉。

import { type CSSProperties, type ReactNode } from 'react'
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
  /** 稿 10 的快捷区只有三张卡；标 compact 的入口收成 02 区标题行里的小按钮（仍可达、仍 ≥48px）。 */
  compact?: boolean
}

export interface QxPrintArrivalCodeView {
  key: string
  icon: LucideIcon
  title: string
  description: string
  /** 描述里要加粗的片段（稿 10 把两种码的位数加粗，便于用户对号）。 */
  emphasis?: readonly string[]
  stateNote?: string
}

type HubPageState = Exclude<HubUiState, 'feature-id-photo' | 'feature-not-found'>

interface QxPrintHubViewProps {
  hubState: HubPageState
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
    <section className="ph-xq" data-state={state}>
      <div className="ph-xq-row">
        <div className="ph-xq-face" aria-hidden="true">青</div>
        <div className="ph-xq-main">
          <div className="ph-xq-eyebrow">PRINT &amp; SCAN</div>
          {/* key 随状态换：探测结果回来时标题整句淡入，而不是原地跳字。 */}
          <h2 className="ph-xq-ask" key={state}>
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

/**
 * 稿 10 的 .state 块：四种语气（info 检查中 / error 读不到 / lock 管理员关闭 / warn 离线或未开放），
 * 标题行带图标，出口按钮放在标题行右侧，不另起一行吃掉栅格的高度。
 */
export function PrintHubState({
  kind,
  icon,
  heading,
  actions,
  testId,
  children,
}: {
  kind: 'info' | 'error' | 'lock' | 'warn'
  icon: ReactNode
  heading: ReactNode
  actions?: ReactNode
  testId: string
  children?: ReactNode
}) {
  return (
    <div className="ph-state" data-kind={kind} data-testid={testId} role="status">
      <div className="ph-state-h">
        <span className="ph-state-ic" aria-hidden="true">{icon}</span>
        <span className="ph-state-t">{heading}</span>
        {actions ? <span className="ph-state-acts">{actions}</span> : null}
      </div>
      {children}
    </div>
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

/** 记录卡 / 复印说明。Hub 与「能力说明不存在」页共用同一组卡面。 */
export function PrintHubRecordNotes({
  links,
  onOpen,
}: {
  links: readonly QxPrintQuickLinkView[]
  onOpen: (key: string) => void
}) {
  return (
    <div className="ph-notes">
      {links.map((link, index) => {
        const Icon = link.icon
        return (
          <button
            key={link.key}
            type="button"
            className="ph-note"
            style={stagger(index + 10)}
            data-testid={`print-hub-quick-${link.key}`}
            onClick={() => onOpen(link.key)}
          >
            <span className="ph-note-head">
              <span className="ph-note-ic" aria-hidden="true"><Icon size={24} /></span>
              <b>{link.title}</b>
              <span className="ph-note-go" aria-hidden="true">查看 →</span>
            </span>
            <span className="d">{link.description}</span>
          </button>
        )
      })}
      <div
        className="ph-note"
        style={stagger(links.length + 10)}
        role="group"
        data-testid="print-hub-copy-note"
        data-disclaimer="true"
        data-static="true"
      >
        <span className="ph-note-head">
          <span className="ph-note-ic" data-tone="wheat" aria-hidden="true">
            <CopyIcon size={24} />
          </span>
          <b>复印</b>
        </span>
        <span className="d">请直接在奔图机器面板上操作。本机网页没有复印流程，也不代收费。</span>
      </div>
    </div>
  )
}

/** 入场逐卡浮现的序号。只给 CSS 算 animation-delay，不参与任何逻辑。 */
function stagger(index: number): CSSProperties {
  return { '--ph-i': index } as CSSProperties
}

/** 把描述里的若干片段加粗；片段不在原文里就原样返回，不改一个字。 */
function emphasize(text: string, marks: readonly string[] = []): ReactNode {
  const hits = marks.filter((mark) => mark.length > 0 && text.includes(mark))
  if (hits.length === 0) return text
  const pattern = new RegExp(`(${hits.map((mark) => mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
  return text.split(pattern).map((part, index) =>
    hits.includes(part) ? <b key={index}>{part}</b> : part,
  )
}

function hubDoing(state: HubPageState): ReactNode {
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

function HubBanner({
  hubState,
  onRetry,
  onHelp,
}: {
  hubState: HubPageState
  onRetry: () => void
  onHelp: () => void
}) {
  const help = (
    <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>
      联系工作人员
    </button>
  )
  switch (hubState) {
    case 'capability-loading':
      return (
        <PrintHubState
          kind="info"
          icon={<span className="ph-dot ph-dot--breathe" />}
          heading="正在检查本机能力"
          testId="print-hub-fallback"
        >
          <p className="ph-state-p">
            读到配置之前，八项能力<b>一律不开</b>。这不是坏了，是不想让你点进去才发现办不了。到机码核销不受影响。
          </p>
        </PrintHubState>
      )
    case 'capability-error':
      return (
        <PrintHubState
          kind="error"
          icon={<InfoIcon size={28} />}
          heading="服务状态无法确认"
          testId="print-hub-fallback"
          actions={
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={onRetry}>
                重新检测
              </button>
              {help}
            </>
          }
        >
          <p className="ph-state-p">
            暂时无法确认这台机器开放了哪些服务，因此<b>八项能力先不开放</b>，避免你点进去后才发现办不了。
          </p>
          <p className="ph-state-p">已经下单的用户仍可使用到机码核销，不受本次读取失败影响。</p>
        </PrintHubState>
      )
    case 'locked':
      return (
        <PrintHubState kind="lock" icon={<LockIcon size={28} />} heading="有几项被管理员关掉了" testId="print-hub-fallback">
          <p className="ph-state-p">卡面上的理由直接来自能力配置，不是本机猜的。不受影响的项照常进。</p>
        </PrintHubState>
      )
    case 'device-off':
      return (
        <PrintHubState
          kind="warn"
          icon={<InfoIcon size={28} />}
          heading="打印扫描一体机离线 —— 要出纸的停了，其余照常"
          testId="print-hub-fallback"
          actions={help}
        >
          <p className="ph-state-p">
            这一条来自设备状态轮询的<b>确定离线</b>结果。手机扫码上传、格式转换、签名盖章不经过这台打印机，照常可用。
          </p>
        </PrintHubState>
      )
    default:
      return null
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
  const checking = probe === 'loading'

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
        <section className="ph-fallback" key={hubState}>
          <HubBanner hubState={hubState} onRetry={onRetry} onHelp={onHelp} />
        </section>
      ) : null}

      <section className="ph-sec ph-sec--grow" aria-labelledby="ph-sec-tasks">
        <div className="ph-sec-h">
          <span className="ph-no">01</span>
          <span className="t" id="ph-sec-tasks">要办什么</span>
          <span className="hint">{capabilityGroupHint}</span>
        </div>
        {showBanner ? null : axisChips(probe, mfp, colorDuplexLabel)}
        <div className="ph-grid" aria-busy={checking || undefined}>
          {capabilities.map((capability, index) => {
            const Icon = capability.icon
            const closed = !capability.actionable
            const badge = capability.unavailableBadge ?? '暂不可用'
            const reason = capability.note ? `${badge}：${capability.note}` : badge
            return (
              <button
                key={capability.key}
                type="button"
                className={`ph-cap${capability.wide ? ' ph-cap--wide' : ''}`}
                style={stagger(index)}
                data-testid={`print-hub-cap-${capability.key}`}
                aria-disabled={closed || undefined}
                aria-label={closed ? `${capability.title}（${reason}）` : capability.title}
                onClick={closed ? undefined : () => onCapability(capability.key)}
              >
                <span className="ph-cap-ic" data-tone={capability.iconTone} aria-hidden="true">
                  <Icon size={32} />
                </span>
                <span className="ph-cap-body">
                  <span className="ph-cap-name">{capability.title}</span>
                  {/* 停用且有具体原因时，原因顶替说明行：此刻「为什么点不了」比「这是干什么的」更要紧。 */}
                  {closed && capability.note ? (
                    <span className="ph-cap-desc ph-cap-note">{capability.note}</span>
                  ) : (
                    <span className="ph-cap-desc">{capability.description}</span>
                  )}
                </span>
                <span className="ph-cap-foot">
                  {closed ? (
                    <span className="ph-badge-off" data-busy={checking || undefined}>{badge}</span>
                  ) : (
                    capability.stateNote
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="ph-sec" aria-labelledby="ph-sec-records">
        <div className="ph-sec-h">
          <span className="ph-no">02</span>
          <span className="t" id="ph-sec-records">已下过单 · 我的文件</span>
          <span className="hint">{recordsGroupHint}</span>
          {quickLinks.filter((link) => link.compact).map((link) => {
            const Icon = link.icon
            return (
              <button
                key={link.key}
                type="button"
                className="ph-sec-act"
                data-testid={`print-hub-quick-${link.key}`}
                aria-label={`${link.title}：${link.description}`}
                onClick={() => onQuickLink(link.key)}
              >
                <Icon size={22} aria-hidden="true" />
                {link.title}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="ph-src"
          style={stagger(9)}
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
            <span className="ph-src-desc">{emphasize(arrivalCode.description, arrivalCode.emphasis)}</span>
            {arrivalCode.stateNote ? (
              <span className="ph-src-reason">{arrivalCode.stateNote}</span>
            ) : null}
          </span>
          <span className="ph-src-go" aria-hidden="true">
            <ArrowRightIcon size={28} />
          </span>
        </button>
        <PrintHubRecordNotes links={quickLinks.filter((link) => !link.compact)} onOpen={onQuickLink} />
      </section>

      <footer className="ph-foot">
        <PrintHubTruth />
        {notices.length > 0 ? (
          // 全文逐字保留，只是默认收起：开关常驻底注右侧，点开在底注上方展开（原生 details，键盘 / 读屏可达）。
          <details className="ph-notices" data-disclaimer="true">
            <summary>
              <span>隐私、电子签与价格说明</span>
              <span className="ph-notices-go">点开看全文</span>
            </summary>
            <p>{notices.join(' ')}</p>
          </details>
        ) : null}
      </footer>
    </div>
  )
}
