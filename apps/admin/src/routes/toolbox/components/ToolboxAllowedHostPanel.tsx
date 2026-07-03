import { useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { toolboxService, type ToolboxAllowedHostRecord } from '../../../services/api/toolbox'
import { HOST_PURPOSE_OPTIONS, HOST_REVIEW_OPTIONS, STATUS_LABELS } from '../constants'

function badgeStatus(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'pending_review') return 'warning'
  if (status === 'suspended' || status === 'expired') return 'error'
  return 'default'
}

export function ToolboxAllowedHostPanel({
  hosts,
  onRefresh,
}: {
  hosts: ToolboxAllowedHostRecord[]
  onRefresh: () => void
}) {
  const [form, setForm] = useState({
    host: '',
    purpose: 'web_app' as const,
    owner: '',
    reason: '',
    expiresAt: '',
  })
  const [reviewReason, setReviewReason] = useState('安全审核通过')
  const [message, setMessage] = useState('')

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setMessage('')
    try {
      await action()
      setMessage(success)
      onRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    }
  }

  const submitHost = () => runAction(async () => {
    await toolboxService.upsertAllowedHost({
      host: form.host,
      purpose: form.purpose,
      owner: form.owner,
      reason: form.reason,
      expiresAt: form.expiresAt || undefined,
    })
    setForm({ host: '', purpose: 'web_app', owner: '', reason: '', expiresAt: '' })
  }, '域名已提交 DB 审核表')

  return (
    <Card className="p-5">
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.2fr]">
        <div>
          <h2 className="text-base font-bold text-neutral-900">允许域名</h2>
          <p className="mt-1 text-sm text-neutral-500">DB 审核表负责业务审批；环境白名单由服务端配置控制，此处只读展示口径。</p>
          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800">
            环境白名单：TOOLBOX_ALLOW_EXTERNAL_URL、KIOSK_EXTERNAL_APP_ALLOWED_HOSTS、KIOSK_QR_TARGET_ALLOWED_HOSTS。DB 与 env 双门禁同时满足后，外部 H5 或二维码目标才允许发布。
          </div>

          <div className="mt-4 grid gap-3">
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value.trim().toLowerCase() })} placeholder="trusted.example.com" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
            <select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as typeof form.purpose })} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm">
              {HOST_PURPOSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="归属团队或负责人" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
            <input value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} placeholder="过期时间，可空，例如 2026-12-31" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="申请原因" className="min-h-20 rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
            <Button size="sm" onClick={submitHost} disabled={!form.host || !form.owner || !form.reason}>提交域名审核</Button>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-neutral-900">DB 审核表</h3>
            {message && <span className="text-sm font-medium text-neutral-600">{message}</span>}
          </div>
          <input value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="审核说明" className="mt-3 h-9 w-full rounded-lg border border-neutral-200 px-3 text-xs" />
          <div className="mt-3 space-y-3">
            {hosts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400">暂无域名</p>
            ) : hosts.map((host) => (
              <div key={host.id} className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-900">{host.host}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{host.purpose}</span>
                  <StatusBadge status={badgeStatus(host.status)} label={STATUS_LABELS[host.status] ?? host.status} />
                </div>
                <p className="mt-2 text-xs text-neutral-500">{host.owner} · {host.reason}</p>
                {host.expiresAt && <p className="mt-1 text-xs text-neutral-400">过期：{host.expiresAt}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {HOST_REVIEW_OPTIONS.map((option) => (
                    <Button key={option.value} size="sm" variant={option.value === 'active' ? 'secondary' : 'outline'} onClick={() => void runAction(() => toolboxService.reviewAllowedHost(host.id, { status: option.value, reason: reviewReason }), `已${option.label}`)}>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
