// 找企业 / 企业展示页（/companies）。合规定位：来源企业与岗位导览，不是招聘平台。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  COMPANY_INDUSTRIES,
  COMPANY_SOURCE_KINDS,
  COMPANY_TYPES,
  type CompanyCardDTO,
  type CompanyStatsDTO,
} from '@ai-job-print/shared'
import { Loader2Icon, MapPinIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-react'
import { KioskFilterPickerModal } from '../../components/KioskFilterPickerModal'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { DirAiAssist, DirNote, DirSec, DirState } from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import { getCompanies, getCompanyStats, type CompanyQuery } from '../../services/api/companies'
import { COMPANY_NO_OPEN_JOBS_REASON } from '../../lib/capabilityReasons'
import { PROVINCES, citiesOf, districtsOf, isMunicipality } from '../../lib/regions'
import { getTerminalCode } from '../../services/api/terminalConfig'

const PAGE_SIZE = 10
const BOUNDARY = '本机只做来源企业与岗位导览：不收简历、不做筛选、不安排面试，投递在来源平台完成。'
const RECRUIT_TYPE_LABEL: Record<string, string> = {
  fulltime: '社招', campus: '校招', intern: '实习', parttime: '兼职', fair: '招聘会参展',
}

function labelOfType(v: string | null): string | null {
  return v ? (COMPANY_TYPES as Record<string, string>)[v] ?? null : null
}
function labelOfIndustry(v: string | null): string | null {
  return v ? (COMPANY_INDUSTRIES as Record<string, string>)[v] ?? null : null
}

function ChipRow({
  label, options, active, onChange, totalCount, moreLabel, onMore,
}: {
  label: string
  options: { value: string; text: string }[]
  active: string
  onChange: (v: string) => void
  totalCount?: number
  moreLabel?: string
  onMore?: () => void
}) {
  return (
    <div className="dw-fgrp">
      <span className="fl">{label}</span>
      <span className="fc">
        <button type="button" onClick={() => onChange('')} className={`dw-chip ${active === '' ? 'on' : ''}`}>全部</button>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(active === o.value ? '' : o.value)} className={`dw-chip ${active === o.value ? 'on' : ''}`}>{o.text}</button>
        ))}
        {onMore && totalCount && totalCount > options.length ? (
          <button type="button" className="dw-chip" aria-haspopup="dialog" onClick={onMore}>
            <SlidersHorizontalIcon aria-hidden size={18} />
            {moreLabel ?? `查看全部 (${totalCount})`}
          </button>
        ) : null}
      </span>
    </div>
  )
}

function visibleOptions(options: { value: string; text: string }[], limit: number, active: string) {
  const visible = options.slice(0, limit)
  const activeOption = options.find((option) => option.value === active)
  if (!activeOption || visible.some((option) => option.value === active)) return visible
  return [...visible.slice(0, Math.max(0, limit - 1)), activeOption]
}

function CompanyCard({ company, onDetail, onJobs }: {
  company: CompanyCardDTO
  onDetail: () => void
  onJobs: () => void
}) {
  const typeLabel = labelOfType(company.companyType)
  const industryLabel = labelOfIndustry(company.industry)
  const region = [company.province, company.city, company.district].filter(Boolean).join(' · ')
  const noJobs = company.openJobCount === 0
  return (
    <article className="dw-row solid">
      <button type="button" className="dw-row-main dw-row-as-btn" onClick={onDetail}>
        <span className="dw-row-t">
          {company.name}
          {industryLabel ? <span className="dw-tag slate">{industryLabel}</span> : null}
          {company.fairParticipant ? <span className="dw-tag wheat">招聘会参展</span> : null}
          {typeLabel ? <span className="dw-tag">{typeLabel}</span> : null}
        </span>
        <span className="dw-row-sub">
          {region ? <span><MapPinIcon size={18} aria-hidden />{region}</span> : null}
          <span>来源 {company.sourceName}</span>
        </span>
        {company.repJobTitles.length > 0 ? <span className="dw-row-sub">代表岗位：{company.repJobTitles.join(' · ')}</span> : null}
      </button>
      <span className="dw-row-side">
        <span className="num">{company.openJobCount}</span>
        <span className="nt">在招岗位</span>
        <button
          type="button"
          onClick={() => { if (!noJobs) onJobs() }}
          aria-disabled={noJobs || undefined}
          aria-describedby={noJobs ? `company-no-jobs-${company.id}` : undefined}
          className="dw-chip"
        >
          查看在招岗位
        </button>
        {noJobs ? <span id={`company-no-jobs-${company.id}`} className="dw-why">{COMPANY_NO_OPEN_JOBS_REASON}</span> : null}
      </span>
      <span className="dw-row-go" aria-hidden>›</span>
    </article>
  )
}

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
  const [showTaxonomyPicker, setShowTaxonomyPicker] = useState(false)
  const [stats, setStats] = useState<CompanyStatsDTO | null>(null)
  const [items, setItems] = useState<CompanyCardDTO[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const gen = useRef(0)
  const filtered = Boolean(keyword || province || city || district || companyType || industry || recruitType || sourceKind)

  useEffect(() => {
    const t = setTimeout(() => setKeyword(keywordInput.trim()), 300)
    return () => clearTimeout(t)
  }, [keywordInput])

  const query: Omit<CompanyQuery, 'cursor' | 'pageSize'> = useMemo(
    () => ({ keyword, province, city: province && isMunicipality(province) ? '' : city, district, companyType, industry, recruitType, sourceKind }),
    [keyword, province, city, district, companyType, industry, recruitType, sourceKind],
  )

  const load = useCallback(() => {
    const g = ++gen.current
    setState('loading')
    Promise.all([getCompanies({ ...query, pageSize: PAGE_SIZE }), getCompanyStats(query)])
      .then(([page, st]) => {
        if (g !== gen.current) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setStats(st)
        setState('ready')
      })
      .catch(() => { if (g === gen.current) setState('error') })
  }, [query])

  useEffect(() => { load() }, [load])

  const loadMore = () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    getCompanies({ ...query, cursor: nextCursor, pageSize: PAGE_SIZE })
      .then((page) => {
        setItems((prev) => [...prev, ...page.items])
        setNextCursor(page.nextCursor)
      })
      .catch(() => { /* 翻页失败保留游标可重点 */ })
      .finally(() => setLoadingMore(false))
  }

  const isMunicipalProvince = province ? isMunicipality(province) : false
  const cityOpts = province && !isMunicipalProvince ? citiesOf(province) : []
  const districtOpts = province && (isMunicipalProvince || city)
    ? districtsOf(province, isMunicipalProvince ? '市辖区' : city)
    : []
  const typeOpts = Object.entries(COMPANY_TYPES).map(([value, text]) => ({ value, text }))
  const industryOpts = Object.entries(COMPANY_INDUSTRIES).map(([value, text]) => ({ value, text }))
  const sourceOpts = Object.entries(COMPANY_SOURCE_KINDS).map(([value, text]) => ({ value, text }))
  const recruitOpts = Object.entries(RECRUIT_TYPE_LABEL).map(([value, text]) => ({ value, text }))
  const uiState = state === 'loading' ? 'list-loading' : state === 'error' ? 'list-error' : items.length === 0 ? 'list-empty' : filtered ? 'list-filtered' : 'list-ready'
  const pill = state === 'loading'
    ? { tone: 'unknown' as const, label: '正在读取企业目录' }
    : state === 'error'
      ? { tone: 'bad' as const, label: '企业目录读取失败' }
      : items.length === 0
        ? { tone: 'warn' as const, label: '当前筛选没有匹配企业' }
        : { tone: 'ok' as const, label: filtered ? '已按筛选条件重新请求' : '已审核发布的企业' }

  const regionSelect = (value: string, onChange: (v: string) => void, placeholder: string, options: string[], disabled = false) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={placeholder} className="dw-region-select">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <QxPageFrame
      title="找企业"
      subtitle={state === 'loading' ? '企业列表与在招岗位数一起返回，取到之前不显示数字。' : '先定行业和地区，再看企业与在招岗位。'}
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/jobs-service')}>返回岗位服务</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={load}>按条件筛选</button>
        </>
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <KioskFilterPickerModal
        open={showTaxonomyPicker}
        title="企业类型与行业"
        description="完整展示当前统一企业字典；选择后立即用于真实数据筛选。"
        sections={[
          { id: 'companyType', label: '企业类型', value: companyType, allLabel: '全部类型', options: typeOpts.map((option) => ({ value: option.value, label: option.text })) },
          { id: 'industry', label: '所属行业', value: industry, allLabel: '全部行业', options: industryOpts.map((option) => ({ value: option.value, label: option.text })) },
        ]}
        onChange={(sectionId, value) => {
          if (sectionId === 'companyType') setCompanyType(value)
          if (sectionId === 'industry') setIndustry(value)
        }}
        onClear={() => { setCompanyType(''); setIndustry('') }}
        onClose={() => setShowTaxonomyPicker(false)}
      />
      <div className="dw-page qx-grow" data-state={uiState} data-testid={`company-directory-state-${uiState}`}>
        <DirSec no="01" title="按条件找企业" hint="所有条件均对应真实 CompanyQuery">
          <div className="dw-qbar" role="search">
            <span className="qi"><SearchIcon size={26} aria-hidden /></span>
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="搜索企业 / 岗位"
              className="min-h-12 min-w-0 flex-1 bg-transparent"
            />
          </div>
          <ChipRow label="类型" options={visibleOptions(typeOpts, 3, companyType)} active={companyType} onChange={setCompanyType} totalCount={typeOpts.length} moreLabel={`选择类型 (${typeOpts.length})`} onMore={() => setShowTaxonomyPicker(true)} />
          <ChipRow label="行业" options={visibleOptions(industryOpts, 5, industry)} active={industry} onChange={setIndustry} totalCount={industryOpts.length} moreLabel={`选择行业 (${industryOpts.length})`} onMore={() => setShowTaxonomyPicker(true)} />
          <ChipRow label="招聘" options={recruitOpts} active={recruitType} onChange={setRecruitType} />
          <ChipRow label="来源" options={sourceOpts.slice(0, 4)} active={sourceKind} onChange={setSourceKind} />
          <div className="dw-fgrp">
            <span className="fl">地区</span>
            <span className="fc">
              {regionSelect(province, (v) => { setProvince(v); setCity(''); setDistrict('') }, '全部省份', PROVINCES)}
              {regionSelect(city, (v) => { setCity(v); setDistrict('') }, isMunicipalProvince ? '直辖市' : '全部城市', cityOpts, !province || isMunicipalProvince)}
              {regionSelect(district, setDistrict, '全部区县', districtOpts, !province || (!isMunicipalProvince && !city))}
            </span>
          </div>
        </DirSec>

        <DirSec no="02" title="企业名单" hint="只列已审核发布企业" grow>
          <div className="dw-rbox">
            {state === 'ready' && stats ? (
              <div className="dw-rhead">
                <span className="rn">已发布企业</span>
                <span>共 {stats.companyCount} 条 · 在招岗位 {stats.openJobCount} 个</span>
                <span className="rsp">{filtered ? '已应用筛选条件' : BOUNDARY}</span>
              </div>
            ) : null}
            {state === 'loading' ? (
              <DirState tone="info" testId="company-directory-result-loading" title="正在读取企业目录与统计">
                企业列表与在招岗位数同一次请求返回；取到之前不显示任何企业名称或数字。
              </DirState>
            ) : state === 'error' ? (
              <>
                <DirState tone="error" testId="company-directory-result-error" title="企业目录没取到">
                  列表与在招岗位数一起失败了。数字不会退回到固定值，也不会写 0 顶替。
                </DirState>
                <div className="dw-filter-actions">
                  <button type="button" className="dw-chip" onClick={load}>重试</button>
                  <button type="button" className="dw-chip" onClick={() => navigate('/jobs')}>去岗位信息</button>
                </div>
              </>
            ) : items.length === 0 ? (
              <>
                <DirState tone="empty" testId="company-directory-result-empty" title="当前筛选没有匹配的企业">
                  少选两个条件再试；企业需审核通过并发布后才会进入目录。
                </DirState>
                <div className="dw-filter-actions">
                  <button type="button" className="dw-chip" onClick={() => { setKeywordInput(''); setKeyword(''); setProvince(''); setCity(''); setDistrict(''); setCompanyType(''); setIndustry(''); setRecruitType(''); setSourceKind('') }}>清除全部筛选</button>
                  <button type="button" className="dw-chip" onClick={() => navigate('/jobs')}>去岗位信息</button>
                </div>
              </>
            ) : (
              <>
                <div className="dw-rlist">
                  {items.map((c) => (
                    <CompanyCard
                      key={c.id}
                      company={c}
                      onDetail={() => navigate(`/companies/${c.id}`)}
                      onJobs={() => navigate(`/companies/${c.id}?tab=jobs`)}
                    />
                  ))}
                </div>
                {nextCursor ? (
                  <button type="button" className="dw-pbtn" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden /> : null}
                    加载更多
                  </button>
                ) : null}
              </>
            )}
          </div>
        </DirSec>
        {state === 'loading' || state === 'error' || items.length === 0
          ? <DirNote>{BOUNDARY}</DirNote>
          : <DirAiAssist screen="company-directory" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />}
      </div>
    </QxPageFrame>
  )
}
