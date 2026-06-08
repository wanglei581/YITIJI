import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import type {
  BenefitStatus,
  BenefitType,
  FavoriteTargetType,
  MemberAiRecordItem,
  MemberBenefitItem,
  MemberDocumentItem,
  MemberFavoriteItem,
  MemberResumeItem,
} from '@ai-job-print/shared'
import {
  BadgeCheckIcon,
  BellIcon,
  BotIcon,
  BoxIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileInputIcon,
  FilesIcon,
  FileTextIcon,
  GiftIcon,
  GraduationCapIcon,
  HeartIcon,
  HelpCircleIcon,
  LandmarkIcon,
  LayoutTemplateIcon,
  Loader2Icon,
  LogInIcon,
  MessageSquareIcon,
  PackageIcon,
  PrinterIcon,
  QrCodeIcon,
  RepeatIcon,
  ScanLineIcon,
  SettingsIcon,
  SparklesIcon,
  TargetIcon,
  TicketIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { fetchAccessUrl, getMyAiRecords, getMyDocuments, getMyResumes } from '../../services/api/memberAssets'
import { getMyBenefits, getMyFavorites, removeFavorite } from '../../services/api/memberFavorites'

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
  { icon: HeartIcon,    iconBg: 'bg-rose-50',    iconColor: 'text-rose-600',    label: '我的收藏' },
  { icon: TicketIcon,   iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '我的权益' },
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
  phoneMasked,
  stats,
  statsLoading,
  reserveBannerSpace,
  onLogin,
  onLogout,
  onShortcut,
}: {
  isLoggedIn: boolean
  displayName: string
  phoneMasked: string
  // null = 账号资产尚未加载完成（展示「—」而非误导性的 0）
  stats: {
    aiRecords: number | null
    favorites: number | null
    documents: number | null
  }
  statsLoading: boolean
  // 下方是否会展示「本次服务记录」浮层卡：true 时预留底部空间承接 -mt-12 浮层，false 时收紧
  reserveBannerSpace: boolean
  onLogin: () => void
  onLogout: () => void
  onShortcut: (message: string) => void
}) {
  if (isLoggedIn) {
    return (
      <section
        className={[
          '-mx-6 -mt-6 rounded-b-[28px] bg-gradient-to-br from-[#1677ff] via-[#1687ff] to-[#0f8cff] px-6 pt-8 text-white shadow-sm',
          reserveBannerSpace ? 'pb-16' : 'pb-8',
        ].join(' ')}
      >
        <div className="flex min-h-[44px] items-center justify-between">
          <h1 className="text-xl font-bold">我的主页</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onShortcut('账号设置建设中')}
              aria-label="账号设置"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/15 active:bg-white/24"
            >
              <SettingsIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onShortcut('消息通知建设中')}
              aria-label="消息通知"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/15 active:bg-white/24"
            >
              <BellIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-white/35 bg-white/18 text-2xl font-bold shadow-inner">
            {avatarInitial(displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-2xl font-bold leading-tight">{displayName}</p>
              <span className="inline-flex min-h-[24px] items-center gap-1 rounded-full bg-white/18 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20">
                <BadgeCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                已登录
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-white/85">
              <GraduationCapIcon className="h-4 w-4" aria-hidden="true" />
              会员账号
              <span className="text-white/45">|</span>
              {phoneMasked || '手机号已绑定'}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-white/85">
              <TargetIcon className="h-4 w-4" aria-hidden="true" />
              账号资料能力逐步开放中
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="hidden min-h-[40px] shrink-0 rounded-full bg-white/15 px-4 text-sm font-semibold text-white ring-1 ring-white/20 active:bg-white/25 sm:inline-flex sm:items-center"
          >
            退出登录
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/18 bg-white/8 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
          <div className="grid grid-cols-3 divide-x divide-white/16 text-center">
            <ProfileStat value={stats.aiRecords} label="AI记录" loading={statsLoading} />
            <ProfileStat value={stats.favorites} label="收藏记录" loading={statsLoading} />
            <ProfileStat value={stats.documents} label="文档记录" loading={statsLoading} />
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className={`flex items-center gap-4 ${cardSurface} px-6 py-5`}>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gray-100">
        <UserRoundIcon className="h-8 w-8 text-gray-400" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xl font-bold text-gray-900">游客</p>
        <p className="mt-1 text-sm text-gray-500">登录后用于绑定本人服务记录，仅本次会话有效</p>
      </div>

      <Button size="lg" onClick={onLogin} className="flex h-14 shrink-0 items-center gap-1 px-5 text-base">
        <LogInIcon className="h-5 w-5" aria-hidden="true" />
        手机号登录
      </Button>
    </div>
  )
}

// value=null 表示账号资产尚未加载完成：展示「—」而非误导性的 0；loading 时轻微脉冲提示。
function ProfileStat({ value, label, loading }: { value: number | null; label: string; loading: boolean }) {
  const unloaded = value === null
  return (
    <div className="px-2" aria-label={`${label}：${unloaded ? (loading ? '加载中' : '暂无数据') : value}`}>
      <p
        className={[
          'text-2xl font-bold leading-none',
          unloaded ? 'text-white/55' : '',
          unloaded && loading ? 'motion-safe:animate-pulse' : '',
        ].join(' ')}
      >
        {unloaded ? '—' : value}
      </p>
      <p className="mt-2 text-xs font-semibold text-white/78">{label}</p>
    </div>
  )
}

// 仅在「本次会话确有记录」时渲染（见调用处的 hasSessionRecords 门控）：
// 不展示空横幅，避免无记录时被误认为有未完成任务。
function PendingTaskBanner({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="-mt-12 rounded-2xl border border-neutral-100 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          <ScanLineIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-gray-900">本次服务记录</h2>
          <p className="mt-0.5 truncate text-xs text-gray-500">本次服务产生的记录，可继续查看</p>
        </div>
        <button
          type="button"
          onClick={onContinue}
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-full bg-primary-50 px-4 text-sm font-semibold text-primary-600 active:bg-primary-100"
        >
          查看记录
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
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

const AI_STATUS_LABEL: Record<string, string> = {
  pending: '处理中',
  processing: '处理中',
  completed: '已完成',
  failed: '未完成',
}

function aiStatusLabel(s: string): string {
  return AI_STATUS_LABEL[s] ?? s
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function avatarInitial(name: string): string {
  const clean = name.replace(/\s/g, '')
  if (!clean) return '我'
  if (/^\d/.test(clean)) return clean.slice(0, 1)
  return clean.slice(0, 1)
}

// ── 收藏 / 权益展示元数据（Phase C-2C）─────────────────────────────────────────

// 收藏对象按类型给图标 + 可选详情路由（job/job_fair 可跳既有详情页；policy 暂无详情页，仅展示）。
const FAVORITE_META: Record<
  FavoriteTargetType,
  { icon: LucideIcon; iconBg: string; iconColor: string; label: string; route?: (id: string) => string }
> = {
  job: { icon: BriefcaseIcon, iconBg: 'bg-sky-50', iconColor: 'text-sky-600', label: '岗位', route: (id) => `/jobs/${id}` },
  job_fair: { icon: CalendarIcon, iconBg: 'bg-green-50', iconColor: 'text-green-600', label: '招聘会', route: (id) => `/job-fairs/${id}` },
  policy: { icon: LandmarkIcon, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '政策' },
}

const BENEFIT_META: Record<BenefitType, { icon: LucideIcon; iconBg: string; iconColor: string; label: string }> = {
  coupon: { icon: TicketIcon, iconBg: 'bg-rose-50', iconColor: 'text-rose-600', label: '优惠券' },
  free_quota: { icon: GiftIcon, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '免费次数' },
  package_entitlement: { icon: BoxIcon, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', label: '套餐额度' },
  subsidy_eligibility_hint: { icon: LandmarkIcon, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', label: '补贴资格提示' },
}

const BENEFIT_STATUS_LABEL: Record<BenefitStatus, string> = {
  active: '可用',
  used_up: '已用完',
  expired: '已过期',
  revoked: '已失效',
}

// 权益副文本：状态 + 额度（仅额度类）+ 有效期；不出现任何「到账 / 已发放金额」承诺。
function benefitMetaText(b: MemberBenefitItem): string {
  const parts: string[] = [BENEFIT_STATUS_LABEL[b.status] ?? b.status]
  if (b.quantityRemaining != null) {
    parts.push(b.quantityTotal != null ? `剩 ${b.quantityRemaining}/${b.quantityTotal} 次` : `剩 ${b.quantityRemaining} 次`)
  }
  if (b.validUntil) parts.push(`有效期至 ${formatTime(b.validUntil)}`)
  return parts.join(' · ')
}

// 账号资产行：图标 + 名称 + 元信息 + 可选文本操作（触控区 ≥48px）。
function AssetRow({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  meta,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  name: string
  meta: string
  actionLabel?: string
  actionIcon?: LucideIcon
  onAction?: () => void
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
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 active:bg-primary-100"
        >
          {ActionIcon && <ActionIcon className="h-4 w-4" aria-hidden="true" />}
          {actionLabel}
        </button>
      )}
    </div>
  )
}

// 收藏行：图标 + 名称 + 类型/时间 + 可选「查看」(job/job_fair 跳详情) + 取消收藏（触控区 ≥48px）。
function FavoriteRow({
  fav,
  onView,
  onRemove,
}: {
  fav: MemberFavoriteItem
  onView?: () => void
  onRemove: () => void
}) {
  const meta = FAVORITE_META[fav.targetType]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', meta.iconBg].join(' ')}>
        <Icon className={['h-5 w-5', meta.iconColor].join(' ')} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{fav.title || `${meta.label}收藏`}</p>
        <p className="truncate text-xs text-gray-400">{`${meta.label} · ${formatTime(fav.createdAt)}`}</p>
      </div>
      {onView && (
        <button
          type="button"
          onClick={onView}
          className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 active:bg-primary-100"
        >
          <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" />
          查看
        </button>
      )}
      <RowIconButton icon={Trash2Icon} title="取消收藏" tone="danger" onClick={onRemove} />
    </div>
  )
}

// 账号资产分组：小标题 + 行或一行空态（同一张白卡内，不卡片套卡片）。
function AssetGroup({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <div className="border-t border-gray-100 py-2 first:border-t-0">
      <p className="px-1 py-1.5 text-xs font-medium text-gray-500">{title}</p>
      {count === 0 ? <p className="px-1 pb-2 text-xs text-gray-400">{empty}</p> : <div className="divide-y divide-gray-100">{children}</div>}
    </div>
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
  const { user, isLoggedIn, displayName, logout, getToken } = useAuth()
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

  // ── 账号资产（Phase C-2B 简历/文档/AI记录 + C-2C 收藏/权益）：仅登录会员，凭本人 token 拉取后端只读列表 ──
  const [assets, setAssets] = useState<{
    resumes: MemberResumeItem[]
    documents: MemberDocumentItem[]
    aiRecords: MemberAiRecordItem[]
    favorites: MemberFavoriteItem[]
    benefits: MemberBenefitItem[]
  } | null>(null)
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState(false)

  const headerDisplayName = user?.nickname?.trim() || displayName || '已登录用户'
  const headerPhoneMasked = user?.phoneMasked ?? displayName
  // 头部统计只取真实账号资产计数（来自 /me/* API），不叠加本次会话记录，避免同一文件被双算；
  // 本次会话记录在下方「本次服务记录」单独展示。不展示「完整度」——无真实完整度计算，不编造数字。
  // assets 为 null（加载中 / 未登录 / 加载失败）时取 null → 头部展示「—」，避免误显示 0。
  const headerStats = {
    aiRecords: assets ? assets.aiRecords.length : null,
    favorites: assets ? assets.favorites.length : null,
    documents: assets ? assets.documents.length : null,
  }

  const loadAssets = useCallback(() => {
    const token = getToken()
    if (!token) return
    setAssetsLoading(true)
    setAssetsError(false)
    Promise.all([
      getMyResumes(token),
      getMyDocuments(token),
      getMyAiRecords(token),
      getMyFavorites(token),
      getMyBenefits(token),
    ])
      .then(([res, docs, ai, favorites, benefits]) =>
        setAssets({ resumes: res, documents: docs, aiRecords: ai, favorites, benefits }),
      )
      .catch(() => setAssetsError(true))
      .finally(() => setAssetsLoading(false))
  }, [getToken])

  useEffect(() => {
    if (!isLoggedIn) {
      setAssets(null)
      return
    }
    loadAssets()
  }, [isLoggedIn, loadAssets])

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

  const continuePendingTask = () => {
    if (resumes[0]) {
      navigate('/resume')
      return
    }
    if (scans[0]) {
      printFile(scans[0])
      return
    }
    if (aiRecords[0]) {
      navigate('/resume')
    }
  }

  const printFile = (file: { name: string; size: string; pages?: number }) => {
    navigate('/print/preview', {
      state: { file: { name: file.name, size: file.size, pages: file.pages ?? 1 } },
    })
  }

  // 查看已登录会员的简历诊断报告：报告页凭本人 token 读回（归属收口 C-1）。
  const viewResume = (taskId: string) => {
    navigate('/resume/report', { state: { success: true, taskId } })
  }

  // 查看收藏：job / job_fair 跳既有详情页（policy 暂无详情页，不提供跳转）。
  const viewFavorite = (fav: MemberFavoriteItem) => {
    const route = FAVORITE_META[fav.targetType].route?.(fav.targetId)
    if (route) navigate(route)
  }

  // 取消收藏：凭本人 token 调后端（幂等），成功后本地移除该行（不整页重载）。
  const removeFavoriteItem = async (fav: MemberFavoriteItem) => {
    const token = getToken()
    if (!token) return
    try {
      await removeFavorite(token, fav.targetType, fav.targetId)
      setAssets((prev) => (prev ? { ...prev, favorites: prev.favorites.filter((f) => f.id !== fav.id) } : prev))
      setToastMsg('已取消收藏')
    } catch {
      setToastMsg('取消收藏失败，请稍后重试')
    }
  }

  // 打开文档：凭本人 token 换取 TTL 受控的短期签名 URL，再触发下载（不在列表里直接持 URL）。
  const openDocument = async (doc: MemberDocumentItem) => {
    const token = getToken()
    if (!token) return
    try {
      const { url } = await fetchAccessUrl(doc.downloadUrlPath, token)
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    } catch {
      setToastMsg('文件访问失败，请稍后重试')
    }
  }

  const handleEntryTap = (entry: Entry) => {
    if (entry.route) {
      navigate(entry.route)
      return
    }
    // 收藏 / 权益已服务端化（Phase C-2C）：登录会员的真实列表在下方「账号资产」展示。
    if (entry.label === '我的收藏' || entry.label === '我的权益') {
      setToastMsg(isLoggedIn ? '见下方账号资产' : '登录后可查看本人收藏与权益')
      return
    }
    if (entry.tag === '本次记录') {
      setToastMsg(hasSessionRecords ? '本次会话记录见下方' : '本次会话暂无记录，完成服务后在此查看')
      return
    }
    setToastMsg('该功能建设中，敬请期待')
  }

  return (
    <div className="relative flex min-h-full flex-col gap-4 bg-[#eef2f7] p-6 pb-24">
      {/* ── 顶部个人信息区 ── */}
      <ProfileHeader
        isLoggedIn={isLoggedIn}
        displayName={headerDisplayName}
        phoneMasked={headerPhoneMasked}
        stats={headerStats}
        statsLoading={assetsLoading}
        reserveBannerSpace={isLoggedIn && hasSessionRecords}
        onLogin={goLogin}
        onLogout={logout}
        onShortcut={setToastMsg}
      />

      {isLoggedIn && hasSessionRecords && <PendingTaskBanner onContinue={continuePendingTask} />}

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

      {/* ── 账号资产（Phase C-2B，仅登录会员；真实只读列表 / 空态）── */}
      {isLoggedIn && (
        <section aria-label="账号资产" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-gray-500">账号资产</h2>
            <span className="text-xs text-gray-400">本人 · 留存期内可见</span>
          </div>
          <div className={`${cardSurface} px-4`}>
            {assetsLoading ? (
              <div className="flex items-center gap-2 py-5 text-sm text-gray-400">
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
                正在加载我的资产…
              </div>
            ) : assetsError ? (
              <div className="flex items-center justify-between py-5 text-sm">
                <span className="text-gray-500">资产加载失败，请重试</span>
                <button
                  type="button"
                  onClick={loadAssets}
                  className="min-h-[44px] rounded-lg border border-gray-200 px-4 font-medium text-primary-600 hover:bg-primary-50"
                >
                  重试
                </button>
              </div>
            ) : (
              <>
                <AssetGroup title="我的简历" count={assets?.resumes.length ?? 0} empty="暂无简历记录，完成 AI 简历服务后在此查看">
                  {assets?.resumes.map((r) => (
                    <AssetRow
                      key={r.id}
                      icon={FileTextIcon}
                      iconBg="bg-primary-50"
                      iconColor="text-primary-600"
                      name={`简历诊断 · ${aiStatusLabel(r.status)}${r.optimized ? ' · 已生成优化版' : ''}`}
                      meta={`${formatTime(r.createdAt)}`}
                      actionLabel="查看报告"
                      actionIcon={EyeIcon}
                      onAction={() => viewResume(r.taskId)}
                    />
                  ))}
                </AssetGroup>

                <AssetGroup title="我的文档" count={assets?.documents.length ?? 0} empty="暂无文档，上传或打印的文件将在此查看">
                  {assets?.documents.map((d) => (
                    <AssetRow
                      key={d.id}
                      icon={FilesIcon}
                      iconBg="bg-blue-50"
                      iconColor="text-blue-600"
                      name={d.filename}
                      meta={`${formatSize(d.sizeBytes)} · ${formatTime(d.createdAt)}`}
                      actionLabel="下载"
                      actionIcon={DownloadIcon}
                      onAction={() => void openDocument(d)}
                    />
                  ))}
                </AssetGroup>

                <AssetGroup title="AI 服务记录" count={assets?.aiRecords.length ?? 0} empty="暂无 AI 服务记录">
                  {assets?.aiRecords.map((a) => (
                    <AssetRow
                      key={a.id}
                      icon={SparklesIcon}
                      iconBg="bg-violet-50"
                      iconColor="text-violet-600"
                      name={`${a.kind === 'optimize' ? '简历优化' : '简历解析'} · ${aiStatusLabel(a.status)}`}
                      meta={`${formatTime(a.createdAt)}`}
                    />
                  ))}
                </AssetGroup>

                {/* 我的收藏（Phase C-2C）：岗位 / 招聘会 / 政策的兴趣标记，仅浏览/收藏，不含投递 */}
                <AssetGroup
                  title="我的收藏"
                  count={assets?.favorites.length ?? 0}
                  empty="暂无收藏，浏览岗位 / 招聘会 / 政策时点收藏后在此查看"
                >
                  {assets?.favorites.map((f) => (
                    <FavoriteRow
                      key={f.id}
                      fav={f}
                      onView={FAVORITE_META[f.targetType].route ? () => viewFavorite(f) : undefined}
                      onRemove={() => void removeFavoriteItem(f)}
                    />
                  ))}
                </AssetGroup>

                {/* 我的权益（Phase C-2C 底座）：只读展示；补贴资格提示 info-only，无「到账」承诺 */}
                <AssetGroup
                  title="我的权益"
                  count={assets?.benefits.length ?? 0}
                  empty="暂无可用权益，参与活动或购买套餐后在此查看"
                >
                  {assets?.benefits.map((b) => {
                    const meta = BENEFIT_META[b.benefitType]
                    return (
                      <AssetRow
                        key={b.id}
                        icon={meta.icon}
                        iconBg={meta.iconBg}
                        iconColor={meta.iconColor}
                        name={b.title}
                        meta={`${meta.label} · ${benefitMetaText(b)}`}
                      />
                    )
                  })}
                </AssetGroup>
              </>
            )}
          </div>
        </section>
      )}

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

      {/* 合规说明 — 诚实化：登录会员展示本人账号资产（留存到期清理）；游客仅本次会话 */}
      <p className="text-center text-xs leading-relaxed text-gray-400">
        {isLoggedIn
          ? '账号资产仅本人可见，留存到期后自动清理，敏感文件不长期保存；更多资产能力逐步开放中'
          : '以上为本次服务产生的记录，仅保存在当前会话；登录后可查看本人账号资产'}
      </p>
    </div>
  )
}
