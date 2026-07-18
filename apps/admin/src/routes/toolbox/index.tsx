import { useEffect, useState } from 'react'
import { Button } from '@ai-job-print/ui'
import type { ToolboxAdminAppView, ToolboxAllowedHostRecord, ToolboxLaunchSummary, ToolboxTerminalView } from '../../services/api/toolbox'
import { toolboxService } from '../../services/api/toolbox'
import { ToolboxAllowedHostPanel } from './components/ToolboxAllowedHostPanel'
import { ToolboxGovernancePanel } from './components/ToolboxGovernancePanel'
import { ToolboxLaunchSummaryCard } from './components/ToolboxLaunchSummaryCard'
import { TerminalToolboxPanel } from './components/TerminalToolboxPanel'

type TabKey = 'governance' | 'hosts' | 'terminals'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'governance', label: '微应用审核发布' },
  { key: 'hosts', label: '域名白名单' },
  { key: 'terminals', label: '终端投放配置' },
]

export default function ToolboxPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('governance')
  const [terminals, setTerminals] = useState<ToolboxTerminalView[]>([])
  const [summary, setSummary] = useState<ToolboxLaunchSummary | null>(null)
  const [apps, setApps] = useState<ToolboxAdminAppView[]>([])
  const [hosts, setHosts] = useState<ToolboxAllowedHostRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [terminalsError, setTerminalsError] = useState('')
  const [appsError, setAppsError] = useState('')
  const [hostsError, setHostsError] = useState('')

  const load = () => {
    setLoading(true)
    setTerminalsError('')
    setAppsError('')
    setHostsError('')
    Promise.allSettled([
      toolboxService.listTerminals(),
      toolboxService.getLaunchSummary({ days: 7 }),
      toolboxService.listApps(),
      toolboxService.listAllowedHosts(),
    ])
      .then(([terminalsResult, summaryResult, appsResult, hostsResult]) => {
        if (terminalsResult.status === 'fulfilled') {
          setTerminals(terminalsResult.value)
        } else {
          setTerminalsError(terminalsResult.reason instanceof Error ? terminalsResult.reason.message : '终端数据加载失败')
        }
        if (summaryResult.status === 'fulfilled') {
          setSummary(summaryResult.value)
        }
        // summary 失败时静默保留上次值，不阻断其他面板
        if (appsResult.status === 'fulfilled') {
          setApps(appsResult.value)
        } else {
          setAppsError(appsResult.reason instanceof Error ? appsResult.reason.message : '微应用数据加载失败')
        }
        if (hostsResult.status === 'fulfilled') {
          setHosts(hostsResult.value)
        } else {
          setHostsError(hostsResult.reason instanceof Error ? hostsResult.reason.message : '域名白名单加载失败')
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">百宝箱 / 微应用治理</h1>
          <p className="mt-0.5 text-sm text-neutral-500">审核发布微应用、维护域名双白名单，并保留终端投放配置能力。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button key={tab.key} size="sm" variant={activeTab === tab.key ? 'primary' : 'outline'} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      <ToolboxLaunchSummaryCard summary={summary} />

      {activeTab === 'governance' && (
        <>
          {appsError && <p className="mb-3 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error-fg">{appsError}</p>}
          <ToolboxGovernancePanel apps={apps} terminals={terminals} onRefresh={load} />
        </>
      )}
      {activeTab === 'hosts' && (
        <>
          {hostsError && <p className="mb-3 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error-fg">{hostsError}</p>}
          <ToolboxAllowedHostPanel hosts={hosts} onRefresh={load} />
        </>
      )}
      {activeTab === 'terminals' && (
        <TerminalToolboxPanel terminals={terminals} loading={loading} error={terminalsError} onReload={load} />
      )}
    </div>
  )
}
