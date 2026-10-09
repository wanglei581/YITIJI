import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, ErrorState } from '@ai-job-print/ui'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { getPartnerTerminalOperations, type PartnerTerminalOpsView } from '../../services/api/terminalOps'
import { METRIC_NOTES, visitText, windowText } from '../terminals/terminalOpsFormat'

export function ServiceVisitsCard() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [data, setData] = useState<PartnerTerminalOpsView | null>(null)
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getPartnerTerminalOperations('week')
      .then((result) => {
        if (cancelled) return
        setData(result)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setData(null)
        setMessage(userMessageOf(error, '服务人次加载失败，请重试'))
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <Card className="p-4">
      <section aria-label="服务人次">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-bold text-neutral-700">服务人次</h2>
            <p className="mt-1 text-[11.5px] text-neutral-400">近 7 天（截至昨天）</p>
          </div>
          <Link to="/terminals" className="text-xs font-semibold text-primary-600 hover:underline">查看各终端明细</Link>
        </div>
        {state === 'loading' && <p className="mt-3 text-sm text-neutral-500">读取中…</p>}
        {state === 'error' && (
          <ErrorState
            className="py-6"
            title="服务人次加载失败"
            message={message || '服务人次加载失败，请重试'}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        )}
        {state === 'ready' && data && (
          <>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-neutral-900">{visitText(data, data.totals.visitCount)}</p>
            <p className="mt-1 text-xs text-neutral-500">{windowText(data)}</p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">{METRIC_NOTES.visit}</p>
          </>
        )}
      </section>
    </Card>
  )
}
