import { hasKioskSensitiveSession } from './kioskSensitiveSession'

/**
 * 「本次清场是不是一次空操作」的唯一判定点。
 *
 * 背景（现场反馈）：一体机整天摆在人才市场大厅。没人使用时它停在干净首页，
 * 却仍每隔一个 idle 周期弹出「还在使用吗？30 秒后自动退出」，倒计时结束后
 * 整页刷新回同一个干净首页——把一次什么都清不掉的空操作，包装成需要用户
 * 回答的隐私警告，并且无限循环。待机态和刚退出完毕的状态都会这样。
 *
 * 判定必须严格：只有当清场「确实什么都清不掉」时才算空操作。
 *   - 中性落地路由（首页 / 待机屏）：任何业务路由本身就是上一位用户的浏览痕迹，
 *     清场要把它连同 history 一起抹掉，不算空操作。
 *   - 未登录：登录态本身就是必须清的东西。
 *   - 非 guestMode：「已选择匿名继续使用」是上一位用户留下的可见状态。
 *   - 无任何敏感会话残留：hasKioskSensitiveSession 内部 fail-closed。
 *
 * 四条同时成立才返回 true。任一不成立，清场链路一律按原样执行——
 * 这条函数只能让清场「少做无用功」，不能让它「少清一次该清的」。
 */
const NEUTRAL_STANDBY_PATHS = new Set(['/', '/screensaver'])

export interface KioskClearScopeInput {
  pathname: string
  isLoggedIn: boolean
  guestMode: boolean
}

export function isKioskClearNoOp({
  pathname,
  isLoggedIn,
  guestMode,
}: KioskClearScopeInput): boolean {
  if (!NEUTRAL_STANDBY_PATHS.has(pathname)) return false
  if (isLoggedIn || guestMode) return false
  return !hasKioskSensitiveSession()
}
