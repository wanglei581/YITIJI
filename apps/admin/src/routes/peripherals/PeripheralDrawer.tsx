import { formatDateTime } from '@ai-job-print/shared'
import { Drawer, StatusBadge } from '@ai-job-print/ui'
import type { AdminTerminalRecord } from '../../services/api/devices'
import { UNREPORTED_PERIPHERALS, peripheralItems } from './peripheralViews'

function timeText(iso: string | null): string {
  if (!iso) return '无记录'
  return formatDateTime(iso, { fallback: '无记录' })
}

export function PeripheralDrawer({ terminal, onClose }: { terminal: AdminTerminalRecord | null; onClose: () => void }) {
  if (!terminal) return <Drawer open={false} onClose={onClose} title="外设详情"><div /></Drawer>
  const items = peripheralItems(terminal)
  return (
    <Drawer open onClose={onClose} title={`${terminal.displayName || terminal.terminalCode} · 外设状态`} size="md">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          <span className="font-mono">{terminal.terminalCode}</span>
          {terminal.orgName ? ` · ${terminal.orgName}` : ' · 未绑定机构'}
          {terminal.locationLabel ? ` · ${terminal.locationLabel}` : ''}
        </p>
        {items.map((item) => (
          <section key={item.key} className="rounded-[10px] border border-neutral-900/[0.08] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-bold text-neutral-800">{item.name}</h3>
              <StatusBadge dot status={item.badge} label={item.label} />
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-neutral-500">原因</dt>
                <dd className="text-neutral-700">{item.reason ?? '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-neutral-500">观测时间</dt>
                <dd className="tabular-nums text-neutral-700">{timeText(item.observedAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-neutral-500">处置建议</dt>
                <dd className={item.advice ? 'font-medium text-warning-fg' : 'text-neutral-500'}>{item.advice ?? (item.badge === 'success' ? '无需处理' : '—')}</dd>
              </div>
            </dl>
          </section>
        ))}
        <section className="rounded-[10px] border border-dashed border-neutral-900/[0.12] px-4 py-3 text-xs text-neutral-500">
          <h3 className="text-[13px] font-bold text-neutral-700">{UNREPORTED_PERIPHERALS.join('、')}</h3>
          <p className="mt-1 leading-relaxed">
            不上报：这四类由一体机本地使用，Terminal Agent 目前不向云端上报它们的状态，后台看不到好坏，
            只能按外设现场验收清单到现场检查。
          </p>
        </section>
      </div>
    </Drawer>
  )
}
