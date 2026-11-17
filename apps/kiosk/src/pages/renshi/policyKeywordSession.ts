import { subscribeKioskSensitiveSessionClear } from '../../auth/kioskSensitiveSession'

/** 只留在这一次使用的内存里。不进网址、不进 sessionStorage，所以不会被当成「还有别的内容」。 */
let keyword = ''
const clearListeners = new Set<() => void>()

export function getPolicyKeyword(): string {
  return keyword
}

export function setPolicyKeyword(value: string): void {
  keyword = value
}

export function clearPolicyKeyword(): void {
  keyword = ''
  clearListeners.forEach((listener) => listener())
}

export function subscribePolicyKeywordClear(listener: () => void): () => void {
  clearListeners.add(listener)
  return () => { clearListeners.delete(listener) }
}

subscribeKioskSensitiveSessionClear(clearPolicyKeyword)
