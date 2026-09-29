import type { ReactNode } from 'react'
import { Drawer, StatusBadge } from '@ai-job-print/ui'
import type { TerminalOpsRow } from '../../services/api/terminalOps'
import {
  METRIC_NOTES,
  RUN_STATE_VIEW,
  countText,
  minutesText,
  rateText,
  relativeTime,
  runState,
  shanghaiDateTime,
  terminalName,
  VISIT_NOT_STARTED,
} from './terminalOpsFormat'

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-neutral-900">{children}</dd>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">{title}</h3>
      <dl className="mt-1 divide-y divide-neutral-900/[0.06]">{children}</dl>
      {note && <p className="mt-2 text-xs leading-relaxed text-neutral-500">{note}</p>}
    </section>
  )
}

export function TerminalOpsDrawer({
  row,
  windowLabel,
  visitRecordingStarted,
  onClose,
}: {
  row: TerminalOpsRow | null
  windowLabel: string
  /** 本机构终端是否已开始上报会话；还没开始时服务人次写「暂无」 */
  visitRecordingStarted: boolean
  onClose: () => void
}) {
  if (!row) return <Drawer open={false} onClose={onClose} title="终端详情"><div /></Drawer>
  const state = RUN_STATE_VIEW[runState(row)]
  const faults = row.faults
  return (
    <Drawer open onClose={onClose} title={terminalName(row)} size="md">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <StatusBadge dot status={state.status} label={state.label} />
          <span className="font-mono text-xs text-neutral-500">{row.terminalCode}</span>
          <span className="text-xs text-neutral-500">{row.locationLabel || '未填写摆放位置'}</span>
        </div>
        <p className="text-xs text-neutral-500">统计窗口：{windowLabel}</p>

        <Section title="当前状态">
          <Item label="最后心跳">
            {row.lastHeartbeatAt ? `${shanghaiDateTime(row.lastHeartbeatAt)}（${relativeTime(row.lastHeartbeatAt)}）` : '从未上报'}
          </Item>
          <Item label="统计期内有上报">{faults.reportedInWindow ? '有' : '一次都没有'}</Item>
        </Section>

        <Section title="服务人次" note={METRIC_NOTES.visit}>
          <Item label="服务人次">{visitRecordingStarted ? countText(row.visitCount) : VISIT_NOT_STARTED}</Item>
        </Section>

        <Section title="打印扫描服务" note={METRIC_NOTES.service}>
          <Item label="服务次数（按任务计）">{countText(row.serviceCount)}</Item>
        </Section>

        <Section title="出纸" note={METRIC_NOTES.output}>
          <Item label="出纸成功率">{rateText(row.output)}</Item>
          <Item label="出纸成功 / 已结束">{countText(row.output.printed)} / {countText(row.output.settled)}</Item>
          <Item label="超时未确认、待现场核查">{countText(row.output.unconfirmed)}</Item>
        </Section>

        <Section title="故障与恢复" note={METRIC_NOTES.faults}>
          <Item label="离线">{faults.offlineCount} 次，共 {minutesText(faults.offlineMinutes)}</Item>
          <Item label="打印机故障">{faults.printerFaultCount} 次，共 {minutesText(faults.printerFaultMinutes)}</Item>
          <Item label="已恢复">{faults.recoveredCount} 次</Item>
          <Item label="平均恢复用时">{faults.avgRecoveryMinutes === null ? '—' : `${faults.avgRecoveryMinutes} 分钟`}</Item>
          <Item label="最长一次">{minutesText(faults.longestMinutes)}</Item>
          <Item label="当前">
            {faults.unrecovered
              ? <span className="text-error-fg">仍未恢复（时长算到现在）</span>
              : '没有未恢复的故障'}
          </Item>
        </Section>

        <p className="text-xs leading-relaxed text-neutral-500">
          {METRIC_NOTES.sample}终端的维修、换机与绑定由平台处理；发现长时间离线请联系平台运维。
        </p>
      </div>
    </Drawer>
  )
}
