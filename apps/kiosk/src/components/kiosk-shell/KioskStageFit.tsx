import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { useKioskStageFit } from '../../hooks/useKioskStageFit'

/**
 * 把一体机壳装进 1080×1920 舞台，按视口等比缩放居中。
 * KioskRoot 包布局路由；KioskRoot 之外的整屏页各自挂一层。
 * 手机首页保留同一 DOM，通过 enabled 关闭缩放。
 */
interface KioskStageFitProps {
  children: ReactNode
  enabled?: boolean
}

const KioskRootStageContext = createContext(false)

/** 放在 KioskRoot 那一层舞台里面。后代再挂 KioskStageFit 时直接渲染子节点，避免缩两次。 */
export function KioskRootStageScope({ children }: { children: ReactNode }) {
  return <KioskRootStageContext.Provider value={true}>{children}</KioskRootStageContext.Provider>
}

export function KioskStageFit({ children, enabled = true }: KioskStageFitProps) {
  const insideRootStage = useContext(KioskRootStageContext)
  const { stageW, stageH, scale } = useKioskStageFit()
  if (insideRootStage) return children

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
