import { useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { PackageIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type { KioskAppLaunchMode, KioskAppPlacement, KioskToolboxItem, ToolboxTerminalView } from '@ai-job-print/shared'
import { toolboxService } from '../../../services/api/toolbox'
import { ICON_OPTIONS, LAUNCH_MODE_OPTIONS, PLACEMENT_OPTIONS } from '../constants'

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

export function TerminalToolboxRow({ terminal, onSaved }: { terminal: ToolboxTerminalView; onSaved: () => void }) {
  const cfg = terminal.config
  const [enabled, setEnabled] = useState(cfg?.enabled ?? true)
  const [items, setItems] = useState<KioskToolboxItem[]>((cfg?.items ?? []).map(normalizeDraftItem))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const patchItem = (index: number, patch: Partial<KioskToolboxItem>) => {
    setItems((current) => current.map((item, i) => i === index && !item.key.startsWith('app:') ? { ...item, ...patch } : item))
  }

  const togglePlacement = (index: number, placement: KioskAppPlacement, checked: boolean) => {
    setItems((current) => current.map((item, i) => {
      if (i !== index || item.key.startsWith('app:')) return item
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
          <p className="font-medium text-neutral-900">{terminal.terminalCode ?? terminal.terminalId}</p>
          <p className="text-xs text-neutral-400">{terminal.terminalId}</p>
        </div>
        <StatusBadge dot status={terminal.isOnline ? 'success' : 'default'} label={terminal.isOnline ? '在线' : '离线'} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          <span className="text-sm font-medium text-neutral-800">启用应用入口</span>
        </label>
        <span className="text-xs text-neutral-400">关闭后百宝箱和智慧校园上架项都不展示</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setItems((current) => [...current, emptyItem(current.length)])} disabled={items.length >= 24}>
          <PlusIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          添加功能
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
          暂未配置功能项。Kiosk 首页不会展示百宝箱；智慧校园仅在开启且有投放项或子模块时显示。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item, index) => {
            const isGovernedItem = item.key.startsWith('app:')
            const isQrLaunchMode = item.launchMode === 'qr_code' || item.launchMode === 'mini_program_qr'
            return (
              <div key={item.key} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                {isGovernedItem && (
                  <div className="mb-3 rounded-lg border border-success/20 bg-success-bg px-3 py-2 text-xs font-medium text-success-fg">
                    治理发布项：由微应用审核发布流程生成，只能通过审核台发布、熔断或重新投放。
                  </div>
                )}
                <div className="grid gap-3 lg:grid-cols-[1.1fr_1.6fr_0.8fr_auto]">
                  <input value={item.title} onChange={(e) => patchItem(index, { title: e.target.value, key: item.key || `tool-${index + 1}` })} placeholder="功能名称" disabled={isGovernedItem} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-slate-100" />
                  <input value={item.description} onChange={(e) => patchItem(index, { description: e.target.value })} placeholder="功能说明" disabled={isGovernedItem} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-slate-100" />
                  <select value={item.icon} onChange={(e) => patchItem(index, { icon: e.target.value })} disabled={isGovernedItem} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-slate-100">
                    {ICON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} disabled={isGovernedItem} className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 hover:bg-surface hover:text-error-fg disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neutral-400" aria-label="删除功能">
                    <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1.8fr_auto]">
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-surface px-3 py-2">
                    {PLACEMENT_OPTIONS.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 text-sm text-neutral-600">
                        <input type="checkbox" checked={(item.placements ?? ['toolbox']).includes(option.value)} onChange={(e) => togglePlacement(index, option.value, e.target.checked)} disabled={isGovernedItem} className="h-4 w-4" />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <select value={item.launchMode ?? 'internal_route'} onChange={(e) => patchItem(index, {
                    launchMode: e.target.value as KioskAppLaunchMode,
                    to: e.target.value === 'internal_route' ? item.to : null,
                    externalUrl: e.target.value === 'external_url' ? item.externalUrl : null,
                    qrImageUrl: e.target.value === 'qr_code' || e.target.value === 'mini_program_qr' ? item.qrImageUrl : null,
                    qrTargetUrl: e.target.value === 'qr_code' || e.target.value === 'mini_program_qr' ? item.qrTargetUrl : null,
                  })} disabled={isGovernedItem} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-slate-100">
                    {LAUNCH_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input value={item.launchMode === 'external_url' ? item.externalUrl ?? '' : isQrLaunchMode ? item.qrImageUrl ?? '' : item.to ?? ''} onChange={(e) => {
                    const value = e.target.value.trim() || null
                    const launchMode = item.launchMode ?? 'internal_route'
                    if (launchMode === 'external_url') patchItem(index, { externalUrl: value })
                    else if (launchMode === 'qr_code' || launchMode === 'mini_program_qr') patchItem(index, { qrImageUrl: value })
                    else patchItem(index, { to: value })
                  }} placeholder={isQrLaunchMode ? '二维码图片地址，用于终端展示二维码图片' : LAUNCH_MODE_OPTIONS.find((option) => option.value === (item.launchMode ?? 'internal_route'))?.placeholder} disabled={isGovernedItem} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-slate-100" />
                  <label className="flex items-center gap-2 text-sm text-neutral-600">
                    <input type="checkbox" checked={item.disabled} onChange={(e) => patchItem(index, { disabled: e.target.checked })} disabled={isGovernedItem} className="h-4 w-4" />
                    禁用
                  </label>
                </div>
                {isQrLaunchMode && (
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.8fr_auto]">
                    <span className="flex h-10 items-center rounded-lg border border-neutral-200 bg-surface px-3 text-sm text-neutral-600">扫码目标地址</span>
                    <input value={item.qrTargetUrl ?? ''} onChange={(e) => {
                      const value = e.target.value.trim() || null
                      patchItem(index, { qrTargetUrl: value })
                    }} placeholder={item.launchMode === 'qr_code' ? '扫码后打开的 HTTPS 地址，用于合规审计' : '小程序目标说明，用于合规审计'} disabled={isGovernedItem} className="h-10 rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-slate-100" />
                    <span className="flex h-10 items-center text-xs text-neutral-400">图片地址和扫码目标分离保存</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        {msg && <span className="text-xs text-neutral-500">{msg}</span>}
      </div>
    </Card>
  )
}
