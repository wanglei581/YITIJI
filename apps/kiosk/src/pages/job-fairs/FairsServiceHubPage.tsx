// ============================================================
// FairsServiceHubPage — 招聘会服务中心（/fairs-service）
//
// 风格对齐 PrintScanHomePage.tsx：Tailwind CSS token + lucide-react
// 布局：6 张能力卡（2 列 × 3 行，无孤儿）+ 快捷入口 + 合规提示
//
// 修复（2026-08）：
//   - Critical: 原 7 张卡中 4 张重复指向 /job-fairs → 替换为真实路由
//   - High: 7 张奇数卡末行孤儿 → 调整为 6 张偶数卡
//
// 合规：招聘会只做第三方/官方来源信息入口；预约请前往来源平台。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import { ServiceReadinessStrip } from '../../components/ServiceReadinessStrip'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  GraduationCapIcon,
  InfoIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  SparklesIcon,
} from 'lucide-react'
import '../styles/service-hub-editorial.css'

interface Capability {
  key: string
  icon: React.ComponentType<{ className?: string }>
  accentBorder: string
  iconBg: string
  iconColor: string
  goColor: string
  title: string
  description: string
  to: string
  state?: Record<string, unknown>
}

const CAPABILITIES: Capability[] = [
  {
    key: 'fair-social',
    icon: MapPinIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '社会招聘会',
    description: '查看企业社会招聘会场次，了解参会企业、时间和地点信息',
    to: '/job-fairs',
  },
  {
    key: 'fair-campus',
    icon: GraduationCapIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: '校园招聘会',
    description: '查看高校或机构组织的校园专场招聘会，含企业名录和预约入口',
    to: '/campus',
  },
  {
    key: 'checkin',
    icon: QrCodeIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '扫码签到',
    description: '现场活动签到二维码展示与识别引导',
    to: '/job-fairs/checkin',
  },
  {
    key: 'ai-plan',
    icon: SparklesIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: 'AI参会规划',
    description: '告诉AI顾问你想参加的招聘会，小青为你生成参会清单和时间安排',
    to: '/assistant',
    // 不传 `state.topic`：`/assistant` 不读 location.state（认的是 `?intent=`，
    // 且取值须是 advisorScenes 的 skill id，'jobfair' 不是）。传了必被丢弃。
  },
  {
    key: 'resume-prepare',
    icon: FileTextIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '求职材料准备',
    description: '提前准备好简历和求职材料，现场打印后直接使用',
    to: '/resume-service',
  },
  {
    key: 'fair-print',
    icon: PrinterIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '活动资料打印',
    description: '上传或扫描招聘会相关材料，本机直接打印备用',
    to: '/print-scan',
  },
]

interface QuickLink {
  key: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  description: string
  to: string
}

const QUICK_LINKS: QuickLink[] = [
  {
    key: 'browse-history',
    icon: EyeIcon,
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    title: '浏览记录',
    description: '查看最近浏览的招聘会',
    to: '/me/activity',
  },
  {
    key: 'jump-history',
    icon: ExternalLinkIcon,
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    title: '外部跳转记录',
    description: '查看已前往来源平台的记录',
    to: '/me/activity?tab=jump',
  },
]

export function FairsServiceHubPage() {
  const navigate = useNavigate()
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const apiBlocked = apiStatus !== 'ready'

  return (
    <KioskPageFrame>
      <div className="service-hub service-hub--fairs flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="招聘会信息"
          description="场次查询 · 校园专场 · AI参会规划 · 材料打印，投递预约请前往来源平台"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        <ServiceReadinessStrip status={apiStatus} onRetry={retryApi} />

        {/* 6 能力卡（2 列 × 3 行，无孤儿） */}
        <div className="service-hub__grid mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-5">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => {
                  if (!apiBlocked) navigate(cap.to, cap.state ? { state: cap.state } : undefined)
                }}
                disabled={apiBlocked}
                className={[
                  'service-hub__card',
                  'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-4 text-left sm:p-6',
                  'border-t-4 shadow-sm active:scale-[0.99]',
                  cap.accentBorder,
                  apiBlocked ? 'service-hub__card--blocked' : 'cursor-pointer',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                  <span
                    className={[
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl sm:h-16 sm:w-16 sm:rounded-2xl',
                      cap.iconBg,
                    ].join(' ')}
                  >
                    <Icon
                      className={['h-7 w-7 sm:h-[34px] sm:w-[34px]', cap.iconColor].join(' ')}
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="font-serif text-[22px] font-bold tracking-wide text-neutral-900 sm:text-[28px]">
                    {cap.title}
                  </h3>
                </div>
                <p className="text-[15px] leading-relaxed text-neutral-500 sm:text-[18px]">
                  {cap.description}
                </p>
                <div className="mt-auto flex items-center gap-2">
                  <span
                    className={[
                      'flex items-center gap-2 text-[16px] font-semibold sm:text-[19px]',
                      cap.goColor,
                    ].join(' ')}
                  >
                    {apiBlocked ? '等待服务' : '进入'}
                    <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* 快捷入口（2 列） */}
        <div className="service-hub__quick-section mt-6">
          <div className="mb-2 flex items-baseline gap-3">
            <b className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">
              快捷入口
            </b>
            <span className="text-[17px] text-neutral-500">登录后可查看历史记录</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[18px]">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.key}
                  type="button"
                  onClick={() => {
                    if (!apiBlocked) navigate(link.to)
                  }}
                  disabled={apiBlocked}
                  className={`flex min-h-24 items-center gap-4 rounded-[var(--radius-md)] border border-neutral-200 bg-surface px-[22px] py-4 text-left shadow-sm active:scale-[0.98]${apiBlocked ? ' service-hub__quick--blocked' : ''}`}
                >
                  <span
                    className={[
                      'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px]',
                      link.iconBg,
                      link.iconColor,
                    ].join(' ')}
                  >
                    <Icon className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[21px] font-bold text-neutral-900">{link.title}</b>
                    <span className="mt-0.5 block text-[16px] text-neutral-500">
                      {link.description}
                    </span>
                  </span>
                  <ChevronRightIcon
                    className="h-[22px] w-[22px] shrink-0 text-neutral-400 opacity-60"
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </div>
        </div>

        {/* 合规提示 — border-dashed border-neutral-200 bg-surface/70 + InfoIcon（对齐其他 hub 页面） */}
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-3">
          <InfoIcon className="h-5 w-5 shrink-0 text-wheat" aria-hidden="true" />
          <p className="text-[17px] leading-relaxed text-neutral-500">
            招聘会信息来自第三方或官方来源；预约、报名请前往来源平台完成，本终端只提供信息展示与跳转入口。
          </p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
