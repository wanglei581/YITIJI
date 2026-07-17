import type { LucideIcon } from 'lucide-react'
import { ArrowLeftIcon, InfoIcon } from 'lucide-react'

export type ProtoTone = 'clay' | 'wheat'

export function ProtoPage({
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
  tone: ProtoTone
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
    <div className={`jf-proto tone-${tone}`}>
      <div className="jf-page">
        <div className="jf-pagehead">
          <button type="button" className="jf-back" onClick={onBack}>
            <ArrowLeftIcon aria-hidden="true" />
            {backLabel}
          </button>
          <div className="jf-titlebox">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {badge && <div className="jf-pagehead-aside">{badge}</div>}
        </div>
        <main className={`jf-content${tight ? ' tight' : ''}`}>{children}</main>
        {actionBar && <div className="jf-actionbar">{actionBar}</div>}
      </div>
    </div>
  )
}

export function ProtoBadge({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="jf-badge">
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  )
}

export function ProtoNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="jf-notice">
      <InfoIcon aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export function ProtoStepStrip({
  steps,
}: {
  steps: Array<{ title: string; desc: string }>
}) {
  return (
    <div className="jf-step-strip">
      {steps.map((step, index) => (
        <div key={step.title} className="jf-step-row">
          <span className="num">{index + 1}</span>
          <span>
            <b>{step.title}</b>
            <span>{step.desc}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function ProtoListSteps() {
  return (
    <div className="jf-steps">
      <div className="jf-step done">
        <span className="jf-step-dot">1</span>
        <span className="jf-step-label">选地区</span>
      </div>
      <div className="jf-step-line done" />
      <div className="jf-step active">
        <span className="jf-step-dot">2</span>
        <span className="jf-step-label">浏览列表</span>
      </div>
      <div className="jf-step-line" />
      <div className="jf-step">
        <span className="jf-step-dot">3</span>
        <span className="jf-step-label">扫码预约</span>
      </div>
    </div>
  )
}

export function CardHead({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
}) {
  return (
    <div className="jf-card-head">
      <span className="jf-g-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <h2>{title}</h2>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
    </div>
  )
}

export function SourceMetaChips({
  sourceName,
  syncTime,
  externalId,
}: {
  sourceName?: string
  syncTime?: string
  externalId?: string
}) {
  return (
    <div className="jf-meta-chips">
      {sourceName && <span className="jf-chip src">来源机构 <b>{sourceName}</b></span>}
      {syncTime && <span className="jf-chip">同步时间 <b>{formatDate(syncTime)}</b></span>}
      {externalId && <span className="jf-chip">外部ID <b>{externalId}</b></span>}
    </div>
  )
}

export function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatShortDateTime(start: string, end?: string) {
  const startDate = new Date(start)
  if (Number.isNaN(startDate.getTime())) return start
  const pad = (value: number) => String(value).padStart(2, '0')
  const base = `${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())} ${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`
  if (!end) return base
  const endDate = new Date(end)
  if (Number.isNaN(endDate.getTime())) return base
  return `${base}-${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`
}
