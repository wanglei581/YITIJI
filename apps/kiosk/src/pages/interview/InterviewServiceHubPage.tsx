// ============================================================
// InterviewServiceHubPage — AI面试训练服务中心（/interview-service）
//
// 风格对齐 PrintScanHomePage.tsx：Tailwind CSS token + lucide-react
// 布局：2 列竖屏 cap-grid，能力卡 + 快捷入口 + 合规提示
//
// 合规：AI模拟面试仅供练习参考，不代表真实面试流程，评测结果不对外共享。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import { ServiceReadinessStrip } from '../../components/ServiceReadinessStrip'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import {
  BarChart2Icon,
  BotIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CompassIcon,
  InfoIcon,
  LightbulbIcon,
  MicIcon,
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
  badge?: string
  requiresApi?: boolean
}

const CAPABILITIES: Capability[] = [
  {
    key: 'setup',
    icon: MicIcon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: '开始模拟面试',
    description: '选择岗位类型和难度，进入AI模拟面试间，完成后即时出报告',
    to: '/interview/setup',
    badge: '立即开始',
  },
  {
    key: 'self-assess',
    icon: ClipboardCheckIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: '职业自我评估',
    description: '回答AI设计的问卷，获得个人优势、薄弱项与职业方向参考报告',
    to: '/resume/self-assessment/intro',
  },
  {
    key: 'career-plan',
    icon: CompassIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: '职业规划建议',
    description: '结合你的经历与目标，AI生成阶段性职业发展路径与行动建议',
    to: '/resume/career-plan',
  },
  {
    key: 'tips',
    icon: LightbulbIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '面试技巧',
    description: '常见面试问题解析、自我介绍模板、薪资谈判要点等实用技巧',
    to: '/interview/tips',
    requiresApi: false,
  },
  {
    key: 'history',
    icon: ClockIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '评估历史',
    description: '查看历次自我评估报告，追踪职业认知的成长变化',
    to: '/resume/self-assessment/history',
  },
  {
    key: 'salary',
    icon: BarChart2Icon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: '行业薪资参考',
    description: '问AI顾问了解目标岗位的市场薪资范围和谈薪技巧',
    to: '/assistant',
    // 不传 `state.topic`：`/assistant` 不读 location.state（认的是 `?intent=`，
    // 且取值须是 advisorScenes 的 skill id，'salary' 不是）。传了必被丢弃。
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
    key: 'ai-records',
    icon: BotIcon,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    title: 'AI服务记录',
    description: '查看历次AI服务调用记录',
    to: '/me/ai-records',
  },
  {
    key: 'training-reports',
    icon: BarChart2Icon,
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    title: '训练报告',
    description: '查看全部模拟面试报告',
    to: '/interview/reports',
  },
]

export function InterviewServiceHubPage() {
  const navigate = useNavigate()
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const apiBlocked = apiStatus !== 'ready'

  return (
    <KioskPageFrame>
      <div className="service-hub service-hub--interview flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="AI面试训练"
          description="模拟问答 · 自我评估 · 面试技巧 · 训练报告，仅供练习参考"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        <ServiceReadinessStrip status={apiStatus} onRetry={retryApi} />

        {/* 能力卡（2 列等高网格） */}
        <div className="service-hub__grid mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-5">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon
            const blocked = apiBlocked && cap.requiresApi !== false
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => {
                  if (!blocked) navigate(cap.to, cap.state ? { state: cap.state } : undefined)
                }}
                disabled={blocked}
                className={[
                  'service-hub__card',
                  'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-4 text-left sm:p-6',
                  'border-t-4 shadow-sm active:scale-[0.99]',
                  cap.accentBorder,
                  blocked ? 'service-hub__card--blocked' : 'cursor-pointer',
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
                  {cap.badge && !blocked && (
                    <span className="rounded-full bg-primary-600 px-3 py-1 text-[15px] font-semibold text-white whitespace-nowrap">
                      {cap.badge}
                    </span>
                  )}
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
                    {blocked ? '等待服务' : '进入'}
                    <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* 快捷入口 */}
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

        {/* 合规提示 */}
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-3">
          <InfoIcon className="h-5 w-5 shrink-0 text-wheat" aria-hidden="true" />
          <p className="text-[17px] leading-relaxed text-neutral-500">
            AI模拟面试内容仅供练习参考，不代表真实面试流程；评测结果不构成招聘意见，不对外共享。
          </p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
