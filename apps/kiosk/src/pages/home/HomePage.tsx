import { Fragment } from 'react'
import { Button } from '@ai-job-print/ui'
import {
  BookOpenIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  MessageSquareIcon,
  PrinterIcon,
  ScanIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  WifiIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// ── DeviceStatusStrip ─────────────────────────────────────────

interface DeviceItem {
  icon: typeof PrinterIcon
  label: string
  ok: boolean
}

function DeviceStatusStrip() {
  const devices: DeviceItem[] = [
    { icon: PrinterIcon, label: '打印机正常', ok: true },
    { icon: ScanIcon,    label: '扫描仪正常', ok: true },
    { icon: WifiIcon,    label: '网络正常',   ok: true },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {devices.map(({ icon: Icon, label, ok }) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className={['h-2 w-2 rounded-full', ok ? 'bg-green-400' : 'bg-red-400'].join(' ')} />
          <Icon className="h-3.5 w-3.5 text-blue-300" aria-hidden="true" />
          <span className="text-xs font-medium text-blue-100">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── HeroSection ───────────────────────────────────────────────

/** Lightweight service-path visual inside the hero. */
const SERVICE_PATH = ['上传简历', 'AI 诊断', '优化建议', '打印材料'] as const

function HeroSection() {
  return (
    <div
      className="relative overflow-hidden px-8 pb-12 pt-14"
      style={{ backgroundColor: '#0B2A5B' }}
    >
      {/* Dot-grid texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1.5px 1.5px, #fff 1.5px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />

      <div className="relative">
        {/* Label line */}
        <div className="flex items-center gap-2.5">
          <div className="h-px w-10 bg-blue-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-blue-300">
            公共就业服务终端
          </span>
        </div>

        {/* Title */}
        <h1 className="mt-4 text-[2.5rem] font-bold leading-tight tracking-tight text-white">
          AI求职打印服务终端
        </h1>
        <p className="mt-2.5 text-base leading-relaxed text-blue-200">
          简历优化 · 材料打印 · 岗位查询 · 招聘会服务
        </p>

        {/* ① Service-path flow (Change #3) */}
        <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {SERVICE_PATH.map((step, i) => (
            <Fragment key={step}>
              <span className="rounded-full border border-blue-400/30 bg-blue-900/50 px-3.5 py-1 text-xs font-medium text-blue-200">
                {step}
              </span>
              {i < SERVICE_PATH.length - 1 && (
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden="true" />
              )}
            </Fragment>
          ))}
        </div>

        {/* Device status bar */}
        <div className="mt-6 flex items-center rounded-lg border border-white/10 bg-white/[0.06] px-5 py-3.5">
          <DeviceStatusStrip />
        </div>
      </div>
    </div>
  )
}

// ── LoginBenefitCard ─────────────────────────────────────────
// Change #2: floating rounded card with primary button

function LoginBenefitCard({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100">
            <UserIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              欢迎使用就业服务终端
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
              登录后可保存简历、打印记录和 AI 服务报告
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={onLoginClick}
          className="shrink-0 whitespace-nowrap"
        >
          立即登录 / 注册
        </Button>
      </div>
    </div>
  )
}

// ── PrimaryServiceCard ────────────────────────────────────────

interface SubAction {
  label: string
  onClick: () => void
}

interface PrimaryServiceCardProps {
  icon: typeof SparklesIcon
  iconBg: string
  iconColor: string
  accentClass: string
  title: string
  description: string
  buttonLabel: string
  onAction: () => void
  subActions?: SubAction[]
}

function PrimaryServiceCard({
  icon: Icon,
  iconBg,
  iconColor,
  accentClass,
  title,
  description,
  buttonLabel,
  onAction,
  subActions,
}: PrimaryServiceCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Left accent bar */}
      <div className={['absolute inset-y-0 left-0 w-1', accentClass].join(' ')} />

      <div className="flex h-full flex-col px-7 py-6 pl-9">
        {/* Icon + title row */}
        <div className="flex items-start gap-4">
          <div
            className={[
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl',
              iconBg,
            ].join(' ')}
          >
            <Icon className={['h-8 w-8', iconColor].join(' ')} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{description}</p>
          </div>
        </div>

        {/* Spacer so button stays at bottom in equal-height grid cells */}
        <div className="flex-1" />

        {/* Primary action */}
        <Button size="lg" onClick={onAction} className="mt-6 h-16 w-full text-xl">
          {buttonLabel}
          <ChevronRightIcon className="ml-1.5 h-5 w-5" aria-hidden="true" />
        </Button>

        {/* Sub-actions */}
        {subActions && subActions.length > 0 && (
          <div className="mt-3.5 flex gap-2.5">
            {subActions.map(({ label, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
              >
                <CheckCircle2Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SecondaryServiceCard ──────────────────────────────────────
// Change #5: description + action text bumped to text-base, min-h >= 48px guaranteed

interface SecondaryServiceCardProps {
  icon: typeof BriefcaseIcon
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

function SecondaryServiceCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: SecondaryServiceCardProps) {
  return (
    <button
      type="button"
      onClick={onAction}
      className="flex min-h-[200px] flex-col rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
        <Icon className="h-6 w-6 text-gray-600" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-semibold leading-snug text-gray-900">{title}</h3>
      {/* text-sm → text-base */}
      <p className="mt-2 flex-1 text-base leading-relaxed text-gray-500">{description}</p>
      <div className="mt-4 flex min-h-[48px] items-center gap-0.5 text-base font-semibold text-primary-600">
        <span>{actionLabel}</span>
        <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
      </div>
    </button>
  )
}

// ── DynamicServicePanel ───────────────────────────────────────
// Change #4: data-driven, only render available: true entries; future items kept in structure

interface ServiceEntry {
  key: string
  label: string
  desc: string
  icon: typeof BriefcaseIcon
  /** false = reserved for future release — kept in list but not rendered */
  available: boolean
}

const DYNAMIC_SERVICES: ServiceEntry[] = [
  {
    key: 'jobs',
    label: '岗位信息查询',
    desc: '第三方平台同步，可外链投递',
    icon: BriefcaseIcon,
    available: true,
  },
  {
    key: 'fairs',
    label: '招聘会服务',
    desc: '招聘会详情与现场导览模式',
    icon: CalendarIcon,
    available: true,
  },
  {
    key: 'policy',
    label: '就业政策',
    desc: '政策查询与补贴申请指南',
    icon: FileTextIcon,
    available: true,
  },
  // Reserved — will be set to available: true when the feature ships
  { key: 'print-bundle', label: '打印材料包', desc: '', icon: PrinterIcon,  available: false },
  { key: 'ai-package',   label: 'AI求职套餐', desc: '', icon: SparklesIcon, available: false },
]

function DynamicServicePanel() {
  const available = DYNAMIC_SERVICES.filter((s) => s.available)

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 px-6 py-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary-500" />
        <span className="text-sm font-semibold text-primary-800">当前可用服务</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {available.map(({ key, label, desc, icon: Icon }) => (
          <div
            key={key}
            className="flex items-start gap-3 rounded-lg bg-white/70 px-4 py-3"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-primary-800">{label}</p>
              {desc && <p className="mt-0.5 text-xs text-primary-600">{desc}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RenshiZoneBanner ─────────────────────────────────────────
// 人社专区首页特色入口卡片

interface RenshiQuickEntry {
  key: string
  label: string
  icon: typeof BookOpenIcon
}

const RENSHI_ENTRIES: RenshiQuickEntry[] = [
  { key: 'policy',   label: '就业政策', icon: FileTextIcon },
  { key: 'social',   label: '社保指南', icon: ShieldCheckIcon },
  { key: 'register', label: '就业登记', icon: ClipboardListIcon },
  { key: 'notice',   label: '政策公告', icon: ScrollTextIcon },
]

function RenshiZoneBanner({ onAction, onQuickEntry }: {
  onAction: () => void
  onQuickEntry: (key: string) => void
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl px-6 py-6"
      style={{ backgroundColor: '#0F3460' }}
    >
      {/* Dot texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1.5px 1.5px, #fff 1.5px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <BookOpenIcon className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">人社专区</h2>
                <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
                  官方服务入口
                </span>
              </div>
              <p className="mt-0.5 text-sm text-blue-200">
                就业政策 · 社保指南 · 就业登记 · 材料打印
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onAction}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 transition-opacity hover:opacity-90 active:opacity-75"
          >
            进入专区
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Quick entries */}
        <div className="mt-5 grid grid-cols-4 gap-2.5">
          {RENSHI_ENTRIES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onQuickEntry(key)}
              className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.07] py-4 text-white transition-colors hover:bg-white/[0.12] active:bg-white/[0.18]"
            >
              <Icon className="h-5 w-5 text-blue-200" aria-hidden="true" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── AssistantBanner ───────────────────────────────────────────

function AssistantBanner({ onAction }: { onAction: () => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-7 py-7 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <MessageSquareIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">不知道怎么操作？</p>
            <p className="mt-1 text-sm text-gray-500">
              告诉 AI 助手你想做什么，例如"我要打印简历"
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="md"
          onClick={onAction}
          className="shrink-0 whitespace-nowrap"
        >
          问问 AI 助手
        </Button>
      </div>
    </div>
  )
}

// ── HomePage ──────────────────────────────────────────────────

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <HeroSection />

      {/* Main content — LoginBenefitCard moved inside as first card (Change #2) */}
      <div className="flex flex-col gap-6 bg-canvas px-6 py-7">

        {/* ② Login benefit — rounded floating card */}
        <LoginBenefitCard onLoginClick={() => navigate('/profile')} />

        {/* ① Primary services — dual column at md (≥768px), single column below */}
        <section aria-label="主要服务" className="flex flex-col gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            主要功能
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PrimaryServiceCard
              icon={SparklesIcon}
              iconBg="bg-primary-50"
              iconColor="text-primary-600"
              accentClass="bg-primary-600"
              title="AI 简历服务"
              description="上传或扫描简历，获取 AI 诊断报告和优化建议"
              buttonLabel="开始优化简历"
              onAction={() => navigate('/resume/source')}
            />
            <PrimaryServiceCard
              icon={PrinterIcon}
              iconBg="bg-gray-100"
              iconColor="text-gray-700"
              accentClass="bg-gray-500"
              title="打印扫描"
              description="打印文件、扫描材料、生成 PDF 存档"
              buttonLabel="开始打印 / 扫描"
              onAction={() => navigate('/print/upload')}
              subActions={[
                { label: '文件打印', onClick: () => navigate('/print/upload') },
                { label: '扫描成 PDF', onClick: () => navigate('/scan/start') },
              ]}
            />
          </div>
        </section>

        {/* Secondary services — 2×2 grid */}
        <section aria-label="更多服务">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">
            更多服务
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <SecondaryServiceCard
              icon={BriefcaseIcon}
              title="岗位信息"
              description="查看第三方平台同步岗位"
              actionLabel="查看岗位"
              onAction={() => navigate('/jobs')}
            />
            <SecondaryServiceCard
              icon={CalendarIcon}
              title="招聘会服务"
              description="招聘会信息与现场导览"
              actionLabel="查看招聘会"
              onAction={() => navigate('/job-fairs')}
            />
            <SecondaryServiceCard
              icon={FileTextIcon}
              title="人社专区"
              description="就业政策、社保指南、办事登记"
              actionLabel="进入专区"
              onAction={() => navigate('/renshi')}
            />
            <SecondaryServiceCard
              icon={UserIcon}
              title="我的记录"
              description="简历、打印和 AI 服务记录"
              actionLabel="查看记录"
              onAction={() => navigate('/profile')}
            />
          </div>
        </section>

        {/* ④ Dynamic service panel — only available items */}
        <DynamicServicePanel />

        {/* 人社专区特色入口 */}
        <RenshiZoneBanner
          onAction={() => navigate('/renshi')}
          onQuickEntry={(key) => navigate(`/renshi?tab=${key}`)}
        />

        {/* AI assistant banner */}
        <AssistantBanner onAction={() => navigate('/assistant')} />

        <div className="h-1" />
      </div>
    </div>
  )
}
