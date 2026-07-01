import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobAiRecommendationDTO, MemberResumeItem } from '@ai-job-print/shared'
import { getJobs } from '../../services/api'
import {
  getJobAiConsentStatus,
  getJobAiRecommendations,
  grantJobAiConsent,
} from '../../services/api/jobAi'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
import { JobAiConsentModal } from './components/JobAiConsentModal'
import { JobAiEntryPanel } from './components/JobAiEntryPanel'
import { JobAiResultPanel } from './components/JobAiResultPanel'
import { ResumeSelectModal } from './components/ResumeSelectModal'
import {
  DataReadinessPanel,
  JobBusinessNote,
  JobOverviewPanel,
  SourceInstitutionPanel,
  TopTagsPanel,
  CompanyGuideEntry,
} from './components/JobListInsights'
import { JobFilterAssistant } from './components/JobFilterAssistant'
import { JobResultsSection } from './components/JobResultsSection'
import { buildJobInsights, buildSourceCards, buildTopTags, uniqueSorted } from './utils/jobDisplay'

const VALID_CATEGORIES = new Set(['fulltime', 'intern', 'campus', 'parttime'])

export function JobsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const categoryParam = searchParams.get('category')
  const sourceOrgIdParam = searchParams.get('sourceOrgId')?.trim() ?? ''
  const { getToken } = useAuth()
  const { idsOf, toggle: toggleFavorite } = useFavorites()
  const favoriteSet = idsOf('job')

  const [facetJobs, setFacetJobs] = useState<ExternalJobDTO[]>([])
  const [listJobs, setListJobs] = useState<ExternalJobDTO[]>([])
  const [facetTotal, setFacetTotal] = useState(0)
  const [listTotal, setListTotal] = useState(0)
  const [facetLoading, setFacetLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [city, setCity] = useState('')
  const [industry, setIndustry] = useState('')
  const [category, setCategory] = useState(() => {
    return categoryParam && VALID_CATEGORIES.has(categoryParam) ? categoryParam : ''
  })
  const [sourceOrgId, setSourceOrgId] = useState(() => sourceOrgIdParam)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showConsent, setShowConsent] = useState(false)
  const [showResumeSelect, setShowResumeSelect] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiRecommendations, setAiRecommendations] = useState<JobAiRecommendationDTO[] | null>(null)
  const mountedRef = useRef(false)
  const aiInFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setCategory(categoryParam && VALID_CATEGORIES.has(categoryParam) ? categoryParam : '')
  }, [categoryParam])

  useEffect(() => {
    setSourceOrgId(sourceOrgIdParam)
  }, [sourceOrgIdParam])

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
        setFacetTotal(res.pagination.total)
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
      setListTotal(facetTotal)
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
        setListTotal(res.pagination.total)
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
  }, [facetLoading, facetJobs, facetTotal, hasServerFilter, debouncedKeyword, city, industry, category, sourceOrgId])

  const cityOptions = useMemo(() => uniqueSorted(facetJobs.map((job) => job.city)), [facetJobs])
  const industryOptions = useMemo(() => uniqueSorted(facetJobs.map((job) => job.industry)), [facetJobs])
  const sourceCards = useMemo(() => buildSourceCards(facetJobs), [facetJobs])
  const topTags = useMemo(() => buildTopTags(facetJobs), [facetJobs])

  const displayedJobs = useMemo(
    () => (favoritesOnly ? listJobs.filter((job) => favoriteSet.has(job.id)) : listJobs),
    [listJobs, favoritesOnly, favoriteSet],
  )

  const insightJobs = hasServerFilter ? listJobs : facetJobs
  const insightTotal = hasServerFilter ? listTotal : facetTotal
  const insights = useMemo(() => buildJobInsights(insightJobs, insightTotal), [insightJobs, insightTotal])
  const activeSourceName = sourceCards.find((source) => source.orgId === sourceOrgId)?.name ?? (sourceOrgId ? '指定来源机构' : undefined)
  const hasAnyFilter = hasServerFilter || favoritesOnly
  const aiRecommendationMode = aiRecommendations !== null

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

  function requireToken(): string | null {
    const token = getToken()
    if (!token) {
      navigate('/login', { state: { from: '/jobs' } })
      return null
    }
    return token
  }

  async function startAiRecommend() {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token) return
    aiInFlightRef.current = true
    setAiError(null)
    try {
      const rows = await getJobAiConsentStatus(token)
      if (!mountedRef.current) return
      if (rows.some((row) => row.scope === 'job_ai' && row.granted)) setShowResumeSelect(true)
      else setShowConsent(true)
    } catch (err) {
      if (!mountedRef.current) return
      setAiError(formatJobAiError(err))
    } finally {
      aiInFlightRef.current = false
    }
  }

  async function confirmConsent() {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token) return
    aiInFlightRef.current = true
    setAiLoading(true)
    setAiError(null)
    try {
      await grantJobAiConsent(token)
      if (!mountedRef.current) return
      setShowConsent(false)
      setShowResumeSelect(true)
    } catch (err) {
      if (!mountedRef.current) return
      setAiError(formatJobAiError(err))
    } finally {
      aiInFlightRef.current = false
      if (mountedRef.current) setAiLoading(false)
    }
  }

  async function runAiRecommend(resume: MemberResumeItem) {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token) return
    aiInFlightRef.current = true
    setShowResumeSelect(false)
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await getJobAiRecommendations(token, {
        resumeTaskId: resume.taskId,
        intent: {
          targetTitle: debouncedKeyword || undefined,
          city: city || undefined,
          industry: industry || undefined,
          keywords: topTags.slice(0, 4).map((tag) => tag.label),
        },
        filters: {
          city: city || undefined,
          category: category || undefined,
          sourceOrgId: sourceOrgId || undefined,
        },
        limit: 6,
      })
      if (!mountedRef.current) return
      setAiRecommendations(res.recommendations)
    } catch (err) {
      if (!mountedRef.current) return
      if (err instanceof ApiHttpError && err.code === 'USER_AI_CONSENT_REQUIRED') setShowConsent(true)
      setAiError(formatJobAiError(err))
    } finally {
      aiInFlightRef.current = false
      if (mountedRef.current) setAiLoading(false)
    }
  }

  function clearAiRecommendations() {
    setAiRecommendations(null)
    setAiError(null)
  }

  return (
    <div className="flex h-full flex-col">
      <JobAiConsentModal
        open={showConsent}
        loading={aiLoading}
        error={showConsent ? aiError : null}
        onConfirm={() => void confirmConsent()}
        onCancel={() => setShowConsent(false)}
      />
      <ResumeSelectModal
        open={showResumeSelect}
        token={getToken()}
        onClose={() => setShowResumeSelect(false)}
        onSelect={(resume) => void runAiRecommend(resume)}
        onUpload={() => navigate('/resume/source?intent=diagnose')}
      />
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
            <JobAiEntryPanel
              title="AI岗位推荐"
              clearLabel="退出 AI 推荐"
              loading={aiLoading}
              hasResult={Boolean(aiRecommendations || aiError)}
              onStart={() => void startAiRecommend()}
              onClear={clearAiRecommendations}
            />

            <JobOverviewPanel insights={insights} displayedCount={displayedJobs.length} />

            {(aiLoading || aiError || aiRecommendations) && (
              <JobAiResultPanel
                title="AI岗位推荐"
                loading={aiLoading}
                error={aiError}
                recommendations={aiRecommendations ?? undefined}
                clearLabel="退出 AI 推荐"
                onRetry={() => void startAiRecommend()}
                onClear={clearAiRecommendations}
                onOpenRecommendation={(jobId) => navigate(`/jobs/${jobId}`)}
              />
            )}

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

            <JobBusinessNote />

            {category !== 'parttime' && <CompanyGuideEntry onOpen={() => navigate('/companies')} />}

            {!aiRecommendationMode && (
              <JobResultsSection
                jobs={displayedJobs}
                favoritesOnly={favoritesOnly}
                listLoading={listLoading}
                favoriteSet={favoriteSet}
                onToggleFavorite={(job) => toggleFavorite({ type: 'job', id: job.id, title: job.title })}
                onOpen={(job) => navigate(`/jobs/${job.id}`, { state: { job } })}
              />
            )}

            <SourceInstitutionPanel sources={sourceCards} activeSourceOrgId={sourceOrgId} onSelect={setSourceOrgId} />

            <TopTagsPanel tags={topTags} onSelect={selectTag} />

            <DataReadinessPanel insights={insights} />
          </>
        )}
      </div>
    </div>
  )
}

function formatJobAiError(err: unknown): string {
  if (err instanceof ApiHttpError) {
    if (err.code === 'JOB_AI_QUOTA_EXCEEDED') return '今日 AI 辅助额度已用完，请明天再试。'
    if (err.code === 'JOB_AI_QUOTA_UNAVAILABLE') return '岗位 AI 配额服务暂不可用，请联系现场工作人员确认服务状态。'
    if (err.code === 'USER_AI_CONSENT_REQUIRED') return '请先确认岗位 AI 辅助授权。'
    if (err.code === 'JOB_AI_MOCK_DISABLED') return '岗位 AI 需要连接真实后端服务后使用。'
    return err.message
  }
  return err instanceof Error ? err.message : 'AI 辅助暂时不可用，请稍后重试。'
}
