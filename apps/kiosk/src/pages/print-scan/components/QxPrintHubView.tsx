// QxPrintHubView — 打印扫描 Hub 表现层。
//
// 结构对照 docs/design/kiosk-redesign-2026-08-v2/10-print-hub.html：
//   小青横幅 → （异常态）状态块 → 01 要办什么（能力卡栅格）→ 02 已下过单（到机码 + 三张记录卡）→ 底注。
// 置灰口径不变：能力门禁型停用一律 aria-disabled + 常显原因 + onClick 短路，
// 不用原生 disabled、不用 title（触屏没有 hover）。
//
// 动效只做三件事：入场逐卡浮现、按压回弹、探测中的扫光。全部在 CSS 里，
// 不驱动任何业务状态；prefers-reduced-motion 下由 shell 与本页样式一并关掉。

import { type CSSProperties, type ReactNode } from 'react'
import { PrintAiHelp } from '../../print/components/PrintAiHelp'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import {
  ArrowRightIcon,
  CopyIcon,
  InfoIcon,
  LockIcon,
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
  onBack: () => void
}

export const PrintHubNavbar = QxAppNavbar

export function PrintHubHero({ state, doing }: { state: HubUiState; doing: ReactNode }) {
  const ask = HUB_ASK[state]
  const i = ask.text.indexOf(ask.em)
  return (
    <section className="ph-xq" data-state={state}>
      <div className="ph-xq-row">
        <div className="ph-xq-face" aria-hidden="true">青</div>
        <div className="ph-xq-main">
          <div className="ph-xq-eyebrow">打印扫描</div>
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
        <span className="d">在打印机面板上操作，取走纸质复印件。</span>
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
      return '正在确认可用服务，请稍候。已有订单仍可使用到机码。'
    case 'capability-error':
      return '暂时无法确认可用服务，请重试。已有订单仍可使用到机码。'
    case 'locked':
      return '理由直接来自能力配置，不是我猜的。'
    case 'device-off':
      return '要打印机的停了，不用打印机的照常。'
    default:
      return (
        <>
          选好材料，一步步做成<b>打印件或 PDF</b>。
        </>
      )
  }
}

function HubBanner({
  hubState,
}: {
  hubState: HubPageState
}) {
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
            正在确认本机有哪些可用服务。确认前<b>暂不能进入</b>，已有订单仍可使用到机码。
          </p>
        </PrintHubState>
      )
    case 'capability-error':
      return (
        <PrintHubState
          kind="error"
          icon={<InfoIcon size={28} />}
          heading="暂时读不到这台机器的配置"
          testId="print-hub-fallback"

        >
          <p className="ph-state-p">
            暂时读不到这台机器的配置，因此<b>入口先关着</b>，请联系现场工作人员。
          </p>
          <p className="ph-state-p">已经下单的用户仍可使用到机码核销，不受本次读取失败影响。</p>
        </PrintHubState>
      )
    case 'locked':
      return (
        <PrintHubState kind="lock" icon={<LockIcon size={28} />} heading="有几项被管理员关掉了" testId="print-hub-fallback">
          <p className="ph-state-p">请查看卡片上的停用原因，其他服务可以继续办理。</p>
        </PrintHubState>
      )
    case 'device-off':
      return (
        <PrintHubState
          kind="warn"
          icon={<InfoIcon size={28} />}
          heading="打印扫描一体机离线 —— 要出纸的停了，其余照常"
          testId="print-hub-fallback"
        >
          <p className="ph-state-p">
            打印机当前<b>无法连接</b>。手机扫码上传、格式转换、签名盖章仍可使用。
          </p>
        </PrintHubState>
      )
    default:
      return null
  }
}

function axisChips(probe: ProbeStatus, mfp: MfpStatus, colorDuplexLabel: string) {
  return (
    <div className="ph-axes" data-testid="print-hub-axes" data-probe={probe} data-mfp={mfp}>
      <span>文件检查 → 设置参数 → 确认价格</span>
      <span>按 A4 出纸 · {colorDuplexLabel}</span>
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
  onBack,
}: QxPrintHubViewProps) {
  const ArrivalIcon = arrivalCode.icon
  const showBanner = hubState !== 'default'
  const checking = probe === 'loading'

  return (
    <div
      className="qx-scroll ph-page"
      data-w2-page="print-scan-home"
      data-qx-page="print-hub"
      data-takeaway="打印件或 PDF"
      data-state={hubState}
      data-testid={`print-hub-state-${hubState}`}
    >
      <PrintHubHero state={hubState} doing={hubDoing(hubState)} />

      {showBanner ? (
        <section className="ph-fallback" key={hubState}>
          <HubBanner hubState={hubState} />
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

      <div className="ph-actions">
        <button type="button" onClick={onBack}>上一步</button>
        {hubState === 'capability-error' ? <button type="button" onClick={onRetry}>重新检测</button> : null}
        {showBanner ? <button type="button" onClick={onHelp}>联系工作人员</button> : null}
        <PrintAiHelp label="问小青：怎么选打印方式 →" draft="我想打印一份文件，应该选手机上传、U 盘还是扫描？请帮我选一种方式。" />
      </div>
      <footer className="ph-foot">
        <div className="ph-truth" data-disclaimer="true" data-testid="print-hub-truth"><div>可用服务与价格，以办理时显示为准。</div></div>
        {notices.length > 0 ? (
          // 全文逐字保留，只是默认收起：开关常驻底注右侧，点开在底注上方展开（原生 details，键盘 / 读屏可达）。
          <details className="ph-notices" data-disclaimer="true">
            <summary>
              <span>隐私、电子签与价格说明</span>
              <span className="ph-notices-go">点开看全文</span>
            </summary>
            <p>{HUB_TRUTH.map((row) => `${row.k}：${row.v}`).join(' ')} {notices.join(' ')}</p>
          </details>
        ) : null}
      </footer>
    </div>
  )
}
