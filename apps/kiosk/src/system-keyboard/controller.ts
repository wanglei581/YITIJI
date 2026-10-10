import { usesKioskFluidViewport } from '../hooks/useKioskStageFit'
import { calculatePush } from './logic.ts'
import { isSystemField, keyboardField, keyboardLayer, nearestScroller, prepareKeyboardField, pushLayer } from './dom.ts'
import { KEYBOARD_VIEWPORT_EVENT, keyboardMode, readKeyboardRect, readKeyboardViewport, resetKeyboardViewport, virtualKeyboard } from './viewport.ts'

export function dismissSystemKeyboard(): void {
  if (typeof window === 'undefined' || keyboardMode() === 'off' || usesKioskFluidViewport(window.innerWidth, window.innerHeight)) return
  const field = keyboardField(document.activeElement)
  field?.blur()
  try { virtualKeyboard()?.hide() } catch { /* 接口不可用不阻断清场。 */ }
  window.dispatchEvent(new Event(KEYBOARD_VIEWPORT_EVENT))
}

/** 页面上的「键盘」按钮用：让输入框得焦，并在接口存在时请求系统键盘弹出。 */
export function requestSystemKeyboard(field: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!field || field.disabled || field.readOnly) return
  field.focus({ preventScroll: true })
  if (typeof window === 'undefined' || keyboardMode() === 'off') return
  try { virtualKeyboard()?.show() } catch { /* 接口不可用时只得焦，由系统按自己的设置决定弹不弹。 */ }
}

export function startSystemKeyboard(isFluid: (width: number, height: number) => boolean): () => void {
  const mode = keyboardMode()
  if (mode === 'off') return () => {}
  let undoPush = () => {}
  let frame = 0
  let settleFrame = 0
  let originalOverlay: boolean | undefined
  const vk = virtualKeyboard()
  const vv = window.visualViewport
  const fluid = () => isFluid(window.innerWidth, window.innerHeight)
  const clearPush = () => { undoPush(); undoPush = () => {} }
  const syncOverlay = () => {
    if (!vk) return
    if (fluid()) {
      if (originalOverlay !== undefined) { vk.overlaysContent = originalOverlay; originalOverlay = undefined }
    } else if (originalOverlay === undefined) {
      originalOverlay = vk.overlaysContent
      vk.overlaysContent = true
    }
  }
  const avoid = () => {
    clearPush()
    if (fluid() || mode === 'shrink') return
    const field = document.activeElement
    if (!isSystemField(field)) return
    const keyboard = readKeyboardRect()
    const layer = keyboardLayer(field)
    if (!layer || keyboard.height <= 0) return
    const stage = field.closest<HTMLElement>('.kiosk-stage')
    const scale = stage ? stage.getBoundingClientRect().width / stage.offsetWidth : 1
    let amount = calculatePush(field.getBoundingClientRect(), keyboard, scale)
    if (amount <= 0) return
    const scroller = nearestScroller(field)
    if (scroller) {
      const scrollScale = scroller.getBoundingClientRect().height / scroller.offsetHeight || 1
      scroller.scrollTop += Math.max(0, field.getBoundingClientRect().bottom + 24 * scale - Math.min(keyboard.top, scroller.getBoundingClientRect().bottom)) / scrollScale
      amount = calculatePush(field.getBoundingClientRect(), keyboard, scale)
    }
    if (mode === 'push') {
      const parent = layer.parentElement
      const parentScale = parent && parent.offsetHeight ? parent.getBoundingClientRect().height / parent.offsetHeight : 1
      undoPush = pushLayer(layer, amount / (parentScale || 1))
    }
  }
  const update = () => {
    cancelAnimationFrame(frame)
    cancelAnimationFrame(settleFrame)
    clearPush()
    syncOverlay()
    const original = { width: Math.round(vv?.width || window.innerWidth), height: Math.round(vv?.height || window.innerHeight) }
    readKeyboardViewport(original, fluid())
    window.dispatchEvent(new Event(KEYBOARD_VIEWPORT_EVENT))
    // 等 React 舞台缩放提交后再量；无动画滚动后同步再量，不累加上一次上推。
    frame = requestAnimationFrame(() => { settleFrame = requestAnimationFrame(avoid) })
  }
  // 手指按下的那一刻焦点就会换（输入框失焦、按钮得焦）：这时若立刻把页面放回原位，按钮会从手指下滑走、这一下点不中。
  // 所以按着的时候先不动，等抬手、点击派发完再归位。
  let pressing = false
  let blurPending = false
  let releaseTimer = 0
  let stuckTimer = 0
  const released = () => {
    window.clearTimeout(stuckTimer)
    pressing = false
    if (!blurPending) return
    blurPending = false
    window.clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(update, 0)
  }
  // 抬手事件万一没收到（手指滑出屏幕边缘），5 秒后自己放开，免得页面一直停在上推位置。
  const pressed = () => {
    pressing = true
    window.clearTimeout(stuckTimer)
    stuckTimer = window.setTimeout(released, 5000)
  }
  const focus = () => {
    if (!fluid()) {
      const field = keyboardField(document.activeElement)
      if (field) prepareKeyboardField(field)
    }
    if (pressing) { blurPending = true; return }
    update()
  }
  const blurred = () => {
    if (pressing) { blurPending = true; return }
    clearPush()
    queueMicrotask(update)
  }
  const scrolled = () => {
    cancelAnimationFrame(settleFrame)
    settleFrame = requestAnimationFrame(avoid)
  }
  syncOverlay()
  focus()
  document.addEventListener('focusin', focus, true)
  document.addEventListener('focusout', blurred, true)
  document.addEventListener('scroll', scrolled, true)
  window.addEventListener('pointerdown', pressed, true)
  window.addEventListener('pointerup', released, true)
  window.addEventListener('pointercancel', released, true)
  window.addEventListener('resize', update)
  window.addEventListener(KEYBOARD_VIEWPORT_EVENT, scrolled)
  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  vk?.addEventListener('geometrychange', update)
  return () => {
    cancelAnimationFrame(frame)
    cancelAnimationFrame(settleFrame)
    clearPush()
    document.removeEventListener('focusin', focus, true)
    document.removeEventListener('focusout', blurred, true)
    document.removeEventListener('scroll', scrolled, true)
    window.removeEventListener('pointerdown', pressed, true)
    window.removeEventListener('pointerup', released, true)
    window.removeEventListener('pointercancel', released, true)
    window.clearTimeout(releaseTimer)
    window.clearTimeout(stuckTimer)
    window.removeEventListener('resize', update)
    window.removeEventListener(KEYBOARD_VIEWPORT_EVENT, scrolled)
    vv?.removeEventListener('resize', update)
    vv?.removeEventListener('scroll', update)
    vk?.removeEventListener('geometrychange', update)
    if (vk && originalOverlay !== undefined) vk.overlaysContent = originalOverlay
    resetKeyboardViewport()
  }
}
