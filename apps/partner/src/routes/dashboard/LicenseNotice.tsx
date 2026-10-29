import { useEffect, useState } from 'react'
import type { PartnerLicenseView } from '@ai-job-print/shared'
import { getPartnerLicense } from '../../services/api/license'
import { dashboardNotice } from '../profile/licenseCopy'

export function LicenseNotice({ onAttention }: { onAttention: (value: boolean) => void }) {
  const [data, setData] = useState<PartnerLicenseView | null>(null)
  const [error, setError] = useState(false)
  const [key, setKey] = useState(0)
  useEffect(() => {
    let alive = true
    setError(false)
    getPartnerLicense().then((value) => { if (alive) setData(value) }).catch(() => { if (alive) { setData(null); setError(true) } })
    return () => { alive = false }
  }, [key])
  useEffect(() => {
    // 已录入接续授权的那句是平静提示（tone=neutral），不算待办，否则「今天没有要处理的事」永远出不来
    onAttention(error || data === null || (data.managed && dashboardNotice(data)?.tone === 'warning'))
  }, [data, error, onAttention])
  if (error) return <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg"><span>授权情况这次没读到</span><button type="button" onClick={() => setKey((n) => n + 1)} className="min-h-11 rounded-md border border-warning/40 px-3 font-semibold">重试</button></div>
  if (!data?.managed) return null
  const notice = dashboardNotice(data)
  if (!notice) return null
  return <p className={`rounded-lg p-3 text-sm ${notice.tone === 'neutral' ? 'bg-neutral-50 text-neutral-700' : 'bg-warning-bg text-warning-fg'}`}>{notice.text}</p>
}
