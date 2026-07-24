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
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import {
  COMPANY_INDUSTRIES,
  COMPANY_SOURCE_KINDS,
  COMPANY_TYPES,
  type CompanyCardDTO,
  type CompanyStatsDTO,
} from '@ai-job-print/shared'
import {
  Building2Icon,
  BuildingIcon,
  ChevronRightIcon,
  Loader2Icon,
  MapPinIcon,
  SearchIcon,
} from 'lucide-react'
import { getCompanies, getCompanyStats, type CompanyQuery } from '../../services/api/companies'
import { PROVINCES, citiesOf, districtsOf, isMunicipality } from '../../lib/regions'
import { FusionBadge, FusionNotice, KioskPageFrame } from '../jobs/components/W4Presentation'

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
    <div className="flex flex-wrap items-center gap-3">
      <span className="min-w-[52px] shrink-0 text-[20px] text-[var(--kp-muted)]">{label}</span>
      <div className="flex flex-1 flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`min-h-[58px] rounded-full px-7 text-[21px] ${active === '' ? 'bg-[var(--kp-dark)] font-bold text-[#f4f1e8]' : 'border border-[var(--kp-line)] bg-[var(--kp-surface)] text-[var(--kp-muted)]'}`}
        >
          全部
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active === o.value ? '' : o.value)}
            className={`min-h-[58px] rounded-full px-7 text-[21px] ${active === o.value ? 'bg-[var(--kp-dark)] font-bold text-[#f4f1e8]' : 'border border-[var(--kp-line)] bg-[var(--kp-surface)] text-[var(--kp-muted)]'}`}
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
    <article className="flex min-h-[124px] items-center gap-5 rounded-[14px] border border-[var(--kp-line)] border-l-[5px] border-l-[var(--kp-accent)] bg-[var(--kp-surface)] px-6 py-3 shadow-sm">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-5 text-left" onClick={onDetail}>
        {company.logoUrl ? (
          <img src={company.logoUrl} alt={`${company.name} logo`} className="h-[60px] w-[60px] shrink-0 rounded-[14px] border border-neutral-100 object-cover" />
        ) : (
          <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[14px] bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
            <BuildingIcon className="h-8 w-8" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <b className="truncate text-[26px] font-bold tracking-[.5px]">{company.name}</b>
            {industryLabel && <span className="kproto-chip source px-3 py-1 text-base">{industryLabel}</span>}
            {company.fairParticipant && <span className="kproto-chip warn px-3 py-1 text-base">招聘会参展</span>}
            {typeLabel && <span className="kproto-chip px-3 py-1 text-base">{typeLabel}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[18px] text-[var(--kp-muted)]">
            {region && <span className="inline-flex items-center gap-1"><MapPinIcon className="h-4 w-4" aria-hidden="true" />{region}</span>}
          </div>
          {company.repJobTitles.length > 0 && (
            <p className="mt-1 truncate text-[17px] text-[var(--kp-muted)]">代表岗位：<b className="font-semibold text-[var(--kp-ink)]">{company.repJobTitles.join(' · ')}</b></p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="kproto-chip source px-3 py-1 text-base">来源 · {company.sourceName}</span>
          </div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <div className="text-[30px] font-bold text-[var(--kp-accent-deep)] tabular-nums">{company.openJobCount}</div>
        <div className="mt-[-4px] text-base text-[var(--kp-muted)]">在招岗位</div>
        <button
          type="button"
          onClick={onJobs}
          disabled={company.openJobCount === 0}
          className="mt-1 min-h-[48px] rounded-full border border-[var(--kp-line)] bg-[var(--kp-surface)] px-5 text-[17px] font-bold text-[var(--kp-accent-deep)] disabled:opacity-45"
        >
          查看在招岗位
        </button>
      </div>
      <ChevronRightIcon className="h-6 w-6 shrink-0 text-[var(--kp-muted)] opacity-60" aria-hidden="true" />
    </article>
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
    () => ({
      keyword,
      province,
      city: province && isMunicipality(province) ? '' : city,
      district,
      companyType,
      industry,
      recruitType,
      sourceKind,
    }),
    [keyword, province, city, district, companyType, industry, recruitType, sourceKind],
  )

  const load = useCallback(() => {
    const g = ++gen.current
    setState('loading')
    Promise.all([
      getCompanies({ ...query, pageSize: PAGE_SIZE }),
      getCompanyStats(query),
    ])
      .then(([page, st]) => {
        if (g !== gen.current) return
        setItems(page.items)
        setTotal(page.total)
        setNextCursor(page.nextCursor)
        setStats(st)
        setState('ready')
      })
      .catch(() => {
        if (g === gen.current) setState('error')
      })
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

  // 地区联动选项：完整全国行政区划字典（省/市/区，来自 china-division，非业务数据）。
  // 用户可选任意地区；后端按真实数据过滤，选到无企业的地区时返回真实空态，不造数据。
  const isMunicipalProvince = province ? isMunicipality(province) : false
  const provinceOpts = PROVINCES
  const cityOpts = province && !isMunicipalProvince ? citiesOf(province) : []
  const districtOpts = province && (isMunicipalProvince || city)
    ? districtsOf(province, isMunicipalProvince ? '市辖区' : city)
    : []

  // 筛选项来自统一共享字典（完整），不再由当前已有企业反推出不完整选项。
  // 招聘类型/来源类型受后端语义约束（Job.category / Organization.type），保持既有取值不臆造空项。
  const typeOpts = Object.entries(COMPANY_TYPES).map(([value, text]) => ({ value, text }))
  const industryOpts = Object.entries(COMPANY_INDUSTRIES).map(([value, text]) => ({ value, text }))
  const sourceOpts = Object.entries(COMPANY_SOURCE_KINDS).map(([value, text]) => ({ value, text }))
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
      className="min-h-[58px] flex-1 rounded-full border border-[var(--kp-line)] bg-[var(--kp-surface)] px-5 text-[19px] text-[var(--kp-ink)] disabled:bg-[var(--kp-paper)] disabled:text-[var(--kp-muted)]"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <KioskPageFrame
      tone="clay"
      title="找企业"
      subtitle="来源企业与岗位导览 · 按地区 / 类型 / 行业浏览"
      backLabel="返回岗位信息"
      onBack={() => navigate('/jobs')}
      badge={<FusionBadge>最近更新 · 实时数据</FusionBadge>}
    >
        <div className="kproto kproto-clay kproto-content gap-3">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <ChipRow label="类型" options={typeOpts.slice(0, 3)} active={companyType} onChange={setCompanyType} />
              <label className="ml-auto flex min-h-[58px] min-w-[280px] items-center gap-3 rounded-full border border-[var(--kp-line)] bg-[var(--kp-surface)] px-5">
                <SearchIcon className="h-6 w-6 text-[var(--kp-muted)]" aria-hidden="true" />
                <input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder="搜索企业 / 岗位"
                  className="min-h-12 min-w-0 flex-1 bg-transparent text-[19px] outline-none placeholder:text-[var(--kp-muted)]"
                />
              </label>
            </div>
            <ChipRow label="行业" options={industryOpts.slice(0, 5)} active={industry} onChange={setIndustry} />
            <ChipRow label="招聘" options={recruitOpts} active={recruitType} onChange={setRecruitType} />
            <ChipRow label="来源" options={sourceOpts.slice(0, 4)} active={sourceKind} onChange={setSourceKind} />
            <div className="flex gap-3">
              {regionSelect(province, (v) => { setProvince(v); setCity(''); setDistrict('') }, '全部省份', provinceOpts)}
              {regionSelect(city, (v) => { setCity(v); setDistrict('') }, isMunicipalProvince ? '直辖市' : '全部城市', cityOpts, !province || isMunicipalProvince)}
              {regionSelect(district, setDistrict, '全部区县', districtOpts, !province || (!isMunicipalProvince && !city))}
            </div>
          </div>

          {state === 'ready' && stats && (
            <div className="flex items-center gap-5 rounded-[18px] bg-[var(--kp-dark)] px-8 py-3 text-[#f4f1e8]">
              <Building2Icon className="h-9 w-9 shrink-0 opacity-80" aria-hidden="true" />
              <div className="grid flex-1 grid-cols-4 text-center">
                <div><div className="font-serif text-[34px] font-bold tabular-nums">{stats.companyCount}</div><div className="text-[17px] opacity-70">来源企业</div></div>
                <div><div className="font-serif text-[34px] font-bold tabular-nums">{stats.openJobCount}</div><div className="text-[17px] opacity-70">在招岗位</div></div>
                <div><div className="font-serif text-[34px] font-bold tabular-nums">{stats.todayNewJobCount}</div><div className="text-[17px] opacity-70">今日新增岗位</div></div>
                <div><div className="font-serif text-[34px] font-bold tabular-nums">{stats.fairCompanyCount}</div><div className="text-[17px] opacity-70">招聘会参展</div></div>
              </div>
            </div>
          )}

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
              <div className="flex items-center text-[20px] text-[var(--kp-muted)]">
                <span>共 <b className="text-[var(--kp-ink)]">{total}</b> 家来源企业 · 投递请进入岗位详情在来源平台办理</span>
                <span className="ml-auto tabular-nums">已显示 {items.length} / {total ?? items.length}</span>
              </div>
              <div className="grid gap-2.5">
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
                  className="kproto-btn sm w-full border-dashed text-[var(--kp-muted)] disabled:opacity-60"
                >
                  {loadingMore && <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />}
                  加载更多
                </button>
              )}
            </>
          )}

          <FusionNotice>企业与岗位信息由来源机构提供、审核发布后展示；投递请进入岗位详情，通过「去来源平台投递 / 扫码投递」在来源平台办理。</FusionNotice>
        </div>
    </KioskPageFrame>
  )
}
