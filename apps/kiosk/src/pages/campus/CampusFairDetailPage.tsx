import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  makePrintParams,
  type ExternalJobFairDTO,
  type FairCompanyDTO,
  type FairLiveStatsDTO,
  type FairMaterialDTO,
  type FairVenueGuideDTO,
  type FairZoneDTO,
} from '@ai-job-print/shared'
import {
  BotIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  FileTextIcon,
  GraduationCapIcon,
  MapIcon,
  MapPinIcon,
  NavigationIcon,
  PrinterIcon,
  QrCodeIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import {
  getFairCompanies,
  getFairMaterials,
  getFairStats,
  getFairVenueGuide,
  getFairZones,
  getJobFairById,
} from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { buildNavUrl } from '../../lib/url'
import { MapBlock } from '../job-fairs/components/MapBlock'

const TABS = ['活动概览', '参展企业与岗位', '场馆导览', '活动资料', 'AI求职准备'] as const
type TabKey = (typeof TABS)[number]
const FAIR_RESOURCE_PAGE_SIZE = 100
// 熔断:坏后端把 totalPages 返回成超大值时,最多拉 50 页就停,避免一体机被拖死。
const MAX_FAIR_PAGE_LOAD = 50

const STATUS_LABEL: Record<ExternalJobFairDTO['status'], string> = {
  upcoming: '未开始',
  ongoing: '进行中',
  ended: '已结束',
}

const STATUS_STYLE: Record<ExternalJobFairDTO['status'], string> = {
  upcoming: 'bg-orange-100 text-orange-700',
  ongoing: 'bg-emerald-100 text-emerald-700',
  ended: 'bg-gray-100 text-gray-500',
}

function schoolOf(fair: ExternalJobFairDTO): string {
  return fair.hostSchoolName || fair.sourceName || fair.organizer || '其他来源'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日`
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}（${weekdays[d.getDay()]}）`
}

function formatTimeRange(fair: ExternalJobFairDTO): string {
  const start = new Date(fair.startTime)
  const end = new Date(fair.endTime)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(start.getHours())}:${p(start.getMinutes())} - ${p(end.getHours())}:${p(end.getMinutes())}`
}

function formatSize(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

// 子资源加载结果:区分「接口失败」(failed=true) 与「真实为空」(failed=false),
// 让 UI 用 ErrorState / EmptyState 分别表达,而非把 4xx/5xx 静默吞成空态。
async function settle<T>(promise: Promise<T>, fallback: T): Promise<{ data: T; failed: boolean }> {
  try {
    return { data: await promise, failed: false }
  } catch {
    return { data: fallback, failed: true }
  }
}

async function loadAllFairCompanies(fairId: string): Promise<FairCompanyDTO[]> {
  const all: FairCompanyDTO[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await getFairCompanies(fairId, { page, pageSize: FAIR_RESOURCE_PAGE_SIZE })
    const pageData = Array.isArray(res.data) ? res.data : []
    all.push(...pageData)
    totalPages = res.pagination?.totalPages ?? (pageData.length < FAIR_RESOURCE_PAGE_SIZE ? page : page + 1)
    page += 1
  } while (page <= totalPages && page <= MAX_FAIR_PAGE_LOAD)
  return all
}

async function loadAllFairMaterials(fairId: string): Promise<FairMaterialDTO[]> {
  const all: FairMaterialDTO[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await getFairMaterials(fairId, { page, pageSize: FAIR_RESOURCE_PAGE_SIZE })
    const pageData = Array.isArray(res.data) ? res.data : []
    all.push(...pageData)
    totalPages = res.pagination?.totalPages ?? (pageData.length < FAIR_RESOURCE_PAGE_SIZE ? page : page + 1)
    page += 1
  } while (page <= totalPages && page <= MAX_FAIR_PAGE_LOAD)
  return all
}

function QrModal({
  title,
  subtitle,
  value,
  note,
  onClose,
}: {
  title: string
  subtitle?: string
  value: string | undefined | null
  note: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="relative w-[360px] rounded-3xl bg-white p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label="关闭">
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-lg font-black text-gray-950">{title}</p>
        {subtitle && <p className="mt-1 line-clamp-1 text-center text-sm text-gray-500">{subtitle}</p>}
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={value} size={190} />
        </div>
        <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-700">{note}</p>
      </div>
    </div>
  )
}

type QrState =
  | { kind: 'appointment'; value: string }
  | { kind: 'source'; value: string }
  | { kind: 'apply'; value: string; companyName: string }
  | { kind: 'nav'; value: string }
  | null

export function CampusFairDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const stateFair = (location.state as { fair?: ExternalJobFairDTO } | null)?.fair
  const hasStateFair = stateFair?.id === id

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(hasStateFair ? stateFair! : null)
  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones, setZones] = useState<FairZoneDTO[]>([])
  const [materials, setMaterials] = useState<FairMaterialDTO[]>([])
  const [stats, setStats] = useState<FairLiveStatsDTO | null>(null)
  const [venueGuide, setVenueGuide] = useState<FairVenueGuideDTO | null>(null)
  const [tab, setTab] = useState<TabKey>('活动概览')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(!hasStateFair)
  const [error, setError] = useState(false)
  const [qr, setQr] = useState<QrState>(null)
  // 子资源级 error(区分「接口失败」与「真实为空」)+ 重试 key
  const [resourceKey, setResourceKey] = useState(0)
  const [companiesError, setCompaniesError] = useState(false)
  const [materialsError, setMaterialsError] = useState(false)
  const [venueGuideError, setVenueGuideError] = useState(false)

  useEffect(() => {
    if (hasStateFair || !id) return
    let cancelled = false
    getJobFairById(id)
      .then((res) => {
        if (cancelled) return
        setFair(res.data)
        if (!res.data) setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [hasStateFair, id])

  useEffect(() => {
    if (!fair) return
    recordBrowse(getToken(), 'job_fair', fair.id)
  }, [fair, getToken])

  useEffect(() => {
    if (!fair) return
    let cancelled = false
    Promise.all([
      settle(loadAllFairCompanies(fair.id), [] as FairCompanyDTO[]),
      settle(getFairZones(fair.id).then((r) => r.data), [] as FairZoneDTO[]),
      settle(getFairStats(fair.id).then((r) => r.data), null as FairLiveStatsDTO | null),
      settle(loadAllFairMaterials(fair.id), [] as FairMaterialDTO[]),
      settle(getFairVenueGuide(fair.id).then((r) => r.data), null as FairVenueGuideDTO | null),
    ]).then(([c, z, s, m, v]) => {
      if (cancelled) return
      setCompanies(c.data)
      setCompaniesError(c.failed)
      setZones(z.data)
      setStats(s.data)
      setMaterials(m.data)
      setMaterialsError(m.failed)
      setVenueGuide(v.data)
      setVenueGuideError(v.failed)
    })
    return () => { cancelled = true }
  }, [fair, resourceKey])

  const reloadResources = () => setResourceKey((k) => k + 1)

  const handlePrintMaterial = (material: FairMaterialDTO) => {
    // 与 FairMaterialsPage 同口径:仅 allowPrint && 有签名 previewUrl 时直接打印对应资料。
    if (!material.allowPrint || !material.previewUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: material.name,
          size: formatSize(material.fileSizeKB),
          pages: material.pageCount > 0 ? material.pageCount : null,
          fileUrl: material.previewUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({
          copies: 1,
          duplex: material.pageCount > 1 ? 'double' : 'single',
          color: 'bw',
        }),
      },
    })
  }

  useEffect(() => {
    if (companies.length === 0) {
      setSelectedCompanyId(null)
      return
    }
    if (!selectedCompanyId || !companies.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(companies[0].id)
    }
  }, [companies, selectedCompanyId])

  const totalPositions = useMemo(
    () => companies.reduce((sum, company) => sum + company.positions.length, 0),
    [companies],
  )

  if (loading) return <LoadingState className="h-full" />
  if (error || !fair) return <ErrorState message="校园招聘会数据未找到，请返回列表重试" onRetry={() => navigate('/campus')} className="h-full" />

  const navUrl = buildNavUrl({ latitude: fair.latitude, longitude: fair.longitude, venue: fair.venue, address: fair.address })
  const openAppointment = () => {
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQr({ kind: 'appointment', value: fair.sourceUrl })
  }
  const openSource = () => {
    setQr({ kind: 'source', value: fair.sourceUrl })
  }
  const openApply = (company: FairCompanyDTO) => {
    recordExternalJump(getToken(), 'fair_company', company.id, 'external_apply')
    setQr({ kind: 'apply', value: company.sourceUrl || fair.sourceUrl, companyName: company.companyName })
  }

  return (
    <div className="校园招聘会参考图详情 min-h-full bg-[#f7faff] text-gray-950">
      {qr?.kind === 'appointment' && (
        <QrModal title="扫码预约" subtitle={fair.name} value={qr.value} note={COMPLIANCE_COPY.KIOSK_FAIRS_TOP} onClose={() => setQr(null)} />
      )}
      {qr?.kind === 'source' && (
        <QrModal title="扫码查看来源平台" subtitle={fair.name} value={qr.value} note={COMPLIANCE_COPY.KIOSK_CAMPUS_TOP} onClose={() => setQr(null)} />
      )}
      {qr?.kind === 'apply' && (
        <QrModal title="扫码投递" subtitle={qr.companyName} value={qr.value} note={COMPLIANCE_COPY.KIOSK_CAMPUS_TOP} onClose={() => setQr(null)} />
      )}
      {qr?.kind === 'nav' && (
        <QrModal title="扫码在手机上导航" subtitle={fair.venue} value={qr.value} note="请使用手机扫码，在手机地图中打开场馆位置。" onClose={() => setQr(null)} />
      )}

      {tab === '参展企业与岗位' ? (
        <CompanyPageShell fair={fair} tab={tab} onTabChange={setTab} onBack={() => navigate('/campus')}>
          <CompaniesTab companies={companies} error={companiesError} onRetry={reloadResources} selectedCompanyId={selectedCompanyId} onSelectCompany={setSelectedCompanyId} onApply={openApply} onOpenVenue={() => setTab('场馆导览')} />
        </CompanyPageShell>
      ) : tab === '场馆导览' || tab === '活动资料' || tab === 'AI求职准备' ? (
        <ResourcePageShell fair={fair} active={tab} onTabChange={setTab} onBack={() => navigate('/campus')}>
          <VenueMaterialsAiPanel
            fair={fair}
            zones={zones}
            venueGuide={venueGuide}
            venueGuideError={venueGuideError}
            materials={materials}
            materialsError={materialsError}
            navUrl={navUrl}
            onNav={() => navUrl && setQr({ kind: 'nav', value: navUrl })}
            onNavigate={navigate}
            onRetry={reloadResources}
            onOpenCompanies={() => setTab('参展企业与岗位')}
            onOpenMaterials={() => navigate(`/campus/${fair.id}/materials`)}
            onPrintMaterial={handlePrintMaterial}
          />
        </ResourcePageShell>
      ) : (
        <OverviewPageShell fair={fair} tab={tab} onTabChange={setTab} onBack={() => navigate('/campus')} onAppointment={openAppointment} onSource={openSource}>
          <OverviewTab fair={fair} companyCount={companies.length} totalPositions={totalPositions} stats={stats} onTabChange={setTab} />
        </OverviewPageShell>
      )}
    </div>
  )
}

function DetailTitleBar({ fair, onBack, compact = false }: { fair: ExternalJobFairDTO; onBack: () => void; compact?: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-7 py-5 backdrop-blur">
      <div className="grid grid-cols-[90px_1fr_90px] items-start gap-3 sm:grid-cols-[180px_1fr_180px]">
        <button onClick={onBack} className="flex items-center gap-2 pt-1 text-xl font-bold text-blue-600">
          <ChevronLeftIcon className="h-7 w-7" />
          <span className="hidden sm:inline">{compact ? '返回' : '返回校园招聘会'}</span>
          <span className="sm:hidden">返回</span>
        </button>
        <div className="min-w-0 text-center">
          <h1 className="break-words text-4xl font-black leading-tight">{fair.name}</h1>
        {compact && (
          <p className="mt-2 flex items-center justify-center gap-4 text-base text-gray-500">
            <span className="flex items-center gap-1 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />{STATUS_LABEL[fair.status]}</span>
            <span>{formatShortDate(fair.startTime)} {formatTimeRange(fair)}</span>
            <span className="inline-flex items-center gap-1"><MapPinIcon className="h-4 w-4" />{fair.venue}</span>
          </p>
        )}
        </div>
        <div />
      </div>
    </header>
  )
}

function OverviewHero({
  fair,
  onAppointment,
  onSource,
}: {
  fair: ExternalJobFairDTO
  onAppointment: () => void
  onSource: () => void
}) {
  return (
    <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#1179f5] via-[#2086f7] to-[#0a477f] p-8 text-white shadow-lg">
      <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.28),transparent_58%)] opacity-80 sm:block" />
      <div className="relative grid gap-7 sm:grid-cols-[1fr_1fr]">
        <div>
          <div className="flex items-center gap-5">
            <CampusSeal name={schoolOf(fair)} />
            <div>
              <h2 className="text-4xl font-black">{schoolOf(fair)}</h2>
              <span className={`mt-2 inline-flex rounded-lg px-3 py-1 text-base font-bold ${STATUS_STYLE[fair.status]}`}>{STATUS_LABEL[fair.status]}</span>
            </div>
          </div>
          <div className="mt-6 space-y-4 text-xl">
            <p className="flex items-center gap-3"><CalendarDaysIcon className="h-6 w-6" />{formatDate(fair.startTime)} {formatTimeRange(fair)}</p>
            <p className="flex items-center gap-3"><MapPinIcon className="h-6 w-6" />{fair.venue}</p>
            <p className="flex items-center gap-3"><MapPinIcon className="h-6 w-6" />{fair.city || fair.address || '地点以来源平台为准'}</p>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {fair.status !== 'ended' && (
              <button onClick={onAppointment} className="flex h-20 items-center justify-center gap-4 rounded-lg border border-white/70 bg-white/10 text-xl font-black backdrop-blur transition active:scale-[0.98]">
                <QrCodeIcon className="h-10 w-10" />扫码预约
              </button>
            )}
            <button onClick={onSource} className="flex h-20 items-center justify-center gap-4 rounded-lg bg-white text-xl font-black text-blue-700 transition active:scale-[0.98]">
              <ExternalLinkIcon className="h-10 w-10" />查看来源平台
            </button>
          </div>
        </div>
        <div className="flex flex-col justify-end gap-4 text-lg">
          <InfoLine icon={Building2Icon} label="来源机构" value={fair.sourceName} />
          <InfoLine icon={ClipboardListIcon} label="外部活动ID" value={fair.externalId} />
          <InfoLine icon={CalendarDaysIcon} label="数据同步时间" value={fair.syncTime} />
        </div>
      </div>
    </section>
  )
}

function OverviewPageShell({
  fair,
  tab,
  onTabChange,
  onBack,
  onAppointment,
  onSource,
  children,
}: {
  fair: ExternalJobFairDTO
  tab: TabKey
  onTabChange: (tab: TabKey) => void
  onBack: () => void
  onAppointment: () => void
  onSource: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <DetailTitleBar fair={fair} onBack={onBack} />
      <main className="mx-auto max-w-[930px] space-y-4 p-5">
        <OverviewHero fair={fair} onAppointment={onAppointment} onSource={onSource} />
        <TabBar active={tab} onChange={onTabChange} tabs={TABS} />
        {children}
      </main>
    </>
  )
}

function CompanyPageShell({
  fair,
  tab,
  onTabChange,
  onBack,
  children,
}: {
  fair: ExternalJobFairDTO
  tab: TabKey
  onTabChange: (tab: TabKey) => void
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <DetailTitleBar fair={fair} onBack={onBack} compact />
      <main className="mx-auto max-w-[940px] space-y-4 p-5">
        <TabBar active={tab} onChange={onTabChange} tabs={['活动概览', '参展企业与岗位', '场馆导览', '活动资料'] as const} />
        {children}
      </main>
    </>
  )
}

function ResourcePageShell({
  fair,
  active,
  onTabChange,
  onBack,
  children,
}: {
  fair: ExternalJobFairDTO
  active: TabKey
  onTabChange: (tab: TabKey) => void
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto max-w-[940px] rounded-2xl bg-white p-7 shadow-sm">
      <div className="mb-6 flex items-start justify-between">
        <button onClick={onBack} className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-blue-100 text-lg font-bold text-gray-700">
          <ChevronLeftIcon className="h-8 w-8" />返回
        </button>
        <div className="min-w-0 flex-1 px-8">
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black">{fair.name}</h1>
            <span className={`rounded-lg px-3 py-1 text-lg font-bold ${STATUS_STYLE[fair.status]}`}>{STATUS_LABEL[fair.status]}</span>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-5 text-lg text-gray-600">
            <span className="inline-flex items-center gap-2"><CalendarDaysIcon className="h-5 w-5 text-blue-600" />{formatShortDate(fair.startTime)} {formatTimeRange(fair)}</span>
            <span className="inline-flex items-center gap-2"><MapPinIcon className="h-5 w-5 text-blue-600" />{fair.venue}</span>
          </p>
        </div>
        <div className="h-14 w-24" />
      </div>
      <TabBar active={active} onChange={onTabChange} tabs={['场馆导览', '活动资料', 'AI求职准备'] as const} large />
      {children}
    </main>
  )
}

function TabBar<T extends string>({
  active,
  onChange,
  tabs,
  large = false,
}: {
  active: string
  onChange: (tab: T) => void
  tabs: readonly T[]
  large?: boolean
}) {
  return (
    <nav className="grid rounded-t-xl border-b border-gray-200 bg-white" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={`relative flex h-16 items-center justify-center gap-2 text-xl font-bold ${large ? 'h-20 text-2xl' : ''} ${active === item ? 'text-blue-600' : 'text-gray-600'}`}
        >
          {tabIcon(item)}
          {item}
          {active === item && <span className="absolute bottom-0 h-1 w-28 rounded-full bg-blue-600" />}
        </button>
      ))}
    </nav>
  )
}

function tabIcon(tab: string) {
  if (tab === '活动概览') return <ClipboardListIcon className="h-5 w-5" />
  if (tab === '参展企业与岗位') return <Building2Icon className="h-5 w-5" />
  if (tab === '场馆导览') return <MapIcon className="h-6 w-6" />
  if (tab === '活动资料') return <FileTextIcon className="h-6 w-6" />
  return <BotIcon className="h-6 w-6" />
}

function CampusSeal({ name }: { name: string }) {
  const text = name.replace(/就业指导中心|学生就业|大学|学院|学校|中心/g, '').slice(0, 2) || '校招'
  return <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-white/80 bg-white text-center text-lg font-black leading-tight text-blue-700">{text}</div>
}

function InfoLine({ icon: Icon, label, value }: { icon: typeof Building2Icon; label: string; value: string | number | undefined | null }) {
  if (!value) return null
  return (
    <p className="flex items-center gap-3">
      <Icon className="h-6 w-6" />
      <span className="font-bold">{label}：</span>
      <span>{value}</span>
    </p>
  )
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="h-7 w-1 rounded-full bg-blue-600" />
      <h2 className="text-2xl font-black text-gray-950">{title}</h2>
      {sub && <span className="text-base text-gray-400">{sub}</span>}
    </div>
  )
}

function OverviewTab({
  fair,
  companyCount,
  totalPositions,
  stats,
  onTabChange,
}: {
  fair: ExternalJobFairDTO
  companyCount: number
  totalPositions: number
  stats: FairLiveStatsDTO | null
  onTabChange: (tab: TabKey) => void
}) {
  const statsItems: Array<{ label: string; value: string | number; icon: typeof UsersIcon }> = [
    { label: '预计到场人数', value: stats?.expectedAttendance ?? fair.expectedAttendance ?? 0, icon: UsersIcon },
    { label: '参展企业数量', value: companyCount || fair.managedCompanyCount || fair.boothCount || 0, icon: Building2Icon },
    { label: '提供岗位数量', value: totalPositions || fair.jobCount || stats?.totalPositions || 0, icon: BriefcaseBusinessIcon },
    { label: '面向学生范围', value: fair.audienceLabel || '以来源平台为准', icon: GraduationCapIcon },
  ]
  // 诚实性:面向人群仅在后端有 audienceLabel 时按真实值渲染,不再用写死示例数组冒充。
  const audiences = fair.audienceLabel ? fair.audienceLabel.split(/[、,，/]/).map((s) => s.trim()).filter(Boolean) : []
  // 现场服务同样只渲染后端真实录入项;为空则整段隐藏(不造占位)。
  const onsiteServices = fair.onsiteServices?.length ? fair.onsiteServices : []
  return (
    <div className="rounded-b-xl border border-t-0 border-gray-200 bg-white p-6">
      <div className="grid gap-6 md:grid-cols-[1fr_270px]">
        <div className="space-y-7">
          <section>
            <SectionTitle title="活动介绍" />
            <p className="text-lg leading-9 text-gray-700">{fair.description || '暂无活动介绍，详情以来源平台为准'}</p>
          </section>
          <section>
            <SectionTitle title="面向人群" />
            {audiences.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {audiences.map((item) => (
                  <span key={item} className="rounded-full border border-blue-200 bg-blue-50 px-5 py-2 text-lg font-bold text-blue-700">{item}</span>
                ))}
              </div>
            ) : (
              <p className="text-base text-gray-500">暂无面向人群信息，详情以来源平台为准</p>
            )}
            <div className="mt-5 grid grid-cols-2 rounded-xl border border-gray-200 bg-white sm:grid-cols-4">
              {statsItems.map(({ label, value, icon: Icon }, index) => (
                <div key={label} className={`px-4 py-4 text-center ${index > 0 ? 'border-l border-gray-100' : ''}`}>
                  <Icon className="mx-auto h-8 w-8 text-blue-600" />
                  <p className="mt-2 text-sm text-gray-500">{label}</p>
                  <p className="mt-1 text-2xl font-black text-gray-950">{value}</p>
                </div>
              ))}
            </div>
          </section>
          {onsiteServices.length > 0 && (
            <section>
              <SectionTitle title="现场服务" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {onsiteServices.map((item) => (
                  <div key={item} className="rounded-lg bg-white px-3 py-3 text-center text-blue-700">
                    <SparklesIcon className="mx-auto h-7 w-7" />
                    <p className="mt-1 text-base font-bold">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="rounded-xl border border-gray-200 p-5">
            <SectionTitle title="准备清单" sub="建议提前完成，提升求职效率" />
            {[
              { title: '打印简历', desc: '使用本机打印简历，建议多准备几份', icon: PrinterIcon, action: () => onTabChange('活动资料') },
              { title: 'AI简历诊断', desc: '智能分析简历，提供优化建议', icon: FileSearchIcon, action: () => onTabChange('AI求职准备') },
              { title: '查看参展企业', desc: '浏览企业列表，了解岗位信息', icon: Building2Icon, action: () => onTabChange('参展企业与岗位') },
              { title: '场馆路线', desc: '查看场馆布局与路线指引', icon: MapIcon, action: () => onTabChange('场馆导览') },
            ].map(({ title, desc, icon: Icon, action }) => (
              <button key={title} onClick={action} className="flex w-full items-center justify-between border-t border-gray-100 py-3 first:border-t-0">
                <span className="flex items-center gap-4">
                  <Icon className="h-9 w-9 rounded-lg bg-blue-50 p-2 text-blue-600" />
                  <span className="text-left">
                    <span className="block text-xl font-bold text-gray-900">{title}</span>
                    <span className="text-base text-gray-500">{desc}</span>
                  </span>
                </span>
                <ChevronRightIcon className="h-6 w-6 text-gray-400" />
              </button>
            ))}
          </section>
        </div>
        <aside className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
          <SectionTitle title="来源信息" />
          <div className="space-y-4 text-lg">
            <div><p className="font-bold text-blue-700">来源机构</p><p className="mt-1 text-gray-700">{fair.sourceName}</p></div>
            <div><p className="font-bold text-blue-700">来源平台</p><p className="mt-1 text-gray-700">{fair.sourceName}</p></div>
            <div><p className="font-bold text-blue-700">官方页面</p><div className="mt-3 flex justify-center"><SourceUrlQr value={fair.sourceUrl} size={150} /></div><p className="mt-2 text-center text-sm text-gray-500">扫码访问官方发布页面</p></div>
            <div><p className="font-bold text-blue-700">来源链接</p><p className="mt-1 break-all text-blue-600">{fair.sourceUrl}</p></div>
            <div><p className="font-bold text-blue-700">数据来源说明</p><p className="mt-1 text-base leading-7 text-gray-600">{fair.dataSourceNote || COMPLIANCE_COPY.KIOSK_CAMPUS_TOP}</p></div>
          </div>
        </aside>
      </div>
      <p className="mt-7 rounded-lg bg-blue-50 px-4 py-3 text-center text-base font-bold text-blue-700">{COMPLIANCE_COPY.KIOSK_CAMPUS_TOP}</p>
    </div>
  )
}

function CompaniesTab({
  companies,
  error,
  onRetry,
  selectedCompanyId,
  onSelectCompany,
  onApply,
  onOpenVenue,
}: {
  companies: FairCompanyDTO[]
  error: boolean
  onRetry: () => void
  selectedCompanyId: string | null
  onSelectCompany: (companyId: string) => void
  onApply: (company: FairCompanyDTO) => void
  onOpenVenue: () => void
}) {
  const [query, setQuery] = useState('')
  const [industryFilter, setIndustryFilter] = useState('全部')
  const [roleFilter, setRoleFilter] = useState('全部')
  const [sourceFilter, setSourceFilter] = useState('全部')
  const [hallFilter, setHallFilter] = useState('全部')
  const industryOptions = useMemo(() => ['全部', ...Array.from(new Set(companies.map((company) => company.industry).filter(Boolean)))], [companies])
  const hallOptions = useMemo(() => ['全部', ...Array.from(new Set(companies.map((company) => company.zoneName || company.boothNumber?.match(/^[A-Z]/)?.[0]).filter(Boolean) as string[]))], [companies])
  const roleOptions = ['全部', '研发技术', '产品运营', '金融财会', '教育科研', '医疗健康']
  const sourceOptions = ['全部', '有来源链接', '无来源链接']
  const filteredCompanies = useMemo(() => companies.filter((company) => {
    const haystack = `${company.companyName} ${company.industry} ${company.scale} ${company.description ?? ''} ${company.positions.map((position) => `${position.title} ${position.department ?? ''} ${position.requirements ?? ''}`).join(' ')}`
    if (query.trim() && !haystack.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (industryFilter !== '全部' && company.industry !== industryFilter) return false
    if (sourceFilter === '有来源链接' && !company.sourceUrl) return false
    if (sourceFilter === '无来源链接' && company.sourceUrl) return false
    if (hallFilter !== '全部' && company.zoneName !== hallFilter && company.boothNumber?.match(/^[A-Z]/)?.[0] !== hallFilter) return false
    if (roleFilter !== '全部' && !company.positions.some((position) => `${position.title} ${position.department ?? ''} ${position.requirements ?? ''}`.includes(roleFilter))) return false
    return true
  }), [companies, hallFilter, industryFilter, query, roleFilter, sourceFilter])

  if (error && companies.length === 0) return <ErrorState message="参展企业加载失败，请重试" onRetry={onRetry} className="rounded-xl bg-white py-20" />
  if (companies.length === 0) return <EmptyState icon={Building2Icon} title="暂无参展企业" description="该招聘会暂未录入参展企业与岗位" className="rounded-xl bg-white py-20" />
  const activeCompany = filteredCompanies.find((company) => company.id === selectedCompanyId) ?? filteredCompanies[0]
  const positionCount = companies.reduce((sum, company) => sum + company.positions.length, 0)
  const hallNames = Array.from(new Set(companies.map((company) => company.zoneName || company.boothNumber?.match(/^[A-Z]/)?.[0]).filter(Boolean) as string[]))
  const hallLabel = hallNames.length > 0 ? hallNames.slice(0, 3).join(' / ') : '现场公布'
  const resetFilters = () => {
    setQuery('')
    setIndustryFilter('全部')
    setRoleFilter('全部')
    setSourceFilter('全部')
    setHallFilter('全部')
  }
  return (
    <div className="space-y-4">
      <div className="grid rounded-xl border border-gray-200 bg-white shadow-sm sm:grid-cols-3">
        <MetricCard icon={Building2Icon} value={`${companies.length}`} label="家企业" />
        <MetricCard icon={BriefcaseBusinessIcon} value={`${positionCount}+`} label="岗位" />
        <MetricCard icon={MapPinIcon} value={hallLabel} label="展厅" />
      </div>
      <div className="grid gap-4 md:grid-cols-[235px_1fr]">
        <aside className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 w-full rounded-full bg-gray-100 pl-10 pr-4 text-base outline-none" placeholder="搜索企业或岗位" />
          </div>
          <FilterGroup title="行业筛选" items={industryOptions} selected={industryFilter} onSelect={setIndustryFilter} />
          <FilterGroup title="职位类别" items={roleOptions} selected={roleFilter} onSelect={setRoleFilter} />
          <FilterGroup title="来源筛选" items={sourceOptions} selected={sourceFilter} onSelect={setSourceFilter} />
          <FilterGroup title="展厅筛选" items={hallOptions} selected={hallFilter} onSelect={setHallFilter} />
          <button onClick={resetFilters} className="mt-8 h-12 w-full rounded-lg border border-gray-400 text-base font-bold text-gray-600">清空筛选</button>
        </aside>
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xl font-bold text-gray-900">共 {filteredCompanies.length} 家企业</p>
              <span className="flex items-center gap-1 text-base font-medium text-gray-500">按岗位数量排序 <ChevronDownIcon className="h-4 w-4" /></span>
            </div>
            <div className="space-y-3">
              {filteredCompanies.length === 0 && <EmptyState icon={Building2Icon} title="没有符合筛选的企业" description="请调整搜索关键词或筛选条件" className="py-12" />}
              {filteredCompanies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => onSelectCompany(company.id)}
                  className={`grid w-full grid-cols-[64px_1fr_auto] items-center gap-4 rounded-xl border px-4 py-4 text-left ${
                    activeCompany.id === company.id ? 'border-blue-600 bg-blue-50/40' : 'border-gray-200 bg-white'
                  }`}
                >
                  <CompanyLogo name={company.companyName} />
                  <span>
                    <span className="block text-lg font-black text-gray-950">{company.companyName}</span>
                    <span className="mt-1 block text-sm text-gray-500">{company.industry} · {company.scale}</span>
                    <span className="mt-2 flex flex-wrap gap-2">{company.positions.slice(0, 3).map((position) => <span key={position.id} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{position.title}</span>)}</span>
                  </span>
                  <span className="flex items-center gap-4 text-base text-gray-700">{company.positions.length} 个岗位 <ShieldCheckIcon className="h-5 w-5 text-emerald-600" /> <ChevronRightIcon className="h-5 w-5" /></span>
                </button>
              ))}
            </div>
          </div>
          {activeCompany && <div className="grid gap-4 md:grid-cols-[1fr_235px]">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start gap-4">
                <CompanyLogo name={activeCompany.companyName} />
                <div>
                  <h2 className="text-2xl font-black">{activeCompany.companyName}</h2>
                  <p className="mt-1 text-base text-gray-500">{activeCompany.industry} · {activeCompany.scale}</p>
                </div>
              </div>
              {activeCompany.description && <p className="mt-4 text-base leading-8 text-gray-600">{activeCompany.description}</p>}
              <p className="mt-5 flex items-center gap-2 text-lg font-bold text-gray-900"><MapPinIcon className="h-5 w-5 text-blue-600" />展位信息以现场导览为准</p>
              <button onClick={onOpenVenue} className="mt-2 flex items-center gap-2 text-base font-bold text-blue-600">查看在地图中的位置</button>
              <SectionTitle title={`该企业招聘岗位（${activeCompany.positions.length}）`} />
              <div className="space-y-3">
                {activeCompany.positions.map((position) => (
                  <div key={position.id} className="rounded-xl border border-gray-200 px-4 py-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-lg font-black text-gray-950">{position.title}</p>
                        <p className="mt-1 text-sm text-gray-500">{[position.location, position.education, position.experience].filter(Boolean).join(' · ') || '岗位要求以来源平台为准'}</p>
                      </div>
                      {position.salary && <p className="text-lg font-bold text-emerald-600">{position.salary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <aside className="rounded-xl bg-blue-50 p-5 text-center">
              <ShieldCheckIcon className="mx-auto h-9 w-9 text-emerald-600" />
              <p className="mt-2 text-xl font-black text-gray-950">投递方式说明</p>
              <p className="mt-3 text-base leading-7 text-gray-600">本场招聘会岗位信息来源于合作单位或企业官方发布。</p>
              <p className="mt-1 text-base font-bold text-red-500">本系统不接收简历。</p>
              <div className="mt-5 flex justify-center"><SourceUrlQr value={activeCompany.sourceUrl} size={150} /></div>
              {activeCompany.sourceUrl && <button onClick={() => onApply(activeCompany)} className="mt-5 h-14 w-full rounded-lg bg-blue-600 text-xl font-black text-white">扫码投递</button>}
              {activeCompany.sourceUrl && <button onClick={() => onApply(activeCompany)} className="mt-4 h-14 w-full rounded-lg border border-blue-300 bg-white text-lg font-bold text-blue-700">去来源平台投递 <ExternalLinkIcon className="inline h-4 w-4" /></button>}
            </aside>
          </div>}
        </section>
      </div>
      <p className="text-center text-sm text-gray-500">内容由参展单位提供，如有变动，请以现场为准</p>
    </div>
  )
}

function MetricCard({ icon: Icon, value, label }: { icon: typeof Building2Icon; value: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-4 px-6 py-6">
      <Icon className="h-12 w-12 rounded-full bg-blue-50 p-3 text-blue-600" />
      <div><p className="text-3xl font-black text-gray-950">{value}</p><p className="text-base text-gray-500">{label}</p></div>
    </div>
  )
}

function FilterGroup({ title, items, selected, onSelect }: { title: string; items: string[]; selected: string; onSelect: (item: string) => void }) {
  return (
    <div className="mt-6 border-t border-gray-100 pt-5">
      <div className="mb-3 flex items-center justify-between"><p className="text-lg font-black text-gray-900">{title}</p><span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">{selected}</span></div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => <button key={item} onClick={() => onSelect(item)} className={`h-11 rounded-lg text-base font-bold ${selected === item ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{item}</button>)}
      </div>
    </div>
  )
}

function CompanyLogo({ name }: { name: string }) {
  return <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 text-center text-sm font-black leading-tight text-white">{name.slice(0, 2)}</div>
}

function VenueMaterialsAiPanel({
  fair,
  zones,
  venueGuide,
  venueGuideError,
  materials,
  materialsError,
  navUrl,
  onNav,
  onNavigate,
  onRetry,
  onOpenCompanies,
  onOpenMaterials,
  onPrintMaterial,
}: {
  fair: ExternalJobFairDTO
  zones: FairZoneDTO[]
  venueGuide: FairVenueGuideDTO | null
  venueGuideError: boolean
  materials: FairMaterialDTO[]
  materialsError: boolean
  navUrl: string | null
  onNav: () => void
  onNavigate: (to: string) => void
  onRetry: () => void
  onOpenCompanies: () => void
  onOpenMaterials: () => void
  onPrintMaterial: (material: FairMaterialDTO) => void
}) {
  const hallList = venueGuide?.halls ?? zones.map((zone) => ({ hallId: zone.id, hallCode: zone.zoneName, hallName: zone.zoneName, companyCount: zone.boothCount, boothRange: `${zone.boothCount} 个展位`, industryCategory: zone.description }))
  return (
    <div className="space-y-6 border border-gray-200 p-5">
      <section className="rounded-xl border border-blue-100 p-5">
        <SectionTitle title="场馆导览" />
        <div className="grid gap-5 md:grid-cols-[1fr_310px]">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="h-[440px]">
              {fair.mapImageUrl ? (
                <MapBlock lat={fair.latitude} lng={fair.longitude} mapImageUrl={fair.mapImageUrl} venue={fair.venue} />
              ) : (
                <VenueMapEmptyState />
              )}
            </div>
          </div>
          <aside className="rounded-xl border border-blue-100 bg-white p-5">
            <h3 className="text-2xl font-black text-blue-600">{hallList[0]?.hallName || fair.venue}</h3>
            {venueGuideError && (
              <button onClick={onRetry} className="mt-3 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">场馆导览加载失败，点击重试</button>
            )}
            <div className="mt-5 space-y-5 text-lg text-gray-600">
              <p><span className="font-bold text-gray-900">行业类别</span><br />{hallList[0]?.industryCategory || '以现场导览为准'}</p>
              <p><span className="font-bold text-gray-900">参展企业</span><br />{hallList[0]?.companyCount ?? fair.boothCount ?? 0}家</p>
              <p><span className="font-bold text-gray-900">展位范围</span><br />{hallList[0]?.boothRange || '现场公布'}</p>
            </div>
            <button onClick={onOpenCompanies} className="mt-6 h-14 w-full rounded-lg border border-blue-500 text-lg font-black text-blue-600">查看参展企业 <ChevronRightIcon className="inline h-5 w-5" /></button>
            {navUrl && <button onClick={onNav} className="mt-3 h-14 w-full rounded-lg bg-blue-600 text-lg font-black text-white"><QrCodeIcon className="inline h-5 w-5" /> 扫码在手机上导航</button>}
          </aside>
        </div>
      </section>

      <section className="rounded-xl border border-blue-100 p-5">
        <div className="mb-4 flex items-center justify-between">
          <SectionTitle title="活动资料" />
          {materials.length > 0 && (
            <button onClick={onOpenMaterials} className="shrink-0 text-base font-bold text-blue-600">查看全部资料 →</button>
          )}
        </div>
        {materialsError ? (
          <ErrorState message="活动资料加载失败，请重试" onRetry={onRetry} className="py-10" />
        ) : materials.length === 0 ? (
          <EmptyState icon={FileTextIcon} title="暂无活动资料" description="该招聘会暂未发布可查看资料" className="py-10" />
        ) : materials.map((material) => {
          // 与 FairMaterialsPage 同口径:仅 allowPrint && 有签名 previewUrl 才允许直接打印该资料,否则诚实标注暂不开放。
          const canPrint = material.allowPrint && !!material.previewUrl
          return (
            <div key={material.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-5 border-t border-gray-100 py-4 first:border-t-0">
              <div className="flex items-center gap-4">
                <FileTextIcon className="h-10 w-10 rounded-lg bg-blue-50 p-2 text-blue-600" />
                <p className="text-xl font-black text-gray-900">{material.name}</p>
              </div>
              <p className="text-base text-gray-500">{material.pageCount || '未知'} 页 | {formatSize(material.fileSizeKB)}</p>
              {canPrint ? (
                <button onClick={() => onPrintMaterial(material)} className="h-10 rounded-lg border border-emerald-200 px-4 text-base font-bold text-emerald-700">打印</button>
              ) : (
                <span className="h-10 rounded-lg border border-gray-200 px-4 text-base font-bold leading-10 text-gray-400">暂不开放打印</span>
              )}
            </div>
          )
        })}
      </section>

      <section className="rounded-xl border border-blue-100 p-5">
        <SectionTitle title="AI求职准备" sub="为本人参考" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { title: 'AI简历诊断', desc: '智能分析简历优势与不足', icon: FileSearchIcon, to: '/resume/source?intent=diagnose' },
            { title: '岗位匹配参考', desc: '基于岗位要求与个人背景', icon: NavigationIcon, to: '/resume/job-fit' },
            { title: '模拟面试', desc: 'AI模拟常见面试问题', icon: BotIcon, to: '/assistant' },
            { title: '职业规划', desc: '探索职业方向', icon: SparklesIcon, to: '/resume/career-plan' },
          ].map(({ title, desc, icon: Icon, to }) => (
            <button key={title} onClick={() => onNavigate(to)} className="rounded-xl border border-gray-200 p-4 text-left transition active:scale-[0.98]">
              <Icon className="h-12 w-12 rounded-lg bg-blue-50 p-3 text-blue-600" />
              <p className="mt-3 text-lg font-black text-gray-900">{title}</p>
              <p className="mt-2 text-sm leading-6 text-gray-500">{desc}</p>
              <span className="mt-3 inline-flex rounded bg-blue-50 px-2 py-1 text-sm font-bold text-blue-600">为本人参考</span>
            </button>
          ))}
        </div>
      </section>
      <p className="rounded-lg bg-blue-50 px-4 py-3 text-center text-base font-bold text-blue-700">{COMPLIANCE_COPY.KIOSK_CAMPUS_TOP}</p>
    </div>
  )
}

function VenueMapEmptyState() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-6">
      <div className="max-w-[420px] rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-inner">
        <MapIcon className="mx-auto h-16 w-16 rounded-2xl bg-blue-50 p-4 text-blue-600" />
        <p className="mt-5 text-2xl font-black text-gray-950">暂无场馆平面图</p>
        <p className="mt-3 text-base leading-7 text-gray-500">
          场馆布局以来源平台或现场公告为准。已配置的展厅、资料和手机导航会在右侧继续展示。
        </p>
      </div>
    </div>
  )
}
