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
import { onServiceTripsCleared, readServiceTripSessionIds } from '../services/serviceTrip'
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

// 换人 / 401 登出 / 引导票换票直接清本机服务单时，把这些旧单关联的旧周期编号同步通知服务端收尾。
onServiceTripsCleared((sessionIds, clearReason) => {
  try {
    const endReason: KioskVisitEndReason = clearReason === 'login_handover' ? 'handover' : 'privacy_clear'
    reporter.endSessions(sessionIds, endReason)
  } catch {
    // 上报绝不影响清场或换人。
  }
})

/** 清场时调用：结束当前使用周期及重载保留的旧服务单关联周期。不抛错、不等待。 */
export function endKioskVisit(reason: KioskVisitEndReason): void {
  try {
    reporter.end(reason, readServiceTripSessionIds())
  } catch {
    // 上报绝不影响清场。
  }
}

/** 这一次使用周期的编号（clientSessionId）。服务单建单带它；清场后换新的，整页重载也会换。 */
export function currentKioskVisitId(): string {
  return reporter.snapshot().clientSessionId
}

/**
 * 建服务单之前调：服务端要求这一周期的 start 已经落库，否则回 400 SERVICE_SESSION_REQUIRED。
 * 页面的副作用先于守卫的副作用执行，直接打开付款屏时 start 可能还没发出，所以这里按当前路径补一次
 * （已经开始过的周期不会重复发），再等在飞的上报全部结束，最后返回周期编号。
 * 上报关着（演示模式、浏览器测试构建）时不发请求，照样返回编号。不抛错。
 */
export async function kioskVisitReadyForCharge(pathname: string): Promise<string> {
  try {
    reporter.enterPath(pathname)
  } catch {
    // 上报失败不拦建单：建单会回 SERVICE_SESSION_REQUIRED，由调用方稍等再试一次。
  }
  try {
    await reporter.settle()
  } catch {
    // 同上。
  }
  return reporter.snapshot().clientSessionId
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
