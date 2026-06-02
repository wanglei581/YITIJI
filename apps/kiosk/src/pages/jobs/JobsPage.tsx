import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import {
  BriefcaseIcon,
  BuildingIcon,
  ClockIcon,
  GraduationCapIcon,
  LayersIcon,
  MapPinIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { getJobs } from '../../services/api'
import {
  buildSourceCards,
  enrichJob,
  REGION_TREE,
  SOURCE_CATEGORY_STYLE,
  type JobCardView,
  type SourceCard,
} from '../../data/jobsMeta'

const ALL_TAGS = ['全部', '全职', '实习', '校招', '兼职']

const TAG_STYLES: Record<string, string> = {
  全职: 'bg-blue-50 text-blue-600',
  实习: 'bg-orange-50 text-orange-600',
  校招: 'bg-green-50 text-green-600',
  兼职: 'bg-purple-50 text-purple-600',
}

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日更新`
}

const SELECT_CLASS =
  'h-14 w-full rounded-lg border border-neutral-300 bg-white px-4 text-base text-neutral-800 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 ' +
  'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400'

interface RegionFilter {
  province: string
  city: string
  district: string
}

const EMPTY_REGION: RegionFilter = { province: '', city: '', district: '' }

export function JobsPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<JobCardView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  // 岗位类型 / 来源机构筛选
  const [activeTag, setActiveTag] = useState('全部')
  const [activeSourceOrg, setActiveSourceOrg] = useState<string | null>(null)

  // 地区三级选择（pending）+ 已确定地区（applied）
  const [pending, setPending] = useState<RegionFilter>(EMPTY_REGION)
  const [appliedRegion, setAppliedRegion] = useState<RegionFilter>(EMPTY_REGION)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getJobs()
      .then((res) => {
        if (cancelled) return
        setJobs(res.data.map(enrichJob))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [retryKey])

  // ── 地区级联选项 ──────────────────────────────────────────────
  const cityOptions = useMemo(
    () => REGION_TREE.find((p) => p.name === pending.province)?.cities ?? [],
    [pending.province],
  )
  const districtOptions = useMemo(
    () => cityOptions.find((c) => c.name === pending.city)?.districts ?? [],
    [cityOptions, pending.city],
  )

  function selectProvince(province: string) {
    setPending({ province, city: '', district: '' })
  }
  function selectCity(city: string) {
    setPending((p) => ({ ...p, city, district: '' }))
  }
  function selectDistrict(district: string) {
    setPending((p) => ({ ...p, district }))
  }
  function applyRegion() {
    setAppliedRegion(pending)
    setActiveSourceOrg(null)
  }
  function resetAll() {
    setPending(EMPTY_REGION)
    setAppliedRegion(EMPTY_REGION)
    setActiveTag('全部')
    setActiveSourceOrg(null)
  }

  // ── 筛选管线 ─────────────────────────────────────────────────
  // 1) 地区 + 类型（来源卡片基于这一层统计，便于切换来源）
  const baseFiltered = useMemo(() => {
    return jobs.filter((job) => {
      if (appliedRegion.province && job.province !== appliedRegion.province) return false
      if (appliedRegion.city && job.city !== appliedRegion.city) return false
      if (appliedRegion.district && job.district !== appliedRegion.district) return false
      if (activeTag !== '全部' && !job.tags.includes(activeTag)) return false
      return true
    })
  }, [jobs, appliedRegion, activeTag])

  const sourceCards = useMemo<SourceCard[]>(() => buildSourceCards(baseFiltered), [baseFiltered])

  // 2) 叠加来源机构筛选 → 推荐岗位
  const recommended = useMemo(
    () => (activeSourceOrg ? baseFiltered.filter((j) => j.sourceOrgId === activeSourceOrg) : baseFiltered),
    [baseFiltered, activeSourceOrg],
  )

  const hasRegionFilter = !!appliedRegion.province
  const regionLabel = [appliedRegion.province, appliedRegion.city, appliedRegion.district]
    .filter((v) => v && v !== appliedRegion.province) // 省份单独显示在 chip 内
    .join(' · ')
  const activeSourceName = sourceCards.find((s) => s.orgId === activeSourceOrg)?.name

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
          本系统仅展示第三方来源岗位信息，不参与招聘流程，请前往来源平台办理
        </p>
      </div>

      {/* ── 主体：可滚动 ─────────────────────────────────── */}
      <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8">
        {loading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState
            message="加载失败，请稍后重试"
            onRetry={() => setRetryKey((k) => k + 1)}
            className="flex-1"
          />
        ) : (
          <>
            {/* ── 地区筛选栏 ─────────────────────────────── */}
            <Card padding="none" className="p-5">
              <div className="flex items-center gap-2">
                <MapPinIcon className="h-5 w-5 text-primary-600" />
                <h2 className="text-base font-semibold text-neutral-900">地区筛选</h2>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <select
                  aria-label="选择省份"
                  className={SELECT_CLASS}
                  value={pending.province}
                  onChange={(e) => selectProvince(e.target.value)}
                >
                  <option value="">全部省份</option>
                  {REGION_TREE.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="选择城市"
                  className={SELECT_CLASS}
                  value={pending.city}
                  disabled={!pending.province}
                  onChange={(e) => selectCity(e.target.value)}
                >
                  <option value="">全部城市</option>
                  {cityOptions.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="选择区县"
                  className={SELECT_CLASS}
                  value={pending.district}
                  disabled={!pending.city}
                  onChange={(e) => selectDistrict(e.target.value)}
                >
                  <option value="">全部区县</option>
                  {districtOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <Button size="lg" className="h-14 w-full" onClick={applyRegion}>
                  确定
                </Button>
              </div>

              {/* 岗位类型 */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm text-neutral-500">岗位类型</span>
                {ALL_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={[
                      'flex min-h-[48px] shrink-0 items-center rounded-full px-5 text-sm font-medium transition-colors',
                      activeTag === tag
                        ? 'bg-primary-600 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                    ].join(' ')}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              {/* 已应用筛选 chips */}
              {(hasRegionFilter || activeTag !== '全部' || activeSourceOrg) && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
                  <span className="text-xs text-neutral-400">当前筛选</span>
                  {hasRegionFilter && (
                    <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                      {appliedRegion.province}
                      {regionLabel ? ` · ${regionLabel}` : ''}
                    </span>
                  )}
                  {activeTag !== '全部' && (
                    <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                      {activeTag}
                    </span>
                  )}
                  {activeSourceName && (
                    <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                      {activeSourceName}
                    </span>
                  )}
                  <button
                    onClick={resetAll}
                    className="ml-auto flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" />
                    重置
                  </button>
                </div>
              )}
            </Card>

            {/* ── 本地信息来源 ───────────────────────────── */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LayersIcon className="h-5 w-5 text-primary-600" />
                  <h2 className="text-base font-semibold text-neutral-900">本地信息来源</h2>
                </div>
                {activeSourceOrg && (
                  <button
                    onClick={() => setActiveSourceOrg(null)}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    查看全部来源
                  </button>
                )}
              </div>

              {sourceCards.length === 0 ? (
                <Card padding="none" className="p-5 text-sm text-neutral-400">
                  当前筛选条件下暂无来源机构
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {sourceCards.map((src) => {
                    const active = activeSourceOrg === src.orgId
                    return (
                      <button
                        key={src.orgId}
                        onClick={() => setActiveSourceOrg(active ? null : src.orgId)}
                        aria-pressed={active}
                        className={[
                          'flex min-h-[120px] flex-col rounded-lg border bg-surface p-4 text-left transition-colors',
                          active
                            ? 'border-primary-500 ring-2 ring-primary-100'
                            : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30',
                        ].join(' ')}
                      >
                        <span
                          className={`mb-2 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${SOURCE_CATEGORY_STYLE[src.category]}`}
                        >
                          {src.category}
                        </span>
                        <p className="line-clamp-2 text-sm font-semibold text-neutral-900">{src.name}</p>
                        <div className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                          <MapPinIcon className="h-3 w-3" />
                          {src.coverage}
                        </div>
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

            {/* ── 推荐岗位 ───────────────────────────────── */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <BriefcaseIcon className="h-5 w-5 text-primary-600" />
                <h2 className="text-base font-semibold text-neutral-900">推荐岗位</h2>
                <span className="text-sm text-neutral-400">共 {recommended.length} 个</span>
              </div>

              {recommended.length === 0 ? (
                <EmptyState
                  icon={BriefcaseIcon}
                  title="暂无符合条件的岗位"
                  description="请尝试调整地区、岗位类型或来源机构"
                  className="py-12"
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {recommended.map((job) => (
                    <Card key={job.id} padding="none" className="flex flex-col p-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-base font-semibold text-neutral-900">
                          {job.title}
                        </p>
                        <span className="shrink-0 text-sm font-semibold text-primary-600">
                          {job.salaryDisplay}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-600">
                        <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        <span className="truncate">{job.company}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span className="flex items-center gap-1">
                          <MapPinIcon className="h-3.5 w-3.5 text-neutral-400" />
                          {job.city}
                          {job.district ? ` · ${job.district}` : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <GraduationCapIcon className="h-3.5 w-3.5 text-neutral-400" />
                          {job.education ?? '学历不限'} · {job.experience ?? '经验不限'}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {job.tags.map((t) => (
                          <span
                            key={t}
                            className={`rounded px-2 py-0.5 text-xs font-medium ${TAG_STYLES[t] ?? 'bg-neutral-100 text-neutral-500'}`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">
                        <span className="truncate">来源：{job.sourceOrgName ?? job.sourceName}</span>
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
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
