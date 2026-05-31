import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 合规提示横幅。
 *
 * 三端通用,用于在页面顶部展示合规边界声明 / 数据来源声明 / 隐私保护说明。
 * 文案统一由 CLAUDE.md §2 / docs/compliance/* 管控,严禁出现"一键投递"等禁词。
 *
 * tone 取色规则:
 *  - warning  橙色:对求职者的"投递/预约请去外部平台"温和提示(Kiosk/20、Kiosk/21)
 *  - info     蓝色:严肃的合规边界声明(Admin/08 岗位信息源、Partner 工作台)
 *  - success  绿色:隐私保护承诺(简历上传页"分析完成后自动清理")
 */
const bannerVariants = cva(
  'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      tone: {
        warning: 'border-warning-bg/60 bg-warning-bg/60 text-warning-fg',
        info:    'border-info-bg/60    bg-info-bg/60    text-info-fg',
        success: 'border-success-bg/60 bg-success-bg/60 text-success-fg',
      },
    },
    defaultVariants: {
      tone: 'info',
    },
  },
)

const iconMap = {
  warning: AlertTriangle,
  info:    Info,
  success: ShieldCheck,
} as const

export interface ComplianceBannerProps extends VariantProps<typeof bannerVariants> {
  /** 横幅正文。建议引用 docs/compliance/* 里的标准文案,不要现编。 */
  children: ReactNode
  /** 可选标题(粗体,正文上方一行) */
  title?: string
  className?: string
}

export function ComplianceBanner({
  tone,
  title,
  children,
  className,
}: ComplianceBannerProps) {
  const Icon = iconMap[tone ?? 'info']
  return (
    <div
      role="note"
      aria-label={title ?? '合规提示'}
      className={cn(bannerVariants({ tone }), className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="font-semibold">{title}</div>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
