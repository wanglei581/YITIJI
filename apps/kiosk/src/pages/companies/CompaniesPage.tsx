// ============================================================
// 找企业 / 企业展示页（/companies）。
//
// 合规定位（长期红线）：企业展示 = 来源企业与岗位导览，不是招聘平台。
// - 只展示后端「已审核 + 已发布」企业；列表/统计/筛选项全部来自真实接口，
//   本页没有任何写死的企业、岗位数、城市统计。
// - 不收简历、无平台内投递；投递引导一律在岗位详情走「去来源平台投递」。
// 竖屏 21.5 寸触控（810×1440）：2 列卡片、按钮 ≥48px。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import {
  COMPANY_INDUSTRIES,
  COMPANY_SOURCE_KINDS,
  COMPANY_TYPES,
  type CompanyCardDTO,
  type CompanyFiltersDTO,
  type CompanyStatsDTO,
} from '@ai-job-print/shared'
import {
  Building2Icon,
  BuildingIcon,
  ChevronRightIcon,
  InfoIcon,
  Loader2Icon,
  MapPinIcon,
  SearchIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { getCompanies, getCompanyFilters, getCompanyStats, type CompanyQuery } from '../../services/api/companies'

const PAGE_SIZE = 10

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  fulltime: '社招', campus: '校招', intern: '实习', parttime: '兼职', fair: '招聘会参展',
}

function labelOfType(v: string | null): string | null {
  return v ? (COMPANY_TYPES as Record<string, string>)[v] ?? null : null
}
function labelOfIndustry(v: string | null): string | null {
  return v ? (COMPANY_INDUSTRIES as Record<string, string>)[v] ?? null : null
}

// ─── 筛选 chip 行 ───────────────────────────────────────────────────────────

function ChipRow({
  label, options, active, onChange,
}: {
  label: string
  options: { value: string; text: string }[]
  active: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-2.5 shrink-0 text-xs font-medium text-gray-400">{label}</span>
      <div className="flex flex-1 flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange('')}
          className={[
            'min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors',
            active === '' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          ].join(' ')}
        >
          不限
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active === o.value ? '' : o.value)}
            className={[
              'min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors',
              active === o.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ].join(' ')}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── 企业卡片 ───────────────────────────────────────────────────────────────

function CompanyCard({ company, onDetail, onJobs }: {
  company: CompanyCardDTO
  onDetail: () => void
  onJobs: () => void
}) {
  const typeLabel = labelOfType(company.companyType)
  const industryLabel = labelOfIndustry(company.industry)
  const region = [company.province, company.city, company.district].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {company.logoUrl ? (
          <img src={company.logoUrl} alt={`${company.name} logo`} className="h-12 w-12 shrink-0 rounded-lg border border-gray-100 object-cover" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <BuildingIcon className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-gray-900">{company.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {typeLabel && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">{typeLabel}</span>}
            {industryLabel && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{industryLabel}</span>}
            {company.fairParticipant && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">招聘会参展</span>}
          </div>
        </div>
        {company.openJobCount > 0 && (
          <span className="shrink-0 text-xs font-medium text-primary-600">{company.openJobCount} 个来源岗位</span>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        来源：{company.sourceName}
        {region && <span className="ml-2 inline-flex items-center gap-0.5"><MapPinIcon className="h-3 w-3" aria-hidden="true" />{region}</span>}
      </p>
      {company.description && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-600">{company.description}</p>
      )}
      {company.repJobTitles.length > 0 && (
        <p className="mt-1.5 truncate text-xs text-gray-500">代表岗位：{company.repJobTitles.join('、')}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDetail}
          className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-lg border border-primary-200 bg-white text-sm font-semibold text-primary-600 active:bg-primary-50"
        >
          查看企业
        </button>
        <button
          type="button"
          onClick={onJobs}
          disabled={company.openJobCount === 0}
          className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-lg bg-primary-600 text-sm font-semibold text-white active:bg-primary-700 disabled:bg-gray-200 disabled:text-gray-400"
        >
          查看来源岗位
        </button>
      </div>
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function CompaniesPage() {
  const navigate = useNavigate()

  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [companyType, setCompanyType] = useState('')
  const [industry, setIndustry] = useState('')
  const [recruitType, setRecruitType] = useState('')
  const [sourceKind, setSourceKind] = useState('')

  const [filters, setFilters] = useState<CompanyFiltersDTO | null>(null)
  const [stats, setStats] = useState<CompanyStatsDTO | null>(null)
  const [items, setItems] = useState<CompanyCardDTO[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const gen = useRef(0)

  // 搜索去抖
  useEffect(() => {
    const t = setTimeout(() => setKeyword(keywordInput.trim()), 300)
    return () => clearTimeout(t)
  }, [keywordInput])

  const query: Omit<CompanyQuery, 'cursor' | 'pageSize'> = useMemo(
    () => ({ keyword, province, city, district, companyType, industry, recruitType, sourceKind }),
    [keyword, province, city, district, companyType, industry, recruitType, sourceKind],
  )

  const load = useCallback(() => {
    const g = ++gen.current
    setState('loading')
    Promise.all([
      getCompanies({ ...query, pageSize: PAGE_SIZE }),
      getCompanyStats(query),
      filters ? Promise.resolve(filters) : getCompanyFilters(),
    ])
      .then(([page, st, f]) => {
        if (g !== gen.current) return
        setItems(page.items)
        setTotal(page.total)
        setNextCursor(page.nextCursor)
        setStats(st)
        setFilters(f)
        setState('ready')
      })
      .catch(() => {
        if (g === gen.current) setState('error')
      })
    // filters 只需拉一次，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => { load() }, [load])

  const loadMore = () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    getCompanies({ ...query, cursor: nextCursor, pageSize: PAGE_SIZE })
      .then((page) => {
        setItems((prev) => [...prev, ...page.items])
        setTotal(page.total)
        setNextCursor(page.nextCursor)
      })
      .catch(() => { /* 翻页失败保留游标可重点 */ })
      .finally(() => setLoadingMore(false))
  }

  // 地区联动选项（只来自真实数据）
  const provinceOpts = filters?.regions.map((r) => r.province) ?? []
  const cityOpts = filters?.regions.find((r) => r.province === province)?.cities.map((c) => c.city) ?? []
  const districtOpts = filters?.regions.find((r) => r.province === province)?.cities.find((c) => c.city === city)?.districts ?? []

  const typeOpts = (filters?.companyTypes ?? []).map((v) => ({ value: v, text: labelOfType(v) ?? v }))
  const industryOpts = (filters?.industries ?? []).map((v) => ({ value: v, text: labelOfIndustry(v) ?? v }))
  const sourceOpts = (filters?.sourceKinds ?? []).map((v) => ({ value: v, text: (COMPANY_SOURCE_KINDS as Record<string, string>)[v] ?? v }))
  const recruitOpts = Object.entries(RECRUIT_TYPE_LABEL).map(([value, text]) => ({ value, text }))

  const regionSelect = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    options: string[],
    disabled = false,
  ) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={placeholder}
      className="min-h-[48px] flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="找企业"
        subtitle="企业展示 · 来源岗位导览"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/jobs')}>
            返回岗位信息
          </Button>
        }
      />

      {/* 搜索 */}
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4">
        <SearchIcon className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
        <input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          placeholder="搜索企业名称、岗位关键词…"
          className="min-h-[52px] flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-300"
        />
      </div>

      {/* 地区（选项只来自真实已发布企业） */}
      <div className="flex gap-2">
        {regionSelect(province, (v) => { setProvince(v); setCity(''); setDistrict('') }, '全部省份', provinceOpts)}
        {regionSelect(city, (v) => { setCity(v); setDistrict('') }, '全部城市', cityOpts, !province)}
        {regionSelect(district, setDistrict, '全部区县', districtOpts, !city)}
      </div>

      {/* 筛选 chips */}
      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <ChipRow label="类型" options={typeOpts} active={companyType} onChange={setCompanyType} />
        <ChipRow label="行业" options={industryOpts} active={industry} onChange={setIndustry} />
        <ChipRow label="招聘" options={recruitOpts} active={recruitType} onChange={setRecruitType} />
        <ChipRow label="来源" options={sourceOpts} active={sourceKind} onChange={setSourceKind} />
      </div>

      {/* 统计条（真实聚合；加载完成才展示，不显示假数字） */}
      {state === 'ready' && stats && (
        <div className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-4 text-white">
          <Building2Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="grid flex-1 grid-cols-4 gap-2 text-center">
            <div><p className="text-xl font-bold leading-tight">{stats.companyCount}</p><p className="text-[11px] text-white/75">来源企业</p></div>
            <div><p className="text-xl font-bold leading-tight">{stats.openJobCount}</p><p className="text-[11px] text-white/75">在招岗位</p></div>
            <div><p className="text-xl font-bold leading-tight">{stats.todayNewJobCount}</p><p className="text-[11px] text-white/75">今日新增</p></div>
            <div><p className="text-xl font-bold leading-tight">{stats.fairCompanyCount}</p><p className="text-[11px] text-white/75">招聘会参展</p></div>
          </div>
        </div>
      )}

      {/* 合规说明 */}
      <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-gray-500">
          本页仅展示来源机构提供的企业与岗位信息，本系统不接收简历，不参与招聘流程。
        </p>
      </div>

      {/* 列表 */}
      {state === 'loading' ? (
        <LoadingState className="py-16" />
      ) : state === 'error' ? (
        <ErrorState message="企业数据加载失败，请检查后端连接后重试" onRetry={load} className="py-16" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="暂无符合条件的来源企业"
          description="企业信息由来源机构提供、管理员审核发布后展示；可调整筛选条件再试"
          className="py-16"
        />
      ) : (
        <>
          <p className="text-xs text-gray-400">共 {total} 家来源企业</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onDetail={() => navigate(`/companies/${c.id}`)}
                onJobs={() => navigate(`/companies/${c.id}?tab=jobs`)}
              />
            ))}
          </div>
          {nextCursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingMore && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
              加载更多
              <ChevronRightIcon className="h-4 w-4 rotate-90" aria-hidden="true" />
            </button>
          )}
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        投递请前往岗位详情，通过「去来源平台投递 / 扫码投递」在来源平台办理
      </p>
    </div>
  )
}
