import { Card } from '@ai-job-print/ui'
import {
  BarChart3Icon,
  BriefcaseIcon,
  Building2Icon,
  ChevronRightIcon,
  DatabaseIcon,
  LayersIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagIcon,
} from 'lucide-react'
import type { JobInsights, SourceCard, TagCount } from '../utils/jobDisplay'
import { formatSync } from '../utils/jobDisplay'

export function JobOverviewPanel({
  insights,
  displayedCount,
}: {
  insights: JobInsights
  displayedCount: number
}) {
  return (
    <section aria-label="岗位数据概览" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <OverviewTile icon={BriefcaseIcon} label="已发布岗位" value={insights.total} hint={`当前显示 ${displayedCount} 个`} />
      <OverviewTile icon={LayersIcon} label="来源机构" value={insights.sourceCount} hint="客户数据源可追溯" />
      <OverviewTile icon={MapPinIcon} label="覆盖城市" value={insights.cityCount} hint={`${insights.industryCount} 个行业`} />
      <OverviewTile icon={ShieldCheckIcon} label="字段完整度" value={`${insights.fieldCompleteness}%`} hint="按可展示字段估算" />
    </section>
  )
}

function OverviewTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof BriefcaseIcon
  label: string
  value: number | string
  hint: string
}) {
  return (
    <Card padding="none" className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
        <Icon className="h-4 w-4 text-primary-500" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-neutral-950">{value}</div>
      <div className="mt-1 text-xs text-neutral-400">{hint}</div>
    </Card>
  )
}

export function CompanyGuideEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[72px] w-full items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-5 text-left transition-colors hover:bg-primary-100/60 active:bg-primary-100"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white">
        <Building2Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-gray-900">找企业 · 企业展示</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
          浏览来源企业、在招岗位和企业详情；本系统不接收简历，办理请去来源平台。
        </span>
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-primary-400" aria-hidden="true" />
    </button>
  )
}

export function SourceInstitutionPanel({
  sources,
  activeSourceOrgId,
  onSelect,
}: {
  sources: SourceCard[]
  activeSourceOrgId: string
  onSelect: (sourceOrgId: string) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayersIcon className="h-5 w-5 text-primary-600" />
          <h2 className="text-base font-semibold text-neutral-900">信息来源机构</h2>
        </div>
        {activeSourceOrgId && (
          <button onClick={() => onSelect('')} className="text-xs font-medium text-primary-600 hover:text-primary-700">
            查看全部来源
          </button>
        )}
      </div>

      {sources.length === 0 ? (
        <Card padding="none" className="p-5 text-sm text-neutral-400">
          暂无来源机构
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sources.map((source) => {
            const active = activeSourceOrgId === source.orgId
            return (
              <button
                key={source.orgId}
                onClick={() => onSelect(active ? '' : source.orgId)}
                aria-pressed={active}
                className={[
                  'flex min-h-[118px] flex-col rounded-lg border bg-surface p-4 text-left transition-colors',
                  active
                    ? 'border-primary-500 ring-2 ring-primary-100'
                    : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30',
                ].join(' ')}
              >
                <p className="line-clamp-2 text-sm font-semibold text-neutral-900">{source.name}</p>
                <div className="mt-auto flex items-end justify-between pt-3">
                  <span className="text-sm font-semibold text-primary-600">
                    {source.jobCount}
                    <span className="ml-0.5 text-xs font-normal text-neutral-400">个岗位</span>
                  </span>
                  <span className="text-[11px] text-neutral-400">{formatSync(source.lastUpdate)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function TopTagsPanel({
  tags,
  onSelect,
}: {
  tags: TagCount[]
  onSelect: (tag: string) => void
}) {
  if (tags.length === 0) return null
  return (
    <section aria-label="热门岗位标签">
      <div className="mb-3 flex items-center gap-2">
        <TagIcon className="h-5 w-5 text-primary-600" />
        <h2 className="text-base font-semibold text-neutral-900">热门岗位标签</h2>
      </div>
      <Card padding="none" className="flex flex-wrap gap-2 p-4">
        {tags.map((tag) => (
          <button
            key={tag.label}
            onClick={() => onSelect(tag.label)}
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-primary-50 hover:text-primary-700"
          >
            {tag.label}
            <span className="ml-1 text-xs text-neutral-400">{tag.count}</span>
          </button>
        ))}
      </Card>
    </section>
  )
}

export function DataReadinessPanel({ insights }: { insights: JobInsights }) {
  return (
    <section aria-label="客户数据接入提示" className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_0.75fr]">
      <Card padding="none" className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <DatabaseIcon className="h-4 w-4 text-primary-600" />
          客户数据接入提示
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          当前页面只消费标准岗位字段：标题、企业、城市、行业、薪资、描述、要求、标签、来源机构、外部编号、来源链接和同步时间。
          客户通过 API、Webhook 或 Excel 导入这些字段后，页面会自动进入列表筛选、详情展示、收藏和来源跳转闭环。
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <ReadinessMetric label="薪资可见" value={insights.withSalary} total={insights.total} />
          <ReadinessMetric label="职责要求" value={insights.withRequirement} total={insights.total} />
          <ReadinessMetric label="来源链接" value={insights.withSourceUrl} total={insights.total} />
        </div>
      </Card>
      <Card padding="none" className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <BarChart3Icon className="h-4 w-4 text-primary-600" />
          字段完整度
        </div>
        <div className="mt-4 flex items-end gap-2">
          <span className="text-4xl font-semibold tabular-nums text-neutral-950">{insights.fieldCompleteness}%</span>
          <span className="pb-1 text-xs text-neutral-400">按展示字段估算</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full rounded-full bg-primary-600" style={{ width: `${Math.min(100, insights.fieldCompleteness)}%` }} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          缺失字段不会硬造数据，页面会显示“来源平台未提供”或隐藏对应模块。
        </p>
      </Card>
    </section>
  )
}

function ReadinessMetric({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <div className="text-base font-semibold tabular-nums text-neutral-900">
        {value}
        <span className="text-xs font-normal text-neutral-400">/{total}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-neutral-500">{label}</div>
    </div>
  )
}

export function JobBusinessNote() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
      <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
      <p className="text-xs leading-relaxed text-neutral-500">
        页面展示以客户提供的来源数据为准。岗位缺少薪资、职责或要求时不会自动编造；运营侧应优先补齐来源链接、外部编号、同步时间和岗位描述。
      </p>
    </div>
  )
}
