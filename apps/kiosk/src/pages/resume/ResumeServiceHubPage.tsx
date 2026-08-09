// ============================================================
// ResumeServiceHubPage — AI简历服务中心（/resume-service）
//
// 视觉口径：Tailwind CSS token，与 PrintScanHomePage 风格对齐
// 布局：2 列固定竖屏网格，按钮 min-height ≥ 56px
//
// 功能：8 能力入口 + 3 快捷入口 + AI能力横幅 + 合规提示
// 合规：AI生成内容仅供参考，投递由用户本人确认
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import { ServiceReadinessStrip } from '../../components/ServiceReadinessStrip'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import {
  BookOpenIcon,
  BotIcon,
  BriefcaseIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  CompassIcon,
  FileSearchIcon,
  FileTextIcon,
  InfoIcon,
  PlusSquareIcon,
  PrinterIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TargetIcon,
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
  available: boolean
  unavailableBadge?: string
}

const CAPABILITIES: Capability[] = [
  {
    key: 'diagnose',
    icon: FileSearchIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: 'AI简历诊断',
    description: '上传PDF或图片简历，AI自动解析结构、识别问题，给出针对性改进建议',
    to: '/resume/source?intent=diagnose',
    available: true,
  },
  {
    key: 'optimize',
    icon: SparklesIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: 'AI简历优化',
    description: '输入目标岗位后，AI定向重写简历表达，提升岗位匹配度',
    to: '/resume/source?intent=optimize',
    available: true,
  },
  {
    key: 'generate',
    icon: PlusSquareIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '简历生成',
    description: '引导式填写基本信息，AI生成完整简历草稿，可下载打印',
    to: '/resume/generate',
    available: true,
  },
  {
    key: 'templates',
    icon: BookOpenIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '简历素材库',
    description: '浏览版式参考和求职材料模板，辅助自主编辑',
    to: '/resume/templates',
    available: true,
  },
  {
    key: 'career-plan',
    icon: CompassIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '职业规划',
    description: 'AI结合你的经历与目标，生成职业发展方向与行动建议',
    to: '/resume/career-plan',
    available: true,
  },
  {
    key: 'job-materials',
    icon: BriefcaseIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '求职材料',
    description: '整理求职附件清单，生成求职信、自我介绍等辅助材料',
    to: '/resume/materials',
    available: true,
  },
  {
    key: 'print',
    icon: PrinterIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '简历打印',
    description: '优化完成后直接在本机打印，走标准文档打印流程',
    to: '/print/upload?source=resume',
    available: true,
  },
  {
    key: 'job-fit',
    icon: TargetIcon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: '岗位匹配参考',
    description: 'AI分析简历与目标岗位的匹配度，给出差距与提升方向',
    to: '/resume/job-fit',
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
    key: 'resumes',
    icon: FileTextIcon,
    title: '我的简历',
    description: '查看已保存的简历文件',
    to: '/me/resumes',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
  },
  {
    key: 'ai-records',
    icon: BotIcon,
    title: 'AI服务记录',
    description: '查看历次AI诊断与优化',
    to: '/me/ai-records',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
  },
  {
    key: 'self-assessment',
    icon: ClipboardCheckIcon,
    title: '自我评估',
    description: '完成职业能力自我测评',
    to: '/resume/self-assessment/intro',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
  },
]

const contractReviewEnabled = import.meta.env.VITE_ENABLE_CONTRACT_REVIEW === 'true'

export function ResumeServiceHubPage() {
  const navigate = useNavigate()
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const apiBlocked = apiStatus !== 'ready'

  return (
    <KioskPageFrame>
      <div className="service-hub service-hub--resume flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="AI简历服务"
          description="AI诊断 · 优化 · 生成 · 打印，一条龙完成"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        <ServiceReadinessStrip status={apiStatus} onRetry={retryApi} />

        {/* 8 能力卡（2 列等高网格） */}
        <div className="service-hub__grid mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-5">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon
            const blocked = apiBlocked || (!cap.available && !cap.to)
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => {
                  if (blocked || !cap.to) return
                  navigate(cap.to, cap.state ? { state: cap.state } : undefined)
                }}
                disabled={blocked}
                className={[
                  'service-hub__card',
                  'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-4 text-left sm:p-6',
                  'border-t-4 shadow-sm active:scale-[0.99]',
                  cap.accentBorder,
                  blocked ? 'service-hub__card--blocked' : '',
                  !cap.available ? 'opacity-[0.62]' : 'cursor-pointer',
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
                  {!cap.available && (
                    <span className="whitespace-nowrap rounded-full border border-neutral-200 bg-canvas px-3 py-1 text-[15px] text-neutral-500">
                      {cap.unavailableBadge ?? '即将上线'}
                    </span>
                  )}
                </div>
                <p className="text-[15px] leading-relaxed text-neutral-500 sm:text-[18px]">
                  {cap.description}
                </p>
                <div className="mt-auto flex items-center gap-2">
                  {cap.to ? (
                    <span
                      className={[
                        'flex items-center gap-2 text-[16px] font-semibold sm:text-[19px]',
                        cap.goColor,
                      ].join(' ')}
                    >
                      {apiBlocked ? '等待服务' : cap.available ? '进入' : '了解详情'}
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

        {/* 签约与权益：与简历制作能力分组展示，不作为百宝箱或岗位入口重复投放。 */}
        {contractReviewEnabled && (
          <section className="mt-6" aria-labelledby="contract-risk-title">
            <div className="mb-2 flex items-baseline gap-3">
              <b id="contract-risk-title" className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">
                签约与权益
              </b>
              <span className="text-[17px] text-neutral-500">签约前自主核查，仅作风险提示</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!apiBlocked) navigate('/contract-review')
              }}
              disabled={apiBlocked}
              className={`flex min-h-28 w-full items-center gap-5 rounded-[var(--radius-lg)] border border-wheat/30 border-l-4 border-l-wheat bg-surface px-6 py-5 text-left shadow-sm active:scale-[0.99]${apiBlocked ? ' service-hub__quick--blocked' : ''}`}
            >
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-wheat-soft text-wheat">
                <ShieldCheckIcon className="h-8 w-8" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block font-serif text-[26px] font-bold tracking-wide text-neutral-900">
                  AI签约风险提示
                </b>
                <span className="mt-1 block text-[17px] leading-relaxed text-neutral-500">
                  上传劳动合同、实习协议或 Offer，核查试用期、薪酬、竞业等条款风险
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[18px] font-semibold text-wheat">
                {apiBlocked ? '等待服务' : '进入'}
                <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
              </span>
            </button>
          </section>
        )}

        {/* 快捷入口 */}
        <div className="service-hub__quick-section mt-6">
          <div className="mb-2 flex items-baseline gap-3">
            <b className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">
              我的简历服务
            </b>
            <span className="text-[17px] text-neutral-500">登录后可查看历史记录</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-[18px]">
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
        <div className="mt-6 mb-6 flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-3">
          <InfoIcon className="h-5 w-5 shrink-0 text-wheat" aria-hidden="true" />
          <p className="text-[17px] leading-relaxed text-neutral-500">
            AI生成内容仅供参考，不构成正式求职建议；简历最终投递由本人负责确认。
          </p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
