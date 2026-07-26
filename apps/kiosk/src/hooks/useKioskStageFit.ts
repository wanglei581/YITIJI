import { useEffect, useState } from 'react'

/** 一体机设计稿纸面（竖屏触控基准）。 */
export const KIOSK_STAGE_WIDTH = 1080
export const KIOSK_STAGE_HEIGHT = 1920

export interface KioskStageFit {
  stageW: number
  stageH: number
  /** 等比缩放：min(viewportW/1080, viewportH/1920)，下限避免 0。 */
  scale: number
  viewportW: number
  viewportH: number
}

function readViewportSize(): { width: number; height: number } {
  const vv = window.visualViewport
  if (vv && vv.width > 0 && vv.height > 0) {
    return { width: Math.round(vv.width), height: Math.round(vv.height) }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

function computeFit(width: number, height: number): KioskStageFit {
  const safeW = Math.max(1, width)
  const safeH = Math.max(1, height)
  const scale = Math.min(safeW / KIOSK_STAGE_WIDTH, safeH / KIOSK_STAGE_HEIGHT)
  return {
    stageW: KIOSK_STAGE_WIDTH,
    stageH: KIOSK_STAGE_HEIGHT,
    scale: Math.max(0.01, scale),
    viewportW: safeW,
    viewportH: safeH,
  }
}

/**
 * 将 1080×1920 设计稿舞台适配到当前窗口。
 * 一体机全屏竖屏时 scale≈1；电脑横屏时等比缩小并居中（letterbox）。
 */
export function useKioskStageFit(): KioskStageFit {
  const [fit, setFit] = useState<KioskStageFit>(() => {
    if (typeof window === 'undefined') {
      return {
        stageW: KIOSK_STAGE_WIDTH,
        stageH: KIOSK_STAGE_HEIGHT,
        scale: 1,
        viewportW: KIOSK_STAGE_WIDTH,
        viewportH: KIOSK_STAGE_HEIGHT,
      }
    }
    const { width, height } = readViewportSize()
    return computeFit(width, height)
  })

  useEffect(() => {
    const update = () => {
      const { width, height } = readViewportSize()
      setFit(computeFit(width, height))
    }

    update()
    window.addEventListener('resize', update)
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)

    return () => {
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
    }
  }, [])

  return fit
}
