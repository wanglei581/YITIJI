import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { PackageIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type { KioskToolboxItem, ToolboxTerminalView } from '@ai-job-print/shared'
import { toolboxService } from '../../services/api/toolbox'

const ICON_OPTIONS = [
  { value: 'wrench', label: '工具' },
  { value: 'file-text', label: '文档' },
  { value: 'printer', label: '打印' },
  { value: 'sparkles', label: 'AI' },
  { value: 'book-open', label: '指南' },
  { value: 'help-circle', label: '帮助' },
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
  }
}

function TerminalToolboxRow({ terminal, onSaved }: { terminal: ToolboxTerminalView; onSaved: () => void }) {
  const cfg = terminal.config
  const [enabled, setEnabled] = useState(cfg?.enabled ?? true)
  const [items, setItems] = useState<KioskToolboxItem[]>(cfg?.items ?? [])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const patchItem = (index: number, patch: Partial<KioskToolboxItem>) => {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      await toolboxService.saveConfig(terminal.terminalId, {
        enabled,
        items: items.map((item, index) => ({ ...item, sortOrder: index })),
      })
      setMsg('已保存')
      onSaved()
    } catch {
      setMsg('保存失败，请检查路径和内容')
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
          <span className="text-sm font-medium text-gray-800">启用百宝箱</span>
        </label>
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
          暂未配置功能项。Kiosk 首页不会展示百宝箱模块。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={item.key} className="grid grid-cols-[1.1fr_1.6fr_1fr_1.1fr_auto_auto] gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
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
              <input
                value={item.to ?? ''}
                onChange={(e) => patchItem(index, { to: e.target.value.trim() || null })}
                placeholder="/internal/path"
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
              <button
                type="button"
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-red-500"
                aria-label="删除功能"
              >
                <Trash2Icon className="h-4 w-4" aria-hidden="true" />
              </button>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    toolboxService
      .listTerminals()
      .then((rows) => setTerminals(rows))
      .catch(() => setError('加载终端列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">百宝箱</h1>
        <p className="mt-0.5 text-sm text-gray-500">按终端配置首页百宝箱功能项；未配置或无功能项时前台显示占位，不影响智慧校园开关。</p>
      </div>

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
