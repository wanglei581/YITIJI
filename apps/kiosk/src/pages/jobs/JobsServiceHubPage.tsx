// ============================================================
// JobsServiceHubPage — 岗位信息服务中心（/jobs-service）
//
// 视觉口径：Tailwind CSS token，与 PrintScanHomePage 风格对齐
// 布局：2 列固定竖屏网格，按钮 min-height ≥ 56px
//
// 功能：8 能力入口 + 2 快捷入口 + AI能力横幅 + 合规提示
// 合规：岗位来自第三方/官方来源，投递请前往来源平台，本系统不参与招聘闭环
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  BriefcaseIcon,
  BuildingIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  GraduationCapIcon,
  LayoutGridIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TargetIcon,
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
  state?: Record<string, unknown>
  available: boolean
  unavailableBadge?: string
}

const CAPABILITIES: Capability[] = [
  {
    key: 'fulltime',
    icon: BriefcaseIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '全职岗位',
    description: '第三方平台同步的全职岗位信息，可筛选行业、地区与薪资范围',
    to: '/jobs?category=fulltime',
    available: true,
  },
  {
    key: 'intern',
    icon: GraduationCapIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '实习岗位',
    description: '适合在校生与应届生的实习机会，来自第三方权威来源',
    to: '/jobs?category=intern',
    available: true,
  },
  {
    key: 'parttime',
    icon: ClockIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '兼职信息',
    description: '灵活就业与兼职机会，第三方来源展示，投递请前往来源平台',
    to: '/jobs?category=parttime',
    available: true,
  },
  {
    key: 'all',
    icon: LayoutGridIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '全部岗位',
    description: '按分类查看全部来源岗位，支持关键词搜索与综合筛选',
    to: '/jobs',
    available: true,
  },
  {
    key: 'companies',
    icon: BuildingIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '找企业',
    description: '查看参与机构的企业信息与在招岗位来源，了解目标企业',
    to: '/companies',
    available: true,
  },
  {
    key: 'job-fit',
    icon: TargetIcon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: '岗位大师',
    description: '上传简历后，AI分析与岗位的匹配度，给出针对性优化建议',
    to: '/resume/job-fit',
    available: true,
  },
  {
    key: 'online-platforms',
    icon: SmartphoneIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '线上招聘平台',
    description: '扫码访问 Boss直聘、前程无忧等主流平台，去来源平台投递',
    to: '/jobs/online-platforms',
    available: true,
  },
  {
    key: 'offline',
    icon: MapPinIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '线下招聘机构',
    description: '查看附近线下人力资源机构，直接咨询求职机会',
    to: '/offline-agencies',
    available: true,
  },
]

interface QuickLink {
  key: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  to: string
  iconBg: string
  iconColor: string
}

const QUICK_LINKS: QuickLink[] = [
  {
    key: 'browse',
    icon: EyeIcon,
    title: '浏览记录',
    description: '查看已浏览的岗位',
    to: '/me/activity',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
  },
  {
    key: 'jump',
    icon: ExternalLinkIcon,
    title: '外部跳转记录',
    description: '查看已打开的来源平台',
    to: '/me/activity?tab=jump',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
  },
]

export function JobsServiceHubPage() {
  const navigate = useNavigate()

  return (
    <KioskPageFrame>
      <div className="flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="岗位信息"
          description="第三方来源岗位 · AI研判 · 线上平台入口，投递请前往来源平台"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        {/* AI能力提示横幅 */}
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-5 py-3">
          <span className="text-[20px] text-primary-700">✦</span>
          <span className="text-[18px] font-semibold text-primary-700">AI岗位研判</span>
          <span className="ml-auto text-[17px] text-neutral-500">
            AI分析岗位要求 · 匹配简历技能 · 给出求职建议
          </span>
        </div>

        {/* 7 能力卡（2 列等高网格） */}
        <div className="mt-6 grid grid-cols-2 gap-5">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => {
                  if (!cap.to) return
                  navigate(cap.to, cap.state ? { state: cap.state } : undefined)
                }}
                disabled={!cap.available && !cap.to}
                className={[
                  'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-6 text-left',
                  'border-t-4 shadow-sm active:scale-[0.99]',
                  cap.accentBorder,
                  !cap.available ? 'opacity-[0.62]' : 'cursor-pointer',
                ].join(' ')}
              >
                <div className="flex items-center gap-4">
                  <span
                    className={[
                      'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl',
                      cap.iconBg,
                    ].join(' ')}
                  >
                    <Icon
                      className={['h-[34px] w-[34px]', cap.iconColor].join(' ')}
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="font-serif text-[28px] font-bold tracking-wide text-neutral-900">
                    {cap.title}
                  </h3>
                  {!cap.available && (
                    <span className="whitespace-nowrap rounded-full border border-neutral-200 bg-canvas px-3 py-1 text-[15px] text-neutral-500">
                      {cap.unavailableBadge ?? '即将上线'}
                    </span>
                  )}
                </div>
                <p className="text-[18px] leading-relaxed text-neutral-500">{cap.description}</p>
                <div className="mt-auto flex items-center gap-2">
                  {cap.to ? (
                    <span
                      className={[
                        'flex items-center gap-2 text-[19px] font-semibold',
                        cap.goColor,
                      ].join(' ')}
                    >
                      {cap.available ? '进入' : '了解详情'}
                      <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="text-[19px] font-semibold text-neutral-400">暂不可用</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* 快捷入口 */}
        <div className="mt-6">
          <div className="mb-2 flex items-baseline gap-3">
            <b className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">
              我的浏览记录
            </b>
            <span className="text-[17px] text-neutral-500">登录后可查看历史</span>
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

        {/* 合规提示 */}
        <div className="mt-6 mb-6 flex items-start gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-3">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-wheat" aria-hidden="true" />
          <p className="text-[17px] leading-relaxed text-neutral-500">
            岗位信息均来自第三方 /
            官方来源，本终端仅提供信息展示；投递、预约请前往来源平台完成，本系统不参与招聘闭环，不收取求职者简历给企业。
          </p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
