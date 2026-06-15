import { useCallback, useEffect, useState } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { MonitorIcon, RefreshCwIcon, PencilIcon, CheckIcon, XIcon, Building2Icon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'
import { API_MODE } from '../../services/api/client'
import {
  getTerminals,
  getOrgOptions,
  assignTerminalOrg,
  type AdminTerminalRecord,
  type AdminOrganizationOption,
} from '../../services/api/devices'

const TABLE_COLS = 9

// ─── 打印机状态映射(契约 C1 printerStatus 枚举)──────────────────────────────

const PRINTER_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
  ok:          { badge: 'success', label: '正常' },
  offline:     { badge: 'error',   label: '离线' },
  paper_empty: { badge: 'warning', label: '缺纸' },
  error:       { badge: 'error',   label: '故障' },
  not_found:   { badge: 'warning', label: '未检测到' },
}

function printerStatusView(status: string | null) {
  if (!status) return { badge: 'default' as const, label: '未知' }
  return PRINTER_STATUS_MAP[status] ?? { badge: 'default' as const, label: status }
}

// 在线/离线由 online 字段决定(契约 C1:lastSeenAt 距今 < 3 分钟)
const ONLINE_VIEW = { badge: 'success' as const, label: '在线' }
const OFFLINE_VIEW = { badge: 'error' as const, label: '离线' }

const FILTERS = ['全部', '在线', '离线'] as const

function relativeTime(iso: string | null): string {
  if (!iso) return '从未'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diffMin = Math.floor((Date.now() - t) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

function fmtDisk(gb: number | null): string {
  if (gb === null || gb === undefined) return '—'
  return `${gb.toFixed(1)} GB`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TerminalsPage() {
  const [terminals, setTerminals] = useState<AdminTerminalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<string>('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  // 终端机构归属编辑态
  const [orgOptions, setOrgOptions] = useState<AdminOrganizationOption[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('') // '' = 未绑定/解绑
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    getTerminals()
      .then((res) => setTerminals(res.terminals))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // 机构下拉选项（绑定用）。失败不阻断页面，仍可解绑。
  useEffect(() => {
    getOrgOptions().then((r) => setOrgOptions(r.organizations)).catch(() => { /* ignore */ })
  }, [])

  function startEdit(t: AdminTerminalRecord) {
    setEditingId(t.id)
    setEditValue(t.orgId ?? '')
    setNotice(null)
  }
  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }
  async function saveEdit(t: AdminTerminalRecord) {
    setSaving(true)
    setNotice(null)
    try {
      const orgId = editValue === '' ? null : editValue
      const res = await assignTerminalOrg(t.terminalCode, orgId)
      setTerminals((rows) => rows.map((r) => (r.id === t.id ? { ...r, orgId: res.newOrgId, orgName: res.orgName } : r)))
      setEditingId(null)
      setEditValue('')
      setNotice({
        type: 'success',
        text: res.newOrgId
          ? `已绑定终端 ${t.terminalCode} → ${res.orgName ?? res.newOrgId}（保存成功，Kiosk 下一轮拉取后生效）`
          : `已解绑终端 ${t.terminalCode}（保存成功）`,
      })
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : '保存失败，请稍后重试' })
    } finally {
      setSaving(false)
    }
  }

  const byStatus = filter === '全部'
    ? terminals
    : terminals.filter((t) => (filter === '在线' ? t.online : !t.online))

  const searched = search.trim()
    ? byStatus.filter((t) =>
        t.terminalCode.toLowerCase().includes(search.toLowerCase()) ||
        (t.ipAddress ?? '').includes(search) ||
        (t.agentVersion ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : byStatus

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const counts = {
    全部: terminals.length,
    在线: terminals.filter((t) => t.online).length,
    离线: terminals.filter((t) => !t.online).length,
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {total} 台终端</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索终端编号、IP、版本..." className="h-8 w-72 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
            <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            <RefreshCwIcon className="h-3.5 w-3.5" />刷新
          </button>
        </div>
      </div>

      {/* 筛选标签 */}
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1) }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
            <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* 归属保存提示 */}
      {notice && (
        <div
          className={`mb-3 rounded-lg border px-4 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : 'border-red-100 bg-red-50 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['终端编号', '所属机构', '状态', '打印机状态', '最近心跳', 'Agent 版本', 'IP 地址', '磁盘可用', '注册时间'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    {Array.from({ length: TABLE_COLS }).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={TABLE_COLS}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-gray-400">终端数据加载失败,请稍后重试</p>
                      <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">重试</button>
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLS}>
                    <EmptyState title={search ? '未找到匹配的终端' : '该分类暂无终端'} description={search ? '请尝试其他关键词' : undefined} icon={MonitorIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((t) => {
                  const onlineView = t.online ? ONLINE_VIEW : OFFLINE_VIEW
                  const printerView = printerStatusView(t.printerStatus ?? null)
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">{t.terminalCode}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {editingId === t.id ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              disabled={saving}
                              className="h-7 max-w-[180px] rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
                              aria-label={`设置 ${t.terminalCode} 所属机构`}
                            >
                              <option value="">未绑定（解绑）</option>
                              {orgOptions.map((o) => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => saveEdit(t)}
                              disabled={saving}
                              title="保存归属"
                              aria-label="保存归属"
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                              <CheckIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              title="取消"
                              aria-label="取消"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            {t.orgName ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">
                                <Building2Icon className="h-3 w-3" />{t.orgName}
                              </span>
                            ) : (
                              <span className="text-gray-400">未绑定</span>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(t)}
                              title="编辑所属机构"
                              aria-label={`编辑 ${t.terminalCode} 所属机构`}
                              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={onlineView.badge} label={onlineView.label} /></td>
                      <td className="px-4 py-3"><StatusBadge status={printerView.badge} label={printerView.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{relativeTime(t.lastHeartbeatAt ?? t.lastSeenAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{t.agentVersion ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{t.ipAddress ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{fmtDisk(t.diskFreeGb)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{t.registeredAt ? new Date(t.registeredAt).toLocaleDateString('zh-CN') : '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
      </Card>

      <p className="mt-3 text-xs text-gray-400">
        终端在线状态、打印机状态、版本、IP、磁盘均来自 Windows Terminal Agent 的心跳上报
        {API_MODE !== 'http' && '（当前为 mock 演示数据，归属变更不写数据库）'}
      </p>
      <p className="mt-1 text-xs text-gray-400">
        「所属机构」决定该终端归哪所学校；学校账号在合作机构后台只能配置归属本校的智慧校园开关。绑定/解绑仅管理员可操作，变更写入审计日志。
      </p>
    </>
  )
}
