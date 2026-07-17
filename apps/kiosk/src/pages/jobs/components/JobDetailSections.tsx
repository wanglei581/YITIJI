import { Button } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  BuildingIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  InfoIcon,
  MapPinIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'
import { SourceUrlQr } from '../../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../../lib/url'
import { CATEGORY_LABEL, formatFullDate, jobCompleteness, splitTextLines } from '../utils/jobDisplay'

export function QrOverlay({
  job,
  onClose,
}: {
  job: ExternalJobDTO
  onClose: () => void
}) {
  const valid = isValidSourceUrl(job.sourceUrl)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <button onClick={onClose} aria-label="关闭" className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100">
          <XIcon className="h-5 w-5" />
        </button>

        <p className="text-center text-base font-semibold text-neutral-800">扫码前往来源平台投递</p>

        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={job.sourceUrl} size={196} />
        </div>

        {valid && <p className="mt-3 break-all rounded-lg bg-neutral-50 px-3 py-2 text-center text-[11px] text-neutral-500">{job.sourceUrl}</p>}

        <div className="mt-4 space-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
          <InfoRow label="来源机构" value={job.sourceName} />
          <InfoRow label="外部编号" value={job.externalId} mono />
        </div>

        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-neutral-500">
            请使用手机扫码前往来源平台办理投递，本系统不接收简历、不参与招聘流程。
          </p>
        </div>
      </div>
    </div>
  )
}

export function JobSummarySection({
  job,
  favorite,
  onToggleFavorite,
}: {
  job: ExternalJobDTO
  favorite: boolean
  onToggleFavorite: () => void
}) {
  const completeness = jobCompleteness(job)
  return (
    <section className="jf-card accented compact">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[36px] font-black leading-tight tracking-[1px]">{job.title}</h2>
          <div className="jf-row-info mt-3">
            <span><BuildingIcon aria-hidden="true" />{job.company}</span>
            <span><MapPinIcon aria-hidden="true" />{job.city}</span>
          </div>
        </div>
        <button
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? '取消收藏' : '收藏岗位'}
          className={`jf-f-chip ${favorite ? 'on' : ''}`}
        >
          <StarIcon className={`h-5 w-5 ${favorite ? 'fill-current' : ''}`} />
          {favorite ? '已收藏' : '收藏'}
        </button>
      </div>

      <div className="jf-metrics mt-5">
        <SummaryMetric label="薪资" value={job.salaryDisplay || '薪资面议'} />
        <SummaryMetric label="类型" value={job.category ? CATEGORY_LABEL[job.category] ?? job.category : '来源平台未提供'} />
        <SummaryMetric label="行业" value={job.industry || '来源平台未提供'} />
        <SummaryMetric label="字段完整度" value={`${completeness}%`} />
      </div>

      <div className="jf-meta-chips mt-4">
        {job.category && (
          <span className="jf-chip">
            {CATEGORY_LABEL[job.category] ?? job.category}
          </span>
        )}
        {job.tags.map((tag) => (
          <span key={tag} className="jf-chip">
            <TagIcon className="h-3 w-3" />
            {tag}
          </span>
        ))}
      </div>
    </section>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="jf-metric">
      <p className="k">{label}</p>
      <p className={`v ${label === '薪资' ? 'salary' : ''}`}>{value}</p>
    </div>
  )
}

export function JobDescriptionSection({ job }: { job: ExternalJobDTO }) {
  const descriptions = splitTextLines(job.description)
  const requirements = splitTextLines(job.requirements)

  return (
    <section className="jf-card compact">
      <div className="jf-card-head">
        <span className="jf-g-icon"><FileSearchIcon aria-hidden="true" /></span>
        <div>
          <h2>职责与要求</h2>
          <div className="sub">内容由来源平台同步</div>
        </div>
      </div>

      <div className="jf-desc-grid">
        <TextList title="岗位职责" items={descriptions} fallback="来源平台暂未提供岗位职责，建议通过来源链接查看完整 JD。" />
        <TextList title="任职要求" items={requirements} fallback="来源平台暂未提供任职要求，客户可在导入时补充 requirements 字段。" />
      </div>
    </section>
  )
}

function TextList({ title, items, fallback }: { title: string; items: string[]; fallback: string }) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.slice(0, 8).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[20px] leading-relaxed text-[var(--muted)]">{fallback}</p>
      )}
    </div>
  )
}

export function JobTrustSection({ job, sourceCanApply }: { job: ExternalJobDTO; sourceCanApply: boolean }) {
  return (
    <section className="jf-card accented compact" style={{ '--accent': 'var(--wheat)', '--accent-deep': 'var(--wheat-deep)', '--accent-soft': 'var(--wheat-soft)' } as React.CSSProperties}>
      <div className="jf-card-head">
        <span className="jf-g-icon"><ShieldCheckIcon aria-hidden="true" /></span>
        <div>
          <h2>来源可信区</h2>
          <div className="sub">第三方来源信息，请核对后前往办理</div>
        </div>
      </div>

      <div className="jf-kv-grid">
        <div className="jf-kv"><div className="k">来源机构</div><div className="v">{job.sourceName}</div></div>
        <div className="jf-kv"><div className="k">来源类型</div><div className="v">线上招聘平台</div></div>
        <div className="jf-kv"><div className="k">同步时间</div><div className="v">{formatFullDate(job.syncTime)}</div></div>
        <div className="jf-kv"><div className="k">外部ID</div><div className="v">{job.externalId}</div></div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[18px] text-[var(--muted)]">
        <InfoIcon className="h-5 w-5" />
        来源链接 <b className="break-all text-[var(--ink)]">{sourceCanApply ? job.sourceUrl : '来源平台未提供有效链接'}</b>
      </div>

      <div className="jf-notice mt-4">
        <InfoIcon aria-hidden="true" />
        <p>
          本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程。
          <span className="mt-1 block text-neutral-400">{job.dataSourceNote}</span>
        </p>
      </div>
    </section>
  )
}

export function JobNextActionsSection({
  job,
  sourceCanApply,
  onOpenSource,
  onOpenQr,
  onViewCompany,
  onExplainAi,
  onMatchAi,
}: {
  job: ExternalJobDTO
  sourceCanApply: boolean
  onOpenSource: () => void
  onOpenQr: () => void
  onViewCompany: () => void
  onExplainAi: () => void
  onMatchAi: () => void
}) {
  return (
    <div className="jf-action-zone">
      <section className="jf-card compact">
        <div className="jf-card-head">
          <span className="jf-g-icon"><ArrowRightIcon aria-hidden="true" /></span>
          <div>
            <h2>后续动作</h2>
            <div className="sub">AI 内容仅供参考，需登录后使用</div>
          </div>
        </div>
        <div className="jf-next-grid">
          <ActionButton icon={SparklesIcon} label="AI岗位解读" hint="看懂职责与准备点" onClick={onExplainAi} />
          <ActionButton icon={FileSearchIcon} label="岗位匹配参考" hint="用本人简历做准备" onClick={onMatchAi} />
          <ActionButton icon={BuildingIcon} label="查看企业" hint={job.companyProfileId ? job.company : '来源企业未关联'} disabled={!job.companyProfileId} onClick={onViewCompany} />
          <ActionButton icon={ExternalLinkIcon} label="去来源平台投递" hint="打开第三方岗位页" disabled={!sourceCanApply} onClick={onOpenSource} />
        </div>
      </section>
      <div className="jf-qr-panel">
        <div className="qr-title">扫码投递</div>
        <SourceUrlQr value={job.sourceUrl} size={170} />
        <div className="qr-sub">手机扫码打开来源平台投递页，投递结果以来源平台为准</div>
          <button
            type="button"
            disabled={!sourceCanApply}
            onClick={onOpenQr}
          className="jf-btn ghost sm"
          >
          <QrCodeIcon aria-hidden="true" />
            放大二维码
          </button>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: typeof QrCodeIcon
  label: string
  hint: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="jf-tile disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="jf-tile-icon"><Icon aria-hidden="true" /></span>
      <span><b>{label}</b><span>{hint}</span></span>
    </button>
  )
}

export function StickyActionBar({
  sourceCanApply,
  onOpenSource,
  onOpenQr,
}: {
  sourceCanApply: boolean
  onOpenSource: () => void
  onOpenQr: () => void
}) {
  return (
    <div className="border-t border-neutral-100 px-6 pb-6 pt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button size="lg" className="flex items-center gap-2" disabled={!sourceCanApply} onClick={onOpenSource}>
          <ExternalLinkIcon className="h-4 w-4" />
          去来源平台投递
        </Button>
        <Button size="lg" variant="secondary" className="flex items-center gap-2" disabled={!sourceCanApply} onClick={onOpenQr}>
          <QrCodeIcon className="h-4 w-4" />
          扫码投递
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
        <InfoIcon className="h-3 w-3" />
        {sourceCanApply ? '扫码将跳转至来源平台办理，本系统不收取简历' : '来源平台未提供有效投递链接，请前往来源机构咨询'}
      </div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono,
  wrap,
}: {
  label: string
  value: string
  mono?: boolean
  wrap?: boolean
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span className={[
        'text-right text-neutral-700',
        mono ? 'font-mono text-xs' : '',
        wrap ? 'break-all text-xs' : '',
      ].join(' ')}>
        {value}
      </span>
    </div>
  )
}
// 岗位摘要 — 职位核心信息摘要卡片
