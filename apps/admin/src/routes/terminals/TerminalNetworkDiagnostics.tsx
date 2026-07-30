import { StatusBadge } from '@ai-job-print/ui'

type BadgeStatus = 'success' | 'warning' | 'error' | 'default'

interface TerminalNetworkDiagnosticsProps {
  online: boolean
  wiredNetworkStatus: string | null
  printerNetworkStatus: string | null
}

const WIRED_VIEW: Record<'connected' | 'disconnected' | 'unknown', { label: string; status: BadgeStatus }> = {
  connected: { label: '网线已连', status: 'success' },
  disconnected: { label: '网线未连', status: 'error' },
  unknown: { label: '网线未知', status: 'default' },
}

const PRINTER_VIEW: Record<'reachable' | 'unreachable' | 'not_network_printer' | 'unknown', { label: string; status: BadgeStatus }> = {
  reachable: { label: '打印机可达', status: 'success' },
  unreachable: { label: '打印机不可达', status: 'error' },
  not_network_printer: { label: '非网络端口', status: 'default' },
  unknown: { label: '打印机链路未知', status: 'default' },
}

function wiredStatus(value: string | null): keyof typeof WIRED_VIEW {
  return value === 'connected' || value === 'disconnected' ? value : 'unknown'
}

function printerStatus(value: string | null): keyof typeof PRINTER_VIEW {
  return value === 'reachable' || value === 'unreachable' || value === 'not_network_printer'
    ? value
    : 'unknown'
}

export function TerminalNetworkDiagnostics({
  online,
  wiredNetworkStatus,
  printerNetworkStatus,
}: TerminalNetworkDiagnosticsProps) {
  const cloud = online
    ? { label: '云端已连', status: 'success' as const }
    : { label: '云端未连', status: 'error' as const }
  // A disconnected Agent cannot provide a current local observation. Do not render
  // a stale heartbeat value as the terminal's present wired/printer state.
  const wired = WIRED_VIEW[online ? wiredStatus(wiredNetworkStatus) : 'unknown']
  const printer = PRINTER_VIEW[online ? printerStatus(printerNetworkStatus) : 'unknown']

  return (
    <div className="min-w-[132px] space-y-1.5" aria-label="只读网络链路诊断">
      <StatusBadge dot status={cloud.status} label={cloud.label} />
      <StatusBadge dot status={wired.status} label={wired.label} />
      <StatusBadge dot status={printer.status} label={printer.label} />
    </div>
  )
}
