// ============================================================
// 服务人次上报的接线：一个本页唯一的上报器 + 挂在 KioskPrivacyGuard 里的 hook。
//
// 逻辑都在 services/api/kioskSession.ts（纯函数，单测直接跑）；这里只做三件事：
//   1. 用终端身份请求（terminalProtectedFetch，含换票重试）把三种上报发出去；
//   2. 路由变化与触摸 / 按键喂给上报器；
//   3. 导出 endKioskVisit，给 KioskPrivacyGuard 的每一条清场路径调用。
//
// 演示模式（mock）与浏览器测试构建一律不发：那里没有真实终端，发出去只会撞测试的
// 「未处理请求」检查。本机还没拿到终端编号时也不发（直接丢，不排队、不缓存）。
// ============================================================
import { useEffect } from 'react'
import { API_BASE_URL, API_MODE } from '../services/api/client'
import {
  createKioskVisitReporter,
  type KioskVisitEndReason,
  type KioskVisitEndpoint,
} from '../services/api/kioskSession'
import { getTerminalId } from '../services/api/screensaver'
import { terminalProtectedFetch } from '../services/terminalAuth'
import { IS_E2E_BUILD } from '../utils/buildMode'

const REPORTING_ENABLED = API_MODE === 'http' && !IS_E2E_BUILD

function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function sendVisit(endpoint: KioskVisitEndpoint, body: Record<string, string>): Promise<number> {
  const terminalId = getTerminalId()
  // 没有终端身份：不算网络失败，不重试，直接丢。
  if (!terminalId) return -1
  const res = await terminalProtectedFetch(`${API_BASE_URL}/kiosk/session/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-terminal-id': terminalId },
    body: JSON.stringify(body),
    // 清场会整页重载：keepalive 让已经发出的 end 不随页面一起被掐断。
    keepalive: true,
  })
  return res.status
}

const reporter = createKioskVisitReporter(
  {
    send: sendVisit,
    now: () => Date.now(),
    uuid: uuidV4,
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  },
  REPORTING_ENABLED,
)

/** 清场时调用：结束当前使用周期。不抛错、不等待。 */
export function endKioskVisit(reason: KioskVisitEndReason): void {
  try {
    reporter.end(reason)
  } catch {
    // 上报绝不影响清场。
  }
}

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown']

/** 挂在 KioskPrivacyGuard 里：把路由与触摸喂给上报器。 */
export function useKioskSessionReporting(pathname: string): void {
  useEffect(() => {
    try {
      reporter.enterPath(pathname)
    } catch {
      // 同上：上报失败不影响页面。
    }
  }, [pathname])

  useEffect(() => {
    if (!REPORTING_ENABLED) return
    const onActivity = (): void => {
      try {
        reporter.noteActivity()
      } catch {
        // 同上。
      }
    }
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true, capture: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity, { capture: true }))
    }
  }, [])
}
