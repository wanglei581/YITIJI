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
    // 终端切换使 A 的所有保存回包失效，并清掉 A 的保存中/错误 UI。
    saveSeq.current += 1
    setSavingKey(null)
    setSaveError(null)
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
    try {
      const res = await adminPrintScanService.updateCapability(requestedTerminalId, key, { status, note: note || undefined })
      if (!isCurrentSaveRequest()) return
      setCapabilities((prev) => prev?.map((c) => (c.capabilityKey === key ? res.capability : c)) ?? null)
    } catch (e) {
      if (isCurrentSaveRequest()) {
        setSaveError(e instanceof Error ? e.message : '保存失败')
      }
    } finally {
      if (isCurrentSaveRequest()) {
        setSavingKey(null)
      }
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
                  <SignatureCapabilityRow key={cap.capabilityKey} cap={cap} saving={savingKey === cap.capabilityKey} onSave={save} />
                ) : (
                  <CapabilityRow key={cap.capabilityKey} cap={cap} saving={savingKey === cap.capabilityKey} onSave={save} />
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

  const dirty = status !== cap.status || (note.trim() || '') !== (cap.note ?? '')
  // 未登记的行允许不改任何内容、原样登记（例如把「未验收」正式写进去，从此不再跟随服务器部署设置）。
  const savable = dirty || !cap.configured

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
          disabled={!savable || saving}
          onClick={() => onSave(cap.capabilityKey, status, note.trim())}
          className="rounded-lg bg-primary-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
        >
          {saving ? '保存中…' : cap.configured ? '保存' : '登记'}
        </button>
      </td>
    </tr>
  )
}

/**
 * 签名这一行只有两个动作（产品负责人定：签名只保留本人手写签名）：
 *   开通 —— 页内确认后登记为「可用」；
 *   关闭 —— 必须填一句用户可见说明（≤200 字），登记为「未验收」。
 * 关闭选「未验收」而不是「不支持」「维护中」：机器本身能做（说「不支持」是谎报硬件），
 * 也不是临时维修（「维护中」会让一体机显示「正在维护」）；「未验收」在一体机上显示「本机暂未开通」，
 * 与未登记时的默认关闭同一口径，只是多了管理员写的说明。两个动作都走同一个保存接口，服务端写审计。
 */
function SignatureCapabilityRow({
  cap,
  saving,
  onSave,
}: {
  cap: TerminalCapabilityView
  saving: boolean
  onSave: (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => void
}) {
  const [panel, setPanel] = useState<'none' | 'open' | 'close'>('none')
  const [note, setNote] = useState('')
  useEffect(() => {
    setPanel('none')
    setNote(cap.note ?? '')
  }, [cap])

  const isOpen = cap.configured && cap.status === 'available'
  const trimmed = note.trim()

  return (
    <>
      <tr className={panel === 'none' ? 'border-b border-neutral-900/5 last:border-b-0' : ''}>
        <td className="px-4 py-2.5 font-bold text-neutral-800">{CAPABILITY_LABELS[cap.capabilityKey]}</td>
        <td className="px-4 py-2.5">
          <CapabilityState cap={cap} />
        </td>
        <td className="px-4 py-2.5" colSpan={2}>
          <div className="flex flex-wrap gap-2">
            {!isOpen && (
              <button
                type="button"
                disabled={saving}
                onClick={() => setPanel('open')}
                className="h-8 rounded-lg border border-primary-300 bg-primary-50 px-3 text-[12.5px] font-bold text-primary-700 disabled:opacity-40"
              >
                开通
              </button>
            )}
            {isOpen && (
              <button
                type="button"
                disabled={saving}
                onClick={() => setPanel('close')}
                className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[12.5px] font-bold text-neutral-700 disabled:opacity-40"
              >
                关闭
              </button>
            )}
            {!isOpen && cap.configured && (
              <button
                type="button"
                disabled={saving}
                onClick={() => setPanel('close')}
                className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[12.5px] font-bold text-neutral-700 disabled:opacity-40"
              >
                修改关闭说明
              </button>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-[12px] text-neutral-500">{fmt(cap.updatedAt)}</td>
      </tr>
      {panel !== 'none' && (
        <tr className="border-b border-neutral-900/5 last:border-b-0">
          <td colSpan={5} className="px-4 pb-3">
            {panel === 'open' ? (
              <div className="rounded-lg border border-primary-200 bg-primary-50/60 p-3 text-[12.5px] leading-relaxed text-neutral-700">
                <p className="font-bold text-neutral-800">确认为这台终端开通签名？</p>
                <ul className="mt-1 list-disc pl-5">
                  <li>只收用户本人的手写签名图片，叠到用户自己的 PDF 上；</li>
                  <li>不做公章、圆形章或任何单位印章；</li>
                  <li>开通后这台一体机立即可用，本次操作会记入操作审计。</li>
                </ul>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onSave(cap.capabilityKey, 'available', '')}
                    className="h-8 rounded-lg bg-primary-700 px-3 text-[12.5px] font-bold text-white disabled:opacity-40"
                  >
                    {saving ? '保存中…' : '确认开通'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setPanel('none')}
                    className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[12.5px] font-bold text-neutral-700"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-neutral-900/10 bg-neutral-50 p-3 text-[12.5px] leading-relaxed text-neutral-700">
                <label htmlFor={`sign-close-note-${cap.capabilityKey}`} className="font-bold text-neutral-800">
                  用户可见说明（必填，最多 200 字）
                </label>
                <p className="text-[12px] text-neutral-500">关闭后一体机「打印扫描」页的签名卡片停用，标「本机暂未开通」并显示这句说明。</p>
                <input
                  id={`sign-close-note-${cap.capabilityKey}`}
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：本机暂不提供签名，请到服务台办理"
                  className="mt-1.5 h-8 w-full max-w-md rounded-lg border border-neutral-900/15 bg-surface px-2 text-[12.5px] text-neutral-800"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={saving || !trimmed}
                    onClick={() => onSave(cap.capabilityKey, 'not_verified', trimmed)}
                    className="h-8 rounded-lg bg-primary-700 px-3 text-[12.5px] font-bold text-white disabled:opacity-40"
                  >
                    {saving ? '保存中…' : isOpen ? '确认关闭' : '保存说明'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setPanel('none')}
                    className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[12.5px] font-bold text-neutral-700"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
