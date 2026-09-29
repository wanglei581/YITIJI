/**
 * 公共终端空闲时长的唯一来源。
 * 首页、本人文档页上的「多久自动退出」都读这里，清场计时也读这里。
 */

export const DEFAULT_LOGOUT_IDLE_SEC = 180
export const DEFAULT_RESULT_IDLE_SEC = 90
export const DEFAULT_SESSION_WARNING_SEC = 30
/** 结果页（报告 / 优化 / 我的文档）的可见预警，含在总时长里，不另加。 */
export const RESULT_WARNING_SEC = 15

const MAX_BROWSER_TIMER_MS = 2_147_483_647
const MIN_TRIGGER_MS = 1_000

function configuredSeconds(raw: unknown, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** 普通页面：无操作到点退出。默认 180 秒，可用 VITE_KIOSK_LOGOUT_IDLE_SEC 覆盖。 */
export function resolveLogoutIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = configuredSeconds(raw, DEFAULT_LOGOUT_IDLE_SEC)
  return sec * 1000
}

/** 结果页：无操作到点退出。默认 90 秒，可用 VITE_KIOSK_RESULT_IDLE_SEC 覆盖。 */
export function resolveResultIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_RESULT_IDLE_SEC)
  const sec = configuredSeconds(raw, DEFAULT_RESULT_IDLE_SEC)
  return sec * 1000
}

export function resolveWarningWindow(
  totalMs: number,
  warningSec?: number,
): { triggerMs: number; warningMs: number } {
  const safeTotalMs =
    Number.isFinite(totalMs) && totalMs > 0 && totalMs <= MAX_BROWSER_TIMER_MS ? totalMs : 1
  const raw = warningSec !== undefined ? warningSec : Number(import.meta.env.VITE_KIOSK_SESSION_WARNING_SEC)
  const configuredMs = (Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_WARNING_SEC) * 1000
  const triggerMs = Math.min(safeTotalMs, Math.max(MIN_TRIGGER_MS, safeTotalMs - configuredMs))
  return { triggerMs, warningMs: Math.max(0, safeTotalMs - triggerMs) }
}

/** 把毫秒写成屏上那句时长。180 秒 →「3 分钟」，90 秒 →「1 分 30 秒」。 */
export function formatIdleDuration(totalMs: number): string {
  const totalSec = Math.max(1, Math.round(totalMs / 1000))
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  if (minutes <= 0) return `${seconds} 秒`
  if (seconds === 0) return `${minutes} 分钟`
  return `${minutes} 分 ${seconds} 秒`
}

export function publicIdleLogoutLabel(): string {
  return formatIdleDuration(resolveLogoutIdleMs())
}

export function resultIdleLogoutLabel(): string {
  return formatIdleDuration(resolveResultIdleMs())
}

/**
 * 首页「没有待继续的办理」下面那句。
 * 机器上已经干净（没登录、没选匿名继续、也没有这次使用留下的内容）才可以说看不到上一位。
 * 否则如实说：要点结束使用，否则要等这段无操作。
 */
export function homeStandbyNote(
  opts: { isLoggedIn: boolean; guestMode: boolean; hasSensitiveSession: boolean },
  logoutLabel: string,
): string {
  const clean = !opts.isLoggedIn && !opts.guestMode && !opts.hasSensitiveSession
  if (clean) return '从下面选一项重新开始，不会显示上一位使用者的资料'
  if (opts.isLoggedIn) {
    return `离开前请点结束使用，否则 ${logoutLabel} 无操作后才会自动退出。`
  }
  return `这台机器上还留着这次使用的内容，${logoutLabel} 无操作后才会自动退出。`
}

/** 已登录的「我的文档」底部说明。时长用结果页那一档，不借用首页的 3 分钟。 */
export function documentsLoggedInTruth(resultLabel: string): string {
  return `这里显示的是当前仍登录的账号的文档。离开前请到「我的」点结束使用，否则 ${resultLabel} 无操作后才会自动退出。`
}
