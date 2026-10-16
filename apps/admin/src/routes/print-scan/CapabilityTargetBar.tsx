// 设备能力页的目标行：选中终端后展示这台机器是谁，并承接登记前的确认。
import { printerStatusView } from '../terminals/terminalStatusViews'

interface CapabilityTargetIdentity {
  displayName: string | null
  terminalCode: string
  agentVersion: string | null
  online: boolean
  agentStatus: string | null
  printerStatus: string | null
  localTaskDatabaseAvailable: boolean | null
}

function PrinterHeartbeatText({ status }: { status: string | null }) {
  if (!status) return <>状态未知</>
  const view = printerStatusView(status)
  const tone = view.badge === 'error' ? 'font-semibold text-error-fg' : view.badge === 'warning' ? 'font-semibold text-warning-fg' : undefined
  return <span className={tone}>{view.label}</span>
}

export function CapabilityTargetBar({
  identity,
  prompt,
  receipt,
  onConfirm,
  onCancel,
}: {
  identity: CapabilityTargetIdentity | null
  prompt: string | null
  receipt: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!identity) return null
  const name = identity.displayName?.trim() || identity.terminalCode
  const online = identity.online ? (identity.agentStatus === 'agent_degraded' ? 'Agent 降级' : '在线') : '离线'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-neutral-500">
      <span>
        {name} · {identity.terminalCode} · Agent {identity.agentVersion ?? '版本未知'} · {online}
        {' · 打印机 '}
        <PrinterHeartbeatText status={identity.printerStatus} />
        {identity.localTaskDatabaseAvailable === false ? ' · 本地任务库不可用' : ''}
      </span>
      {prompt ? (
        <span className="inline-flex flex-wrap items-center gap-2 font-bold text-neutral-800">
          <span>{prompt}</span>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-primary-700 px-3 py-1.5 text-[12px] font-bold text-white"
          >
            确认
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-900/15 bg-surface px-3 py-1.5 text-[12px] font-bold text-neutral-700"
          >
            取消
          </button>
        </span>
      ) : receipt ? (
        <span className="font-bold text-neutral-800">{receipt}</span>
      ) : null}
    </div>
  )
}
