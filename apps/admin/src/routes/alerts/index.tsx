import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, StatusBadge, Drawer, EmptyState, LoadingState, ErrorState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'
import {
  listAlerts, getAlert, updateAlertStatus,
  type AdminAlertListItem, type AdminAlertDetail,
} from '../../services/api'

// ─── 展示映射 ───────────────────────────────────────────────────────────────────

type Badge = 'success' | 'warning' | 'error' | 'info' | 'default'

const TYPE_LABELS: Record<string, string> = {
  'device-offline': '设备离线',
  'printer-fault': '打印机故障',
  'paper-jam': '卡纸',
  'paper-empty': '缺纸',
  'toner-low': '碳粉低余量',
  'ai-call-fail': 'AI调用失败',
  'file-clean-fail': '文件清理失败',
  'sync-fail': '数据同步失败',
}
function typeLabel(t: string): string { return TYPE_LABELS[t] ?? t }

const SEVERITY_MAP: Record<string, { badge: Badge; label: string; dot: string }> = {
  info: { badge: 'info', label: '提醒', dot: 'bg-blue-400' },
  warning: { badge: 'warning', label: '警告', dot: 'bg-orange-400' },
  critical: { badge: 'error', label: '严重', dot: 'bg-red-500' },
}
const STATUS_MAP: Record<string, { badge: Badge; label: string }> = {
  new: { badge: 'warning', label: '待处理' },
  processing: { badge: 'info', label: '处理中' },
  resolved: { badge: 'success', label: '已处理' },
  ignored: { badge: 'default', label: '已忽略' },
}
function sevView(s: string) { return SEVERITY_MAP[s] ?? { badge: 'default' as Badge, label: s, dot: 'bg-gray-300' } }
function statusView(s: string) { return STATUS_MAP[s] ?? { badge: 'default' as Badge, label: s } }

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const SEVERITY_FILTERS = [
  { label: '全部', value: '' }, { label: '严重', value: 'critical' },
  { label: '警告', value: 'warning' }, { label: '提醒', value: 'info' },
]
const STATUS_FILTERS = [
  { label: '全部', value: '' }, { label: '待处理', value: 'new' },
  { label: '处理中', value: 'processing' }, { label: '已处理', value: 'resolved' }, { label: '已忽略', value: 'ignored' },
]
const TYPE_FILTERS = [
  { label: '全部类型', value: '' },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ label, value })),
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [items, setItems] = useState<AdminAlertListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [severityFilter, setSeverityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // 详情抽屉
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<AdminAlertDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [search, setPage])

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listAlerts({
        ...(severityFilter ? { severity: severityFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(debouncedSearch.trim() ? { keyword: debouncedSearch.trim() } : {}),
        page,
        pageSize,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载告警失败')
    } finally {
      setLoading(false)
    }
  }, [severityFilter, statusFilter, typeFilter, debouncedSearch, page, pageSize])

  useEffect(() => { void loadList() }, [loadList])

  const openDetail = (id: string) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailError(null)
    setNote('')
    setNotice(null)
    setDetailLoading(true)
    getAlert(id)
      .then(setDetail)
      .catch((e) => setDetailError(e instanceof Error ? e.message : '加载详情失败'))
      .finally(() => setDetailLoading(false))
  }
  const closeDetail = () => { setDetailOpen(false); setNotice(null) }

  const handle = async (status: 'processing' | 'resolved' | 'ignored', okMsg: string) => {
    if (!detail || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const updated = await updateAlertStatus(detail.id, status, note.trim() || undefined)
      setDetail(updated)
      setNote('')
      setNotice(okMsg)
      void loadList()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const onFilter = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1) }

  return (
    <Page
      title="告警中心"
      subtitle="终端 / 设备 / 系统运营告警（处理仅为运营记录，不直接远程控制设备）"
      actions={
        <Button size="sm" variant="outline" className="flex items-center gap-1.5" onClick={() => void loadList()} disabled={loading}>
          <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      }
    >
      {/* 筛选 */}
      <div className="mb-4 space-y-2">
        <FilterRow label="级别">
          {SEVERITY_FILTERS.map((f) => (
            <Pill key={f.value} active={severityFilter === f.value} onClick={() => onFilter(setSeverityFilter)(f.value)}>{f.label}</Pill>
          ))}
        </FilterRow>
        <FilterRow label="状态">
          {STATUS_FILTERS.map((f) => (
            <Pill key={f.value} active={statusFilter === f.value} onClick={() => onFilter(setStatusFilter)(f.value)}>{f.label}</Pill>
          ))}
        </FilterRow>
        <div className="flex flex-wrap items-center gap-2 pl-12">
          <select
            value={typeFilter}
            onChange={(e) => onFilter(setTypeFilter)(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
          >
            {TYPE_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题 / 内容 / 告警编号…"
            className="h-8 w-60 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        {loading ? (
          <LoadingState text="加载告警中…" className="py-16" />
        ) : error ? (
          <ErrorState title="加载告警失败" message={error} onRetry={() => void loadList()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={debouncedSearch || severityFilter || statusFilter || typeFilter ? '未找到匹配的告警' : '暂无告警'}
            description={debouncedSearch || severityFilter || statusFilter || typeFilter ? '请调整筛选条件或关键词' : '终端 / 设备 / 系统产生告警后将在此展示'}
            icon={AlertTriangleIcon}
            className="py-16"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['', '告警标题', '类型', '级别', '状态', '关联终端', '发生时间', '更新时间', '操作'].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((a) => {
                  const sev = sevView(a.severity)
                  const st = statusView(a.status)
                  return (
                    <tr key={a.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openDetail(a.id)}>
                      <td className="py-3 pl-4"><span className={`inline-block h-2 w-2 rounded-full ${sev.dot}`} /></td>
                      <td className="max-w-xs px-4 py-3 text-gray-800"><span className="line-clamp-1">{a.title}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{typeLabel(a.type)}</td>
                      <td className="px-4 py-3"><StatusBadge status={sev.badge} label={sev.label} /></td>
                      <td className="px-4 py-3"><StatusBadge status={st.badge} label={st.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{a.terminalId ?? a.deviceName ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{fmtTime(a.occurredAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{fmtTime(a.updatedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          onClick={(e) => { e.stopPropagation(); openDetail(a.id) }}
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
        )}
      </Card>
      <p className="mt-3 text-xs text-gray-400">
        告警处理（标记处理中 / 已处理 / 忽略）仅为运营状态记录与责任留痕，不会直接远程控制或重启设备；真实设备动作仍由现场或终端 Agent 执行。
      </p>

      {/* 详情抽屉 */}
      <Drawer open={detailOpen} onClose={closeDetail} title="告警详情" size="lg">
        {detailLoading ? (
          <LoadingState text="加载详情中…" className="py-16" />
        ) : detailError ? (
          <ErrorState title="加载详情失败" message={detailError} />
        ) : detail ? (
          <AlertDetailBody
            detail={detail}
            busy={busy}
            note={note}
            notice={notice}
            onNoteChange={setNote}
            onProcessing={() => void handle('processing', '已标记为「处理中」')}
            onResolve={() => void handle('resolved', '已标记为「已处理」')}
            onIgnore={() => void handle('ignored', '已忽略该告警')}
          />
        ) : null}
      </Drawer>
    </Page>
  )
}

// ─── 小组件 ─────────────────────────────────────────────────────────────────────

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-xs text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-50 py-2 text-sm">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="break-all text-right font-medium text-gray-900">{value}</span>
    </div>
  )
}

interface AlertDetailBodyProps {
  detail: AdminAlertDetail
  busy: boolean
  note: string
  notice: string | null
  onNoteChange: (v: string) => void
  onProcessing: () => void
  onResolve: () => void
  onIgnore: () => void
}

function AlertDetailBody(p: AlertDetailBodyProps) {
  const { detail: d } = p
  const sev = sevView(d.severity)
  const st = statusView(d.status)
  const actionable = d.status === 'new' || d.status === 'processing'

  return (
    <div className="space-y-5">
      <section>
        <Row label="告警编号" value={<span className="font-mono text-xs">{d.alertNo}</span>} />
        <Row label="标题" value={d.title} />
        <Row label="类型" value={typeLabel(d.type)} />
        <Row label="级别" value={<StatusBadge status={sev.badge} label={sev.label} />} />
        <Row label="状态" value={<StatusBadge status={st.badge} label={st.label} />} />
        <Row label="关联终端" value={<span className="font-mono text-xs">{d.terminalId ?? '—'}</span>} />
        <Row label="关联设备" value={<span className="text-xs">{d.deviceName ?? '—'}</span>} />
        <Row label="告警描述" value={<span className="text-xs leading-relaxed">{d.message ?? '—'}</span>} />
        <Row label="发生时间" value={<span className="text-xs text-gray-500">{fmtTime(d.occurredAt)}</span>} />
        <Row label="创建时间" value={<span className="text-xs text-gray-500">{fmtTime(d.createdAt)}</span>} />
        <Row label="更新时间" value={<span className="text-xs text-gray-500">{fmtTime(d.updatedAt)}</span>} />
        {(d.handledBy || d.handledAt) && (
          <>
            <Row label="处理人" value={<span className="text-xs">{d.handlerName ?? d.handledBy ?? '—'}</span>} />
            <Row label="处理时间" value={<span className="text-xs text-gray-500">{fmtTime(d.handledAt)}</span>} />
          </>
        )}
        {d.handleNote && <Row label="处理备注" value={<span className="text-xs">{d.handleNote}</span>} />}
      </section>

      {/* 原始 payload */}
      {d.payloadJson && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">原始 payload</h4>
          <pre className="overflow-x-auto rounded-lg bg-gray-900/95 px-3 py-2 text-[11px] leading-relaxed text-gray-100">{formatPayload(d.payloadJson)}</pre>
        </section>
      )}

      {/* 操作 */}
      <section className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="text-xs text-gray-500">
          处理 / 忽略仅为运营状态记录与责任留痕，不会远程控制设备。可填写处理备注。
        </p>
        {p.notice && <p className="text-xs font-medium text-primary-600">{p.notice}</p>}
        {actionable ? (
          <>
            <textarea
              value={p.note}
              onChange={(e) => p.onNoteChange(e.target.value)}
              placeholder="处理备注（可选）…"
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
            />
            <div className="flex flex-wrap gap-2">
              {d.status === 'new' && (
                <Button size="sm" variant="outline" disabled={p.busy} onClick={p.onProcessing}>标记处理中</Button>
              )}
              <Button size="sm" variant="primary" disabled={p.busy} onClick={p.onResolve}>标记已处理</Button>
              <Button size="sm" variant="outline" disabled={p.busy} onClick={p.onIgnore}>忽略告警</Button>
            </div>
          </>
        ) : (
          <span className="text-xs text-gray-400">该告警已{st.label}，无需进一步处理。</span>
        )}
      </section>
    </div>
  )
}

function formatPayload(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}
