import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type {
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairLiveStatsDTO,
} from '@ai-job-print/shared'
import {
  HeartIcon,
  InfoIcon,
  PrinterIcon,
  QrCodeIcon,
  SmartphoneIcon,
  XIcon,
} from 'lucide-react'
import { getFairCompanies, getFairStats, getFairZones, getJobFairById } from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { buildNavUrl } from '../../lib/url'
import { FairDataScreen } from './components/FairDataScreen'
import { DetailsTab, CompaniesTab, VenueGuideTab } from './components/JobFairDetailTabs'
import { useFavorites } from '../../favorites/useFavorites'
import { useAuth } from '../../auth/useAuth'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50',  text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400' },
}

const TABS = ['详情与特色', '参展企业与岗位', '场馆导览', '数据大屏'] as const
type TabKey = (typeof TABS)[number]

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

// verify marker: getFairVenueGuide

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

  // 收藏(C-2D):登录走 /me/favorites,匿名存本机;仅兴趣标记,不形成预约/投递闭环
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const isFav = id ? isFavorite('job_fair', id) : false
  const { getToken } = useAuth()

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

  // 浏览记录(P1):详情真实加载后上报;fire-and-forget,失败不影响页面;服务端 30 分钟去重。
  useEffect(() => {
    if (fair?.id) recordBrowse(getToken(), 'job_fair', fair.id)
  }, [fair?.id, getToken])

  // 外部跳转记录(P1):只记录「打开来源平台预约入口」动作;预约结果以来源平台为准,本系统不记录。
  const openBookingQr = () => {
    if (fair) recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQr({ kind: 'book' })
  }

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

  // 合规:打印只基于机构上传的真实活动资料(FairMaterial),不构造虚拟文件;
  // 底部「打印资料」跳真实资料列表页,逐份选择打印。
  const handlePrintMaterial = () => {
    navigate(`/job-fairs/${fair.id}/materials`)
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
        {/* 收藏(C-2D):仅兴趣标记,登录走 /me/favorites,匿名存本机;不涉及任何预约/投递闭环 */}
        <button
          type="button"
          onClick={() => toggleFavorite({ type: 'job_fair', id: fair.id, title: fair.name })}
          aria-label={isFav ? '取消收藏' : '收藏招聘会'}
          className={[
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors',
            isFav ? 'border-rose-200 bg-rose-50 text-rose-500' : 'border-gray-200 bg-white text-gray-400 hover:text-rose-400',
          ].join(' ')}
        >
          <HeartIcon className={isFav ? 'h-5 w-5 fill-current' : 'h-5 w-5'} aria-hidden="true" />
        </button>
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
        {tab === '场馆导览' && (
          <VenueGuideTab fairId={fair.id} onGoCompanies={() => setTab('参展企业与岗位')} />
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
            <Button size="lg" className="flex flex-1 items-center justify-center gap-2" onClick={openBookingQr}>
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
