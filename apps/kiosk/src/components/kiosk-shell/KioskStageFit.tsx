import type { CSSProperties, ReactNode } from 'react'
import { useKioskStageFit } from '../../hooks/useKioskStageFit'

/**
 * 把一体机壳装进 1080×1920 舞台，按视口等比缩放居中。
 * 仅包裹 KioskRoot 布局路由；手机页 / 屏保路由在布局外，不会套此组件。
 */
export function KioskStageFit({ children }: { children: ReactNode }) {
  const { stageW, stageH, scale } = useKioskStageFit()

  const scalerStyle: CSSProperties = {
    width: stageW * scale,
    height: stageH * scale,
  }

  const stageStyle: CSSProperties = {
    width: stageW,
    height: stageH,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  }

  return (
    <div className="kiosk-stage-host" data-kiosk-stage-fit="on">
      <div className="kiosk-stage-scaler" style={scalerStyle}>
        <div className="kiosk-stage" style={stageStyle}>
          {children}
        </div>
      </div>
    </div>
  )
}
