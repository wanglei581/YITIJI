import type { CSSProperties, ReactNode } from 'react'
import { useKioskStageFit } from '../../hooks/useKioskStageFit'

/**
 * 把一体机壳装进 1080×1920 舞台，按视口等比缩放居中。
 * 仅包裹 KioskRoot 布局路由；手机首页保留同一 DOM，通过 enabled 关闭缩放。
 */
interface KioskStageFitProps {
  children: ReactNode
  enabled?: boolean
}

export function KioskStageFit({ children, enabled = true }: KioskStageFitProps) {
  const { stageW, stageH, scale } = useKioskStageFit()

  const scalerStyle: CSSProperties = {
    width: enabled ? stageW * scale : '100vw',
    height: enabled ? stageH * scale : '100dvh',
  }

  const stageStyle: CSSProperties = {
    width: enabled ? stageW : '100vw',
    height: enabled ? stageH : '100dvh',
    transform: enabled ? `scale(${scale})` : 'none',
    transformOrigin: 'top left',
  }

  return (
    <div className="kiosk-stage-host" data-kiosk-stage-fit={enabled ? 'on' : 'off'}>
      <div className="kiosk-stage-scaler" style={scalerStyle}>
        <div className="kiosk-stage" style={stageStyle}>
          {children}
        </div>
      </div>
    </div>
  )
}
