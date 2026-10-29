// ============================================================
// 首页「继续办理」的交接保护：上一位走开之后，这一块不许再把他的文件名留在屏上，
// 也不许再用他的令牌读 /me（隐私 P0，第六包取证 7.2 条）。
//
// 判据与进「我的」之前的「还是你吗？」是同一个：kioskPresence.needsHandoverConfirm()
// （进来之前这台机器空了超过 KIOSK_HANDOVER_CONFIRM_MS）。但它是**进页判据**，不是持续判据：
// 点进来的那一下之后 2 秒，它就从「空了很久」翻回「刚有人点过」。首页这一块一直挂在屏上，
// 光看判据，下一位碰一下屏、等 2 秒，上一位的文件名就会再画出来，令牌也会再带出去；
// 他去别的页再回首页，面板重新挂载，读到的也是「刚有人点过」。
// 所以这里把「判成要确认」记成**粘性**：记下之后，不管之后空了多久、碰了几下、去了哪一页，
// 都不再画、不再读，直到：
//   · 本人确认过（登录成功、在「还是你吗？」里答「是我，继续」）—— 见 presenceJustConfirmed；
//   · 换了一位登录（粘性只认记下它时那张令牌的指纹）；
//   · 整页重载（结束使用、答「不是我」、闲置到点都会重载，内存里的粘性随之没有）。
//
// 只存令牌的 32 位指纹这一个字符串，只在内存里：不写任何存储、不存令牌本身，也还原不出令牌。
// 本文件不引 React，单测直接跑；监听与计时由 ContinueHandoverGuard 挂。
//
// 第六包（PR #1505）在 kioskPresence 里加了自己的「待确认」粘性标记（markHandoverPending 等），
// 两包是兄弟，这一包不碰 auth/ 下的文件，所以首页这一块的粘性先自己带。
// 两包都合进去之后，可以把 presenceJustConfirmed 与这里的粘性并到那个标记上。
// ============================================================
import { idleBeforeEntryMs } from '../../auth/kioskPresence'

/** 被收起的那张令牌的指纹；没有收起为 null。 */
let heldFor: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * 令牌的 32 位指纹（FNV-1a）：只用来分辨「是不是同一次登录」，不是安全哈希。
 * 撞上的概率是 2^-32，撞了的后果只是新的一位也被收起（宁可多收）。
 */
export function tokenFingerprint(token: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function subscribeContinueHold(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function continueHeldFor(): string | null {
  return heldFor
}

/** 记下：这张令牌对应的那一位，首页「继续办理」不再画、不再读。重复记同一张没有副作用。 */
export function holdContinueFor(fingerprint: string): void {
  if (heldFor === fingerprint) return
  heldFor = fingerprint
  emit()
}

/** 本人确认过了：解除。 */
export function releaseContinueHold(): void {
  if (heldFor === null) return
  heldFor = null
  emit()
}

/**
 * 首页「继续办理」这一刻该不该收起。
 *   · 没登录（没有令牌指纹）：没有什么可收，由面板自己什么都不画；
 *   · 这张令牌已经被记成收起：收；
 *   · 否则就问「我的」闸用的那个判据，现在要不要确认。
 */
export function isContinueHeld(held: string | null, fingerprint: string | null, needsConfirm: boolean): boolean {
  if (fingerprint === null) return false
  return held === fingerprint || needsConfirm
}

/**
 * 本人刚被确认过（登录成功、在「还是你吗？」里答「是我，继续」）。
 *
 * kioskPresence 没有导出「刚确认过」：markKioskPresenceConfirmed 把「进页之前空了多久」记成恰好 0，
 * 而普通触碰只会把它记成「无穷大」（从没见过触碰）或「超过 1 秒的空档」，同一下连着触发的事件不重算。
 * 所以这个值恰好为 0，就只能是刚有人确认过，且之后还没有新的一下触碰。
 */
export function presenceJustConfirmed(now: number = Date.now()): boolean {
  return idleBeforeEntryMs(now) === 0
}

/**
 * 答「是我，继续」发生在「我的」的确认层里，那时首页没有挂着，看不到这件事；
 * 所以全局挂一个点击监听：每次点击收尾之后（确认的处理函数已经跑完）看一眼，刚确认过就解除。
 * 只有粘性在的时候才排这一眼。解除不立即读任何东西：首页面板下次挂载时自己再读。
 */
function onClickCapture(): void {
  if (heldFor === null) return
  window.setTimeout(() => {
    if (heldFor !== null && presenceJustConfirmed()) releaseContinueHold()
  }, 0)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('click', onClickCapture, { capture: true, passive: true })
}

/** 单测用：回到刚加载的状态。 */
export function resetContinueHoldForTest(): void {
  heldFor = null
  listeners.clear()
}
