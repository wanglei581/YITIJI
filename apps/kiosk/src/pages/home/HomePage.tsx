// 首页 · 墨青纸感（inkpaper）视觉迁移
//
// 视觉：对齐定稿原型 .workbuddy/prototypes/fusion-youth-preview-v5.html 首页屏
//（墨绿顶栏 + Hero 实时时钟 + 身份条叠压 + 分类卡/子入口 + 合规脚注）。
// 样式集中在 home-inkpaper.css（.khome 作用域），图标走 kiosk-icon Symbol sprite。
//
// 本轮口径（2026-07-04 视觉迁移 + 保功能）：只换视觉皮肤，不回退 main 既有能力——
// ContinuePanel（继续上次）、可点击统计直达明细页、现有入口数量 / 路由 / 业务分组、
// intent 分流、登录态统计、百宝箱 / 智慧校园动态配置均保持不变。
// 诚实化（2026-07-04）：首页「登录后保存」类文案改为真实口径——登录后可在「我的」查看
// 已生成的简历 / 文档 / AI记录 / 打印订单 / 收藏，不承诺自动保存；岗位投递与招聘会预约仍需去来源平台。
import type {
  KioskToolboxConfig,
  KioskToolboxItem,
  MemberPrintOrderItem,
  MemberResumeItem,
  SmartCampusModuleKey,
} from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../components/kiosk-icon'
import { useInkRipple } from '../../hooks/useInkRipple'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import { getMyAiRecords, getMyDocuments, getMyResumes } from '../../services/api/memberAssets'
import { getMyFavorites } from '../../services/api/memberFavorites'
import { getMyPrintOrders } from '../../services/api/memberPrintOrders'
import { getCachedKioskTerminalConfig, getTerminalId } from '../../services/api/terminalConfig'
import { ExternalLaunchModal, QrLaunchModal } from './components/ToolboxLaunchModals'
import './home-inkpaper.css'

const EMPTY_TOOLBOX_CONFIG: KioskToolboxConfig = { enabled: false, items: [] }
let cachedToolboxConfig: KioskToolboxConfig = EMPTY_TOOLBOX_CONFIG

function useClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])

  const pad = (n: number) => String(n).padStart(2, '0')
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${pad(now.getMonth() + 1)}月${now.getDate()}日 · ${week}`,
  }
}

/* ── 顶栏（v5 topbar 语汇：墨绿条 + 品牌徽标 + 状态药丸；时钟只在 Hero） ── */
function KioskTopBar() {
  return (
    <header className="k-top">
      <span className="k-mark">
        <KIcon name="logo" />
      </span>
      <div className="k-brand">
        <strong>AI求职打印一体机</strong>
        <span>求职材料 · 招聘会 · 打印扫描</span>
      </div>
      <div className="k-status">
        <span className="k-pill">
          <i className="k-dot" aria-hidden="true" />
          打印机在线
        </span>
        <span className="k-pill">
          <KIcon name="wifi" />
          网络正常
        </span>
      </div>
    </header>
  )
}

interface HomeStats {
  resumes: number
  documents: number
  aiRecords: number
  favorites: number
}

function useHomeStats(isLoggedIn: boolean, getToken: () => string | null) {
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) {
      setStats(null)
      return
    }

    const token = getToken()
    if (!token) {
      setStats(null)
      return
    }

    let alive = true
    setLoading(true)

    // C-2D 分页化:列表只取 1 条,统计用服务端真实 total(绝不拿页内条数冒充总数)
    Promise.all([
      getMyResumes(token, { pageSize: 1 }),
      getMyDocuments(token, { pageSize: 1 }),
      getMyAiRecords(token, { pageSize: 1 }),
      getMyFavorites(token, undefined, { pageSize: 1 }),
    ])
      .then(([resumes, documents, aiRecords, favorites]) => {
        if (!alive) return
        setStats({
          resumes: resumes.total,
          documents: documents.total,
          aiRecords: aiRecords.total,
          favorites: favorites.total,
        })
      })
      .catch(() => {
        if (alive) setStats(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [isLoggedIn, getToken])

  return { stats, loading }
}

/* ── Hero（v5 首页 Hero：深绿渐变 + 斜纹 + 装饰圆环 + 实时时钟） ── */
function HeroSection() {
  const { time, date } = useClock()

  return (
    <section className="hero" aria-label="AI求职打印一体机欢迎区">
      <div className="hero-copy">
        <div className="hero-eyebrow">
          <KIcon name="logo" />
          就业服务 · 一体机自助办理
        </div>
        <h1>
          简历、打印、岗位信息
          <br />
          一趟办完
        </h1>
        <p>今天能办的事都在下面，点开对应卡片直接进入；登录后可在「我的」查看已生成的简历、文档、AI记录、打印订单和收藏，岗位投递与招聘会预约仍需前往来源平台完成。</p>
      </div>
      <div className="hero-clock" aria-label="当前时间">
        <div className="time">{time}</div>
        <div className="date">{date}</div>
      </div>
    </section>
  )
}

/* ── 身份条（登录态显示统计，统计格可点击直达明细；未登录显示引导） ── */
function IdentityPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, guestMode, displayName, continueAsGuest, logout, getToken } = useAuth()
  const { stats, loading } = useHomeStats(isLoggedIn, getToken)

  const goLogin = () => navigate('/login', { state: { from: location.pathname } })

  if (isLoggedIn) {
    const initial = displayName.replace(/\s/g, '').slice(0, 1) || '我'
    // A 档增强：统计数字点击直达本人对应明细页（保留 main 能力，不做纯展示）
    const cells: { label: string; value: string; href: string }[] = [
      { label: '简历', value: loading || !stats ? '—' : String(stats.resumes), href: '/me/resumes' },
      { label: '文档', value: loading || !stats ? '—' : String(stats.documents), href: '/me/documents' },
      { label: 'AI记录', value: loading || !stats ? '—' : String(stats.aiRecords), href: '/me/ai-records' },
      { label: '收藏', value: loading || !stats ? '—' : String(stats.favorites), href: '/me/favorites' },
    ]

    return (
      <section className="identity" aria-label="登录状态">
        <div className="id-ava">{initial}</div>
        <div className="id-copy">
          <span className="id-kicker">
            <i className="k-dot" aria-hidden="true" />
            已登录
          </span>
          <strong>{displayName}</strong>
          <p>可查看本人的简历、文档、AI记录和收藏</p>
        </div>
        <div className="id-stats">
          {cells.map((cell) => (
            <button
              key={cell.label}
              type="button"
              className="id-stat"
              onClick={() => navigate(cell.href)}
              aria-label={`查看我的${cell.label}`}
            >
              <b>{cell.value}</b>
              <span>{cell.label}</span>
            </button>
          ))}
        </div>
        <div className="id-actions">
          <button type="button" className="btn ghost" onClick={() => logout()}>
            退出
          </button>
          <button type="button" className="btn primary lg" onClick={() => navigate('/profile')}>
            进入我的
            <KIcon name="arrow" />
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="identity" aria-label="登录状态">
      <div className="id-ava">
        <KIcon name="user" />
      </div>
      <div className="id-copy">
        <span className="id-kicker">
          <i className="k-dot" aria-hidden="true" />
          {guestMode ? '匿名使用中' : '未登录 · 可先体验'}
        </span>
        <strong>
          {guestMode ? '当前为匿名使用' : '登录后可在「我的」查看已生成的简历、文档、AI记录、打印订单和收藏'}
        </strong>
        <p>
          {guestMode
            ? '本次服务记录仅在当前会话中保留'
            : '游客可直接使用大部分功能；岗位投递与招聘会预约仍需前往来源平台完成。'}
        </p>
      </div>
      <div className="id-actions">
        {!guestMode && (
          <button type="button" className="btn ghost" onClick={continueAsGuest}>
            游客体验
          </button>
        )}
        <button type="button" className="btn primary lg cta" onClick={goLogin}>
          立即登录 / 注册
          <KIcon name="arrow" />
        </button>
      </div>
    </section>
  )
}

/* ── 服务分组（路由 / intent / 分组顺序与换装前完全一致；视觉换 v5 cat-card/sub 语汇） ── */
interface ServiceTile {
  title: string
  icon: KioskIconName
  to?: string
  state?: Record<string, unknown>
  disabled?: boolean
}

type Accent = 'teal' | 'clay' | 'slate' | 'wheat' | 'plum' | 'tool'

interface ServiceGroup {
  title: string
  subtitle: string
  icon: KioskIconName
  accent: Accent
  span2?: boolean
  cols2?: boolean
  badge?: { icon: KioskIconName; label: string }
  tiles: ServiceTile[]
  /** 组标题点击目标；未设置时沿用原逻辑（跳到第一个可用子项）。 */
  titleTo?: string
}

const SERVICE_GROUPS: ServiceGroup[] = [
  {
    title: 'AI简历服务',
    subtitle: '诊断、优化、打印，一次完成',
    icon: 'resume',
    accent: 'teal',
    span2: true,
    badge: { icon: 'star', label: '推荐先做' },
    tiles: [
      // intent 分流:同一上传链路,按入口语义展示不同标题/说明/引导(视觉与分组结构不变)
      { title: 'AI简历诊断', icon: 'doc-check', to: '/resume/source?intent=diagnose' },
      { title: 'AI简历优化', icon: 'sparkle', to: '/resume/source?intent=optimize' },
      { title: '简历素材库', icon: 'book', to: '/resume/templates' },
      { title: '职业规划', icon: 'compass', to: '/resume/career-plan' },
      { title: '简历打印', icon: 'printer', to: '/print/upload?source=resume' },
      { title: '求职材料', icon: 'briefcase', to: '/resume/materials' },
    ],
  },
  {
    title: '岗位信息',
    subtitle: '第三方来源岗位，去来源平台投递',
    icon: 'briefcase',
    accent: 'clay',
    tiles: [
      { title: '全职岗位', icon: 'briefcase', to: '/jobs?category=fulltime' },
      { title: '实习岗位', icon: 'campus', to: '/jobs?category=intern' },
      { title: '兼职信息', icon: 'clock', to: '/jobs?category=parttime' },
      { title: '全部岗位', icon: 'files', to: '/jobs' },
      { title: '找企业', icon: 'shield', to: '/companies' },
      { title: '岗位大师', icon: 'star', disabled: Boolean(true) },
    ],
  },
  {
    title: '招聘会',
    subtitle: '查看场次信息，去来源平台预约',
    icon: 'pin',
    accent: 'wheat',
    tiles: [
      { title: '社会招聘会', icon: 'pin', to: '/job-fairs' },
      { title: '校园招聘会', icon: 'campus', to: '/campus' },
      { title: '扫码签到', icon: 'qr', to: '/job-fairs/checkin' },
    ],
  },
  {
    title: '打印扫描',
    subtitle: '上传或扫描，本机直接出纸',
    icon: 'printer',
    accent: 'slate',
    titleTo: '/print-scan',
    tiles: [
      { title: '文档打印', icon: 'printer', to: '/print/upload?source=document' },
      { title: '证件复印', icon: 'files', disabled: Boolean(true) },
      { title: '纸质扫描', icon: 'scan', to: '/scan/start' },
      { title: '云打印', icon: 'cloud', disabled: Boolean(true) },
      { title: '格式转换', icon: 'swap', disabled: Boolean(true) },
      { title: '证件照打印', icon: 'user', disabled: Boolean(true) },
    ],
  },
  {
    title: 'AI面试训练',
    subtitle: '模拟练习，仅供参考',
    icon: 'headset',
    accent: 'plum',
    tiles: [
      { title: '模拟面试', icon: 'mic', to: '/interview/setup' },
      { title: '面试技巧', icon: 'bulb', to: '/interview/tips' },
      { title: '面试报告', icon: 'doc-check', to: '/interview/reports' },
    ],
  },
  {
    // 合规:补贴类只做政策说明/材料清单/官方入口/申请指引(info-only),
    // 不出现"快申/申请"等暗示平台内办理的表述。
    title: '政策服务',
    subtitle: '政策查询与办事材料指引',
    icon: 'policy',
    accent: 'wheat',
    span2: true,
    tiles: [
      { title: '就业政策', icon: 'policy', to: '/renshi?tab=policy' },
      { title: '补贴指引', icon: 'ticket', to: '/renshi?tab=social' },
      { title: '档案 / 登记', icon: 'files', to: '/renshi?tab=register' },
    ],
  },
]

const SUB_ACCENT: Record<Accent, string> = {
  teal: '',
  clay: 'clay',
  slate: 'slate',
  wheat: 'wheat',
  plum: 'plum',
  tool: '',
}

function ServiceTileButton({ tile, accent }: { tile: ServiceTile; accent: Accent }) {
  const navigate = useNavigate()
  const disabled = tile.disabled || !tile.to

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => tile.to && navigate(tile.to, tile.state ? { state: tile.state } : undefined)}
      className={['sub', SUB_ACCENT[accent], disabled ? 'disabled' : ''].filter(Boolean).join(' ')}
    >
      <span className="si">
        <KIcon name={tile.icon} />
      </span>
      <span className="label">{tile.title}</span>
      {disabled ? (
        <span className="soon">即将上线</span>
      ) : (
        <span className="arrow">
          <KIcon name="arrow" />
        </span>
      )}
    </button>
  )
}

function ServiceGroupCard({ group }: { group: ServiceGroup }) {
  const navigate = useNavigate()
  const enabledFirst = group.tiles.find((tile) => tile.to && !tile.disabled)
  const titleTarget = group.titleTo ?? enabledFirst?.to

  return (
    <section className={group.span2 ? 'cat-card span2' : 'cat-card'}>
      <div
        className="cat-head tap"
        role="button"
        tabIndex={0}
        onClick={() => titleTarget && navigate(titleTarget)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && titleTarget) navigate(titleTarget)
        }}
      >
        <span className={`cat-icon ${group.accent}`}>
          <KIcon name={group.icon} />
        </span>
        <div className="cat-title">
          <h3>{group.title}</h3>
          <p>{group.subtitle}</p>
        </div>
        {group.badge && (
          <span className="cat-badge">
            <KIcon name={group.badge.icon} />
            {group.badge.label}
          </span>
        )}
      </div>

      <div
        className={group.cols2 ? 'sub-grid cols2' : 'sub-grid'}
        style={group.span2 ? { gridTemplateColumns: `repeat(${Math.min(group.tiles.length, 6)}, 1fr)` } : undefined}
      >
        {group.tiles.map((tile) => (
          <ServiceTileButton key={tile.title} tile={tile} accent={group.accent} />
        ))}
      </div>
    </section>
  )
}

// ─── 继续上次（保留 main 的真实可恢复任务面板；仅换 inkpaper 视觉）───────────────
// 诚实前提：只对「真实可恢复的任务」展示——① 进行中的打印任务（未达终态）；
// ② 已诊断但尚未优化的简历（下一步）。无可恢复任务不渲染。不伪造进度。
interface ResumeSuggestion {
  kind: 'print' | 'optimize'
  title: string
  detail: string
  actionLabel: string
  onGo: () => void
  icon: KioskIconName
}

const ACTIVE_PRINT_STATUSES = new Set(['pending', 'claimed', 'printing'])
const PRINT_STATUS_TEXT: Record<string, string> = {
  pending: '排队中',
  claimed: '已领取',
  printing: '打印中',
}

function ContinuePanel() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [suggestion, setSuggestion] = useState<ResumeSuggestion | null>(null)

  useEffect(() => {
    if (!isLoggedIn) {
      setSuggestion(null)
      return
    }
    const token = getToken()
    if (!token) {
      setSuggestion(null)
      return
    }

    let alive = true
    Promise.all([getMyPrintOrders(token, { pageSize: 5 }), getMyResumes(token, { pageSize: 5 })])
      .then(([orders, resumes]) => {
        if (!alive) return
        // 优先级 1：进行中的打印任务（真实未完成）
        const activePrint = orders.items.find((o: MemberPrintOrderItem) => ACTIVE_PRINT_STATUSES.has(o.status))
        if (activePrint) {
          setSuggestion({
            kind: 'print',
            title: '打印任务进行中',
            detail: `${activePrint.fileName ?? '打印文件'} · ${PRINT_STATUS_TEXT[activePrint.status] ?? activePrint.status}`,
            actionLabel: '查看进度',
            onGo: () => navigate('/me/print-orders'),
            icon: 'printer',
          })
          return
        }
        // 优先级 2：已诊断但未优化的简历（真实下一步）
        const diagnosed = resumes.items.find(
          (r: MemberResumeItem) => r.kind === 'parse' && r.status === 'completed' && !r.optimized,
        )
        if (diagnosed) {
          setSuggestion({
            kind: 'optimize',
            title: '上次诊断的简历，可继续优化',
            detail: '已完成诊断 · 一键进入 AI 优化，生成可打印版本',
            actionLabel: '去优化',
            onGo: () =>
              navigate(`/resume/optimize?taskId=${encodeURIComponent(diagnosed.taskId)}`, {
                state: { taskId: diagnosed.taskId },
              }),
            icon: 'sparkle',
          })
          return
        }
        setSuggestion(null)
      })
      .catch(() => {
        if (alive) setSuggestion(null)
      })

    return () => {
      alive = false
    }
  }, [isLoggedIn, getToken, navigate])

  if (!suggestion) return null

  return (
    <section className="continue" aria-label="继续上次">
      <span className="c-icon">
        <KIcon name={suggestion.icon} />
      </span>
      <div className="c-copy">
        <strong>{suggestion.title}</strong>
        <p>{suggestion.detail}</p>
      </div>
      <button type="button" className="btn primary lg" onClick={suggestion.onGo}>
        {suggestion.actionLabel}
        <KIcon name="arrow" />
      </button>
    </section>
  )
}

/* ── 智慧校园（整行 cat-card；后台开关联动，关闭不渲染，逻辑不变） ── */
// 校园大数据（bigdata）本期严格冻结：不在此列出入口卡，后端开关亦强制 false。
const SMART_CAMPUS_TILES: Partial<Record<SmartCampusModuleKey, ServiceTile & { desc: string }>> = {
  welcome: {
    title: '迎新服务',
    desc: '报到流程、办事窗口、入学材料打印',
    icon: 'campus',
    to: '/smart-campus/welcome',
  },
  luggage: {
    title: '行李帮运',
    desc: '校方合作服务入口、服务点与路线说明',
    icon: 'route',
    to: '/smart-campus/service/luggage',
  },
  panorama: {
    title: 'VR校园',
    desc: '校园全景、路线导览、重点场馆介绍',
    icon: 'eye',
    to: '/smart-campus/service/panorama',
  },
}

function SmartCampusHorizontalSection() {
  const navigate = useNavigate()
  const config = useSmartCampusConfig()
  const [qrItem, setQrItem] = useState<KioskToolboxItem | null>(null)
  const [externalItem, setExternalItem] = useState<KioskToolboxItem | null>(null)
  const enabledTiles = (Object.keys(SMART_CAMPUS_TILES) as SmartCampusModuleKey[])
    .filter((key) => config.modules[key])
    .map((key) => SMART_CAMPUS_TILES[key])
    .filter((tile): tile is ServiceTile & { desc: string } => !!tile)
  const campusItems = [...(config.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  if (!config.enabled || (enabledTiles.length === 0 && campusItems.length === 0)) return null

  return (
    <>
      <section className="cat-card span2">
        <div
          className="cat-head tap"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/smart-campus')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/smart-campus')
          }}
        >
          <span className="cat-icon slate">
            <KIcon name="campus" />
          </span>
          <div className="cat-title">
            <h3>智慧校园</h3>
            <p>学校专属服务专区，仅校园终端开启时显示</p>
          </div>
          <span className="cat-badge">
            <KIcon name="check" />
            学校端已开启
          </span>
        </div>
        <div className="sub-grid">
          {enabledTiles.map((tile) => (
            <ServiceTileButton key={tile.title} tile={tile} accent="slate" />
          ))}
          {campusItems.map((item) => (
            <ToolboxItemButton key={item.key} item={item} onQr={setQrItem} onExternal={setExternalItem} accent="blue" />
          ))}
        </div>
      </section>
      <QrLaunchModal item={qrItem} placement="smart_campus" onClose={() => setQrItem(null)} />
      <ExternalLaunchModal item={externalItem} placement="smart_campus" onClose={() => setExternalItem(null)} />
    </>
  )
}

/* ── 百宝箱（终端配置驱动；逻辑不变，视觉换 cat-card/sub 语汇） ── */
const TOOLBOX_ICONS: Record<string, KioskIconName> = {
  wrench: 'toolbox',
  'file-text': 'files',
  printer: 'printer',
  sparkles: 'sparkle',
  'book-open': 'book',
  'help-circle': 'help',
}

function useToolboxConfig() {
  const [config, setConfig] = useState<KioskToolboxConfig>(() => cachedToolboxConfig)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const terminalId = getTerminalId()
        const terminalConfig = await getCachedKioskTerminalConfig(terminalId)
        cachedToolboxConfig = terminalConfig.toolbox
        if (alive) setConfig(terminalConfig.toolbox)
      } catch {
        if (alive) setConfig(cachedToolboxConfig)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return config
}

function launchKioskAppItem(
  item: KioskToolboxItem,
  navigate: ReturnType<typeof useNavigate>,
  onQr: (item: KioskToolboxItem) => void,
  onExternal: (item: KioskToolboxItem) => void,
) {
  const launchMode = item.launchMode ?? 'internal_route'
  if (launchMode === 'internal_route' && item.to) {
    navigate(item.to)
    return
  }
  if (launchMode === 'external_url' && item.externalUrl) {
    onExternal(item)
    return
  }
  if ((launchMode === 'qr_code' || launchMode === 'mini_program_qr') && item.qrImageUrl) {
    onQr(item)
  }
}

function itemLaunchable(item: KioskToolboxItem): boolean {
  const launchMode = item.launchMode ?? 'internal_route'
  if (launchMode === 'internal_route') return !!item.to
  if (launchMode === 'external_url') return !!item.externalUrl
  return !!item.qrImageUrl
}

function itemBadge(item: KioskToolboxItem): string | null {
  if (item.disabled || !itemLaunchable(item)) return '即将上线'
  if (item.launchMode === 'external_url') return '外部应用'
  if (item.launchMode === 'qr_code') return '扫码'
  if (item.launchMode === 'mini_program_qr') return '小程序'
  return null
}

function ToolboxItemButton({
  item,
  onQr,
  onExternal,
  accent = 'slate',
}: {
  item: KioskToolboxItem
  onQr: (item: KioskToolboxItem) => void
  onExternal: (item: KioskToolboxItem) => void
  accent?: 'slate' | 'blue'
}) {
  const navigate = useNavigate()
  const disabled = item.disabled || !itemLaunchable(item)
  const badge = itemBadge(item)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && launchKioskAppItem(item, navigate, onQr, onExternal)}
      className={['sub', accent === 'blue' ? 'slate' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ')}
      title={item.description}
    >
      <span className="si">
        <KIcon name={TOOLBOX_ICONS[item.icon] ?? 'toolbox'} />
      </span>
      <span className="label">{item.title}</span>
      {badge ? (
        <span className="soon">{badge}</span>
      ) : (
        <span className="arrow">
          <KIcon name="arrow" />
        </span>
      )}
    </button>
  )
}

function ToolboxSection() {
  const config = useToolboxConfig()
  const [qrItem, setQrItem] = useState<KioskToolboxItem | null>(null)
  const [externalItem, setExternalItem] = useState<KioskToolboxItem | null>(null)
  const items = config.enabled ? [...(config.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder) : []

  // 用户口径（2026-07-03）：百宝箱常驻首页；未配置工具时显示「待配置」空态。
  // 仅当终端配置整体关闭 toolbox 时才隐藏（与换装前行为一致）。
  if (!config.enabled) return null

  return (
    <>
      <section className="cat-card span2">
        <div className="cat-head">
          <span className="cat-icon tool">
            <KIcon name="toolbox" />
          </span>
          <div className="cat-title">
            <h3>百宝箱</h3>
            <p>本机已配置的扩展服务，经审核后上架</p>
          </div>
          <span className="cat-badge muted">
            <KIcon name="shield" />
            已审核
          </span>
        </div>
        {items.length > 0 ? (
          <div className="sub-grid">
            {items.map((item) => (
              <ToolboxItemButton key={item.key} item={item} onQr={setQrItem} onExternal={setExternalItem} />
            ))}
          </div>
        ) : (
          <div className="cat-empty">
            <strong>待配置</strong>
            <p>后续功能上线后将在这里展示。</p>
          </div>
        )}
      </section>
      <QrLaunchModal item={qrItem} placement="toolbox" onClose={() => setQrItem(null)} />
      <ExternalLaunchModal item={externalItem} placement="toolbox" onClose={() => setExternalItem(null)} />
    </>
  )
}

export function HomePage() {
  useInkRipple('.khome .sub, .khome .btn, .khome .id-stat')

  return (
    <div className="khome">
      <KioskTopBar />

      <div className="khome-inner">
        <HeroSection />
        <IdentityPanel />
        <ContinuePanel />
      </div>

      <div className="khome-inner">
        <div className="sec-head">
          <span className="rail" aria-hidden="true" />
          <div>
            <h2>今天可以办理</h2>
            <p>点按钮直接进入对应功能，操作不超过 3 步。</p>
          </div>
        </div>

        <main className="home-grid">
          {SERVICE_GROUPS.map((group) => (
            <ServiceGroupCard key={group.title} group={group} />
          ))}
          <ToolboxSection />
          <SmartCampusHorizontalSection />
        </main>
      </div>

      <div className="khome-inner">
        <p className="compliance">
          <KIcon name="shield" />
          岗位和招聘会仅作为第三方 / 官方来源信息入口，投递与预约请前往来源平台完成。
        </p>
      </div>
    </div>
  )
}
