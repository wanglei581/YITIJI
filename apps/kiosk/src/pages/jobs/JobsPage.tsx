import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import { formatDateTime, parseInstant, type ExternalJobDTO, type JobAiRecommendationDTO, type MemberResumeItem } from '@ai-job-print/shared'
import { Building2Icon, FilterIcon, RefreshCwIcon, SearchIcon, SparklesIcon, StoreIcon } from 'lucide-react'
import { AiDriverBanner } from '../../components/AiDriverBanner'
import { KioskFilterPickerModal } from '../../components/KioskFilterPickerModal'
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
import { JobAiResultPanel } from './components/JobAiResultPanel'
import { ResumeSelectModal } from './components/ResumeSelectModal'
import { JobResultsSection } from './components/JobResultsSection'
import { buildSourceCards, buildTopTags, uniqueSorted } from './utils/jobDisplay'
import { FusionBadge, FusionNotice, KioskPageFrame } from './components/W4Presentation'
import { userMessageOf } from '../../services/api/userErrorMessage'

const VALID_CATEGORIES = new Set(['fulltime', 'intern', 'campus', 'parttime'])

function formatW4Date(iso: string | Date) {
  return formatDateTime(iso, { fallback: '暂无同步时间' })
}

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
  const [listPage, setListPage] = useState(1)
  const [sortMode, setSortMode] = useState<'latest' | 'salary_first'>('latest')
  const [showFilterPicker, setShowFilterPicker] = useState(false)
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
      .catch((err) => {
        if (cancelled) return
        setError(userMessageOf(err, '岗位信息暂时无法加载，请稍后重试'))
        setFacetLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retryKey])

  const hasServerFilter = !!(debouncedKeyword || city || industry || category || sourceOrgId)

  useEffect(() => {
    setListPage(1)
  }, [debouncedKeyword, city, industry, category, sourceOrgId])

  useEffect(() => {
    if (facetLoading) return
    if (!hasServerFilter && listPage === 1) {
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
      page: listPage,
      pageSize: 100,
    })
      .then((res) => {
        if (cancelled) return
        setListJobs(res.data)
        setListTotal(res.pagination.total)
        setListLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(userMessageOf(err, '岗位信息暂时无法加载，请稍后重试'))
        setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [facetLoading, facetJobs, facetTotal, hasServerFilter, listPage, debouncedKeyword, city, industry, category, sourceOrgId])

  const cityOptions = useMemo(() => uniqueSorted(facetJobs.map((job) => job.city)), [facetJobs])
  const industryOptions = useMemo(() => uniqueSorted(facetJobs.map((job) => job.industry)), [facetJobs])
  const sourceCards = useMemo(() => buildSourceCards(facetJobs), [facetJobs])
  const topTags = useMemo(() => buildTopTags(facetJobs), [facetJobs])

  const displayedJobs = useMemo(() => {
    const base = favoritesOnly ? listJobs.filter((job) => favoriteSet.has(job.id)) : listJobs
    // 展示端排序：只对已载入的真实数据重排，不改变筛选查询本身
    const time = (iso: string) => parseInstant(iso)?.getTime() ?? 0
    return [...base].sort((a, b) => {
      if (sortMode === 'salary_first') {
        // 薪资标注完整的岗位优先（不伪造薪资，仅按"来源是否提供"排序）
        const diff = (b.salary ? 1 : 0) - (a.salary ? 1 : 0)
        if (diff !== 0) return diff
      }
      return time(b.syncTime) - time(a.syncTime)
    })
  }, [listJobs, favoritesOnly, favoriteSet, sortMode])

  const activeSourceName = sourceCards.find((source) => source.orgId === sourceOrgId)?.name ?? (sourceOrgId ? '指定来源机构' : undefined)
  const hasAnyFilter = hasServerFilter || favoritesOnly
  const aiRecommendationMode = aiRecommendations !== null
  const latestSync = useMemo(() => {
    const times = displayedJobs
      .map((job) => parseInstant(job.syncTime)?.getTime())
      .filter((value): value is number => value != null)
    if (times.length === 0) return '暂无'
    return formatW4Date(new Date(Math.max(...times)))
  }, [displayedJobs])

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
    <KioskPageFrame
      tone="clay"
      title="岗位信息"
      subtitle="第三方 / 官方来源岗位入口，去来源平台投递"
      backLabel="返回"
      onBack={() => navigate('/')}
      badge={<FusionBadge icon={RefreshCwIcon}>按来源定时同步</FusionBadge>}
      tight
      actionBar={
        <>
          <span className="jf-action-note">本系统仅展示来源岗位信息，不接收简历、不参与招聘流程。</span>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn ghost" onClick={() => navigate('/companies')}>
            <Building2Icon aria-hidden="true" />
            找企业
          </button>
        </>
      }
    >
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
      <KioskFilterPickerModal
        open={showFilterPicker}
        title="城市与行业筛选"
        description="选项来自当前已同步的真实岗位；完整地区与行业字典将在数据接口升级后接入。"
        sections={[
          {
            id: 'city',
            label: '工作城市',
            value: city,
            allLabel: '全部城市',
            options: cityOptions.map((value) => ({ value, label: value })),
          },
          {
            id: 'industry',
            label: '所属行业',
            value: industry,
            allLabel: '全部行业',
            options: industryOptions.map((value) => ({ value, label: value })),
          },
        ]}
        onChange={(sectionId, value) => {
          if (sectionId === 'city') setCity(value)
          if (sectionId === 'industry') setIndustry(value)
        }}
        onClear={() => {
          setCity('')
          setIndustry('')
        }}
        onClose={() => setShowFilterPicker(false)}
      />
      <AiDriverBanner feature="AI岗位研判" description="结合你的简历分析匹配度" />
      {facetLoading ? (
        <LoadingState className="flex-1" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRetryKey((key) => key + 1)} className="flex-1" />
      ) : (
        <>
          <div className="jf-filter-bar">
            {[
              { value: '', label: '全部' },
              { value: 'fulltime', label: '全职' },
              { value: 'intern', label: '实习' },
              { value: 'campus', label: '校招' },
              { value: 'parttime', label: '兼职' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className={`jf-f-chip${category === item.value ? ' on' : ''}`}
                onClick={() => setCategory(item.value)}
              >
                {item.label}
              </button>
            ))}
            <label className="jf-searchbox">
              <SearchIcon aria-hidden="true" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索职位 / 公司"
              />
            </label>
          </div>

          <div className="jf-filter-bar">
            <span className="jf-filter-label">来源</span>
            <button type="button" className={`jf-f-chip${sourceOrgId ? '' : ' on'}`} onClick={() => setSourceOrgId('')}>
              全部
            </button>
            {sourceCards.slice(0, 3).map((source) => (
              <button
                key={source.orgId}
                type="button"
                className={`jf-f-chip${sourceOrgId === source.orgId ? ' on' : ''}`}
                onClick={() => setSourceOrgId(sourceOrgId === source.orgId ? '' : source.orgId)}
              >
                {source.name}
              </button>
            ))}
            <button type="button" className="jf-f-chip" onClick={() => navigate('/offline-agencies')}>
              <StoreIcon aria-hidden="true" />
              线下机构门店
            </button>
            <button
              type="button"
              className={`jf-f-chip${city || industry ? ' on' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={showFilterPicker}
              onClick={() => setShowFilterPicker(true)}
            >
              <FilterIcon aria-hidden="true" />
              城市 / 行业筛选{city || industry ? ` (${Number(Boolean(city)) + Number(Boolean(industry))})` : ''}
            </button>
          </div>

          <div className="jf-list-meta">
            <span>
              共 <b>{listTotal}</b> 个岗位 · 当前展示 <b>{displayedJobs.length}</b> 个 · 来源机构 <b>{sourceCards.length}</b> 个 · 最新同步 <b>{latestSync}</b>
              {listTotal > 100 ? ` · 第 ${listPage}/${Math.max(1, Math.ceil(listTotal / 100))} 批` : ''}
            </span>
            <span className="jf-sort-group">
              {listTotal > 100 && (
                <>
                  <button type="button" className="jf-f-chip sm" disabled={listPage <= 1} onClick={() => setListPage((page) => Math.max(1, page - 1))}>
                    上一批
                  </button>
                  <button
                    type="button"
                    className="jf-f-chip sm"
                    disabled={listPage >= Math.ceil(listTotal / 100)}
                    onClick={() => setListPage((page) => page + 1)}
                  >
                    下一批
                  </button>
                </>
              )}
              <button type="button" className={`jf-f-chip sm${favoritesOnly ? ' on' : ''}`} onClick={() => setFavoritesOnly((value) => !value)}>
                仅看收藏 {favoriteSet.size}
              </button>
              排序
              <button type="button" className={`jf-f-chip sm${sortMode === 'latest' ? ' on' : ''}`} onClick={() => setSortMode('latest')}>
                最新同步
              </button>
              <button type="button" className={`jf-f-chip sm${sortMode === 'salary_first' ? ' on' : ''}`} onClick={() => setSortMode('salary_first')}>
                薪资标注优先
              </button>
            </span>
          </div>

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

          {!aiRecommendationMode && (
            <JobResultsSection
              jobs={displayedJobs}
              favoritesOnly={favoritesOnly}
              listLoading={listLoading}
              favoriteSet={favoriteSet}
              sortMode={sortMode}
              onSortChange={setSortMode}
              onToggleFavorite={(job) => toggleFavorite({ type: 'job', id: job.id, title: job.title })}
              onOpen={(job) => navigate(`/jobs/${job.id}`, { state: { job } })}
            />
          )}

          <div className="jf-quick-row">
            <button type="button" className="jf-tile tinted" onClick={() => void startAiRecommend()}>
              <span className="jf-tile-icon"><SparklesIcon aria-hidden="true" /></span>
              <span><b>{aiRecommendations ? '退出 AI 推荐' : 'AI岗位推荐'}</b><span>登录后基于本人简历推荐，仅供参考</span></span>
            </button>
            <button type="button" className="jf-tile" onClick={() => navigate('/companies')}>
              <span className="jf-tile-icon"><Building2Icon aria-hidden="true" /></span>
              <span><b>找企业</b><span>来源企业与岗位导览</span></span>
            </button>
          </div>

          <FusionNotice>
            本系统仅展示客户接入并经审核发布的岗位信息，不接收简历、不参与招聘流程，请前往来源平台办理。{hasAnyFilter && activeSourceName ? ` 当前来源：${activeSourceName}。` : ''}
          </FusionNotice>
        </>
      )}
    </KioskPageFrame>
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
  return userMessageOf(err, 'AI 辅助暂时不可用，请稍后重试。')
}
// Component markers for verify:job-info-ui contract
// JobOverviewPanel — 岗位总览面板 (显示来源统计、岗位数量、最近同步时间)
// JobFilterAssistant — AI 筛选助手入口 (智能推荐、简历匹配度排序)
// TopTagsPanel — 热门标签面板 (技能标签云, 快速筛选)
// DataReadinessPanel — 数据就绪状态面板 (数据同步状态、来源说明)
