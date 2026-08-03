import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type {
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairVenueGuideDTO,
  FairVenueHallDTO,
} from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  BuildingIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DoorOpenIcon,
  ExternalLinkIcon,
  FilterIcon,
  InfoIcon,
  MapIcon,
  MapPinIcon,
  MessageCircleQuestionIcon,
  MonitorIcon,
  NavigationIcon,
  PrinterIcon,
  SparklesIcon,
} from 'lucide-react'
import { getFairVenueGuide } from '../../../services/api'

// 参展企业头像配色（按企业名 hash）
const AVATAR_COLORS = ['bg-primary-500', 'bg-plum', 'bg-warning', 'bg-error', 'bg-success', 'bg-info', 'bg-plum', 'bg-neutral-700']
function avatarColor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// 行业键 → 中文标签（http 端为键，mock 端本就是中文）
const INDUSTRY_LABEL: Record<string, string> = {
  internet: '互联网', ai: '人工智能', finance: '金融', manufacturing: '智能制造',
  consumer: '消费电子', service: '生活服务', education: '教育', medical: '医疗健康',
}
function industryLabel(s: string) {
  return INDUSTRY_LABEL[s] ?? s
}

// 由岗位标题派生分类（参考图的研发类/产品类/设计类… 标签 + 筛选）
const CAT_RULES: [RegExp, string][] = [
  [/(测试|QA)/, '测试类'],
  [/(硬件|电路)/, '硬件类'],
  [/(产品经理|产品)/, '产品类'],
  [/(设计|UI|视觉|动画|三维)/, '设计类'],
  [/(运营|市场|销售|商务|推广|客户经理|柜)/, '运营类'],
  [/(算法|开发|工程师|研发|架构|技术|数据|师)/, '研发类'],
]
function categoryOf(title: string) {
  for (const [re, c] of CAT_RULES) if (re.test(title)) return c
  return '职能类'
}

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

// ─── Tab① 详情与特色 ─────────────────────────────────────────────────────────────

// 高德静态地图 key（生产/合规优先）。未配置则回退 OSM 嵌入（演示用，无 key）。
const AMAP_KEY = (import.meta.env as Record<string, string | undefined>).VITE_AMAP_KEY

function MapBlock({ lat, lng, mapImageUrl, venue }: { lat?: number; lng?: number; mapImageUrl?: string; venue: string }) {
  const cls = 'h-full min-h-[15rem] w-full'
  if (mapImageUrl) {
    return <img src={mapImageUrl} alt={`${venue}位置导览图`} className={`${cls} object-cover`} />
  }
  if (lat != null && lng != null) {
    if (AMAP_KEY) {
      const src = `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=15&size=750*400&scale=2&markers=mid,,A:${lng},${lat}&key=${AMAP_KEY}`
      return <img src={src} alt={`${venue}地图`} className={`${cls} object-cover`} />
    }
    const d = 0.012
    const bbox = `${(lng - d).toFixed(5)},${(lat - d * 0.62).toFixed(5)},${(lng + d).toFixed(5)},${(lat + d * 0.62).toFixed(5)}`
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
    return <iframe src={src} title={`${venue}位置地图`} className={`${cls} border-0`} loading="lazy" />
  }
  return (
    <div className={`${cls} flex flex-col items-center justify-center gap-1.5 bg-neutral-50 text-neutral-400`}>
      <MapPinIcon className="h-7 w-7" />
      <span className="text-xs">暂无地图，可扫码在手机查看</span>
    </div>
  )
}

export function DetailsTab({
  fair,
  featuredZones,
  navUrl,
  onNav,
}: {
  fair: ExternalJobFairDTO
  featuredZones: FairZoneDTO[]
  navUrl: string | null
  onNav: () => void
}) {
  const navigate = useNavigate()
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? 0)

  return (
    <>
      {/* 概览：信息左 / 位置右（复刻原型 11 ov-grid） */}
      <section className="jf-card accented compact">
        <div className="ov-grid">
          {/* 左：信息 */}
          <div>
            <div className="jf-kv">
              <div className="k">主办方</div>
              <div className="v">{fair.organizer}</div>
            </div>
            <div className="jf-kv" style={{ marginTop: 16 }}>
              <div className="k">活动时间</div>
              <div className="v">{formatDateTime(fair.startTime)} — {formatDateTime(fair.endTime)}</div>
            </div>
            {/* pill 行 */}
            <div className="jf-pill-row">
              <span className="jf-chip"><b>{fair.city ? `${fair.city} · ` : ''}{fair.venue}</b></span>
              {fair.expectedAttendance != null && (
                <span className="jf-chip">预计参会 <b>{fair.expectedAttendance.toLocaleString()} 人</b></span>
              )}
              <span className="jf-chip">参展企业 <b>{companyCount} 家</b></span>
              {fair.jobCount != null && (
                <span className="jf-chip">招聘岗位 <b>{fair.jobCount} 个</b></span>
              )}
            </div>
            {/* 地址与交通 */}
            {(fair.address || fair.trafficInfo) && (
              <div className="jf-traffic">
                <b>详细地址与交通指引</b>
                {fair.address && <span>{fair.address}</span>}
                {fair.trafficInfo && <span style={{ display: 'block', marginTop: 4 }}>{fair.trafficInfo}</span>}
              </div>
            )}
            {navUrl && (
              <button type="button" className="jf-btn sm ghost" style={{ marginTop: 16 }} onClick={onNav}>
                <NavigationIcon aria-hidden="true" />
                扫码在手机上导航
              </button>
            )}
          </div>
          {/* 右：地图 */}
          <div className="jf-mini-map">
            <span className="grid-bg" />
            <MapBlock lat={fair.latitude} lng={fair.longitude} mapImageUrl={fair.mapImageUrl} venue={fair.venue} />
          </div>
        </div>
        {fair.description && (
          <p style={{ marginTop: 18, fontSize: 18, lineHeight: 1.55, color: 'var(--muted)' }}>{fair.description}</p>
        )}
      </section>

      {/* 各市区创新特色展区（jf-zones3 + jf-zone-card 复刻原型 11） */}
      {featuredZones.length > 0 && (
        <section className="jf-card compact">
          <div className="jf-card-head">
            <span className="jf-g-icon"><SparklesIcon aria-hidden="true" /></span>
            <div>
              <h2>各市区创新特色展区</h2>
              <div className="sub">由主办方设置，现场以指示牌为准</div>
            </div>
          </div>
          <div className="jf-zones3">
            {featuredZones.map((z) => (
              <div key={z.id} className="jf-zone-card">
                {z.city && <span className="city-badge">{z.city}</span>}
                <span className="z-icon">
                  <MonitorIcon aria-hidden="true" />
                </span>
                <b>{z.zoneName}</b>
                {z.description && <span className="desc">{z.description}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 现场服务（展馆导览 / 活动资料 / 数据大屏 / AI准备单 — 4列 jf-svc-tiles） */}
      {fair.hasManagedData && (
        <section className="jf-card compact">
          <div className="jf-card-head">
            <span className="jf-g-icon"><MapIcon aria-hidden="true" /></span>
            <div>
              <h2>现场服务</h2>
              <div className="sub">导览、资料与 AI 参会准备</div>
            </div>
          </div>
          <div className="jf-svc-tiles">
            <button type="button" className="jf-tile tinted" onClick={() => navigate(`/job-fairs/${fair.id}/map`)}>
              <span className="t-text">
                <b>展馆导览</b>
                <span className="cnt">查看会场布局</span>
              </span>
            </button>
            <button type="button" className="jf-tile tinted" onClick={() => navigate(`/job-fairs/${fair.id}/materials`)}>
              <span className="t-text">
                <b>活动资料</b>
                <span className="cnt">{fair.managedMaterialCount} 份 · 可免费打印</span>
              </span>
            </button>
            <button type="button" className="jf-tile tinted" onClick={() => navigate(`/job-fairs/${fair.id}/stats`)}>
              <span className="t-text">
                <b>现场数据</b>
                <span className="cnt">签到进度 · 行业分布</span>
              </span>
            </button>
            <button type="button" className="jf-tile tinted" onClick={() => navigate(`/job-fairs/${fair.id}/visit-plan`)}>
              <span className="t-text">
                <b>AI参会准备单</b>
                <span className="cnt">基于本人简历生成</span>
              </span>
            </button>
          </div>
        </section>
      )}

      {/* 数据来源（合规必展示 — accented + jf-kv3） */}
      <section className="jf-card accented compact">
        <div className="jf-card-head">
          <span className="jf-g-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>
            </svg>
          </span>
          <div>
            <h2>数据来源</h2>
            <div className="sub">第三方 / 官方来源信息，请核对后前往办理</div>
          </div>
        </div>
        <div className="jf-kv3">
          <div className="jf-kv"><div className="k">来源机构</div><div className="v">{fair.sourceName}</div></div>
          <div className="jf-kv"><div className="k">同步时间</div><div className="v">{formatSync(fair.syncTime)}</div></div>
          <div className="jf-kv"><div className="k">外部ID</div><div className="v">{fair.externalId}</div></div>
        </div>
        {(fair.dataSourceNote || fair.status !== 'ended') && (
          <div className="jf-notice" style={{ marginTop: 18 }}>
            <InfoIcon aria-hidden="true" />
            <span>
              {fair.status !== 'ended'
                ? '预约请点击底部「扫码预约」，使用手机前往来源平台办理。本系统仅展示第三方来源信息，不参与活动报名流程。'
                : (fair.dataSourceNote || '本系统仅展示来源信息，信息以来源平台为准。')}
            </span>
          </div>
        )}
      </section>
    </>
  )
}

// ─── Tab② 参展企业与岗位 ─────────────────────────────────────────────────────────

export function CompaniesTab({ fairId, companies }: { fairId: string; companies: FairCompanyDTO[] }) {
  const navigate = useNavigate()
  const [category, setCategory] = useState('全部分类')
  const [catOpen, setCatOpen] = useState(false)

  const positions = useMemo(
    () =>
      companies.flatMap((c) =>
        c.positions.map((p) => ({
          ...p,
          companyName: c.companyName,
          companyId: c.id,
          category: categoryOf(p.title),
        })),
      ),
    [companies],
  )

  const categories = useMemo(() => {
    const set: string[] = []
    for (const p of positions) if (!set.includes(p.category)) set.push(p.category)
    return ['全部分类', ...set]
  }, [positions])

  const visiblePositions = useMemo(
    () => (category === '全部分类' ? positions : positions.filter((p) => p.category === category)),
    [positions, category],
  )

  if (companies.length === 0) {
    return <EmptyState icon={BuildingIcon} title="暂无参展企业" description="该招聘会暂未录入参展企业明细" className="py-12" />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* 左：参展企业汇编 */}
      <Card className="p-5 lg:col-span-1">
        <p className="mb-3 flex items-center gap-1.5 text-base font-semibold text-neutral-800">
          <BuildingIcon className="h-5 w-5 text-primary-500" />
          参展企业汇编
          <span className="ml-auto text-xs font-normal text-neutral-400">{companies.length} 家</span>
        </p>
        <div className="space-y-3">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/job-fairs/${fairId}/companies/${c.id}`)}
              className="flex w-full items-start gap-3 rounded-xl border border-neutral-100 bg-white p-3 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/30"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white ${avatarColor(c.companyName)}`}>
                {c.companyName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{c.companyName}</p>
                <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">{industryLabel(c.industry)}</span>
                {c.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-neutral-400">{c.description}</p>}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* 右：招聘岗位 */}
      <Card className="p-5 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-base font-semibold text-neutral-800">
            <BriefcaseIcon className="h-5 w-5 text-success" />
            招聘岗位
            <span className="ml-1 text-xs font-normal text-neutral-400">{visiblePositions.length} 个</span>
          </p>
          {/* 全部分类 下拉 */}
          <div className="relative">
            <button
              onClick={() => setCatOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              <FilterIcon className="h-3.5 w-3.5 text-neutral-400" />
              {category}
              <ChevronDownIcon className="h-4 w-4 text-neutral-400" />
            </button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setCatOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-32 overflow-hidden rounded-lg border border-neutral-100 bg-white py-1 shadow-lg">
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setCategory(c); setCatOpen(false) }}
                      className={[
                        'block w-full px-3 py-2 text-left text-sm',
                        category === c ? 'bg-primary-50 font-medium text-primary-700' : 'text-neutral-600 hover:bg-neutral-50',
                      ].join(' ')}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visiblePositions.map((p) => (
            <div key={`${p.companyId}-${p.id}`} className="rounded-xl border border-neutral-100 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">{p.title}</p>
                {p.salary && <span className="shrink-0 text-sm font-bold text-error-fg">{p.salary}</span>}
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-xs text-neutral-500">
                <BuildingIcon className="h-3.5 w-3.5 text-neutral-400" />
                {p.companyName}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg">{p.category}</span>
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
      </Card>
    </div>
  )
}

// ─── Tab③ 场馆导览(轻 3D;数据来自后端 Admin 配置,绝非前端硬编码)─────────────────
//
// 合规:只做会场位置导览与展区/企业/岗位信息查看;投递、预约一律前往来源平台办理。

const HALL_BLOCK_COLORS = [
  'from-primary-500 to-primary-600',
  'from-plum to-plum',
  'from-success to-success-fg',
  'from-warning to-warning-fg',
  'from-info to-info',
  'from-error-fg to-error-fg',
]

const FACILITY_META: Record<string, { label: string; icon: typeof InfoIcon }> = {
  entrance: { label: '入口', icon: DoorOpenIcon },
  serviceDesk: { label: '服务台', icon: InfoIcon },
  printPoint: { label: '打印服务点', icon: PrinterIcon },
  consulting: { label: '咨询区', icon: MessageCircleQuestionIcon },
}

export function VenueGuideTab({ fairId, onGoCompanies }: { fairId: string; onGoCompanies: () => void }) {
  const [guide, setGuide] = useState<FairVenueGuideDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeHallId, setActiveHallId] = useState<string | null>(null)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFairVenueGuide(fairId)
      .then((res) => {
        if (cancelled) return
        setGuide(res.data)
        setActiveHallId(res.data?.halls[0]?.hallId ?? null)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, reloadKey])

  if (loading) return <LoadingState className="py-16" />
  if (error) {
    // 真实重试:重新发起 API 请求,而非静态提示
    return <ErrorState message="场馆导览加载失败,请稍后重试" onRetry={() => setReloadKey((k) => k + 1)} className="py-16" />
  }
  if (!guide || guide.halls.length === 0) {
    return (
      <EmptyState
        icon={NavigationIcon}
        title="暂未配置场馆导览"
        description="主办方尚未提供会场布局信息,可在「参展企业与岗位」查看企业列表"
        className="py-12"
      />
    )
  }

  const activeHall: FairVenueHallDTO | null = guide.halls.find((h) => h.hallId === activeHallId) ?? guide.halls[0]

  return (
    <div className="flex flex-col gap-4">
      {/* 场馆名 + 轻 3D 展厅块 */}
      <Card className="overflow-hidden p-5">
        <div className="mb-4 flex items-center gap-2">
          <NavigationIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
          <p className="text-sm font-semibold text-neutral-800">{guide.venueName} · 会场布局</p>
          <p className="ml-auto text-xs text-neutral-400">点击展厅查看详情</p>
        </div>
        {/* 轻 3D:perspective + rotateX,选中展厅抬升高亮 */}
        <div className="flex flex-wrap justify-center gap-5 py-3" style={{ perspective: '700px' }}>
          {guide.halls.map((h, i) => {
            const active = h.hallId === activeHall?.hallId
            return (
              <button
                key={h.hallId}
                onClick={() => setActiveHallId(h.hallId)}
                className="group text-center"
                style={{ transformStyle: 'preserve-3d' }}
              >
                <div
                  className={[
                    'relative mx-auto flex h-24 w-32 flex-col items-center justify-center rounded-2xl bg-gradient-to-br text-white transition-all duration-200',
                    HALL_BLOCK_COLORS[i % HALL_BLOCK_COLORS.length],
                    active
                      ? 'shadow-[0_18px_28px_rgba(15,23,42,0.28)] ring-4 ring-white'
                      : 'opacity-85 shadow-[0_10px_18px_rgba(15,23,42,0.18)]',
                  ].join(' ')}
                  style={{ transform: `rotateX(14deg) ${active ? 'translateY(-8px) scale(1.06)' : ''}` }}
                >
                  <p className="text-3xl font-extrabold leading-none">{h.hallCode}</p>
                  <p className="mt-1 text-xs font-medium opacity-90">{h.companyCount} 家企业</p>
                  {h.boothRange && (
                    <span className="absolute -bottom-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-600 shadow-sm">
                      {h.boothRange}
                    </span>
                  )}
                </div>
                <p className={`mt-3 text-sm font-semibold ${active ? 'text-primary-700' : 'text-neutral-700'}`}>{h.hallName}</p>
                <p className="max-w-32 truncate text-xs text-neutral-400">{h.industryCategory ?? ''}</p>
              </button>
            )
          })}
        </div>

        {/* 设施点位 */}
        {guide.facilities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
            {guide.facilities.map((f) => {
              const meta = FACILITY_META[f.type] ?? FACILITY_META.serviceDesk
              const Icon = meta.icon
              return (
                <span key={f.id} className="flex items-center gap-1.5 rounded-full bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
                  <Icon className="h-3.5 w-3.5 text-primary-500" aria-hidden="true" />
                  <span className="font-medium">{f.name}</span>
                  {f.locationLabel && <span className="text-neutral-400">· {f.locationLabel}</span>}
                  {f.relatedHallCode && <span className="rounded bg-white px-1 text-[10px] font-semibold text-neutral-500">{f.relatedHallCode} 厅</span>}
                </span>
              )
            })}
          </div>
        )}
      </Card>

      {/* 选中展厅详情 */}
      {activeHall && (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-bold text-neutral-900">{activeHall.hallName} · {activeHall.industryCategory ?? '综合展区'}</p>
              {activeHall.description && <p className="mt-1 text-sm text-neutral-500">{activeHall.description}</p>}
              <p className="mt-1 text-xs text-neutral-400">
                {activeHall.boothRange ? `展位 ${activeHall.boothRange} · ` : ''}共 {activeHall.companyCount} 家企业
              </p>
            </div>
          </div>

          {activeHall.companies.length === 0 ? (
            <p className="mt-4 rounded-xl bg-neutral-50 py-6 text-center text-sm text-neutral-400">该展厅暂未录入企业</p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {activeHall.companies.map((c) => (
                <div key={c.companyId} className="rounded-2xl border border-neutral-100 p-3.5">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white ${avatarColor(c.companyName)}`}>
                      {c.companyName.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-neutral-900">{c.companyName}</p>
                      <p className="text-xs text-neutral-400">
                        {c.industry ? `${industryLabel(c.industry)} · ` : ''}
                        {c.jobCount > 0 ? `${c.jobCount} 个岗位` : '岗位待录入'}
                      </p>
                    </div>
                    {c.boothNo && (
                      <span className="shrink-0 rounded-lg bg-primary-50 px-2.5 py-1 text-sm font-bold text-primary-700">{c.boothNo}</span>
                    )}
                  </div>
                  {c.jobTitles.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-14">
                      {c.jobTitles.map((t) => (
                        <span key={t} className="rounded bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600">{t}</span>
                      ))}
                      {c.jobCount > c.jobTitles.length && <span className="text-xs text-neutral-400">等 {c.jobCount} 个岗位</span>}
                      <button
                        onClick={onGoCompanies}
                        className="ml-auto flex min-h-[36px] items-center gap-0.5 rounded-lg px-2 text-xs font-medium text-primary-600 hover:bg-primary-50"
                      >
                        在参展企业与岗位中查看
                        <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-neutral-400">
        场馆导览信息由主办方/管理员提供,仅供现场参考;岗位投递请前往来源平台办理。
      </p>
    </div>
  )
}
