// ============================================================
// V6PrintHubView — P39 打印域首屏的表现层。
//
// 结构逐块对照 docs/design/kiosk-ai-os-v3-2026-08/39-print-hub.html：
//   .tband        → .v6-ph-band          顶部 AI 带 / 离线带 / 探测失败带
//   .glabel       → .v6-ph-glabel        分组标题（右侧副文案随两条轴换话）
//   .qrow--one    → .v6-ph-arrival       到机码核销（PR #644 补入，单卡整行）
//   .hgrid        → .v6-ph-grid          七张能力卡 + 第 8 格本机服务配置
//   .qrow         → .v6-ph-records       我的打印记录三张次卡
//   .foot         → .v6-ph-foot          一条常驻合规声明
//   #ovl-ai       → .v6-ph-overlay       AI 怎么帮 / 降级后怎么做
//
// 置灰口径（今日已落地的全局规则，不得回退）：
// 能力门禁型停用一律 aria-disabled + 常显原因 + onClick 内短路，
// **不用原生 disabled、不用 title** —— 触屏没有 hover，原生 disabled 还会
// 把按钮踢出 Tab 序，用户永远读不到为什么灰。瞬时态（正在检测）才用原生 disabled。
// ============================================================

import { useId, useState } from 'react'
import {
  ArrowRightIcon,
  BrainIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  PRINT_HUB_AI_EXPLAINER,
  PRINT_HUB_AI_PICKS,
  PRINT_HUB_DEVICE_OFF_BAND,
  PRINT_HUB_PROBE_UNKNOWN_BAND,
  PRINT_HUB_PROBE_UNKNOWN_TECH_NOTE,
  type MfpStatus,
  type PrintHubCap,
  type ProbeStatus,
} from '../printHubContent'

export interface V6PrintCapabilityView {
  key: string
  cap: PrintHubCap
  icon: LucideIcon
  title: string
  description: string
  aiRole: 'ai' | 'none'
  available: boolean
  actionable: boolean
  /** 可用时的「一行状态」，原型 .hc-st。 */
  stateNote?: string
  /** 不可用时的原因行，原型 .hc-no。常显，不进 tooltip。 */
  unavailableBadge?: string
  /** 不可用时「那怎么办」，原型 .hc-st 的停用变体。 */
  note?: string
}

export interface V6PrintQuickLinkView {
  key: string
  icon: LucideIcon
  title: string
  description: string
}

export interface V6PrintArrivalCodeView {
  key: string
  icon: LucideIcon
  title: string
  description: string
  hint: string
  stateNote?: string
}

interface V6PrintHubViewProps {
  probe: ProbeStatus
  mfp: MfpStatus
  mfpLabel: string
  signedIn: boolean
  capabilities: readonly V6PrintCapabilityView[]
  arrivalCode: V6PrintArrivalCodeView
  quickLinks: readonly V6PrintQuickLinkView[]
  capabilityGroupHint: string
  recordsGroupHint: string
  notices: readonly string[]
  onAdvisor: () => void
  onRetry: () => void
  onCapability: (key: string) => void
  onArrivalCode: () => void
  onQuickLink: (key: string) => void
}

/**
 * 原型标签口径（39-print-hub.html CSS 头注释「★ 标签口径」）：
 * AI 卡恒标「AI · 仅供参考」，**标签不许消失** —— 否则停用后根本看不出
 * 它原本是一项 AI 能力。停用理由走 .v6-ph-card__badge 另起一行，不占这个位置。
 */
function capabilityTag(capability: V6PrintCapabilityView): string {
  return capability.aiRole === 'ai' ? 'AI · 仅供参考' : '不依赖 AI'
}

export function V6PrintHubView({
  probe,
  mfp,
  mfpLabel,
  signedIn,
  capabilities,
  arrivalCode,
  quickLinks,
  capabilityGroupHint,
  recordsGroupHint,
  notices,
  onAdvisor,
  onRetry,
  onCapability,
  onArrivalCode,
  onQuickLink,
}: V6PrintHubViewProps) {
  const [pickId, setPickId] = useState<(typeof PRINT_HUB_AI_PICKS)[number]['id']>('route')
  const [explainerOpen, setExplainerOpen] = useState(false)
  const reasonId = useId()
  const explainerTitleId = useId()

  const pick = PRINT_HUB_AI_PICKS.find((item) => item.id === pickId) ?? PRINT_HUB_AI_PICKS[0]
  const probeUnknown = probe === 'error'
  const probeChecking = probe === 'loading'
  const deviceOff = mfp === 'unavailable'
  const ArrivalIcon = arrivalCode.icon

  return (
    <div data-v6-page="print-hub" data-w2-page="print-scan-home" className="v6-print-hub">
      {/* ══ 顶部带 · 探测失败：和「一体机离线」是两件事，优先级最高 ══ */}
      {probeUnknown || probeChecking ? (
        <section className="v6-ph-band v6-ph-band--off" aria-live="polite">
          <div className="v6-ph-band__head">
            <TriangleAlertIcon aria-hidden="true" />
            <h2>{probeChecking ? '正在确认本机服务配置' : PRINT_HUB_PROBE_UNKNOWN_BAND.title}</h2>
            <span className="v6-ph-chip">
              {probeChecking ? '检查中' : PRINT_HUB_PROBE_UNKNOWN_BAND.chip}
            </span>
          </div>
          {probeChecking ? (
            <p className="v6-ph-band__act">
              还没读到本机能力配置，先不开放任务 —— 未确认能力不会创建正式打印或扫描任务。
            </p>
          ) : (
            <>
              <p className="v6-ph-band__act">{PRINT_HUB_PROBE_UNKNOWN_BAND.act}</p>
              {PRINT_HUB_PROBE_UNKNOWN_BAND.lines.map((line) => (
                <p key={line.k} className="v6-ph-band__line">
                  <i>{line.k}</i>
                  {line.v}
                </p>
              ))}
              <details className="v6-ph-fold">
                <summary>技术档案（运维用）</summary>
                <p>{PRINT_HUB_PROBE_UNKNOWN_TECH_NOTE}</p>
              </details>
            </>
          )}
          <div className="v6-ph-band__act-row">
            {/* 瞬时态（正在检测）→ 原生 disabled 即可，不是能力门禁。 */}
            <button
              type="button"
              className="v6-ph-rebtn"
              onClick={onRetry}
              disabled={probeChecking}
            >
              <RefreshCwIcon aria-hidden="true" />
              {probeChecking ? '检测中' : '重新检测'}
            </button>
          </div>
        </section>
      ) : deviceOff ? (
        /* ══ 顶部带 · 一体机离线：停要出纸的，留纯软件的 ══ */
        <section className="v6-ph-band v6-ph-band--off" aria-live="polite">
          <div className="v6-ph-band__head">
            <TriangleAlertIcon aria-hidden="true" />
            <h2>{PRINT_HUB_DEVICE_OFF_BAND.title}</h2>
            <span className="v6-ph-chip">{PRINT_HUB_DEVICE_OFF_BAND.chip}</span>
          </div>
          <p className="v6-ph-band__act">
            {PRINT_HUB_DEVICE_OFF_BAND.act}
            <b>（本机读到的状态：{mfpLabel}）</b>
          </p>
          {PRINT_HUB_DEVICE_OFF_BAND.lines.map((line) => (
            <p key={line.k} className="v6-ph-band__line">
              <i>{line.k}</i>
              {line.v}
            </p>
          ))}
        </section>
      ) : (
        /* ══ 顶部带 · AI 三件事 ══ */
        <section className="v6-ph-band" aria-labelledby="v6-ph-band-title">
          <div className="v6-ph-band__head">
            <BrainIcon aria-hidden="true" />
            <h2 id="v6-ph-band-title">这一屏的 AI 只做三件事，点一件我给你下一步</h2>
            {/* 选哪件是页内确定性映射，背后没有模型，所以不标 AI 证据级别。 */}
            <span className="v6-ph-chip">选哪件不依赖 AI</span>
          </div>

          <div className="v6-ph-picks" role="group" aria-label="AI 能帮你做的三件事">
            {PRINT_HUB_AI_PICKS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === pickId}
                onClick={() => setPickId(item.id)}
              >
                <b>{item.title}</b>
                <span>{item.subtitle}</span>
              </button>
            ))}
          </div>

          {/* 建议四要素：动作 / 理由 / 代价 / 备选，缺一不发。 */}
          <div className="v6-ph-advice">
            <p className="v6-ph-band__act">{pick.act}</p>
            <p className="v6-ph-band__line">
              <i>理由</i>
              {pick.why}
            </p>
            <p className="v6-ph-band__line">
              <i>代价</i>
              {pick.cost}
            </p>
            <p className="v6-ph-band__line">
              <i>备选</i>
              {pick.alt}
            </p>
          </div>

          <div className="v6-ph-band__act-row">
            <button type="button" className="v6-ph-rebtn" onClick={onAdvisor}>
              说不清就问小青
              <ArrowRightIcon aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {/* ══ 到机码核销：手机上已经下过单的人（原型 PR #644 补入） ══
          位置在七张卡之前 —— 手里有码的人不该先滚过七张用不上的卡。 */}
      <div className="v6-ph-glabel">
        <b>在手机上已经下好单了？</b>
        <span>{arrivalCode.hint}</span>
      </div>
      <button type="button" className="v6-ph-arrival" onClick={onArrivalCode}>
        <span className="v6-ph-arrival__icon" aria-hidden="true">
          <ArrivalIcon />
        </span>
        <span className="v6-ph-arrival__body">
          <span className="v6-ph-arrival__head">
            <b>{arrivalCode.title}</b>
            <span className="v6-ph-chip">不依赖 AI</span>
          </span>
          <span className="v6-ph-arrival__desc">{arrivalCode.description}</span>
          {arrivalCode.stateNote ? (
            <span className="v6-ph-arrival__note">{arrivalCode.stateNote}</span>
          ) : null}
        </span>
        <span className="v6-ph-arrival__go">
          进入
          <ArrowRightIcon aria-hidden="true" />
        </span>
      </button>

      {/* ══ 七件事 ══ */}
      <div className="v6-ph-glabel">
        <b>这个台面能做的七件事</b>
        <span>{capabilityGroupHint}</span>
        <button type="button" className="v6-ph-gbtn" onClick={() => setExplainerOpen(true)}>
          <BrainIcon aria-hidden="true" />
          AI 怎么帮 · 降级后怎么做
        </button>
      </div>

      <section className="v6-ph-grid" aria-label="打印扫描能力">
        {capabilities.map((capability) => {
          const Icon = capability.icon
          const blocked = !capability.actionable
          const noteId = `${reasonId}-${capability.key}`
          return (
            <button
              key={capability.key}
              type="button"
              className={`v6-ph-card${capability.available ? '' : ' is-unavailable'}`}
              data-cap={capability.cap}
              // 能力门禁型停用：aria-disabled + 常显原因 + onClick 短路。
              aria-disabled={blocked || undefined}
              aria-describedby={capability.note ? noteId : undefined}
              onClick={blocked ? undefined : () => onCapability(capability.key)}
            >
              <span className="v6-ph-card__top">
                <span className="v6-ph-card__icon" aria-hidden="true">
                  <Icon />
                </span>
                <b>{capability.title}</b>
                <span
                  className={`v6-ph-chip${capability.aiRole === 'ai' ? ' v6-ph-chip--ai' : ''}`}
                >
                  {capabilityTag(capability)}
                </span>
              </span>
              <span className="v6-ph-card__desc">{capability.description}</span>
              {/* 停用原因常驻可见 —— 不是 tooltip、不是 title。 */}
              {capability.unavailableBadge ? (
                <span className="v6-ph-card__badge">{capability.unavailableBadge}</span>
              ) : null}
              {capability.note ?? capability.stateNote ? (
                <span
                  className={`v6-ph-card__note${capability.note ? '' : ' is-ok'}`}
                  id={noteId}
                >
                  {capability.note ?? capability.stateNote}
                </span>
              ) : null}
              <span className="v6-ph-card__go">
                {blocked ? '暂不可用' : capability.available ? '进入' : '了解详情'}
                {blocked ? null : <ArrowRightIcon aria-hidden="true" />}
              </span>
            </button>
          )
        })}

        {/* 第 8 格：本机服务配置。状态卡，不是入口，所以是 article 不是 button。 */}
        <article className="v6-ph-card v6-ph-card--status">
          <span className="v6-ph-card__top">
            <span className="v6-ph-card__icon" aria-hidden="true">
              <SettingsIcon />
            </span>
            <b>本机服务配置</b>
            <span className="v6-ph-chip">不依赖 AI</span>
          </span>
          <span className="v6-ph-card__desc">
            {probeUnknown
              ? '本机现在读不到设备与耗材状态 · 不会创建正式任务 · 用上面的「重新检测」再试一次'
              : deviceOff
                ? `打印扫描一体机现在出不了纸（${mfpLabel}） · 上传、转换、签章不受影响`
                : mfp === 'unknown'
                  ? '读不到这台打印机的状态 · 参数与出纸能力在提交任务前再确认一次'
                  : '纸张、耗材、双面与输稿器在提交任务前确认'}
          </span>
          <details className="v6-ph-fold">
            <summary>设备与耗材明细（运维信息）</summary>
            <div className="v6-ph-statgrid">
              <span>
                <i>打印机</i>
                {probeUnknown ? '读不到' : mfpLabel}
              </span>
              <span>
                <i>扫描</i>
                {probeUnknown ? '读不到' : deviceOff ? '离线' : '后台配置'}
              </span>
              <span>
                <i>纸张</i>
                {probeUnknown || deviceOff ? '—' : 'A4'}
              </span>
              {/* Agent 当前不上报耗材，禁止用假数值触发「墨粉不足」。 */}
              <span>
                <i>耗材</i>
                本机不上报
              </span>
              <span>
                <i>上传</i>
                {probeUnknown ? '暂不开放' : '可用'}
              </span>
              <span>
                <i>转换签章</i>
                {probeUnknown ? '暂不开放' : '可用'}
              </span>
            </div>
            <p>
              {probeUnknown
                ? '未取得本机打印扫描能力配置 —— 打印机、扫描、纸张、耗材、双面与输稿器本机现在都读不到，所以一项也不敢说正常。未确认能力不会创建正式任务；费用一律预估。'
                : deviceOff
                  ? '出不了纸的是这一台打印扫描一体机，纸张与耗材跟着读不到；上传、格式转换、签名盖章在服务端做，不受这台机器影响。'
                  : '纸张、耗材、双面与输稿器状态在提交任务前确认。未确认能力不会创建正式打印或扫描任务；费用一律预估。'}
            </p>
          </details>
        </article>
      </section>

      {/* ══ 我的打印记录：不依赖本机设备，两条轴下都照常 ══ */}
      <div className="v6-ph-glabel">
        <b>我的打印记录</b>
        <span>{recordsGroupHint}</span>
      </div>
      <section className="v6-ph-records" aria-label="我的打印记录">
        {quickLinks.map((link) => {
          const Icon = link.icon
          return (
            <button key={link.key} type="button" onClick={() => onQuickLink(link.key)}>
              <span className="v6-ph-records__icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="v6-ph-records__body">
                <span className="v6-ph-records__head">
                  <b>{link.title}</b>
                  <span className="v6-ph-chip">不依赖 AI</span>
                </span>
                <small>{link.description}</small>
              </span>
            </button>
          )
        })}
      </section>

      {/* ══ 一条常驻合规声明：隐私 + 非 CA 电子签 + 价格口径，任何状态都不消失 ══ */}
      <footer className="v6-ph-foot">
        <ShieldCheckIcon aria-hidden="true" />
        <p>{notices.join('')}</p>
      </footer>

      {/* ══ 展开层：AI 在这七件事里各干什么 ══ */}
      {explainerOpen ? (
        <div
          className="v6-ph-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={explainerTitleId}
        >
          <button
            type="button"
            className="v6-ph-overlay__scrim"
            aria-label="关闭"
            onClick={() => setExplainerOpen(false)}
          />
          <div className="v6-ph-overlay__panel">
            <div className="v6-ph-overlay__head">
              <BrainIcon aria-hidden="true" />
              <b id={explainerTitleId}>AI 在这七件事里各干什么</b>
              <button
                type="button"
                className="v6-ph-overlay__x"
                aria-label="关闭"
                onClick={() => setExplainerOpen(false)}
              >
                <XIcon aria-hidden="true" />
              </button>
            </div>
            <p className="v6-ph-overlay__sec">
              每项写三句：正常时 AI 干什么、AI 挂了怎么办、这台一体机出不了纸时怎么办
            </p>
            <div className="v6-ph-overlay__rows">
              {PRINT_HUB_AI_EXPLAINER.map((row) => (
                <div key={row.cap} className="v6-ph-airow">
                  <span className="v6-ph-airow__name">
                    {row.name}
                    <span className={`v6-ph-chip${row.isAi ? ' v6-ph-chip--ai' : ''}`}>
                      {row.isAi ? 'AI · 仅供参考' : '不依赖 AI'}
                    </span>
                  </span>
                  <span className="v6-ph-airow__line">
                    <i>AI 怎么帮</i>
                    {row.help}
                  </span>
                  <span className="v6-ph-airow__line">
                    <i>AI 挂了</i>
                    {row.aiDown}
                  </span>
                  <span className="v6-ph-airow__line">
                    <i>一体机出不了纸</i>
                    {row.deviceOff}
                  </span>
                </div>
              ))}
            </div>
            <div className="v6-ph-overlay__act">
              <button type="button" className="v6-ph-rebtn" onClick={() => setExplainerOpen(false)}>
                知道了
              </button>
              <span>
                「AI · 仅供参考」标签在任何状态下都不会消失，你始终看得出哪几项本来是 AI 能力。
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 未登录时的一句提示，位置固定，不抢主流程。 */}
      {!signedIn ? (
        <p className="v6-ph-guest">
          不登录也能打，但这一趟的记录留不下 —— 要留记录，在保存那一步再登录。
        </p>
      ) : null}
    </div>
  )
}
