// 宿主 46 四条整屏 route 共用的舞台。缩放判据只有这一份。
import type { ReactNode } from 'react'
import { KioskStageFit } from '../../../components/kiosk-shell/KioskStageFit'
import { isKioskCompactViewport, useKioskStageFit, usesKioskFluidViewport } from '../../../hooks/useKioskStageFit'

/**
 * 舞台缩放开关：与 `KioskRoot` 用同一套 `usesKioskFluidViewport`。
 *
 * /resume/job-fit 是 KioskRoot 之外的整屏路由（fusion-w6 的 expectedFullScreen 钉着
 * depth=2），拿不到 KioskRoot 算好的结果，只能同口径再算一次。这一页必须自己挂舞台，
 * 否则横屏电脑会漏缩。
 *
 * 为什么手机要关：`KioskStageFit` 默认 enabled，会把整张 1080×1920 稿等比缩到可视区。
 * 一体机上 scale≈1 没问题，但 390×844 手机上 scale≈0.36 —— 返回键量出来只有 23px、
 * 主操作 35px，正文小到读不了，触控下限（48px）全线失守。只有手机关掉缩放，
 * 改走真实流式布局（窄屏样式在 job-fit-qx.css 的 .jfq-root 段，随本页作用域）。
 * 横屏电脑不再关缩放，和一体机一样走 1080×1920 舞台。
 *
 * 一体机竖屏（1080×1920）不是紧凑视口 → 仍然是原来的定高舞台，稿 46 不受影响。
 */
function useJobFitStage(): { enabled: boolean; layout: 'kiosk' | 'phone' | 'desktop' } {
  const { viewportW, viewportH } = useKioskStageFit()
  const isCompact = isKioskCompactViewport(viewportW, viewportH)
  const isFluid = usesKioskFluidViewport(viewportW, viewportH)
  if (!isFluid) return { enabled: true, layout: 'kiosk' }
  return { enabled: false, layout: isCompact ? 'phone' : 'desktop' }
}

/**
 * 三个视图（静态屏 / 结果 / 选岗）共用的舞台外壳。
 * 保留 KioskStageFit 的 host/scaler/stage DOM，只切 enabled —— 与 KioskRoot 同样的做法，
 * 避免旋转屏幕时整个布局根被替换。
 *
 * 导出给宿主 46 的另外两条整屏 route（/resume/job-fit/actions、/resume/career-plan）：
 * 它们同样在 KioskRoot 之外，缩放判据必须是同一份，不能各抄一遍。
 */
export function JobFitStage({ children }: { children: ReactNode }) {
  const { enabled, layout } = useJobFitStage()
  return (
    <KioskStageFit enabled={enabled}>
      <div className="jfq-root" data-jfq-layout={layout}>{children}</div>
    </KioskStageFit>
  )
}
