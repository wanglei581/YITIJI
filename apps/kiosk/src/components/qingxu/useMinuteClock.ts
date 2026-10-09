// 顶栏时钟。所有 QxPageFrame 共用这一只定时器：对齐到下一分钟整点，
// 到点只刷新一次，最后一个订阅卸下时清掉。不显示秒。
import { useEffect, useState } from 'react'

const listeners = new Set<(now: Date) => void>()
let timer: number | null = null

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatMinuteClock(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function tick(): void {
  timer = null
  const now = new Date()
  for (const listener of listeners) listener(now)
  if (listeners.size > 0) arm()
}

function arm(): void {
  if (timer !== null || listeners.size === 0) return
  const delay = 60_000 - (Date.now() % 60_000)
  timer = window.setTimeout(tick, delay)
}

function disarm(): void {
  if (timer === null) return
  window.clearTimeout(timer)
  timer = null
}

export function useMinuteClock(): string {
  const [label, setLabel] = useState(() => formatMinuteClock(new Date()))

  useEffect(() => {
    const listener = (now: Date) => setLabel(formatMinuteClock(now))
    listeners.add(listener)
    setLabel(formatMinuteClock(new Date()))
    arm()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) disarm()
    }
  }, [])

  return label
}
