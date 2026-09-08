import { useEffect, useMemo, useState } from 'react'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon, StarIcon } from 'lucide-react'
import { CATEGORY_LABEL, CATEGORY_STYLE, formatSync } from '../utils/jobDisplay'
import { evaluateJobSourceTrust } from '../utils/sourceTrust'

export type JobSortMode = 'latest' | 'salary_first'

export function JobResultsSection({
  jobs,
  favoritesOnly,
  hasFilter,
  listLoading,
  favoriteSet,
  sortMode,
  onSortChange,
  onToggleFavorite,
  onOpen,
}: {
  jobs: ExternalJobDTO[]
  favoritesOnly: boolean
  /** 用户是否真的设过筛选（含关键词 / 分类 / 收藏）。决定空态说哪句话。 */
  hasFilter: boolean
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
        <div className="qx-state qx-grow" data-tone="empty">
          <span className="qx-state-ic">{favoritesOnly ? <StarIcon aria-hidden="true" /> : <BriefcaseIcon aria-hidden="true" />}</span>
          <span>
            <span className="qx-state-t">{favoritesOnly ? '还没有收藏的岗位' : hasFilter ? '这组条件下没有已发布的岗位' : '本机暂未上架已审核的岗位'}</span>
            <span className="qx-state-d">{favoritesOnly ? '在岗位行点击收藏，方便稍后查看。' : hasFilter ? '本机不会拿示例岗位把列表填满，请调整关键词、城市、行业、类型或来源机构。' : '来源机构还没有可展示的岗位。本机不会拿示例岗位把列表填满，也不会显示未经审核的来源。'}</span>
          </span>
        </div>
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
  // 列表只承诺进入只读详情；外跳与扫码仍由详情页按四要素 fail-closed。
  const validSource = evaluateJobSourceTrust(job).ok
  return (
    <article
      className={`jf-row${validSource ? '' : ' is-source-blocked'}`}
      aria-label={job.title}
      role="button"
      tabIndex={0}
      data-testid={`job-row-${job.id}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
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
            {validSource ? '来源四要素齐全' : '来源要素待补齐'}
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
      <button
        type="button"
        className="qx-job-view"
        onClick={(event) => {
          // 整卡已经可点，这里不挡冒泡会让一次点击触发两次 onOpen。
          event.stopPropagation()
          onOpen()
        }}
      >
        查看岗位
        <ChevronRightIcon aria-hidden="true" />
      </button>
      {validSource ? null : <span className="qx-job-blocked-note">详情可读，外部入口待来源补全</span>}
    </article>
  )
}
