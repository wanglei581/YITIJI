import { inferKeyboardHeight, keyboardViewport, parseKeyboardAvoidMode, type Rect } from './logic.ts'
import { isSystemField } from './dom.ts'

export interface VirtualKeyboard extends EventTarget {
  overlaysContent: boolean
  readonly boundingRect: DOMRectReadOnly
  hide(): void
  show(): void
}
export const KEYBOARD_VIEWPORT_EVENT = 'kiosk-system-keyboard:viewport'
/** 浏览器用例在页面加载前写 window.__kioskKeyboardAvoidMode 来切模式；正式环境没人写它，走构建时的环境变量。 */
export const keyboardMode = () => parseKeyboardAvoidMode(
  (globalThis as { __kioskKeyboardAvoidMode?: unknown }).__kioskKeyboardAvoidMode ?? import.meta.env.VITE_KIOSK_KEYBOARD_AVOID_MODE,
)
export const virtualKeyboard = () => (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard
let baseline: { width: number; height: number } | null = null
let engaged = false

export function readKeyboardRect(): Rect {
  const vk = virtualKeyboard()
  if (vk) {
    const rect = vk.boundingRect
    const top = Math.max(0, rect.top)
    const bottom = Math.min(window.innerHeight, rect.bottom)
    return { top, bottom, left: rect.left, right: rect.right, height: Math.max(0, bottom - top) }
  }
  const vv = window.visualViewport
  const height = vv ? inferKeyboardHeight(window.innerHeight, vv.height, vv.offsetTop, isSystemField(document.activeElement)) : 0
  return { top: window.innerHeight - height, bottom: window.innerHeight, left: 0, right: window.innerWidth, height }
}

/** 舞台与管理器读同一个实时结果；不依赖 resize 监听器先后顺序。 */
export function readKeyboardViewport(original: { width: number; height: number }, fluid: boolean) {
  const mode = keyboardMode()
  if (mode === 'off' || fluid) return original
  const rect = readKeyboardRect()
  const height = isSystemField(document.activeElement) ? rect.height : 0
  if (height <= 0) {
    // 回退接口 blur 时可视区可能尚未恢复，恢复前保留未遮挡的基准。
    if (engaged && baseline && !virtualKeyboard() && original.height < baseline.height - 120) return baseline
    baseline = original
    engaged = false
    return original
  }
  baseline ??= { width: window.innerWidth, height: window.innerHeight }
  engaged = true
  return keyboardViewport(mode, original, baseline, height)
}

export function resetKeyboardViewport(): void {
  baseline = null
  engaged = false
  window.dispatchEvent(new Event(KEYBOARD_VIEWPORT_EVENT))
}

export function needsKeyboardHostHeight(fluid: boolean): boolean {
  return !fluid && keyboardMode() !== 'off' && isSystemField(document.activeElement) && readKeyboardRect().height > 0
}
