import { Button, Card } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  BuildingIcon,
  CheckCircle2Icon,
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
import { CATEGORY_LABEL, CATEGORY_STYLE, formatFullDate, jobCompleteness, splitTextLines } from '../utils/jobDisplay'

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
        <button onClick={onClose} aria-label="关闭" className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100">
          <XIcon className="h-5 w-5" />
        </button>

        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台投递</p>

        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={job.sourceUrl} size={196} />
        </div>

        {valid && <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-center text-[11px] text-gray-500">{job.sourceUrl}</p>}

        <div className="mt-4 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <InfoRow label="来源机构" value={job.sourceName} />
          <InfoRow label="外部编号" value={job.externalId} mono />
        </div>

        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
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
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary-600">
            <SparklesIcon className="h-4 w-4" />
            岗位摘要
          </div>
          <h2 className="text-xl font-bold leading-snug text-gray-900">{job.title}</h2>
        </div>
        <button
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? '取消收藏' : '收藏岗位'}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
        >
          <StarIcon className={`h-4 w-4 ${favorite ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}`} />
          {favorite ? '已收藏' : '收藏'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
        <span className="flex items-center gap-1.5">
          <BuildingIcon className="h-4 w-4 text-gray-400" />
          {job.company}
        </span>
        <span className="flex items-center gap-1.5">
          <MapPinIcon className="h-4 w-4 text-gray-400" />
          {job.city}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryMetric label="薪资" value={job.salaryDisplay || '薪资面议'} />
        <SummaryMetric label="类型" value={job.category ? CATEGORY_LABEL[job.category] ?? job.category : '来源平台未提供'} />
        <SummaryMetric label="行业" value={job.industry || '来源平台未提供'} />
        <SummaryMetric label="字段完整度" value={`${completeness}%`} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {job.category && (
          <span className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${CATEGORY_STYLE[job.category] ?? 'bg-gray-100 text-gray-500'}`}>
            {CATEGORY_LABEL[job.category] ?? job.category}
          </span>
        )}
        {job.tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
            <TagIcon className="h-3 w-3" />
            {tag}
          </span>
        ))}
      </div>
    </Card>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <p className="text-[11px] text-neutral-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  )
}

export function JobDescriptionSection({ job }: { job: ExternalJobDTO }) {
  const descriptions = splitTextLines(job.description)
  const requirements = splitTextLines(job.requirements)

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <FileSearchIcon className="h-4 w-4 text-primary-600" />
        <p className="text-sm font-semibold text-gray-800">职责与要求</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TextList title="岗位职责" items={descriptions} fallback="来源平台暂未提供岗位职责，建议通过来源链接查看完整 JD。" />
        <TextList title="任职要求" items={requirements} fallback="来源平台暂未提供任职要求，客户可在导入时补充 requirements 字段。" />
      </div>
    </Card>
  )
}

function TextList({ title, items, fallback }: { title: string; items: string[]; fallback: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-4">
      <p className="mb-3 text-sm font-medium text-gray-700">{title}</p>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.slice(0, 8).map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-relaxed text-gray-600">
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-gray-500">{fallback}</p>
      )}
    </div>
  )
}

export function JobTrustSection({ job, sourceCanApply }: { job: ExternalJobDTO; sourceCanApply: boolean }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheckIcon className="h-4 w-4 text-primary-600" />
        <p className="text-sm font-semibold text-gray-800">来源可信区</p>
      </div>

      <div className="space-y-2">
        <InfoRow label="来源机构" value={job.sourceName} />
        <InfoRow label="同步时间" value={formatFullDate(job.syncTime)} />
        <InfoRow label="外部编号" value={job.externalId} mono />
        <InfoRow label="来源链接" value={sourceCanApply ? job.sourceUrl : '来源平台未提供有效链接'} wrap />
      </div>

      <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
        <p className="text-xs leading-relaxed text-gray-500">
          本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程。
          <span className="mt-1 block text-gray-400">{job.dataSourceNote}</span>
        </p>
      </div>
    </Card>
  )
}

export function JobNextActionsSection({
  job,
  sourceCanApply,
  onOpenQr,
  onViewCompany,
  onGoFit,
}: {
  job: ExternalJobDTO
  sourceCanApply: boolean
  onOpenQr: () => void
  onViewCompany: () => void
  onGoFit: () => void
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <ArrowRightIcon className="h-4 w-4 text-primary-600" />
        <p className="text-sm font-semibold text-gray-800">后续动作</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionButton icon={QrCodeIcon} label="扫码投递" hint="手机打开来源平台" disabled={!sourceCanApply} onClick={onOpenQr} />
        <ActionButton icon={FileSearchIcon} label="岗位匹配参考" hint="用本人简历做准备" onClick={onGoFit} />
        <ActionButton icon={BuildingIcon} label="查看企业" hint={job.companyProfileId ? job.company : '来源企业未关联'} disabled={!job.companyProfileId} onClick={onViewCompany} />
      </div>
    </Card>
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
      className="min-h-[76px] rounded-lg border border-neutral-200 bg-white px-4 py-3 text-left transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-5 w-5 text-primary-600" />
      <span className="mt-2 block text-sm font-semibold text-gray-900">{label}</span>
      <span className="mt-0.5 block text-xs text-gray-400">{hint}</span>
    </button>
  )
}

export function StickyActionBar({
  sourceCanApply,
  onOpenSource,
}: {
  sourceCanApply: boolean
  onOpenSource: () => void
}) {
  return (
    <div className="border-t border-neutral-100 px-6 pb-6 pt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button size="lg" className="flex items-center gap-2" disabled={!sourceCanApply} onClick={onOpenSource}>
          <ExternalLinkIcon className="h-4 w-4" />
          去来源平台投递
        </Button>
        <Button size="lg" variant="secondary" className="flex items-center gap-2" disabled={!sourceCanApply} onClick={onOpenSource}>
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
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className={[
        'text-right text-gray-700',
        mono ? 'font-mono text-xs' : '',
        wrap ? 'break-all text-xs' : '',
      ].join(' ')}>
        {value}
      </span>
    </div>
  )
}
