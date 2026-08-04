// ============================================================
// FairsServiceHubPage — 招聘会服务中心（/job-fairs/hub）
//
// 风格对齐 PrintScanHomePage.tsx：Tailwind CSS token + lucide-react
// 布局：2 列竖屏 cap-grid，能力卡 + 快捷入口 + 合规提示
//
// 合规：招聘会只做第三方/官方来源信息入口；预约请前往来源平台。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  BuildingIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilesIcon,
  GraduationCapIcon,
  InfoIcon,
  MapIcon,
  MapPinIcon,
  QrCodeIcon,
  SparklesIcon,
} from 'lucide-react'

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
  note?: string
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
    key: 'fair-plan',
    icon: ClipboardListIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: 'AI参会准备单',
    description: '输入目标招聘会，AI为你生成参会材料清单和时间规划，支持打印',
    to: '/job-fairs',
    note: '进入后选择招聘会，再生成准备单',
  },
  {
    key: 'fair-companies',
    icon: BuildingIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '参会企业',
    description: '查看招聘会参展企业名录、展位信息和在招岗位',
    to: '/job-fairs',
    note: '进入后选择招聘会查看',
  },
  {
    key: 'fair-map',
    icon: MapIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '场馆导览',
    description: '查看招聘会场馆平面图与展位分布，提前规划参观路线',
    to: '/job-fairs',
    note: '进入后选择招聘会查看',
  },
  {
    key: 'fair-materials',
    icon: FilesIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '活动资料',
    description: '查看招聘会通知、参会指引等官方资料，可直接打印带走',
    to: '/job-fairs',
    note: '进入后选择招聘会查看',
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

  return (
    <KioskPageFrame>
      <div className="flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="招聘会信息"
          description="场次查询 · 展位企业 · 场馆导览 · AI参会准备，投递预约请前往来源平台"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        {/* AI 横幅 */}
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-primary-200 bg-primary-50 px-5 py-3">
          <SparklesIcon className="h-5 w-5 shrink-0 text-primary-700" aria-hidden="true" />
          <div className="flex flex-col">
            <b className="text-[18px] font-bold text-primary-700">✦ AI材料清单</b>
            <p className="text-[17px] leading-relaxed text-neutral-500">
              AI根据你的目标生成参会准备清单，材料提前打印
            </p>
          </div>
        </div>

        {/* 7 能力卡（2 列等高网格） */}
        <div className="mt-6 grid grid-cols-2 gap-5">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => navigate(cap.to)}
                className={[
                  'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-6 text-left',
                  'border-t-4 shadow-sm active:scale-[0.99]',
                  cap.accentBorder,
                  'cursor-pointer',
                ].join(' ')}
              >
                <div className="flex items-center gap-4">
                  <span className={['flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', cap.iconBg].join(' ')}>
                    <Icon className={['h-[34px] w-[34px]', cap.iconColor].join(' ')} aria-hidden="true" />
                  </span>
                  <h3 className="font-serif text-[28px] font-bold tracking-wide text-neutral-900">{cap.title}</h3>
                </div>
                <p className="text-[18px] leading-relaxed text-neutral-500">{cap.description}</p>
                {cap.note && (
                  <p className="text-[16px] leading-relaxed text-warning-fg">{cap.note}</p>
                )}
                <div className="mt-auto flex items-center gap-2">
                  <span className={['flex items-center gap-2 text-[19px] font-semibold', cap.goColor].join(' ')}>
                    进入
                    <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* 快捷入口 */}
        <div className="mt-6">
          <div className="mb-2 flex items-baseline gap-3">
            <b className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">快捷入口</b>
            <span className="text-[17px] text-neutral-500">登录后可查看历史记录</span>
          </div>
          <div className="grid grid-cols-2 gap-[18px]">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.key}
                  type="button"
                  onClick={() => navigate(link.to)}
                  className="flex min-h-24 items-center gap-4 rounded-[var(--radius-md)] border border-neutral-200 bg-surface px-[22px] py-4 text-left shadow-sm active:scale-[0.98]"
                >
                  <span className={['flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px]', link.iconBg, link.iconColor].join(' ')}>
                    <Icon className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[21px] font-bold text-neutral-900">{link.title}</b>
                    <span className="mt-0.5 block text-[16px] text-neutral-500">{link.description}</span>
                  </span>
                  <ChevronRightIcon className="h-[22px] w-[22px] shrink-0 text-neutral-400 opacity-60" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>

        {/* 合规提示 */}
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
