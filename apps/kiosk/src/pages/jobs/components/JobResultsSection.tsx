import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon, QrCodeIcon, StarIcon } from 'lucide-react'
import { isValidSourceUrl } from '../../../lib/url'
import { CATEGORY_LABEL, CATEGORY_STYLE, formatSync } from '../utils/jobDisplay'

export type JobSortMode = 'latest' | 'salary_first'

export function JobResultsSection({
  jobs,
  favoritesOnly,
  listLoading,
  favoriteSet,
  sortMode,
  onSortChange,
  onToggleFavorite,
  onOpen,
}: {
  jobs: ExternalJobDTO[]
  favoritesOnly: boolean
  listLoading: boolean
  favoriteSet: Set<string>
  sortMode: JobSortMode
  onSortChange: (mode: JobSortMode) => void
  onToggleFavorite: (job: ExternalJobDTO) => void
  onOpen: (job: ExternalJobDTO) => void
}) {
  void sortMode
  void onSortChange
  const pageSize = 6
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(jobs.length / pageSize))
  const visibleJobs = useMemo(() => jobs.slice(page * pageSize, page * pageSize + pageSize), [jobs, page])

  useEffect(() => {
    setPage(0)
  }, [jobs])

  return (
    <section className="jf-list">
      {listLoading && <span className="text-xs text-neutral-400">加载中...</span>}

      {jobs.length === 0 ? (
        <EmptyState
          icon={favoritesOnly ? StarIcon : BriefcaseIcon}
          title={favoritesOnly ? '还没有收藏的岗位' : '暂无符合条件的岗位'}
          description={favoritesOnly ? '在岗位卡片上点击星标即可收藏，方便稍后查看' : '请尝试调整关键词、城市、行业、类型或来源机构'}
          className="py-12"
        />
      ) : (
        <>
          {visibleJobs.map((job) => (
            <JobResultCard
              key={job.id}
              job={job}
              favorite={favoriteSet.has(job.id)}
              onToggleFavorite={() => onToggleFavorite(job)}
              onOpen={() => onOpen(job)}
            />
          ))}
          <div className="jf-pager">
            <button type="button" className="jf-btn ghost sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
              <ChevronLeftIcon aria-hidden="true" />
              上一页
            </button>
            <span className="jf-page-ind">第 {page + 1} / {pageCount} 页 · 每页 {pageSize} 条</span>
            <button
              type="button"
              className="jf-btn ghost sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            >
              下一页
              <ChevronRightIcon aria-hidden="true" />
            </button>
          </div>
        </>
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
  const validSource = isValidSourceUrl(job.sourceUrl)
  return (
    <div className="jf-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}>
      <div className="jf-row-main">
        <div className="jf-row-title">
          <b>{job.title}</b>
          <span className="jf-salary">{job.salaryDisplay || '薪资面议'}</span>
          {job.category && <span className={`jf-kind ${CATEGORY_STYLE[job.category]?.includes('success') ? 'teal' : ''}`}>{CATEGORY_LABEL[job.category] ?? job.category}</span>}
        </div>
        <div className="jf-row-info">
          <span><BuildingIcon aria-hidden="true" />{job.company}</span>
          <span><MapPinIcon aria-hidden="true" />{job.city}</span>
          {job.industry && <span>{job.industry}</span>}
          {job.tags[0] && <span>{job.tags[0]}</span>}
        </div>
        <div className="jf-row-sub">
          <span className="jf-chip src">来源 · {job.sourceName}</span>
          <span className="jf-chip">同步 <b>{formatSync(job.syncTime)}</b></span>
          <span className="jf-chip">外部ID <b>{job.externalId}</b></span>
          <span className={`jf-chip ${validSource ? 'ok' : 'warn'}`}>
            {validSource ? (
              <>
                <QrCodeIcon className="h-3 w-3" aria-hidden="true" />
                线上平台 · 可扫码投递
              </>
            ) : '来源链接待补齐'}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorite()
        }}
        aria-pressed={favorite}
        aria-label={favorite ? '取消收藏' : '收藏岗位'}
        className={`jf-fav${favorite ? ' on' : ''}`}
      >
        <StarIcon className={favorite ? 'fill-current' : ''} aria-hidden="true" />
      </button>
      <ChevronRightIcon className="jf-arrow" aria-hidden="true" />
    </div>
  )
}
