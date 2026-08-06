import { useState } from 'react'
import { XIcon } from 'lucide-react'
import {
  createPlannedTerminal,
  type AdminOrganizationOption,
} from '../../services/api/devices'

interface Props {
  organizations: AdminOrganizationOption[]
  onClose(): void
  onCreated(terminalCode: string): void
  onError(message: string): void
}

export function CreatePlannedTerminalDialog({ organizations, onClose, onCreated, onError }: Props) {
  const [terminalCode, setTerminalCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [locationLabel, setLocationLabel] = useState('')
  const [orgId, setOrgId] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function submit() {
    if (!terminalCode.trim()) return
    setErrorMessage(null)
    setSaving(true)
    try {
      const created = await createPlannedTerminal({
        terminalCode: terminalCode.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(locationLabel.trim() ? { locationLabel: locationLabel.trim() } : {}),
        ...(orgId ? { orgId } : {}),
      })
      onCreated(created.terminalCode)
    } catch (error) {
      const message = error instanceof Error ? error.message : '预创建设备失败，请稍后重试'
      setErrorMessage(message)
      onError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="planned-terminal-title">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="planned-terminal-title" className="text-lg font-bold text-neutral-900">预创建设备</h2>
            <p className="mt-1 text-sm text-neutral-500">这里只创建设备资产，不签发凭证。创建后请从设备行生成一次性绑定码完成激活。</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭" className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
            终端编号 <span className="text-error">*</span>
            <input value={terminalCode} onChange={(e) => setTerminalCode(e.target.value)} maxLength={64} placeholder="例如 KSK-011" className="h-10 rounded-lg border border-neutral-200 px-3 font-mono text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
            设备名称
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} placeholder="例如 就业服务大厅 2 号机" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
            摆放位置
            <input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} maxLength={200} placeholder="例如 一楼东侧服务区" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
            所属机构
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="h-10 rounded-lg border border-neutral-200 bg-surface px-3 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15">
              <option value="">暂不绑定</option>
              {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
        </div>

        {errorMessage ? (
          <p role="alert" className="mt-4 rounded-lg border border-error/20 bg-error-bg px-3 py-2 text-sm text-error-fg">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">取消</button>
          <button type="button" onClick={() => void submit()} disabled={saving || !terminalCode.trim()} className="h-9 rounded-lg bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '创建中…' : '创建设备'}</button>
        </div>
      </div>
    </div>
  )
}
