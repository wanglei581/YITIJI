import { classifyKeyboardField } from './logic.ts'

export type KeyboardField = HTMLInputElement | HTMLTextAreaElement
export function keyboardField(target: unknown): KeyboardField | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null
  return classifyKeyboardField({ tag: target.tagName, type: target instanceof HTMLInputElement ? target.type : undefined,
    readOnly: target.readOnly, disabled: target.disabled, pageKeyboard: usesPageKeyboard(target) }) ? target : null
}

/** 页面自带键盘的格子：打了约定标记，或页面自己声明了 inputmode="none"。 */
export function usesPageKeyboard(field: KeyboardField): boolean {
  return field.dataset.kioskKeyboard === 'page' || field.getAttribute('inputmode') === 'none'
}

export function isSystemField(target: unknown): target is KeyboardField {
  const field = keyboardField(target)
  return Boolean(field && !usesPageKeyboard(field))
}

export function prepareKeyboardField(field: KeyboardField): void {
  if (usesPageKeyboard(field)) {
    field.setAttribute('virtualkeyboardpolicy', 'manual')
    field.setAttribute('inputmode', 'none')
    return
  }
  for (const [name, value] of Object.entries({ autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })) {
    if (!field.hasAttribute(name)) field.setAttribute(name, value)
  }
}

/** 不给无键盘的舞台增加定位／层叠上下文。每次写入都带有精确的撤销操作。 */
export function pushLayer(layer: HTMLElement, amount: number): () => void {
  if (amount <= 0) return () => {}
  const previous = layer.style.getPropertyValue('translate')
  const priority = layer.style.getPropertyPriority('translate')
  const marker = layer.getAttribute('data-kiosk-keyboard-pushed')
  const hadStyle = layer.hasAttribute('style')
  layer.style.setProperty('translate', `0 -${amount}px`)
  layer.setAttribute('data-kiosk-keyboard-pushed', '')
  return () => {
    if (previous) layer.style.setProperty('translate', previous, priority)
    else layer.style.removeProperty('translate')
    if (marker === null) layer.removeAttribute('data-kiosk-keyboard-pushed')
    else layer.setAttribute('data-kiosk-keyboard-pushed', marker)
    if (!hadStyle && !layer.style.length) layer.removeAttribute('style')
  }
}

export function keyboardLayer(field: KeyboardField): HTMLElement | null {
  // Portal 弹窗先取 dialog；它可能在 body 下，不能上推背后的舞台。
  const dialog = field.closest<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog')
  if (dialog) return dialog
  const scaler = field.closest<HTMLElement>('[data-kiosk-stage-fit="on"] .kiosk-stage-scaler')
  if (scaler) return scaler
  // 没有语义 dialog 的 body portal：上推 body 的直接子层，不改 body 本身。
  let layer: HTMLElement = field
  while (layer.parentElement && layer.parentElement !== document.body) layer = layer.parentElement
  return layer.parentElement === document.body ? layer : null
}

export function nearestScroller(field: KeyboardField): HTMLElement | null {
  for (let parent = field.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}
