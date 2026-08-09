import { useEffect, useState } from 'react'
import { Clock3Icon } from 'lucide-react'

function remainingLabel(expiresAt: string, now: number): string {
  const remainingMs = Date.parse(expiresAt) - now
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '本次会话已到期'
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  if (minutes < 60) return `最长保留剩余约 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? `最长保留剩余约 ${hours} 小时`
    : `最长保留剩余约 ${hours} 小时 ${rest} 分钟`
}

export function ContractReviewSessionNotice({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="cr-disclaimer-banner" role="status" aria-live="polite">
      <Clock3Icon />
      <span>
        <strong>{remainingLabel(expiresAt, now)}</strong>。刷新、关闭页面或切换用户会结束本次查看，
        当前合同和结果无法从此终端恢复。
      </span>
    </div>
  )
}
