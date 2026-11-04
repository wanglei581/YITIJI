import { formatCount } from '@ai-job-print/shared'
import type { AdminPrinterOutput, AdminPrintersResponse } from '../../services/api/types'

const muted = 'text-xs text-neutral-500'

function sidesLine(label: string, bucket: AdminPrinterOutput['today']): string {
  return `${label} ${formatCount(bucket.sides)} 面（彩色 ${formatCount(bucket.colorSides)} · 双面 ${formatCount(bucket.duplexSides)}）`
}

export function PrinterOutputCell({
  output,
  outputStatus,
}: {
  output: AdminPrinterOutput | null | undefined
  outputStatus?: AdminPrintersResponse['outputStatus']
}) {
  if (outputStatus === 'capped') {
    return <span className={muted}>数据量超出统计上限，没给数</span>
  }
  if (output == null) {
    return <span className={muted}>暂时读不到</span>
  }
  return (
    <div className="text-xs leading-relaxed">
      <div>{sidesLine('今天', output.today)}</div>
      <div>{sidesLine('本月', output.month)}</div>
      {output.monthUnconfirmedTasks > 0 ? (
        <p className={muted}>本月另有 {formatCount(output.monthUnconfirmedTasks)} 笔出纸未确认，没算进去</p>
      ) : null}
    </div>
  )
}
