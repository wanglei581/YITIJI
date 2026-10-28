import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRightIcon, type LucideIcon } from 'lucide-react'
import { AiDownNote } from '../print-scan/AiDownNote'
import { askDraftOf } from '../print-scan/askDraft'
import { UsbArt } from '../print-scan/ToolArt'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { useAuth } from '../../auth/useAuth'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import { revokeLiveScanSession } from './scanSessionRevoke'
import { clearScanWorkbenchSession } from './scanWorkbenchSession'
import {
  SCAN_CHAIN,
  SCAN_TRUTH,
  SCAN_TYPE_OPTIONS,
  type ScanType,
  type ScanWorkbenchState,
} from './scanWorkbench'
import '../print-scan/styles/tool-touch.css'
import { ScanPaperArt } from './ScanPaperArt'
import './styles/scan-workbench-qx.css'
import './styles/scan-workbench-compact-qx.css'
import './styles/scan-fs.css'

const SCAN_RAIL = ['选类型', '扫描指引', '等回传', '扫描完成'] as const

const SCAN_RAIL_NOW: Record<ScanWorkbenchShellProps['page'], number> = {
  'scan-start': 0,
  'scan-settings': 1,
  'scan-progress': 2,
  'scan-result': 3,
}

const SCAN_EYEBROW: Record<ScanWorkbenchShellProps['page'], string> = {
  'scan-start': '材料扫描',
  'scan-settings': '扫描指引',
  'scan-progress': '等回传',
  'scan-result': '扫描完成',
}

/** 底栏「问小青」的本屏问句，逐态照稿 18（label 与带去顾问页的 draft 是同一句）。 */
function scanAskLabel(page: ScanWorkbenchShellProps['page'], state: ScanWorkbenchState): string {
  if (state === 'usb-panel') return '问小青：U 盘扫描怎么走'
  if (state === 'loading' || state === 'blocked' || state === 'unknown') return '问小青：扫描没开放怎么办'
  if (state === 'create-loading') return '问小青：任务还没建好'
  if (state === 'create-failed' || state === 'invalid' || state === 'cleanup-holding') return '问小青：扫描任务没建好'
  if (state === 'expired') return '问小青：扫描过期了怎么办'
  if (state === 'awaiting-ack') return page === 'scan-progress' ? '问小青：授权还没好' : '问小青：为什么还不能扫'
  if (state === 'failed' || state === 'completed-no-file' || state === 'wait-timeout') return '问小青：扫描失败怎么办'
  if (page === 'scan-settings') return '问小青：面板上怎么扫'
  if (page === 'scan-progress') return '问小青：一直等不到怎么办'
  if (page === 'scan-result') return '问小青：扫描件接下来呢'
  return '问小青：扫描和复印有什么不同'
}

function bandTone(tone: 'ok' | 'warn' | 'bad' | 'unknown'): 'ok' | 'warn' | 'unknown' {
  if (tone === 'ok') return 'ok'
  if (tone === 'warn' || tone === 'bad') return 'warn'
  return 'unknown'
}

/** 底栏左边的次按钮。不传时是「返回」，走 leaveScanFlow('/print-scan')。 */
export type ScanDockLeft = {
  label: string
  /** 二选一：leaveTo 走 leaveScanFlow（撤服务端任务、清本机登记再走人），onClick 是页内动作。 */
  leaveTo?: string
  onClick?: () => void
  icon?: 'back' | 'refresh'
  disabled?: boolean
}

/**
 * 底栏三槽：左边次按钮、中间问小青、右边主按钮，照稿 18 和共享底栏一个样子。
 * 主按钮不传就不画（等回传那一屏的「取消扫描」「立即检查」放在正文里，稿就是这么排的）。
 */
export type ScanDock = {
  left?: ScanDockLeft
  primary?: QxTouchPrimary
}

type ScanWorkbenchShellProps = {
  page: 'scan-start' | 'scan-settings' | 'scan-progress' | 'scan-result'
  state: ScanWorkbenchState
  title: string
  subtitle: ReactNode
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  dock?: ScanDock
  facts?: readonly string[]
  layout?: 'stack' | 'spread'
  children: ReactNode
}

export function ScanWorkbenchShell({
  page,
  state,
  title,
  subtitle,
  status,
  dock,
  facts,
  layout = 'stack',
  children,
}: {
  page: 'scan-start' | 'scan-settings' | 'scan-progress' | 'scan-result'
  state: ScanWorkbenchState
  title: string
  subtitle: ReactNode
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  dock?: ScanDock
  facts?: readonly string[]
  /**
   * 稿 18 的两种排法：`stack` 最后一块吃余量（选类型 / 面板指引 / 结果预览）；
   * `spread` 给「状态屏」用 —— 卡片按内容收住，余量摊进版块之间，
   * 不在正文底下留一整片空白，也不靠拉伸说明卡去填高度。
   */
  layout?: 'stack' | 'spread'
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const askLabel = scanAskLabel(page, state)
  /* 带去顾问页的草稿：不带按钮上的「问小青：」前缀，是一句自然问句（B1）。 */
  const askDraft = askDraftOf(askLabel)
  /**
   * 离开整条扫描流程。四个阶段、四个出口（顶栏返回 + 底栏三项主导航）共用这一条。
   *
   * 2026-09-13 起「离开」要连服务端一起收掉。此前这里只是 navigate：本机不再显示
   * 这场扫描，服务端那个任务却还停在 waiting 等文件 —— 下一位用户走到面板前按下
   * 扫描，文件会被投递给已经离开的这一位。撤销发不出去（断网 / 已终态）也不拦着走人。
   *
   * 底栏三项当天只做了 `navigate(...)`：顶栏返回收得干干净净，而按「首页 / AI 顾问 /
   * 我的」离开的用户，服务端任务和本机登记**两样都留在原地**——同一屏上两个出口
   * 两种命运。所以出口有几个不重要，离开的语义只能有一份：一律
   * 撤服务端 → 清本机登记 → 走人，只有落点不同。
   */
  const leaveScanFlow = (destination: string): void => {
    revokeLiveScanSession(getToken())
    clearScanWorkbenchSession()
    navigate(destination)
  }
  const leftSpec: ScanDockLeft = dock?.left ?? { label: '返回', leaveTo: '/print-scan' }
  return (
    <QxTouchScreen
      className="scan-touch"
      legacyFrame
      testId={`scan-workbench-state-${state}`}
      stateId={state}
      bodyClassName="qxt-body-tight"
      band={
        <QxTouchBand
          kind="compact"
          backLabel="返回打印扫描"
          onBack={() => leaveScanFlow('/print-scan')}
          eyebrow={SCAN_EYEBROW[page]}
          title={title}
          sub={subtitle}
          seal={null}
          status={{ text: status.label, tone: bandTone(status.tone) }}
          rail={{ labels: SCAN_RAIL, now: SCAN_RAIL_NOW[page] }}
        />
      }
      dock={
        <QxTouchDock
          back={false}
          left={
            <button
              type="button"
              className="qxt-btn qxt-btn-sec"
              disabled={leftSpec.disabled}
              onClick={() => {
                if (leftSpec.leaveTo) leaveScanFlow(leftSpec.leaveTo)
                else leftSpec.onClick?.()
              }}
            >
              <QxTouchIcon name={leftSpec.icon === 'refresh' ? 'refresh' : 'chevL'} size={30} strokeWidth={2.4} />
              {leftSpec.label}
            </button>
          }
          ask={{
            label: askLabel,
            draft: askDraft,
            voice: true,
            /* 问小青也是「离开整条扫描流程」：先记草稿，再走 leaveScanFlow 撤服务端、清本机登记，
             * 最后返回 false 让底栏不再自己 navigate。 */
            beforeAsk: () => {
              rememberAssistantDraft(askDraft)
              leaveScanFlow('/assistant')
              return false
            },
          }}
          primary={dock?.primary}
        />
      }
      nav={
        /* 底栏三项也是「离开整条扫描流程」，不是页内切换：走同一条 leaveScanFlow，
         *  只有落点不同。任何一个改回裸 navigate，这一屏就又会留下孤儿任务。 */
        <QxTouchNav
          onHome={() => leaveScanFlow('/')}
          onAdvisor={() => leaveScanFlow('/assistant')}
          onProfile={() => leaveScanFlow('/profile')}
        />
      }
    >
      <div
        className="sw-page qxt-scan-scroll"
        data-w2-page={page}
        data-qx-page="scan-workbench"
        data-state={state}
        data-layout={layout}
      >
        <AiDownNote />
        {facts && facts.length > 0 ? (
          <div className="sw-xq-facts">
            {facts.map((fact) => (
              <p key={fact}>{fact}</p>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </QxTouchScreen>
  )
}

export function ScanHero({
  ask,
  em,
  doing,
  facts,
}: {
  ask: string
  em: string
  doing: ReactNode
  facts?: readonly string[]
}) {
  const i = ask.indexOf(em)
  return (
    <section className="sw-xq">
      <div className="sw-xq-row">
        <div className="sw-xq-face" aria-hidden="true">青</div>
        <div className="sw-xq-main">
          <h2 className="sw-xq-ask">
            {i < 0 ? (
              ask
            ) : (
              <>
                {ask.slice(0, i)}
                <em>{em}</em>
                {ask.slice(i + em.length)}
              </>
            )}
          </h2>
          <p className="sw-xq-doing">{doing}</p>
        </div>
      </div>
      {facts && facts.length > 0 ? (
        <div className="sw-xq-facts">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function ScanChain({ active }: { active: number }) {
  return (
    <div className="sw-chain" data-testid="scan-workbench-chain">
      {SCAN_CHAIN.map((step, index) => {
        const Icon = step.icon
        return (
          <div key={step.title} className="sw-chain-wrap">
            {index > 0 ? <span className="sw-chain-arrow" aria-hidden="true"><ChevronRightIcon size={20} /></span> : null}
            <div className={`sw-link${active === index ? ' is-on' : ''}`}>
              <span className="sw-link-ic"><Icon size={24} aria-hidden /></span>
              <b>{step.title}</b>
              <span className="sw-link-c">{step.copy}</span>
              <span className="sw-link-who">{step.who}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ScanTruth() {
  return (
    <div className="sw-truth" data-disclaimer="true" data-testid="scan-workbench-truth">
      {SCAN_TRUTH.map((item) => (
        <div key={item.title}>
          <b>{item.title}</b>
          {item.body}
        </div>
      ))}
    </div>
  )
}

export function ScanTypeCards({
  selected,
  onPick,
}: {
  selected: ScanType
  onPick: (type: ScanType) => void
}) {
  return (
    <div className="fs-types" role="radiogroup" aria-label="扫描类型">
      {SCAN_TYPE_OPTIONS.map((option) => {
        const on = selected === option.type
        const base = `scan-type-${option.type}`
        /* 单选卡的读屏名只取标题；说明与角标进 aria-describedby，读屏能听到「支持 AI 简历识别」「敏感文件 · 自动清理」。
           不再同时写 aria-pressed（radio 上是非法组合）和盖住整张卡的 aria-label（B2）。 */
        return (
          <button
            key={option.type}
            type="button"
            className="fs-type"
            role="radio"
            aria-checked={on}
            aria-labelledby={`${base}-title`}
            aria-describedby={`${base}-desc ${base}-chips`}
            data-testid={`scan-workbench-type-${option.type}`}
            onClick={() => onPick(option.type)}
          >
            <b id={`${base}-title`}>{option.label}</b>
            <span id={`${base}-desc`} className="fs-sub">{option.description}</span>
            <span id={`${base}-chips`} className="sx-chips">
              {option.chips.map((chip) => (
                <span key={chip.label} className={`sx-chip${chip.tone === 'warn' ? ' is-warn' : ''}`}>{chip.label}</span>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ScanNoteCard({
  title,
  children,
  foot,
}: {
  title: string
  children: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className="sw-pgrp">
      <h4>{title}</h4>
      <div className="sw-note-body">{children}</div>
      {foot ? <div className="sw-foot">{foot}</div> : null}
    </div>
  )
}

export function ScanPlan({ items }: { items: readonly string[] }) {
  return (
    <ul className="sw-plan">
      {items.map((item) => (
        <li key={item}><span className="sw-sq" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function ScanPanelMock({ instructions }: { instructions: string[] }) {
  const count = instructions.length
  return (
    <>
      <div className="sx-steps" data-testid="scan-workbench-instructions">
        {instructions.map((instruction, index) => (
          <div key={`${instruction}-${index}`} className="fs-step">
            <span className="n">{index + 1}</span>
            <b>面板步骤 {index + 1}</b>
            <span className="d">{instruction}</span>
          </div>
        ))}
      </div>
      <div className="fs-scanhero">
        <div className="vis" aria-hidden="true"><ScanPaperArt /></div>
        <p>按上面{count <= 10 ? CN_NUM[count] : count}步，在打印机面板上操作。扫完可以取回原件。</p>
      </div>
    </>
  )
}

/**
 * 状态屏（没建好、没开放、读取中、U 盘、没扫成……）上多出来的高度只给这一块示意小样，不撑空卡
 * （稿 RULES 第 3 条：卡片按内容定高，多出来的地方放实物小样）。只作示意，不代表任何真实进度。
 */
export function ScanSample({ art = 'scan' }: { art?: 'scan' | 'usb' }) {
  const Art = art === 'usb' ? UsbArt : ScanPaperArt
  return (
    <div className="sx-sample" data-testid="scan-sample" aria-hidden="true">
      <Art />
    </div>
  )
}

export function ScanStatusPanel({
  tone,
  icon: Icon,
  title,
  children,
  chips,
  breathe,
}: {
  tone: 'info' | 'error' | 'warn' | 'lock'
  icon?: LucideIcon
  title: string
  children: ReactNode
  chips?: readonly { label: string; tone?: 'ok' | 'warn' }[]
  breathe?: boolean
}) {
  return (
    <div className="sw-state sw-state-hero" data-kind={tone} data-testid="scan-workbench-fallback">
      <div className="sw-state-h">
        {breathe ? <span className="sw-dot breathe" aria-hidden="true" /> : Icon ? <Icon size={28} aria-hidden /> : null}
        {title}
      </div>
      <div className="sw-state-p">{children}</div>
      {chips && chips.length > 0 ? (
        <div className="sw-meta">
          {chips.map((chip) => (
            <span key={chip.label} className={`sw-chip${chip.tone ? ` is-${chip.tone}` : ''}`}>{chip.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ScanKvCard({
  title,
  rows,
}: {
  title: string
  rows: readonly [string, string][]
}) {
  return (
    <div className="sw-pgrp" data-testid="scan-workbench-task-card">
      <h4>{title}</h4>
      <div className="sw-kv">
        {rows.map(([key, value]) => (
          <div key={key}><span>{key}</span><b>{value}</b></div>
        ))}
      </div>
    </div>
  )
}

export function ScanSec({
  no,
  title,
  hint,
  children,
  grow,
}: {
  no?: string
  title?: string
  hint?: string
  children: ReactNode
  grow?: boolean
}) {
  return (
    <section className={`sw-sec${grow ? ' is-grow' : ''}`}>
      {title ? (
        <div className="sw-sec-h">
          {no ? <span className="sw-no">{no}</span> : null}
          <span className="t">{title}</span>
          {hint ? <span className="hint">{hint}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
