import { Button, Card, EmptyState } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, ClockIcon, MapPinIcon, StarIcon } from 'lucide-react'
import { CATEGORY_LABEL, CATEGORY_STYLE, formatSync } from '../utils/jobDisplay'

export function JobResultsSection({
  jobs,
  favoritesOnly,
  listLoading,
  favoriteSet,
  onToggleFavorite,
  onOpen,
}: {
  jobs: ExternalJobDTO[]
  favoritesOnly: boolean
  listLoading: boolean
  favoriteSet: Set<string>
  onToggleFavorite: (job: ExternalJobDTO) => void
  onOpen: (job: ExternalJobDTO) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <BriefcaseIcon className="h-5 w-5 text-primary-600" />
        <h2 className="text-base font-semibold text-neutral-900">{favoritesOnly ? '我的收藏' : '岗位列表'}</h2>
        <span className="text-sm text-neutral-400">共 {jobs.length} 个</span>
        {listLoading && <span className="text-xs text-neutral-400">加载中...</span>}
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          icon={favoritesOnly ? StarIcon : BriefcaseIcon}
          title={favoritesOnly ? '还没有收藏的岗位' : '暂无符合条件的岗位'}
          description={favoritesOnly ? '在岗位卡片上点击星标即可收藏，方便稍后查看' : '请尝试调整关键词、城市、行业、类型或来源机构'}
          className="py-12"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <JobResultCard
              key={job.id}
              job={job}
              favorite={favoriteSet.has(job.id)}
              onToggleFavorite={() => onToggleFavorite(job)}
              onOpen={() => onOpen(job)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function JobResultCard({
  job,
  favorite,
  onToggleFavorite,
  onOpen,
}: {
  job: ExternalJobDTO
  favorite: boolean
  onToggleFavorite: () => void
  onOpen: () => void
}) {
  return (
    <Card padding="none" className="flex min-h-[286px] flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-base font-semibold leading-snug text-neutral-900">{job.title}</p>
        <button
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? '取消收藏' : '收藏岗位'}
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 hover:bg-neutral-100"
        >
          <StarIcon className={`h-5 w-5 ${favorite ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}`} />
        </button>
      </div>

      <span className="mt-2 text-sm font-semibold text-primary-600">{job.salaryDisplay || '薪资面议'}</span>

      <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-600">
        <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <span className="truncate">{job.company}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <MapPinIcon className="h-3.5 w-3.5 text-neutral-400" />
          {job.city}
        </span>
        {job.industry && <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">{job.industry}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {job.category && (
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[job.category] ?? 'bg-neutral-100 text-neutral-500'}`}>
            {CATEGORY_LABEL[job.category] ?? job.category}
          </span>
        )}
        {job.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
            {tag}
          </span>
        ))}
      </div>

      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-neutral-500">
        {job.description || job.requirements || '来源平台暂未提供岗位描述，建议进入详情查看来源信息。'}
      </p>

      <div className="mt-auto flex items-center gap-1.5 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">
        <span className="truncate">来源：{job.sourceName}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <ClockIcon className="h-3 w-3" />
          {formatSync(job.syncTime)}
        </span>
      </div>

      <Button size="md" className="mt-4 w-full" onClick={onOpen}>
        查看详情
      </Button>
    </Card>
  )
}
