import { useEffect, useState } from 'react'

export function useCountdown(expiresAt?: string | null): {
  remainingMs: number
  expired: boolean
  label: string
} {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  if (!expiresAt) return { remainingMs: 0, expired: true, label: '' }
  const remainingMs = Math.max(0, Date.parse(expiresAt) - now)
  const expired = !Number.isFinite(remainingMs) || remainingMs <= 0
  const totalSec = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  const label = expired ? '已过期' : `${minutes}分${String(seconds).padStart(2, '0')}秒`
  return { remainingMs, expired, label }
}

/**
 * 按绝对过期时刻计算剩余秒数。没有有效 expiresAt 时返回 -1，调用方不得把它当成「已过期」。
 */
export function useRemainingSeconds(expiresAt?: string | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  if (!expiresAt) return -1
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return -1
  return Math.max(0, Math.ceil((expiresMs - now) / 1000))
}

export function formatRemainingSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  if (minutes <= 0) return `${seconds} 秒`
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
}
