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
import { helpNeededLine, machineCannotPrintLine, preferUnattended } from '../../../copy/unattendedCopy'
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
    case 'device-off': {
      const raw = orderPaused?.notice ?? printerUnavailable?.notice ?? ''
      const shown = preferUnattended(raw, machineCannotPrintLine())
      return (
        <PrintHubState
          kind="warn"
          icon={<InfoIcon size={28} />}
          heading={orderPaused ? orderPaused.label : `${printerUnavailable?.label ?? '打印机暂不可用'} · 出纸类暂停`}
          testId="print-hub-fallback"
        >
          <p className="ph-state-p">
            {shown}
            {usableServices ? `${usableServices}仍可使用。` : ''}
          </p>
        </PrintHubState>
      )
    }
    default:
      return null
  }
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

const HUB_DISPLAY_TITLE: Record<string, string> = {
  'doc-print': '打印文件',
  scan: '扫描纸质材料',
  'photo-print': '照片打印',
  'phone-upload': '手机扫码上传',
  'usb-import': 'U 盘导入',
  convert: '照片合成 PDF',
  sign: '签名',
  'id-photo': '证件照',
}

const HUB_OPEN_DESC: Record<string, string> = {
  'doc-print': '手机、U 盘或我的文档',
  scan: '扫成 PDF，可以存、可以打',
  'photo-print': '按照片出纸',
  convert: '几张照片拼成一个文件',
  'id-photo': '本机尚未开放 · 看说明',
  'phone-upload': '先传上来，稍后打印',
  'usb-import': '先导入，稍后打印',
}

const HUB_TAKE: Record<string, string> = {
  'doc-print': '打印件',
  scan: '扫描件',
}

function displayTitle(capability: QxPrintCapabilityView): string {
  return HUB_DISPLAY_TITLE[capability.key] ?? capability.title
}

function displayDesc(capability: QxPrintCapabilityView): string {
  if (!capability.actionable) {
    if (capability.unavailableBadge === '检查中') return '正在确认'
    return capability.note || capability.unavailableBadge || capability.description
  }
  return HUB_OPEN_DESC[capability.key] ?? capability.description
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
  const badge = capability.unavailableBadge === '检查中' ? '正在确认' : (capability.unavailableBadge ?? '暂不可用')
  const reason = capability.note ? `${badge}：${capability.note}` : badge
  const icon = HUB_CAP_ICON[capability.key] ?? 'file'
  const title = displayTitle(capability)
  const desc = displayDesc(capability)
  const take = HUB_TAKE[capability.key]
  return (
    <button
      type="button"
      className={variant === 'task'
        ? `qxt-task qxt-rise${closed ? ' qxt-hold' : ''}`
        : `qxt-tile qxt-rise qxt-tile-stack${closed ? ' qxt-off qxt-hold' : ''}`}
      style={stagger(index)}
      data-testid={`print-hub-cap-${capability.key}`}
      aria-disabled={closed || undefined}
      aria-label={closed ? `${title}（${reason}）` : title}
      onClick={closed ? undefined : () => onCapability(capability.key)}
    >
      {variant === 'task' ? (
        <>
          <div className="qxt-top">
            <span className="qxt-ic"><QxTouchIcon name={icon} size={40} /></span>
            {closed ? <QxTouchChip tone="slate">{badge}</QxTouchChip> : null}
          </div>
          <h3>{title}</h3>
          <p>{desc}</p>
          {!closed && take ? (
            <div className="qxt-take">
              <QxTouchIcon name="check" size={24} strokeWidth={2.6} />
              <span>带走：{take}</span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <span className="qxt-ic"><QxTouchIcon name={icon} size={34} /></span>
          <span className="qxt-tx"><b>{title}</b><small>{desc}</small></span>
          {closed ? null : <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>}
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
  const showBanner = hubState === 'capability-error' || hubState === 'locked' || hubState === 'device-off'
  const usableServices = capabilities.filter((item) => item.actionable && ['phone-upload', 'usb-import', 'convert', 'sign'].includes(item.key)).map((item) => item.title).join('、')
  const checking = probe === 'loading'
  const byKey = (key: string) => capabilities.find((item) => item.key === key)
  const doc = byKey('doc-print')
  const scan = byKey('scan')
  const photo = byKey('photo-print')
  const convert = byKey('convert')
  const sign = byKey('sign')
  const idPhoto = byKey('id-photo')
  const phone = byKey('phone-upload')
  const usb = byKey('usb-import')
  const toolCaps = [photo, convert, idPhoto, sign].filter((item): item is QxPrintCapabilityView => Boolean(item))
  const transferCaps = [phone, usb].filter((item): item is QxPrintCapabilityView => Boolean(item))
  const showLater = transferCaps.some((item) => item.actionable) && (!doc?.actionable || mfp === 'unavailable' || hubState === 'device-off')
  const paperOff = Boolean(printerUnavailable?.label.includes('缺纸'))
  const copyDesc = orderPaused
    ? '暂停接单时，复印以打印机屏幕为准'
    : hubState === 'device-off'
      ? (paperOff ? '缺纸时复印也出不了纸，补纸后再用' : '打印机离线时复印可能也用不了，以打印机屏幕为准')
      : '在打印机屏幕上点「复印」「身份证复印」或「票据复印」；不经过这台一体机下单，也不进打印订单'
  const arrivalDesc = arrivalCode.stateNote
    ?? '凭码办理，不登录也能核销 · 8 位数字（历史 10 位码也支持）'
  const recordLinks = quickLinks.filter((link) => !link.compact && link.key !== 'feedback')
  const feedback = quickLinks.find((link) => link.key === 'feedback')

  return (
    <div
      className="qxt-print-hub"
      data-w2-page="print-scan-home"
      data-qx-page="print-hub"
      data-takeaway="打印件或 PDF"
      data-state={hubState}
      data-testid={`print-hub-state-${hubState}`}
      data-probe={probe}
      data-mfp={mfp}
    >
      <div className="qxt-grid2 ph-grid" aria-busy={checking || undefined}>
        {doc ? <HubCapButton capability={doc} index={0} variant="task" onCapability={onCapability} /> : null}
        {scan ? <HubCapButton capability={scan} index={1} variant="task" onCapability={onCapability} /> : null}
        <button
          type="button"
          className={`qxt-task qxt-rise${hubState === 'device-off' ? ' qxt-hold qxt-press' : ''}`}
          style={stagger(2)}
          data-testid="print-hub-copy-note"
          onClick={() => onQuickLink(COPY_GUIDE_KEY)}
        >
          <div className="qxt-top">
            <span className="qxt-ic"><QxTouchIcon name="copy" size={40} /></span>
          </div>
          <h3>复印</h3>
          <p>{copyDesc}</p>
          <div className="qxt-take">
            <QxTouchIcon name="check" size={24} strokeWidth={2.6} />
            <span>带走：复印件</span>
          </div>
        </button>
        <button
          type="button"
          className="qxt-task qxt-rise"
          style={stagger(3)}
          data-testid="print-hub-primary"
          data-arrival="true"
          onClick={onArrivalCode}
        >
          <div className="qxt-top">
            <span className="qxt-ic"><QxTouchIcon name="ticket" size={40} /></span>
            <QxTouchChip tone="slate">不是取件码</QxTouchChip>
          </div>
          <h3>{arrivalCode.title}</h3>
          <p>{emphasize(arrivalDesc, arrivalCode.emphasis)}</p>
          <div className="qxt-take">
            <QxTouchIcon name="check" size={24} strokeWidth={2.6} />
            <span>带走：订单里的打印件</span>
          </div>
          <div className="qxt-mini" aria-hidden="true"><span className="ph-codeart">{'········'.split('').map((mark, index) => <i key={mark + index} />)}</span></div>
        </button>
      </div>

      {hubState === 'device-off' ? null : (
        <p className="qxt-fine qxt-fine-tight">按 A4 出纸 · {colorDuplexLabel}</p>
      )}

      {toolCaps.length > 0 || recordLinks.length > 0 ? (
        <>
          <div className="qxt-sec">其他工具<small>{recordsGroupHint || capabilityGroupHint}</small></div>
          <div className="qxt-tools" aria-label="其他工具">
            {toolCaps.map((capability, index) => (
              <HubCapButton key={capability.key} capability={capability} index={index + 4} variant="tile" onCapability={onCapability} />
            ))}
            {recordLinks.map((link, index) => (
              <button
                key={link.key}
                type="button"
                className="qxt-tile qxt-rise qxt-tile-stack ph-note"
                style={stagger(index + 8)}
                data-testid={`print-hub-quick-${link.key}`}
                onClick={() => onQuickLink(link.key)}
              >
                <span className="qxt-ic"><QxTouchIcon name={link.key === 'print-orders' ? 'receipt' : 'folder'} size={34} /></span>
                <span className="qxt-tx"><b>{link.title}</b><small>登录后查看</small></span>
                <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {showLater ? (
        <div className="ph-pass">
          <b>先传、稍后打印</b>
          {transferCaps.map((capability) => (
            <HubCapButton key={capability.key} capability={capability} index={10} variant="tile" onCapability={onCapability} />
          ))}
        </div>
      ) : null}

      {showBanner ? (
        <section className="ph-fallback" key={hubState}>
          <HubBanner hubState={hubState} orderPaused={orderPaused} printerUnavailable={printerUnavailable} usableServices={usableServices} />
          <div className="ph-actions">
            {hubState === 'capability-error' ? <button type="button" onClick={onRetry}>重新检测</button> : null}
            <button type="button" onClick={onHelp}>使用帮助</button>
            <button type="button" onClick={onBack}>上一步</button>
          </div>
          <p className="qxt-fine">{helpNeededLine()}</p>
        </section>
      ) : null}

      <footer className="ph-foot">
        <div className="ph-truth" data-disclaimer="true" data-testid="print-hub-truth"><div>可用服务，以办理时显示为准。</div></div>
        <div className="ph-legal-row">
          {notices.length > 0 ? (
            <details className="ph-notices" data-disclaimer="true">
              <summary>
                <span>隐私与电子签说明</span>
                <span className="ph-notices-go">点开看全文</span>
              </summary>
              <p>{HUB_TRUTH.map((row) => `${row.k}：${row.v}`).join(' ')} {notices.join(' ')}</p>
            </details>
          ) : (
            <p className="qxt-fine">{HUB_TRUTH.map((row) => row.v).join('')}</p>
          )}
          {feedback ? (
            <button
              type="button"
              className="qxt-tile qxt-rise"
              data-testid="print-hub-quick-feedback"
              onClick={() => onQuickLink(feedback.key)}
            >
              <span className="qxt-tx"><b>{feedback.title}</b><small>不用登录也能写</small></span>
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
