// ============================================================
// PolicyServiceHubPage — 政策服务中心（/policy-service）
//
// 能力入口：就业政策 · 社保指南 · 档案/登记 · 补贴指引 · AI政策问答
// 合规：所有政策信息来自官方来源，仅做信息展示与材料指引，不承诺办理结果。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  BookmarkIcon,
  BotIcon,
  ChevronRightIcon,
  CoinsIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  InfoIcon,
  ShieldIcon,
} from 'lucide-react'

interface PolicyCapability {
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

const CAPABILITIES: PolicyCapability[] = [
  {
    key: 'employment',
    icon: FileTextIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: '就业政策',
    description: '就业补贴、灵活就业政策与官方口径，来自人力资源和社会保障部门',
    to: '/renshi?tab=policy',
  },
  {
    key: 'social-insurance',
    icon: ShieldIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: '社保指南',
    description: '参保流程、社保办事材料清单，含城镇职工和灵活就业人员险种说明',
    to: '/renshi?tab=social',
  },
  {
    key: 'archive',
    icon: FolderIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '档案 / 登记',
    description: '人事档案托管办理材料指引、毕业生就业登记流程与证明开具说明',
    to: '/renshi?tab=register',
  },
  {
    key: 'subsidy',
    icon: CoinsIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '补贴指引',
    description: '就业补贴、失业保险、创业扶持政策说明与官方办理入口',
    to: '/renshi?tab=subsidy',
  },
  {
    key: 'ai-assistant',
    icon: BotIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: 'AI政策助手',
    description: '提问政策疑问、补贴资格、办事材料，AI顾问给出个性化解答',
    to: '/assistant',
    state: { topic: 'policy' },
  },
  {
    key: 'policy-fav',
    icon: BookmarkIcon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: '政策收藏',
    description: '查看已收藏的政策文章与AI问答记录，方便随时回顾',
    to: '/me/ai-records',
    state: { type: 'policy' },
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
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    title: '浏览记录',
    description: '查看最近浏览的政策文章',
    to: '/me/activity',
  },
  {
    key: 'ai-records',
    icon: BotIcon,
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    title: 'AI政策问答记录',
    description: '查看历次AI政策问答记录',
    to: '/me/ai-records',
  },
]

export function PolicyServiceHubPage() {
  const navigate = useNavigate()

  return (
    <KioskPageFrame>
      <div className="flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="政策服务"
          description="就业政策 · 社保指南 · 档案登记 · AI智能匹配解读"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        {/* AI横幅 */}
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-5 py-4">
          <span className="text-[22px]">✦</span>
          <div>
            <b className="block text-[19px] font-bold text-primary-700">AI政策匹配</b>
            <p className="mt-0.5 text-[17px] leading-relaxed text-primary-600">
              AI解读政策要点，匹配你的情况，给出申请材料指引
            </p>
          </div>
        </div>

        {/* 能力卡片（2列） */}
        <div className="mt-6 grid grid-cols-2 gap-5">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => navigate(cap.to, cap.state ? { state: cap.state } : undefined)}
                className={[
                  'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-6 text-left',
                  'border-t-4 shadow-sm active:scale-[0.99]',
                  cap.accentBorder,
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
                </div>
                <p className="text-[18px] leading-relaxed text-neutral-500">{cap.description}</p>
                <div className="mt-auto flex items-center gap-2">
                  <span
                    className={[
                      'flex items-center gap-2 text-[19px] font-semibold',
                      cap.goColor,
                    ].join(' ')}
                  >
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
            <b className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">
              快捷入口
            </b>
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
        <div className="mt-6 mb-6 flex items-start gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-4">
          <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />
          <p className="text-[17px] leading-relaxed text-neutral-500">
            政策信息来源于官方发布，仅供参考；补贴类只做政策说明和材料指引（info-only），不承诺到账，不代办申请，正式办理请前往相关政府部门或官方渠道。
          </p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
