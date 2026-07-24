import type { LucideIcon } from 'lucide-react'
import { InfoIcon } from 'lucide-react'
import {
  KioskActionBar as UiKioskActionBar,
  KioskPageFrame as UiKioskPageFrame,
  KioskPageHeader,
} from '@ai-job-print/ui'

export type W4PageTone = 'clay' | 'wheat'

export function KioskPageFrame({
  tone,
  title,
  subtitle,
  badge,
  backLabel = '返回',
  onBack,
  children,
  actionBar,
  tight,
}: {
  tone: W4PageTone
  title: string
  subtitle: string
  badge?: React.ReactNode
  backLabel?: string
  onBack: () => void
  children: React.ReactNode
  actionBar?: React.ReactNode
  tight?: boolean
}) {
  return (
    <UiKioskPageFrame
      className={`jf-proto tone-${tone} w4-page-frame`}
      header={(
        <KioskPageHeader
          title={title}
          description={subtitle}
          backLabel={backLabel}
          onBack={onBack}
          aside={badge}
        />
      )}
      footer={actionBar ? <UiKioskActionBar>{actionBar}</UiKioskActionBar> : undefined}
    >
      <section className={`jf-content w4-page-content${tight ? ' tight' : ''}`}>{children}</section>
    </UiKioskPageFrame>
  )
}

export function FusionBadge({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="jf-badge">
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  )
}

export function FusionNotice({ children }: { children: React.ReactNode }) {
  return (
    <aside className="jf-notice">
      <InfoIcon aria-hidden="true" />
      <span>{children}</span>
    </aside>
  )
}

export function FusionStepStrip({ steps }: { steps: Array<{ title: string; desc: string }> }) {
  return (
    <ol className="jf-step-strip w4-ordered-steps">
      {steps.map((step, index) => (
        <li key={step.title} className="jf-step-row">
          <span className="num w4-step-number">{index + 1}</span>
          <span>
            <b>{step.title}</b>
            <span>{step.desc}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function FusionListSteps() {
  return (
    <ol className="jf-steps" aria-label="预约步骤">
      {['选地区', '浏览列表', '扫码预约'].map((label, index) => (
        <li key={label} className={`jf-step${index === 0 ? ' done' : index === 1 ? ' active' : ''}`}>
          <span className="jf-step-dot">{index + 1}</span>
          <span className="jf-step-label">{label}</span>
        </li>
      ))}
    </ol>
  )
}

export function FusionSectionHead({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
}) {
  return (
    <header className="jf-card-head">
      <span className="jf-g-icon"><Icon aria-hidden="true" /></span>
      <div>
        <h2>{title}</h2>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
    </header>
  )
}

export function FusionSourceMeta({
  sourceName,
  syncTime,
  externalId,
}: {
  sourceName?: string
  syncTime?: string
  externalId?: string
}) {
  const items = [
    sourceName ? ['来源机构', sourceName] : null,
    syncTime ? ['同步时间', formatW4Date(syncTime)] : null,
    externalId ? ['外部ID', externalId] : null,
  ].filter((item): item is string[] => item !== null)

  return (
    <dl className="jf-meta-chips w4-source-meta">
      {items.map(([term, value]) => (
        <div key={term} className={term === '来源机构' ? 'jf-chip src' : 'jf-chip'}>
          <dt>{term}</dt><dd><b>{value}</b></dd>
        </div>
      ))}
    </dl>
  )
}

function formatW4Date(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}
