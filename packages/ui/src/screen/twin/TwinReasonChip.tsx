import { cn } from '../../lib/cn'
import { screenReasonCopy } from '../screenCopy'

/**
 * 数字的位置上放不下一整块说明时用的小标签（磁贴、定义行、步骤格）。
 *
 * 两种「没有数」必须一眼可分，文案与样式都从原因表来，不在调用处手写：
 *   取数失败（transient）—— 实线朱色，写「暂时取不到」，下次刷新可能就好；
 *   数据层缺口            —— 虚线陶色，写「未接入」「样本不足」等，刷新也不会有。
 * 完整的原因与说明放在悬停提示里。
 */
export function TwinReasonChip({ reason }: { reason: string }) {
  const copy = screenReasonCopy(reason)
  return (
    <span className={cn('twin-pend', copy.transient && 'is-failed')} title={`${copy.title}：${copy.detail}`}>
      {copy.short ?? copy.title}
    </span>
  )
}
