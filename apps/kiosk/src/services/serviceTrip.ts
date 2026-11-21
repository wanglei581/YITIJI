// ============================================================
// 这一趟的服务单订单号：按服务种类记在 sessionStorage，带着建单时那一次使用的周期编号。
//
// 为什么本机要记：建单不幂等（每次 POST 都是新的一张），服务端也没有「按会话查当前单」的接口。
// 页面重载时要找回同一张单、同一张码；「再出一张码」要先关掉旧单。
//
// 为什么记周期编号而不是每次现取：整页重载会让上报器换一个新编号，可那张单仍挂在建单时的编号上，
// 查单、关单、受费用接口带的 x-kiosk-session-id 必须是建单时那一个，否则服务端一律 404 / 402。
// 清场换新周期时旧号作废，靠的是清场表：本键登记在 auth/kioskSensitiveSession.ts，
// 结束使用、换号、闲置到点、进屏保每一条清场路径都会把它清掉。
// 只存订单号、周期编号、服务种类和记下的时刻，不存金额、收款码和任何个人信息。
//
// 本文件不在运行时 import 任何模块（只有类型）：清场表那一层被多条门禁按替身表单独编译，
// 叶子模块可以原样装进去，不用为它再造一份替身。
// ============================================================
import type { ServiceOrderKey } from '@ai-job-print/shared'

/** 与 @ai-job-print/shared 的 SERVICE_ORDER_KEYS 同一组；satisfies 保证不会写出共享包里没有的键。 */
const SERVICE_ORDER_KEYS = ['resume_optimize', 'mock_interview', 'scan'] as const satisfies readonly ServiceOrderKey[]
type MissingTripKeys = Exclude<ServiceOrderKey, (typeof SERVICE_ORDER_KEYS)[number]>
/** 共享包多了一种服务而上面这组没跟上时，这一行编译失败。 */
export const SERVICE_TRIP_KEYS_COMPLETE: [MissingTripKeys] extends [never] ? true : never = true

export const SERVICE_TRIP_STORAGE_KEY = 'ai-job-print:service-trip:v1'

/**
 * 记下来的单超过这么久就不再认：待付码 5 分钟失效，已付没用的单服务端 30 分钟内原路退，
 * 再留 5 分钟余量。清场没清到（读写抛错）时也不会让一张旧单一直挂在本机上。
 */
export const SERVICE_TRIP_MAX_AGE_MS = 35 * 60 * 1000

export type ServiceTripOwner =
  | { kind: 'guest' }
  | { kind: 'member'; mark: string }

export interface ServiceTrip {
  serviceKey: ServiceOrderKey
  orderId: string
  /** 建单时的使用周期编号（clientSessionId）。 */
  kioskSessionId: string
  /** 归属：游客为 guest，会员只存本次内存登录的随机标记（不写会员 id / 手机号等 PII）。 */
  owner: ServiceTripOwner
  /** 记下时的本机时刻（毫秒）。 */
  savedAt: number
}

type TripTable = Partial<Record<ServiceOrderKey, ServiceTrip>>

const memberMarks = new Map<string, string>()

function randomMark(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 当前内存登录对应的服务单归属标记。游客为 guest；会员按内存会话生成随机标记，重载或清场后作废。 */
export function serviceTripOwnerFor(endUserId: string | null | undefined): ServiceTripOwner {
  const id = typeof endUserId === 'string' ? endUserId.trim() : ''
  if (!id) return { kind: 'guest' }
  let mark = memberMarks.get(id)
  if (!mark) {
    mark = randomMark()
    memberMarks.set(id, mark)
  }
  return { kind: 'member', mark }
}

export function serviceTripOwnerMatches(stored: ServiceTripOwner, current: ServiceTripOwner): boolean {
  if (stored.kind === 'guest' && current.kind === 'guest') return true
  return stored.kind === 'member' && current.kind === 'member' && stored.mark === current.mark
}

function asOwner(value: unknown): ServiceTripOwner | null {
  if (value === undefined) return { kind: 'guest' }
  if (!value || typeof value !== 'object') return null
  const row = value as { kind?: unknown; mark?: unknown }
  if (row.kind === 'guest') return { kind: 'guest' }
  if (row.kind === 'member' && typeof row.mark === 'string' && row.mark.trim() && row.mark.length <= 80) {
    return { kind: 'member', mark: row.mark }
  }
  return null
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function isServiceKey(value: unknown): value is ServiceOrderKey {
  return typeof value === 'string' && (SERVICE_ORDER_KEYS as readonly string[]).includes(value)
}

function asTrip(key: ServiceOrderKey, value: unknown): ServiceTrip | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.serviceKey !== key || !isServiceKey(row.serviceKey)) return null
  if (typeof row.orderId !== 'string' || !row.orderId.trim() || row.orderId.length > 64) return null
  if (typeof row.kioskSessionId !== 'string' || !row.kioskSessionId.trim() || row.kioskSessionId.length > 80) return null
  if (typeof row.savedAt !== 'number' || !Number.isFinite(row.savedAt)) return null
  const owner = asOwner(row.owner)
  if (!owner) return null
  return { serviceKey: key, orderId: row.orderId, kioskSessionId: row.kioskSessionId, owner, savedAt: row.savedAt }
}

function readTable(): TripTable {
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(SERVICE_TRIP_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { v?: unknown; trips?: unknown }
    if (parsed?.v !== 1 || !parsed.trips || typeof parsed.trips !== 'object') return {}
    const table: TripTable = {}
    for (const key of SERVICE_ORDER_KEYS) {
      const trip = asTrip(key, (parsed.trips as Record<string, unknown>)[key])
      if (trip) table[key] = trip
    }
    return table
  } catch {
    return {}
  }
}

function writeTable(table: TripTable): void {
  const store = storage()
  if (!store) return
  try {
    if (Object.keys(table).length === 0) store.removeItem(SERVICE_TRIP_STORAGE_KEY)
    else store.setItem(SERVICE_TRIP_STORAGE_KEY, JSON.stringify({ v: 1, trips: table }))
  } catch {
    // 写不进去就当没记：重载后找不回，最多再建一张，旧的待付单 5 分钟后自己失效。
  }
}

function notifyClearListeners(sessionIds: readonly string[], reason: ServiceTripClearReason): void {
  if (sessionIds.length === 0) return
  clearListeners.forEach((listener) => {
    try {
      listener(sessionIds, reason)
    } catch {
      // 通知收尾失败不拦清场。
    }
  })
}

/** 这一种服务这一趟记下的单。过期、形状不对或归属不符一律当没有（归属不符时当场清掉并通知收尾）。 */
export function readServiceTrip(
  serviceKey: ServiceOrderKey,
  options?: number | { owner?: ServiceTripOwner; nowMs?: number },
): ServiceTrip | null {
  const nowMs = typeof options === 'number' ? options : (options?.nowMs ?? Date.now())
  const owner = typeof options === 'object' ? options?.owner : undefined
  const table = readTable()
  const trip = table[serviceKey] ?? null
  if (!trip) return null
  if (nowMs - trip.savedAt > SERVICE_TRIP_MAX_AGE_MS || trip.savedAt - nowMs > 60_000) return null
  if (owner && !serviceTripOwnerMatches(trip.owner, owner)) {
    delete table[serviceKey]
    writeTable(table)
    const stillUsed = SERVICE_ORDER_KEYS.some((key) => table[key]?.kioskSessionId === trip.kioskSessionId)
    if (!stillUsed) notifyClearListeners([trip.kioskSessionId], 'login_handover')
    return null
  }
  return trip
}

export function rememberServiceTrip(
  trip: Omit<ServiceTrip, 'savedAt' | 'owner'> & { owner?: ServiceTripOwner },
  nowMs = Date.now(),
): void {
  const table = readTable()
  table[trip.serviceKey] = { ...trip, owner: trip.owner ?? { kind: 'guest' }, savedAt: nowMs }
  writeTable(table)
}

/** 忘掉这一种服务的单。给了 orderId 时只在记的正是这张单时才忘，免得把刚建的新单抹掉。 */
export function forgetServiceTrip(serviceKey: ServiceOrderKey, orderId?: string): void {
  const table = readTable()
  const current = table[serviceKey]
  if (!current) return
  if (orderId && current.orderId !== orderId) return
  delete table[serviceKey]
  writeTable(table)
}

export type ServiceTripClearReason = 'clear' | 'login_handover'
type ServiceTripClearListener = (sessionIds: readonly string[], reason: ServiceTripClearReason) => void

const clearListeners = new Set<ServiceTripClearListener>()

/** 订阅服务单清场/换人事件：在旧单号被抹掉时拿到它们关联的旧周期编号，便于同步通知服务端收尾。 */
export function onServiceTripsCleared(listener: ServiceTripClearListener): () => void {
  clearListeners.add(listener)
  return () => { clearListeners.delete(listener) }
}

/** 读出本机所有服务单记录里关联的使用周期编号（去重）。重载后清场收尾用。 */
export function readServiceTripSessionIds(): string[] {
  const table = readTable()
  const ids = new Set<string>()
  for (const key of SERVICE_ORDER_KEYS) {
    const trip = table[key]
    if (trip) ids.add(trip.kioskSessionId)
  }
  return [...ids]
}

/** 清场用：这一趟记的单全部作废，并返回 / 广播它们关联的旧周期编号以便服务端收尾。 */
export function clearServiceTrips(reason: ServiceTripClearReason = 'clear'): string[] {
  const sessionIds = readServiceTripSessionIds()
  memberMarks.clear()
  const store = storage()
  if (store) {
    try {
      store.removeItem(SERVICE_TRIP_STORAGE_KEY)
    } catch {
      // 清不掉也不拦清场；读的时候还有过期判断。
    }
  }
  notifyClearListeners(sessionIds, reason)
  return sessionIds
}
