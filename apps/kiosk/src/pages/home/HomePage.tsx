import { Button } from '@ai-job-print/ui'
import {
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  ClockIcon,
  FileSearchIcon,
  FileTextIcon,
  FileType2Icon,
  GraduationCapIcon,
  ImageIcon,
  LandmarkIcon,
  LayoutTemplateIcon,
  LogInIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessagesSquareIcon,
  PenToolIcon,
  PrinterIcon,
  ScanLineIcon,
  SchoolIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserRoundIcon,
  UserSquareIcon,
  WifiIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { getMyAiRecords, getMyDocuments, getMyResumes } from '../../services/api/memberAssets'
import { getMyFavorites } from '../../services/api/memberFavorites'

// 首页定稿规范见 docs/design/visual-design-spec.md §15（锁定版）。
// 重要：首页子功能瓦片只镜像各模块服务中心「真实存在」的功能，不臆造；
// 「即将上线」沿用各中心页的占位态。岗位/招聘会/政策走第三方/官方来源，无任何招聘闭环语义。

const card = 'rounded-2xl border border-neutral-200 bg-white shadow-sm'

// ── 顶栏实时时钟（§15.2）─────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  const date = `${week} ${pad(now.getMonth() + 1)}/${pad(now.getDate())}`
  return { time, date }
}

// ── 机器头顶状态栏（左：一体机名；右：设备状态 + 实时时间）────────
function KioskTopBar() {
  const { time, date } = useClock()
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-200 bg-surface px-6 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
        <PrinterIcon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-base font-bold leading-tight text-gray-900">AI求职打印服务终端</p>

      <div className="ml-auto flex items-center gap-4">
        {/* 设备状态：中性提示，真实可用性以打印前检测为准（§15.2，不写死"正常"）。 */}
        <div className="hidden items-center gap-3 sm:flex" title="设备状态以打印前检测为准">
          {[
            { icon: PrinterIcon, label: '打印机' },
            { icon: WifiIcon, label: '网络' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" aria-hidden="true" />
              <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
        <div className="flex flex-col items-end border-l border-neutral-200 pl-4 leading-none">
          <span className="text-lg font-bold tabular-nums text-gray-900">{time}</span>
          <span className="mt-0.5 text-xs text-gray-400">{date}</span>
        </div>
      </div>
    </header>
  )
}

// ── 登录后数据概览：只接后端允许字段的真实计数（§15.3）────────────
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
    // 仅本人 token 拉真实计数；mock 模式各接口返回 []，即显示 0，不伪造数字。
    Promise.all([getMyResumes(token), getMyDocuments(token), getMyAiRecords(token), getMyFavorites(token)])
      .then(([resumes, documents, aiRecords, favorites]) => {
        if (alive) {
          setStats({
            resumes: resumes.length,
            documents: documents.length,
            aiRecords: aiRecords.length,
            favorites: favorites.length,
          })
        }
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

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-2 text-center">
      <p className="text-2xl font-bold leading-none tabular-nums text-gray-900">{value}</p>
      <p className="mt-1.5 text-xs text-gray-500">{label}</p>
    </div>
  )
}

// ── 身份区（三态：已登录 / 匿名 / 未登录，§15.3）────────────────
function IdentitySection() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, guestMode, displayName, continueAsGuest, logout, getToken } = useAuth()
  const { stats, loading } = useHomeStats(isLoggedIn, getToken)
  const goLogin = () => navigate('/login', { state: { from: location.pathname } })

  if (isLoggedIn) {
    const cells: { key: keyof HomeStats; label: string }[] = [
      { key: 'resumes', label: '简历' },
      { key: 'documents', label: '文档' },
      { key: 'aiRecords', label: 'AI记录' },
      { key: 'favorites', label: '收藏' },
    ]
    const initial = displayName.replace(/\s/g, '').slice(0, 1) || '我'
    return (
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xl font-bold text-primary-600">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-gray-900">{displayName}</p>
            <p className="mt-0.5 text-sm text-gray-500">可查看我的简历、文档、收藏与 AI 记录</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button size="lg" variant="secondary" onClick={() => logout()} className="h-12 px-5 text-base">
              退出登录
            </Button>
            <Button size="lg" onClick={() => navigate('/profile')} className="h-12 px-5 text-base">
              进入我的
              <ChevronRightIcon className="ml-0.5 h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {/* 数据概览：真实计数；加载中显示 —，为 0 显示 0，绝不占位假数 */}
        <div className="mt-4 grid grid-cols-4 divide-x divide-neutral-100 border-t border-neutral-100 pt-4">
          {cells.map(({ key, label }) => (
            <StatCell key={key} value={loading || !stats ? '—' : String(stats[key])} label={label} />
          ))}
        </div>
      </div>
    )
  }

  if (guestMode) {
    return (
      <div className={`flex items-center gap-4 ${card} px-5 py-4`}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100">
          <UserRoundIcon className="h-6 w-6 text-gray-500" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-900">当前为匿名使用</p>
          <p className="mt-0.5 text-sm text-gray-500">当前记录仅用于本次服务，登录后可保存记录</p>
        </div>
        <Button size="lg" onClick={goLogin} className="h-14 shrink-0 px-5 text-base">
          <LogInIcon className="mr-1 h-5 w-5" aria-hidden="true" />
          手机号登录
        </Button>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-4 ${card} px-5 py-4 sm:flex-row sm:items-center`}>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50">
          <UserRoundIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-900">登录后可查看历史简历与服务记录</p>
          <p className="mt-0.5 text-sm text-gray-500">手机号验证码登录，仅本次会话有效，离开自动退出</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={continueAsGuest}
          className="h-14 rounded-xl px-5 text-base font-medium text-gray-500 transition-colors hover:bg-gray-50 active:bg-gray-100"
        >
          先使用
        </button>
        <Button size="lg" onClick={goLogin} className="h-14 px-6 text-base">
          <LogInIcon className="mr-1 h-5 w-5" aria-hidden="true" />
          手机号登录
        </Button>
      </div>
    </div>
  )
}

// ── 两级模块：子功能镜像各模块服务中心的真实功能（§15.4）─────────
interface Tile {
  label: string
  icon: LucideIcon
  /** 真实可达路由；缺省表示该子功能尚未上线（不可点） */
  to?: string
  state?: Record<string, unknown>
  /** 即将上线标记（中心页同样标注） */
  soon?: boolean
}
interface ModuleColor {
  bg: string
  fg: string
  hover: string
}
interface ModuleDef {
  title: string
  icon: LucideIcon
  route: string
  color: ModuleColor
  tiles: Tile[]
}

// 子功能严格对照各服务中心页（ResumeHomePage / PrintScanHomePage / JobsPage / RenshiPage）。
const MODULES: ModuleDef[] = [
  {
    // 对照 ResumeHomePage.ENTRIES
    title: 'AI简历服务',
    icon: FileTextIcon,
    route: '/resume',
    color: { bg: 'bg-blue-50', fg: 'text-blue-600', hover: 'hover:border-blue-300' },
    tiles: [
      { label: 'AI简历诊断', icon: FileSearchIcon, to: '/resume/source' },
      { label: 'AI简历优化', icon: SparklesIcon, to: '/resume/source' },
      { label: '简历素材库', icon: LayoutTemplateIcon, to: '/resume/templates' },
      { label: '面试准备', icon: MessagesSquareIcon, soon: true },
    ],
  },
  {
    // 对照 PrintScanHomePage.CAPABILITIES
    title: '打印扫描',
    icon: PrinterIcon,
    route: '/print-scan',
    color: { bg: 'bg-cyan-50', fg: 'text-cyan-600', hover: 'hover:border-cyan-300' },
    tiles: [
      { label: '文档打印', icon: FileTextIcon, to: '/print/upload' },
      { label: '材料扫描', icon: ScanLineIcon, to: '/scan/start' },
      { label: '照片打印', icon: ImageIcon, to: '/print/upload', state: { category: 'photo' } },
      { label: '证件照', icon: UserSquareIcon, to: '/print-scan/feature/id-photo', soon: true },
      { label: '格式转换', icon: FileType2Icon, to: '/print-scan/feature/convert', soon: true },
      { label: '签名盖章', icon: PenToolIcon, to: '/print-scan/feature/sign', soon: true },
    ],
  },
  {
    // 对照 JobsPage.TYPE_OPTIONS（岗位分类筛选；深链 /jobs?category=）
    title: '岗位信息',
    icon: BriefcaseIcon,
    route: '/jobs',
    color: { bg: 'bg-green-50', fg: 'text-green-600', hover: 'hover:border-green-300' },
    tiles: [
      { label: '全职岗位', icon: Building2Icon, to: '/jobs?category=fulltime' },
      { label: '实习岗位', icon: GraduationCapIcon, to: '/jobs?category=intern' },
      { label: '校招岗位', icon: SchoolIcon, to: '/jobs?category=campus' },
      { label: '兼职信息', icon: ClockIcon, to: '/jobs?category=parttime' },
    ],
  },
  {
    // 对照 RenshiPage 四个 Tab（深链 /renshi?tab=）
    title: '政策服务',
    icon: LandmarkIcon,
    route: '/renshi',
    color: { bg: 'bg-amber-50', fg: 'text-amber-600', hover: 'hover:border-amber-300' },
    tiles: [
      { label: '就业政策', icon: LandmarkIcon, to: '/renshi?tab=policy' },
      { label: '社保指南', icon: ShieldCheckIcon, to: '/renshi?tab=social' },
      { label: '就业登记', icon: ClipboardCheckIcon, to: '/renshi?tab=register' },
      { label: '政策公告', icon: MegaphoneIcon, to: '/renshi?tab=notice' },
    ],
  },
]

function TileButton({ tile, color }: { tile: Tile; color: ModuleColor }) {
  const navigate = useNavigate()
  const Icon = tile.icon
  const disabled = !tile.to
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => tile.to && navigate(tile.to, tile.state ? { state: tile.state } : undefined)}
      className={[
        'flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-center shadow-sm transition-all duration-150',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : `${color.hover} hover:-translate-y-0.5 active:translate-y-0 active:bg-neutral-50`,
      ].join(' ')}
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${color.bg}`}>
        <Icon className={`h-6 w-6 ${color.fg}`} aria-hidden="true" />
      </span>
      <span className="text-sm font-medium leading-tight text-gray-700">{tile.label}</span>
      {tile.soon && (
        <span className="rounded-full bg-gray-100 px-1.5 text-[10px] font-medium text-gray-400">即将上线</span>
      )}
    </button>
  )
}

function ModuleCard({ module }: { module: ModuleDef }) {
  const navigate = useNavigate()
  const { title, icon: Icon, route, color, tiles } = module
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <button type="button" onClick={() => navigate(route)} className="flex w-full items-center gap-3 text-left">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${color.bg}`}>
          <Icon className={`h-6 w-6 ${color.fg}`} aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <span className="ml-auto flex items-center gap-0.5 text-sm font-medium text-gray-400">
          全部
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>

      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <TileButton key={tile.label} tile={tile} color={color} />
        ))}
      </div>
    </section>
  )
}

// ── 单行入口（招聘会 / 校园 / 青岛，§15.5）──────────────────────
interface EntryBarProps {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

function EntryBar({ icon: Icon, iconBg, iconColor, title, description, actionLabel, onAction }: EntryBarProps) {
  return (
    <button
      type="button"
      onClick={onAction}
      className={`flex w-full items-center justify-between ${card} px-5 py-4 text-left transition-colors hover:bg-gray-50 active:bg-gray-100`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-6 w-6 ${iconColor}`} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 truncate text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 pl-3 text-base font-semibold text-primary-600">
        <span>{actionLabel}</span>
        <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
      </div>
    </button>
  )
}

// ── HomePage ──────────────────────────────────────────────────
export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <KioskTopBar />

      <div className="flex flex-1 flex-col gap-6 px-6 py-5">
        {/* 身份区（三态） */}
        <IdentitySection />

        {/* 有真实子功能的核心模块（两级） */}
        {MODULES.map((m) => (
          <ModuleCard key={m.title} module={m} />
        ))}

        {/* 招聘会信息：列表 + 状态筛选，无独立子功能 → 单行入口（不臆造子功能，§15.5） */}
        <EntryBar
          icon={CalendarIcon}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          title="招聘会信息"
          description="现场招聘会信息、状态与现场导览"
          actionLabel="查看招聘会"
          onAction={() => navigate('/job-fairs')}
        />

        {/* 附加专区（保留既有入口） */}
        <EntryBar
          icon={GraduationCapIcon}
          iconBg="bg-cyan-50"
          iconColor="text-cyan-700"
          title="校园招聘专区"
          description="应届校招岗位 · 校园双选会 · 简历与材料"
          actionLabel="进入专区"
          onAction={() => navigate('/campus')}
        />
        <EntryBar
          icon={MapPinIcon}
          iconBg="bg-teal-50"
          iconColor="text-teal-600"
          title="AI 在青岛"
          description="青岛就业、政策、高校、园区、城市资讯"
          actionLabel="进入专区"
          onAction={() => navigate('/qingdao')}
        />

        {/* AI 助手入口（底部导航之外，首页保留引导） */}
        <button
          type="button"
          onClick={() => navigate('/assistant')}
          className={`flex min-h-[56px] w-full items-center gap-3 ${card} px-5 py-3 text-left transition-colors hover:border-primary-200 hover:bg-primary-50 active:bg-primary-100`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <BotIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800">不知道怎么操作？</p>
            <p className="text-xs text-gray-500">问问 AI 助手，快速找到你需要的服务</p>
          </div>
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        </button>

        <div className="h-1" />
      </div>
    </div>
  )
}
