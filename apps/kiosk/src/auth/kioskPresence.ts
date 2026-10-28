// ============================================================
// 「上一次有人点屏幕是什么时候」—— 给进个人资产页前的「还是你吗？」用（W-75）。
//
// 难点在于：进「我的」本身就要点一下屏幕。拿「现在距离上一次触碰」来判，
// 这一下永远是 0 秒，确认层永远不出来。所以记的是**这一下之前空了多久**：
//   · 触碰时，距离上一次触碰超过 SAME_TOUCH_MS 才算新的一下，记下它之前的空闲时长；
//     同一下连着触发的 touchstart / pointerdown / keydown 不重算。
//   · 进页时，如果最近一下触碰就在 ENTRY_TOUCH_MS 之内（就是点进来的那一下），
//     用那一下之前的空闲时长；否则（浏览器后退、程序跳转）用距今的时长。
//   · 从没见过触碰（刚加载）按「不知道」处理 = 很久，一律先问。
// 登录成功、答「是我，继续」都算本人刚确认过。
//
// 弹出了没回答，就一直是「待确认」（粘性标记，W-75 隐私加固）：
//   只看「进页之前空了多久」有个洞——确认层弹出后，下一位从别的出口走开（浏览器后退、问小青、
//   站内直达地址），隔几秒再点底部「我的」，进页前只空了几秒，旧判据不再问，直接进了上一位的「我的」。
//   所以确认层一弹出就记下「待确认」，之后不管空了多久、从哪条路进个人资产页，都先回到确认层，
//   直到：本人答「是我，继续」（markKioskPresenceConfirmed）、答「不是我」或这一场被清场而退出登录
//   （clearHandoverPending）、新的一位登录成功（同样走 markKioskPresenceConfirmed）。
//   这个标记只活在本次页面加载的内存里：不写 localStorage / sessionStorage / cookie / URL，
//   清场、整页重载都让它消失；重载后登录本来就没了，资产页只剩登录引导。
//
// 只记时间戳和这一个布尔，不记坐标、不记按了什么。本文件不引 React，单测直接跑。
// ============================================================
import { KIOSK_HANDOVER_CONFIRM_MS } from './kioskIdleTiming'

/** 同一次触碰连着触发的几个事件之间的最大间隔。 */
const SAME_TOUCH_MS = 1_000
/** 进页那一刻，最近一下触碰在这之内就当它是「点进来的那一下」。 */
const ENTRY_TOUCH_MS = 2_000
const TOUCH_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const

let lastTouchAt: number | null = null
let idleBeforeLastTouchMs = Number.POSITIVE_INFINITY
/** 「还是你吗？」已经弹出、还没回答。只在内存里。 */
let handoverPending = false

export function recordKioskTouch(at: number = Date.now()): void {
  if (lastTouchAt === null) idleBeforeLastTouchMs = Number.POSITIVE_INFINITY
  else if (at - lastTouchAt > SAME_TOUCH_MS) idleBeforeLastTouchMs = at - lastTouchAt
  lastTouchAt = at
}

/** 本人刚确认过（登录成功、答「是我，继续」）：同时解除「待确认」。 */
export function markKioskPresenceConfirmed(at: number = Date.now()): void {
  handoverPending = false
  lastTouchAt = at
  idleBeforeLastTouchMs = 0
}

/** 「还是你吗？」弹出了：在有人回答或这一场被清场之前，一直算待确认。 */
export function markHandoverPending(): void {
  handoverPending = true
}

/** 这一场被清场、退出登录：上一位走了，没有谁还需要被确认。 */
export function clearHandoverPending(): void {
  handoverPending = false
}

export function isHandoverPending(): boolean {
  return handoverPending
}

/** 进页之前这台机器空了多久（毫秒）。不知道就是无穷大。 */
export function idleBeforeEntryMs(now: number = Date.now()): number {
  if (lastTouchAt === null) return Number.POSITIVE_INFINITY
  const since = now - lastTouchAt
  return since <= ENTRY_TOUCH_MS ? idleBeforeLastTouchMs : since
}

export function needsHandoverConfirm(now: number = Date.now()): boolean {
  if (handoverPending) return true
  return idleBeforeEntryMs(now) > KIOSK_HANDOVER_CONFIRM_MS
}

/** 单测用：回到刚加载的状态。 */
export function resetKioskPresenceForTest(): void {
  lastTouchAt = null
  idleBeforeLastTouchMs = Number.POSITIVE_INFINITY
  handoverPending = false
}

let installed = false

/** 挂全局触碰监听（捕获阶段，页面里 stopPropagation 也拦不住）。只挂一次。 */
export function installKioskTouchTracker(target: Window): void {
  if (installed) return
  installed = true
  const onTouch = (): void => recordKioskTouch()
  for (const event of TOUCH_EVENTS) target.addEventListener(event, onTouch, { capture: true, passive: true })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  installKioskTouchTracker(window)
}
