// Admin 打印扫描运维中心（Task 10）。
//
// 三个板块：
//   任务中心   — print/scan/document_process 真实聚合；photo/copy/材料包/格式转换/
//               签章无数据模型，如实显示"未上线"，不伪造行数据。
//   设备能力   — 终端 × 能力键开关（fail-closed：仅 available 对普通用户开放），
//               终端 Agent 版本/降级/打印机状态为心跳真实值。
//   商业化控制 — 定价/权益复用既有 billing、benefit 页面入口；补贴标签与退款
//               异常工作流当前未建设，如实标注。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { PrinterIcon, RefreshCwIcon, SlidersHorizontalIcon, WalletIcon } from 'lucide-react'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'
import {
  adminPrintScanService,
  type AdminPrintScanTaskDetail,
  type AdminPrintScanTaskItem,
  type AdminPrintScanTaskPage,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
  type PrintScanTaskType,
  type TerminalCapabilityView,
} from '../../services/api/printScan'

// ─── 展示映射 ─────────────────────────────────────────────────────────────────

const TASK_TYPE_TABS: { value: PrintScanTaskType; label: string; implemented: boolean }[] = [
  { value: 'print', label: '打印', implemented: true },
  { value: 'scan', label: '扫描', implemented: true },
  { value: 'document_process', label: '文档处理', implemented: true },
  { value: 'photo', label: '证件照', implemented: false },
  { value: 'copy', label: '复印', implemented: false },
  { value: 'material_pack', label: '材料包', implemented: false },
  { value: 'format_conversion', label: '格式转换', implemented: false },
  { value: 'signature_stamp', label: '签名盖章', implemented: false },
]

const TASK_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending: { badge: 'warning', label: '待领取' },
  claimed: { badge: 'info', label: '已领取' },
  printing: { badge: 'info', label: '打印中' },
  processing: { badge: 'info', label: '处理中' },
  waiting: { badge: 'warning', label: '等待扫描' },
  matched: { badge: 'info', label: '已匹配' },
  completed: { badge: 'success', label: '已完成' },
  failed: { badge: 'error', label: '失败' },
  expired: { badge: 'default', label: '已过期' },
  cancelled: { badge: 'default', label: '已取消' },
}

const STATUS_FILTERS: Record<'print' | 'scan' | 'document_process', { label: string; value: string }[]> = {
  print: [
    { label: '全部', value: '' },
    { label: '待领取', value: 'pending' },
    { label: '已领取', value: 'claimed' },
    { label: '打印中', value: 'printing' },
    { label: '已完成', value: 'completed' },
    { label: '失败', value: 'failed' },
  ],
  scan: [
    { label: '全部', value: '' },
    { label: '等待扫描', value: 'waiting' },
    { label: '已匹配', value: 'matched' },
    { label: '已完成', value: 'completed' },
    { label: '已过期', value: 'expired' },
    { label: '已取消', value: 'cancelled' },
    { label: '失败', value: 'failed' },
  ],
  document_process: [
    { label: '全部', value: '' },
    { label: '待处理', value: 'pending' },
    { label: '处理中', value: 'processing' },
    { label: '已完成', value: 'completed' },
    { label: '失败', value: 'failed' },
    { label: '已取消', value: 'cancelled' },
  ],
}

const CAPABILITY_LABELS: Record<PrintScanCapabilityKey, string> = {
  document_print: '文档打印',
  phone_upload: '手机扫码上传',
  cloud_upload: '云上传',
  usb_import: 'U盘导入',
  material_pack: '材料包',
  scan: '材料扫描',
  copy: '复印',
  id_photo: '证件照',
  format_convert: '格式转换',
  signature_stamp: '签名盖章',
}

const CAPABILITY_STATUS_OPTIONS: { value: PrintScanCapabilityStatus; label: string }[] = [
  { value: 'available', label: '可用（对用户开放）' },
  { value: 'testing', label: '测试中（仅运维可见）' },
  { value: 'maintenance', label: '维护中' },
  { value: 'unsupported', label: '不支持' },
  { value: 'not_verified', label: '未验收' },
]

const CAPABILITY_STATUS_BADGE: Record<PrintScanCapabilityStatus, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  available: { badge: 'success', label: '可用' },
  testing: { badge: 'info', label: '测试中' },
  maintenance: { badge: 'warning', label: '维护中' },
  unsupported: { badge: 'default', label: '不支持' },
  not_verified: { badge: 'warning', label: '未验收' },
}

const OWNER_LABELS: Record<string, string> = { member: '会员', anonymous: '游客' }

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—'
}

function taskSummary(item: AdminPrintScanTaskItem): string {
  if (item.type === 'print') return item.fileName ?? '（无文件名）'
  if (item.type === 'scan') return `扫描类型：${item.scanType}${item.hasResultFile ? ' · 已产出文件' : ''}`
  return `处理类型：${item.kind}${item.hasResultFile ? ' · 已产出文件' : ''}`
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────

type Section = 'tasks' | 'capabilities' | 'commercial'

export default function PrintScanOpsPage() {
  const [section, setSection] = useState<Section>('tasks')

  return (
    <Page
      title="打印扫描运维"
      subtitle="统一任务中心 · 终端能力开关 · 商业化控制入口"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip active={section === 'tasks'} label="任务中心" onClick={() => setSection('tasks')} />
        <FilterChip active={section === 'capabilities'} label="设备能力" onClick={() => setSection('capabilities')} />
        <FilterChip active={section === 'commercial'} label="商业化控制" onClick={() => setSection('commercial')} />
      </div>
      {section === 'tasks' && <TaskCenter />}
      {section === 'capabilities' && <CapabilityCenter />}
      {section === 'commercial' && <CommercialControls />}
    </Page>
  )
}

// ─── 任务中心 ─────────────────────────────────────────────────────────────────

function TaskCenter() {
  const [taskType, setTaskType] = useState<PrintScanTaskType>('print')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AdminPrintScanTaskPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminPrintScanTaskDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const implemented = TASK_TYPE_TABS.find((t) => t.value === taskType)?.implemented ?? false

  // 请求序号防竞态：快速切换类型/筛选时，旧的慢响应不得覆盖新状态。
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const result = await adminPrintScanService.listTasks({ type: taskType, status: status || undefined, page, pageSize: 20 })
      if (seq !== loadSeq.current) return
      setData(result)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [taskType, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const detailSeq = useRef(0)
  const openDetail = async (item: AdminPrintScanTaskItem) => {
    const seq = ++detailSeq.current
    setDetailOpen(true)
    setDetail(null)
    setActionError(null)
    try {
      const result = await adminPrintScanService.getTaskDetail(item.type, item.taskId)
      if (seq === detailSeq.current) setDetail(result)
    } catch (e) {
      if (seq === detailSeq.current) setActionError(e instanceof Error ? e.message : '详情加载失败')
    }
  }

  const applyAction = async (action: 'retry' | 'cancel') => {
    if (!detail || actionBusy) return
    const confirmText = action === 'retry' ? '确认将该失败任务重新排队打印？' : '确认取消该等待中的扫描任务？'
    if (!window.confirm(confirmText)) return
    setActionBusy(true)
    setActionError(null)
    try {
      await adminPrintScanService.applyTaskAction(detail.type, detail.taskId, action)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '操作失败')
      setActionBusy(false)
      return
    }
    // 动作已在服务端执行成功；刷新失败必须与"操作失败"区分，避免管理员重复操作。
    try {
      setDetail(await adminPrintScanService.getTaskDetail(detail.type, detail.taskId))
      await load()
    } catch {
      setActionError('操作已执行成功，但页面刷新失败，请手动刷新查看最新状态')
    } finally {
      setActionBusy(false)
    }
  }

  const statusFilters = implemented ? STATUS_FILTERS[taskType as 'print' | 'scan' | 'document_process'] : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TASK_TYPE_TABS.map((tab) => (
          <FilterChip
            key={tab.value}
            active={taskType === tab.value}
            label={tab.implemented ? tab.label : `${tab.label}（未上线）`}
            onClick={() => {
              setTaskType(tab.value)
              setStatus('')
              setPage(1)
            }}
          />
        ))}
      </div>

      {implemented && (
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.map((f) => (
            <FilterChip
              key={f.value}
              active={status === f.value}
              label={f.label}
              onClick={() => {
                setStatus(f.value)
                setPage(1)
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto inline-flex h-[30px] items-center gap-1.5 rounded-full border border-neutral-900/10 bg-surface px-[13px] text-[12.5px] font-bold text-neutral-700 hover:border-primary-600/40"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" /> 刷新
          </button>
        </div>
      )}

      {!implemented ? (
        <EmptyState
          title="该任务类型尚未上线"
          description="没有对应的数据模型与真实任务，本页不展示占位数据。能力上线后此处自动出现真实任务。"
        />
      ) : loading ? (
        <LoadingState text="正在加载任务" />
      ) : error ? (
        <ErrorState title="任务加载失败" message={error} onRetry={() => void load()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="暂无任务" description="当前筛选条件下没有任务记录。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-900/10 bg-surface">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-neutral-900/10 text-[12px] text-neutral-500">
                <th className="px-4 py-2.5 font-bold">任务</th>
                <th className="px-4 py-2.5 font-bold">终端</th>
                <th className="px-4 py-2.5 font-bold">归属</th>
                <th className="px-4 py-2.5 font-bold">状态</th>
                <th className="px-4 py-2.5 font-bold">错误码</th>
                <th className="px-4 py-2.5 font-bold">创建时间</th>
                <th className="px-4 py-2.5 font-bold">过期时间</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const statusMeta = TASK_STATUS_MAP[item.status] ?? { badge: 'default' as const, label: item.status }
                return (
                  <tr
                    key={item.taskId}
                    onClick={() => void openDetail(item)}
                    className="cursor-pointer border-b border-neutral-900/5 last:border-b-0 hover:bg-primary-50/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-neutral-800">{taskSummary(item)}</div>
                      <div className="text-[11px] text-neutral-400">{item.taskId}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">{item.terminalCode ?? '—'}</td>
                    <td className="px-4 py-2.5 text-neutral-600">{OWNER_LABELS[item.ownerType]}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={statusMeta.badge} label={statusMeta.label} /></td>
                    <td className="px-4 py-2.5 text-neutral-500">{item.errorCode ?? '—'}</td>
                    <td className="px-4 py-2.5 text-neutral-500">{fmt(item.createdAt)}</td>
                    <td className="px-4 py-2.5 text-neutral-500">{fmt(item.expiresAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-neutral-900/10 px-4 py-2.5 text-[12px] text-neutral-500">
            <span>共 {data.pagination.total} 条 · 第 {data.pagination.page}/{Math.max(1, data.pagination.totalPages)} 页</span>
            <span className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="font-bold text-primary-700 disabled:text-neutral-300">上一页</button>
              <button type="button" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="font-bold text-primary-700 disabled:text-neutral-300">下一页</button>
            </span>
          </div>
        </div>
      )}

      <Drawer open={detailOpen} onClose={() => setDetailOpen(false)} title="任务详情">
        {!detail && !actionError && <LoadingState text="正在加载详情" />}
        {actionError && <div className="mb-3 rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{actionError}</div>}
        {detail && <TaskDetailBody detail={detail} busy={actionBusy} onAction={applyAction} />}
      </Drawer>
    </div>
  )
}

function TaskDetailBody({
  detail,
  busy,
  onAction,
}: {
  detail: AdminPrintScanTaskDetail
  busy: boolean
  onAction: (action: 'retry' | 'cancel') => void
}) {
  const statusMeta = TASK_STATUS_MAP[detail.status] ?? { badge: 'default' as const, label: detail.status }
  const canRetry = detail.type === 'print' && detail.status === 'failed'
  const canCancel = detail.type === 'scan' && detail.status === 'waiting'

  const rows: [string, React.ReactNode][] = [
    ['任务 ID', detail.taskId],
    ['类型', TASK_TYPE_TABS.find((t) => t.value === detail.type)?.label ?? detail.type],
    ['状态', <StatusBadge key="s" status={statusMeta.badge} label={statusMeta.label} />],
    ['终端', detail.terminalCode ?? '—'],
    ['归属', OWNER_LABELS[detail.ownerType]],
    ['错误码', detail.errorCode ?? '—'],
    ['创建时间', fmt(detail.createdAt)],
    ['更新时间', fmt(detail.updatedAt)],
  ]
  if (detail.type === 'print') {
    rows.push(
      ['文件名', detail.fileName ?? '—'],
      ['份数 / 色彩 / 纸型', `${detail.copies ?? '—'} 份 · ${detail.colorMode === 'color' ? '彩色' : detail.colorMode === 'black_white' ? '黑白' : '—'} · ${detail.paperSize ?? '—'}`],
      ['关联订单', detail.orderNo ?? '—'],
      ['完成时间', fmt(detail.completedAt)],
    )
  }
  if (detail.type === 'scan') {
    rows.push(['扫描类型', detail.scanType], ['产出文件', detail.fileId ?? '未产出'], ['过期时间', fmt(detail.expiresAt)])
  }
  if (detail.type === 'document_process') {
    rows.push(['处理类型', detail.kind], ['源文件', detail.sourceFileId], ['结果文件', detail.resultFileId ?? '未产出'], ['过期时间', fmt(detail.expiresAt)])
  }

  return (
    <div className="space-y-4">
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-[13px]">
            <dt className="shrink-0 text-neutral-500">{label}</dt>
            <dd className="break-all text-right font-bold text-neutral-800">{value}</dd>
          </div>
        ))}
      </dl>

      {detail.type === 'print' && detail.statusLogs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[12px] font-bold text-neutral-500">状态流转</div>
          <ul className="space-y-1 text-[12px] text-neutral-600">
            {detail.statusLogs.map((log, i) => (
              <li key={i}>
                {fmt(log.createdAt)} · {log.fromStatus} → {log.toStatus}
                {log.errorCode ? `（${log.errorCode}）` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(canRetry || canCancel) && (
        <div className="border-t border-neutral-900/10 pt-3">
          {canRetry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('retry')}
              className="h-10 w-full rounded-lg bg-primary-700 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {busy ? '处理中…' : '重试该失败任务（重新排队到原终端）'}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('cancel')}
              className="h-10 w-full rounded-lg border border-error-text/30 bg-error-bg text-[13px] font-bold text-error-text disabled:opacity-50"
            >
              {busy ? '处理中…' : '取消该等待中的扫描任务'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 设备能力 ─────────────────────────────────────────────────────────────────

function CapabilityCenter() {
  const [terminals, setTerminals] = useState<AdminTerminalRecord[]>([])
  const [terminalId, setTerminalId] = useState('')
  const [capabilities, setCapabilities] = useState<TerminalCapabilityView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await getTerminals()
        setTerminals(res.terminals)
        if (res.terminals.length > 0) setTerminalId(res.terminals[0]!.id)
        else setLoading(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '终端列表加载失败')
        setLoading(false)
      }
    })()
  }, [])

  // 请求序号防竞态：快速切换终端时，A 终端的慢响应不得覆盖 B 终端的列表
  // （否则后续保存会把 A 的状态误写到 B）。
  const capSeq = useRef(0)
  const loadCapabilities = useCallback(async (tid: string) => {
    const seq = ++capSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await adminPrintScanService.listCapabilities(tid)
      if (seq !== capSeq.current) return
      setCapabilities(res.capabilities)
    } catch (e) {
      if (seq !== capSeq.current) return
      setError(e instanceof Error ? e.message : '能力配置加载失败')
    } finally {
      if (seq === capSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (terminalId) void loadCapabilities(terminalId)
  }, [terminalId, loadCapabilities])

  const selected = useMemo(() => terminals.find((t) => t.id === terminalId) ?? null, [terminals, terminalId])

  const save = async (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => {
    if (!terminalId || savingKey) return
    setSavingKey(key)
    setSaveError(null)
    try {
      const res = await adminPrintScanService.updateCapability(terminalId, key, { status, note: note || undefined })
      setCapabilities((prev) => prev?.map((c) => (c.capabilityKey === key ? res.capability : c)) ?? null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingKey(null)
    }
  }

  if (error) return <ErrorState title="加载失败" message={error} onRetry={() => { if (terminalId) void loadCapabilities(terminalId) }} />
  if (terminals.length === 0 && !loading) {
    return <EmptyState title="暂无终端" description="尚无已注册终端，注册后可在此配置能力开关。" />
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={terminalId}
          onChange={(e) => setTerminalId(e.target.value)}
          className="h-9 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[13px] font-bold text-neutral-800"
        >
          {terminals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName ?? t.terminalCode}（{t.terminalCode}）
            </option>
          ))}
        </select>
        {selected && (
          <span className="text-[12px] text-neutral-500">
            Agent {selected.agentVersion ?? '版本未知'} ·{' '}
            {selected.online ? (selected.agentStatus === 'agent_degraded' ? 'Agent 降级' : '在线') : '离线'} · 打印机{' '}
            {selected.printerStatus ?? '状态未知'}
            {selected.localTaskDatabaseAvailable === false ? ' · 本地任务库不可用' : ''}
          </span>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-neutral-500">
        fail-closed 口径：只有「可用」状态对普通用户开放正式任务；「测试中」仅运维语境可见；其余状态一律在
        Kiosk 上不可用。未配置的能力由 Kiosk 按各自保守默认处理，配置后以此处为准。
      </p>

      {saveError && <div className="rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{saveError}</div>}

      {loading ? (
        <LoadingState text="正在加载能力配置" />
      ) : capabilities ? (
        <div className="overflow-x-auto rounded-xl border border-neutral-900/10 bg-surface">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-neutral-900/10 text-[12px] text-neutral-500">
                <th className="px-4 py-2.5 font-bold">能力</th>
                <th className="px-4 py-2.5 font-bold">当前状态</th>
                <th className="px-4 py-2.5 font-bold">调整为</th>
                <th className="px-4 py-2.5 font-bold">备注（用户可见）</th>
                <th className="px-4 py-2.5 font-bold">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((cap) => (
                <CapabilityRow key={cap.capabilityKey} cap={cap} saving={savingKey === cap.capabilityKey} onSave={save} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function CapabilityRow({
  cap,
  saving,
  onSave,
}: {
  cap: TerminalCapabilityView
  saving: boolean
  onSave: (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => void
}) {
  const [status, setStatus] = useState<PrintScanCapabilityStatus>(cap.status)
  const [note, setNote] = useState(cap.note ?? '')
  useEffect(() => {
    setStatus(cap.status)
    setNote(cap.note ?? '')
  }, [cap])

  const meta = CAPABILITY_STATUS_BADGE[cap.status]
  const dirty = status !== cap.status || (note.trim() || '') !== (cap.note ?? '')

  return (
    <tr className="border-b border-neutral-900/5 last:border-b-0">
      <td className="px-4 py-2.5 font-bold text-neutral-800">{CAPABILITY_LABELS[cap.capabilityKey]}</td>
      <td className="px-4 py-2.5">
        <StatusBadge status={meta.badge} label={cap.configured ? meta.label : `${meta.label}（未配置）`} />
      </td>
      <td className="px-4 py-2.5">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as PrintScanCapabilityStatus)}
          className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-2 text-[12.5px] text-neutral-800"
        >
          {CAPABILITY_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <input
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="将展示给一体机用户，如：送修中"
          className="h-8 w-44 rounded-lg border border-neutral-900/15 bg-surface px-2 text-[12.5px] text-neutral-800"
        />
      </td>
      <td className="px-4 py-2.5 text-[12px] text-neutral-500">
        <span className="mr-2">{fmt(cap.updatedAt)}</span>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => onSave(cap.capabilityKey, status, note.trim())}
          className="rounded-lg bg-primary-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </td>
    </tr>
  )
}

// ─── 商业化控制 ───────────────────────────────────────────────────────────────

function CommercialControls() {
  const cards = [
    {
      icon: WalletIcon,
      title: '定价管理',
      desc: '打印服务单价、启停由计费页统一管理（唯一合法改价路径）；扫描等其他能力的计费尚未建设。',
      to: '/billing',
      linkLabel: '前往计费与对账',
    },
    {
      icon: SlidersHorizontalIcon,
      title: '权益券与免费额度',
      desc: '权益活动模板、发放与核销记录复用既有权益体系。',
      to: '/benefit-activities',
      linkLabel: '前往权益活动',
    },
    {
      icon: PrinterIcon,
      title: '会员权益',
      desc: '会员打印权益余量与发放明细。',
      to: '/member-benefits',
      linkLabel: '前往会员权益',
    },
  ]
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.title} className="rounded-xl border border-neutral-900/10 bg-surface p-4">
            <card.icon className="mb-2 h-5 w-5 text-primary-700" />
            <div className="text-[14px] font-bold text-neutral-800">{card.title}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">{card.desc}</p>
            <Link to={card.to} className="mt-2 inline-block text-[12.5px] font-bold text-primary-700">
              {card.linkLabel} →
            </Link>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-neutral-900/15 bg-surface/60 p-4 text-[12.5px] leading-relaxed text-neutral-500">
        <span className="font-bold text-neutral-700">尚未建设（如实标注，不做占位闭环）：</span>
        补贴标签（无数据模型）与退款异常处置工作流（当前仅有退款记录三态与对账差异清单，见计费页）。
        如需上线，须先立项数据模型与流程设计，不在本页伪造配置项。
      </div>
    </div>
  )
}
