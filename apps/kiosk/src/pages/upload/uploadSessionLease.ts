import { cancelUploadSession } from '../../services/api/uploadSessions'

/**
 * 上传码的租约。
 *
 * 同一页里切换来源会卸掉面板，但码还要留着，切回来继续用。
 * 只有离开这个页面，才作废还没收到文件的码。
 * 已经卸掉的实例不能作废屏上另一份实例正在显示的同一张码。
 */
export interface UploadSessionLease {
  sessionId: string
  uploadToken: string
  controlToken: string
  qrUrl: string
  expiresAt: string
  purpose: string
  pathname: string
}

interface Lease extends UploadSessionLease {
  holders: number
}

const leases = new Map<string, Lease>()
/** 已经作废过，或明确不再自动作废（用户取消、刷新换码、文件已到）。避免离页再删一次。 */
const finished = new Set<string>()
let currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
let watching = false

function pathnameNow(): string {
  return typeof window !== 'undefined' ? window.location.pathname : currentPath
}

/** 路由变了才扫一遍：没人显示、又不是这一页的码，作废一次。屏上还亮着的留给卸载清理。 */
export function syncUploadSessionPage(pathname: string): void {
  if (pathname === currentPath) return
  currentPath = pathname
  for (const lease of [...leases.values()]) {
    if (lease.holders > 0 || lease.pathname === pathname) continue
    const { sessionId, controlToken } = lease
    if (!beginUploadSessionCancel(sessionId)) continue
    void cancelUploadSession(sessionId, controlToken).catch(() => undefined)
  }
}

function watchHistory(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  const history = window.history
  const wrap = (name: 'pushState' | 'replaceState') => {
    const original = history[name].bind(history)
    history[name] = function (data: unknown, unused: string, url?: string | URL | null) {
      const result = original(data, unused, url)
      syncUploadSessionPage(window.location.pathname)
      return result
    }
  }
  wrap('pushState')
  wrap('replaceState')
  window.addEventListener('popstate', () => {
    syncUploadSessionPage(window.location.pathname)
  })
}

watchHistory()

export function claimUploadSession(session: UploadSessionLease): void {
  const existing = leases.get(session.sessionId)
  if (existing) {
    existing.holders += 1
    existing.pathname = session.pathname
    existing.purpose = session.purpose
    existing.uploadToken = session.uploadToken
    existing.controlToken = session.controlToken
    existing.qrUrl = session.qrUrl
    existing.expiresAt = session.expiresAt
    return
  }
  leases.set(session.sessionId, { ...session, holders: 1 })
}

export function releaseUploadSession(sessionId: string): void {
  const lease = leases.get(sessionId)
  if (!lease) return
  lease.holders = Math.max(0, lease.holders - 1)
}

export function isUploadSessionDisplayed(sessionId: string): boolean {
  return (leases.get(sessionId)?.holders ?? 0) > 0
}

/** 这一页上已经没人显示、但还没作废的码。领走时占住，避免两份面板各建一张。 */
export function takeParkedUploadSession(pathname: string, purpose: string): UploadSessionLease | null {
  for (const lease of leases.values()) {
    if (lease.holders !== 0 || finished.has(lease.sessionId)) continue
    if (lease.pathname !== pathname || lease.purpose !== purpose) continue
    lease.holders = 1
    return lease
  }
  return null
}

/** 服务端这场会话已经结束或刚被我们撤销。之后的卸载不要再发一次作废。 */
export function dropUploadSession(sessionId: string): void {
  finished.add(sessionId)
  leases.delete(sessionId)
}

/**
 * 返回 true 才可以发 DELETE。第二次（卸载和路由各走一遍）直接跳过。
 */
export function beginUploadSessionCancel(sessionId: string): boolean {
  leases.delete(sessionId)
  if (finished.has(sessionId)) return false
  finished.add(sessionId)
  return true
}

/**
 * 建码请求返回时，发起它的那份面板已经卸了。
 * 先记成「没人显示」。若这时屏上已经有人领走，或者还在同一页，就留着；离开页面才作废。
 */
export function settleUnmountedUploadSession(session: UploadSessionLease): void {
  if (finished.has(session.sessionId)) return
  if (!leases.has(session.sessionId)) {
    leases.set(session.sessionId, { ...session, holders: 0 })
  }
  const sessionId = session.sessionId
  queueMicrotask(() => {
    const lease = leases.get(sessionId)
    if (!lease || lease.holders > 0) return
    const pathNow = pathnameNow()
    if (lease.pathname === currentPath || lease.pathname === pathNow) return
    const { controlToken } = lease
    if (!beginUploadSessionCancel(sessionId)) return
    void cancelUploadSession(sessionId, controlToken).catch(() => undefined)
  })
}
