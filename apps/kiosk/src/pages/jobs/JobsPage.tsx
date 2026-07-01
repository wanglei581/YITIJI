import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { getJobs } from '../../services/api'
import { useFavorites } from '../../favorites/useFavorites'
import {
  JobBusinessNote,
  JobOverviewPanel,
  SourceInstitutionPanel,
  TopTagsPanel,
  CompanyGuideEntry,
  DataReadinessPanel,
} from './components/JobListInsights'
import { JobFilterAssistant } from './components/JobFilterAssistant'
import { JobResultsSection } from './components/JobResultsSection'
import { buildJobInsights, buildSourceCards, buildTopTags, uniqueSorted } from './utils/jobDisplay'

const VALID_CATEGORIES = new Set(['fulltime', 'intern', 'campus', 'parttime'])

export function JobsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { idsOf, toggle: toggleFavorite } = useFavorites()
  const favoriteSet = idsOf('job')

  const [facetJobs, setFacetJobs] = useState<ExternalJobDTO[]>([])
  const [listJobs, setListJobs] = useState<ExternalJobDTO[]>([])
  const [facetLoading, setFacetLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [city, setCity] = useState('')
  const [industry, setIndustry] = useState('')
  const [category, setCategory] = useState(() => {
    const value = searchParams.get('category')
    return value && VALID_CATEGORIES.has(value) ? value : ''
  })
  const [sourceOrgId, setSourceOrgId] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  useEffect(() => {
    const value = searchParams.get('category')
    setCategory(value && VALID_CATEGORIES.has(value) ? value : '')
  }, [searchParams])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300)
    return () => clearTimeout(timer)
  }, [keyword])

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

  const cityOptions = useMemo(() => uniqueSorted(facetJobs.map((job) => job.city)), [facetJobs])
  const industryOptions = useMemo(() => uniqueSorted(facetJobs.map((job) => job.industry)), [facetJobs])
  const sourceCards = useMemo(() => buildSourceCards(facetJobs), [facetJobs])
  const topTags = useMemo(() => buildTopTags(facetJobs), [facetJobs])
  const insights = useMemo(() => buildJobInsights(facetJobs), [facetJobs])

  const displayedJobs = useMemo(
    () => (favoritesOnly ? listJobs.filter((job) => favoriteSet.has(job.id)) : listJobs),
    [listJobs, favoritesOnly, favoriteSet],
  )

  const activeSourceName = sourceCards.find((source) => source.orgId === sourceOrgId)?.name
  const hasAnyFilter = hasServerFilter || favoritesOnly

  function resetAll() {
    setKeyword('')
    setDebouncedKeyword('')
    setCity('')
    setIndustry('')
    setCategory('')
    setSourceOrgId('')
    setFavoritesOnly(false)
  }

  function selectTag(tag: string) {
    if (industryOptions.includes(tag)) {
      setIndustry(tag)
      return
    }
    setKeyword(tag)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="岗位信息"
          subtitle="第三方 / 官方来源岗位入口"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          本系统仅展示客户接入并经审核发布的岗位信息，不接收简历、不参与招聘流程，请前往来源平台办理。
        </p>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8">
        {facetLoading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryKey((key) => key + 1)} className="flex-1" />
        ) : (
          <>
            <JobOverviewPanel insights={insights} displayedCount={displayedJobs.length} />

            <JobFilterAssistant
              keyword={keyword}
              city={city}
              industry={industry}
              category={category}
              favoritesOnly={favoritesOnly}
              cityOptions={cityOptions}
              industryOptions={industryOptions}
              favoriteCount={favoriteSet.size}
              activeSourceName={activeSourceName}
              debouncedKeyword={debouncedKeyword}
              hasAnyFilter={hasAnyFilter}
              onKeywordChange={setKeyword}
              onCityChange={setCity}
              onIndustryChange={setIndustry}
              onCategoryChange={setCategory}
              onToggleFavorites={() => setFavoritesOnly((value) => !value)}
              onReset={resetAll}
            />

            {category !== 'parttime' && <CompanyGuideEntry onOpen={() => navigate('/companies')} />}

            <SourceInstitutionPanel sources={sourceCards} activeSourceOrgId={sourceOrgId} onSelect={setSourceOrgId} />

            <TopTagsPanel tags={topTags} onSelect={selectTag} />

            <DataReadinessPanel insights={insights} />

            <JobBusinessNote />

            <JobResultsSection
              jobs={displayedJobs}
              favoritesOnly={favoritesOnly}
              listLoading={listLoading}
              favoriteSet={favoriteSet}
              onToggleFavorite={(job) => toggleFavorite({ type: 'job', id: job.id, title: job.title })}
              onOpen={(job) => navigate(`/jobs/${job.id}`, { state: { job } })}
            />
          </>
        )}
      </div>
    </div>
  )
}
