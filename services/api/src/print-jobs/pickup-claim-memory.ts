/**
 * 取件认领在 Redis 不可用时的进程内计数。
 *
 * 只在 Redis 调用失败时写入。Redis 正常时调用方不得读这里，避免和 Redis 各记一笔。
 * 容量有上限：新键放不下就拒绝（返回 null），不能靠淘汰把超额请求放行。
 * 每个键带过期时间，读的时候丢掉过期项。
 */

export const PICKUP_CLAIM_MEMORY_MAX_KEYS = 1024

interface Slot {
  count: number
  expiresAt: number
}

const slots = new Map<string, Slot>()

function prune(now: number): void {
  for (const [key, slot] of slots) {
    if (slot.expiresAt <= now) slots.delete(key)
  }
}

export function resetPickupClaimMemoryFallbackForTests(): void {
  slots.clear()
}

/** 固定窗口自增。窗口已过则从 1 重新计。地图已满且这是新键时返回 null。 */
export function memoryIncrement(key: string, ttlSeconds: number, now = Date.now()): number | null {
  const current = slots.get(key)
  if (current && current.expiresAt > now) {
    current.count += 1
    return current.count
  }
  if (current) slots.delete(key)
  if (slots.size >= PICKUP_CLAIM_MEMORY_MAX_KEYS) {
    prune(now)
    if (slots.size >= PICKUP_CLAIM_MEMORY_MAX_KEYS) return null
  }
  slots.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 })
  return 1
}

/** 写入一个会过期的标记（锁定）。已满且这是新键时返回 false。 */
export function memorySet(key: string, ttlSeconds: number, now = Date.now()): boolean {
  const current = slots.get(key)
  if (current && current.expiresAt > now) {
    current.expiresAt = now + ttlSeconds * 1000
    return true
  }
  if (current) slots.delete(key)
  if (slots.size >= PICKUP_CLAIM_MEMORY_MAX_KEYS) {
    prune(now)
    if (slots.size >= PICKUP_CLAIM_MEMORY_MAX_KEYS) return false
  }
  slots.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 })
  return true
}

export function memoryHas(key: string, now = Date.now()): boolean {
  const current = slots.get(key)
  if (!current || current.expiresAt <= now) {
    if (current) slots.delete(key)
    return false
  }
  return true
}

export function memoryDelete(key: string): void {
  slots.delete(key)
}
