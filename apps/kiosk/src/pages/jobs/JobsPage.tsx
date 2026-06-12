import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  Building2Icon,
  BuildingIcon,
  ChevronRightIcon,
  ClockIcon,
  LayersIcon,
  MapPinIcon,
  RotateCcwIcon,
  SearchIcon,
  StarIcon,
} from 'lucide-react'
import { getJobs } from '../../services/api'
import { useFavorites } from '../../favorites/useFavorites'

// 岗位类型 chip → 后端 category 值('' = 全部)
const TYPE_OPTIONS: { label: string; category: string }[] = [
  { label: '全部', category: '' },
  { label: '全职', category: 'fulltime' },
  { label: '实习', category: 'intern' },
  { label: '校招', category: 'campus' },
  { label: '兼职', category: 'parttime' },
]

const CATEGORY_LABEL: Record<string, string> = {
  fulltime: '全职',
  intern: '实习',
  campus: '校招',
  parttime: '兼职',
}

const CATEGORY_STYLE: Record<string, string> = {
  fulltime: 'bg-blue-50 text-blue-600',
  intern: 'bg-orange-50 text-orange-600',
  campus: 'bg-green-50 text-green-600',
  parttime: 'bg-purple-50 text-purple-600',
}

function formatSync(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月${d.getDate()}日更新`
}

const SELECT_CLASS =
  'h-14 w-full rounded-lg border border-neutral-300 bg-white px-4 text-base text-neutral-800 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100'

interface SourceCard {
  orgId: string
  name: string
  jobCount: number
  lastUpdate: string
}

/** 按 sourceOrgId 聚合（来源机构卡片），按岗位数量降序 */
function buildSourceCards(jobs: ExternalJobDTO[]): SourceCard[] {
  const map = new Map<string, SourceCard>()
  for (const job of jobs) {
    const existing = map.get(job.sourceOrgId)
    if (existing) {
      existing.jobCount += 1
      if (job.syncTime > existing.lastUpdate) existing.lastUpdate = job.syncTime
    } else {
      map.set(job.sourceOrgId, {
        orgId: job.sourceOrgId,
        name: job.sourceName,
        jobCount: 1,
        lastUpdate: job.syncTime,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.jobCount - a.jobCount)
}

/** 从全量数据聚合去重的下拉选项（城市 / 行业），按字典序 */
function uniqueSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'zh'))
}

// 首页岗位分类瓦片深链支持：/jobs?category=fulltime|intern|campus|parttime（值须在 TYPE_OPTIONS 内）。
const VALID_CATEGORIES = new Set(['fulltime', 'intern', 'campus', 'parttime'])

export function JobsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { idsOf, toggle: toggleFavorite } = useFavorites()
  const favoriteSet = idsOf('job')

  // facet 集合：全量已发布岗位，用于构建筛选项 + 来源机构卡片（不随筛选变化）
  const [facetJobs, setFacetJobs] = useState<ExternalJobDTO[]>([])
  // 列表集合：按当前筛选条件向后端查询的结果
  const [listJobs, setListJobs] = useState<ExternalJobDTO[]>([])
  const [facetLoading, setFacetLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  // 筛选状态
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [city, setCity] = useState('')
  const [industry, setIndustry] = useState('')
  const [category, setCategory] = useState(() => {
    const c = searchParams.get('category')
    return c && VALID_CATEGORIES.has(c) ? c : ''
  })
  const [sourceOrgId, setSourceOrgId] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  // 同一路由内 search params 变化时同步首页深链筛选，非法值回退「全部」。
  useEffect(() => {
    const c = searchParams.get('category')
    setCategory(c && VALID_CATEGORIES.has(c) ? c : '')
  }, [searchParams])

  // 关键词去抖（300ms）
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300)
    return () => clearTimeout(t)
  }, [keyword])

  // facet 拉取（挂载 + 重试）：一次拉全量已发布岗位
  useEffect(() => {
    let cancelled = false
    setFacetLoading(true)
    setError(null)
    getJobs({ pageSize: 100 })
      .then((res) => {
        if (cancelled) return
        setFacetJobs(res.data)
        setFacetLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('后端服务未连接，请检查 API 服务（VITE_API_MODE=http 需后端在线）')
        setFacetLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retryKey])

  const hasServerFilter = !!(debouncedKeyword || city || industry || category || sourceOrgId)

  // 列表拉取：有任一服务端筛选 → 走后端真实查询；否则复用 facet 全量
  useEffect(() => {
    if (facetLoading) return
    if (!hasServerFilter) {
      setListJobs(facetJobs)
      setListLoading(false)
      return
    }
    let cancelled = false
    setListLoading(true)
    getJobs({
      keyword: debouncedKeyword || undefined,
      city: city || undefined,
      industry: industry || undefined,
      category: category || undefined,
      sourceOrgId: sourceOrgId || undefined,
      pageSize: 100,
    })
      .then((res) => {
        if (cancelled) return
        setListJobs(res.data)
        setListLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('后端服务未连接，请检查 API 服务（VITE_API_MODE=http 需后端在线）')
        setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [facetLoading, facetJobs, hasServerFilter, debouncedKeyword, city, industry, category, sourceOrgId])

  const cityOptions = useMemo(() => uniqueSorted(facetJobs.map((j) => j.city)), [facetJobs])
  const industryOptions = useMemo(() => uniqueSorted(facetJobs.map((j) => j.industry)), [facetJobs])
  const sourceCards = useMemo(() => buildSourceCards(facetJobs), [facetJobs])

  // 收藏过滤（登录态来自服务端、匿名来自本机；叠加在后端列表结果之上）
  const displayed = useMemo(
    () => (favoritesOnly ? listJobs.filter((j) => favoriteSet.has(j.id)) : listJobs),
    [listJobs, favoritesOnly, favoriteSet],
  )

  function resetAll() {
    setKeyword('')
    setDebouncedKeyword('')
    setCity('')
    setIndustry('')
    setCategory('')
    setSourceOrgId('')
    setFavoritesOnly(false)
  }

  const activeSourceName = sourceCards.find((s) => s.orgId === sourceOrgId)?.name
  const hasAnyFilter = hasServerFilter || favoritesOnly

  return (
    <div className="flex h-full flex-col">
      {/* ── 顶部 ─────────────────────────────────────────── */}
      <div className="px-6 pt-6">
        <PageHeader
          title="岗位信息"
          subtitle="来源：第三方平台 · 官方机构"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          本系统仅展示第三方/官方来源岗位信息，不接收简历、不参与招聘流程，请前往来源平台办理
        </p>
      </div>

      {/* ── 主体：可滚动 ─────────────────────────────────── */}
      <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8">
        {facetLoading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
        ) : (
          <>
            {/* ── 筛选栏 ─────────────────────────────────── */}
            <Card padding="none" className="p-5">
              {/* 关键词搜索 */}
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  inputMode="search"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索职位名称、公司或岗位描述"
                  aria-label="关键词搜索"
                  className="h-14 w-full rounded-lg border border-neutral-300 bg-white pl-12 pr-4 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                />
              </div>

              {/* 城市 + 行业 + 重置 */}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <select
                  aria-label="选择城市"
                  className={SELECT_CLASS}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                >
                  <option value="">全部城市</option>
                  {cityOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="选择行业"
                  className={SELECT_CLASS}
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                >
                  <option value="">全部行业</option>
                  {industryOptions.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>

                <Button size="lg" variant="secondary" className="h-14 w-full" onClick={resetAll}>
                  <RotateCcwIcon className="mr-2 h-4 w-4" />
                  重置筛选
                </Button>
              </div>

              {/* 岗位类型 */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm text-neutral-500">岗位类型</span>
                {TYPE_OPTIONS.map((opt) => {
                  const active = category === opt.category
                  return (
                    <button
                      key={opt.label}
                      onClick={() => setCategory(opt.category)}
                      className={[
                        'flex min-h-[48px] shrink-0 items-center rounded-full px-5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary-600 text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>

              {/* 已应用筛选 + 收藏切换 */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
                <button
                  onClick={() => setFavoritesOnly((v) => !v)}
                  aria-pressed={favoritesOnly}
                  className={[
                    'flex min-h-[40px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
                    favoritesOnly
                      ? 'bg-amber-500 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                  ].join(' ')}
                >
                  <StarIcon className={`h-4 w-4 ${favoritesOnly ? 'fill-white' : ''}`} />
                  只看收藏
                  {favoriteSet.size > 0 && <span>({favoriteSet.size})</span>}
                </button>

                {city && <FilterChip text={city} />}
                {industry && <FilterChip text={industry} />}
                {category && <FilterChip text={CATEGORY_LABEL[category] ?? category} />}
                {activeSourceName && <FilterChip text={activeSourceName} />}
                {debouncedKeyword && <FilterChip text={`“${debouncedKeyword}”`} />}

                {hasAnyFilter && (
                  <button
                    onClick={resetAll}
                    className="ml-auto flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" />
                    清空
                  </button>
                )}
              </div>
            </Card>

            {/* ── 找企业 / 企业展示入口（来源企业导览;兼职页不突出企业专区）── */}
            {category !== 'parttime' && (
              <button
                type="button"
                onClick={() => navigate('/companies')}
                className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-5 text-left transition-colors hover:bg-primary-100/60 active:bg-primary-100"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white">
                  <Building2Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-gray-900">找企业 · 企业展示</span>
                  <span className="mt-0.5 block text-xs text-gray-500">按地区 / 类型 / 行业浏览来源企业与岗位，本系统不接收简历</span>
                </span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-primary-400" aria-hidden="true" />
              </button>
            )}

            {/* ── 本地信息来源 ───────────────────────────── */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LayersIcon className="h-5 w-5 text-primary-600" />
                  <h2 className="text-base font-semibold text-neutral-900">信息来源机构</h2>
                </div>
                {sourceOrgId && (
                  <button
                    onClick={() => setSourceOrgId('')}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    查看全部来源
                  </button>
                )}
              </div>

              {sourceCards.length === 0 ? (
                <Card padding="none" className="p-5 text-sm text-neutral-400">
                  暂无来源机构
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {sourceCards.map((src) => {
                    const active = sourceOrgId === src.orgId
                    return (
                      <button
                        key={src.orgId}
                        onClick={() => setSourceOrgId(active ? '' : src.orgId)}
                        aria-pressed={active}
                        className={[
                          'flex min-h-[110px] flex-col rounded-lg border bg-surface p-4 text-left transition-colors',
                          active
                            ? 'border-primary-500 ring-2 ring-primary-100'
                            : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30',
                        ].join(' ')}
                      >
                        <p className="line-clamp-2 text-sm font-semibold text-neutral-900">{src.name}</p>
                        <div className="mt-auto flex items-end justify-between pt-2">
                          <span className="text-sm font-semibold text-primary-600">
                            {src.jobCount}
                            <span className="ml-0.5 text-xs font-normal text-neutral-400">个岗位</span>
                          </span>
                          <span className="text-[11px] text-neutral-400">{formatSync(src.lastUpdate)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            {/* ── 岗位列表 ───────────────────────────────── */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <BriefcaseIcon className="h-5 w-5 text-primary-600" />
                <h2 className="text-base font-semibold text-neutral-900">
                  {favoritesOnly ? '我的收藏' : '岗位列表'}
                </h2>
                <span className="text-sm text-neutral-400">共 {displayed.length} 个</span>
                {listLoading && <span className="text-xs text-neutral-400">加载中…</span>}
              </div>

              {displayed.length === 0 ? (
                <EmptyState
                  icon={favoritesOnly ? StarIcon : BriefcaseIcon}
                  title={favoritesOnly ? '还没有收藏的岗位' : '暂无符合条件的岗位'}
                  description={
                    favoritesOnly
                      ? '在岗位卡片上点击星标即可收藏，方便稍后查看'
                      : '请尝试调整关键词、城市、行业、类型或来源机构'
                  }
                  className="py-12"
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {displayed.map((job) => {
                    const fav = favoriteSet.has(job.id)
                    return (
                      <Card key={job.id} padding="none" className="flex flex-col p-5">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 text-base font-semibold text-neutral-900">{job.title}</p>
                          <button
                            onClick={() => toggleFavorite({ type: 'job', id: job.id, title: job.title })}
                            aria-pressed={fav}
                            aria-label={fav ? '取消收藏' : '收藏岗位'}
                            className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 hover:bg-neutral-100"
                          >
                            <StarIcon
                              className={`h-5 w-5 ${fav ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}`}
                            />
                          </button>
                        </div>

                        <span className="mt-1 text-sm font-semibold text-primary-600">{job.salaryDisplay}</span>

                        <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-600">
                          <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                          <span className="truncate">{job.company}</span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                          <span className="flex items-center gap-1">
                            <MapPinIcon className="h-3.5 w-3.5 text-neutral-400" />
                            {job.city}
                          </span>
                          {job.industry && (
                            <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">
                              {job.industry}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {job.category && (
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[job.category] ?? 'bg-neutral-100 text-neutral-500'}`}
                            >
                              {CATEGORY_LABEL[job.category] ?? job.category}
                            </span>
                          )}
                          {job.tags.map((t) => (
                            <span key={t} className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                              {t}
                            </span>
                          ))}
                        </div>

                        <div className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">
                          <span className="truncate">来源：{job.sourceName}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-1">
                            <ClockIcon className="h-3 w-3" />
                            {formatSync(job.syncTime)}
                          </span>
                        </div>

                        <Button
                          size="md"
                          className="mt-4 w-full"
                          onClick={() => navigate(`/jobs/${job.id}`, { state: { job } })}
                        >
                          查看详情
                        </Button>
                      </Card>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function FilterChip({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">{text}</span>
  )
}
