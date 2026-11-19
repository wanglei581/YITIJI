import { useState } from 'react'
import { XIcon } from 'lucide-react'
import type { AdminOrganizationOption } from '../../services/api/devices'
import {
  createTerminalBatch,
  issueTerminalBatchBindCodes,
  reissueTerminalBatchBindCodes,
} from '../../services/api/devices'
import {
  downloadBindCodeCsv,
  parseTerminalBatchPaste,
  type TerminalBatchBindCodeResult,
  type TerminalBatchSelectionInput,
} from '../../services/api/terminalBatch'

interface CreateProps {
  organizations: AdminOrganizationOption[]
  onClose(): void
  onCreated(batchId: string, count: number): void
  onError(message: string): void
}

export function TerminalBatchCreateDialog({ organizations, onClose, onCreated, onError }: CreateProps) {
  const [mode, setMode] = useState<'range' | 'paste'>('range')
  const [prefix, setPrefix] = useState('')
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState('3')
  const [locationLabel, setLocationLabel] = useState('')
  const [orgId, setOrgId] = useState('')
  const [paste, setPaste] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const pasteParsed = mode === 'paste' ? parseTerminalBatchPaste(paste, organizations) : null
  const pasteBlocked = (pasteParsed?.errors.length ?? 0) > 0

  async function submit() {
    if (pasteBlocked) return
    setErrorMessage(null)
    setSaving(true)
    try {
      const shared = {
        ...(locationLabel.trim() ? { locationLabel: locationLabel.trim() } : {}),
        ...(orgId ? { orgId } : {}),
      }
      const created = mode === 'range'
        ? await createTerminalBatch({
          range: {
            prefix: prefix.trim(),
            start: Number(start),
            end: Number(end),
            ...shared,
          },
        })
        : await submitPaste()
      if (!created) return
      onCreated(created.batchId, created.count)
    } catch (error) {
      const message = error instanceof Error ? error.message : '批量预建失败，请稍后重试'
      setErrorMessage(message)
      onError(message)
    } finally {
      setSaving(false)
    }
  }

  async function submitPaste() {
    const parsed = parseTerminalBatchPaste(paste, organizations)
    if (parsed.errors.length > 0) {
      const message = parsed.errors.join('；')
      setErrorMessage(message)
      onError(message)
      return null
    }
    if (parsed.rows.length === 0) {
      const message = '没有要预建的终端'
      setErrorMessage(message)
      onError(message)
      return null
    }
    return createTerminalBatch({ rows: parsed.rows })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="terminal-batch-create-title">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="terminal-batch-create-title" className="text-lg font-bold text-neutral-900">批量预建</h2>
            <p className="mt-1 text-sm text-neutral-500">一次最多 200 台。有一行不对，这一批一台都不建。</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭批量预建" className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" aria-pressed={mode === 'range'} onClick={() => setMode('range')} className={`h-10 rounded-lg px-3 text-sm font-semibold ${mode === 'range' ? 'bg-primary-600 text-white' : 'border border-neutral-200 text-neutral-700'}`}>按编号</button>
          <button type="button" aria-pressed={mode === 'paste'} onClick={() => setMode('paste')} className={`h-10 rounded-lg px-3 text-sm font-semibold ${mode === 'paste' ? 'bg-primary-600 text-white' : 'border border-neutral-200 text-neutral-700'}`}>粘贴表格</button>
        </div>
        {mode === 'range' ? (
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
              编号前缀
              <input aria-label="编号前缀" value={prefix} onChange={(event) => setPrefix(event.target.value)} maxLength={40} placeholder="例如 HALL-" className="h-10 rounded-lg border border-neutral-200 px-3 font-mono text-sm outline-none focus:border-primary-600" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
                起始编号
                <input aria-label="起始编号" value={start} onChange={(event) => setStart(event.target.value)} inputMode="numeric" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-600" />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
                结束编号
                <input aria-label="结束编号" value={end} onChange={(event) => setEnd(event.target.value)} inputMode="numeric" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-600" />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
              点位
              <input aria-label="批量点位" value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} maxLength={200} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-600" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-neutral-700">
              所属机构
              <select aria-label="批量所属机构" value={orgId} onChange={(event) => setOrgId(event.target.value)} className="h-10 rounded-lg border border-neutral-200 bg-surface px-3 text-sm outline-none focus:border-primary-600">
                <option value="">暂不绑定</option>
                {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <label className="mt-4 grid gap-1.5 text-sm font-medium text-neutral-700">
            每行一台：终端名称、点位、所属机构、打印机名。打印机名这一列先不保存。
            <textarea aria-label="粘贴终端表格" value={paste} onChange={(event) => setPaste(event.target.value)} rows={8} className="rounded-lg border border-neutral-200 px-3 py-2 font-mono text-sm outline-none focus:border-primary-600" placeholder={'大厅 1 号,一楼东侧,,\n大厅 2 号,一楼西侧,,'} />
          </label>
        )}
        {pasteBlocked && pasteParsed && <p role="alert" className="mt-3 text-sm text-error-fg">{pasteParsed.errors.join('；')}</p>}
        {errorMessage && !pasteBlocked && <p role="alert" className="mt-3 text-sm text-error-fg">{errorMessage}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-lg border border-neutral-200 px-4 text-sm font-semibold text-neutral-700">取消</button>
          <button type="button" onClick={() => void submit()} disabled={saving || pasteBlocked} className="h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? '正在预建' : '开始预建'}</button>
        </div>
      </div>
    </div>
  )
}

interface CodeProps {
  title: string
  result: TerminalBatchBindCodeResult
  onClose(): void
}

export function TerminalBatchCodeDialog({ title, result, onClose }: CodeProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="terminal-batch-code-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-200 bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="terminal-batch-code-title" className="text-lg font-bold text-neutral-900">{title}</h2>
            <p className="mt-1 text-sm text-neutral-500">绑定码只显示这一次。关掉之后只能作废并重新生成，不能再查回明文。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭绑定码结果" className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-neutral-500">
                <th className="py-2 pr-3 font-medium">终端号</th>
                <th className="py-2 pr-3 font-medium">名称</th>
                <th className="py-2 pr-3 font-medium">点位</th>
                <th className="py-2 pr-3 font-medium">绑定码</th>
                <th className="py-2 font-medium">到期时间</th>
              </tr>
            </thead>
            <tbody>
              {result.issued.map((row) => (
                <tr key={row.terminalId} className="border-t border-neutral-100">
                  <td className="py-2 pr-3 font-mono">{row.terminalCode}</td>
                  <td className="py-2 pr-3">{row.displayName || '未命名终端'}</td>
                  <td className="py-2 pr-3">{row.locationLabel || '未设置点位'}</td>
                  <td className="py-2 pr-3 font-mono" data-testid="issued-bind-code">{row.bindCode}</td>
                  <td className="py-2">{row.expiresAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.skipped.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-neutral-600">
            {result.skipped.map((row) => (
              <li key={`${row.terminalId ?? 'missing'}-${row.reason}`}>{row.terminalCode || '未找到的终端'}：{row.reason}</li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => downloadBindCodeCsv(result.issued)} disabled={result.issued.length === 0} className="h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50">下载绑定码表格</button>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-neutral-200 px-4 text-sm font-semibold text-neutral-700">关闭</button>
        </div>
      </div>
    </div>
  )
}

export async function requestBatchCodes(
  kind: 'issue' | 'reissue',
  input: TerminalBatchSelectionInput,
): Promise<TerminalBatchBindCodeResult> {
  return kind === 'issue' ? issueTerminalBatchBindCodes(input) : reissueTerminalBatchBindCodes(input)
}
