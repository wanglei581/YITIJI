// ============================================================
// PolicyServiceHubPage — 政策服务中心（/policy-service）
//
// 能力入口：就业政策 · 社保指南 · 档案/登记 · 补贴指引 · AI政策问答
// 合规：所有政策信息来自官方来源，仅做信息展示与材料指引，不承诺办理结果。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  BotIcon,
  ChevronRightIcon,
  CoinsIcon,
  FileTextIcon,
  FolderIcon,
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
    key: 'ai-qa',
    icon: BotIcon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: 'AI政策问答',
    description: '向AI顾问提问政策疑问，AI整合政策要点给出个性化解答',
    to: '/assistant',
    state: { topic: 'policy' },
  },
]

export function PolicyServiceHubPage() {
  const navigate = useNavigate()

  return (
    <KioskPageFrame>
      <div
        data-page="policy-service-hub"
        className="flex h-full flex-col overflow-y-auto bg-canvas"
      >
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
                onClick={() =>
                  navigate(cap.to, cap.state ? { state: cap.state } : undefined)
                }
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

        {/* 合规提示 */}
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-dashed border-wheat bg-wheat-soft/40 px-5 py-4">
          <AlertCircleIcon
            className="mt-0.5 h-5 w-5 shrink-0 text-wheat"
            aria-hidden="true"
          />
          <p className="text-[17px] leading-relaxed text-neutral-500">
            政策信息来源于官方发布，仅供参考；补贴类只做政策说明和材料指引（info-only），不承诺到账，不代办申请，正式办理请前往相关政府部门或官方渠道。
          </p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
