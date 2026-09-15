import { getCancellationCredentials } from './scanSettingsModel'
import {
  requestConfirmedScanRevoke,
  revokeCreatedScanSession,
  sendUnloadRevokeBeacon,
  type ScanRevokeVerdict,
} from './scanSessionRevoke'
import { readScanWorkbenchSession } from './scanWorkbenchSession'

/**
 * 清场收尾闸：**在服务端确认这台机器不可能再把文件投给上一位之前，不许换人**。
 *
 * ## 它修的是哪一个缺陷（2026-09-15，P1）
 *
 * 清场（隐私空闲 / 屏保 / 退出 / 换人）此前是这么走的：
 *
 *   `clearKioskSensitiveSession()` 发一次 fire-and-forget 的 keepalive DELETE
 *   → 同步抹掉本机所有敏感会话 → `logout()` → 一帧之后 `window.location.reload()`。
 *
 * 三件事一撞就漏：
 *   ① 那次 DELETE 在路上丢了。回执一律吞掉，本机永远不会知道；
 *   ② 离开那一刻还在飞的那次**投递确认（ACK）成功了**；
 *   ③ 重载把「ACK 回来之后补一次撤销」那段补偿代码连同执行环境一起干掉。
 *
 * 于是服务端留下一条 `deliveryAckedAt` 非空、状态仍是 waiting 的任务：60 秒未确认
 * 回收器收不到它（它已确认），Agent 的 current-lease 看得见它
 * （`deliveryAckedAt: { not: null }`）。它一直可投递到自然过期 —— 下一位走到面板前
 * 按下扫描，文件投给已经走掉的上一位。这是跨用户串件，也是这条闸要堵的口子。
 *
 * ## 这条闸怎么改判据
 *
 * **本地清场照旧同步、立即、不等网络** —— 屏幕上那一位的 PII 一个字节都不多留。
 * 变的是后半段：整页重载 / 进屏保这类「把机器交给下一位」的动作，必须等到
 * 这一条成立才允许发生：
 *
 *   服务端**亲口**确认那条任务已经不可能再被领走（取消 / 不存在 / 已终态），
 *   或者它已经走到服务端给的那个自然过期时刻。
 *
 * 两者都是服务端的事实，不是本机的猜测。拿不到就一直停在诚实的清场屏上重试 ——
 * 不假装清完了，也不让下一位开始扫描。
 *
 * ## 两个方向的竞态都靠服务端自己排
 *
 * 本机只保证「DELETE 一直发到拿回确认为止」，顺序交给服务端：
 *   · DELETE 先到 —— 任务变 cancelled，随后那次 ACK 撞上
 *     `status !== 'waiting' && !== 'matched'` 的判断，拿回 409
 *     `SCAN_TASK_ACK_NOT_ALLOWED`（scan-tasks.service.ts 的 `ack()`）；
 *   · ACK 先到 —— 任务变成可投递，但本机的重试还没停，下一发 DELETE 照样把它撤掉，
 *     并且这一次是**拿到回执**才算数的。
 * 也就是说，两种顺序都收敛到同一个终点，而这条闸的职责只是「在收敛之前别换人」。
 *
 * ## 为什么等得起
 *
 * 常见路径上根本不用等：没有扫描会话时这里一开始就是 settled（一帧都不多）；
 * 有会话时一次 DELETE 的往返通常是几十毫秒。真正会停住的只有「网络坏了」，
 * 而那种时候下一位本来也做不了任何事 —— 停在一块写清楚了状态、给了重试按钮、
 * 并且带着倒计时的屏幕上，比把一个还能收下一位文件的收件箱留给他要好。
 */

/** 退避表：第一次立刻发，随后按这张表等。到头之后按 {@link RETRY_STEADY_MS} 稳定重试。 */
const RETRY_DELAYS_MS: readonly number[] = [0, 800, 1600, 3200, 6400]
/** 退避到头之后的稳定重试间隔。取 10 秒是为了在「等自然过期」的十分钟里不刷请求。 */
const RETRY_STEADY_MS = 10_000

/**
 * 「创建还在飞」时最多多等多久，然后放行换人。
 *
 * 这一条**不是**拍脑袋的超时，它背后有一条服务端事实：`getScanDeliveryLease()`
 * 只签 `deliveryAckedAt: { not: null }` 的行，而一次本机从未拿到响应的创建，
 * 本机连它的 id 都不知道，也就**永远不会去确认它** —— 它对 Agent 自始至终不可见，
 * 60 秒后还会被未确认回收器收成 expired（scan-task-reaper.task.ts）。
 *
 * 所以这一段等待要买的不是安全，而是**干净**：响应大多数时候一两秒内就回来了，
 * 等一下就能拿着凭证把它真撤掉，而不是留一条要等回收器的孤儿。等不到就放行，
 * 屏幕上也不会因此说一句「已经撤掉」—— 那一句本机说不出口。
 */
const CREATE_SETTLE_HOLD_MS = 8_000

/** 一次尝试之后本机能如实说出口的那几种状态。刻意不含服务端原文与任何凭证。 */
export type ScanCleanupOutcome = 'none' | 'unreachable' | 'server-error' | 'rejected'

export interface ScanCleanupStatus {
  /** 这一轮收尾还开着。false 时下面几项没有意义。 */
  open: boolean
  /** 还在等服务端确认的任务数。 */
  pending: number
  /** 还在飞、本机还不知道 id 的创建数。 */
  creating: number
  /** 这一轮累计发出过几次「等回话」的撤销。只用于屏幕上那句进度，不参与判断。 */
  attempts: number
  /** 服务端给的自然过期时刻（毫秒）。null = 本机不知道（迟到创建那一支）。 */
  deadlineAt: number | null
  /** 上一次尝试的结论（已收敛成四种，绝不含服务端原文）。 */
  lastOutcome: ScanCleanupOutcome
  /** true = 还不能把机器交给下一位。 */
  holding: boolean
}

interface PendingTask {
  scanTaskId: string
  controlToken: string
  /** 发起这一场的那个会员令牌快照。**只活在这里的内存里**，不落存储、不进 URL。 */
  identityToken: string | null
  /**
   * 服务端给的自然过期时刻（毫秒）。**非空是进 pending 的前提**（见 {@link track}）。
   *
   * 它是「按住换人」这件事唯一的收敛依据：要么服务端确认撤掉了，要么走到这一刻之后
   * 租约查询（`expiresAt: { gt: now }`）再也签不出它。两条都是确定的终点，所以按住
   * 是一段有限的等待，不是一块永远不放行的黑屏。
   */
  expiresAt: number
  attempts: number
  /** 403 之后是否已经试过「只凭 controlToken」那条服务端留的路（只试一次）。 */
  identityDropped: boolean
}

/**
 * 清场轮次。每开一轮 +1，**只增不减**。
 *
 * 它回答的是迟到的创建响应那个问题：「我属于的那一轮，中间有没有被清过场」。
 * 用一个布尔答不了 —— 布尔会在收尾结束时落回 false，而那一刻迟到的响应恰恰最需要
 * 被判成孤儿。
 */
let cleanupEpoch = 0
/** 这一轮收尾还开着没有。收完落回 false，下一次创建重放才不会被上一轮误伤。 */
let roundOpen = false
let attempts = 0
let lastOutcome: ScanCleanupOutcome = 'none'
let timer: number | undefined
let inFlight = false
let creating = 0
let creationHoldUntil = 0
const pending = new Map<string, PendingTask>()
/** 已经拿到确定结论的任务 id：同一条不再重复入队（迟到的创建响应会撞上这里）。 */
const settledIds = new Set<string>()
const listeners = new Set<() => void>()
let unloadHooked = false

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // 一个订阅者抛错不能让其余订阅者收不到通知，更不能把收尾循环带崩。
    }
  }
}

export function subscribeScanCleanup(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function holding(): boolean {
  if (!roundOpen) return false
  // pending 里每一条都自带服务端给的截止时刻（{@link track} 的前提），所以有货就按住。
  if (pending.size > 0) return true
  return creating > 0 && Date.now() < creationHoldUntil
}

/** 收尾走到确定结论：关掉这一轮，让下一位的创建 / 重放不再被上一轮的判据挡住。 */
function closeRoundIfSettled(): void {
  if (!roundOpen || holding()) return
  roundOpen = false
  attempts = 0
  lastOutcome = 'none'
  creationHoldUntil = 0
}

export function scanCleanupStatus(): ScanCleanupStatus {
  let deadlineAt: number | null = null
  for (const task of pending.values()) {
    deadlineAt = deadlineAt === null ? task.expiresAt : Math.max(deadlineAt, task.expiresAt)
  }
  return {
    open: roundOpen,
    pending: pending.size,
    creating,
    attempts,
    deadlineAt,
    lastOutcome,
    holding: holding(),
  }
}

/**
 * 「这台机器还没收完上一场的尾」。
 *
 * 三处用它，都是 fail-closed：
 *   · 清场链路 —— 拿它决定整页重载 / 进屏保要不要再等一会儿；
 *   · 设置页 —— 拿它挡住下一位的新建会话。挡的理由不是洁癖：上一条任务可能仍是
 *     「已确认 + waiting」，而 `getScanDeliveryLease()` 取的是该终端**第一条**符合条件
 *     的 waiting 行 —— 下一位在面板上扫出来的文件会落到上一位那条上去；
 *   · 投递确认 —— 收尾期间一次 ACK 都不许发，见 {@link scanDeliveryAckBlocked}。
 */
export function scanCleanupHolding(): boolean {
  return holding()
}

/**
 * 这一轮清场收尾还开着。
 *
 * 和 {@link scanCleanupHolding} 的差别只在「等创建回话」那一小段：那时 pending 是空的，
 * 但这一轮还没收完。创建重放拿它当收手判据 —— 清过场之后再把 child 领回来已经没有
 * 意义（没人会用它），只会让清场屏多等一整个退避窗口。
 */
export function scanCleanupInProgress(): boolean {
  return roundOpen
}

/**
 * 收尾期间**一次投递确认都不许发**。
 *
 * 判据是「还在收尾」而不是「清过场」：收完之后下一位建的新会话当然要确认得了。
 * 收尾期间那一条没有例外 —— ACK 成功就等于把一个没人看着的收件箱变成可投递的，
 * 而这一整条闸的全部目的就是消灭它。
 */
export function scanDeliveryAckBlocked(): boolean {
  return holding()
}

function isNotLeasableByTime(task: PendingTask): boolean {
  // 服务端的租约查询带 `expiresAt: { gt: now }`：过了这个时刻，这条任务无论确认过
  // 没有都签不出租约了。这是服务端给的事实，不是本机给自己的宽限。
  return Date.now() >= task.expiresAt
}

function outcomeOf(verdict: ScanRevokeVerdict): ScanCleanupOutcome {
  if (verdict.confirmed) return 'none'
  if (verdict.reason === 'unreachable') return 'unreachable'
  if (verdict.reason === 'forbidden') return 'rejected'
  return 'server-error'
}

function settleTask(task: PendingTask): void {
  pending.delete(task.scanTaskId)
  settledIds.add(task.scanTaskId)
}

function hookUnloadFallback(): void {
  if (unloadHooked || typeof window === 'undefined') return
  unloadHooked = true
  // 文档真的要走了（浏览器被关、机器被拔电）：没有界面能再等回执，
  // keepalive 是唯一还有机会送达的形式。见 sendUnloadRevokeBeacon 的注释。
  window.addEventListener('pagehide', () => {
    for (const task of pending.values()) {
      sendUnloadRevokeBeacon(task, task.identityToken)
    }
  })
}

async function attemptOnce(task: PendingTask): Promise<void> {
  task.attempts += 1
  attempts += 1
  let verdict = await requestConfirmedScanRevoke(task, task.identityToken)
  if (!verdict.confirmed && verdict.reason === 'forbidden' && !task.identityDropped) {
    /* 403 = 本机手里这份身份动不了那条任务（换人、令牌已失效都会这样）。
     * 服务端 `cancel()` 对 `endUserId === null` 的调用方只校验 controlToken，
     * 那是它刻意为「登出之后仍要撤得掉」留的路，所以把身份摘掉再试一次是合法调用。
     * 只试一次：再拒就是凭据本身对不上，重发多少遍都一样。 */
    task.identityDropped = true
    task.identityToken = null
    attempts += 1
    verdict = await requestConfirmedScanRevoke(task, null)
  }
  if (verdict.confirmed) {
    settleTask(task)
    lastOutcome = 'none'
    return
  }
  lastOutcome = outcomeOf(verdict)
}

function nextDelayMs(): number {
  let minAttempts = Number.POSITIVE_INFINITY
  for (const task of pending.values()) minAttempts = Math.min(minAttempts, task.attempts)
  if (!Number.isFinite(minAttempts)) return RETRY_STEADY_MS
  return RETRY_DELAYS_MS[minAttempts] ?? RETRY_STEADY_MS
}

function schedule(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
  if (!holding()) return
  if (pending.size === 0) {
    // 只剩「等创建回话」：到点再评估一次，那一刻 holding() 自己会变 false。
    timer = window.setTimeout(pump, Math.max(50, creationHoldUntil - Date.now()))
    return
  }
  timer = window.setTimeout(pump, nextDelayMs())
}

function pump(): void {
  timer = undefined
  if (inFlight) return
  if (!holding()) {
    closeRoundIfSettled()
    notify()
    return
  }
  inFlight = true
  void (async () => {
    try {
      for (const task of [...pending.values()]) {
        if (isNotLeasableByTime(task)) {
          // 自然过期：服务端此后签不出它的租约。这是确定的收口，不是放弃。
          settleTask(task)
          continue
        }
        await attemptOnce(task)
      }
    } finally {
      inFlight = false
      closeRoundIfSettled()
      schedule()
      notify()
    }
  })()
}

/**
 * 把一条要撤的任务交给这条闸。
 *
 * `expiresAt` 为 null 是唯一的岔路，它只可能来自一份**半残的创建响应**：
 * 凭证齐全、却连有效期都没带。本机因此拿不出任何收敛依据 —— 按住就是一块永远不放行
 * 的黑屏，那比它要防的问题更糟。所以这一条退回原来那条尽力而为的通道：发一次
 * keepalive DELETE 就此了结，不按住、不重试。
 *
 * 退回去是安全的，理由不是「概率低」：凭据没能落进本机登记，本页就**永远不会确认它**，
 * 而 `getScanDeliveryLease()` 只签 `deliveryAckedAt: { not: null }` 的行 ——
 * 未确认的 waiting 对 Agent 自始至终不可见，60 秒后还会被未确认回收器收成 expired。
 */
function track(
  credentials: { scanTaskId: string; controlToken: string },
  identityToken: string | null,
  expiresAt: number | null,
): void {
  const { scanTaskId, controlToken } = credentials
  if (settledIds.has(scanTaskId) || pending.has(scanTaskId)) return
  if (expiresAt === null) {
    settledIds.add(scanTaskId)
    revokeCreatedScanSession({ scanTaskId, controlToken }, identityToken)
    return
  }
  pending.set(scanTaskId, {
    scanTaskId,
    controlToken,
    identityToken,
    expiresAt,
    attempts: 0,
    identityDropped: false,
  })
  hookUnloadFallback()
}

function parseExpiry(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 开始一次清场收尾。**必须在抹掉本机扫描登记之前调用** —— 要撤谁、凭什么撤，
 * 全写在那份登记里，先抹就再也找不到了。
 *
 * 只登记「可能已经取得投递授权」的那一场：本机登记里有 live、还没有结果快照
 * （有结果 = 服务端已经给过终态）、且还没过服务端给的有效期。
 * 本机说不出它当初确认过没有 —— 所以按 fail-closed 一律当成确认过。
 *
 * @param outgoingMemberToken 正在失效的那个会员令牌（游客 / 未登录为 null）。
 *   只在内存里传给撤销请求，不落存储、不进 URL、不进 history、不进日志。
 */
export function beginScanSessionCleanup(outgoingMemberToken: string | null | undefined): void {
  cleanupEpoch += 1
  roundOpen = true
  hookUnloadFallback()
  try {
    const session = readScanWorkbenchSession()
    const live = session?.live
    if (live && session?.result === undefined) {
      const expiresAt = parseExpiry(live.expiresAt)
      // 已经过了服务端给的有效期：租约查询带 `expiresAt: { gt: now }`，签不出来了。
      // （登记里的 live 必然带得出可解析的 expiresAt —— parseLive 不收别的。）
      if (expiresAt === null || expiresAt > Date.now()) {
        track(live, outgoingMemberToken ?? null, expiresAt)
      }
    }
  } catch {
    /* 读不出登记：没有 id 也没有凭证，本机撤不了任何东西。这里不假装收过尾，
     * 但也确实没有可发的请求 —— 交给服务端那两条回收器（未确认 60 秒、过期即收）。 */
  }
  /* 创建还在飞时，等待从**清场这一刻**起算，不是从创建那一刻。
   * 不重置的话，一次已经重放了十几秒的创建会让这一段等待当场就是过期的 ——
   * 闸一帧都不等，凭证到手时早已重载完毕，那条 child 只能留给回收器。 */
  if (creating > 0) creationHoldUntil = Date.now() + CREATE_SETTLE_HOLD_MS
  if (pending.size > 0) {
    pump()
  } else {
    // schedule() 这一句不能省：只剩「等创建回话」时它是唯一会把等待叫醒的定时器，
    // 少了它，一次永远不回话的创建会把机器锁死在清场屏上。
    schedule()
    closeRoundIfSettled()
  }
  notify()
}

/**
 * 把一次**还在飞的创建**交给这条闸看着。每一次创建都要登记，不只是清场那一刻的。
 *
 * 清场发生在创建请求在路上的那一刻时，本机登记里还没有 live，上面那条路径读不到
 * 任何可撤的东西。持有响应的那一方（设置页）会在卸载之后继续跑它的 `.then`，
 * 但整页重载会把那段代码一起杀掉 —— 所以凭证必须交到这里，由这条闸负责等它落地、
 * 撤掉它，并在此期间把重载按住。
 *
 * 判据是**轮次变过没有**，不是「现在还开不开着」：收尾可能已经结束，而这条迟到的
 * 响应恰恰是那一轮遗留下来的孤儿，仍然要撤。
 *
 * @param identityToken 发起创建时取的那一份身份快照。必须是**创建那一刻**的那个，
 *   不能是回调里现取的：服务端 `cancel()` 按 endUserId 校验，换人之后现取只会 403。
 */
export function trackScanSessionCreation(
  promise: Promise<unknown>,
  identityToken: string | null,
): void {
  const epochAtStart = cleanupEpoch
  creating += 1
  creationHoldUntil = Math.max(creationHoldUntil, Date.now() + CREATE_SETTLE_HOLD_MS)
  const finish = (created: unknown): void => {
    creating = Math.max(0, creating - 1)
    const orphaned = cleanupEpoch !== epochAtStart
    const credentials = orphaned ? getCancellationCredentials(created) : null
    if (credentials) {
      track(credentials, identityToken, parseExpiry((created as { expiresAt?: unknown } | null)?.expiresAt))
    }
    if (pending.size > 0 && roundOpen) {
      pump()
    } else {
      closeRoundIfSettled()
      schedule()
    }
    // notify 无条件发：pump() 撞上 inFlight 时会直接返回、一个通知都不发，
    // 而这一刻「还在飞的创建少了一个」本身就是订阅者要看到的变化。
    notify()
  }
  promise.then(finish, () => finish(null))
}

/** 用户在清场屏上按下「再试一次」。只把下一次尝试提前，不重置任何计数。 */
export function retryScanCleanupNow(): void {
  if (!holding()) return
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
  pump()
}

/**
 * 等这一轮收尾走到确定结论（服务端确认，或自然过期）。
 *
 * 已经收完时**同步**执行 `run()`：没有扫描会话的那条最常见路径上，清场的时序
 * 和这条闸出现之前一模一样，一帧都不多等。
 *
 * @returns 取消订阅（调用方卸载时用）。
 */
export function whenScanCleanupSettled(run: () => void): () => void {
  if (!holding()) {
    run()
    return () => undefined
  }
  let done = false
  const unsubscribe = subscribeScanCleanup(() => {
    if (done || holding()) return
    done = true
    unsubscribe()
    run()
  })
  return () => {
    done = true
    unsubscribe()
  }
}
