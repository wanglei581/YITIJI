import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import {
  BellIcon,
  BotIcon,
  BoxIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  CircleUserRoundIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileInputIcon,
  FilesIcon,
  FileTextIcon,
  GiftIcon,
  HeartIcon,
  HelpCircleIcon,
  LandmarkIcon,
  LayoutTemplateIcon,
  LogInIcon,
  MessageSquareIcon,
  PackageIcon,
  PrinterIcon,
  QrCodeIcon,
  RepeatIcon,
  ScanLineIcon,
  SettingsIcon,
  SparklesIcon,
  TicketIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'

// 「我的」个人资产入口页（参考 miaoda 个人中心：顶部个人信息区 + 白色分区卡片 + 彩色浅底图标）。
// 诚实化与合规约束：
// - 只承诺本次会话记录，不宣称跨会话留存 / 多终端同步等尚未实现的能力；账号资产中心建设中。
// - 不展示假数量；未实现入口用「建设中」标签，会话相关入口用「本次记录」标签。
// - 岗位 / 招聘会只作第三方来源信息入口与跳转/浏览记录，不引入任何招聘闭环语义。
// - 只改本文件，不新增后端 API，不做活动 / 套餐 / 支付真实逻辑。
// 底部 Tab（首页 / AI助手 / 我的）由 KioskLayout 提供，本页不改动。

// 卡片统一表面：圆角 / 1px 边框 / 白底 / 轻阴影（对齐共享设计系统）。
const cardSurface = 'rounded-2xl border border-neutral-200 bg-white shadow-sm'

// ─── 入口数据模型 ──────────────────────────────────────────────────────────

type EntryTag = '建设中' | '本次记录'

interface Entry {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  /** 可跳转的既有功能页；缺省则按 tag 走「建设中 / 本次记录」提示 */
  route?: string
  tag?: EntryTag
}

interface EntrySectionData {
  title: string
  entries: Entry[]
}

// 1. 我的资产
const ASSETS: Entry[] = [
  { icon: FileTextIcon, iconBg: 'bg-primary-50', iconColor: 'text-primary-600', label: '我的简历', route: '/resume' },
  { icon: FilesIcon,    iconBg: 'bg-blue-50',    iconColor: 'text-blue-600',    label: '我的文档', tag: '本次记录' },
  { icon: SparklesIcon, iconBg: 'bg-violet-50',  iconColor: 'text-violet-600',  label: 'AI服务记录', tag: '本次记录' },
  { icon: PrinterIcon,  iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',   label: '打印订单', tag: '本次记录' },
  { icon: HeartIcon,    iconBg: 'bg-rose-50',    iconColor: 'text-rose-600',    label: '我的收藏', tag: '建设中' },
  { icon: TicketIcon,   iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '我的权益', tag: '建设中' },
]

// 2. 常用服务（均跳转既有功能页）
const SERVICES: Entry[] = [
  { icon: SparklesIcon,        iconBg: 'bg-primary-50', iconColor: 'text-primary-600', label: 'AI简历服务', route: '/resume' },
  { icon: LayoutTemplateIcon,  iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600',  label: '简历模板',   route: '/resume/templates' },
  { icon: PrinterIcon,         iconBg: 'bg-blue-50',    iconColor: 'text-blue-600',    label: '文档打印',   route: '/print/upload' },
  { icon: CopyIcon,            iconBg: 'bg-gray-100',   iconColor: 'text-gray-700',    label: '打印扫描',   route: '/print-scan' },
  { icon: ScanLineIcon,        iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600',    label: '扫描文件',   route: '/scan/start' },
  { icon: BriefcaseIcon,       iconBg: 'bg-sky-50',     iconColor: 'text-sky-600',     label: '岗位信息',   route: '/jobs' },
  { icon: CalendarIcon,        iconBg: 'bg-green-50',   iconColor: 'text-green-600',   label: '招聘会',     route: '/job-fairs' },
  { icon: BotIcon,             iconBg: 'bg-violet-50',  iconColor: 'text-violet-600',  label: 'AI助手',     route: '/assistant' },
]

// 3. 招聘会与活动（外部来源信息入口 / 记录，均建设中）
const FAIRS: Entry[] = [
  { icon: EyeIcon,          iconBg: 'bg-sky-50',     iconColor: 'text-sky-600',     label: '招聘会浏览记录',     tag: '建设中' },
  { icon: ExternalLinkIcon, iconBg: 'bg-teal-50',    iconColor: 'text-teal-600',    label: '招聘会预约跳转记录', tag: '建设中' },
  { icon: QrCodeIcon,       iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600',  label: '招聘会扫码凭证',     tag: '建设中' },
  { icon: GiftIcon,         iconBg: 'bg-rose-50',    iconColor: 'text-rose-600',    label: '权益活动',           tag: '建设中' },
]

// 4. 权益活动与服务套餐（均建设中，不接支付）
const BENEFITS: Entry[] = [
  { icon: TicketIcon,   iconBg: 'bg-rose-50',    iconColor: 'text-rose-600',    label: '权益活动',     tag: '建设中' },
  { icon: PackageIcon,  iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',   label: '求职打印套餐', tag: '建设中' },
  { icon: BoxIcon,      iconBg: 'bg-violet-50',  iconColor: 'text-violet-600',  label: 'AI服务套餐',   tag: '建设中' },
  { icon: LandmarkIcon, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '政策补贴指引', tag: '建设中' },
]

// 5. 账户与服务（均建设中）
const ACCOUNT: Entry[] = [
  { icon: BellIcon,          iconBg: 'bg-blue-50',   iconColor: 'text-blue-600',   label: '消息通知', tag: '建设中' },
  { icon: SettingsIcon,      iconBg: 'bg-gray-100',  iconColor: 'text-gray-600',   label: '账号设置', tag: '建设中' },
  { icon: RepeatIcon,        iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600', label: '身份切换', tag: '建设中' },
  { icon: HelpCircleIcon,    iconBg: 'bg-cyan-50',   iconColor: 'text-cyan-600',   label: '帮助中心', tag: '建设中' },
  { icon: MessageSquareIcon, iconBg: 'bg-amber-50',  iconColor: 'text-amber-600',  label: '意见反馈', tag: '建设中' },
]

const SECTIONS: EntrySectionData[] = [
  { title: '我的资产', entries: ASSETS },
  { title: '常用服务', entries: SERVICES },
  { title: '招聘会与活动', entries: FAIRS },
  { title: '权益活动与服务套餐', entries: BENEFITS },
  { title: '账户与服务', entries: ACCOUNT },
]

// ─── 本次会话记录数据类型（仅来自 location.state，不伪造）────────────────────

interface ResumeItem { id: string; name: string; size: string; format: string; savedAt: string }
interface ScanItem   { id: string; name: string; size: string; pages: number; format: string; savedAt: string }
interface AIRecord   { id: string; label: string; detail: string; fileName: string; createdAt: string }

interface IncomingState {
  savedFile?: { name: string; size: string; pages: number; format: string }
  savedAt?: string
  savedResume?: { name: string; size: string; format: string }
  savedResumeAdvice?: {
    file?: { name: string; size: string; format: string }
    suggestions: unknown[]
    savedAt: string
  }
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const M = d.getMonth() + 1
  const D = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${M}月${D}日 ${h}:${m}`
}

// ─── Presentational sub-components ─────────────────────────────────────────

function ProfileHeader({
  isLoggedIn,
  displayName,
  onLogin,
  onLogout,
}: {
  isLoggedIn: boolean
  displayName: string
  onLogin: () => void
  onLogout: () => void
}) {
  return (
    <div className={`flex items-center gap-4 ${cardSurface} px-6 py-5`}>
      <div
        className={[
          'flex h-16 w-16 shrink-0 items-center justify-center rounded-full',
          isLoggedIn ? 'bg-primary-50' : 'bg-gray-100',
        ].join(' ')}
      >
        {isLoggedIn ? (
          <CircleUserRoundIcon className="h-8 w-8 text-primary-600" aria-hidden="true" />
        ) : (
          <UserRoundIcon className="h-8 w-8 text-gray-400" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isLoggedIn ? (
          <>
            <div className="flex items-center gap-2">
              <p className="truncate text-xl font-bold text-gray-900">{displayName}</p>
              <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
                会员
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">当前展示本次服务记录，账号资产中心建设中</p>
            <p className="mt-0.5 text-xs text-gray-400">长时间无操作将自动退出，保护个人资料</p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold text-gray-900">游客</p>
            <p className="mt-1 text-sm text-gray-500">登录后用于绑定本人服务记录，仅本次会话有效</p>
          </>
        )}
      </div>

      {isLoggedIn ? (
        <Button size="lg" variant="secondary" onClick={onLogout} className="h-14 shrink-0 px-5 text-base">
          退出登录
        </Button>
      ) : (
        <Button size="lg" onClick={onLogin} className="flex h-14 shrink-0 items-center gap-1 px-5 text-base">
          <LogInIcon className="h-5 w-5" aria-hidden="true" />
          手机号登录
        </Button>
      )}
    </div>
  )
}

// 入口格子：触控区 ≥72px（实际 min-h-[92px] + 内边距），彩色浅底图标 + 标签。无卡片套卡片。
function EntryCell({ entry, onTap }: { entry: Entry; onTap: (e: Entry) => void }) {
  const { icon: Icon, iconBg, iconColor, label, tag } = entry
  return (
    <button
      type="button"
      onClick={() => onTap(entry)}
      className="flex min-h-[92px] flex-col items-center justify-start gap-2 rounded-xl px-1.5 py-3 text-center transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <span className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', iconBg].join(' ')}>
        <Icon className={['h-6 w-6', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <span className="text-xs font-medium leading-tight text-gray-700">{label}</span>
      {tag && (
        <span
          className={[
            'rounded-full px-1.5 py-px text-[10px] font-medium',
            tag === '建设中' ? 'bg-gray-100 text-gray-400' : 'bg-primary-50 text-primary-600',
          ].join(' ')}
        >
          {tag}
        </span>
      )}
    </button>
  )
}

function EntrySection({ section, onTap }: { section: EntrySectionData; onTap: (e: Entry) => void }) {
  return (
    <section aria-label={section.title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-gray-500">{section.title}</h2>
      <div className={`${cardSurface} p-3 sm:p-4`}>
        <div className="grid grid-cols-3 gap-1 sm:gap-2 md:grid-cols-4 lg:grid-cols-5">
          {section.entries.map((e) => (
            <EntryCell key={e.label} entry={e} onTap={onTap} />
          ))}
        </div>
      </div>
    </section>
  )
}

// 列表项操作按钮：触控区 ≥48px（h-12 w-12）。
function RowIconButton({
  icon: Icon,
  title,
  tone = 'neutral',
  onClick,
}: {
  icon: LucideIcon
  title: string
  tone?: 'neutral' | 'danger'
  onClick: () => void
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-gray-400 hover:bg-red-50 hover:text-red-500'
      : 'text-gray-500 hover:bg-gray-50'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gray-200 ${toneCls}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}

function SessionRow({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  meta,
  onPrint,
  onDelete,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  name: string
  meta: string
  onPrint?: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconBg].join(' ')}>
        <Icon className={['h-5 w-5', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{name}</p>
        <p className="truncate text-xs text-gray-400">{meta}</p>
      </div>
      {onPrint && <RowIconButton icon={PrinterIcon} title="打印" onClick={onPrint} />}
      <RowIconButton icon={Trash2Icon} title="删除" tone="danger" onClick={onDelete} />
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────

export function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, displayName, logout } = useAuth()
  const incoming = (location.state ?? {}) as IncomingState

  // ── 本次会话记录（仅来自 location.state，不伪造数量）──────────────
  const [resumes, setResumes] = useState<ResumeItem[]>(() =>
    incoming.savedResume
      ? [{ id: `r-${Date.now()}`, ...incoming.savedResume, savedAt: incoming.savedAt ?? new Date().toISOString() }]
      : [],
  )
  const [scans, setScans] = useState<ScanItem[]>(() =>
    incoming.savedFile
      ? [{ id: `s-${Date.now()}`, ...incoming.savedFile, savedAt: incoming.savedAt ?? new Date().toISOString() }]
      : [],
  )
  const [aiRecords, setAiRecords] = useState<AIRecord[]>(() =>
    incoming.savedResumeAdvice
      ? [{
          id: `a-${Date.now()}`,
          label: '优化建议',
          detail: `${incoming.savedResumeAdvice.suggestions.length} 条建议`,
          fileName: incoming.savedResumeAdvice.file?.name ?? '简历',
          createdAt: incoming.savedResumeAdvice.savedAt,
        }]
      : [],
  )

  const hasSessionRecords = resumes.length + scans.length + aiRecords.length > 0

  // ── Toast ────────────────────────────────────────────────────
  // 诚实化：资产中心未完成前不承诺留存，只提示「已加入本次记录」。
  const [toastMsg, setToastMsg] = useState<string | null>(() => {
    if (incoming.savedResume) return '简历已加入本次记录'
    if (incoming.savedFile) return '扫描文件已加入本次记录'
    if (incoming.savedResumeAdvice) return '优化建议已加入本次记录'
    return null
  })

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(t)
  }, [toastMsg])

  // ── Handlers ─────────────────────────────────────────────────
  const goLogin = () => navigate('/login', { state: { from: location.pathname } })

  const printFile = (file: { name: string; size: string; pages?: number }) => {
    navigate('/print/preview', {
      state: { file: { name: file.name, size: file.size, pages: file.pages ?? 1 } },
    })
  }

  const handleEntryTap = (entry: Entry) => {
    if (entry.route) {
      navigate(entry.route)
      return
    }
    if (entry.tag === '本次记录') {
      setToastMsg(hasSessionRecords ? '本次会话记录见下方' : '本次会话暂无记录，完成服务后在此查看')
      return
    }
    setToastMsg('该功能建设中，敬请期待')
  }

  return (
    <div className="relative flex min-h-full flex-col gap-6 p-6 pb-24">
      {/* ── 顶部个人信息区 ── */}
      <ProfileHeader
        isLoggedIn={isLoggedIn}
        displayName={displayName}
        onLogin={goLogin}
        onLogout={logout}
      />

      {/* 提示 toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
          {toastMsg}
          <button
            onClick={() => setToastMsg(null)}
            aria-label="关闭提示"
            className="ml-1 rounded-full p-0.5 hover:bg-green-500"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── 分区入口（九宫格）── */}
      {SECTIONS.map((section) => (
        <EntrySection key={section.title} section={section} onTap={handleEntryTap} />
      ))}

      {/* ── 本次服务记录（仅当本次会话产生了记录时显示，避免空态占位）── */}
      {hasSessionRecords && (
        <section aria-label="本次服务记录" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-gray-500">本次服务记录</h2>
            <span className="text-xs text-gray-400">仅本次会话</span>
          </div>
          <div className={`${cardSurface} divide-y divide-gray-100 px-4`}>
            {resumes.map((r) => (
              <SessionRow
                key={r.id}
                icon={FileTextIcon}
                iconBg="bg-primary-50"
                iconColor="text-primary-600"
                name={r.name}
                meta={`简历 · ${r.size} · ${r.format} · ${formatTime(r.savedAt)}`}
                onPrint={() => printFile(r)}
                onDelete={() => setResumes((prev) => prev.filter((x) => x.id !== r.id))}
              />
            ))}
            {scans.map((s) => (
              <SessionRow
                key={s.id}
                icon={FileInputIcon}
                iconBg="bg-cyan-50"
                iconColor="text-cyan-600"
                name={s.name}
                meta={`扫描 · ${s.pages} 页 · ${s.size} · ${formatTime(s.savedAt)}`}
                onPrint={() => printFile(s)}
                onDelete={() => setScans((prev) => prev.filter((x) => x.id !== s.id))}
              />
            ))}
            {aiRecords.map((a) => (
              <SessionRow
                key={a.id}
                icon={SparklesIcon}
                iconBg="bg-violet-50"
                iconColor="text-violet-600"
                name={`${a.label} · ${a.fileName}`}
                meta={`AI · ${a.detail} · ${formatTime(a.createdAt)}`}
                onDelete={() => setAiRecords((prev) => prev.filter((x) => x.id !== a.id))}
              />
            ))}
          </div>
        </section>
      )}

      {/* 合规说明 — 诚实化：本次会话记录，跨会话资产中心仍在建设中 */}
      <p className="text-center text-xs leading-relaxed text-gray-400">
        以上为本次服务产生的记录，仅保存在当前会话；账号资产中心（跨会话保存）建设中
      </p>
    </div>
  )
}
