// Admin 打印扫描运维中心 ·「设备能力」板块（从 print-scan/index.tsx 原样拆出，2026-09-29）。
//
// 终端 × 能力键开关（fail-closed：仅 available 对普通用户开放），终端 Agent 版本 / 降级 /
// 打印机状态为心跳真实值。这是后台唯一能逐台开关能力的地方。
// 表格行在 CapabilityRows.tsx。确认提示和成功回执插在被点的那一行正下方。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'
import { CapabilityTargetBar } from './CapabilityTargetBar'
import { CapabilityRow, SignatureCapabilityRow } from './CapabilityRows'
import {
  adminPrintScanService,
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

const CAPABILITY_STATUS_OPTIONS: { value: PrintScanCapabilityStatus; label: string }[] = [
  { value: 'available', label: '可用（对用户开放）' },
  { value: 'testing', label: '测试中（仅运维可见）' },
  { value: 'maintenance', label: '维护中' },
  { value: 'unsupported', label: '不支持' },
  { value: 'not_verified', label: '未验收' },
]

function terminalDisplayLabel(terminal: { displayName: string | null; terminalCode: string }): string {
  const name = terminal.displayName?.trim() || terminal.terminalCode
  return `${name}（${terminal.terminalCode}）`
}

interface PendingCapabilitySave {
  terminalId: string
  key: PrintScanCapabilityKey
  status: PrintScanCapabilityStatus
  note: string
  capabilityLabel: string
  statusLabel: string
  displayLabel: string
}

interface CapabilitySaveReceipt {
  key: PrintScanCapabilityKey
  terminalCode: string
  at: string
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
  const [pending, setPending] = useState<PendingCapabilitySave | null>(null)
  const [receipt, setReceipt] = useState<CapabilitySaveReceipt | null>(null)
  const terminalIdRef = useRef(terminalId)
  const pendingRef = useRef<PendingCapabilitySave | null>(null)
  const saveSeq = useRef(0)
  const saveLockRef = useRef(false)
  terminalIdRef.current = terminalId

  useEffect(() => {
    void (async () => {
      try {
        const res = await getTerminals()
        setTerminals(res.terminals)
      } catch (e) {
        setError(e instanceof Error ? e.message : '终端列表加载失败')
      } finally {
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
    saveLockRef.current = false
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
    saveLockRef.current = false
    terminalIdRef.current = nextTerminalId
    pendingRef.current = null
    setPending(null)
    setReceipt(null)
    setSavingKey(null)
    setSaveError(null)
    setCapabilities(null)
    setLoading(true)
    if (!nextTerminalId) setLoading(false)
    setTerminalId(nextTerminalId)
  }

  const save = async (
    key: PrintScanCapabilityKey,
    status: PrintScanCapabilityStatus,
    note: string,
    requestedTerminalId: string,
  ) => {
    if (!requestedTerminalId || savingKey || saveLockRef.current) return
    saveLockRef.current = true
    const requestSeq = ++saveSeq.current
    const isCurrentSaveRequest = () =>
      saveSeq.current === requestSeq && terminalIdRef.current === requestedTerminalId
    setSavingKey(key)
    setSaveError(null)
    try {
      const res = await adminPrintScanService.updateCapability(requestedTerminalId, key, { status, note: note || undefined })
      if (!isCurrentSaveRequest()) return
      setCapabilities((prev) => prev?.map((c) => (c.capabilityKey === key ? res.capability : c)) ?? null)
      setReceipt({ key, terminalCode: res.terminalCode, at: formatDateTime(res.capability.updatedAt) })
      pendingRef.current = null
      setPending(null)
    } catch (e) {
      if (isCurrentSaveRequest()) {
        setSaveError(e instanceof Error ? e.message : '保存失败')
        pendingRef.current = null
        setPending(null)
      }
    } finally {
      if (saveSeq.current === requestSeq) saveLockRef.current = false
      if (isCurrentSaveRequest()) {
        setSavingKey(null)
      }
    }
  }

  // 登记/保存先记下当时的终端，确认时只用这个 id。切换后待确认作废，不再发请求。
  // 已有待确认或保存在途时直接返回；按钮同时 disabled，避免连点覆盖。
  const requestSave = (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => {
    if (!terminalId || savingKey || saveLockRef.current || pendingRef.current) return
    const requestedTerminalId = terminalId
    if (requestedTerminalId !== terminalIdRef.current) return
    const next: PendingCapabilitySave = {
      terminalId: requestedTerminalId,
      key,
      status,
      note,
      capabilityLabel: CAPABILITY_LABELS[key],
      statusLabel: CAPABILITY_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status,
      displayLabel: selected ? terminalDisplayLabel(selected) : requestedTerminalId,
    }
    pendingRef.current = next
    setReceipt(null)
    setPending(next)
  }

  const confirmSave = () => {
    const current = pendingRef.current
    if (!current || savingKey || saveLockRef.current) return
    if (current.terminalId !== terminalIdRef.current) {
      pendingRef.current = null
      setPending(null)
      return
    }
    void save(current.key, current.status, current.note, current.terminalId)
  }

  const cancelSave = () => {
    if (savingKey || saveLockRef.current) return
    pendingRef.current = null
    setPending(null)
  }

  const saveSignature = (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => {
    const requestedTerminalId = terminalId
    if (!requestedTerminalId || savingKey || saveLockRef.current) return
    if (requestedTerminalId !== terminalIdRef.current) return
    pendingRef.current = null
    setPending(null)
    void save(key, status, note, requestedTerminalId)
  }

  if (error) return <ErrorState title="加载失败" message={error} onRetry={() => { if (terminalId) void loadCapabilities(terminalId) }} />
  if (terminals.length === 0 && !loading) {
    return <EmptyState title="暂无终端" description="尚无已注册终端，注册后可在此配置能力开关。" />
  }

  const controlsLocked = pending !== null || savingKey !== null
  const promptText = pending && pending.terminalId === terminalId
    ? `将把『${pending.displayLabel}』的『${pending.capabilityLabel}』登记为『${pending.statusLabel}』`
    : null
  const receiptText = receipt ? `已登记到 ${receipt.terminalCode} · ${receipt.at}` : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="终端"
          value={terminalId}
          onChange={(e) => switchTerminal(e.target.value)}
          className="h-9 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[13px] font-bold text-neutral-800"
        >
          <option value="">请先选择终端</option>
          {terminals.map((t) => (
            <option key={t.id} value={t.id}>
              {terminalDisplayLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <CapabilityTargetBar identity={selected} />

      <p className="text-[12px] leading-relaxed text-neutral-500">
        只有标为「可用」的能力对用户开放；「测试中」只给运维使用；没有登记的能力一律不开放。彩色、自动双面、签名三项未登记即关闭，一体机显示「暂未开通」；其余能力未登记时按服务器部署设置处理
        （常规设置下照常开放，严格设置下关闭）。登记后以此处为准，每次保存都记入操作审计。
      </p>

      {saveError && <div className="rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{saveError}</div>}

      {selected && loading ? (
        <LoadingState text="正在加载能力配置" />
      ) : selected && capabilities ? (
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
                    label={CAPABILITY_LABELS[cap.capabilityKey]}
                    targetLabel={terminalDisplayLabel(selected)}
                    saving={savingKey === cap.capabilityKey}
                    controlsLocked={controlsLocked}
                    receipt={receipt?.key === cap.capabilityKey ? receiptText : null}
                    onSave={saveSignature}
                  />
                ) : (
                  <CapabilityRow
                    key={cap.capabilityKey}
                    cap={cap}
                    labels={CAPABILITY_LABELS}
                    statusOptions={CAPABILITY_STATUS_OPTIONS}
                    saving={savingKey === cap.capabilityKey}
                    controlsLocked={controlsLocked}
                    awaiting={pending?.key === cap.capabilityKey}
                    prompt={pending?.key === cap.capabilityKey ? promptText : null}
                    receipt={receipt?.key === cap.capabilityKey && pending?.key !== cap.capabilityKey ? receiptText : null}
                    confirmDisabled={savingKey !== null}
                    onSave={requestSave}
                    onConfirm={confirmSave}
                    onCancel={cancelSave}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
