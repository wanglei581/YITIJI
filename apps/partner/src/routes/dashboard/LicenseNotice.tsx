import { useEffect, useState } from 'react'
import { formatCount, type PartnerLicenseView } from '@ai-job-print/shared'
import { beijingDate, getPartnerLicense } from '../../services/api/license'

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
    onAttention(error || data === null || (data.managed && (!data.usable || data.state === 'grace' || (data.state === 'ok' && data.daysLeft !== null && data.daysLeft <= 30))))
  }, [data, error, onAttention])
  if (error) return <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg"><span>授权情况这次没读到</span><button type="button" onClick={() => setKey((n) => n + 1)} className="min-h-11 rounded-md border border-warning/40 px-3 font-semibold">重试</button></div>
  if (!data?.managed) return null
  let message = ''
  if (!data.usable) message = '软件使用授权已停用：名下一体机不能开始新的服务，本后台暂时不能发布或修改内容，请联系平台。'
  else if (data.state === 'grace' && data.daysLeft !== null) message = `软件使用授权处于宽限期，还剩 ${formatCount(data.daysLeft)} 天；期间照常服务，结束后自动停用。`
  else if (data.state === 'ok' && data.daysLeft !== null && data.daysLeft <= 30) message = data.upcoming ? `已录入续期，${beijingDate(data.upcoming.startsAt)} 起接续` : `软件使用授权还剩 ${formatCount(data.daysLeft)} 天到期，请联系平台续期；到期后进入宽限期，宽限结束后停用。`
  if (!message) return null
  return <p className={`rounded-lg p-3 text-sm ${data.upcoming && data.state === 'ok' ? 'bg-neutral-50 text-neutral-700' : 'bg-warning-bg text-warning-fg'}`}>{message}</p>
}
