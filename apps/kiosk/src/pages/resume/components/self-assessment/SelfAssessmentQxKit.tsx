// 自我探索 · 倾向参考 —— 青序流光呈现原语（稿 34-self-assessment.html）。
//
// **这个文件里不许出现自我探索的业务文案。** 原因不是洁癖：
// `services/api/scripts/verify-compliance.ts` 的 `SELF_ASSESSMENT_FILES` 是一张
// 逐路径的扫描白名单（临床 / 量表 / 疾病 关键词），它点名的是
// `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx`，不是本文件。把用户可见的
// 中文搬到这里，等于把那条合规扫描绕过去 —— 而那条门禁在 services/ 下，本批不改。
// 所以分工是：**文案全部留在 SelfAssessmentFlow.tsx，本文件只收结构与样式**。
//
// 触控：这里出现的每个 <button> 都会被 fusion-w6 的 expectTouchTargets 量到，
// 换算回舞台 CSS px 后最小边必须 ≥48px。尺寸写在 self-assessment-qx.css，
// 不要在调用方用内联 style 压小。

import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxPageFrame } from '../../../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../../../components/qingxu/QxAppNavbar'
import { KioskStageFit } from '../../../../components/kiosk-shell/KioskStageFit'
import { getTerminalCode } from '../../../../services/api/terminalConfig'
import '../../self-assessment-qx.css'

export type SaScreen =
  | 'resume-self-assessment-intro'
  | 'resume-self-assessment-quiz'
  | 'resume-self-assessment-result'
  | 'resume-self-assessment-history'

export interface SaStatus {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
}

/**
 * 四条自我探索路由共用的壳。
 *
 * 它们是**顶级全屏路由**（`routes/index.tsx` 里与 `/login` 同级），不经过
 * KioskRoot，所以 1080×1920 舞台缩放要自己套 `KioskStageFit` —— 这一点与
 * `/login`、`/session-timeout` 同一处置。QxPageFrame 自己不缩放，套两层会叠乘。
 *
 * `<main>` 必须由本组件渲染：QxPageFrame 不给 landmark，而这四条路由在
 * `fusion-w6-route-cases.ts` 里走的是默认 `landmark: 'main'`，页面上必须恰好
 * 有一个可见 main、且不嵌套。
 */
export function SaFrame({
  screen,
  state,
  title,
  status,
  eyebrow,
  ask,
  doing,
  rail,
  gate,
  back,
  ctabar,
  children,
}: {
  screen: SaScreen
  /** 会同时落到 `data-state` 与 `data-testid`，是浏览器用例唯一的状态锚点。 */
  state: string
  title: ReactNode
  /** 拿不到真实状态就传 unknown；这一格不许默认「正常」。 */
  status: SaStatus
  eyebrow: string
  ask: ReactNode
  doing: ReactNode
  /** 底部一行不可关闭的边界声明。 */
  rail: readonly string[]
  /**
   * 「这一步能不能往下走、为什么」那一条。它**不进滚动区**：
   * 说明页的同意条款把一屏撑满之后，闸门条会被顶到折线以下 —— 1080×1920 实测过，
   * 用户看到的是一个灰按钮加一条看不见的解释。所以它和底部行动条一样固定在下方。
   */
  gate?: ReactNode
  back: { label: string; onBack: () => void }
  ctabar: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  const terminalLabel = getTerminalCode() || '设备未绑定'

  return (
    <KioskStageFit>
      <QxPageFrame
        title={title}
        status={status}
        terminalLabel={terminalLabel}
        back={back}
        ctabar={ctabar}
        navbar={
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        }
      >
        <main
          className="sa-qx"
          data-kiosk-domain="resume"
          data-kiosk-screen={screen}
          data-state={state}
          data-testid={`self-assessment-state-${state}`}
        >
          <section className="sa-xq">
            <div className="sa-xq-row">
              <div className="sa-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="sa-xq-eyebrow">{eyebrow}</div>
                <p className="sa-xq-ask">{ask}</p>
                <p className="sa-xq-doing">{doing}</p>
              </div>
            </div>
          </section>

          <div className="qx-scroll">{children}</div>

          {gate}

          <p className="sa-rail" data-testid="self-assessment-rail">
            {rail.map((item) => <span key={item}>{item}</span>)}
          </p>
        </main>
      </QxPageFrame>
    </KioskStageFit>
  )
}

/** 稿的 `.card`：标题行 + 右侧小字 + 内容。tone 只有 lead / down 两种强调。 */
export function SaCard({
  head,
  hint,
  tone,
  grow,
  testId,
  children,
}: {
  head: ReactNode
  hint?: ReactNode
  tone?: 'lead' | 'down'
  /**
   * 本页的余量吸收块。一屏只指定一张，且只指定主操作区或真实列表；
   * 余量大到会把它撑变形的屏就不要指定（判据与实测见 self-assessment-qx.css）。
   */
  grow?: boolean
  testId?: string
  children?: ReactNode
}) {
  return (
    <section className="qx-card sa-card" data-tone={tone} data-grow={grow ? 'true' : undefined} data-testid={testId}>
      <div className="sa-hd">
        <b>{head}</b>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** 稿的 `.task`：一行可核对的事实胶囊。warn 用于「这一项现在办不到」。 */
export function SaChips({ items }: { items: readonly { key: string; text: ReactNode; tone?: 'warn' }[] }) {
  return (
    <ul className="sa-chips">
      {items.map((item) => <li key={item.key} data-tone={item.tone}>{item.text}</li>)}
    </ul>
  )
}

/** 稿的 `.flow-grid`：三格并排，用来说明「会发生 / 不会发生」。 */
export function SaFlow({
  items,
}: {
  items: readonly { key: string; step: string; title: string; desc: string; current?: boolean }[]
}) {
  return (
    <div className="sa-flow">
      {items.map((item) => (
        <div key={item.key} data-current={item.current ? 'true' : undefined}>
          <small>{item.step}</small>
          <b>{item.title}</b>
          <p>{item.desc}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * 稿的 `.gate`：这一步现在能不能往下走，以及为什么。
 *
 * 它和主按钮的置灰是同一件事的两种表达，必须同时出现 —— 只置灰不给原因，
 * 用户读不到「为什么点不动」；只写原因不置灰，按钮会骗人。
 */
export function SaGate({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }) {
  return (
    <div className="sa-gate" data-tone={tone} data-testid="self-assessment-gate" role={tone === 'warn' ? 'status' : undefined}>
      <i aria-hidden="true">{tone === 'warn' ? '!' : '✓'}</i>
      <div>{children}</div>
    </div>
  )
}

/** 稿的 `.picks`：现在就能打开的出口。没有 onClick 的一律不渲染成按钮。 */
export function SaPicks({
  cols = 2,
  items,
}: {
  cols?: 2 | 3
  items: readonly { key: string; icon: string; title: string; desc: string; lead?: boolean; onClick: () => void; route: string }[]
}) {
  return (
    <div className="sa-picks" data-cols={String(cols)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="sa-pick"
          data-lead={item.lead ? 'true' : undefined}
          data-route={item.route}
          data-testid={`self-assessment-pick-${item.key}`}
          onClick={item.onClick}
        >
          <i aria-hidden="true">{item.icon}</i>
          <span>
            <b>{item.title}</b>
            <p>{item.desc}</p>
          </span>
        </button>
      ))}
    </div>
  )
}

/** 稿的 `.notice`：一条贴边说明，不抢主操作。 */
export function SaNotice({ children }: { children: ReactNode }) {
  return (
    <section className="sa-notice">
      <i aria-hidden="true">i</i>
      <div>{children}</div>
    </section>
  )
}

/** 稿 `.dimgrid` 的一行：左侧维度名 + 该维度的若干格。格子内容由两个 grid 组件各自渲染。 */
export interface SaGridRow<Cell> {
  key: string
  label: string
  counter: string
  current?: boolean
  full?: boolean
  cells: readonly Cell[]
}

export interface SaMapCell {
  key: string
  /** current=当前题；done=已答可改；locked=答完前面才开放；open=可作答 */
  kind: 'current' | 'done' | 'locked' | 'open'
  number: number
  ariaLabel: string
  onSelect: () => void
}

function SaGridRowLabel({ row }: { row: SaGridRow<unknown> }) {
  return (
    <div className="sa-map-label" data-current={row.current ? 'true' : undefined} data-full={row.full ? 'true' : undefined}>
      <b>{row.label}</b>
      <em>{row.counter}</em>
    </div>
  )
}

/**
 * 稿 `.dimgrid` + `.qcell`：题号地图。一行一个维度，既看进度也能回改。
 *
 * `locked` 只走 `aria-disabled`，不用原生 `disabled` —— 原生 disabled 会把格子
 * 踢出 Tab 序列，读屏用户读不到「答完前面的题才能进入」这句 aria-label。
 */
export function SaMapGrid({ testId, rows }: { testId: string; rows: readonly SaGridRow<SaMapCell>[] }) {
  return (
    <div className="sa-map" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: 'contents' }}>
          <SaGridRowLabel row={row} />
          {row.cells.map((cell) => (
            <button
              key={cell.key}
              type="button"
              className="sa-cell"
              data-cell={cell.kind}
              data-testid="self-assessment-map-cell"
              aria-current={cell.kind === 'current' ? 'true' : undefined}
              aria-disabled={cell.kind === 'locked' || undefined}
              aria-label={cell.ariaLabel}
              onClick={() => { if (cell.kind !== 'locked') cell.onSelect() }}
            >
              {cell.number}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export interface SaReviewCell {
  key: string
  step: string
  value: string
  ariaLabel: string
  onSelect: () => void
}

/** 稿 `.rv`：提交前逐题回看，点任意一项回到那一题。布局与题号地图同一套栅格。 */
export function SaReviewGrid({ testId, rows }: { testId: string; rows: readonly SaGridRow<SaReviewCell>[] }) {
  return (
    <div className="sa-map" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: 'contents' }}>
          <SaGridRowLabel row={row} />
          {row.cells.map((cell) => (
            <button
              key={cell.key}
              type="button"
              className="sa-rv"
              data-testid="self-assessment-review-item"
              aria-label={cell.ariaLabel}
              onClick={cell.onSelect}
            >
              <small>{cell.step}</small>
              <b>{cell.value}</b>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * 页内二次确认遮罩（SES-06）。
 *
 * 公共一体机不许用 `window.confirm` —— 全屏 kiosk 下它的样式与触控都不受控。
 * 这里只提供容器与两个动作位，标题 / 正文 / 按钮文案全部由调用方传入
 * （本文件不放业务文案，理由见文件头）。
 */
export function SaConfirmOverlay({
  title,
  description,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="sa-overlay">
      <div className="sa-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid="self-assessment-confirm">
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="sa-dialog-actions">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="qx-btn" data-variant="danger" data-testid="self-assessment-confirm-ok" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

/** 稿的 `.mini`：键值对。值缺失时由调用方传出「服务端未返回」的原话，不留空。 */
export function SaMeta({ items }: { items: readonly { key: string; label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="sa-meta">
      {items.map((item) => (
        <div key={item.key}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'sa-mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
