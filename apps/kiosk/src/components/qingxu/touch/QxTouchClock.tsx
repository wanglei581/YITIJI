import { useEffect, useState } from 'react'

function shanghaiNow(now: Date) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { time, date: `${pick('month')}月${pick('day')}日 ${pick('weekday')}` }
}

/**
 * 意图带上的钟。只在分钟变化时重渲染，每 30 秒看一次是否跨过分钟。
 */
export function QxTouchClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow((prev) => {
        const next = new Date()
        const before = shanghaiNow(prev)
        const after = shanghaiNow(next)
        return before.time === after.time && before.date === after.date ? prev : next
      })
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const clock = shanghaiNow(now)
  return (
    <div className="qxt-clock">
      <b>{clock.time}</b>
      <small>{clock.date}</small>
    </div>
  )
}
