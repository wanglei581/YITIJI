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
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { QxTouchChip } from '../../../components/qingxu/touch/QxTouchChip'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import {
  CopyIcon,
  InfoIcon,
  LockIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  COPY_GUIDE_KEY,
  HUB_ASK,
  HUB_TRUTH,
  type HubFeatureState,
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

type HubPageState = Exclude<HubUiState, HubFeatureState>

interface QxPrintHubViewProps {
  hubState: HubPageState
  probe: ProbeStatus
  mfp: MfpStatus
  /** 打印闸门合上：沿用 device-off 的停用样式，只换短标题和说明。 */
  orderPaused?: { label: string; notice: string }
  printerUnavailable?: { label: string; notice: string }
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

export function PrintHubHero({
  state,
  doing,
  askText,
}: {
  state: HubUiState
  doing: ReactNode
  askText?: { text: string; em: string }
}) {
  const ask = askText ?? HUB_ASK[state]
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

/**
 * 记录卡 / 复印说明。Hub 与「能力说明不存在」页共用同一组卡面。
 *
 * 复印卡：2.0 稿 10 画的是不可点的静态说明卡。R4（2026-09-29 产品负责人拍板）改成可点，
 * 点进 /print-scan/feature/copy 看「怎么在打印机面板上复印」；卡面样子、图标、说明句不变，
 * 只补一个与另两张卡同样式的去向提示。点击回调走 onOpen(COPY_GUIDE_KEY)，由页面决定跳转。
 */
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
      <button
        type="button"
        className="ph-note"
        style={stagger(links.length + 10)}
        data-testid="print-hub-copy-note"
        onClick={() => onOpen(COPY_GUIDE_KEY)}
      >
        <span className="ph-note-head">
          <span className="ph-note-ic" data-tone="wheat" aria-hidden="true">
            <CopyIcon size={24} />
          </span>
          <b>复印</b>
          <span className="ph-note-go" aria-hidden="true">看步骤 →</span>
        </span>
        <span className="d">在打印机面板上操作，取走纸质复印件。</span>
      </button>
    </div>
  )
}

/** emphasize 的组件形态，给说明页复用（复印步骤里把屏幕按钮名加粗）。 */
export function PrintHubEmphasis({ text, marks }: { text: string; marks?: readonly string[] }) {
  return <>{emphasize(text, marks)}</>
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
  orderPaused,
  printerUnavailable,
  usableServices,
}: {
  hubState: HubPageState
  orderPaused?: { label: string; notice: string }
  printerUnavailable?: { label: string; notice: string }
  usableServices: string
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
          heading="服务状态无法确认"
          testId="print-hub-fallback"

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
          <p className="ph-state-p">请查看卡片上的停用原因，其他服务可以继续办理。</p>
        </PrintHubState>
      )
    case 'device-off':
      return (
        <PrintHubState
          kind="warn"
          icon={<InfoIcon size={28} />}
          heading={orderPaused ? orderPaused.label : `${printerUnavailable?.label ?? '打印机暂不可用'} · 出纸类暂停`}
          testId="print-hub-fallback"
        >
          <p className="ph-state-p">
            {orderPaused ? orderPaused.notice : (
              <>{printerUnavailable?.notice ?? '打印机暂不可用 · 出纸类暂停'}。{usableServices ? `${usableServices}仍可使用。` : '请查看卡片上的可用状态。'}</>
            )}
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
      <span>选文件 → 材料检查 → 预览与参数 → 核对价格</span>
      <span>按 A4 出纸 · {colorDuplexLabel}</span>
    </div>
  )
}

const HUB_CAP_ICON: Record<string, QxTouchIconName> = {
  'doc-print': 'printer',
  scan: 'scan',
  'photo-print': 'image',
  'phone-upload': 'phone',
  'usb-import': 'usb',
  convert: 'layers',
  sign: 'pen',
  'id-photo': 'idcard',
}

function HubCapButton({
  capability,
  index,
  variant,
  onCapability,
}: {
  capability: QxPrintCapabilityView
  index: number
  variant: 'task' | 'tile'
  onCapability: (key: string) => void
}) {
  const closed = !capability.actionable
  const badge = capability.unavailableBadge ?? '暂不可用'
  const reason = capability.note ? `${badge}：${capability.note}` : badge
  const icon = HUB_CAP_ICON[capability.key] ?? 'file'
  const desc = closed && capability.note ? capability.note : capability.description
  return (
    <button
      type="button"
      className={variant === 'task'
        ? `qxt-task qxt-rise${closed ? ' qxt-hold' : ''}`
        : `qxt-tile qxt-rise qxt-tile-stack${closed ? ' qxt-off qxt-hold' : ''}`}
      style={stagger(index)}
      data-testid={`print-hub-cap-${capability.key}`}
      aria-disabled={closed || undefined}
      aria-label={closed ? `${capability.title}（${reason}）` : capability.title}
      onClick={closed ? undefined : () => onCapability(capability.key)}
    >
      {variant === 'task' ? (
        <>
          <div className="qxt-top">
            <span className="qxt-ic"><QxTouchIcon name={icon} size={40} /></span>
            {closed ? <QxTouchChip tone="slate">{badge}</QxTouchChip> : null}
          </div>
          <h3>{capability.title}</h3>
          <p>{desc}</p>
          {!closed && capability.stateNote ? <div className="qxt-take"><span>{capability.stateNote}</span></div> : null}
        </>
      ) : (
        <>
          <span className="qxt-ic"><QxTouchIcon name={icon} size={34} /></span>
          <span className="qxt-tx"><b>{capability.title}</b><small>{desc}</small></span>
        </>
      )}
    </button>
  )
}

export function QxPrintHubView({
  hubState,
  probe,
  mfp,
  colorDuplexLabel,
  printerUnavailable,
  capabilities,
  arrivalCode,
  quickLinks,
  capabilityGroupHint,
  recordsGroupHint,
  notices,
  orderPaused,
  onRetry,
  onHelp,
  onCapability,
  onArrivalCode,
  onQuickLink,
  onBack,
}: QxPrintHubViewProps) {
  const showBanner = hubState !== 'default'
  const usableServices = capabilities.filter((item) => item.actionable && ['phone-upload', 'usb-import', 'convert', 'sign'].includes(item.key)).map((item) => item.title).join('、')
  const checking = probe === 'loading'
  const mainCaps = capabilities.filter((item) => item.key === 'doc-print' || item.key === 'scan')
  const toolOrder = ['photo-print', 'convert', 'sign', 'id-photo', 'phone-upload', 'usb-import']
  const toolCaps = capabilities
    .filter((item) => item.key !== 'doc-print' && item.key !== 'scan')
    .slice()
    .sort((a, b) => (toolOrder.indexOf(a.key) < 0 ? 99 : toolOrder.indexOf(a.key)) - (toolOrder.indexOf(b.key) < 0 ? 99 : toolOrder.indexOf(b.key)))
  const holdTransfer = mfp === 'unavailable' && toolCaps.some((item) => (item.key === 'phone-upload' || item.key === 'usb-import') && item.actionable)

  return (
    <div
      className="qx-scroll ph-page qxt-print-hub"
      data-w2-page="print-scan-home"
      data-qx-page="print-hub"
      data-takeaway="打印件或 PDF"
      data-state={hubState}
      data-testid={`print-hub-state-${hubState}`}
    >
      <PrintHubHero
        state={hubState}
        doing={orderPaused ? orderPaused.label : hubDoing(hubState)}
        askText={orderPaused ? { text: orderPaused.notice, em: '暂时不可用' } : undefined}
      />

      {showBanner ? (
        <section className="ph-fallback" key={hubState}>
          <HubBanner hubState={hubState} orderPaused={orderPaused} printerUnavailable={printerUnavailable} usableServices={usableServices} />
        </section>
      ) : null}

      <div className="qxt-sec" id="ph-sec-tasks">
        要办什么
        <small>{capabilityGroupHint}</small>
      </div>
      {showBanner ? null : axisChips(probe, mfp, colorDuplexLabel)}
      {holdTransfer ? <p className="qxt-fine qxt-fine-tight">先传、稍后打印。手机和 U 盘仍可把文件存上来。</p> : null}
      <div className="qxt-grid2 ph-grid" aria-busy={checking || undefined}>
        {mainCaps.map((capability, index) => (
          <HubCapButton key={capability.key} capability={capability} index={index} variant="task" onCapability={onCapability} />
        ))}
        <button type="button" className="qxt-task qxt-rise" style={stagger(2)} onClick={() => onQuickLink(COPY_GUIDE_KEY)}>
          <div className="qxt-top">
            <span className="qxt-ic"><QxTouchIcon name="copy" size={40} /></span>
          </div>
          <h3>复印</h3>
          <p>在打印机面板上操作，取走纸质复印件。</p>
          <div className="qxt-take"><span>看步骤</span></div>
        </button>
        <button
          type="button"
          className="qxt-task qxt-rise ph-src"
          style={stagger(3)}
          data-testid="print-hub-primary"
          data-arrival="true"
          onClick={onArrivalCode}
        >
          <div className="qxt-top">
            <span className="qxt-ic"><QxTouchIcon name="ticket" size={40} /></span>
            <QxTouchChip tone="clay">不是取件码</QxTouchChip>
          </div>
          <h3>{arrivalCode.title}</h3>
          <p>{emphasize(arrivalCode.description, arrivalCode.emphasis)}</p>
          {arrivalCode.stateNote ? <p>{arrivalCode.stateNote}</p> : null}
        </button>
      </div>

      {toolCaps.length > 0 ? (
        <div className="qxt-tools" aria-label="其他办理">
          {toolCaps.map((capability, index) => (
            <HubCapButton key={capability.key} capability={capability} index={index + 4} variant="tile" onCapability={onCapability} />
          ))}
        </div>
      ) : null}

      <div className="qxt-sec" id="ph-sec-records">
        已下过单 · 我的文件
        <small>{recordsGroupHint}</small>
      </div>
      <div className="qxt-tools">
        {quickLinks.filter((link) => link.compact).map((link) => (
          <button
            key={link.key}
            type="button"
            className="qxt-tile qxt-rise"
            data-testid={`print-hub-quick-${link.key}`}
            aria-label={`${link.title}：${link.description}`}
            onClick={() => onQuickLink(link.key)}
          >
            <span className="qxt-tx"><b>{link.title}</b><small>{link.description}</small></span>
          </button>
        ))}
      </div>
      <PrintHubRecordNotes links={quickLinks.filter((link) => !link.compact)} onOpen={onQuickLink} />

      <div className="ph-actions">
        <button type="button" onClick={onBack}>上一步</button>
        {hubState === 'capability-error' ? <button type="button" onClick={onRetry}>重新检测</button> : null}
        {showBanner ? <button type="button" onClick={onHelp}>使用帮助</button> : null}
        <PrintAiHelp label="问小青：怎么选打印方式 →" draft="我想打印一份文件，应该选手机上传、U 盘还是扫描？请帮我选一种方式。" />
      </div>
      {showBanner ? <p className="qxt-fine">{helpNeededLine()}</p> : null}
      <footer className="ph-foot">
        <div className="ph-truth" data-disclaimer="true" data-testid="print-hub-truth"><div>可用服务，以办理时显示为准。</div></div>
        {notices.length > 0 ? (
          <details className="ph-notices" data-disclaimer="true">
            <summary>
              <span>隐私与电子签说明</span>
              <span className="ph-notices-go">点开看全文</span>
            </summary>
            <p>{HUB_TRUTH.map((row) => `${row.k}：${row.v}`).join(' ')} {notices.join(' ')}</p>
          </details>
        ) : null}
      </footer>
    </div>
  )
}
