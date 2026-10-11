export type KeyboardAvoidMode = 'push' | 'shrink' | 'scroll' | 'off'
export interface Rect { top: number; bottom: number; left: number; right: number; height: number }
export interface FieldDescription {
  tag: string
  type?: string
  readOnly: boolean
  disabled: boolean
  pageKeyboard: boolean
}

export function parseKeyboardAvoidMode(value: unknown): KeyboardAvoidMode {
  return value === 'shrink' || value === 'scroll' || value === 'off' ? value : 'push'
}

export function classifyKeyboardField(field: FieldDescription): 'system' | 'page' | null {
  if (field.readOnly || field.disabled) return null
  if (field.tag.toLowerCase() !== 'textarea' &&
      (field.tag.toLowerCase() !== 'input' ||
       !['text', 'tel', 'email', 'search', 'url', 'number', 'password', ''].includes((field.type ?? '').toLowerCase()))) return null
  return field.pageKeyboard ? 'page' : 'system'
}

/** 没有键盘接口时的推断：键盘压矮了可视区，矮掉的那一截就是键盘高度（可视区被平移了多少与高度无关）。 */
export function inferKeyboardHeight(innerHeight: number, viewportHeight: number, editable: boolean): number {
  const height = innerHeight - viewportHeight
  return editable && Number.isFinite(height) && height > 120 ? Math.max(0, height) : 0
}

export function calculatePush(field: Rect, keyboard: Rect, scale: number): number {
  if (keyboard.height <= 0 || field.right <= keyboard.left || field.left >= keyboard.right || field.top >= keyboard.bottom) return 0
  return Math.min(keyboard.height, Math.max(0, field.bottom + 24 * scale - keyboard.top))
}

export function keyboardViewport(mode: KeyboardAvoidMode, original: { width: number; height: number }, baseline: { width: number; height: number }, height: number) {
  if (mode === 'off' || height <= 0) return original
  return { width: baseline.width, height: mode === 'shrink' ? Math.max(1, baseline.height - height) : baseline.height }
}
