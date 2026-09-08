import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRightIcon, type LucideIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { getTerminalCode, getTerminalId } from '../../services/api/screensaver'
import {
  SCAN_ASK,
  SCAN_CHAIN,
  SCAN_TRUTH,
  SCAN_TYPE_OPTIONS,
  type ScanType,
  type ScanWorkbenchState,
} from './scanWorkbench'
import './styles/scan-workbench-qx.css'

export function scanTerminalLabel(): string {
  return getTerminalCode() || getTerminalId() || '终端未登记'
}

export function ScanWorkbenchShell({
  page,
  state,
  title,
  subtitle,
  status,
  ctabar,
  facts,
  children,
}: {
  page: 'scan-start' | 'scan-settings' | 'scan-progress' | 'scan-result'
  state: ScanWorkbenchState
  title: string
  subtitle: ReactNode
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  ctabar: ReactNode
  facts?: readonly string[]
  children: ReactNode
}) {
  const navigate = useNavigate()
  const ask = SCAN_ASK[state]
  return (
    <QxPageFrame
      title={title}
      subtitle={subtitle}
      status={status}
      terminalLabel={scanTerminalLabel()}
      ctabar={ctabar}
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <div
        className="sw-page qx-grow"
        data-w2-page={page}
        data-qx-page="scan-workbench"
        data-state={state}
        data-testid={`scan-workbench-state-${state}`}
      >
        <ScanHero ask={ask.text} em={ask.em} doing={ask.doing} facts={facts} />
        <div className="qx-scroll sw-scroll">{children}</div>
        <ScanTruth />
      </div>
    </QxPageFrame>
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
          <div className="sw-xq-eyebrow">SCAN VIA PANEL</div>
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
    <div className="sw-types" role="radiogroup" aria-label="扫描类型">
      {SCAN_TYPE_OPTIONS.map((option) => {
        const on = selected === option.type
        const Icon = option.icon
        return (
          <button
            key={option.type}
            type="button"
            className="sw-ty"
            role="radio"
            aria-checked={on}
            aria-pressed={on}
            aria-label={`选择扫描类型：${option.label}`}
            data-testid={`scan-workbench-type-${option.type}`}
            onClick={() => onPick(option.type)}
          >
            <span className="sw-ty-ic"><Icon size={30} aria-hidden /></span>
            <span className="sw-ty-n">{option.label}</span>
            <span className="sw-ty-d">{option.description}</span>
            <span className="sw-ty-chips">
              {option.chips.map((chip) => (
                <span key={chip.label} className={`sw-mini${chip.tone ? ` is-${chip.tone}` : ''}`}>{chip.label}</span>
              ))}
              {on ? <span className="sw-mini is-pick">已选中</span> : null}
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

export function ScanPanelMock({ instructions, scanLabel }: { instructions: string[]; scanLabel: string }) {
  return (
    <div className="sw-panel">
      <div className="sw-mfp">
        <div className="sw-mfp-face">
          <div className="sw-mfp-screen">在面板上选<br />扫描到 网络文件夹</div>
          <div className="sw-mfp-row"><span /><span className="is-hi" /><span /></div>
          <div className="sw-mfp-row"><span /><span /><span /></div>
        </div>
        <p className="sw-mfp-cap">这是<b>奔图机器自己的操作面板</b>示意图，不是本机屏幕。扫描的每一步都在那上面按。</p>
      </div>
      <div className="sw-psteps" data-testid="scan-workbench-instructions">
        {instructions.map((instruction, index) => (
          <div key={`${instruction}-${index}`} className="sw-pstep">
            <span className="sw-pstep-n">{index + 1}</span>
            <span className="sw-pstep-t">{instruction}</span>
          </div>
        ))}
        <p className="sw-psrc">
          以上 {instructions.length} 条按「{scanLabel}」下发，本机一字未改。扫完请回到这台屏幕，进入等待之后本机会自动查，别在面板前干等。
        </p>
      </div>
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

export function ScanCta({
  reason,
  children,
}: {
  reason?: string
  children: ReactNode
}) {
  return (
    <div className="sw-cta-wrap">
      {reason ? <p className="sw-cta-reason" data-testid="scan-workbench-disabled-reason">{reason}</p> : null}
      <div className="sw-cta-row">{children}</div>
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
