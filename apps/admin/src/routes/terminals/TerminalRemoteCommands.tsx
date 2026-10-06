import { useCallback, useEffect, useState } from 'react'
import { formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'
import { ApiHttpError } from '../../services/api/client'
import type { AdminTerminalRecord } from '../../services/api/devices'
import { terminalCommandService, type TerminalCommandType, type TerminalCommandView } from '../../services/api/terminalCommands'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { commandStatusView, commandTypeLabel, isOpenCommand, remoteCommandBlockReason } from './terminalCommandViews'

type Notice = { type: 'success' | 'error'; text: string }

const POLL_MS = 10_000

const CONFIRM_TEXT: Record<TerminalCommandType, string> = {
  restart_agent: '终端程序会重启约 1 分钟；正在打印时不会执行。',
  clear_print_queue: '会清掉这台终端打印机里还在排队、没打出来的作业，用户这些作业不会再打出。正在打印时不会执行。',
}

const ACTIONS: TerminalCommandType[] = ['restart_agent', 'clear_print_queue']

/** 终端详情抽屉「远程操作」：下发重启终端程序 / 清空打印队列，并显示最近的命令。做没做成只看列表状态。 */
export function TerminalRemoteCommands({ terminal, onNotice }: { terminal: AdminTerminalRecord; onNotice: (notice: Notice) => void }) {
  const [commands, setCommands] = useState<TerminalCommandView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<TerminalCommandType | null>(null)
  const [sending, setSending] = useState(false)
  const terminalId = terminal.id

  const refresh = useCallback(async () => {
    try {
      setCommands(await terminalCommandService.list(terminalId))
      setLoadError(null)
    } catch (error) {
      setLoadError(userMessageOf(error, '读取远程命令记录失败，请稍后重试'))
    } finally {
      setLoaded(true)
    }
  }, [terminalId])

  useEffect(() => { void refresh() }, [refresh])

  const hasOpen = commands.some(isOpenCommand)
  useEffect(() => {
    if (!hasOpen) return undefined
    const timer = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasOpen, refresh])

  useEffect(() => {
    if (!confirming) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) setConfirming(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, sending])

  const blockReason = remoteCommandBlockReason(terminal, commands)

  async function submit(type: TerminalCommandType) {
    setSending(true)
    try {
      await terminalCommandService.issue(terminalId, type)
      onNotice({ type: 'success', text: `「${commandTypeLabel(type)}」已下发，等待终端执行` })
      setConfirming(null)
      await refresh()
    } catch (error) {
      onNotice({ type: 'error', text: userMessageOf(error, '下发失败，请稍后重试') })
      setConfirming(null)
      if (error instanceof ApiHttpError && error.code === 'TERMINAL_COMMAND_PENDING') await refresh()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3" data-testid="terminal-remote-commands">
      <div className="flex flex-wrap items-center gap-2">
        {ACTIONS.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setConfirming(type)}
            disabled={!loaded || sending || blockReason !== null}
            className="inline-flex h-9 items-center rounded-md border border-neutral-200 bg-surface px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {commandTypeLabel(type)}
          </button>
        ))}
      </div>
      {blockReason && loaded && <p className="text-[11px] text-neutral-500">{blockReason}</p>}

      <div>
        <p className="mb-1 text-xs text-neutral-500">最近命令</p>
        {loadError ? (
          <p className="text-xs text-error-fg">{loadError}</p>
        ) : !loaded ? (
          <p className="text-xs text-neutral-500">正在读取…</p>
        ) : commands.length === 0 ? (
          <p className="text-xs text-neutral-500">还没有下发过远程命令</p>
        ) : (
          <ul className="divide-y divide-neutral-900/[0.06]">
            {commands.map((command) => {
              const status = commandStatusView(command)
              return (
                <li key={command.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">{commandTypeLabel(command.type)}</p>
                    <p className="text-[11px] text-neutral-500">
                      <span title={formatDateTime(command.requestedAt)}>{formatRelativeTime(command.requestedAt)}</span>
                      {' · '}{command.requestedBy?.name?.trim() || '管理员'} 下发
                      {command.finishedAt ? <span title={formatDateTime(command.finishedAt)}>{` · ${formatDateTime(command.finishedAt)} 结束`}</span> : null}
                    </p>
                  </div>
                  <StatusBadge dot status={status.badge} label={status.label} />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`${commandTypeLabel(confirming)} ${terminal.terminalCode}`}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-neutral-900">{commandTypeLabel(confirming)}</h3>
            <p className="mt-2 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-fg">{CONFIRM_TEXT[confirming]}</p>
            <p className="mt-2 text-[11px] text-neutral-500">终端 {terminal.terminalCode}。每台终端一小时最多 3 次远程命令。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={sending} onClick={() => setConfirming(null)} className="h-9 rounded-md border border-neutral-200 px-4 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">取消</button>
              <button type="button" disabled={sending} onClick={() => void submit(confirming)} className="h-9 rounded-md bg-primary-600 px-4 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {sending ? '下发中…' : `确认${commandTypeLabel(confirming)}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
