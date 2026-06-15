// ============================================================
// 智慧校园管理（管理员）—— 按终端开关 + 子模块开关位
//
// 一期由平台运营在此代配置（compliance §九 / feature-scope §6.8）。
// 学校自助管理（partner 后台 + orgId 隔离）为后续阶段。
// ============================================================

import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { GraduationCapIcon, InfoIcon } from 'lucide-react'
import type { SmartCampusModules, SmartCampusTerminalView } from '@ai-job-print/shared'
import { DEFAULT_SMART_CAMPUS_MODULES } from '@ai-job-print/shared'
import { smartCampusService } from '../../services/api/smartCampus'

const MODULE_DEFS: { key: keyof SmartCampusModules; label: string; note?: string }[] = [
  { key: 'welcome', label: '迎新系统' },
  { key: 'bigdata', label: '校园大数据', note: '需授权 + 合规就绪' },
  { key: 'luggage', label: '行李帮运' },
  { key: 'panorama', label: '校园全景' },
]

function TerminalConfigRow({
  terminal,
  onSaved,
}: {
  terminal: SmartCampusTerminalView
  onSaved: () => void
}) {
  const cfg = terminal.config
  const [enabled, setEnabled] = useState<boolean>(cfg?.enabled ?? false)
  const [modules, setModules] = useState<SmartCampusModules>(cfg?.modules ?? { ...DEFAULT_SMART_CAMPUS_MODULES })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const toggleModule = (key: keyof SmartCampusModules) =>
    setModules((m) => ({ ...m, [key]: !m[key] }))

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      await smartCampusService.saveConfig(terminal.terminalId, { enabled, modules })
      setMsg('已保存')
      onSaved()
    } catch {
      setMsg('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
          <GraduationCapIcon className="h-5 w-5 text-indigo-600" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">{terminal.terminalCode ?? terminal.terminalId}</p>
          <p className="text-xs text-gray-400">{terminal.terminalId}</p>
        </div>
        <StatusBadge status={terminal.isOnline ? 'success' : 'default'} label={terminal.isOnline ? '在线' : '离线'} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          <span className="text-sm font-medium text-gray-800">启用智慧校园</span>
        </label>
        <div className="h-5 w-px bg-neutral-200" />
        {MODULE_DEFS.map((m) => (
          <label key={m.key} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={modules[m.key]}
              onChange={() => toggleModule(m.key)}
              disabled={!enabled}
              className="h-4 w-4"
            />
            <span className={`text-sm ${enabled ? 'text-gray-700' : 'text-gray-400'}`}>
              {m.label}
              {m.note && <span className="ml-1 text-[11px] text-amber-600">（{m.note}）</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
    </Card>
  )
}

export default function SmartCampusPage() {
  const [terminals, setTerminals] = useState<SmartCampusTerminalView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    smartCampusService
      .listTerminals()
      .then((rows) => setTerminals(rows))
      .catch(() => setError('加载终端列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">智慧校园</h1>
        <p className="mt-0.5 text-sm text-gray-500">按终端开启智慧校园及各子模块；开启后该机器前端首页出现智慧校园入口。</p>
      </div>

      {/* 合规提示 */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-amber-900">
          一期由平台运营代配置。<span className="font-semibold">校园大数据</span>需先取得学校书面授权 + 数据处理协议，且只接聚合脱敏统计，
          本期前端仅为占位、不展示真实数据（详见合规边界 §九）。未开启任何子模块时无法启用。
        </p>
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
            <TerminalConfigRow key={t.terminalId} terminal={t} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  )
}
