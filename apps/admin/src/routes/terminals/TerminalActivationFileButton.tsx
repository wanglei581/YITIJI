import { formatDateTime } from '@ai-job-print/shared'
import { FileDownIcon } from 'lucide-react'
import { useState } from 'react'
import { createActivationFile, type AdminTerminalRecord } from '../../services/api/devices'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { downloadActivationFile } from './downloadActivationFile'

const TTL_OPTIONS = [
  { minutes: 60, label: '1 小时' },
  { minutes: 1440, label: '24 小时' },
  { minutes: 4320, label: '72 小时' },
] as const

/**
 * 生成激活文件。确认后把响应 data 原样下载，页面状态只留到期时间。
 * 不按所选时长自己算到期时间：服务端会按上限截断。
 */
export function TerminalActivationFileButton({ terminal }: { terminal: AdminTerminalRecord }) {
  const [open, setOpen] = useState(false)
  const [ttlMinutes, setTtlMinutes] = useState<number>(1440)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<string | null>(null)

  if (terminal.lifecycleStatus === 'retired') return null

  const eligible = terminal.lifecycleStatus === 'planned' || terminal.lifecycleStatus === 'maintenance'

  async function confirm() {
    setSaving(true)
    setError(null)
    try {
      const data = await createActivationFile(terminal.id, ttlMinutes)
      const expiresAt = downloadActivationFile(data)
      setGeneratedExpiresAt(expiresAt)
      setOpen(false)
    } catch (caught) {
      setError(userMessageOf(caught, '生成激活文件失败，请稍后重试'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="terminal-activation-file" className="mt-3">
      <button
        type="button"
        disabled={!eligible || saving}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-3 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FileDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
        生成激活文件
      </button>
      <p className="mt-1 text-[11px] text-neutral-500">重新生成会作废之前的激活文件</p>
      {!eligible && (
        <p className="mt-1 text-[11px] text-neutral-500">终端须先设为「待安装」或「维护中」</p>
      )}
      {generatedExpiresAt && (
        <p className="mt-1 text-[11px] text-success-fg">已生成，到期时间 {formatDateTime(generatedExpiresAt)}</p>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`生成激活文件 ${terminal.terminalCode}`}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-neutral-900">生成激活文件</h3>
            <p className="mt-2 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-fg">
              重新生成会作废这台终端之前的激活文件。激活文件等同一次性密码，不要发进聊天，只用 U 盘拷到这台机器。
            </p>
            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-neutral-700">有效期</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {TTL_OPTIONS.map((option) => (
                  <label key={option.minutes} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-xs text-neutral-800">
                    <input
                      type="radio"
                      name={`activation-ttl-${terminal.id}`}
                      checked={ttlMinutes === option.minutes}
                      disabled={saving}
                      onChange={() => setTtlMinutes(option.minutes)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-neutral-500">实际到期时间以生成结果为准</p>
            </fieldset>
            {error && <p className="mt-3 rounded-md bg-error-bg px-3 py-2 text-xs text-error-fg">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
                className="h-9 rounded-md border border-neutral-200 px-4 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirm()}
                className="h-9 rounded-md bg-primary-600 px-4 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? '生成中…' : '确认生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
