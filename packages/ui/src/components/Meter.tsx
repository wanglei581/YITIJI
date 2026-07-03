import { cn } from '../lib/cn'

export interface MeterProps {
  label: string
  /** 0–100；越界值会被钳制。 */
  percent: number
  /** 右侧数值文案（如 "12/14"、"38%"）。 */
  valueText: string
  /** 低位警示：量条改用暖色（碳粉/纸量不足等场景）。 */
  low?: boolean
  className?: string
}

/** 水平量条（墨青纸感规范：青玉渐变，低位转陶色）。 */
export function Meter({ label, percent, valueText, low = false, className }: MeterProps) {
  const width = Math.max(0, Math.min(100, percent))
  return (
    <div className={cn('flex items-center gap-3 text-[13px]', className)}>
      <span className="w-[76px] shrink-0 font-bold text-neutral-900">{label}</span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            low
              ? 'bg-gradient-to-r from-[#c9764a] to-[#9e5330]'
              : 'bg-gradient-to-r from-primary-600 to-primary-700',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-xs text-neutral-500">{valueText}</span>
    </div>
  )
}
