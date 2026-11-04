import { formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'
import { describePrinterQueue, type PrinterQueuePresentation, type PrinterQueueReport } from './printerQueueView'

const NOTE = '终端程序问 Windows 得到的原值，用来分清是打印机、打印队列还是 Windows 打印服务出了问题；后台只看不改。'

function OfflineQueue({ view, observedAt }: { view: PrinterQueuePresentation; observedAt: string | null }) {
  return (
    <div className="space-y-1">
      <StatusBadge dot status="default" label={view.statusLabel ?? '终端离线'} />
      {view.historyLabel && (
        <p className="text-[11px] text-neutral-500" title={observedAt ? formatDateTime(observedAt) : undefined}>
          离线前最后一次上报：{view.historyLabel}{observedAt ? `（${formatRelativeTime(observedAt)}）` : ''}
        </p>
      )}
    </div>
  )
}

function CurrentQueue({ view }: { view: PrinterQueuePresentation }) {
  if (view.missing) return <p className="text-sm text-neutral-600">{view.missing}</p>
  return (
    <div className="space-y-1.5 text-sm text-neutral-800">
      <p>队列名：{view.queueName}</p>
      <p>端口：{view.portText}</p>
      <div className="flex flex-wrap items-center gap-2" title="Spooler">
        <span>Windows 打印服务</span>
        <StatusBadge dot status={view.spoolerBadge ?? 'default'} label={view.spoolerLabel ?? '读不到'} />
      </div>
      {view.spoolerDetail && <p className="text-xs text-error-fg">{view.spoolerDetail}</p>}
      <p className="text-xs leading-5 text-neutral-700" title={view.rawTitle || undefined}>驱动原值：{view.rawText}</p>
    </div>
  )
}

export function TerminalPrinterQueue({
  online,
  printerQueue,
  observedAt,
}: {
  online: boolean
  printerQueue: PrinterQueueReport | null
  observedAt: string | null
}) {
  const view = describePrinterQueue(online, printerQueue)
  return (
    <div data-testid="terminal-printer-queue">
      <p className="mb-1 text-xs text-neutral-500">打印队列</p>
      <p className="mb-2 text-[11px] leading-5 text-neutral-500">{NOTE}</p>
      {view.current ? <CurrentQueue view={view} /> : <OfflineQueue view={view} observedAt={observedAt} />}
    </div>
  )
}
