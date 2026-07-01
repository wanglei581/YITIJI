import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { PackageIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type {
  KioskAppLaunchMode,
  KioskAppPlacement,
  KioskToolboxItem,
  ToolboxLaunchSummary,
  ToolboxTerminalView,
} from '@ai-job-print/shared'
import { toolboxService } from '../../services/api/toolbox'

const ICON_OPTIONS = [
  { value: 'wrench', label: '工具' },
  { value: 'file-text', label: '文档' },
  { value: 'printer', label: '打印' },
  { value: 'sparkles', label: 'AI' },
  { value: 'book-open', label: '指南' },
  { value: 'help-circle', label: '帮助' },
]

const PLACEMENT_OPTIONS: { value: KioskAppPlacement; label: string }[] = [
  { value: 'toolbox', label: '百宝箱' },
  { value: 'smart_campus', label: '智慧校园' },
]

const LAUNCH_MODE_OPTIONS: { value: KioskAppLaunchMode; label: string; placeholder: string }[] = [
  { value: 'internal_route', label: '站内页面', placeholder: '/resume/source' },
  { value: 'external_url', label: '外部 H5', placeholder: 'https://trusted.example.com/app' },
  { value: 'qr_code', label: '二维码', placeholder: '/api/v1/assets/app-qr.png' },
  { value: 'mini_program_qr', label: '小程序码', placeholder: '/api/v1/assets/mini-program.png' },
]

function emptyItem(index: number): KioskToolboxItem {
  return {
    key: `tool-${Date.now()}-${index}`,
    title: '',
    description: '',
    icon: 'wrench',
    to: null,
    disabled: false,
    sortOrder: index,
    placements: ['toolbox'],
    launchMode: 'internal_route',
    externalUrl: null,
    qrImageUrl: null,
    qrTargetUrl: null,
  }
}

function normalizeDraftItem(item: KioskToolboxItem): KioskToolboxItem {
  return {
    ...item,
    placements: item.placements?.length ? item.placements : ['toolbox'],
    launchMode: item.launchMode ?? 'internal_route',
    externalUrl: item.externalUrl ?? null,
    qrImageUrl: item.qrImageUrl ?? null,
    qrTargetUrl: item.qrTargetUrl ?? null,
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function ToolboxLaunchSummaryCard({ summary }: { summary: ToolboxLaunchSummary | null }) {
  const metrics = [
    { label: '7天总事件', value: summary?.totalCount ?? 0 },
    { label: '外部确认打开', value: summary?.externalConfirmedCount ?? 0 },
    { label: '二维码展示数', value: summary?.qrShownCount ?? 0 },
    { label: '外部取消数', value: summary?.externalCancelledCount ?? 0 },
  ]

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">百宝箱使用概览</h2>
          <p className="mt-1 text-xs text-gray-500">最近 7 天匿名终端事件统计；二维码展示数不等同于真实扫码完成。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          {summary ? `${summary.days} 天窗口` : '加载中'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500">{metric.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{formatCount(metric.value)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-gray-100 bg-white px-4 py-3">
        <p className="text-xs font-semibold text-gray-500">Top 功能项</p>
        {summary?.topItems.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.topItems.map((item) => (
              <span key={item.itemKey} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {item.itemTitle || item.itemKey} · {formatCount(item.count)}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-400">暂无使用事件</p>
        )}
      </div>
    </Card>
  )
}

function TerminalToolboxRow({ terminal, onSaved }: { terminal: ToolboxTerminalView; onSaved: () => void }) {
  const cfg = terminal.config
  const [enabled, setEnabled] = useState(cfg?.enabled ?? true)
  const [items, setItems] = useState<KioskToolboxItem[]>((cfg?.items ?? []).map(normalizeDraftItem))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const patchItem = (index: number, patch: Partial<KioskToolboxItem>) => {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const togglePlacement = (index: number, placement: KioskAppPlacement, checked: boolean) => {
    setItems((current) => current.map((item, i) => {
      if (i !== index) return item
      const placements = new Set<KioskAppPlacement>(item.placements?.length ? item.placements : ['toolbox'])
      if (checked) placements.add(placement)
      else placements.delete(placement)
      return { ...item, placements: placements.size > 0 ? Array.from(placements) : ['toolbox'] }
    }))
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      await toolboxService.saveConfig(terminal.terminalId, {
        enabled,
        items: items.map((item, index) => ({ ...normalizeDraftItem(item), sortOrder: index })),
      })
      setMsg('已保存')
      onSaved()
    } catch (error) {
      setMsg(error instanceof Error && error.message ? error.message : '保存失败，请检查路径和内容')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
          <PackageIcon className="h-5 w-5 text-slate-700" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">{terminal.terminalCode ?? terminal.terminalId}</p>
          <p className="text-xs text-gray-400">{terminal.terminalId}</p>
        </div>
        <StatusBadge status={terminal.isOnline ? 'success' : 'default'} label={terminal.isOnline ? '在线' : '离线'} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          <span className="text-sm font-medium text-gray-800">启用应用入口</span>
        </label>
        <span className="text-xs text-gray-400">关闭后百宝箱和智慧校园上架项都不展示</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setItems((current) => [...current, emptyItem(current.length)])}
          disabled={items.length >= 24}
        >
          <PlusIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          添加功能
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          暂未配置功能项。Kiosk 首页不会展示百宝箱；智慧校园仅在开启且有投放项或子模块时显示。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={item.key} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="grid gap-3 lg:grid-cols-[1.1fr_1.6fr_0.8fr_auto]">
                <input
                  value={item.title}
                  onChange={(e) => patchItem(index, { title: e.target.value, key: item.key || `tool-${index + 1}` })}
                  placeholder="功能名称"
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                />
                <input
                  value={item.description}
                  onChange={(e) => patchItem(index, { description: e.target.value })}
                  placeholder="功能说明"
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                />
                <select
                  value={item.icon}
                  onChange={(e) => patchItem(index, { icon: e.target.value })}
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                >
                  {ICON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-red-500"
                  aria-label="删除功能"
                >
                  <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1.8fr_auto]">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                  {PLACEMENT_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={(item.placements ?? ['toolbox']).includes(option.value)}
                        onChange={(e) => togglePlacement(index, option.value, e.target.checked)}
                        className="h-4 w-4"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <select
                  value={item.launchMode ?? 'internal_route'}
                  onChange={(e) => patchItem(index, {
                    launchMode: e.target.value as KioskAppLaunchMode,
                    to: e.target.value === 'internal_route' ? item.to : null,
                    externalUrl: e.target.value === 'external_url' ? item.externalUrl : null,
                    qrImageUrl: e.target.value === 'qr_code' || e.target.value === 'mini_program_qr' ? item.qrImageUrl : null,
                    qrTargetUrl: e.target.value === 'qr_code' || e.target.value === 'mini_program_qr' ? item.qrTargetUrl : null,
                  })}
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                >
                  {LAUNCH_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  value={
                    item.launchMode === 'external_url'
                      ? item.externalUrl ?? ''
                      : item.launchMode === 'qr_code' || item.launchMode === 'mini_program_qr'
                        ? item.qrImageUrl ?? ''
                        : item.to ?? ''
                  }
                  onChange={(e) => {
                    const value = e.target.value.trim() || null
                    const launchMode = item.launchMode ?? 'internal_route'
                    if (launchMode === 'external_url') patchItem(index, { externalUrl: value })
                    else if (launchMode === 'qr_code' || launchMode === 'mini_program_qr') patchItem(index, { qrImageUrl: value })
                    else patchItem(index, { to: value })
                  }}
                  placeholder={LAUNCH_MODE_OPTIONS.find((option) => option.value === (item.launchMode ?? 'internal_route'))?.placeholder}
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={item.disabled}
                    onChange={(e) => patchItem(index, { disabled: e.target.checked })}
                    className="h-4 w-4"
                  />
                  禁用
                </label>
              </div>
              {(item.launchMode === 'qr_code' || item.launchMode === 'mini_program_qr') && (
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_2.8fr]">
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-500">
                    {item.launchMode === 'qr_code'
                      ? '二维码目标地址用于白名单校验和前台提示，不代表系统已解析二维码图片内容。'
                      : '小程序目标说明用于前台提示，可填写 AppID、页面路径或服务名称。'}
                  </div>
                  <input
                    value={item.qrTargetUrl ?? ''}
                    onChange={(e) => patchItem(index, { qrTargetUrl: e.target.value.trim() || null })}
                    placeholder={item.launchMode === 'qr_code' ? 'https://trusted.example.com/service' : '微信小程序 AppID / 页面路径 / 服务名称'}
                    className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
    </Card>
  )
}

export default function ToolboxPage() {
  const [terminals, setTerminals] = useState<ToolboxTerminalView[]>([])
  const [summary, setSummary] = useState<ToolboxLaunchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    Promise.all([
      toolboxService.listTerminals(),
      toolboxService.getLaunchSummary({ days: 7 }),
    ])
      .then(([rows, usage]) => {
        setTerminals(rows)
        setSummary(usage)
      })
      .catch(() => setError('加载终端列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">百宝箱 / 智慧校园上架</h1>
        <p className="mt-0.5 text-sm text-gray-500">按终端配置应用入口、上架位置和启动方式；外部 H5 / 二维码域名由后端白名单保护。</p>
      </div>

      <ToolboxLaunchSummaryCard summary={summary} />

      {loading ? (
        <p className="text-sm text-gray-400">加载中…</p>
      ) : error ? (
        <Card className="p-6 text-center text-sm text-gray-500">{error}</Card>
      ) : terminals.length === 0 ? (
        <Card className="p-10 text-center text-sm text-gray-500">暂无终端</Card>
      ) : (
        <div className="space-y-4">
          {terminals.map((t) => (
            <TerminalToolboxRow key={t.terminalId} terminal={t} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  )
}
