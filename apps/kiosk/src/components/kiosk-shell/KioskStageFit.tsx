import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
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
  const { stageW, stageH, scale, inputOccluded, visibleHeight, visibleTop } = useKioskStageFit()
  const hostRef = useRef<HTMLDivElement>(null)
  const avoidInputOcclusion = enabled && !insideRootStage && Boolean(inputOccluded)
  useLayoutEffect(() => {
    if (!avoidInputOcclusion) return
    let frame = 0
    const revealInput = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const active = document.activeElement
        const host = hostRef.current
        if (!(active instanceof HTMLElement) || !host?.contains(active)) return
        const hostBox = host.getBoundingClientRect()
        let top = hostBox.top
        let bottom = hostBox.bottom
        for (let parent = active.parentElement; parent && parent !== host; parent = parent.parentElement) {
          if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue
          const box = parent.getBoundingClientRect()
          top = Math.max(top, box.top + parent.clientTop)
          bottom = Math.min(bottom, box.bottom - parent.clientTop)
        }
        // 标签能一起放下时一起滚入，避免只看见输入框却不知道在填什么。
        const label = active.closest('label')
        const target = label && label.getBoundingClientRect().height <= bottom - top ? label : active
        const box = target.getBoundingClientRect()
        if (box.top < top || box.bottom > bottom) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
        }
      })
    }
    revealInput()
    document.addEventListener('focusin', revealInput)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('focusin', revealInput)
    }
  }, [avoidInputOcclusion, stageH])
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
    <div ref={hostRef} className="kiosk-stage-host" data-kiosk-stage-fit={enabled ? 'on' : 'off'}
      data-kiosk-input-occluded={avoidInputOcclusion ? 'true' : undefined}
      style={avoidInputOcclusion ? { height: visibleHeight, top: visibleTop } : undefined}>
      <div className="kiosk-stage-scaler" style={scalerStyle}>
        <div className="kiosk-stage" style={stageStyle}>
          {children}
        </div>
      </div>
    </div>
  )
}
