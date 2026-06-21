import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { FairCompanyDTO, FairCompanyPositionDTO } from '@ai-job-print/shared'
import { COMPANY_SCALE_LABELS } from '../../types/fair'
import {
  AwardIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  FilterIcon,
  GraduationCapIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  SmartphoneIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getFairCompanyById } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'poster'

interface Filters {
  location:     string
  education:    string
  experience:   string
  positionType: string
}

interface PrintFile {
  name:  string
  size:  string
  pages: number
}

// ─── Position type constants ──────────────────────────────────────────────────

const POSITION_TYPE_LABELS: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  intern:    '实习',
}
const POSITION_TYPE_COLORS: Record<string, string> = {
  full_time: 'bg-primary-50 text-primary-700',
  part_time: 'bg-orange-50 text-orange-700',
  intern:    'bg-green-50 text-green-700',
}

// ─── Industry gradient palette ────────────────────────────────────────────────

const INDUSTRY_GRADIENT: Record<string, string> = {
  '互联网/软件': 'from-blue-800 to-blue-600',
  '金融/财务':  'from-emerald-800 to-emerald-600',
  '制造/工程':  'from-orange-800 to-orange-600',
  '政事业':     'from-indigo-800 to-indigo-600',
  '教育/医疗':  'from-teal-800 to-teal-600',
  '产品/技术':  'from-violet-800 to-violet-600',
  '数据/AI':    'from-sky-800 to-sky-600',
  '运营/市场':  'from-rose-800 to-rose-600',
}

// ─── QR overlay ───────────────────────────────────────────────────────────────

function QrOverlay({
  companyName,
  sourceUrl,
  onClose,
}: {
  companyName: string
  sourceUrl: string | undefined
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-[340px] rounded-2xl bg-white p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台</p>
        <p className="mt-1 text-center text-xs text-gray-400">{companyName}</p>
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={sourceUrl} size={180} />
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-600">
            请使用手机扫描二维码，前往来源平台完成投递。本系统不接收简历，不参与招聘闭环。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Cover area ───────────────────────────────────────────────────────────────

function CoverArea({ company }: { company: FairCompanyDTO }) {
  const gradient = INDUSTRY_GRADIENT[company.industry] ?? 'from-gray-700 to-gray-500'
  const totalHeadcount = company.positions.reduce((s, p) => s + p.headcount, 0)

  return (
    <div className={`bg-gradient-to-br ${gradient} px-6 pt-5 pb-6`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold leading-tight text-white">{company.companyName}</h1>
          <p className="mt-1 text-sm text-white/70">{company.industry} · {COMPANY_SCALE_LABELS[company.scale]}</p>
        </div>
        {company.boothNumber && (
          <div className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-center">
            <p className="text-[10px] text-white/60">展位</p>
            <p className="text-base font-bold text-white">{company.boothNumber}</p>
          </div>
        )}
      </div>

      {company.honorTags && company.honorTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {company.honorTags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white"
            >
              <AwardIcon className="h-3 w-3" />
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-5 text-sm text-white/80">
        <span className="flex items-center gap-1.5">
          <BriefcaseIcon className="h-4 w-4 text-white/60" />
          {company.positions.length} 个岗位
        </span>
        <span className="flex items-center gap-1.5">
          <UsersIcon className="h-4 w-4 text-white/60" />
          共招 {totalHeadcount} 人
        </span>
        {company.zoneName && (
          <span className="flex items-center gap-1.5">
            <MapPinIcon className="h-4 w-4 text-white/60" />
            {company.zoneName}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Company info card ────────────────────────────────────────────────────────

function CompanyInfoCard({ company }: { company: FairCompanyDTO }) {
  const [expanded, setExpanded] = useState(false)
  const descLong = (company.description?.length ?? 0) > 100

  return (
    <Card className="p-5">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
        {company.founded && (
          <span className="flex items-center gap-1.5">
            <CalendarIcon className="h-4 w-4 text-gray-400" />
            成立 {company.founded} 年
          </span>
        )}
        {company.headquarters && (
          <span className="flex items-center gap-1.5">
            <MapPinIcon className="h-4 w-4 text-gray-400" />
            总部：{company.headquarters}
          </span>
        )}
        {company.registeredCapital && (
          <span className="flex items-center gap-1.5">
            <BuildingIcon className="h-4 w-4 text-gray-400" />
            注册资本：{company.registeredCapital}
          </span>
        )}
      </div>

      {company.description && (
        <div className="mt-3">
          <p className={['text-sm leading-relaxed text-gray-600', !expanded && descLong ? 'line-clamp-3' : ''].join(' ')}>
            {company.description}
          </p>
          {descLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 flex items-center gap-0.5 text-xs text-primary-600"
            >
              {expanded
                ? <><ChevronUpIcon className="h-3.5 w-3.5" />收起</>
                : <><ChevronDownIcon className="h-3.5 w-3.5" />展开全文</>}
            </button>
          )}
        </div>
      )}

      {company.sourceUrl && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-400">
          <InfoIcon className="h-3.5 w-3.5 shrink-0" />
          <span>数据来自合作平台 · 仅供展示参考</span>
          <ExternalLinkIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-primary-400" />
        </div>
      )}
    </Card>
  )
}

// ─── Action bar ───────────────────────────────────────────────────────────────

interface ActionBarProps {
  sourceCanApply:   boolean
  onScanQr:         () => void
  onOpenSource:     () => void
  onPrintProfile:   () => void
  onPrintPositions: () => void
}

function ActionBar({ sourceCanApply, onScanQr, onOpenSource, onPrintProfile, onPrintPositions }: ActionBarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Button size="lg" onClick={onScanQr} disabled={!sourceCanApply} className="flex min-h-[56px] items-center justify-center gap-2">
        <QrCodeIcon className="h-4 w-4" />
        扫码投递
      </Button>
      <Button
        size="lg"
        variant="secondary"
        className="flex min-h-[56px] items-center justify-center gap-2"
        onClick={onOpenSource}
        disabled={!sourceCanApply}
      >
        <ExternalLinkIcon className="h-4 w-4" />
        去来源平台投递
      </Button>
      <Button
        size="lg"
        variant="secondary"
        className="flex min-h-[56px] items-center justify-center gap-2"
        onClick={onPrintProfile}
      >
        <PrinterIcon className="h-4 w-4" />
        打印企业资料
      </Button>
      <Button
        size="lg"
        variant="secondary"
        className="flex min-h-[56px] items-center justify-center gap-2"
        onClick={onPrintPositions}
      >
        <PrinterIcon className="h-4 w-4" />
        打印岗位清单
      </Button>
    </div>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  positions: FairCompanyPositionDTO[]
  filters: Filters
  viewMode: ViewMode
  onFilter: (f: Partial<Filters>) => void
  onViewMode: (v: ViewMode) => void
}

function FilterBar({ positions, filters, viewMode, onFilter, onViewMode }: FilterBarProps) {
  const locations   = ['不限', ...Array.from(new Set(positions.map((p) => p.location).filter((l): l is string => !!l)))]
  const educations  = ['不限', '大专及以上', '本科及以上', '硕士及以上']
  const experiences = ['不限', '应届生', '1年以上', '3年以上', '5年以上']
  const typeOptions = [
    { value: '不限',      label: '不限' },
    { value: 'full_time', label: '全职' },
    { value: 'part_time', label: '兼职' },
    { value: 'intern',    label: '实习' },
  ]

  const ChipRow = ({ label, opts, fk }: { label: string; opts: string[]; fk: keyof Filters }) => (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-xs text-gray-400">{label}</span>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {opts.map((opt) => (
          <button
            key={opt}
            onClick={() => onFilter({ [fk]: opt })}
            className={[
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filters[fk] === opt ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ].join(' ')}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 pb-3">
        <FilterIcon className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700">筛选岗位</span>
        <div className="ml-auto flex rounded-lg border border-gray-200 p-0.5">
          <button
            onClick={() => onViewMode('list')}
            className={['rounded p-1.5 transition-colors', viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-gray-400 hover:text-gray-600'].join(' ')}
            title="列表视图"
          >
            <ListIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewMode('poster')}
            className={['rounded p-1.5 transition-colors', viewMode === 'poster' ? 'bg-primary-600 text-white' : 'text-gray-400 hover:text-gray-600'].join(' ')}
            title="海报视图"
          >
            <LayoutGridIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <ChipRow label="城市" opts={locations} fk="location" />
        <ChipRow label="学历" opts={educations} fk="education" />
        <ChipRow label="经验" opts={experiences} fk="experience" />
        <div className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 text-xs text-gray-400">类型</span>
          <div className="flex gap-1">
            {typeOptions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onFilter({ positionType: value })}
                className={[
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  filters.positionType === value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Position list view ───────────────────────────────────────────────────────

function PositionListView({ positions, companyName }: { positions: FairCompanyPositionDTO[]; companyName: string }) {
  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-200 py-12 text-center">
        <BriefcaseIcon className="h-8 w-8 text-gray-200" />
        <p className="text-sm text-gray-400">暂无匹配岗位</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {positions.map((pos) => (
        <Card key={pos.id} className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-gray-900">{pos.title}</p>
                {pos.positionType && (
                  <span className={['rounded-full px-2 py-0.5 text-xs font-medium', POSITION_TYPE_COLORS[pos.positionType] ?? 'bg-gray-100 text-gray-600'].join(' ')}>
                    {POSITION_TYPE_LABELS[pos.positionType] ?? pos.positionType}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="font-semibold text-green-600">{pos.salary ?? '薪资面议'}</span>
                <span>招 {pos.headcount} 人</span>
                {pos.location && <span className="flex items-center gap-0.5"><MapPinIcon className="h-3 w-3" />{pos.location}</span>}
                {pos.education && <span className="flex items-center gap-0.5"><GraduationCapIcon className="h-3 w-3" />{pos.education}</span>}
                {pos.experience && <span>{pos.experience}</span>}
                {pos.department && <span className="text-gray-400">/ {pos.department}</span>}
              </div>
            </div>
          </div>
          {pos.requirements && (
            <p className="mt-2.5 border-t border-gray-50 pt-2.5 text-xs leading-relaxed text-gray-500">{pos.requirements}</p>
          )}
          <p className="mt-2 text-right text-[10px] text-gray-300">来源：{companyName}</p>
        </Card>
      ))}
    </div>
  )
}

// ─── Position poster view ─────────────────────────────────────────────────────

function PositionPosterView({ positions, companyName, industry }: { positions: FairCompanyPositionDTO[]; companyName: string; industry: string }) {
  const posterGradient: Record<string, string> = {
    '互联网/软件': 'from-blue-700 to-blue-500',
    '金融/财务':  'from-emerald-700 to-emerald-500',
    '制造/工程':  'from-orange-700 to-orange-500',
    '政事业':     'from-indigo-700 to-indigo-500',
    '教育/医疗':  'from-teal-700 to-teal-500',
    '产品/技术':  'from-violet-700 to-violet-500',
    '数据/AI':    'from-sky-700 to-sky-500',
    '运营/市场':  'from-rose-700 to-rose-500',
  }
  const gradient = posterGradient[industry] ?? 'from-gray-600 to-gray-500'

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-200 py-12 text-center">
        <BriefcaseIcon className="h-8 w-8 text-gray-200" />
        <p className="text-sm text-gray-400">暂无匹配岗位</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {positions.map((pos) => (
        <div key={pos.id} className={`flex flex-col rounded-xl bg-gradient-to-br ${gradient} overflow-hidden`}>
          <div className="px-4 pt-4 pb-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/60">{companyName}</p>
            <p className="mt-1 text-base font-bold leading-snug text-white">{pos.title}</p>
            {pos.positionType && (
              <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white">
                {POSITION_TYPE_LABELS[pos.positionType] ?? pos.positionType}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1.5 bg-white/10 px-4 py-3 text-xs text-white/90">
            <p className="text-sm font-semibold text-white">{pos.salary ?? '薪资面议'}</p>
            <p>招 {pos.headcount} 人</p>
            {pos.education && <p>{pos.education}</p>}
            {pos.experience && <p>{pos.experience}</p>}
            {pos.location && (
              <p className="flex items-center gap-1">
                <MapPinIcon className="h-3 w-3" />
                {pos.location}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 bg-black/10 px-4 py-2">
            <QrCodeIcon className="h-3.5 w-3.5 text-white/50" />
            <p className="text-[10px] text-white/50">扫码查看 · 去来源平台投递</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function FairCompanyDetailPage() {
  const navigate = useNavigate()
  const { id, companyId } = useParams<{ id: string; companyId: string }>()
  const location = useLocation()
  const { getToken } = useAuth()
  const fairId   = id ?? ''

  const stateCompany  = (location.state as { company?: FairCompanyDTO } | null)?.company
  const hasStateMatch = stateCompany?.id === companyId

  const [company,  setCompany]  = useState<FairCompanyDTO | null>(hasStateMatch ? stateCompany! : null)
  const [loading,  setLoading]  = useState(!hasStateMatch)
  const [error,    setError]    = useState(false)
  const [showQr,   setShowQr]   = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [filters,  setFilters]  = useState<Filters>({
    location:     '不限',
    education:    '不限',
    experience:   '不限',
    positionType: '不限',
  })

  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getFairCompanyById(fairId, companyId!)
      .then((res) => {
        if (cancelled) return
        if (res.data) setCompany(res.data)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, companyId, hasStateMatch])

  const filteredPositions = useMemo(() => {
    if (!company) return []
    return company.positions.filter((pos) => {
      const okLocation    = filters.location === '不限' || pos.location === filters.location
      const okEducation   = filters.education === '不限' || !pos.education || pos.education === filters.education
      const okExperience  = filters.experience === '不限' || !pos.experience || pos.experience === filters.experience
      const okType        = filters.positionType === '不限' || pos.positionType === filters.positionType
      return okLocation && okEducation && okExperience && okType
    })
  }, [company, filters])

  const handleFilter = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }))
  const clearFilters = () => setFilters({ location: '不限', education: '不限', experience: '不限', positionType: '不限' })
  const isFiltered   = Object.values(filters).some((v) => v !== '不限')

  // ── Print handlers ─────────────────────────────────────────────────────────
  const returnUrl   = company ? `/job-fairs/${fairId}/companies/${companyId}` : undefined
  const returnLabel = company?.companyName

  const handlePrintProfile = () => {
    if (!company) return
    const file: PrintFile = {
      name:  `${company.companyName}_企业资料.pdf`,
      size:  '约 120 KB',
      pages: 1 + Math.ceil(company.positions.length / 8),
    }
    navigate('/print/preview', { state: { file, returnUrl, returnLabel } })
  }

  const handlePrintPositions = () => {
    if (!company) return
    const file: PrintFile = {
      name:  `${company.companyName}_岗位清单.pdf`,
      size:  `约 ${Math.max(40, company.positions.length * 15)} KB`,
      pages: Math.max(1, Math.ceil(company.positions.length / 4)),
    }
    navigate('/print/preview', { state: { file, returnUrl, returnLabel } })
  }

  const openApplyQr = () => {
    if (!company || !isValidSourceUrl(company.sourceUrl)) return
    recordExternalJump(getToken(), 'fair_company', company.id, 'external_apply')
    setShowQr(true)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <BuildingIcon className="h-12 w-12 text-gray-200" />
        <p className="text-sm text-gray-400">企业数据未找到</p>
        <Button variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
          返回企业列表
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      {showQr && <QrOverlay companyName={company.companyName} sourceUrl={company.sourceUrl} onClose={() => setShowQr(false)} />}

      {/* Page header */}
      <div className="border-b border-gray-100 bg-white px-6 pt-4 pb-3">
        <PageHeader
          title={company.companyName}
          subtitle={`展位 ${company.boothNumber ?? '—'} · ${company.industry}`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
              返回列表
            </Button>
          }
        />
      </div>

      {/* Cover */}
      <CoverArea company={company} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 px-6 py-5 pb-8">
        <CompanyInfoCard company={company} />
        <ActionBar
          sourceCanApply={isValidSourceUrl(company.sourceUrl)}
          onScanQr={openApplyQr}
          onOpenSource={openApplyQr}
          onPrintProfile={handlePrintProfile}
          onPrintPositions={handlePrintPositions}
        />

        <FilterBar
          positions={company.positions}
          filters={filters}
          viewMode={viewMode}
          onFilter={handleFilter}
          onViewMode={setViewMode}
        />

        <div className="flex items-center justify-between text-sm">
          <p className="font-medium text-gray-700">
            招聘岗位
            <span className="ml-1.5 text-gray-400">
              ({filteredPositions.length} / {company.positions.length})
            </span>
          </p>
          {isFiltered && (
            <button onClick={clearFilters} className="text-xs text-primary-600 hover:underline">
              清除筛选
            </button>
          )}
        </div>

        {viewMode === 'list' ? (
          <PositionListView positions={filteredPositions} companyName={company.companyName} />
        ) : (
          <PositionPosterView positions={filteredPositions} companyName={company.companyName} industry={company.industry} />
        )}

        {/* Compliance footer */}
        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            {company.applyNote}。本系统仅展示招聘会现场企业与岗位信息，不接收简历，不参与招聘闭环。
            如需投递请扫码前往来源平台或现场前往展位咨询。
          </p>
        </div>
      </div>
    </div>
  )
}
