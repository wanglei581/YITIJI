import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDateTime } from '@ai-job-print/shared'
import {
  AlertTriangleIcon,
  CalendarIcon,
  ChevronRightIcon,
  GlobeIcon,
  InfoIcon,
  LockIcon,
  SmartphoneIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { SourceUrlQr } from '../../../components/SourceUrlQr'
import { getTerminalCode } from '../../../services/api/terminalConfig'
import '../styles/job-fairs-qx.css'

/** 投递 / 预约类 CTA 只接受这些字面量，编译期堵住同义擦边。 */
export type QxCtaLabel =
  | '查看岗位'
  | '去来源平台投递'
  | '扫码投递'
  | '查看招聘会'
  | '去来源平台预约'
  | '扫码预约'
  | '复制来源链接'

export const QX_CTA_WHITELIST: readonly QxCtaLabel[] = [
  '查看岗位',
  '去来源平台投递',
  '扫码投递',
  '查看招聘会',
  '去来源平台预约',
  '扫码预约',
  '复制来源链接',
]

/**
 * 返回落点照稿 28-jobfair-enhanced.html 的 `var BACK` 逐条搬过来，键就是稿里的 screen 名。
 * 稿里八个屏各自写死了落点和文案，这里不重新发明——只把 `:id` 换成运行时的 fairId。
 *
 * 为什么集中在壳里而不是逐页传：QxPageFrame 的 `back` 是可选 prop，不传就没有返回键
 * 且不会有任何报错。八个页面各传一次 = 八次漏传的机会；这里传一次，漏不掉。
 * fair-company 一屏稿 28 没有，取稿 44-fair-company-detail 的「返回参展企业列表」。
 */
const FAIR_BACK: Record<string, { label: string; to: (fairId: string) => string }> = {
  list: { label: '返回招聘会服务', to: () => '/fairs-service' },
  checkin: { label: '返回场次列表', to: () => '/job-fairs' },
  detail: { label: '返回场次列表', to: () => '/job-fairs' },
  companies: { label: '返回招聘会详情', to: (id) => `/job-fairs/${id}` },
  map: { label: '返回招聘会详情', to: (id) => `/job-fairs/${id}` },
  materials: { label: '返回招聘会详情', to: (id) => `/job-fairs/${id}` },
  'visit-plan': { label: '返回招聘会详情', to: (id) => `/job-fairs/${id}` },
  stats: { label: '返回招聘会详情', to: (id) => `/job-fairs/${id}` },
  'fair-company': { label: '返回参展企业列表', to: (id) => `/job-fairs/${id}/companies` },
}

export function QxFairShell({
  title,
  subtitle,
  status,
  ctabar,
  screen,
  state,
  fairId = '',
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  ctabar?: ReactNode
  screen: string
  state: string
  fairId?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const back = FAIR_BACK[screen]
  return (
    <QxPageFrame
      title={title}
      back={back ? { label: back.label, onBack: () => navigate(back.to(fairId)) } : undefined}
      subtitle={subtitle}
      status={status}
      terminalLabel={getTerminalCode() || '设备未绑定'}
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
        className="qx-scroll qx-grow qx-fair-body"
        data-screen={screen}
        data-state={state}
        data-testid={`${screen}-state-${state}`}
      >
        {children}
      </div>
    </QxPageFrame>
  )
}

export function QxFairState({
  screen,
  tone,
  icon: Icon,
  title,
  children,
  actions,
}: {
  screen: string
  tone: 'empty' | 'error' | 'info'
  icon: LucideIcon
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="qx-state qx-fair-state" data-tone={tone} data-testid={`${screen}-fallback`}>
      <span className="qx-state-ic">
        <Icon size={28} aria-hidden />
      </span>
      <div>
        <p className="qx-state-t">{title}</p>
        <div className="qx-state-d">{children}</div>
        {actions ? <div className="qx-fair-state-acts">{actions}</div> : null}
      </div>
    </div>
  )
}

export function QxFairSourceCard({
  sourceName,
  syncTime,
  externalId,
  hint = '来源要素不全即不放行预约入口',
}: {
  sourceName?: string | null
  syncTime?: string | null
  externalId?: string | null
  hint?: string
}) {
  return (
    <section className="qx-card qx-fair-src">
      <div className="qx-fair-blk-h">
        <GlobeIcon size={24} aria-hidden />
        信息来源
        <span className="hint">{hint}</span>
      </div>
      <dl className="qx-fair-kv">
        <div className="qx-fair-kv-row">
          <dt>来源机构</dt>
          <dd>{sourceName?.trim() || '来源平台未提供'}</dd>
        </div>
        <div className="qx-fair-kv-row">
          <dt>同步时间</dt>
          <dd>{syncTime?.trim() ? formatDateTime(syncTime) : '同步时间未知'}</dd>
        </div>
        <div className="qx-fair-kv-row">
          <dt>外部编号</dt>
          <dd>{externalId?.trim() || '来源平台未提供'}</dd>
        </div>
      </dl>
    </section>
  )
}

export function QxFairNotice() {
  return (
    <section className="qx-card">
      <div className="qx-fair-blk-h">
        <InfoIcon size={24} aria-hidden />
        去之前先知道这几件事
      </div>
      <div className="qx-fair-rules">
        <p className="qx-fair-rule">
          <i>1</i>
          <span>
            预约与到场登记<b>由主办方和来源平台负责</b>；本机不代预约、不做签到，也查不到登记结果。
          </span>
        </p>
        <p className="qx-fair-rule">
          <i>2</i>
          <span>
            用人单位与岗位信息以主办方现场公示为准；本机<b>不代收简历</b>，带足纸质材料当面交给对方。
          </span>
        </p>
        <p className="qx-fair-rule">
          <i>3</i>
          <span>
            现场遇到收费、押金、扣留证件，<b>立即停止并告知工作人员</b>。
          </span>
        </p>
      </div>
    </section>
  )
}

export function QxFairNavRow({
  icon: Icon,
  title,
  description,
  onClick,
  testId,
}: {
  icon: LucideIcon
  title: string
  description: string
  onClick: () => void
  testId: string
}) {
  return (
    <button type="button" className="qx-row" onClick={onClick} data-testid={testId}>
      <span className="qx-row-ic">
        <Icon size={24} aria-hidden />
      </span>
      <span className="qx-row-tx">
        <span className="qx-row-t">{title}</span>
        <span className="qx-row-d">{description}</span>
      </span>
      <span className="qx-row-go">
        <ChevronRightIcon size={22} aria-hidden />
      </span>
    </button>
  )
}

export function QxFairQrDialog({
  title,
  subtitle,
  value,
  note,
  meta,
  onClose,
}: {
  title: string
  subtitle?: string
  value: string | undefined | null
  note: string
  meta?: { label: string; value: string }[]
  onClose: () => void
}) {
  return (
    <div className="qx-fair-overlay" onClick={onClose}>
      <div
        className="qx-fair-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qx-fair-qr-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="qx-fair-dialog-close" onClick={onClose} aria-label="关闭">
          <XIcon size={22} aria-hidden />
        </button>
        <p id="qx-fair-qr-title" className="qx-fair-dialog-title">
          {title}
        </p>
        {subtitle ? <p className="qx-fair-dialog-sub">{subtitle}</p> : null}
        <div className="qx-fair-qr-slot">
          <SourceUrlQr value={value} size={200} />
        </div>
        {meta && meta.length > 0 ? (
          <dl className="qx-fair-dialog-meta">
            {meta.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="qx-fair-dialog-note">
          <SmartphoneIcon size={18} aria-hidden />
          {note}
        </p>
      </div>
    </div>
  )
}

export function QxFairSkel({ rows = 3 }: { rows?: number }) {
  return (
    <div className="qx-fair-skel-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="qx-fair-skel" />
      ))}
    </div>
  )
}

export function QxFairCta({
  variant = 'ghost',
  onClick,
  disabled,
  testId,
  children,
}: {
  variant?: 'primary' | 'ghost'
  onClick: () => void
  disabled?: boolean
  testId?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="qx-btn"
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

export const STATE_ICONS = {
  empty: CalendarIcon,
  error: AlertTriangleIcon,
  lock: LockIcon,
  info: InfoIcon,
} as const
