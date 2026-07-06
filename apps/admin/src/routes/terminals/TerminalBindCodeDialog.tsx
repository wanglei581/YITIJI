import { useEffect, useMemo, useState } from 'react'
import { CopyIcon, KeyRoundIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { API_BASE_URL, API_MODE } from '../../services/api/client'
import {
  createTerminalBindCode,
  type AdminTerminalRecord,
  type TerminalBindCodeCreated,
} from '../../services/api/devices'

const DEFAULT_PRODUCTION_API_BASE_URL = 'http://120.48.13.190/api/v1'

type Notice = { type: 'success' | 'error'; text: string }

interface TerminalBindCodeDialogProps {
  terminal: AdminTerminalRecord
  onClose: () => void
  onNotice: (notice: Notice) => void
}

function formatCountdown(remainSec: number): string {
  if (remainSec <= 0) return '已过期'
  const m = Math.floor(remainSec / 60)
  const s = remainSec % 60
  if (m > 0) return `${m}分${String(s).padStart(2, '0')}秒`
  return `${s} 秒`
}

function commandApiBaseUrl(): string {
  if (API_MODE !== 'http') return '<你的生产 API>'
  if (/^https?:\/\//i.test(API_BASE_URL)) return API_BASE_URL
  return DEFAULT_PRODUCTION_API_BASE_URL
}

function buildInstallCommand(bindCode: TerminalBindCodeCreated): string {
  return [
    'powershell -ExecutionPolicy Bypass -File .\\apps\\terminal-agent\\scripts\\install-production-agent.ps1',
    `-ApiBaseUrl "${commandApiBaseUrl()}"`,
    `-TerminalCode "${bindCode.terminalCode}"`,
    `-TerminalId "${bindCode.terminalId}"`,
    `-BindCode "${bindCode.bindCode}"`,
    '-PrinterName "<Windows 实际打印机名>"',
  ].join(' `\n  ')
}

export function TerminalBindCodeDialog({ terminal, onClose, onNotice }: TerminalBindCodeDialogProps) {
  const [bindCodeDraft, setBindCodeDraft] = useState<TerminalBindCodeCreated | null>(null)
  const [bindCodeTtlMin, setBindCodeTtlMin] = useState<number>(10)
  const [bindCodeSaving, setBindCodeSaving] = useState(false)
  const [bindCodeError, setBindCodeError] = useState<string | null>(null)
  const [bindCodeCountdown, setBindCodeCountdown] = useState<number>(0)
  const [bindCodeCopied, setBindCodeCopied] = useState(false)

  const installCommand = useMemo(
    () => bindCodeDraft ? buildInstallCommand(bindCodeDraft) : '',
    [bindCodeDraft],
  )

  useEffect(() => {
    if (!bindCodeDraft) {
      setBindCodeCountdown(0)
      return
    }
    const target = new Date(bindCodeDraft.expiresAt).getTime()
    if (Number.isNaN(target)) {
      setBindCodeCountdown(0)
      return
    }
    const tick = () => {
      const remain = Math.max(0, Math.floor((target - Date.now()) / 1000))
      setBindCodeCountdown(remain)
    }
    tick()
    const handle = window.setInterval(tick, 1000)
    return () => window.clearInterval(handle)
  }, [bindCodeDraft])

  async function generateBindCode() {
    setBindCodeSaving(true)
    setBindCodeError(null)
    try {
      const created = await createTerminalBindCode(terminal.terminalCode, bindCodeTtlMin)
      setBindCodeDraft(created)
      setBindCodeCopied(false)
      onNotice({
        type: 'success',
        text: `已为终端 ${created.terminalCode} 生成绑定码；明文仅在本对话框显示，请立即复制。`,
      })
    } catch (e) {
      setBindCodeError(e instanceof Error ? e.message : '生成绑定码失败，请稍后重试')
    } finally {
      setBindCodeSaving(false)
    }
  }

  async function copyBindCode() {
    if (!bindCodeDraft) return
    const value = bindCodeDraft.bindCode
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = value
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setBindCodeCopied(true)
      window.setTimeout(() => setBindCodeCopied(false), 3000)
    } catch {
      setBindCodeCopied(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`为终端 ${terminal.terminalCode} 生成绑定码`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!bindCodeDraft) onClose()
      }}
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">生成一次性绑定码</h3>
            <p className="mt-1 text-xs text-gray-500">
              终端 <span className="font-mono">{terminal.terminalCode}</span>
              {terminal.displayName ? ` · ${terminal.displayName}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭绑定码弹窗"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {!bindCodeDraft ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              绑定码仅返回一次，关闭弹窗后无法再次查看；请在 Windows 一体机上运行<br />
              <code className="rounded bg-amber-100 px-1.5 py-0.5">install-production-agent.ps1 -BindCode "&lt;一次性码&gt;"</code><br />
              完成首次授权。建议先在 Windows 端核对打印机名后再生成码，避免码过期浪费。
            </div>
            <label className="block">
              <span className="text-xs font-medium text-gray-700">有效时长（分钟，最长 60）</span>
              <input
                type="number"
                min={1}
                max={60}
                value={bindCodeTtlMin}
                onChange={(e) => {
                  const next = Math.max(1, Math.min(60, Number(e.target.value) || 1))
                  setBindCodeTtlMin(next)
                }}
                disabled={bindCodeSaving}
                className="mt-1 h-9 w-full rounded-md border border-gray-200 px-3 text-sm text-gray-700 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200 disabled:opacity-50"
              />
            </label>
            {bindCodeError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{bindCodeError}</p>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={bindCodeSaving}
                className="h-9 rounded-md border border-gray-200 px-4 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={generateBindCode}
                disabled={bindCodeSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <KeyRoundIcon className="h-3.5 w-3.5" />
                {bindCodeSaving ? '生成中...' : '生成绑定码'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              已生成绑定码，请在 <span className="font-semibold">{formatCountdown(bindCodeCountdown)}</span> 内复制并完成 Windows 一体机授权。
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-gray-700">一次性绑定码（终端）</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base text-gray-900">
                  {bindCodeDraft.bindCode}
                </code>
                <button
                  type="button"
                  onClick={copyBindCode}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                  {bindCodeCopied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">过期时间：{new Date(bindCodeDraft.expiresAt).toLocaleString('zh-CN')}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-600">
              <p className="font-medium text-gray-700">Windows 一体机上推荐的安装命令</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-gray-700">{installCommand}</pre>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md border border-gray-200 px-4 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                我已经复制，关闭
              </button>
              <button
                type="button"
                onClick={generateBindCode}
                disabled={bindCodeSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <RefreshCwIcon className="h-3.5 w-3.5" />
                {bindCodeSaving ? '重新生成中...' : '重新生成'}
              </button>
            </div>
            <p className="text-[11px] text-gray-400">
              生成新的绑定码后，旧码立即失效。同终端同时只能有一个有效绑定码。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
