// 首页 · 青序 LightFlow（service-desk）视觉迁移
//
// 样式按页面壳层、服务入口、续办信息与响应式拆分，由 home-service-desk.css 聚合；
// 图标继续走 kiosk-icon Symbol sprite。
//
// 本轮口径：只换视觉皮肤，不回退 main 既有能力——
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
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../components/kiosk-icon'
import { ReferenceServiceNav } from '../../components/lightflow/ReferenceServiceNav'
import { useInkRipple } from '../../hooks/useInkRipple'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import { MemberLoginDialog } from '../auth/components/MemberLoginDialog'
import { getMyAiRecords, getMyDocuments, getMyResumes } from '../../services/api/memberAssets'
import { getMyFavorites } from '../../services/api/memberFavorites'
import { getMyPrintOrders } from '../../services/api/memberPrintOrders'
import { getCachedKioskTerminalConfig, getTerminalId } from '../../services/api/terminalConfig'
import { ExternalLaunchModal, QrLaunchModal } from './components/ToolboxLaunchModals'
import { useHomeDeviceStatus } from './hooks/useHomeDeviceStatus'
import { SERVICE_GROUPS, SUB_ACCENT, type Accent, type ServiceGroup, type ServiceTile } from './serviceGroups'
import './home-service-desk.css'

const EMPTY_TOOLBOX_CONFIG: KioskToolboxConfig = { enabled: false, items: [] }
let cachedToolboxConfig: KioskToolboxConfig = EMPTY_TOOLBOX_CONFIG
const HOME_REFERENCE_HASH_IDS = new Set(['resume', 'jobs', 'job-fairs', 'print-scan', 'interview', 'policy'])

/* ── 顶栏（LightFlow 白色服务台 + 真实设备状态） ── */
function KioskTopBar() {
  const deviceStatus = useHomeDeviceStatus()
  const [now, setNow] = useState(() => new Date())
  const terminalId = getTerminalId() || '01号机'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const clock = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)

  return (
    <header className="k-top">
      <div className="k-brand">
        <strong>就业服务大厅 · {terminalId}</strong>
        <span>AI求职打印一体机</span>
      </div>
      <div className="k-status" role="status" aria-live="polite">
        <time className="k-clock">{clock}</time>
        <span className="k-device-status" data-status={deviceStatus.tone}>
          <i aria-hidden="true" />
          {deviceStatus.label} · {deviceStatus.paperLabel}
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

/* ── 身份条（登录态显示统计，统计格可点击直达明细；未登录显示引导） ── */
function IdentityPanel() {
  const navigate = useNavigate()
  const { isLoggedIn, guestMode, displayName, continueAsGuest, logout, getToken } = useAuth()
  const { stats, loading } = useHomeStats(isLoggedIn, getToken)
  const [loginOpen, setLoginOpen] = useState(false)
  const loginTriggerRef = useRef<HTMLButtonElement>(null)

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
        <button
          ref={loginTriggerRef}
          type="button"
          className="btn primary lg cta"
          onClick={() => setLoginOpen(true)}
        >
          登录 / 注册
          <KIcon name="arrow" />
        </button>
      </div>
      <MemberLoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onContinueAsGuest={() => {
          continueAsGuest()
          setLoginOpen(false)
        }}
      />
    </section>
  )
}

function ExtensionServiceButton({ tile }: { tile: ServiceTile }) {
  const navigate = useNavigate()
  const disabled = tile.disabled || !tile.to

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => tile.to && navigate(tile.to, tile.state ? { state: tile.state } : undefined)}
      className="home-extension-action"
    >
      <span className="home-extension-icon">
        <KIcon name={tile.icon} />
      </span>
      <span className="home-extension-copy">
        <strong>{tile.title}</strong>
        {tile.description && <span>{tile.description}</span>}
      </span>
      {disabled ? (
        <span className="home-reference-state">即将上线</span>
      ) : (
        <span className="home-reference-arrow">
          <KIcon name="arrow" />
        </span>
      )}
    </button>
  )
}

function findServiceGroup(id: string): ServiceGroup {
  const group = SERVICE_GROUPS.find((candidate) => candidate.id === id)
  if (!group) throw new Error(`Missing service group: ${id}`)
  return group
}

function ReferenceGroupHead({ group, headingId }: { group: ServiceGroup; headingId: string }) {
  const navigate = useNavigate()
  const enabledFirst = group.tiles.find((tile) => tile.to && !tile.disabled)
  const titleTarget = group.titleTo ?? enabledFirst?.to

  return (
    <div className="lf-reference-group-head">
      <span className={`home-reference-icon ${SUB_ACCENT[group.accent]}`}>
        <KIcon name={group.icon} />
      </span>
      <button
        type="button"
        className="home-reference-group-copy"
        disabled={!titleTarget}
        onClick={() => titleTarget && navigate(titleTarget)}
      >
        <strong id={headingId}>{group.title}</strong>
        <span>{group.subtitle}</span>
      </button>
    </div>
  )
}

function ReferencePrimaryButton({ tile, accent }: { tile: ServiceTile; accent: Accent }) {
  const navigate = useNavigate()
  const disabled = tile.disabled || !tile.to
  const handleClick = () => {
    if (tile.to) navigate(tile.to, tile.state ? { state: tile.state } : undefined)
  }

  return (
    <button
      type="button"
      className="lf-reference-primary"
      disabled={disabled}
      onClick={handleClick}
    >
      <span className={`home-reference-icon ${SUB_ACCENT[accent]}`}>
        <KIcon name={tile.icon} />
      </span>
      <span className="home-reference-entry-copy">
        <strong>{tile.title}</strong>
        {tile.description && <span>{tile.description}</span>}
      </span>
      {disabled ? (
        <span className="home-reference-state">即将上线</span>
      ) : (
        <span className="home-reference-arrow"><KIcon name="arrow" /></span>
      )}
    </button>
  )
}

function ReferenceSecondaryButton({ tile, accent }: { tile: ServiceTile; accent: Accent }) {
  const navigate = useNavigate()
  const disabled = tile.disabled || !tile.to
  const handleClick = () => {
    if (tile.to) navigate(tile.to, tile.state ? { state: tile.state } : undefined)
  }

  return (
    <button
      type="button"
      className="lf-reference-secondary"
      disabled={disabled}
      onClick={handleClick}
    >
      <span className={`home-reference-icon ${SUB_ACCENT[accent]}`}>
        <KIcon name={tile.icon} />
      </span>
      <span className="home-reference-entry-copy">
        <strong>{tile.title}</strong>
        {tile.description && <span>{tile.description}</span>}
      </span>
      {disabled ? (
        <span className="home-reference-state">即将上线</span>
      ) : (
        <span className="home-reference-arrow"><KIcon name="arrow" /></span>
      )}
    </button>
  )
}

function ReferenceServicePanel({
  group,
}: {
  group: ServiceGroup
}) {
  const primary = group.tiles.filter((tile) => tile.emphasis === 'primary')
  const secondary = group.tiles.filter((tile) => tile.emphasis !== 'primary')

  return (
    <section
      id={group.id}
      className={`lf-reference-panel home-reference-panel home-reference-panel--${group.layout}`}
      data-accent={group.accent}
      aria-labelledby={`${group.id}-title`}
    >
      <ReferenceGroupHead group={group} headingId={`${group.id}-title`} />
      {primary.length > 0 && (
        <div className="home-reference-primary-list">
          {primary.map((tile) => (
            <ReferencePrimaryButton key={tile.title} tile={tile} accent={group.accent} />
          ))}
        </div>
      )}
      {secondary.length > 0 && (
        <div className={`home-reference-secondary-list ${primary.length === 0 ? 'home-reference-secondary-list--only' : ''}`.trim()}>
          {secondary.map((tile) => (
            <ReferenceSecondaryButton key={tile.title} tile={tile} accent={group.accent} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── 继续上次（保留 main 的真实可恢复任务面板；仅换 LightFlow 视觉）───────────────
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

/* ── 智慧校园（扁平横向扩展行；后台开关联动，关闭不渲染，逻辑不变） ── */
// 校园大数据（bigdata）本期严格冻结：不在此列出入口卡，后端开关亦强制 false。
const SMART_CAMPUS_TILES: Partial<Record<SmartCampusModuleKey, ServiceTile>> = {
  welcome: {
    title: '迎新服务',
    description: '报到流程、办事窗口、入学材料打印',
    icon: 'campus',
    to: '/smart-campus/welcome',
  },
  luggage: {
    title: '行李帮运',
    description: '校方合作服务入口、服务点与路线说明',
    icon: 'route',
    to: '/smart-campus/service/luggage',
  },
  panorama: {
    title: 'VR校园',
    description: '校园全景、路线导览、重点场馆介绍',
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
    .filter((tile): tile is ServiceTile => !!tile)
  const campusItems = [...(config.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  if (!config.enabled || (enabledTiles.length === 0 && campusItems.length === 0)) return null

  return (
    <>
      <section className="home-extension-group">
        <button
          type="button"
          className="home-extension-heading"
          onClick={() => navigate('/smart-campus')}
        >
          <span className="home-extension-icon">
            <KIcon name="campus" />
          </span>
          <span className="home-extension-copy">
            <strong>智慧校园</strong>
            <span>学校专属服务专区，仅校园终端开启时显示</span>
          </span>
          <span className="home-extension-badge">学校端已开启</span>
          <span className="home-reference-arrow"><KIcon name="arrow" /></span>
        </button>
        <div className="home-extension-list">
          {enabledTiles.map((tile) => (
            <ExtensionServiceButton key={tile.title} tile={tile} />
          ))}
          {campusItems.map((item) => (
            <ToolboxExtensionButton key={item.key} item={item} onQr={setQrItem} onExternal={setExternalItem} />
          ))}
        </div>
      </section>
      <QrLaunchModal item={qrItem} placement="smart_campus" onClose={() => setQrItem(null)} />
      <ExternalLaunchModal item={externalItem} placement="smart_campus" onClose={() => setExternalItem(null)} />
    </>
  )
}

/* ── 百宝箱（终端配置驱动；逻辑不变，使用扁平横向扩展行） ── */
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

function ToolboxExtensionButton({
  item,
  onQr,
  onExternal,
}: {
  item: KioskToolboxItem
  onQr: (item: KioskToolboxItem) => void
  onExternal: (item: KioskToolboxItem) => void
}) {
  const navigate = useNavigate()
  const disabled = item.disabled || !itemLaunchable(item)
  const badge = itemBadge(item)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && launchKioskAppItem(item, navigate, onQr, onExternal)}
      className="home-extension-action"
      title={item.description}
    >
      <span className="home-extension-icon">
        <KIcon name={TOOLBOX_ICONS[item.icon] ?? 'toolbox'} />
      </span>
      <span className="home-extension-copy">
        <strong>{item.title}</strong>
        <span>{item.description}</span>
      </span>
      {badge ? (
        <span className="home-reference-state">{badge}</span>
      ) : (
        <span className="home-reference-arrow">
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
      <section className="home-extension-group">
        <div className="home-extension-heading">
          <span className="home-extension-icon">
            <KIcon name="toolbox" />
          </span>
          <span className="home-extension-copy">
            <strong>百宝箱</strong>
            <span>本机已配置的扩展服务，经审核后上架</span>
          </span>
          <span className="home-extension-badge">已审核</span>
        </div>
        {items.length > 0 ? (
          <div className="home-extension-list">
            {items.map((item) => (
              <ToolboxExtensionButton key={item.key} item={item} onQr={setQrItem} onExternal={setExternalItem} />
            ))}
          </div>
        ) : (
          <div className="home-extension-empty">
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
  const { hash } = useLocation()
  useInkRipple('.khome .lf-reference-primary, .khome .lf-reference-secondary, .khome .home-extension-action, .khome .btn, .khome .id-stat')

  useEffect(() => {
    const targetId = hash.startsWith('#') ? hash.slice(1) : ''
    if (!HOME_REFERENCE_HASH_IDS.has(targetId)) return
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash])

  const resumeGroup = findServiceGroup('resume')
  const jobsGroup = findServiceGroup('jobs')
  const jobFairsGroup = findServiceGroup('job-fairs')
  const printScanGroup = findServiceGroup('print-scan')
  const interviewGroup = findServiceGroup('interview')
  const policyGroup = findServiceGroup('policy')

  return (
    <div className="khome">
      <KioskTopBar />

      <div className="khome-inner">
        <section className="service-value" aria-labelledby="home-service-value-title">
          <div>
            <span className="service-value-tag">一站式求职服务</span>
            <h1 id="home-service-value-title">简历、打印、岗位信息<em>一趟办完</em></h1>
            <p>提供 AI 简历服务、求职材料、岗位与招聘会信息入口，以及本机打印扫描服务。</p>
          </div>
        </section>
        <IdentityPanel />
        <ContinuePanel />
      </div>

      <ReferenceServiceNav />

      <div className="home-service-track">
        <main className="home-service-catalog" aria-label="当前可使用功能">
          <ReferenceServicePanel group={resumeGroup} />

          <div className="lf-reference-pair" aria-label="岗位信息与招聘会">
            <ReferenceServicePanel group={jobsGroup} />
            <ReferenceServicePanel group={jobFairsGroup} />
          </div>

          <ReferenceServicePanel group={printScanGroup} />

          <div className="lf-reference-pair" aria-label="面试训练与政策服务">
            <ReferenceServicePanel group={interviewGroup} />
            <ReferenceServicePanel group={policyGroup} />
          </div>

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
