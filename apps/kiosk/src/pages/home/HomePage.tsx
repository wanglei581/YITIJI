import { Button } from '@ai-job-print/ui'
import {
  BookOpenIcon,
  BotIcon,
  BriefcaseIcon,
  CalendarIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  MapPinIcon,
  MonitorCheckIcon,
  PrinterIcon,
  SparklesIcon,
  UserIcon,
  WifiIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'

// ── DeviceStatusStrip ─────────────────────────────────────────
//
// 首页这条状态带没有 terminalId 上下文（VITE_TERMINAL_ID 仅在打印流程页按需查询），
// 因此不写死「正常」绿点（打印机离线时仍显示正常会误导用户）。改为中性提示：
// 设备实际可用性以「打印前检测」为准。真实状态在 /print/preview 通过
// usePrinterStatus(VITE_TERMINAL_ID) 心跳查询并展示。

interface DeviceItem {
  icon: typeof PrinterIcon
  label: string
}

function DeviceStatusStrip() {
  const devices: DeviceItem[] = [
    { icon: PrinterIcon,      label: '打印机' },
    { icon: MonitorCheckIcon, label: '扫描仪' },
    { icon: WifiIcon,         label: '网络' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {devices.map(({ icon: Icon, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-300/60" aria-hidden="true" />
          <Icon className="h-4 w-4 text-blue-200" aria-hidden="true" />
          <span className="text-sm font-medium text-blue-100">{label}</span>
        </div>
      ))}
      <span className="text-xs text-blue-200/80">设备状态以打印前检测为准</span>
    </div>
  )
}

// ── HeroSection ───────────────────────────────────────────────

function HeroSection() {
  const navigate = useNavigate()
  const { isLoggedIn, displayName } = useAuth()

  return (
    <div className="px-8 pb-14 pt-10" style={{ backgroundColor: '#0B2A5B' }}>
      <h1 className="text-[2.25rem] font-bold leading-tight tracking-tight text-white">
        AI求职打印服务终端
      </h1>
      <p className="mt-2 text-base leading-relaxed text-blue-200">
        简历优化 · 材料打印 · 岗位查询 · 招聘会服务
      </p>
      <div className="mt-6 flex items-center rounded-lg border border-white/10 bg-white/[0.06] px-5 py-3">
        <DeviceStatusStrip />
      </div>
      {/* 登录感知条 */}
      {isLoggedIn ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2.5">
          <UserIcon className="h-4 w-4 shrink-0 text-blue-300" aria-hidden="true" />
          <span className="text-sm text-blue-100">欢迎回来，{displayName}</span>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2.5">
          <span className="text-sm text-blue-200">登录后可识别身份，后续将接入服务记录</span>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="ml-4 shrink-0 rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-primary-700 active:bg-gray-100"
          >
            立即登录
          </button>
        </div>
      )}
    </div>
  )
}

// ── PrimaryServiceCard ────────────────────────────────────────

interface PrimaryServiceCardProps {
  icon: typeof SparklesIcon
  iconBg: string
  iconColor: string
  title: string
  description: string
  buttonLabel: string
  onAction: () => void
}

function PrimaryServiceCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  description,
  buttonLabel,
  onAction,
}: PrimaryServiceCardProps) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white px-7 py-6 shadow-sm">
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
      <div className="flex-1" />
      <Button size="lg" onClick={onAction} className="mt-6 h-16 w-full text-xl">
        {buttonLabel}
        <ChevronRightIcon className="ml-1.5 h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  )
}

// ── SecondaryServiceCard ──────────────────────────────────────

interface SecondaryServiceCardProps {
  icon: typeof BriefcaseIcon
  iconBg?: string
  iconColor?: string
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

function SecondaryServiceCard({
  icon: Icon,
  iconBg = 'bg-gray-100',
  iconColor = 'text-gray-600',
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
      <div className={['flex h-12 w-12 items-center justify-center rounded-lg', iconBg].join(' ')}>
        <Icon className={['h-6 w-6', iconColor].join(' ')} aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-semibold leading-snug text-gray-900">{title}</h3>
      <p className="mt-2 flex-1 text-base leading-relaxed text-gray-500">{description}</p>
      <div className="mt-4 flex min-h-[48px] items-center gap-0.5 text-base font-semibold text-primary-600">
        <span>{actionLabel}</span>
        <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
      </div>
    </button>
  )
}

// ── CampusEntryBar ────────────────────────────────────────────

function CampusEntryBar({ onAction }: { onAction: () => void }) {
  return (
    <button
      type="button"
      onClick={onAction}
      className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-5 text-left shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
          <GraduationCapIcon className="h-6 w-6 text-cyan-700" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">校园招聘专区</h3>
          <p className="mt-0.5 text-sm text-gray-500">应届校招岗位 · 校园双选会 · 简历与材料</p>
        </div>
      </div>
      <div className="flex items-center gap-1 text-base font-semibold text-primary-600">
        <span>进入专区</span>
        <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
      </div>
    </button>
  )
}

// ── RenshiEntryBar ────────────────────────────────────────────

function RenshiEntryBar({ onAction }: { onAction: () => void }) {
  return (
    <button
      type="button"
      onClick={onAction}
      className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-5 text-left shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
          <BookOpenIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">人社专区</h3>
          <p className="mt-0.5 text-sm text-gray-500">就业政策 · 社保指南 · 就业登记 · 政策公告</p>
        </div>
      </div>
      <div className="flex items-center gap-1 text-base font-semibold text-primary-600">
        <span>进入专区</span>
        <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
      </div>
    </button>
  )
}

// ── HomePage ──────────────────────────────────────────────────

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full flex-col">
      <HeroSection />

      <div className="relative -mt-6 z-10 flex flex-1 flex-col gap-6 rounded-t-3xl bg-canvas px-6 py-7">
        {/* 主要功能 */}
        <section aria-label="主要功能" className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-gray-400">主要功能</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PrimaryServiceCard
              icon={SparklesIcon}
              iconBg="bg-primary-50"
              iconColor="text-primary-600"
              title="AI 简历服务"
              description="上传或扫描简历,获取 AI 诊断报告和优化建议"
              buttonLabel="进入简历服务"
              onAction={() => navigate('/resume')}
            />
            <PrimaryServiceCard
              icon={PrinterIcon}
              iconBg="bg-gray-100"
              iconColor="text-gray-700"
              title="打印扫描"
              description="文档打印、材料扫描、照片与证件照、格式转换"
              buttonLabel="进入打印扫描"
              onAction={() => navigate('/print-scan')}
            />
          </div>
        </section>

        {/* 更多服务 */}
        <section aria-label="更多服务" className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-gray-400">更多服务</h2>
          <div className="grid grid-cols-3 gap-4">
            <SecondaryServiceCard
              icon={BriefcaseIcon}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
              title="岗位信息"
              description="查看第三方平台同步岗位"
              actionLabel="查看岗位"
              onAction={() => navigate('/jobs')}
            />
            <SecondaryServiceCard
              icon={CalendarIcon}
              iconBg="bg-green-50"
              iconColor="text-green-600"
              title="招聘会"
              description="招聘会信息与现场导览"
              actionLabel="查看招聘会"
              onAction={() => navigate('/job-fairs')}
            />
            <SecondaryServiceCard
              icon={MapPinIcon}
              iconBg="bg-teal-50"
              iconColor="text-teal-600"
              title="AI 在青岛"
              description="青岛就业、政策、高校、园区、城市资讯"
              actionLabel="进入专区"
              onAction={() => navigate('/qingdao')}
            />
          </div>
        </section>

        {/* 校园招聘专区 — 单行辅助带 */}
        <CampusEntryBar onAction={() => navigate('/campus')} />

        {/* 人社专区 — 单行辅助带 */}
        <RenshiEntryBar onAction={() => navigate('/renshi')} />

        {/* AI 助手入口 — 触控友好 */}
        <button
          type="button"
          onClick={() => navigate('/assistant')}
          className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50 active:bg-primary-100"
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
