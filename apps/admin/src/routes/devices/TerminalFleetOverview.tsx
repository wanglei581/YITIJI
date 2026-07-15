import { useRefreshable } from '@ai-job-print/refresh'
import { Card, StatusBadge } from '@ai-job-print/ui'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  getDeviceFleetOverview,
  type DeviceFleetConfigArea,
  type DeviceFleetConfigState,
  type DeviceFleetHealth,
  type DeviceFleetHealthReason,
  type DeviceFleetOverview,
  type DeviceFleetTerminal,
} from '../../services/api/devices'

const HEALTH_VIEW: Record<DeviceFleetHealth, {
  label: string
  badge: 'success' | 'warning' | 'error' | 'default'
}> = {
  healthy: { label: '健康', badge: 'success' },
  degraded: { label: '需关注', badge: 'warning' },
  offline: { label: '离线', badge: 'error' },
  unknown: { label: '未知', badge: 'default' },
}

const HEALTH_REASON: Record<DeviceFleetHealthReason, string> = {
  heartbeat_fresh: '心跳在 180 秒窗口内',
  agent_reported_degraded: 'Agent 上报降级状态',
  agent_reported_offline: 'Agent 上报离线状态',
  agent_reported_error: 'Agent 上报错误或未知状态',
  heartbeat_stale: '心跳已超过 180 秒',
  never_reported: '从未上报心跳',
}

const CONFIG_STATE_LABEL: Record<DeviceFleetConfigState, string> = {
  unconfigured: '未配置',
  configured: '已配置',
  legacy_reference: '旧引用',
  conflict: '配置冲突',
}

const AREA_LABEL: Record<DeviceFleetConfigArea, string> = {
  screensaver: '屏保',
  smart_campus: '智慧校园',
  toolbox: '百宝箱',
}

const ISSUE_LABEL = {
  dual_reference_config: '同一终端同时存在双引用配置',
  cross_terminal_reference_collision: '配置引用跨终端碰撞',
  orphan_config: '尚未匹配已注册终端（可能为预置配置）',
} as const

type FleetConfig = DeviceFleetTerminal['config'][keyof DeviceFleetTerminal['config']]

function formatTime(value: string | null): string {
  if (!value) return '从未'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return '无效时间'
  return time.toLocaleString('zh-CN', { hour12: false })
}

function configStatus(config: FleetConfig): string {
  const state = CONFIG_STATE_LABEL[config.state]
  if (config.state === 'unconfigured' || config.state === 'conflict' || config.enabled === null) {
    return state
  }
  return `${state} · ${config.enabled ? '启用' : '停用'}`
}

function ConfigCell({ config, detail, to }: { config: FleetConfig; detail: string | null; to: string }) {
  return (
    <div className="min-w-[116px] space-y-1">
      <p className={config.state === 'conflict' ? 'font-semibold text-error-fg' : 'font-semibold text-neutral-700'}>
        {configStatus(config)}
      </p>
      {detail && <p className="text-[11px] text-neutral-500">{detail}</p>}
      <Link className="text-[11px] font-semibold text-primary-700 hover:underline" to={to}>
        查看配置页
      </Link>
    </div>
  )
}

function summaryCards(data: DeviceFleetOverview | undefined) {
  const summary = data?.summary
  return [
    { label: '终端总数', value: summary?.total },
    { label: '健康', value: summary?.healthy },
    { label: '需关注', value: summary?.degraded },
    { label: '离线', value: summary?.offline },
    { label: '未知', value: summary?.unknown },
    { label: '已停用', value: summary?.disabled },
  ]
}

export default function TerminalFleetOverview() {
  const { data, status, error, refresh } = useRefreshable(
    'admin-device-fleet-overview',
    getDeviceFleetOverview,
    {
      intervalMs: 30_000,
      merge: (_current, incoming) => incoming,
      failPolicy: 'keep-last',
    },
  )

  const rows = data?.terminals ?? []
  const loading = status === 'loading' && data === undefined
  const initialLoadFailed = status === 'error' && data === undefined
  const errorMessage = error
    ? (error instanceof Error ? error.message : '设备总览加载失败')
    : null
  const hasConfigurationIssue = Boolean(
    data && (
      data.summary.configurationConflictTerminals > 0 ||
      data.summary.orphanConfigurationRecords > 0
    ),
  )

  return (
    <section className="space-y-4" aria-busy={status === 'loading'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-neutral-900">终端设备只读总览</h2>
          <p className="mt-1 text-xs text-neutral-500">
            健康判定窗口 {data?.onlineWindowSeconds ?? 180} 秒 · 每 30 秒自动刷新
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          刷新总览
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards(data).map((card) => (
          <Card key={card.label} className="p-4">
            <p className="text-xs font-semibold text-neutral-500">{card.label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">{card.value ?? '—'}</p>
          </Card>
        ))}
      </div>

      {errorMessage && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">
          {initialLoadFailed
            ? `设备总览加载失败，暂无可用数据。原因：${errorMessage}`
            : `设备总览刷新失败：${errorMessage}。页面保留最后一次成功数据。`}
        </div>
      )}

      {hasConfigurationIssue && data && (
        <div role="alert" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">
                配置一致性提示：{data.summary.configurationConflictTerminals} 台终端有冲突，
                {data.summary.orphanConfigurationRecords} 条尚未匹配已注册终端的配置记录。
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {data.issues.map((issue, index) => (
                  <li key={`${issue.area}-${issue.kind}-${index}`}>
                    {AREA_LABEL[issue.area]}：{ISSUE_LABEL[issue.kind]}；
                    {issue.affectedTerminalCodes.length > 0
                      ? `影响 ${issue.affectedTerminalCodes.join('、')}`
                      : '未关联到终端'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">终端设备只读总览</caption>
            <thead>
              <tr>
                {['终端', '健康', 'Agent 版本', '机构与位置', '屏保', '智慧校园', '百宝箱', '原页面'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold text-neutral-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {initialLoadFailed ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-neutral-500">
                    设备总览加载失败，暂无可用数据。
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-neutral-500">正在加载设备总览…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-neutral-500">暂无终端设备</td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const health = HEALTH_VIEW[row.health]
                  const screenDetail = row.config.screensaver.playlistConfigured === null
                    ? null
                    : (row.config.screensaver.playlistConfigured ? '已配播放列表' : '未配播放列表')
                  const campusDetail = row.config.smartCampus.enabledModuleCount === null
                    ? null
                    : `${row.config.smartCampus.enabledModuleCount} 个模块`
                  const toolboxDetail = row.config.toolbox.itemCount === null
                    ? null
                    : `${row.config.toolbox.itemCount} 个条目`

                  return (
                    <tr key={`${row.terminalCode}-${index}`} className="align-top hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-mono font-semibold text-neutral-900">{row.terminalCode}</p>
                        <p className="mt-1 text-xs text-neutral-500">{row.displayName ?? '未设置名称'}</p>
                        {row.hasConfigurationConflict && (
                          <p className="mt-1 text-[11px] font-semibold text-error-fg">配置冲突</p>
                        )}
                      </td>
                      <td className="min-w-[154px] px-4 py-3">
                        <StatusBadge dot status={health.badge} label={row.enabled ? health.label : `已停用 · ${health.label}`} />
                        <p className="mt-1 text-[11px] text-neutral-500">{HEALTH_REASON[row.healthReason]}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-mono text-xs text-neutral-700">{row.agentVersion ?? '未上报'}</p>
                        <p className="mt-1 text-[11px] text-neutral-500">{formatTime(row.lastHeartbeatAt)}</p>
                      </td>
                      <td className="min-w-[160px] px-4 py-3">
                        <p className="font-semibold text-neutral-700">{row.orgName ?? '未绑定机构'}</p>
                        <p className="mt-1 text-xs text-neutral-500">{row.locationLabel ?? '未设置位置'}</p>
                      </td>
                      <td className="px-4 py-3"><ConfigCell config={row.config.screensaver} detail={screenDetail} to="/screensaver" /></td>
                      <td className="px-4 py-3"><ConfigCell config={row.config.smartCampus} detail={campusDetail} to="/smart-campus" /></td>
                      <td className="px-4 py-3"><ConfigCell config={row.config.toolbox} detail={toolboxDetail} to="/toolbox" /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link
                          className="text-xs font-semibold text-primary-700 hover:underline"
                          to={`/devices?tab=terminals&search=${encodeURIComponent(row.terminalCode)}`}
                        >
                          查看终端
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap justify-between gap-2 text-[11px] text-neutral-400">
        <p>F1/F2 CLOSED_MODE：本页仅开放 F0 只读总览，后续阶段能力未开放。</p>
        <p>总览生成时间：{formatTime(data?.generatedAt ?? null)}</p>
      </div>
    </section>
  )
}
