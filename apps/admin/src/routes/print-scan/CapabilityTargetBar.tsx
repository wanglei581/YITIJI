// 设备能力页的目标行：只展示当前选中的是哪台机器。
// 登记前的确认、取消和成功回执贴在被点的那一行正下方，不放在这里。
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

export function CapabilityTargetBar({ identity }: { identity: CapabilityTargetIdentity | null }) {
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
    </div>
  )
}
