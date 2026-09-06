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
