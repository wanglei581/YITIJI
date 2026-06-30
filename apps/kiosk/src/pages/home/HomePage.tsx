import { Button } from '@ai-job-print/ui'
import {
  BookOpenIcon,
  BotIcon,
  BrainCircuitIcon,
  BriefcaseBusinessIcon,
  BriefcaseIcon,
  Building2Icon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  CloudUploadIcon,
  CompassIcon,
  FileBadge2Icon,
  FileSearchIcon,
  FileTextIcon,
  FileType2Icon,
  GraduationCapIcon,
  HeadphonesIcon,
  HelpCircleIcon,
  ImageIcon,
  LandmarkIcon,
  LightbulbIcon,
  MapPinIcon,
  MonitorPlayIcon,
  PackageIcon,
  PartyPopperIcon,
  PrinterIcon,
  QrCodeIcon,
  ScanFaceIcon,
  ScanLineIcon,
  SparklesIcon,
  UserCheckIcon,
  WifiIcon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import type { KioskToolboxConfig, KioskToolboxItem, SmartCampusModuleKey } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { getMyAiRecords, getMyDocuments, getMyResumes } from '../../services/api/memberAssets'
import { getMyFavorites } from '../../services/api/memberFavorites'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import { getCachedKioskTerminalConfig, getTerminalId } from '../../services/api/terminalConfig'

const HERO_IMAGE = '/assets/kiosk-home-hero-job-fair.png'
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
    date: `${week} ${pad(now.getMonth() + 1)}/${pad(now.getDate())}`,
  }
}

function KioskTopBar() {
  const { time, date } = useClock()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center border-b border-white/70 bg-white/92 px-8 shadow-sm backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <PrinterIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-lg font-bold leading-none text-slate-950">AI求职打印一体机</p>
          <p className="mt-1 text-xs font-medium text-slate-500">求职材料 · 招聘会 · 打印扫描</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-5">
        <div className="hidden items-center gap-3 text-sm font-medium text-slate-500 sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            <PrinterIcon className="h-4 w-4" aria-hidden="true" />
            打印机
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            <WifiIcon className="h-4 w-4" aria-hidden="true" />
            网络
          </span>
        </div>
        <div className="border-l border-slate-200 pl-5 text-right">
          <p className="text-xl font-bold leading-none tabular-nums text-slate-950">{time}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">{date}</p>
        </div>
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

function HeroSection() {
  return (
    <section
      className="relative min-h-[300px] overflow-hidden bg-slate-900 bg-cover bg-center"
      style={{ backgroundImage: `url(${HERO_IMAGE})` }}
      aria-label="AI求职打印一体机欢迎区"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/74 via-slate-900/36 to-slate-900/8" />
      <div className="relative flex min-h-[300px] items-center px-10">
        <div className="flex items-center gap-6">
          <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/20 text-white shadow-lg ring-1 ring-white/25 backdrop-blur">
            <PrinterIcon className="h-12 w-12" aria-hidden="true" />
          </span>
          <div className="text-white">
            <p className="text-2xl font-semibold leading-none text-white/90">您好，欢迎使用</p>
            <h1 className="mt-4 text-5xl font-extrabold leading-tight tracking-normal">AI求职打印一体机</h1>
            <p className="mt-4 text-xl font-medium text-white/82">简历服务、岗位信息、招聘会服务、打印扫描一站办理</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function IdentityPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, guestMode, displayName, continueAsGuest, logout, getToken } = useAuth()
  const { stats, loading } = useHomeStats(isLoggedIn, getToken)

  const goLogin = () => navigate('/login', { state: { from: location.pathname } })

  if (isLoggedIn) {
    const initial = displayName.replace(/\s/g, '').slice(0, 1) || '我'
    const cells: { label: string; value: string }[] = [
      { label: '简历', value: loading || !stats ? '-' : String(stats.resumes) },
      { label: '文档', value: loading || !stats ? '-' : String(stats.documents) },
      { label: 'AI记录', value: loading || !stats ? '-' : String(stats.aiRecords) },
      { label: '收藏', value: loading || !stats ? '-' : String(stats.favorites) },
    ]

    return (
      <section className="relative z-10 -mt-16 mx-auto flex w-[min(1180px,calc(100%-64px))] items-center rounded-[28px] border border-white/80 bg-white px-9 py-7 shadow-[0_18px_42px_rgba(15,23,42,0.14)]">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-blue-50 text-3xl font-bold text-blue-600 ring-4 ring-slate-100">
          {initial}
        </div>
        <div className="ml-6 min-w-0 flex-1">
          <p className="truncate text-3xl font-extrabold leading-tight text-slate-950">{displayName}</p>
          <p className="mt-2 text-lg font-semibold text-slate-500">可查看本人的简历、文档、AI记录和收藏</p>
        </div>
        <div className="mr-6 grid w-[360px] grid-cols-4 divide-x divide-slate-100">
          {cells.map((cell) => (
            <div key={cell.label} className="text-center">
              <p className="text-3xl font-extrabold tabular-nums text-slate-950">{cell.value}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">{cell.label}</p>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 gap-3">
          <Button variant="secondary" size="lg" className="h-16 rounded-2xl px-6 text-lg" onClick={() => logout()}>
            退出
          </Button>
          <Button size="lg" className="h-16 rounded-2xl px-8 text-lg" onClick={() => navigate('/profile')}>
            进入我的
            <ChevronRightIcon className="ml-1 h-6 w-6" aria-hidden="true" />
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="relative z-10 -mt-16 mx-auto flex w-[min(1180px,calc(100%-64px))] items-center rounded-[28px] border border-white/80 bg-white px-9 py-7 shadow-[0_18px_42px_rgba(15,23,42,0.14)]">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-300 ring-4 ring-slate-100">
        <UserCheckIcon className="h-14 w-14" aria-hidden="true" />
      </div>
      <div className="ml-7 min-w-0 flex-1">
        <p className="text-3xl font-extrabold leading-tight text-slate-950">
          {guestMode ? '当前为匿名使用' : '欢迎来到求职服务终端'}
        </p>
        <p className="mt-2 text-lg font-semibold text-slate-500">
          {guestMode ? '本次服务记录仅在当前会话中保留' : '登录后可查看更多专属权益和历史服务记录'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {!guestMode && (
          <button
            type="button"
            onClick={continueAsGuest}
            className="h-16 rounded-2xl px-7 text-lg font-bold text-slate-500 transition-colors hover:bg-slate-50 active:bg-slate-100"
          >
            先使用
          </button>
        )}
        <button
          type="button"
          onClick={goLogin}
          className="flex h-16 min-w-[320px] items-center justify-center rounded-2xl bg-blue-600 px-9 text-2xl font-extrabold text-white shadow-[0_10px_24px_rgba(37,99,235,0.28)] transition-colors hover:bg-blue-700 active:bg-blue-800"
        >
          立即登录 / 注册
          <ChevronRightIcon className="ml-3 h-8 w-8" aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

interface ServiceTile {
  title: string
  icon: LucideIcon
  to?: string
  state?: Record<string, unknown>
  disabled?: boolean
}

interface ServiceGroup {
  title: string
  subtitle: string
  icon: LucideIcon
  accent: 'blue' | 'green' | 'orange' | 'cyan' | 'purple' | 'amber'
  tiles: ServiceTile[]
}

const ACCENT: Record<ServiceGroup['accent'], { text: string; border: string; iconBg: string }> = {
  blue: { text: 'text-blue-600', border: 'border-blue-200', iconBg: 'bg-blue-50' },
  green: { text: 'text-emerald-600', border: 'border-emerald-200', iconBg: 'bg-emerald-50' },
  orange: { text: 'text-orange-600', border: 'border-orange-200', iconBg: 'bg-orange-50' },
  cyan: { text: 'text-cyan-600', border: 'border-cyan-200', iconBg: 'bg-cyan-50' },
  purple: { text: 'text-violet-600', border: 'border-violet-200', iconBg: 'bg-violet-50' },
  // 政策服务功能色：金/amber（visual-design-spec §14.2/§15.4）。
  amber: { text: 'text-amber-700', border: 'border-amber-200', iconBg: 'bg-amber-50' },
}

const SERVICE_GROUPS: ServiceGroup[] = [
  {
    title: 'AI简历服务',
    subtitle: '智能打造，高薪之选',
    icon: BriefcaseBusinessIcon,
    accent: 'blue',
    tiles: [
      // intent 分流:同一上传链路,按入口语义展示不同标题/说明/引导(视觉与分组结构不变)
      { title: 'AI简历诊断', icon: FileSearchIcon, to: '/resume/source?intent=diagnose' },
      { title: 'AI简历优化', icon: SparklesIcon, to: '/resume/source?intent=optimize' },
      { title: '简历素材库', icon: BookOpenIcon, to: '/resume/templates' },
      { title: '职业规划', icon: CompassIcon, to: '/resume/career-plan' },
      { title: '简历打印', icon: PrinterIcon, to: '/print/upload?source=resume' },
      { title: '求职材料', icon: FileBadge2Icon, to: '/resume/materials' },
    ],
  },
  {
    title: '岗位信息',
    subtitle: '海量机会，精准匹配',
    icon: BriefcaseIcon,
    accent: 'green',
    tiles: [
      { title: '全职岗位', icon: Building2Icon, to: '/jobs?category=fulltime' },
      { title: '实习岗位', icon: GraduationCapIcon, to: '/jobs?category=intern' },
      { title: '兼职信息', icon: FileTextIcon, to: '/jobs?category=parttime' },
      { title: '全部岗位', icon: BriefcaseIcon, to: '/jobs' },
      { title: '岗位大师', icon: BrainCircuitIcon, disabled: true },
    ],
  },
  {
    title: '招聘会',
    subtitle: '校招社招，现场直达',
    icon: MapPinIcon,
    accent: 'orange',
    tiles: [
      { title: '社会招聘会', icon: MapPinIcon, to: '/job-fairs' },
      { title: '校园招聘会', icon: BookOpenIcon, to: '/campus' },
      { title: '扫码签到', icon: QrCodeIcon, disabled: true },
    ],
  },
  {
    title: '打印扫描',
    subtitle: '随时随地，极速出纸',
    icon: PrinterIcon,
    accent: 'cyan',
    tiles: [
      { title: '文档打印', icon: FileTextIcon, to: '/print/upload?source=document' },
      { title: '证件复印', icon: ClipboardCheckIcon, disabled: true },
      { title: '纸质扫描', icon: ScanLineIcon, to: '/scan/start' },
      { title: '云打印', icon: CloudUploadIcon, disabled: true },
      { title: '格式转换', icon: FileType2Icon, disabled: true },
      { title: '证件照打印', icon: ImageIcon, disabled: true },
    ],
  },
  {
    title: 'AI面试训练',
    subtitle: '模拟练习，仅供参考',
    icon: HeadphonesIcon,
    accent: 'purple',
    tiles: [
      { title: '模拟面试', icon: MonitorPlayIcon, to: '/interview/setup' },
      { title: '面试技巧', icon: LightbulbIcon, to: '/interview/tips' },
      { title: '面试报告', icon: FileSearchIcon, to: '/interview/reports' },
    ],
  },
  {
    // 合规:补贴类只做政策说明/材料清单/官方入口/申请指引(info-only),
    // 不出现"快申/申请"等暗示平台内办理的表述。
    title: '政策服务',
    subtitle: '权威解读，办事指引',
    icon: BookOpenIcon,
    accent: 'amber',
    tiles: [
      { title: '就业政策', icon: HelpCircleIcon, to: '/renshi?tab=policy' },
      { title: '补贴指引', icon: LandmarkIcon, to: '/renshi?tab=social' },
      { title: '档案/登记', icon: FileBadge2Icon, to: '/renshi?tab=register' },
    ],
  },
]

function ServiceTileButton({ tile, accent }: { tile: ServiceTile; accent: ServiceGroup['accent'] }) {
  const navigate = useNavigate()
  const Icon = tile.icon
  const colors = ACCENT[accent]
  const disabled = tile.disabled || !tile.to

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => tile.to && navigate(tile.to, tile.state ? { state: tile.state } : undefined)}
      className={[
        'group relative flex min-h-[130px] flex-col items-center justify-center gap-4 rounded-[22px] border border-slate-200 bg-slate-50/78 px-3 text-center shadow-[0_6px_14px_rgba(15,23,42,0.06)] transition-all',
        disabled
          ? 'cursor-not-allowed opacity-64'
          : 'hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_12px_24px_rgba(15,23,42,0.1)] active:translate-y-0',
      ].join(' ')}
    >
      <span className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${colors.border} bg-white`}>
        <Icon className={`h-7 w-7 ${colors.text}`} aria-hidden="true" />
      </span>
      <span className="text-xl font-extrabold leading-tight text-slate-950">{tile.title}</span>
      {disabled && (
        <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-400 shadow-sm">
          即将上线
        </span>
      )}
    </button>
  )
}

function ServiceGroupCard({ group }: { group: ServiceGroup }) {
  const navigate = useNavigate()
  const Icon = group.icon
  const colors = ACCENT[group.accent]
  const enabledFirst = group.tiles.find((tile) => tile.to && !tile.disabled)

  return (
    <section className="rounded-[34px] bg-white p-9 shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
      <button
        type="button"
        onClick={() => enabledFirst?.to && navigate(enabledFirst.to)}
        className="flex w-full items-center gap-6 text-left"
      >
        <span className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border ${colors.border} bg-white`}>
          <Icon className={`h-10 w-10 ${colors.text}`} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-3xl font-extrabold leading-tight tracking-normal text-slate-950 lg:text-4xl">{group.title}</span>
          <span className="mt-2 block text-xl font-bold leading-tight text-slate-500 lg:text-2xl">{group.subtitle}</span>
        </span>
      </button>

      <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3">
        {group.tiles.map((tile) => (
          <ServiceTileButton key={tile.title} tile={tile} accent={group.accent} />
        ))}
      </div>
    </section>
  )
}

// 校园大数据（bigdata）本期严格冻结：不在此列出入口卡，后端开关亦强制 false。
const SMART_CAMPUS_TILES: Partial<Record<SmartCampusModuleKey, ServiceTile & { desc: string; color: string; bg: string }>> = {
  welcome: {
    title: '迎新服务',
    desc: '报到流程、办事窗口、入学材料打印',
    icon: PartyPopperIcon,
    to: '/smart-campus/welcome',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  luggage: {
    title: '行李帮运',
    desc: '校方合作服务入口、服务点与路线说明',
    icon: PackageIcon,
    to: '/smart-campus/service/luggage',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  panorama: {
    title: 'VR校园',
    desc: '校园全景、路线导览、重点场馆介绍',
    icon: ScanFaceIcon,
    to: '/smart-campus/service/panorama',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
  },
}

function SmartCampusHorizontalSection() {
  const navigate = useNavigate()
  const config = useSmartCampusConfig()
  const [qrItem, setQrItem] = useState<KioskToolboxItem | null>(null)
  const enabledTiles = (Object.keys(SMART_CAMPUS_TILES) as SmartCampusModuleKey[])
    .filter((key) => config.modules[key])
    .map((key) => SMART_CAMPUS_TILES[key])
    .filter((tile): tile is ServiceTile & { desc: string; color: string; bg: string } => !!tile)
  const campusItems = [...(config.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  if (!config.enabled || (enabledTiles.length === 0 && campusItems.length === 0)) return null

  return (
    <>
      <section className="mx-auto mt-8 w-[min(1320px,calc(100%-64px))] overflow-hidden rounded-[34px] border border-blue-200 bg-white shadow-[0_14px_34px_rgba(37,99,235,0.12)]">
        <div className="flex items-center gap-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 px-8 py-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_10px_20px_rgba(37,99,235,0.24)]">
            <GraduationCapIcon className="h-8 w-8" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-extrabold leading-tight text-slate-950">智慧校园</h2>
              <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-600">
                学校端已开启
              </span>
            </div>
            <p className="mt-1 text-base font-semibold text-slate-500">
              学校专属服务专区，仅校园终端开启时显示；关闭后整块消失，不占首页空白。
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/smart-campus')}
            className="hidden min-h-[52px] shrink-0 items-center gap-1 rounded-2xl bg-white px-5 text-base font-extrabold text-blue-600 shadow-sm transition-colors hover:bg-blue-50 active:bg-blue-100 sm:flex"
          >
            进入专区
            <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
          {enabledTiles.map((tile) => {
            const Icon = tile.icon
            const disabled = tile.disabled || !tile.to
            return (
              <button
                key={tile.title}
                type="button"
                disabled={disabled}
                onClick={() => tile.to && !disabled && navigate(tile.to)}
                className={[
                  'relative min-h-[128px] overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50/70 p-5 text-left transition-all',
                  disabled
                    ? 'cursor-not-allowed opacity-70'
                    : 'hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white hover:shadow-[0_12px_26px_rgba(37,99,235,0.12)] active:translate-y-0',
                ].join(' ')}
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tile.bg}`}>
                  <Icon className={`h-6 w-6 ${tile.color}`} aria-hidden="true" />
                </span>
                <span className="mt-4 block text-xl font-extrabold text-slate-950">{tile.title}</span>
                <span className="mt-1 block text-sm font-semibold leading-relaxed text-slate-500">{tile.desc}</span>
                {disabled && (
                  <span className="absolute right-4 top-4 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-400 shadow-sm">
                    即将上线
                  </span>
                )}
              </button>
            )
          })}
          {campusItems.map((item) => (
            <ToolboxItemButton key={item.key} item={item} onQr={setQrItem} accent="blue" />
          ))}
        </div>
      </section>
      <QrLaunchModal item={qrItem} onClose={() => setQrItem(null)} />
    </>
  )
}

const TOOLBOX_ICONS: Record<string, LucideIcon> = {
  wrench: WrenchIcon,
  'file-text': FileTextIcon,
  printer: PrinterIcon,
  sparkles: SparklesIcon,
  'book-open': BookOpenIcon,
  'help-circle': HelpCircleIcon,
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

function launchKioskAppItem(item: KioskToolboxItem, navigate: ReturnType<typeof useNavigate>, onQr: (item: KioskToolboxItem) => void) {
  const launchMode = item.launchMode ?? 'internal_route'
  if (launchMode === 'internal_route' && item.to) {
    navigate(item.to)
    return
  }
  if (launchMode === 'external_url' && item.externalUrl) {
    window.location.assign(item.externalUrl)
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

function QrLaunchModal({ item, onClose }: { item: KioskToolboxItem | null; onClose: () => void }) {
  if (!item) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-6 backdrop-blur-sm">
      <div className="w-[min(420px,100%)] rounded-[28px] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.3)]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-2xl font-extrabold text-slate-950">{item.title}</p>
            <p className="mt-1 text-sm font-semibold text-slate-500">{item.description || '请扫码继续办理'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 hover:bg-slate-200"
            aria-label="关闭"
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-6 flex justify-center rounded-[24px] bg-slate-50 p-5">
          <img src={item.qrImageUrl ?? ''} alt={`${item.title}二维码`} className="h-64 w-64 rounded-2xl object-contain" />
        </div>
      </div>
    </div>
  )
}

function ToolboxItemButton({
  item,
  onQr,
  accent = 'slate',
}: {
  item: KioskToolboxItem
  onQr: (item: KioskToolboxItem) => void
  accent?: 'slate' | 'blue'
}) {
  const navigate = useNavigate()
  const Icon = TOOLBOX_ICONS[item.icon] ?? WrenchIcon
  const disabled = item.disabled || !itemLaunchable(item)
  const badge = itemBadge(item)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && launchKioskAppItem(item, navigate, onQr)}
      className={[
        'relative min-h-[128px] rounded-[24px] border border-slate-200 bg-slate-50/72 p-5 text-left transition-all',
        disabled
          ? 'cursor-not-allowed opacity-70'
          : accent === 'blue'
            ? 'hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white hover:shadow-[0_12px_26px_rgba(37,99,235,0.12)] active:translate-y-0'
            : 'hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_12px_26px_rgba(15,23,42,0.1)] active:translate-y-0',
      ].join(' ')}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="mt-4 block text-xl font-extrabold text-slate-950">{item.title}</span>
      <span className="mt-1 block text-sm font-semibold leading-relaxed text-slate-500">{item.description}</span>
      {badge && (
        <span className="absolute right-4 top-4 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-400 shadow-sm">
          {badge}
        </span>
      )}
    </button>
  )
}

function ToolboxSection() {
  const config = useToolboxConfig()
  const [qrItem, setQrItem] = useState<KioskToolboxItem | null>(null)
  const items = config.enabled ? [...config.items].sort((a, b) => a.sortOrder - b.sortOrder) : []

  if (!config.enabled) return null

  return (
    <>
      <section className="mx-auto mt-8 w-[min(1320px,calc(100%-64px))] overflow-hidden rounded-[34px] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
        <div className="flex items-center gap-4 border-b border-slate-100 px-8 py-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]">
            <PackageIcon className="h-8 w-8" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-extrabold leading-tight text-slate-950">百宝箱</h2>
            <p className="mt-1 text-base font-semibold text-slate-500">按当前设备配置展示扩展服务。</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
          {items.length > 0 ? (
            items.map((item) => (
              <ToolboxItemButton key={item.key} item={item} onQr={setQrItem} />
            ))
          ) : (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/72 p-6">
              <span className="block text-xl font-extrabold text-slate-950">待配置</span>
              <span className="mt-2 block text-sm font-semibold leading-relaxed text-slate-500">
                后续功能上线后将在这里展示。
              </span>
            </div>
          )}
        </div>
      </section>
      <QrLaunchModal item={qrItem} onClose={() => setQrItem(null)} />
    </>
  )
}

export function HomePage() {
  return (
    <div className="min-h-full bg-[#eef1f5] pb-8">
      <KioskTopBar />
      <HeroSection />
      <IdentityPanel />

      <main className="mx-auto mt-10 grid w-[min(1320px,calc(100%-64px))] grid-cols-1 gap-8 pb-6 xl:grid-cols-2">
        {SERVICE_GROUPS.map((group) => (
          <ServiceGroupCard key={group.title} group={group} />
        ))}
      </main>

      <ToolboxSection />
      <SmartCampusHorizontalSection />

      <div className="mx-auto mt-2 flex w-[min(1320px,calc(100%-64px))] items-center justify-center gap-2 rounded-2xl bg-white/62 px-5 py-3 text-sm font-medium text-slate-500">
        <BotIcon className="h-4 w-4" aria-hidden="true" />
        岗位和招聘会仅作为第三方/官方来源信息入口，投递与预约请前往来源平台完成。
      </div>
    </div>
  )
}
