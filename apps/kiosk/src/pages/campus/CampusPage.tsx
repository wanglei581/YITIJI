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
import { useNavigate, useSearchParams } from 'react-router-dom'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { RtHelpLine } from '../recruitment-touch/RtHelpLine'
import { fmtFairDateTime, fmtFairSyncDate, fmtFairTime } from '../job-fairs/fairFormat'
import { RtFill } from '../recruitment-touch/RtFill'
import { RtFrame } from '../recruitment-touch/RtFrame'
import type {
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairLiveStatsDTO,
} from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  BuildingIcon,
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
import { evaluateJobSourceTrust } from '../jobs/utils/sourceTrust'

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

function campusFairLines(fair: ExternalJobFairDTO): string[] {
  const status = STATUS_CONFIG[fair.status]?.label
  const when = fair.startTime && fair.endTime
    ? `${fmtFairDateTime(fair.startTime)} – ${fmtFairTime(fair.endTime)}`
    : (fair.startTime ? fmtFairDateTime(fair.startTime) : (fair.endTime ? fmtFairDateTime(fair.endTime) : ''))
  const place = [fair.city, fair.venue].filter(Boolean).join(' · ')
  const source = [
    fair.sourceName ? `来源 ${fair.sourceName}` : '',
    fair.syncTime ? `同步 ${fmtFairSyncDate(fair.syncTime)}` : '',
  ].filter(Boolean).join(' · ')
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : fair.boothCount
  const counts = [
    companyCount != null ? `企业 ${companyCount}` : '',
    fair.jobCount != null ? `岗位 ${fair.jobCount}` : '',
    fair.expectedAttendance != null ? `预计 ${fair.expectedAttendance} 人` : '',
  ].filter(Boolean).join(' · ')
  return [
    status ? `状态 ${status}` : '',
    when,
    place,
    fair.address ?? '',
    fair.organizer ? `主办 ${fair.organizer}` : '',
    source,
    counts,
  ].filter(Boolean)
}

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
  const [searchParams] = useSearchParams()
  const fairId = searchParams.get('fair')

  const [fairs, setFairs] = useState<ExternalJobFairDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [tab,     setTab]     = useState<TabKey>('overview')
  const [qr,      setQr]      = useState<QrState>(null)

  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones,     setZones]     = useState<FairZoneDTO[]>([])
  const [stats,     setStats]     = useState<FairLiveStatsDTO | null>(null)
  const { getToken } = useAuth()

  const fair = fairId ? fairs.find((item) => item.id === fairId) ?? null : null

  // 浏览记录(P1):校园专区主体招聘会真实加载后上报;fire-and-forget,服务端 30 分钟去重。
  useEffect(() => {
    if (fair?.id) recordBrowse(getToken(), 'job_fair', fair.id)
  }, [fair?.id, getToken])

  // 外部跳转记录(P1):只记录「打开来源平台预约入口」;预约结果以来源平台为准,本系统不记录。
  const openBookingQr = () => {
    if (fair && evaluateJobSourceTrust(fair).ok) {
      recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    }
    setQr({ kind: 'book' })
  }

  // 取一场校园主题招聘会作为本专区主体；有 terminalId 时后端已按本校/未结束优先排序。
  useEffect(() => {
    let cancelled = false
    const terminalId = getTerminalId()
    setLoading(true)
    setLoadError(false)
    getJobFairs(terminalId ? { terminalId } : undefined)
      .then((res) => {
        if (cancelled) return
        const campus = res.data.filter(isCampusFair)
        const ordered = terminalId ? campus : [...campus].sort((a, b) => campusScore(b) - campusScore(a))
        setFairs(ordered)
      })
      .catch(() => { if (!cancelled) { setLoadError(true); setFairs([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

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

  if (loading) {
    return (
      <RtFrame eyebrow="校园招聘" title="挑一场校园招聘会" sub="正在读取已发布的校园场次" status={{ text: '正在读取校园招聘会' }} backLabel="返回" onBack={() => navigate('/fairs-service')} ask={{ label: '问小青：怎么挑一场', draft: '怎么挑一场校园招聘会？', voice: true }}>
        <div className="rt-state">
          <section className="rt-statecard">
            <h2>正在读取校园招聘会</h2>
            <p>未返回前不显示场次名称、时间地点和来源，也不拿示例场次把这一页填上。</p>
            <RtHelpLine />
          </section>
          <RtFill preset="campus" />
        </div>
      </RtFrame>
    )
  }
  if (loadError) {
    return (
      <RtFrame
        eyebrow="校园招聘"
        title="挑一场校园招聘会"
        sub="这次没有读到场次"
        status={{ text: '校园招聘会这次没取到', tone: 'warn' }}
        backLabel="返回"
        onBack={() => navigate('/fairs-service')}
        ask={{ label: '问小青：怎么挑一场', draft: '怎么挑一场校园招聘会？', voice: true }}
        primary={{ label: '重新加载', onClick: () => setReloadKey((key) => key + 1), noArrow: true }}
      >
        <div className="rt-state">
          <section className="rt-statecard">
            <h2>校园招聘会这次没取到</h2>
            <p>请求失败了。本机不显示上一次的缓存场次，避免按已经结束的时间地点白跑。</p>
            <RtHelpLine />
          </section>
          <QxTouchTile icon="map" title="查看招聘会" desc="社会场次和校园场次都在列表里" onClick={() => navigate('/job-fairs')} />
          <RtFill preset="campus" />
        </div>
      </RtFrame>
    )
  }
  if (!fairId || !fair) {
    return (
      <RtFrame
        eyebrow="校园招聘"
        title="挑一场校园招聘会"
        sub="从已发布的校园场次里选一场，再看企业、展位和资料"
        status={fairs.length ? { text: '按来源原文展示' } : { text: '还没有校园招聘会' }}
        backLabel="返回"
        onBack={() => navigate('/fairs-service')}
        ask={{ label: '问小青：怎么挑一场', draft: '怎么挑一场校园招聘会？', voice: true }}
        primary={fairs.length
          ? { label: '全部校园招聘会', onClick: () => navigate('/job-fairs?audience=campus') }
          : { label: '查看招聘会', onClick: () => navigate('/job-fairs') }}
      >
        {fairId && !fair ? (
          <QxTouchCallout kind="remind">这场不在当前校园招聘会名单里。本机不用别的场次顶上。</QxTouchCallout>
        ) : null}
        {fairs.length === 0 ? (
          <div className="rt-state">
            <section className="rt-statecard">
              <h2>还没有校园招聘会</h2>
              <p>来源机构还没有已发布的校园场次，本机不会拿往期活动充数。</p>
              <RtHelpLine />
              <button type="button" className="rt-textbtn" onClick={() => setReloadKey((key) => key + 1)}>重新加载</button>
            </section>
            <RtFill preset="campus" />
          </div>
        ) : (
          <div className="rt-list">
            {fairs.map((item) => (
              <button key={item.id} type="button" className="rt-fair" onClick={() => navigate(`/campus?fair=${encodeURIComponent(item.id)}`)}>
                <span className="rt-fair-top">
                  <b>{item.name}</b>
                  {STATUS_CONFIG[item.status]?.label ? <span className="rt-tag">{STATUS_CONFIG[item.status].label}</span> : null}
                </span>
                {campusFairLines(item).filter((line) => !line.startsWith('状态 ')).map((line) => <small key={line}>{line}</small>)}
              </button>
            ))}
          </div>
        )}
        <p className="rt-note">预约与办理都在来源平台完成。本机不代预约，也不做签到。</p>
        <div className="rt-doors">
          <QxTouchTile icon="clipboard" title="校招岗位" desc="看分类为校招的来源岗位" onClick={() => navigate('/jobs?category=campus')} />
          <QxTouchTile icon="clock" title="实习岗位" desc="看分类为实习的来源岗位" tone="slate" onClick={() => navigate('/jobs?category=intern')} />
          <QxTouchTile icon="layers" title="校园招聘数据" desc="只显示经核验的聚合统计" onClick={() => navigate('/campus/freshman-insights')} />
          <QxTouchTile icon="map" title="全部校园招聘会" desc="场次名单里只留校园相关" tone="slate" onClick={() => navigate('/job-fairs?audience=campus')} />
        </div>
      </RtFrame>
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
    <RtFrame
      eyebrow="校园招聘会"
      title={fair.name}
      sub="招聘会与来源平台信息"
      status={{ text: sc.label }}
      backLabel="返回校园招聘"
      onBack={() => navigate('/campus')}
      ask={{ label: '问小青：这场怎么看', draft: '这场怎么看', voice: true }}
    >
    <div className="campus-proto">
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

      {/* 顶栏由 KioskPageFrame pagehead 统一提供，不再自绘 campus-topbar（避免双顶栏/双返回）。 */}
      <div className="campus-hero">
        <div className="flex items-center justify-end">
          <span className="campus-date tabular-nums">
            {fmtDateBadge(fair.startTime, fair.endTime)}
          </span>
        </div>
        <div className="mt-5 flex items-start gap-3">
          <h2 className="flex-1">
            {fair.name}
            <span className="campus-status">{sc.label}</span>
          </h2>
        </div>
        {fair.tagline && <p className="tagline">{fair.tagline}</p>}
        <div className="campus-hero-meta">
          <span>
            <MapPinIcon aria-hidden="true" />{fair.venue}
          </span>
          <span>
            <BuildingIcon aria-hidden="true" />参展企业 {companyCount} 家
          </span>
          <span>
            <BriefcaseIcon aria-hidden="true" />招聘岗位 {jobCount}+
          </span>
        </div>
      </div>

      {/* ── Tab 栏 ─────────────────────────────────────────────── */}
      <div className="campus-tabs">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={active}
              className="campus-tab"
            >
              <Icon aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      {/* ── Tab 内容 ───────────────────────────────────────────── */}
      <div className="campus-tab-body">
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
          <div className="campus-tab-pane">
            <CompaniesTab fairId={fair.id} companies={companies} />
          </div>
        )}
        {tab === 'map' && (
          <MapTab fair={fair} zones={zones} navUrl={navUrl} onNav={() => navUrl && setQr({ kind: 'nav', url: navUrl })} />
        )}
        {tab === 'ai' && <AiJobTab companies={companies} />}
        {tab === 'print' && (
          <PrintTab onPrintMaterial={handlePrintMaterial} />
        )}
      </div>
      <RtFill preset="campus" />
    </div>
    </RtFrame>
  )
}
