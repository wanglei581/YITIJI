import type { ReactNode } from 'react'
import { Card } from '@ai-job-print/ui'
import { ActivityIcon, BotIcon, PrinterIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import type { PartnerTerminalOpsView } from '../../services/api/terminalOps'
import {
  FAULTS_NOT_REPORTED,
  METRIC_NOTES,
  VISIT_NOT_STARTED_NOTE,
  countText,
  minutesText,
  rateText,
  totalsFaultsReported,
  unavailableReason,
  visitText,
} from './terminalOpsFormat'

function MetricCard({
  icon: Icon,
  title,
  tone,
  children,
  note,
}: {
  icon: LucideIcon
  title: string
  tone: string
  children: ReactNode
  note: string
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] ${tone}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-[13px] font-bold text-neutral-800">{title}</h2>
      </div>
      <div className="min-h-[76px] space-y-1.5 text-sm text-neutral-600">{children}</div>
      <p className="border-t border-neutral-900/[0.06] pt-2.5 text-xs leading-relaxed text-neutral-500">{note}</p>
    </Card>
  )
}

function BigValue({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={`text-[1.5rem] font-bold leading-none tabular-nums ${muted ? 'text-neutral-400' : 'text-neutral-900'}`}>
      {children}
    </p>
  )
}

export function TerminalOpsCards({ data }: { data: PartnerTerminalOpsView }) {
  const { totals } = data
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={UsersIcon} title="服务人次" tone="bg-info-bg text-info-fg" note={METRIC_NOTES.visit}>
        <BigValue muted={!data.visitCount.recordingStarted || totals.visitCount === null}>{visitText(data, totals.visitCount)}</BigValue>
        {!data.visitCount.recordingStarted && <p className="text-xs text-neutral-500">{VISIT_NOT_STARTED_NOTE}</p>}
        <p>
          打印扫描服务次数 <strong className="tabular-nums text-neutral-900">{countText(totals.serviceCount)}</strong>
          <span className="text-xs text-neutral-500">（按任务计，不等于人次）</span>
        </p>
      </MetricCard>

      <MetricCard icon={PrinterIcon} title="出纸成功率" tone="bg-primary-50 text-primary-600" note={METRIC_NOTES.output}>
        <BigValue muted={totals.output.successRate === null}>{rateText(totals.output)}</BigValue>
        <p>
          出纸成功 <strong className="tabular-nums text-neutral-900">{countText(totals.output.printed)}</strong>
          {' / '}已结束 <strong className="tabular-nums text-neutral-900">{countText(totals.output.settled)}</strong>
        </p>
        <p>
          超时未确认、待现场核查 <strong className="tabular-nums text-neutral-900">{countText(totals.output.unconfirmed)}</strong>
        </p>
      </MetricCard>

      <MetricCard icon={BotIcon} title="AI 可用率" tone="bg-neutral-100 text-neutral-500" note={METRIC_NOTES.ai}>
        <BigValue muted>暂不能统计</BigValue>
        <p className="text-xs text-neutral-500">暂不能按本机构终端统计。{unavailableReason(data.aiAvailability)}</p>
      </MetricCard>

      <MetricCard icon={ActivityIcon} title="故障与恢复" tone="bg-warning-bg text-warning-fg" note={METRIC_NOTES.faults}>
        {!totalsFaultsReported(data) ? (
          <>
            <BigValue muted>无法统计</BigValue>
            <p className="text-xs text-neutral-500">本机构终端{FAULTS_NOT_REPORTED}（从未连接或整段离线），不能说没有故障。</p>
          </>
        ) : (
        <>
        <p>
          离线 <strong className="tabular-nums text-neutral-900">{totals.faults.offlineCount}</strong> 次，共 {minutesText(totals.faults.offlineMinutes)}
        </p>
        <p>
          打印机故障 <strong className="tabular-nums text-neutral-900">{totals.faults.printerFaultCount}</strong> 次，共 {minutesText(totals.faults.printerFaultMinutes)}
        </p>
        <p>
          已恢复 {totals.faults.recoveredCount} 次
          {totals.faults.avgRecoveryMinutes !== null && <>，平均 {totals.faults.avgRecoveryMinutes} 分钟恢复</>}
          {totals.faults.longestMinutes !== null && <>，最长一次 {minutesText(totals.faults.longestMinutes)}</>}
        </p>
        <p className={totals.unrecoveredTerminals > 0 ? 'font-semibold text-error-fg' : 'text-neutral-500'}>
          {totals.unrecoveredTerminals > 0
            ? `截至昨天有 ${totals.unrecoveredTerminals} 台未恢复`
            : totals.silentTerminals > 0 ? '已上报的终端截至昨天没有未恢复的故障' : '截至昨天没有未恢复的故障'}
        </p>
        {totals.silentTerminals > 0 && (
          <p className="text-xs font-medium text-warning-fg">
            另有 {totals.silentTerminals} 台{FAULTS_NOT_REPORTED}，未计入以上数字。
          </p>
        )}
        </>
        )}
      </MetricCard>
    </div>
  )
}
