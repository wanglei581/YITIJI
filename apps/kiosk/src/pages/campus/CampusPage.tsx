// ============================================================
// 校园招聘专区（/campus）— 沉浸式 5-Tab 页（对齐参考图）
//
// 合规定位：第三方/官方校招信息入口 + 求职材料服务，不是平台自营校招。
//   - 数据取自一场「校园」主题招聘会（getJobFairs + 校招过滤），渲染 5 个 Tab：
//     企业速览 / 参展企业 / 导览图 / AI求职 / 打印服务。
//   - 投递/预约一律跳来源平台（按钮文案见 docs/compliance/compliance-boundary.md）。
// 红线：不接收/保存/转发简历给企业；无企业端招聘后续处理功能。
// ============================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import type {
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairLiveStatsDTO,
} from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  BuildingIcon,
  ChevronLeftIcon,
  LayersIcon,
  MapPinIcon,
  NavigationIcon,
  PrinterIcon,
  SmartphoneIcon,
  XIcon,
} from 'lucide-react'
import { getFairCompanies, getFairStats, getFairZones, getJobFairs, getTerminalId } from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { buildNavUrl } from '../../lib/url'
import { AiJobTab, CompaniesTab, MapTab, OverviewTab, PrintTab } from './components/CampusTabs'
import { KioskPageFrame } from '../jobs/components/W4Presentation'

// verify marker: MapBlock lives in CampusTabs after the zero-behavior split.

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-white/20', text: 'text-white' },
  ongoing:  { label: '进行中', bg: 'bg-success/90', text: 'text-white' },
  ended:    { label: '已结束', bg: 'bg-white/20', text: 'text-white/80' },
}

// 校招会识别：DTO theme 优先，其次关键词（名称/主办方/简介/来源）
const CAMPUS_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/
function isCampusFair(f: ExternalJobFairDTO) {
  return (
    f.theme === 'campus' ||
    f.theme === 'campus_corp' ||
    CAMPUS_RE.test(`${f.name} ${f.organizer} ${f.description ?? ''} ${f.sourceName}`)
  )
}

// 校招会相关性排序：主题 > 标题关键词 > 活动状态，挑「最像校园双选会」的一场作专区主体，
// 避免选中仅在简介里提到「应届」的行业专场。
function campusScore(f: ExternalJobFairDTO) {
  let s = 0
  if (f.theme === 'campus') s += 100
  else if (f.theme === 'campus_corp') s += 80
  if (/校园|校招|双选|高校|毕业生|研究生/.test(f.name)) s += 50
  if (f.status === 'ongoing') s += 10
  else if (f.status === 'upcoming') s += 5
  return s
}

const TABS = [
  { key: 'overview',  label: '企业速览', icon: LayersIcon },
  { key: 'companies', label: '参展企业', icon: BuildingIcon },
  { key: 'map',       label: '导览图',   icon: NavigationIcon },
  { key: 'ai',        label: 'AI求职',   icon: BriefcaseIcon },
  { key: 'print',     label: '打印服务', icon: PrinterIcon },
] as const
type TabKey = (typeof TABS)[number]['key']

function pad(n: number) {
  return String(n).padStart(2, '0')
}
/** Hero 日期角标：「2026.05.15 — 05.17」，同日则只显示一天。 */
function fmtDateBadge(start: string, end: string) {
  const a = new Date(start)
  const b = new Date(end)
  const head = `${a.getFullYear()}.${pad(a.getMonth() + 1)}.${pad(a.getDate())}`
  const sameDay = a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return sameDay ? head : `${head} — ${pad(b.getMonth() + 1)}.${pad(b.getDate())}`
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
          className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-neutral-800">{title}</p>
        {subtitle && <p className="mt-1 line-clamp-1 text-center text-sm text-neutral-500">{subtitle}</p>}
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={value} size={180} />
        </div>
        {meta && meta.length > 0 && (
          <div className="mt-5 space-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
            {meta.map((m) => (
              <div key={m.label} className="flex justify-between">
                <span className="text-neutral-400">{m.label}</span>
                <span className="font-medium">{m.value}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-neutral-500">{note}</p>
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

export function CampusPage() {
  const navigate = useNavigate()

  const [fair,    setFair]    = useState<ExternalJobFairDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [tab,     setTab]     = useState<TabKey>('overview')
  const [qr,      setQr]      = useState<QrState>(null)

  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones,     setZones]     = useState<FairZoneDTO[]>([])
  const [stats,     setStats]     = useState<FairLiveStatsDTO | null>(null)
  const { getToken } = useAuth()

  // 浏览记录(P1):校园专区主体招聘会真实加载后上报;fire-and-forget,服务端 30 分钟去重。
  useEffect(() => {
    if (fair?.id) recordBrowse(getToken(), 'job_fair', fair.id)
  }, [fair?.id, getToken])

  // 外部跳转记录(P1):只记录「打开来源平台预约入口」;预约结果以来源平台为准,本系统不记录。
  const openBookingQr = () => {
    if (fair) recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQr({ kind: 'book' })
  }

  // 取一场校园主题招聘会作为本专区主体；有 terminalId 时后端已按本校/未结束优先排序。
  useEffect(() => {
    let cancelled = false
    const terminalId = getTerminalId()
    getJobFairs(terminalId ? { terminalId } : undefined)
      .then((res) => {
        if (cancelled) return
        const campus = res.data.filter(isCampusFair)
        const pick = (() => {
          if (!campus.length) return null
          if (terminalId) return campus[0]
          return [...campus].sort((a, b) => campusScore(b) - campusScore(a))[0]
        })()
        if (pick) setFair(pick)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

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

  if (loading) return <LoadingState className="h-full" />
  if (error || !fair) {
    return (
      <ErrorState
        message="暂无校园招聘会数据，请稍后再试"
        onRetry={() => navigate('/')}
        className="h-full"
      />
    )
  }

  const sc      = STATUS_CONFIG[fair.status]
  const navUrl  = buildNavUrl({
    latitude: fair.latitude,
    longitude: fair.longitude,
    venue: fair.venue,
    address: fair.address,
  })

  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? companies.length)
  const jobCount     = stats?.totalPositions ?? fair.jobCount ?? companies.reduce((s, c) => s + c.positions.length, 0)

  // 合规:打印只基于机构上传的真实活动资料(FairMaterial),不构造虚拟文件;
  // 跳真实资料列表页,逐份选择打印。
  const handlePrintMaterial = () => {
    navigate(`/job-fairs/${fair.id}/materials`)
  }

  return (
    <KioskPageFrame
      tone="clay"
      title="校园招聘专区"
      subtitle={`${fair.name} · 招聘会与来源平台信息`}
      backLabel="返回首页"
      onBack={() => navigate('/')}
    >
    <div className="campus-proto flex h-full flex-col">
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

      {/* ── Hero（蓝色渐变大图）─────────────────────────────────── */}
      <header className="campus-topbar">
        <div className="flex items-baseline gap-4"><b>就业服务大厅 · 01号机</b><span>AI求职打印服务终端</span></div>
        <div className="flex items-center gap-4"><span>校园招聘专区</span><span className="rounded-full border border-[rgba(31,158,134,.45)] bg-[rgba(31,158,134,.18)] px-4 py-2">打印机正常 · A4纸充足</span></div>
      </header>

      <div className="campus-hero">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2"
            aria-label="返回首页"
          >
            <ChevronLeftIcon className="h-6 w-6" />
            返回首页
          </button>
          <span className="campus-date tabular-nums">
            {fmtDateBadge(fair.startTime, fair.endTime)}
          </span>
        </div>
        <div className="mt-5 flex items-start gap-3">
          <h1 className="flex-1 leading-snug">{fair.name}</h1>
          <span className="campus-status shrink-0">{sc.label}</span>
        </div>
        {fair.tagline && <p className="mt-2 opacity-75">{fair.tagline}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <MapPinIcon className="h-5 w-5 opacity-80" />{fair.venue}
          </span>
          <span className="inline-flex items-center gap-2">
            <BuildingIcon className="h-5 w-5 opacity-80" />参展企业 {companyCount} 家
          </span>
          <span className="inline-flex items-center gap-2">
            <BriefcaseIcon className="h-5 w-5 opacity-80" />招聘岗位 {jobCount}+
          </span>
        </div>
      </div>

      {/* ── Tab 栏 ─────────────────────────────────────────────── */}
      <div className="campus-tabs flex shrink-0 border-b border-neutral-100 bg-white">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={active}
              className={[
                'relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors',
                active ? 'text-primary-600' : 'text-neutral-400 hover:text-neutral-600',
              ].join(' ')}
            >
              <Icon className="h-5 w-5" />
              {label}
              {active && <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-primary-600" />}
            </button>
          )
        })}
      </div>

      {/* ── Tab 内容 ───────────────────────────────────────────── */}
      <div className="campus-tab-body flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <OverviewTab
            fair={fair}
            companies={companies}
            companyCount={companyCount}
            jobCount={jobCount}
            onGoTab={setTab}
            onBook={openBookingQr}
          />
        )}
        {tab === 'companies' && (
          <div className="px-5 py-4">
            <CompaniesTab fairId={fair.id} companies={companies} />
          </div>
        )}
        {tab === 'map' && (
          <MapTab fair={fair} zones={zones} navUrl={navUrl} onNav={() => navUrl && setQr({ kind: 'nav', url: navUrl })} />
        )}
        {tab === 'ai' && <AiJobTab />}
        {tab === 'print' && (
          <PrintTab onPrintMaterial={handlePrintMaterial} />
        )}
      </div>
    </div>
    </KioskPageFrame>
  )
}
