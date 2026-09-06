import { useEffect, useState } from 'react'
import { userMessageOf } from './services/api/userErrorMessage'

/** 全局未处理 Promise 拒绝提示，避免审核/发布静默失败（ADM-C3）。 */
export function UnhandledRejectionBanner() {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const onReject = (event: PromiseRejectionEvent) => {
      setMessage(userMessageOf(event.reason, '操作未完成，请重试或刷新页面'))
    }
    window.addEventListener('unhandledrejection', onReject)
    return () => window.removeEventListener('unhandledrejection', onReject)
  }, [])
  if (!message) return null
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[200] flex items-center justify-between gap-3 border-b border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg shadow"
    >
      <span>{message}。请重试；若反复出现请刷新页面。</span>
      <button
        type="button"
        className="shrink-0 rounded border border-error/40 px-2 py-1 text-xs"
        onClick={() => setMessage(null)}
      >
        关闭
      </button>
    </div>
  )
}
