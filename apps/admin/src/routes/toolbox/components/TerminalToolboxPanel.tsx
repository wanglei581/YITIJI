import { Card } from '@ai-job-print/ui'
import type { ToolboxTerminalView } from '@ai-job-print/shared'
import { TerminalToolboxRow } from './TerminalToolboxRow'

export function TerminalToolboxPanel({
  terminals,
  loading,
  error,
  onReload,
}: {
  terminals: ToolboxTerminalView[]
  loading: boolean
  error: string
  onReload: () => void
}) {
  if (loading) return <p className="text-sm text-gray-400">加载中…</p>
  if (error) return <Card className="p-6 text-center text-sm text-gray-500">{error}</Card>
  if (terminals.length === 0) return <Card className="p-10 text-center text-sm text-gray-500">暂无终端</Card>

  return (
    <div className="space-y-4">
      {terminals.map((terminal) => (
        <TerminalToolboxRow key={terminal.terminalId} terminal={terminal} onSaved={onReload} />
      ))}
    </div>
  )
}
