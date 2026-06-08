import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type {
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairLiveStatsDTO,
} from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  BuildingIcon,
  CalendarIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  MapIcon,
  MapPinIcon,
  NavigationIcon,
  PrinterIcon,
  QrCodeIcon,
  SmartphoneIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getFairCompanies, getFairStats, getFairZones, getJobFairById } from '../../services/api'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { buildNavUrl } from '../../lib/url'
import { COMPANY_SCALE_SHORT } from '../../types/fair'
import { FairDataScreen } from './components/FairDataScreen'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50',  text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400' },
}

const POSITION_TYPE_LABEL: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  intern:    '实习',
}

const TABS = ['详情与特色', '参展企业与岗位', '数据大屏'] as const
type TabKey = (typeof TABS)[number]

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ─── 通用二维码弹层（真实二维码）────────────────────────────────────────────────

function QrModal({
  title,
  subtitle,
  value,
  note,
  meta,
  onClose,
}: {
  title: string
  subtitle?: string
  value: string | undefined | null
  note: string
  meta?: { label: string; value: string }[]
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-80 rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">{title}</p>
        {subtitle && <p className="mt-1 line-clamp-1 text-center text-sm text-gray-500">{subtitle}</p>}
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={value} size={180} />
        </div>
        {meta && meta.length > 0 && (
          <div className="mt-5 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
            {meta.map((m) => (
              <div key={m.label} className="flex justify-between">
                <span className="text-gray-400">{m.label}</span>
                <span className="font-medium">{m.value}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">{note}</p>
        </div>
      </div>
    </div>
  )
}

// ─── 主组件 ─────────────────────────────────────────────────────────────────────

type QrState =
  | { kind: 'book' }
  | { kind: 'nav'; url: string }
  | null

export function JobFairDetailPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const location = useLocation()

  const stateFair = (location.state as { fair?: ExternalJobFairDTO } | null)?.fair
  const hasStateMatch = stateFair?.id === id

  const [fair,    setFair]    = useState<ExternalJobFairDTO | null>(hasStateMatch ? stateFair! : null)
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error,   setError]   = useState(false)
  const [tab,     setTab]     = useState<TabKey>('详情与特色')
  const [qr,      setQr]      = useState<QrState>(null)

  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones,     setZones]     = useState<FairZoneDTO[]>([])
  const [stats,     setStats]     = useState<FairLiveStatsDTO | null>(null)

  // 招聘会主体
  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getJobFairById(id!)
      .then((res) => { if (!cancelled) { setFair(res.data); if (!res.data) setError(true) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, hasStateMatch])

  // 企业 / 展区 / 大屏数据（并行）
  useEffect(() => {
    if (!fair) return
    let cancelled = false
    Promise.all([
      getFairCompanies(fair.id).then((r) => r.data).catch(() => []),
      getFairZones(fair.id).then((r) => r.data).catch(() => []),
      getFairStats(fair.id).then((r) => r.data).catch(() => null),
    ]).then(([c, z, s]) => {
      if (cancelled) return
      setCompanies(c)
      setZones(z)
      setStats(s)
    })
    return () => { cancelled = true }
  }, [fair])

  const featuredZones = useMemo(() => zones.filter((z) => z.category === 'innovation'), [zones])

  if (loading) return <LoadingState className="h-full" />
  if (error || !fair) {
    return (
      <ErrorState
        message="活动数据未找到，请返回列表重试"
        onRetry={() => navigate('/job-fairs')}
        className="h-full"
      />
    )
  }

  const sc      = STATUS_CONFIG[fair.status]
  const isEnded = fair.status === 'ended'
  const navUrl  = buildNavUrl({
    latitude: fair.latitude,
    longitude: fair.longitude,
    venue: fair.venue,
    address: fair.address,
  })

  const handlePrintMaterial = () => {
    navigate('/print/confirm', {
      state: {
        file: { name: `${fair.name}_活动资料.pdf`, size: '256 KB', pages: 2 },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  return (
    <div className="flex h-full flex-col">
      {qr?.kind === 'book' && (
        <QrModal
          title="扫码前往来源平台预约"
          subtitle={fair.name}
          value={fair.sourceUrl}
          meta={[
            { label: '来源机构', value: fair.sourceName },
            { label: '外部编号', value: fair.externalId },
          ]}
          note="请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。"
          onClose={() => setQr(null)}
        />
      )}
      {qr?.kind === 'nav' && (
        <QrModal
          title="扫码在手机上导航"
          subtitle={fair.venue}
          value={qr.url}
          note="请使用手机扫码，在手机地图中打开场馆位置并开始导航。"
          onClose={() => setQr(null)}
        />
      )}

      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 px-6 pb-3 pt-6">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-gray-900">{fair.name}</h1>
          <p className="mt-0.5 text-xs text-gray-400">{fair.sourceName}</p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate('/job-fairs')}>
          关闭
        </Button>
      </div>

      {/* Tab 栏 */}
      <div className="flex gap-1 border-b border-gray-100 px-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'relative min-h-[44px] px-3 text-sm font-medium transition-colors',
              tab === t ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {tab === '详情与特色' && (
          <DetailsTab
            fair={fair}
            sc={sc}
            featuredZones={featuredZones}
            navUrl={navUrl}
            onNav={() => navUrl && setQr({ kind: 'nav', url: navUrl })}
          />
        )}
        {tab === '参展企业与岗位' && (
          <CompaniesTab fairId={fair.id} companies={companies} />
        )}
        {tab === '数据大屏' && (
          stats ? <FairDataScreen stats={stats} /> : (
            <EmptyState icon={InfoIcon} title="暂无数据大屏" description="该招聘会暂未录入预计/来源数据" className="py-12" />
          )
        )}
      </div>

      {/* 底部操作条 */}
      <div className="border-t border-gray-100 px-6 pb-6 pt-3">
        <div className="flex gap-3">
          {!isEnded ? (
            <Button size="lg" className="flex flex-1 items-center justify-center gap-2" onClick={() => setQr({ kind: 'book' })}>
              <QrCodeIcon className="h-5 w-5" />
              扫码预约
            </Button>
          ) : (
            <Button size="lg" variant="secondary" className="flex-1" onClick={() => navigate('/job-fairs')}>
              返回列表
            </Button>
          )}
          <Button size="lg" variant="secondary" className="flex items-center justify-center gap-2" onClick={handlePrintMaterial}>
            <PrinterIcon className="h-5 w-5" />
            打印资料
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab① 详情与特色 ─────────────────────────────────────────────────────────────

function DetailsTab({
  fair,
  sc,
  featuredZones,
  navUrl,
  onNav,
}: {
  fair: ExternalJobFairDTO
  sc: { label: string; bg: string; text: string }
  featuredZones: FairZoneDTO[]
  navUrl: string | null
  onNav: () => void
}) {
  const navigate = useNavigate()
  // 特色展区按城市分组
  const grouped = useMemo(() => {
    const map = new Map<string, FairZoneDTO[]>()
    for (const z of featuredZones) {
      const key = z.city || '特色展区'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(z)
    }
    return [...map.entries()]
  }, [featuredZones])

  return (
    <>
      {/* 概览 */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex-1 text-lg font-bold text-gray-900">{fair.name}</h2>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${sc.bg} ${sc.text}`}>{sc.label}</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">主办方：{fair.organizer}</p>
        <div className="mt-4 space-y-2 text-sm text-gray-700">
          <div className="flex items-start gap-2">
            <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <span>{formatDateTime(fair.startTime)}<span className="mx-1 text-gray-400">–</span>{formatDateTime(fair.endTime)}</span>
          </div>
          <div className="flex items-start gap-2">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <span>{fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
          </div>
        </div>
        {/* 预计参会 / 参展企业（标注预计/已录入） */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-50 p-3 text-center">
            <p className="text-xl font-bold text-gray-900">
              {fair.expectedAttendance != null ? fair.expectedAttendance.toLocaleString() : '—'}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">预计参会人数</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 text-center">
            <p className="text-xl font-bold text-gray-900">
              {fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? '—')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">参展企业</p>
          </div>
        </div>
        {fair.description && (
          <p className="mt-4 text-sm leading-relaxed text-gray-600">{fair.description}</p>
        )}
      </Card>

      {/* 位置与导航 */}
      <Card className="p-5">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <MapPinIcon className="h-4 w-4 text-primary-500" />
          位置与导航
        </p>
        <div className="overflow-hidden rounded-xl border border-gray-100">
          {fair.mapImageUrl ? (
            <img src={fair.mapImageUrl} alt="场馆位置导览图" className="h-40 w-full object-cover" />
          ) : (
            <div className="flex h-32 w-full flex-col items-center justify-center gap-1.5 bg-gray-50 text-gray-400">
              <MapPinIcon className="h-7 w-7" />
              <span className="text-xs">暂无导览图，可扫码在手机查看地图</span>
            </div>
          )}
        </div>
        {fair.address && (
          <p className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <span>{fair.address}</span>
          </p>
        )}
        {fair.trafficInfo && (
          <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-500">交通指引</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">{fair.trafficInfo}</p>
          </div>
        )}
        {navUrl && (
          <Button size="md" variant="outline" className="mt-3 flex w-full items-center justify-center gap-2" onClick={onNav}>
            <NavigationIcon className="h-4 w-4" />
            扫码在手机上导航
          </Button>
        )}
      </Card>

      {/* 各市区创新特色展区 */}
      {grouped.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <SparklesIcon className="h-4 w-4 text-primary-500" />
            创新特色展区
          </p>
          <div className="space-y-3">
            {grouped.map(([city, list]) => (
              <div key={city}>
                <span className="inline-block rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                  {city}
                </span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {list.map((z) => (
                    <div key={z.id} className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-sm font-semibold text-gray-900">{z.zoneName}</p>
                      {z.industry && <p className="mt-0.5 text-xs text-primary-600">{z.industry}</p>}
                      {z.description && (
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-500">{z.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 现场服务入口（展馆导览 / 活动资料） */}
      {fair.hasManagedData && (
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-gray-700">现场服务</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex items-center gap-2 rounded-xl bg-gray-50 p-3 text-left transition-colors hover:bg-primary-50"
              onClick={() => navigate(`/job-fairs/${fair.id}/map`)}
            >
              <MapIcon className="h-5 w-5 text-primary-500" />
              <span className="text-sm font-medium text-gray-700">展馆导览</span>
              <ChevronRightIcon className="ml-auto h-4 w-4 text-gray-300" />
            </button>
            <button
              className="flex items-center gap-2 rounded-xl bg-gray-50 p-3 text-left transition-colors hover:bg-primary-50"
              onClick={() => navigate(`/job-fairs/${fair.id}/materials`)}
            >
              <FileTextIcon className="h-5 w-5 text-primary-500" />
              <span className="text-sm font-medium text-gray-700">活动资料</span>
              <span className="ml-auto text-xs text-gray-400">{fair.managedMaterialCount} 份</span>
            </button>
          </div>
        </Card>
      )}

      {/* 数据来源（合规必展示） */}
      <Card className="p-5">
        <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span className="text-gray-400">来源机构</span>
            <span>{fair.sourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">同步时间</span>
            <span>{formatSync(fair.syncTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">外部编号</span>
            <span className="font-mono text-xs">{fair.externalId}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">{fair.dataSourceNote}</p>
      </Card>

      {/* 合规提示 */}
      {fair.status !== 'ended' && (
        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            预约请点击底部「扫码预约」，使用手机前往来源平台办理。本系统仅展示第三方来源信息，不参与活动报名流程。
          </p>
        </div>
      )}
    </>
  )
}

// ─── Tab② 参展企业与岗位 ─────────────────────────────────────────────────────────

function CompaniesTab({ fairId, companies }: { fairId: string; companies: FairCompanyDTO[] }) {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState<string>('全部')

  const positions = useMemo(
    () =>
      companies.flatMap((c) =>
        c.positions.map((p) => ({ ...p, companyName: c.companyName, companyId: c.id })),
      ),
    [companies],
  )

  const types = useMemo(() => {
    const set: string[] = []
    for (const p of positions) {
      const label = p.positionType ? POSITION_TYPE_LABEL[p.positionType] : null
      if (label && !set.includes(label)) set.push(label)
    }
    return set
  }, [positions])

  const visiblePositions = useMemo(
    () =>
      typeFilter === '全部'
        ? positions
        : positions.filter((p) => p.positionType && POSITION_TYPE_LABEL[p.positionType] === typeFilter),
    [positions, typeFilter],
  )

  if (companies.length === 0) {
    return <EmptyState icon={BuildingIcon} title="暂无参展企业" description="该招聘会暂未录入参展企业明细" className="py-12" />
  }

  return (
    <>
      {/* 参展企业汇编 */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <BuildingIcon className="h-4 w-4 text-primary-500" />
          参展企业汇编
          <span className="ml-auto text-xs font-normal text-gray-400">{companies.length} 家</span>
        </p>
        <div className="grid grid-cols-1 gap-2">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/job-fairs/${fairId}/companies/${c.id}`)}
              className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left transition-colors hover:bg-gray-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-sm font-bold text-primary-600">
                {c.companyName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{c.companyName}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5">{c.industry}</span>
                  <span>{COMPANY_SCALE_SHORT[c.scale]}</span>
                  <span>· {c.positions.length} 个岗位</span>
                </div>
                {c.description && <p className="mt-1 line-clamp-1 text-xs text-gray-400">{c.description}</p>}
              </div>
              <ChevronRightIcon className="mt-2 h-4 w-4 shrink-0 text-gray-300" />
            </button>
          ))}
        </div>
      </div>

      {/* 招聘岗位 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <UsersIcon className="h-4 w-4 text-primary-500" />
            招聘岗位
          </p>
          {types.length > 0 && (
            <div className="flex gap-1.5">
              {['全部', ...types].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={[
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    typeFilter === t ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {visiblePositions.map((p) => (
            <div key={`${p.companyId}-${p.id}`} className="rounded-xl border border-gray-100 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{p.title}</p>
                {p.salary && <span className="shrink-0 text-sm font-semibold text-orange-600">{p.salary}</span>}
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                <BuildingIcon className="h-3.5 w-3.5 text-gray-400" />
                {p.companyName}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                  {p.positionType && (
                    <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">
                      {POSITION_TYPE_LABEL[p.positionType]}
                    </span>
                  )}
                  {p.education && <span>{p.education}</span>}
                  {p.location && <span>· {p.location}</span>}
                </div>
                <button
                  onClick={() => navigate(`/job-fairs/${fairId}/companies/${p.companyId}`)}
                  className="flex items-center gap-0.5 text-xs font-medium text-primary-600"
                >
                  查看详情
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
