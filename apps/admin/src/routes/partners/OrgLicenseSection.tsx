import { useCallback, useEffect, useState } from 'react'
import type { CreateLicenseInput, LicenseView, OrgLicenseDetail, RenewLicenseInput, UpdateLicenseInput } from '@ai-job-print/shared'
import { API_MODE, ApiHttpError } from '../../services/api/client'
import { createLicense, getOrgLicenses, renewLicense, resumeLicense, revokeLicense, setLicenseMode, suspendLicense, updateLicense } from '../../services/api/licensesAdmin'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { LicenseForm } from './LicenseForm'
import { LicenseStatusDialog } from './LicenseStatusDialog'
import { phaseLabel, stateLabel } from './licensePresentation'

type Action = { kind: 'create' | 'mode' } | { kind: 'edit' | 'renew' | 'suspend' | 'resume' | 'revoke'; item: LicenseView }
export function OrgLicenseSection({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [org, setOrg] = useState<OrgLicenseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [topError, setTopError] = useState('')
  const [lockout, setLockout] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setLoadError(false)
    try { setOrg(await getOrgLicenses(orgId)); return true } catch { setLoadError(true); setOrg(null); return false } finally { setLoading(false) }
  }, [orgId])
  useEffect(() => { void load() }, [load])
  async function write(run: () => Promise<OrgLicenseDetail>) {
    setSaving(true); setMessage(''); setError(''); setTopError('')
    try { const result = await run(); setOrg(result); setAction(null); setLockout(null); setMessage('授权信息已保存'); onChanged() }
    catch (error) {
      if (error instanceof ApiHttpError && error.status === 409 && error.code === 'LICENSE_MODE_WOULD_LOCK_TERMINALS') setLockout(userMessageOf(error, '切换后会停用终端，请确认'))
      else if (error instanceof ApiHttpError && error.status === 409 && error.code === 'LICENSE_VERSION_CONFLICT') {
        setAction(null); setLockout(null); const refreshed = await load(); setTopError(refreshed ? '这条授权刚被其他人改过，已刷新为最新内容，请核对后重新操作' : '这条授权刚被其他人改过，但最新内容没有读到，请重试后重新操作')
      } else { setLockout(null); setError(error instanceof ApiHttpError && /[\u4e00-\u9fff]/.test(error.message) ? error.message : userMessageOf(error, '操作失败，请稍后重试')) }
    } finally { setSaving(false) }
  }
  function formSubmit(input: CreateLicenseInput | UpdateLicenseInput | RenewLicenseInput) {
    if (!action) return
    if (action.kind === 'create') void write(async () => (await createLicense(orgId, input as CreateLicenseInput)).org)
    if (action.kind === 'edit') void write(async () => (await updateLicense(action.item.id, input as UpdateLicenseInput)).org)
    if (action.kind === 'renew') void write(async () => (await renewLicense(action.item.id, input as RenewLicenseInput)).org)
  }
  function statusSubmit(reason: string, approvalTicketNo: string, confirmed: boolean) {
    if (!action || !org) return
    if (action.kind === 'mode') void write(() => setLicenseMode(orgId, { licenseMode: org.licenseMode === 'none' ? 'required' : 'none', reason, ...(confirmed ? { confirmLockout: true } : {}) }))
    else if (action.kind === 'suspend') void write(async () => (await suspendLicense(action.item.id, { version: action.item.version, reason, approvalTicketNo })).org)
    else if (action.kind === 'revoke') void write(async () => (await revokeLicense(action.item.id, { version: action.item.version, reason, approvalTicketNo })).org)
    else if (action.kind === 'resume') void write(async () => (await resumeLicense(action.item.id, { version: action.item.version, reason })).org)
  }
  const choose = (next: Action) => { setMessage(''); setError(''); setTopError(''); setLockout(null); setAction(next) }
  return <section className="space-y-3 rounded-lg border border-neutral-200 p-4" aria-label="软件使用授权">
    <h3 className="font-semibold">软件使用授权</h3>
    {API_MODE === 'mock' && <p className="text-sm text-neutral-600">演示模式：更改只保存在当前页面会话中。</p>}
    {loading && <p>授权情况读取中…</p>}
    {loadError && <p role="alert">授权情况这次没读到 <button onClick={() => void load()} className="min-h-11 rounded border border-primary-600 px-3 py-2 text-primary-600">重试</button></p>}
    {topError && <p role="alert" className="text-sm text-red-700">{topError}</p>}
    {message && <p role="status" className="text-sm text-primary-700">{message}</p>}
    {org && !loading && <>
      <p className="text-sm">授权方式：{org.licenseMode === 'none' ? '不管控（照常使用，不受期限和台数限制）' : '需要授权（没有可用授权时，名下一体机不能开始新的服务，机构后台不能发布或修改内容）'}</p>
      <button className="min-h-11 rounded border border-primary-600 px-3 py-2 text-primary-600" disabled={saving} onClick={() => choose({ kind: 'mode' })}>切换授权方式</button>
      {org.managed ? <div className="space-y-1 text-sm">
        <p>当前状态：<strong>{stateLabel(org)}</strong></p>
        {org.state === 'grace' && <p>宽限期内照常服务，结束后自动停用。</p>}
        {!org.usable && <p className="font-semibold text-red-700">名下一体机不能开始新的服务，机构后台不能发布或修改内容。</p>}
        {org.current && <><p>被授权企业名称：{org.current.licenseeName}</p><p>统一社会信用代码：{org.current.creditCode}</p><p>合同编号：{org.current.contractNo}</p><p>有效期：{org.current.periodText}</p><p>宽限天数：{org.current.graceDays} 天</p>{org.current.graceEndsOn && <p>宽限至：{org.current.graceEndsOn}</p>}</>}
        <p>{org.current ? `已绑定 ${org.terminalsBound} 台 / 上限 ${org.current.terminalQuota} 台` : `已绑定 ${org.terminalsBound} 台（当前没有可用授权，没有台数上限）`}</p>
        {org.overQuota && <p className="text-red-700">已绑定台数超过上限：不会自动解绑，但不能再新增绑定</p>}
        {org.coveredUntilOn && <p>连续有效至 {org.coveredUntilOn}（含当天）</p>}
        {org.upcoming && <p>已录入后续授权：{org.upcoming.periodText}，上限 {org.upcoming.terminalQuota} 台</p>}
      </div> : <p>当前不管控：本机构照常使用</p>}
      <button className="min-h-11 rounded border border-primary-600 px-3 py-2 text-primary-600" disabled={saving} onClick={() => choose({ kind: 'create' })}>新建授权</button>
      {action && ['create', 'edit', 'renew'].includes(action.kind) && <LicenseForm key={action.kind + ('item' in action ? action.item.id : '')} kind={action.kind as 'create' | 'edit' | 'renew'} item={'item' in action ? action.item : undefined} saving={saving} error={error} onCancel={() => setAction(null)} onSubmit={formSubmit} />}
      {action && ['mode', 'suspend', 'resume', 'revoke'].includes(action.kind) && <LicenseStatusDialog key={action.kind + ('item' in action ? action.item.id : '')} action={action.kind as 'mode' | 'suspend' | 'resume' | 'revoke'} saving={saving} error={error} currentMode={org.licenseMode} lockoutMessage={lockout} onCancel={() => { setAction(null); setLockout(null) }} onSubmit={statusSubmit} />}
      <h4 className="font-semibold">授权历史</h4>
      {org.items.length === 0 && <p>暂无授权记录</p>}
      {org.items.map(item => <article key={item.id} className="space-y-1 rounded border p-3 text-sm" aria-label={`授权 ${item.contractNo}`}>
        <p><strong>{phaseLabel[item.phase]}</strong> · {item.periodText}</p><p>合同编号：{item.contractNo}；上限 {item.terminalQuota} 台</p>
        {item.statusReason && <p>理由：{item.statusReason}{item.statusTicketNo && `；审批工单号：${item.statusTicketNo}`}</p>}
        {item.phase !== 'expired' && item.phase !== 'revoked' && <div className="flex flex-wrap gap-3 text-primary-600">
          {['pending', 'active', 'grace'].includes(item.phase) && <button className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={() => choose({ kind: 'edit', item })}>更正信息</button>}
          {item.status !== 'revoked' && item.endsOn === org.items.filter(row => row.status !== 'revoked').reduce((latest, row) => row.endsOn > latest ? row.endsOn : latest, '') && <button className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={() => choose({ kind: 'renew', item })}>续期</button>}
          {item.status === 'active' && ['pending', 'active', 'grace'].includes(item.phase) && <button className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={() => choose({ kind: 'suspend', item })}>暂停</button>}
          {item.status === 'suspended' && <button className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={() => choose({ kind: 'resume', item })}>恢复</button>}
          {(item.status === 'active' || item.status === 'suspended') && <button className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={() => choose({ kind: 'revoke', item })}>吊销</button>}
        </div>}
      </article>)}
    </>}
  </section>
}
