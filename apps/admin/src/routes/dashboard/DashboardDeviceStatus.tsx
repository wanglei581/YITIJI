import { formatCount } from '@ai-job-print/shared'
import { SectionCard } from '@ai-job-print/ui'
import type { AdminPrinterRecord, AdminTerminalRecord } from '../../services/api/devices'
import { BlockError } from './DashboardWidgets'

function supplyLine(printers: AdminPrinterRecord[]): string {
  let faults = 0
  let low = 0
  for (const printer of printers) {
    const jammed = printer.paperStatus === 'jam'
    if (printer.status === 'error' || jammed) faults += 1
    else if (
      printer.paperStatus === 'low'
      || printer.paperStatus === 'empty'
      || (printer.tonerLevel !== null && printer.tonerLevel < 20)
    ) low += 1
  }
  const parts: string[] = []
  if (faults > 0) parts.push(`故障 ${formatCount(faults)} 台`)
  if (low > 0) parts.push(`纸张或墨粉不足 ${formatCount(low)} 台`)
  const status = parts.length > 0 ? `${parts.join('，')}。` : '当前没有故障，也没有纸张或墨粉不足。'
  return low > 0 ? `${status}不足的仍可打印。` : status
}

export function DashboardDeviceStatus({
  terminals,
  printers,
  terminalError,
  printerError,
  terminalLoading,
  printerLoading,
  onRetryTerminals,
  onRetryPrinters,
}: {
  terminals: AdminTerminalRecord[] | null
  printers: AdminPrinterRecord[] | null
  terminalError: boolean
  printerError: boolean
  terminalLoading: boolean
  printerLoading: boolean
  onRetryTerminals: () => void
  onRetryPrinters: () => void
}) {
  const online = terminals?.filter((terminal) => terminal.online).length ?? 0
  return (
    <SectionCard title="设备现在">
      <div className="flex flex-col gap-3" role="region" aria-label="设备现在">
        {terminalLoading && terminals === null ? (
          <p className="text-sm text-neutral-500">正在读取终端</p>
        ) : terminalError || terminals === null ? (
          <BlockError message="这类这次没读到" onRetry={onRetryTerminals} />
        ) : (
          <a
            href="/devices"
            aria-label="在线终端，进入设备管理"
            className="inline-flex min-h-11 items-center text-sm font-bold text-primary-700 hover:underline"
          >
            在线终端 {formatCount(online)} / {formatCount(terminals.length)} 台
          </a>
        )}
        <p className="text-xs leading-relaxed text-neutral-500">
          这里的在线按终端名单计算，和设备总览的统计窗口可能不同。
        </p>
        {printerLoading && printers === null ? (
          <p className="text-sm text-neutral-500">正在读取打印机</p>
        ) : printerError || printers === null ? (
          <BlockError message="这类这次没读到" onRetry={onRetryPrinters} />
        ) : (
          <p className="text-sm text-neutral-700">{supplyLine(printers)}</p>
        )}
      </div>
    </SectionCard>
  )
}
