import { useEffect, useState } from 'react'
import { formatCount, type PartnerLicenseView } from '@ai-job-print/shared'
import { Card } from '@ai-job-print/ui'
import { getPartnerLicense } from '../../services/api/license'

export function LicenseSection() {
  const [data, setData] = useState<PartnerLicenseView | null>(null)
  const [error, setError] = useState(false)
  const [key, setKey] = useState(0)
  useEffect(() => {
    let alive = true
    setError(false)
    getPartnerLicense().then((value) => { if (alive) setData(value) }).catch(() => { if (alive) { setData(null); setError(true) } })
    return () => { alive = false }
  }, [key])
  if (error) return <Card className="mt-6 p-6"><p role="alert" className="text-error-fg">授权情况暂时没读到</p><button type="button" className="min-h-11 rounded-md border border-neutral-300 px-3" onClick={() => setKey((n) => n + 1)}>重试</button></Card>
  if (!data?.managed) return null
  const current = data.current
  return <Card className="mt-6 space-y-2 p-6 text-sm">
    <h3 className="text-sm font-medium text-neutral-700">软件使用授权</h3>
    <p>状态：{!data.usable ? '已停用' : data.state === 'grace' ? (data.daysLeft === null ? '宽限期' : `宽限期还剩 ${formatCount(data.daysLeft)} 天`) : '正常'}</p>
    {!data.usable && <p role="alert" className="rounded-lg bg-error-bg p-3 text-error-fg">本机构的软件使用授权当前不可用：名下一体机暂停服务；本后台可以查看和导出，暂时不能发布或修改内容。请联系平台续期或恢复。</p>}
    {data.state === 'ok' && data.daysLeft !== null && data.daysLeft <= 30 && <p className="rounded-lg bg-warning-bg p-3 text-warning-fg">授权 {formatCount(data.daysLeft)} 天内到期，请及时联系平台。</p>}
    {current && <><p>被授权企业名称：{current.licenseeName}</p><p>有效期：{current.periodText}</p><p>宽限天数：{formatCount(current.graceDays)} 天</p><p>终端台数：已绑定 {formatCount(data.terminalsBound)} 台 / 上限 {formatCount(current.terminalQuota)} 台</p></>}
    {data.upcoming && <p>已录入后续授权：{data.upcoming.periodText}，上限 {formatCount(data.upcoming.terminalQuota)} 台</p>}
  </Card>
}
