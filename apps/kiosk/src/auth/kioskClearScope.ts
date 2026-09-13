import { hasKioskSensitiveSession } from './kioskSensitiveSession'
import { revokeLiveScanSession } from '../pages/scan/scanSessionRevoke'
import {
  clearScanWorkbenchSession,
  readScanWorkbenchSession,
} from '../pages/scan/scanWorkbenchSession'

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

/**
 * 游客态 → 会员态那一刻，把**上一位游客留下的扫描**收掉。
 *
 * ## 为什么这一步必须存在
 *
 * `login()` 原本的规则是「只清别人的」：`current && current.id !== next.id` 才清场，
 * 理由写在那里 —— 游客中途登录视为同一人继续办理，打印材料仍在。对打印材料这条成立，
 * 对扫描不成立，差别在于**扫描件是上一位的身份证 / 简历原件，而且登记里还带着那一场的
 * `controlToken` 明文**：
 *
 *   上一位游客扫完走了（没按任何出口，所以本机登记还在，隐私空闲计时也还没到点）→
 *   下一位走上来，一碰屏幕就把空闲计时重置了 → 他去登录 → `current` 是 null，
 *   老规则一个字节都不清 → 他现在是「会员」，而本机登记里躺着上一位的扫描件与凭证。
 *
 * ## 为什么是 fail-closed，而不是找一个延续标记
 *
 * 「同一人继续办理」只有在**这条流程自己把人送去登录**时才说得过去 —— 那才是一个
 * 可信的延续信号。扫描流程今天没有这样的入口：结果页未登录时那颗「前往我的文档」
 * 是禁用的（文案写「本次不进入我的文档」），底栏与顶栏的任何一个出口都会先
 * `leaveScanFlow`（撤服务端任务 + 清本机登记）再走人。也就是说，一个真正在办事的
 * 游客走到 /login 的时候，他的扫描早就被他自己那一次离开清掉了 ——
 * **这条闸门对他是空操作，对「换了个人」才有效**。
 *
 * 既然没有可信的延续标记，就按 fail-closed 判：在接受新身份之前先收掉扫描。
 * 将来如果扫描流程真的长出「登录后存进我的文档」这类入口，正确做法是在那一次点击上
 * 立一个短时效的延续标记，让这里读它 —— 而不是把这条闸门去掉。
 *
 * ## 范围只到扫描
 *
 * 不碰打印材料 / AI 简历 / 面试工作台等其它敏感会话：那几条上面那句「游客中途登录
 * 视为同一人」的产品判断依然有效，本函数不越界去改它们。要整体清场的是
 * logout / 屏保 / 隐私空闲那三条既有边界，它们一条都没有被削弱。
 *
 * @returns 这一次是否**确实**收掉了一场还带着凭证或结果的扫描（供回归用例断言，
 *   不参与任何业务判断）。
 */
export function clearGuestScanBeforeMemberLogin(): boolean {
  let carriedScan = false
  try {
    const session = readScanWorkbenchSession()
    carriedScan = Boolean(session?.live || session?.result)
  } catch {
    // 读不出来就按「可能有」处理：下面照样撤照样清，判断出错不能让清场少做一次。
    carriedScan = true
  }
  // 顺序与 clearKioskSensitiveSession 一致：撤销要读本地登记里的 scanTaskId/controlToken，
  // 先清就再也找不到要撤谁。身份传 null —— 游客的任务在服务端 endUserId 就是 null，
  // 拿新登录这位的令牌去发只会被 403 顶回来，旧任务原地存活。
  revokeLiveScanSession(null)
  // 这一句同时把扫描生命周期代次推进一格：换人那一刻还在飞的创建响应回来时会自己作废，
  // 既不回写登记，也不把服务端任务留成孤儿（见 scanWorkbenchSession 的代次注释）。
  clearScanWorkbenchSession()
  return carriedScan
}
