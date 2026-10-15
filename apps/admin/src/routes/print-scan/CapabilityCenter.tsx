// Admin 打印扫描运维中心 ·「设备能力」板块（从 print-scan/index.tsx 原样拆出，2026-09-29）。
//
// 终端 × 能力键开关（fail-closed：仅 available 对普通用户开放），终端 Agent 版本 / 降级 /
// 打印机状态为心跳真实值。这是后台唯一能逐台开关能力的地方。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'
import { printerStatusView } from '../terminals/terminalStatusViews'
import {
  adminPrintScanService,
  DEFAULT_DENY_CAPABILITY_KEYS,
  DEPRECATED_CAPABILITY_ALIAS,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
  type TerminalCapabilityView,
} from '../../services/api/printScan'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { ClearCapabilityButton } from './ClearCapabilityButton'
import { SignatureCapabilityRow } from './SignatureCapabilityRow'

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
  // 未登记 = 关闭（2026-09-28 D3）；产品负责人定「签名只保留本人手写签名」，不做公章或圆形章。
  // 这一行不用通用下拉框，而是「开通（页内确认）/ 关闭（必填用户可见说明）」，见 SignatureCapabilityRow。
  signature_stamp: '签名（本人手写，默认关闭）',
  // 这两项未配置 = 拒绝（fail-closed）：必须在该终端真机验过彩色/双面出纸，
  // 再配成「可用」才对用户放开。配错的代价是用户按彩色付费拿到黑白纸。
  color_print: '彩色打印（需真机验证）',
  duplex_print: '自动双面（需真机验证）',
}

function PrinterHeartbeatText({ status }: { status: string | null }) {
  if (!status) return <>状态未知</>
  const view = printerStatusView(status)
  const tone = view.badge === 'error' ? 'font-semibold text-error-fg' : view.badge === 'warning' ? 'font-semibold text-warning-fg' : undefined
  return <span className={tone}>{view.label}</span>
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

function fmt(iso: string | null): string {
  return formatDateTime(iso)
}

const DEFAULT_DENY_KEYS: readonly PrintScanCapabilityKey[] = DEFAULT_DENY_CAPABILITY_KEYS

/**
 * 「当前状态」三态，按服务端真实行为写（TerminalCapabilitiesService.assertUserTaskAllowed）：
 *   已开通 —— 登记为「可用」；
 *   已关闭 —— 登记为其它任何状态，一体机显示管理员写的说明；
 *   未登记 —— 默认关闭的三项（彩色 / 自动双面 / 签名）一律拒绝，一体机显示「暂未开通」；
 *             其余能力由服务器部署设置决定：常规设置（managed）照常放行，严格设置（strict）拒绝。
 *             后台读不到服务器用的是哪种设置，所以两种都写出来，不替它下结论。
 */
function capabilityStateView(cap: TerminalCapabilityView): {
  badge: 'success' | 'warning' | 'info' | 'default'
  label: string
  hint: string | null
} {
  if (!cap.configured) {
    return DEFAULT_DENY_KEYS.includes(cap.capabilityKey)
      ? { badge: 'default', label: '未登记 · 默认关闭', hint: '一体机显示「暂未开通」' }
      : { badge: 'info', label: '未登记', hint: '按服务器部署设置：常规设置下照常开放，严格设置下关闭' }
  }
  if (cap.status === 'available') return { badge: 'success', label: '已开通', hint: null }
  return {
    badge: 'warning',
    label: `已关闭（${CAPABILITY_STATUS_BADGE[cap.status].label}）`,
    hint: cap.note ? `一体机显示：${cap.note}` : '未写说明，一体机显示默认提示',
  }
}

function CapabilityState({ cap }: { cap: TerminalCapabilityView }) {
  const view = capabilityStateView(cap)
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge status={view.badge} label={view.label} />
      {view.hint && <span className="max-w-[220px] text-[11.5px] leading-snug text-neutral-500">{view.hint}</span>}
    </div>
  )
}

// ─── 设备能力 ─────────────────────────────────────────────────────────────────

export function CapabilityCenter() {
  const [terminals, setTerminals] = useState<AdminTerminalRecord[]>([])
  const [terminalId, setTerminalId] = useState('')
  const [capabilities, setCapabilities] = useState<TerminalCapabilityView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const terminalIdRef = useRef(terminalId)
  const saveSeq = useRef(0)
  terminalIdRef.current = terminalId

  useEffect(() => {
    void (async () => {
      try {
        const res = await getTerminals()
        setTerminals(res.terminals)
        if (res.terminals.length > 0) setTerminalId(res.terminals[0]!.id)
        else setLoading(false)
      } catch (e) {
        setError(userMessageOf(e, '终端列表加载失败，请稍后重试'))
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
      setError(userMessageOf(e, '能力配置加载失败，请稍后重试'))
    } finally {
      if (seq === capSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 终端切换使 A 的所有保存回包失效，并清掉 A 的保存中/错误 UI。
    saveSeq.current += 1
    setSavingKey(null)
    setSaveError(null)
    setNotice(null)
    if (terminalId) void loadCapabilities(terminalId)
  }, [terminalId, loadCapabilities])

  const selected = useMemo(() => terminals.find((t) => t.id === terminalId) ?? null, [terminals, terminalId])

  const switchTerminal = (nextTerminalId: string) => {
    if (nextTerminalId === terminalId) return
    // 同一事件帧内先清掉 A 的 UI；effect 仍作为异步回包的二道防线。
    saveSeq.current += 1
    capSeq.current += 1
    terminalIdRef.current = nextTerminalId
    setSavingKey(null)
    setSaveError(null)
    setNotice(null)
    setCapabilities(null)
    setLoading(true)
    setTerminalId(nextTerminalId)
  }

  const save = async (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => {
    if (!terminalId || savingKey) return
    const requestedTerminalId = terminalId
    const requestSeq = ++saveSeq.current
    const isCurrentSaveRequest = () =>
      saveSeq.current === requestSeq && terminalIdRef.current === requestedTerminalId
    setSavingKey(key)
    setSaveError(null)
    setNotice(null)
    try {
      const res = await adminPrintScanService.updateCapability(requestedTerminalId, key, { status, note: note || undefined })
      if (!isCurrentSaveRequest()) return
      setCapabilities((prev) => prev?.map((c) => (c.capabilityKey === key ? res.capability : c)) ?? null)
    } catch (e) {
      if (isCurrentSaveRequest()) {
        setSaveError(userMessageOf(e, '保存失败，请检查后重试'))
      }
    } finally {
      if (isCurrentSaveRequest()) {
        setSavingKey(null)
      }
    }
  }

  const clear = async (key: PrintScanCapabilityKey) => {
    if (!terminalId || savingKey) return
    const requestedTerminalId = terminalId
    const requestSeq = ++saveSeq.current
    const isCurrentSaveRequest = () =>
      saveSeq.current === requestSeq && terminalIdRef.current === requestedTerminalId
    setSavingKey(key)
    setSaveError(null)
    setNotice(null)
    try {
      const res = await adminPrintScanService.clearCapability(requestedTerminalId, key)
      if (!isCurrentSaveRequest()) return
      setNotice(res.cleared ? '已恢复为未配置' : '这一项本来就未配置')
      await loadCapabilities(requestedTerminalId)
    } catch (e) {
      if (isCurrentSaveRequest()) setSaveError(userMessageOf(e, '恢复未配置失败，请稍后重试'))
    } finally {
      if (isCurrentSaveRequest()) setSavingKey(null)
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
          onChange={(e) => switchTerminal(e.target.value)}
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
            <PrinterHeartbeatText status={selected.printerStatus} />
            {selected.localTaskDatabaseAvailable === false ? ' · 本地任务库不可用' : ''}
          </span>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-neutral-500">
        只有标为「可用」的能力对用户开放；「测试中」只给运维使用；没有登记的能力一律不开放。彩色、自动双面、签名三项未登记即关闭，一体机显示「暂未开通」；其余能力未登记时按服务器部署设置处理
        （常规设置下照常开放，严格设置下关闭）。登记后以此处为准，每次保存都记入操作审计。
      </p>

      {saveError && <div className="rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{saveError}</div>}
      {notice && <div className="rounded-lg bg-primary-50 px-3 py-2 text-[12.5px] font-bold text-primary-800">{notice}</div>}

      {loading ? (
        <LoadingState text="正在加载能力配置" />
      ) : capabilities ? (
        <div className="overflow-x-auto rounded-xl border border-neutral-900/10 bg-surface">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-neutral-900/10 bg-neutral-50/90 text-[12px] text-neutral-500">
                <th className="px-4 py-2.5 font-bold">能力</th>
                <th className="px-4 py-2.5 font-bold">当前状态</th>
                <th className="px-4 py-2.5 font-bold">调整为</th>
                <th className="px-4 py-2.5 font-bold">备注（用户可见）</th>
                <th className="px-4 py-2.5 font-bold">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.filter((cap) => cap.capabilityKey !== 'cloud_upload').map((cap) =>
                cap.capabilityKey === 'signature_stamp' ? (
                  <SignatureCapabilityRow
                    key={cap.capabilityKey}
                    cap={cap}
                    saving={savingKey === cap.capabilityKey}
                    label={CAPABILITY_LABELS[cap.capabilityKey]}
                    state={<CapabilityState cap={cap} />}
                    onSave={save}
                    onClear={clear}
                  />
                ) : (
                  <CapabilityRow key={cap.capabilityKey} cap={cap} saving={savingKey === cap.capabilityKey} onSave={save} onClear={clear} />
                ),
              )}
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
  onClear,
}: {
  cap: TerminalCapabilityView
  saving: boolean
  onSave: (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => void
  onClear: (key: PrintScanCapabilityKey) => void
}) {
  // 未登记行的 cap.status 固定是 not_verified（列表对缺行的占位），不是一体机实际生效结果。
  // 下拉不预选：必须先选出一项才能登记，避免把仍跟随服务器部署设置的能力误写成关闭。
  const [status, setStatus] = useState<PrintScanCapabilityStatus | ''>(cap.configured ? cap.status : '')
  const [note, setNote] = useState(cap.note ?? '')
  useEffect(() => {
    setStatus(cap.configured ? cap.status : '')
    setNote(cap.note ?? '')
  }, [cap])

  const dirty = status !== cap.status || (note.trim() || '') !== (cap.note ?? '')
  const savable = cap.configured ? dirty : status !== ''

  return (
    <tr className="border-b border-neutral-900/5 last:border-b-0">
      <td className="px-4 py-2.5 font-bold text-neutral-800">
        {CAPABILITY_LABELS[cap.capabilityKey]}
        {DEPRECATED_CAPABILITY_ALIAS[cap.capabilityKey] && (
          <span className="ml-1.5 rounded bg-neutral-900/5 px-1.5 py-0.5 text-[11px] font-normal text-neutral-500">
            已弃用，等同「{CAPABILITY_LABELS[DEPRECATED_CAPABILITY_ALIAS[cap.capabilityKey]!]}」
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <CapabilityState cap={cap} />
      </td>
      <td className="px-4 py-2.5">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as PrintScanCapabilityStatus | '')}
          className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-2 text-[12.5px] text-neutral-800"
        >
          {!cap.configured && (
            <option value="" disabled>
              请选择
            </option>
          )}
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
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={!savable || saving}
            onClick={() => {
              if (status === '') return
              onSave(cap.capabilityKey, status, note.trim())
            }}
            className="rounded-lg bg-primary-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
          >
            {saving ? '保存中…' : cap.configured ? '保存' : '登记'}
          </button>
          {cap.configured && <ClearCapabilityButton disabled={saving} onConfirm={() => onClear(cap.capabilityKey)} />}
          {!cap.configured && status === '' && <span className="whitespace-nowrap">请先选择要登记的状态</span>}
        </span>
      </td>
    </tr>
  )
}
