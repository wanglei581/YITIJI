import { useEffect, useState } from 'react'
import { KEYBOARD_VIEWPORT_EVENT, readKeyboardViewport } from '../system-keyboard/viewport.ts'

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
    return readKeyboardViewport({ width: Math.round(vv.width), height: Math.round(vv.height) }, usesKioskFluidViewport(window.innerWidth, window.innerHeight))
  }
  return readKeyboardViewport({ width: window.innerWidth, height: window.innerHeight }, usesKioskFluidViewport(window.innerWidth, window.innerHeight))
}

/**
 * 手机流式视口：宽 ≤760，或宽 ≤960 的横屏。
 * 这些尺寸关掉 1080×1920 舞台，按真实宽度排。真机竖屏与电脑横屏都不走这里。
 */
export function isKioskCompactViewport(viewportW: number, viewportH: number): boolean {
  return viewportW <= 760 || (viewportW <= 960 && viewportW > viewportH)
}

/**
 * 流式视口只等于手机紧凑视口。
 * 横屏电脑（宽 >960 且宽大于高）一律走 1080×1920 舞台缩放，不再按窗口铺满。
 */
export function usesKioskFluidViewport(viewportW: number, viewportH: number): boolean {
  return isKioskCompactViewport(viewportW, viewportH)
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
    window.addEventListener(KEYBOARD_VIEWPORT_EVENT, update)
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener(KEYBOARD_VIEWPORT_EVENT, update)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
    }
  }, [])

  return fit
}
