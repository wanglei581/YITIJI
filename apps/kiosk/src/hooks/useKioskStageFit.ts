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
  /** 可见区被输入面板占用时保留原触控尺度，仅缩短内容可用高。 */
  inputOccluded?: boolean
  visibleHeight?: number
  visibleTop?: number
}

function readViewportSize(): { width: number; height: number } {
  const vv = window.visualViewport
  if (vv && vv.width > 0 && vv.height > 0) {
    return { width: Math.round(vv.width), height: Math.round(vv.height) }
  }
  return { width: window.innerWidth, height: window.innerHeight }
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

type KeyboardGeometry = EventTarget & { boundingRect?: { height?: number } }

function virtualKeyboard(): KeyboardGeometry | undefined {
  return (navigator as Navigator & { virtualKeyboard?: KeyboardGeometry }).virtualKeyboard
}

function hasNativeTextFocus(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el.getAttribute('inputmode') === 'none') return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(el.type)
  }
  return el.isContentEditable
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
    let baseline: { width: number; height: number; visualWidth: number; visualHeight: number } | null = null
    let keepingInputSize = false
    let focusFrame = 0
    const vv = window.visualViewport
    const keyboard = virtualKeyboard()
    const update = () => {
      const { width, height } = readViewportSize()
      const textFocus = hasNativeTextFocus()
      const currentBaseline = () => ({ width: window.innerWidth, height: window.innerHeight, visualWidth: width, visualHeight: Math.min(height, window.innerHeight) })
      if (!baseline && textFocus) baseline = currentBaseline()
      // 同宽可见区收缩 + 原布局视口不变，是明确的遮挡信号。
      // 布局视口也缩小时只有浏览器给出键盘几何才沿用输入前基线，不能猜普通窗口 resize。
      const unchangedWidth = baseline && Math.abs(window.innerWidth - baseline.width) <= 2 && Math.abs(width - baseline.visualWidth) <= 2
      const reducedHeight = baseline && baseline.visualHeight - height > 2
      const noPinch = !vv || Math.abs(vv.scale - 1) < 0.01
      const explicitOcclusion = baseline && (Math.abs(window.innerHeight - baseline.height) <= 2 || (keyboard?.boundingRect?.height ?? 0) > 0)
      if (baseline && (textFocus || keepingInputSize) && unchangedWidth && reducedHeight && noPinch && explicitOcclusion
        && !isKioskCompactViewport(baseline.width, baseline.height)) {
        const original = computeFit(baseline.width, baseline.height)
        keepingInputSize = true
        setFit({ ...original, stageH: Math.min(KIOSK_STAGE_HEIGHT, height / original.scale), inputOccluded: true,
          visibleHeight: height, visibleTop: Math.max(0, vv?.offsetTop ?? 0) })
        return
      }
      keepingInputSize = false
      if (!textFocus) baseline = null
      // 同宽的可见区动画不能反复下移基线；只有真实窗口/方向/缩放改变才重建。
      else if (!baseline || !unchangedWidth || !noPinch || !explicitOcclusion) baseline = currentBaseline()
      setFit(computeFit(width, height))
    }
    // 输入框之间切换、点击候选或按钮时，等焦点稳定后再判断；遮挡仍在时不骤然放大舞台。
    const onFocusChange = () => {
      window.cancelAnimationFrame(focusFrame)
      focusFrame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', update)
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    keyboard?.addEventListener('geometrychange', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', onFocusChange)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      keyboard?.removeEventListener('geometrychange', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', onFocusChange)
    }
  }, [])

  return fit
}
