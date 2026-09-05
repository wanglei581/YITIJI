import { formatDateTime, fromDatetimeLocalValue, toDatetimeLocalValue } from '@ai-job-print/shared'
import { useState } from 'react'
import { useRefreshable } from '@ai-job-print/refresh'
import {
  createReleaseObservationPlan,
  getReleaseObservationPlans,
  updateReleaseObservationPlan,
  type AdminTerminalRecord,
  type CreateReleaseObservationPlanInput,
  type ReleaseObservationPlanRecord,
} from '../../services/api/devices'

const HASH_EMPTY = ''

function defaultObservationEndsAt(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
}

export function ReleaseObservationPanel({
  terminals,
  onNotice,
}: {
  terminals: AdminTerminalRecord[]
  onNotice: (notice: { type: 'success' | 'error'; text: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Omit<CreateReleaseObservationPlanInput, 'targets'>>({
    artifactVersion: '',
    packageSha256: HASH_EMPTY,
    runtimeManifestSha256: HASH_EMPTY,
    signerTrustLevel: 'unsigned_internal',
    signerCertificateThumbprint: '',
    targetPlatform: 'windows-x64',
    reason: '',
    observationEndsAt: defaultObservationEndsAt(),
  })
  const { data, refresh } = useRefreshable('admin:release-observation-plans', getReleaseObservationPlans, {
    intervalMs: 30_000,
    merge: (_current, incoming) => incoming,
    failPolicy: 'keep-last',
  })

  const eligible = terminals.filter((terminal) => terminal.enabled && terminal.lifecycleStatus === 'active')
  const plans = data?.plans ?? []

  function toggleTerminal(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  async function submit() {
    const targets = eligible
      .filter((terminal) => selectedIds.includes(terminal.id))
      .map((terminal) => ({ terminalId: terminal.id }))
    if (targets.length === 0) {
      onNotice({ type: 'error', text: '请选择至少一台处于运行中的终端；不会默认选择全部终端。' })
      return
    }
    setSaving(true)
    try {
      await createReleaseObservationPlan({
        ...form,
        signerCertificateThumbprint: form.signerTrustLevel === 'unsigned_internal'
          ? undefined
          : form.signerCertificateThumbprint || undefined,
        observationEndsAt: fromDatetimeLocalValue(form.observationEndsAt),
        targets,
      })
      setOpen(false)
      setSelectedIds([])
      onNotice({ type: 'success', text: '观察计划已创建为草稿。它不会向终端下载、安装或控制服务。' })
      await refresh()
    } catch (error) {
      onNotice({ type: 'error', text: error instanceof Error ? error.message : '创建观察计划失败' })
    } finally {
      setSaving(false)
    }
  }

  async function transition(plan: ReleaseObservationPlanRecord, action: 'activate' | 'pause' | 'cancel') {
    const reason = window.prompt(action === 'activate' ? '填写启用观察计划的原因（至少 8 个字符）' : '填写变更原因（至少 8 个字符）')
    if (!reason) return
    try {
      await updateReleaseObservationPlan(plan.planId, { action, expectedVersion: plan.version, reason })
      onNotice({ type: 'success', text: '观察计划状态已更新；终端不会执行安装动作。' })
      await refresh()
    } catch (error) {
      onNotice({ type: 'error', text: error instanceof Error ? error.message : '更新观察计划失败' })
    }
  }

  return (
    <section className="mt-6 border-t border-neutral-200 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">发布观察计划</h2>
          <p className="mt-1 text-xs text-neutral-500">只记录指定终端的安装 manifest 版本，不下载、不安装、不改变 Windows 服务，也不验证制品字节或签名链。</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          {open ? '收起草稿' : '新建观察计划'}
        </button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3 border border-neutral-200 p-4 md:grid-cols-2">
          <input value={form.artifactVersion} onChange={(e) => setForm((current) => ({ ...current, artifactVersion: e.target.value }))} placeholder="制品版本，例如 0.4.11" className="h-9 border border-neutral-200 px-2 text-sm" />
          <select value={form.signerTrustLevel} onChange={(e) => setForm((current) => ({ ...current, signerTrustLevel: e.target.value as CreateReleaseObservationPlanInput['signerTrustLevel'] }))} className="h-9 border border-neutral-200 bg-surface px-2 text-sm">
            <option value="unsigned_internal">未签名内部候选</option>
            <option value="internal_self_signed">内部自签名</option>
            <option value="enterprise_signed">企业签名</option>
          </select>
          <input value={form.packageSha256} onChange={(e) => setForm((current) => ({ ...current, packageSha256: e.target.value }))} placeholder="安装包 SHA-256（64 位）" className="h-9 border border-neutral-200 px-2 font-mono text-xs" />
          <input value={form.runtimeManifestSha256} onChange={(e) => setForm((current) => ({ ...current, runtimeManifestSha256: e.target.value }))} placeholder="manifest SHA-256（64 位）" className="h-9 border border-neutral-200 px-2 font-mono text-xs" />
          {form.signerTrustLevel !== 'unsigned_internal' && <input value={form.signerCertificateThumbprint} onChange={(e) => setForm((current) => ({ ...current, signerCertificateThumbprint: e.target.value }))} placeholder="Windows Authenticode 证书指纹（40 位）" className="h-9 border border-neutral-200 px-2 font-mono text-xs" />}
          <input type="datetime-local" value={form.observationEndsAt} onChange={(e) => setForm((current) => ({ ...current, observationEndsAt: e.target.value }))} className="h-9 border border-neutral-200 px-2 text-sm" />
          <textarea value={form.reason} onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))} placeholder="观察原因（至少 8 个字符）" className="min-h-20 border border-neutral-200 p-2 text-sm md:col-span-2" />
          <div className="md:col-span-2">
            <p className="mb-2 text-xs font-medium text-neutral-700">明确目标终端</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {eligible.map((terminal) => (
                <label key={terminal.id} className="flex items-center gap-2 border border-neutral-200 px-2 py-2 text-xs text-neutral-700">
                  <input type="checkbox" checked={selectedIds.includes(terminal.id)} onChange={() => toggleTerminal(terminal.id)} />
                  <span className="font-mono">{terminal.terminalCode}</span>
                  <span className="truncate text-neutral-500">{terminal.agentVersion ?? '心跳版本未知'}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end md:col-span-2">
            <button type="button" disabled={saving} onClick={() => void submit()} className="h-8 bg-primary-600 px-3 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {saving ? '创建中' : '保存为草稿'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto border border-neutral-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-50 text-neutral-500"><tr><th className="px-3 py-2">目标版本</th><th className="px-3 py-2">签名级别</th><th className="px-3 py-2">目标与状态</th><th className="px-3 py-2">观察截止</th><th className="px-3 py-2">操作</th></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {plans.map((plan) => (
              <tr key={plan.planId}>
                <td className="px-3 py-2 font-mono">{plan.targetVersion}<div className="text-neutral-400">{plan.status} v{plan.version}</div></td>
                <td className="px-3 py-2">{plan.signerTrustLevel}</td>
                <td className="px-3 py-2">{plan.targets.map((target) => `${target.terminalCode}: ${target.state}`).join('；')}</td>
                <td className="px-3 py-2">{formatDateTime(plan.observationEndsAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {plan.status !== 'active' && plan.status !== 'cancelled' && <button type="button" onClick={() => void transition(plan, 'activate')} className="text-primary-700 hover:underline">启用观察</button>}
                    {plan.status === 'active' && <button type="button" onClick={() => void transition(plan, 'pause')} className="text-warning-fg hover:underline">暂停</button>}
                    {plan.status !== 'cancelled' && <button type="button" onClick={() => void transition(plan, 'cancel')} className="text-error-fg hover:underline">取消</button>}
                  </div>
                </td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-500">暂无观察计划</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
