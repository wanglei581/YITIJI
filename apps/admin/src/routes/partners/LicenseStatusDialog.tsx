import { useEffect, useState, type FormEvent } from 'react'
import { reasonLength, validReason, validTicket } from './licenseValidation'

type Props = { action: 'mode' | 'suspend' | 'resume' | 'revoke'; saving: boolean; error: string; currentMode: 'none' | 'required'; lockoutMessage: string | null; onCancel: () => void; onSubmit: (reason: string, ticket: string, confirmed: boolean) => void }
export function LicenseStatusDialog({ action, saving, error, currentMode, lockoutMessage, onCancel, onSubmit }: Props) {
  const [reason, setReason] = useState('')
  const [ticket, setTicket] = useState('')
  const [errors, setErrors] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { if (error) setConfirm(false) }, [error])
  const needsTicket = action === 'suspend' || action === 'revoke'
  const title = { mode: '切换授权方式', suspend: '暂停授权', resume: '恢复授权', revoke: '吊销授权' }[action]
  function submit(e: FormEvent) {
    if (saving) return
    e.preventDefault()
    if (!validReason(reason) || (needsTicket && !validTicket(ticket))) { setErrors(true); return }
    if (needsTicket && !confirm) { setConfirm(true); return }
    onSubmit(reason.trim(), ticket, Boolean(lockoutMessage))
  }
  return <div role="dialog" aria-label={title} className="rounded border border-neutral-300 bg-white p-4 space-y-3">
    <h4 className="font-semibold">{title}</h4>
    {action === 'mode' && <><p>将切换为：{currentMode === 'none' ? '需要授权' : '不管控'}</p><p>{currentMode === 'none' ? '没有可用授权时，名下一体机不能开始新的服务，机构后台不能发布或修改内容' : '本机构不再受授权期限和台数限制'}</p></>}
    {action === 'revoke' && <p className="text-red-700">吊销后不能恢复，也不能再续期或修改</p>}
    {lockoutMessage ? <p>{lockoutMessage}</p> : confirm ? <><p>请确认{action === 'revoke' ? '吊销' : '暂停'}这条授权。</p><p>理由：{reason}</p><p>审批工单号：{ticket}</p></> : <>
      <label className="block text-sm">理由<textarea className="block w-full rounded border p-2" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p className="text-xs">{reasonLength(reason)} / 200 字</p>
      {errors && !validReason(reason) && <p role="alert" className="text-red-700">理由须为 2 至 200 字</p>}
      {needsTicket && <label className="block text-sm">审批工单号<input className="block w-full rounded border p-2" value={ticket} onChange={e => setTicket(e.target.value)} /></label>}
      {errors && needsTicket && !validTicket(ticket) && <p role="alert" className="text-red-700">审批工单号须为 1 至 64 位，只能包含字母、数字和 - _ /</p>}
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <form onSubmit={submit} className="flex gap-3"><button disabled={saving} className="min-h-11 rounded bg-primary-600 px-3 py-2 text-white disabled:opacity-50">{saving ? '提交中…' : lockoutMessage ? '仍要立即停用' : confirm ? '确认' + (action === 'revoke' ? '吊销' : '暂停') : '提交'}</button>{confirm && <button type="button" className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={() => setConfirm(false)}>返回修改</button>}<button type="button" className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={onCancel}>取消</button></form>
  </div>
}
