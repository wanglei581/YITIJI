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
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    Promise.all([
      toolboxService.listTerminals(),
      toolboxService.getLaunchSummary({ days: 7 }),
      toolboxService.listApps(),
      toolboxService.listAllowedHosts(),
    ])
      .then(([terminalRows, usage, appRows, hostRows]) => {
        setTerminals(terminalRows)
        setSummary(usage)
        setApps(appRows)
        setHosts(hostRows)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载百宝箱治理数据失败'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">百宝箱 / 微应用治理</h1>
          <p className="mt-0.5 text-sm text-gray-500">审核发布微应用、维护域名双白名单，并保留终端投放配置能力。</p>
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
        <ToolboxGovernancePanel apps={apps} terminals={terminals} onRefresh={load} />
      )}
      {activeTab === 'hosts' && (
        <ToolboxAllowedHostPanel hosts={hosts} onRefresh={load} />
      )}
      {activeTab === 'terminals' && (
        <TerminalToolboxPanel terminals={terminals} loading={loading} error={error} onReload={load} />
      )}
    </div>
  )
}
