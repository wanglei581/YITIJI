import { useEffect, useMemo, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { ApiHttpError } from '../../../services/api/client'
import { toolboxService, type ToolboxAdminAppView, type ToolboxAppVersion, type ToolboxTerminalView } from '../../../services/api/toolbox'
import { BLOCK_REASON_LABELS, CATEGORY_OPTIONS, PRIORITY_OPTIONS, RISK_OPTIONS, STATUS_LABELS } from '../constants'

type EntryType = 'internal_route' | 'web_app' | 'qr_code' | 'mini_program_qr' | 'ai_skill'

const emptyApp = {
  appKey: '',
  title: '',
  shortDescription: '',
  category: 'career' as const,
  priority: 'medium' as const,
  riskLevel: 'medium' as const,
}

function badgeStatus(status: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
  if (status === 'published' || status === 'approved') return 'success'
  if (status === 'submitted' || status === 'pending_review') return 'warning'
  if (status === 'rejected' || status === 'suspended') return 'error'
  if (status === 'draft') return 'info'
  return 'default'
}

export function ToolboxGovernancePanel({
  apps,
  terminals,
  onRefresh,
}: {
  apps: ToolboxAdminAppView[]
  terminals: ToolboxTerminalView[]
  onRefresh: () => void
}) {
  const [selectedAppKey, setSelectedAppKey] = useState(apps[0]?.appKey ?? '')
  const [versions, setVersions] = useState<ToolboxAppVersion[]>([])
  const [versionLoading, setVersionLoading] = useState(false)
  const [appForm, setAppForm] = useState(emptyApp)
  const [versionForm, setVersionForm] = useState({
    entryType: 'ai_skill' as EntryType,
    target: '',
    qrImageUrl: '',
    qrTargetUrl: '',
    shortDescription: '',
    disclaimer: '',
    consent: true,
  })
  const [terminalIds, setTerminalIds] = useState('')
  const [rejectReason, setRejectReason] = useState('内容或风险说明不完整')
  const [message, setMessage] = useState('')

  const selectedApp = useMemo(
    () => apps.find((app) => app.appKey === selectedAppKey) ?? apps[0] ?? null,
    [apps, selectedAppKey],
  )

  useEffect(() => {
    if (!selectedAppKey && apps[0]) setSelectedAppKey(apps[0].appKey)
  }, [apps, selectedAppKey])

  const loadVersions = () => {
    if (!selectedApp?.appKey) {
      setVersions([])
      return
    }
    setVersionLoading(true)
    toolboxService.listVersions(selectedApp.appKey)
      .then(setVersions)
      .catch((error) => setMessage(error instanceof Error ? error.message : '加载版本失败'))
      .finally(() => setVersionLoading(false))
  }

  useEffect(loadVersions, [selectedApp?.appKey])

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setMessage('')
    try {
      await action()
      setMessage(success)
      onRefresh()
      loadVersions()
    } catch (error) {
      if (error instanceof ApiHttpError && error.reason) {
        setMessage(BLOCK_REASON_LABELS[error.reason] ?? error.message)
      } else {
        setMessage(error instanceof Error ? error.message : '操作失败')
      }
    }
  }

  const createApp = () => runAction(async () => {
    await toolboxService.createApp(appForm)
    setSelectedAppKey(appForm.appKey)
    setAppForm(emptyApp)
  }, '微应用已创建')

  const createVersion = () => {
    if (!selectedApp) return
    const disclaimer = versionForm.disclaimer.trim()
    if ((selectedApp.riskLevel === 'high' || selectedApp.riskLevel === 'restricted') && !disclaimer) {
      setMessage(BLOCK_REASON_LABELS.missing_disclaimer)
      return
    }
    const launch = buildLaunch(versionForm.entryType, {
      target: versionForm.target,
      qrImageUrl: versionForm.qrImageUrl,
      qrTargetUrl: versionForm.qrTargetUrl,
    })
    const snapshot = {
      id: selectedApp.appKey,
      title: selectedApp.title,
      shortDescription: versionForm.shortDescription.trim() || `${selectedApp.title} 微应用服务`,
      category: selectedApp.category,
      priority: selectedApp.priority,
      status: 'draft',
      riskLevel: selectedApp.riskLevel,
      permissions: versionForm.entryType === 'ai_skill' ? ['ai_chat', 'session_only_storage'] : ['external_open', 'session_only_storage'],
      launch,
      dataPolicy: {
        sensitiveDataAllowed: selectedApp.riskLevel === 'high' || selectedApp.riskLevel === 'restricted',
        requiresExplicitConsent: versionForm.consent,
      },
      disclaimers: disclaimer ? [disclaimer] : [],
    }
    void runAction(() => toolboxService.createVersion(selectedApp.appKey, snapshot), '版本草稿已创建')
  }

  const latestTerminalOptions = terminalIds.split(',').map((item) => item.trim()).filter(Boolean)
  const versionEntryIsQr = versionForm.entryType === 'qr_code' || versionForm.entryType === 'mini_program_qr'

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
      <Card className="p-5">
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
          百宝箱只允许站内路由、受控 H5、二维码和 AI 技能入口；不执行第三方代码，不桥接第三方设备。高风险能力必须保留免责声明。
        </div>

        <h2 className="mt-5 text-base font-bold text-neutral-900">创建微应用</h2>
        <div className="mt-3 grid gap-3">
          <input value={appForm.appKey} onChange={(e) => setAppForm({ ...appForm, appKey: e.target.value.trim().toLowerCase() })} placeholder="app-key，例如 contract-review" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input value={appForm.title} onChange={(e) => setAppForm({ ...appForm, title: e.target.value })} placeholder="应用名称" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input value={appForm.shortDescription} onChange={(e) => setAppForm({ ...appForm, shortDescription: e.target.value })} placeholder="一句话说明" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <div className="grid gap-3 md:grid-cols-3">
            <select value={appForm.category} onChange={(e) => setAppForm({ ...appForm, category: e.target.value as typeof appForm.category })} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm">
              {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={appForm.priority} onChange={(e) => setAppForm({ ...appForm, priority: e.target.value as typeof appForm.priority })} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm">
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={appForm.riskLevel} onChange={(e) => setAppForm({ ...appForm, riskLevel: e.target.value as typeof appForm.riskLevel })} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm">
              {RISK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <Button size="sm" onClick={createApp} disabled={!appForm.appKey || !appForm.title || !appForm.shortDescription}>创建应用</Button>
        </div>

        <h2 className="mt-6 text-base font-bold text-neutral-900">创建版本</h2>
        <div className="mt-3 grid gap-3">
          <select value={selectedAppKey} onChange={(e) => setSelectedAppKey(e.target.value)} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm">
            {apps.map((app) => <option key={app.appKey} value={app.appKey}>{app.title} · {app.appKey}</option>)}
          </select>
          <select value={versionForm.entryType} onChange={(e) => setVersionForm({ ...versionForm, entryType: e.target.value as EntryType })} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm">
            <option value="ai_skill">AI 技能</option>
            <option value="internal_route">站内页面</option>
            <option value="web_app">外部 H5</option>
            <option value="qr_code">二维码</option>
            <option value="mini_program_qr">小程序码</option>
          </select>
          <input value={versionForm.shortDescription} onChange={(e) => setVersionForm({ ...versionForm, shortDescription: e.target.value })} placeholder="版本说明，默认使用应用名称生成" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          {versionEntryIsQr ? (
            <div className="grid gap-3 md:grid-cols-2">
              <input value={versionForm.qrImageUrl} onChange={(e) => setVersionForm({ ...versionForm, qrImageUrl: e.target.value })} placeholder="二维码图片地址，用于终端展示二维码图片" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
              <input value={versionForm.qrTargetUrl} onChange={(e) => setVersionForm({ ...versionForm, qrTargetUrl: e.target.value })} placeholder={versionForm.entryType === 'qr_code' ? '扫码目标地址，用于合规审计和运营声明' : '小程序目标说明，用于合规审计和运营声明'} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
            </div>
          ) : (
            <input value={versionForm.target} onChange={(e) => setVersionForm({ ...versionForm, target: e.target.value })} placeholder="站内路由、HTTPS 地址或 assistant intent" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          )}
          <textarea value={versionForm.disclaimer} onChange={(e) => setVersionForm({ ...versionForm, disclaimer: e.target.value })} placeholder="免责声明，高风险/受限应用必填" className="min-h-20 rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={versionForm.consent} onChange={(e) => setVersionForm({ ...versionForm, consent: e.target.checked })} className="h-4 w-4" />
            需要用户显式确认
          </label>
          <Button size="sm" onClick={createVersion} disabled={!selectedApp}>创建版本草稿</Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-neutral-900">微应用审核发布</h2>
          {message && <span className="text-sm font-medium text-red-600">{message}</span>}
        </div>
        <div className="mt-4 space-y-3">
          {apps.map((app) => (
            <button key={app.appKey} type="button" onClick={() => setSelectedAppKey(app.appKey)} className={`w-full rounded-xl border px-4 py-3 text-left ${selectedAppKey === app.appKey ? 'border-blue-200 bg-blue-50' : 'border-neutral-200 bg-white'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-neutral-900">{app.title}</span>
                <span className="text-xs text-neutral-400">{app.appKey}</span>
                <StatusBadge status={badgeStatus(app.status)} label={STATUS_LABELS[app.status] ?? app.status} />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{app.riskLevel}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-neutral-200">
          <div className="border-b border-neutral-100 px-4 py-3">
            <p className="text-sm font-semibold text-neutral-900">{selectedApp?.title ?? '未选择应用'} 版本</p>
            <input value={terminalIds} onChange={(e) => setTerminalIds(e.target.value)} placeholder="发布终端，逗号分隔；留空=全部启用终端" className="mt-2 h-9 w-full rounded-lg border border-neutral-200 px-3 text-xs" />
          </div>
          {versionLoading ? (
            <p className="px-4 py-5 text-sm text-neutral-400">加载版本中…</p>
          ) : versions.length === 0 ? (
            <p className="px-4 py-5 text-sm text-neutral-400">暂无版本</p>
          ) : versions.map((version) => (
            <div key={version.id} className="border-b border-neutral-100 px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-neutral-900">v{version.version}</span>
                <StatusBadge status={badgeStatus(version.status)} label={STATUS_LABELS[version.status] ?? version.status} />
                <span className="text-xs text-neutral-400">{version.snapshot.launch?.entryType}</span>
              </div>
              {version.snapshot.disclaimers?.length > 0 && (
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">免责声明：{version.snapshot.disclaimers.join('；')}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {version.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => void runAction(() => toolboxService.submitVersion(selectedApp!.appKey, version.version), '已提交审核')}>提交审核</Button>}
                {version.status === 'submitted' && <Button size="sm" variant="secondary" onClick={() => void runAction(() => toolboxService.approveVersion(selectedApp!.appKey, version.version), '已审核通过')}>通过</Button>}
                {version.status === 'submitted' && <Button size="sm" variant="outline" onClick={() => void runAction(() => toolboxService.rejectVersion(selectedApp!.appKey, version.version, rejectReason), '已驳回')}>驳回</Button>}
                {version.status === 'approved' && <Button size="sm" onClick={() => void runAction(() => toolboxService.publishVersion(selectedApp!.appKey, version.version, latestTerminalOptions), '已发布')}>发布</Button>}
              </div>
            </div>
          ))}
          <div className="border-t border-neutral-100 px-4 py-3">
            <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="驳回原因" className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-xs" />
            {selectedApp && <Button className="mt-3" size="sm" variant="danger" onClick={() => void runAction(() => toolboxService.suspendApp(selectedApp.appKey), '已执行熔断')}>熔断当前应用</Button>}
            <p className="mt-2 text-xs text-neutral-400">可发布终端数：{terminals.length}。发布失败时会展示 BLOCK_REASON_LABELS 对应的拦截原因。</p>
          </div>
        </div>
      </Card>
    </div>
  )
}

function buildLaunch(entryType: EntryType, values: { target: string; qrImageUrl: string; qrTargetUrl: string }) {
  const target = values.target.trim()
  const qrImageUrl = values.qrImageUrl.trim()
  const qrTargetUrl = values.qrTargetUrl.trim()
  if (entryType === 'ai_skill') return { entryType, assistantIntent: target || 'general_toolbox', requiresHostAllowlist: false }
  if (entryType === 'internal_route') return { entryType, internalRoute: target || '/assistant', requiresHostAllowlist: false }
  if (entryType === 'web_app') return { entryType, externalUrl: target, requiresHostAllowlist: true }
  if (entryType === 'qr_code') return { entryType, qrImageUrl, qrTargetUrl, requiresHostAllowlist: true }
  return { entryType, qrImageUrl, qrTargetUrl, requiresHostAllowlist: false }
}
