import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { COMPLIANCE_COPY, type ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  BotIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FactoryIcon,
  FileSearchIcon,
  FilterIcon,
  GraduationCapIcon,
  LandmarkIcon,
  MapIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  SchoolIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react'
import { getJobFairs } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { SourceUrlQr } from '../../components/SourceUrlQr'

const CAMPUS_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/
const PUBLIC_FAIR_PAGE_SIZE = 100

function isCampusFair(fair: ExternalJobFairDTO): boolean {
  return (
    fair.theme === 'campus' ||
    fair.theme === 'campus_corp' ||
    CAMPUS_RE.test(`${fair.name} ${fair.organizer} ${fair.description ?? ''} ${fair.sourceName} ${fair.hostSchoolName ?? ''}`)
  )
}

const STATUS_LABEL: Record<ExternalJobFairDTO['status'], string> = {
  upcoming: '未开始',
  ongoing: '进行中',
  ended: '已结束',
}

const STATUS_STYLE: Record<ExternalJobFairDTO['status'], string> = {
  upcoming: 'border-orange-200 bg-orange-50 text-orange-600',
  ongoing: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ended: 'border-gray-200 bg-gray-100 text-gray-500',
}

function schoolOf(fair: ExternalJobFairDTO): string {
  return fair.hostSchoolName || fair.sourceName || fair.organizer || '其他来源'
}

function isSchoolSource(fair: ExternalJobFairDTO): boolean {
  return /大学|学院|高校|就业指导/.test(`${schoolOf(fair)} ${fair.organizer}`)
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}（${weekdays[d.getDay()]}）`
}

function formatTimeRange(fair: ExternalJobFairDTO): string {
  const start = new Date(fair.startTime)
  const end = new Date(fair.endTime)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(start.getHours())}:${p(start.getMinutes())}-${p(end.getHours())}:${p(end.getMinutes())}`
}

function statusRank(status: ExternalJobFairDTO['status']): number {
  if (status === 'ongoing') return 0
  if (status === 'upcoming') return 1
  return 2
}

async function loadAllPublishedFairs(): Promise<ExternalJobFairDTO[]> {
  const all: ExternalJobFairDTO[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await getJobFairs({ page, pageSize: PUBLIC_FAIR_PAGE_SIZE })
    all.push(...res.data)
    totalPages = res.pagination?.totalPages ?? (res.data.length < PUBLIC_FAIR_PAGE_SIZE ? page : page + 1)
    page += 1
  } while (page <= totalPages)
  return all
}

function QrModal({ fair, onClose }: { fair: ExternalJobFairDTO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="relative w-[360px] rounded-3xl bg-white p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label="关闭">
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-lg font-bold text-gray-950">扫码预约</p>
        <p className="mt-1 line-clamp-1 text-center text-sm text-gray-500">{fair.name}</p>
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={fair.sourceUrl} size={190} />
        </div>
        <div className="mt-5 rounded-2xl bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-700">
          预约请前往来源平台办理，本系统不接收报名信息，不记录预约结果。
        </div>
      </div>
    </div>
  )
}

function CampusLogo({ name, large = false }: { name: string; large?: boolean }) {
  const initials = name.replace(/就业指导中心|学生就业|大学|学院|学校|中心/g, '').slice(0, 2) || '校招'
  return (
    <div className={`${large ? 'h-16 w-16 text-base' : 'h-14 w-14 text-sm'} flex shrink-0 items-center justify-center rounded-full border-2 border-blue-100 bg-white text-center font-black leading-tight text-blue-700 shadow-sm`}>
      {initials}
    </div>
  )
}

function FeaturedCampusCard({
  fair,
  onOpen,
}: {
  fair: ExternalJobFairDTO
  onOpen: () => void
}) {
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : fair.boothCount ?? 0
  return (
    <section className="featuredCampusCard relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1f7af7] via-[#2f83f8] to-[#1261d5] px-9 py-7 text-white shadow-[0_12px_30px_rgba(31,122,247,0.25)]">
      <div className="absolute right-8 top-8 hidden opacity-20 sm:block">
        <SchoolIcon className="h-40 w-40 stroke-[1.2]" />
      </div>
      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-br-2xl rounded-tl-xl bg-white/15 px-4 py-2 text-xl font-bold">
          <ShieldCheckIcon className="h-6 w-6" />本校优先
        </div>
        <h2 className="mt-5 text-4xl font-black tracking-tight">{fair.name}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xl">
          <span className={`rounded-lg border px-3 py-1 text-base font-bold ${STATUS_STYLE[fair.status]}`}>{STATUS_LABEL[fair.status]}</span>
          <span className="flex items-center gap-2"><CalendarDaysIcon className="h-6 w-6" />{formatShortDate(fair.startTime)} {formatTimeRange(fair)}</span>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xl">
          <MapPinIcon className="h-6 w-6" />
          {fair.city ? `${fair.city} · ` : ''}{fair.venue}
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="flex items-center gap-4">
            <Building2Icon className="h-12 w-12 opacity-90" />
            <div>
              <p className="text-base opacity-90">参会企业</p>
              <p className="text-3xl font-black">{companyCount} 家</p>
            </div>
          </div>
          <div className="flex items-center gap-4 border-white/30 sm:border-l sm:pl-10">
            <BriefcaseBusinessIcon className="h-12 w-12 opacity-90" />
            <div>
              <p className="text-base opacity-90">提供岗位</p>
              <p className="text-3xl font-black">{fair.jobCount ?? 0} 个</p>
            </div>
          </div>
          <button onClick={onOpen} className="flex h-16 min-w-[240px] items-center justify-center gap-3 rounded-xl bg-white px-8 text-2xl font-black text-blue-700 shadow-lg transition active:scale-[0.98]">
            查看招聘会 <ChevronRightIcon className="h-8 w-8" />
          </button>
        </div>
      </div>
    </section>
  )
}

type CampusFilterKind = 'school' | 'city' | 'status' | 'time'

function FilterButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof GraduationCapIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-16 items-center justify-center gap-3 rounded-xl border px-5 text-xl font-bold shadow-sm transition active:scale-[0.98] ${
        active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-800'
      }`}
    >
      <Icon className={`h-6 w-6 ${active ? 'text-blue-600' : 'text-gray-700'}`} />
      <span>{label}</span>
      <ChevronDownIcon className="h-5 w-5 text-gray-500" />
    </button>
  )
}

function FilterSheet({
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  title: string
  options: string[]
  selected: string
  onSelect: (option: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-5" onClick={onClose}>
      <div className="w-full max-w-[640px] rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-black text-gray-950">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100" aria-label="关闭筛选">
            <XIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {options.map((option) => (
            <button
              key={option}
              onClick={() => {
                onSelect(option)
                onClose()
              }}
              className={`h-13 rounded-xl border px-4 py-3 text-lg font-bold ${
                selected === option ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function CampusFairRow({
  fair,
  onOpen,
  onQr,
}: {
  fair: ExternalJobFairDTO
  onOpen: () => void
  onQr: () => void
}) {
  return (
    <div className="grid gap-4 border-t border-gray-100 bg-white px-4 py-5 first:border-t-0 sm:grid-cols-[72px_1fr_auto] sm:items-center">
      <CampusLogo name={schoolOf(fair)} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-black text-gray-950">{fair.name}</h3>
          <span className={`rounded-lg border px-2.5 py-1 text-sm font-bold ${STATUS_STYLE[fair.status]}`}>{STATUS_LABEL[fair.status]}</span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-base text-gray-500">
          <span className="inline-flex items-center gap-1"><CalendarDaysIcon className="h-4 w-4" />{formatShortDate(fair.startTime)} {formatTimeRange(fair)}</span>
          <span>|</span>
          <span className="inline-flex items-center gap-1"><MapPinIcon className="h-4 w-4" />{fair.venue}</span>
        </p>
        <p className="mt-2 text-base text-gray-500">来源：{fair.sourceName}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onOpen} className="h-12 rounded-lg border border-blue-600 px-5 text-lg font-bold text-blue-700 transition active:scale-[0.98]">
          查看招聘会 <ChevronRightIcon className="inline h-5 w-5" />
        </button>
        {fair.status !== 'ended' && (
          <button onClick={onQr} className="h-12 rounded-lg border border-gray-300 px-5 text-lg font-bold text-gray-700 transition active:scale-[0.98]">
            <QrCodeIcon className="mr-1 inline h-5 w-5" />扫码预约
          </button>
        )}
      </div>
    </div>
  )
}

function FairSection({
  title,
  icon: Icon,
  tone,
  fairs,
  limit,
  expanded,
  onToggle,
  onOpen,
  onQr,
}: {
  title: string
  icon: typeof GraduationCapIcon
  tone: string
  fairs: ExternalJobFairDTO[]
  limit: number
  expanded: boolean
  onToggle: () => void
  onOpen: (fair: ExternalJobFairDTO) => void
  onQr: (fair: ExternalJobFairDTO) => void
}) {
  if (fairs.length === 0) return null
  const visibleFairs = expanded ? fairs : fairs.slice(0, limit)
  const hasMore = fairs.length > limit
  return (
    <section className="groupedCampusSections overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-gradient-to-r from-gray-50 to-white px-6 py-4">
        <div className="flex items-center gap-3">
          <Icon className={`h-7 w-7 ${tone}`} />
          <h2 className="text-2xl font-black text-gray-950">{title}</h2>
        </div>
        {hasMore && (
          <button onClick={onToggle} className="flex items-center gap-1 text-lg font-medium text-gray-500">
            {expanded ? '收起' : '更多场次'} <ChevronRightIcon className={`h-5 w-5 transition ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {visibleFairs.map((fair) => (
        <CampusFairRow key={fair.id} fair={fair} onOpen={() => onOpen(fair)} onQr={() => onQr(fair)} />
      ))}
    </section>
  )
}

function ServiceShortcut({ icon: Icon, title, desc, onClick }: { icon: typeof BotIcon; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="serviceShortcutCards flex min-h-[92px] items-center gap-4 rounded-xl border border-gray-200 bg-white px-6 text-left shadow-sm transition active:scale-[0.98]">
      <Icon className="h-10 w-10 text-blue-600" />
      <span>
        <span className="block text-xl font-black text-gray-950">{title}</span>
        <span className="mt-1 block text-base text-gray-500">{desc}</span>
      </span>
    </button>
  )
}

export function CampusPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [fairs, setFairs] = useState<ExternalJobFairDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [qrFair, setQrFair] = useState<ExternalJobFairDTO | null>(null)
  const [activeFilter, setActiveFilter] = useState<CampusFilterKind | null>(null)
  const [selectedSchool, setSelectedSchool] = useState('全部高校')
  const [selectedCity, setSelectedCity] = useState('全部城市')
  const [selectedStatus, setSelectedStatus] = useState('全部状态')
  const [selectedTime, setSelectedTime] = useState('全部时间')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    loadAllPublishedFairs()
      .then((data) => {
        if (cancelled) return
        setFairs(data.filter(isCampusFair))
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const schoolOptions = useMemo(
    () => ['全部高校', ...Array.from(new Set(fairs.map(schoolOf))).filter(Boolean)],
    [fairs],
  )
  const cityOptions = useMemo(
    () => ['全部城市', ...Array.from(new Set(fairs.map((fair) => fair.city).filter(Boolean) as string[]))],
    [fairs],
  )
  const statusOptions = ['全部状态', '进行中', '未开始', '已结束']
  const timeOptions = ['全部时间', '今天', '7天内', '本月']

  const visibleFairs = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const sevenDaysLater = new Date(today)
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)
    return fairs.filter((fair) => {
      const start = new Date(fair.startTime)
      const end = new Date(fair.endTime)
      if (selectedSchool !== '全部高校' && schoolOf(fair) !== selectedSchool) return false
      if (selectedCity !== '全部城市' && fair.city !== selectedCity) return false
      if (selectedStatus !== '全部状态' && STATUS_LABEL[fair.status] !== selectedStatus) return false
      if (selectedTime === '今天' && (start >= tomorrow || end < today)) return false
      if (selectedTime === '7天内' && (start >= sevenDaysLater || end < today)) return false
      if (selectedTime === '本月' && (start.getFullYear() !== today.getFullYear() || start.getMonth() !== today.getMonth())) return false
      return true
    })
  }, [fairs, selectedCity, selectedSchool, selectedStatus, selectedTime])

  const sortedFairs = useMemo(
    () => [...visibleFairs].sort((a, b) => statusRank(a.status) - statusRank(b.status) || new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [visibleFairs],
  )

  const featuredFair = sortedFairs.find((fair) => fair.status !== 'ended') ?? sortedFairs[0]
  const homeSchool = featuredFair ? schoolOf(featuredFair) : ''
  const currentCity = featuredFair?.city

  const homeFairs = useMemo(
    () => sortedFairs.filter((fair) => schoolOf(fair) === homeSchool),
    [homeSchool, sortedFairs],
  )
  const citySchoolFairs = useMemo(
    () => sortedFairs.filter((fair) => schoolOf(fair) !== homeSchool && isSchoolSource(fair) && (!currentCity || fair.city === currentCity)),
    [currentCity, homeSchool, sortedFairs],
  )
  const publicFairs = useMemo(
    () => sortedFairs.filter((fair) => !homeFairs.includes(fair) && !citySchoolFairs.includes(fair)),
    [citySchoolFairs, homeFairs, sortedFairs],
  )
  const toggleSection = (key: string) => setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))

  const openQr = (fair: ExternalJobFairDTO) => {
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQrFair(fair)
  }
  const openFair = (fair: ExternalJobFairDTO) => navigate(`/campus/${fair.id}`, { state: { fair } })

  if (loading) return <LoadingState className="h-full" />
  if (error) return <ErrorState message="校园招聘会数据加载失败，请稍后重试" onRetry={() => window.location.reload()} className="h-full" />

  const filterConfig = activeFilter === 'school'
    ? { title: '选择高校', options: schoolOptions, selected: selectedSchool, onSelect: setSelectedSchool }
    : activeFilter === 'city'
      ? { title: '选择城市', options: cityOptions, selected: selectedCity, onSelect: setSelectedCity }
      : activeFilter === 'status'
        ? { title: '选择状态', options: statusOptions, selected: selectedStatus, onSelect: setSelectedStatus }
        : activeFilter === 'time'
          ? { title: '选择时间', options: timeOptions, selected: selectedTime, onSelect: setSelectedTime }
          : null

  return (
    <div className="校园招聘会参考图首页 min-h-full bg-[#f7faff] text-gray-950">
      {qrFair && <QrModal fair={qrFair} onClose={() => setQrFair(null)} />}
      {filterConfig && <FilterSheet {...filterConfig} onClose={() => setActiveFilter(null)} />}

      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-8 py-6 backdrop-blur">
        <button className="absolute left-8 top-8 text-gray-900" onClick={() => navigate('/')}>
          <ChevronLeftIcon className="h-9 w-9" />
        </button>
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight">校园招聘会</h1>
          <p className="mt-1 text-xl text-gray-500">第三方/官方来源信息入口</p>
        </div>
      </header>

      <main className="mx-auto max-w-[943px] space-y-6 px-7 py-7">
        {featuredFair ? (
          <FeaturedCampusCard fair={featuredFair} onOpen={() => openFair(featuredFair)} />
        ) : (
          <EmptyState icon={GraduationCapIcon} title="暂无校园招聘会" description="当前没有已审核发布的真实校园招聘会数据" className="rounded-2xl bg-white py-20" />
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FilterButton icon={GraduationCapIcon} label={selectedSchool} active={selectedSchool !== '全部高校'} onClick={() => setActiveFilter('school')} />
          <FilterButton icon={MapPinIcon} label={selectedCity} active={selectedCity !== '全部城市'} onClick={() => setActiveFilter('city')} />
          <FilterButton icon={FilterIcon} label={selectedStatus} active={selectedStatus !== '全部状态'} onClick={() => setActiveFilter('status')} />
          <FilterButton icon={CalendarDaysIcon} label={selectedTime} active={selectedTime !== '全部时间'} onClick={() => setActiveFilter('time')} />
        </div>

        <FairSection title="本校场次" icon={Building2Icon} tone="text-blue-600" fairs={homeFairs} limit={3} expanded={!!expandedSections.home} onToggle={() => toggleSection('home')} onOpen={openFair} onQr={openQr} />
        <FairSection title="同城高校" icon={LandmarkIcon} tone="text-orange-500" fairs={citySchoolFairs} limit={4} expanded={!!expandedSections.city} onToggle={() => toggleSection('city')} onOpen={openFair} onQr={openQr} />
        <FairSection title="公共就业机构" icon={FactoryIcon} tone="text-emerald-600" fairs={publicFairs} limit={4} expanded={!!expandedSections.public} onToggle={() => toggleSection('public')} onOpen={openFair} onQr={openQr} />

        {fairs.length > 0 && sortedFairs.length === 0 && (
          <EmptyState icon={GraduationCapIcon} title="没有符合筛选的场次" description="请调整高校、城市、状态或时间筛选条件" className="rounded-2xl bg-white py-20" />
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <ServiceShortcut icon={FileSearchIcon} title="AI简历诊断" desc="智能分析，优化建议" onClick={() => navigate('/resume/source?intent=diagnose')} />
          <ServiceShortcut icon={PrinterIcon} title="活动资料打印" desc="参会指南、企业名录" onClick={() => featuredFair && navigate(`/campus/${featuredFair.id}/materials`)} />
          <ServiceShortcut icon={MapIcon} title="场馆导览" desc="平面图、交通指引" onClick={() => featuredFair && navigate(`/campus/${featuredFair.id}`)} />
        </div>

        <p className="flex items-center justify-center gap-2 pb-5 text-center text-base text-gray-500">
          <ShieldCheckIcon className="h-5 w-5" />
          {COMPLIANCE_COPY.KIOSK_CAMPUS_TOP}
        </p>
      </main>
    </div>
  )
}
