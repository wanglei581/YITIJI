// 设备能力表的两行。从 CapabilityCenter.tsx 拆出，避免中心文件继续堆过 580 行。
// 能力名称仍由 CapabilityCenter 传入，彩色/双面标签留在那边给静态门禁核对。
import { useEffect, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'
import {
  DEFAULT_DENY_CAPABILITY_KEYS,
  DEPRECATED_CAPABILITY_ALIAS,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
  type TerminalCapabilityView,
} from '../../services/api/printScan'

type CapabilityLabelMap = Record<PrintScanCapabilityKey, string>
type CapabilityStatusOption = { value: PrintScanCapabilityStatus; label: string }

const CAPABILITY_STATUS_BADGE: Record<PrintScanCapabilityStatus, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  available: { badge: 'success', label: '可用' },
  testing: { badge: 'info', label: '测试中' },
  maintenance: { badge: 'warning', label: '维护中' },
  unsupported: { badge: 'default', label: '不支持' },
  not_verified: { badge: 'warning', label: '未验收' },
}

const DEFAULT_DENY_KEYS: readonly PrintScanCapabilityKey[] = DEFAULT_DENY_CAPABILITY_KEYS

function fmt(iso: string | null): string {
  return formatDateTime(iso)
}

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

function ConfirmOrReceiptRow({
  prompt,
  receipt,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  prompt: string | null
  receipt: string | null
  confirmDisabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!prompt && !receipt) return null
  return (
    <tr className="border-b border-neutral-900/5">
      <td colSpan={5} className="px-4 py-2.5">
        {prompt ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-[12px] font-bold text-neutral-800">
            <span>{prompt}</span>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={onConfirm}
              className="rounded-lg bg-primary-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              确认
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={onCancel}
              className="rounded-lg border border-neutral-900/15 bg-surface px-3 py-1.5 text-[12px] font-bold text-neutral-700 disabled:opacity-40"
            >
              取消
            </button>
          </span>
        ) : (
          <span className="text-[12px] font-bold text-neutral-800">{receipt}</span>
        )}
      </td>
    </tr>
  )
}

export function CapabilityRow({
  cap,
  labels,
  statusOptions,
  saving,
  controlsLocked,
  awaiting,
  prompt,
  receipt,
  confirmDisabled,
  onSave,
  onConfirm,
  onCancel,
}: {
  cap: TerminalCapabilityView
  labels: CapabilityLabelMap
  statusOptions: readonly CapabilityStatusOption[]
  saving: boolean
  controlsLocked: boolean
  awaiting: boolean
  prompt: string | null
  receipt: string | null
  confirmDisabled: boolean
  onSave: (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => void
  onConfirm: () => void
  onCancel: () => void
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
    <>
      <tr className="border-b border-neutral-900/5 last:border-b-0">
        <td className="px-4 py-2.5 font-bold text-neutral-800">
          {labels[cap.capabilityKey]}
          {DEPRECATED_CAPABILITY_ALIAS[cap.capabilityKey] && (
            <span className="ml-1.5 rounded bg-neutral-900/5 px-1.5 py-0.5 text-[11px] font-normal text-neutral-500">
              已弃用，等同「{labels[DEPRECATED_CAPABILITY_ALIAS[cap.capabilityKey]!]}」
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
            {statusOptions.map((o) => (
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
              disabled={!savable || saving || controlsLocked}
              onClick={() => {
                if (status === '') return
                onSave(cap.capabilityKey, status, note.trim())
              }}
              className="rounded-lg bg-primary-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              {saving ? '保存中…' : awaiting ? '待确认' : cap.configured ? '保存' : '登记'}
            </button>
            {!cap.configured && status === '' && <span className="whitespace-nowrap">请先选择要登记的状态</span>}
          </span>
        </td>
      </tr>
      <ConfirmOrReceiptRow
        prompt={prompt}
        receipt={receipt}
        confirmDisabled={confirmDisabled}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
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
export function SignatureCapabilityRow({
  cap,
  label,
  targetLabel,
  saving,
  controlsLocked,
  receipt,
  onSave,
}: {
  cap: TerminalCapabilityView
  label: string
  targetLabel: string
  saving: boolean
  controlsLocked: boolean
  receipt: string | null
  onSave: (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => void
}) {
  const [panel, setPanel] = useState<'none' | 'open' | 'close'>('none')
  const [note, setNote] = useState('')
  const [seenReceipt, setSeenReceipt] = useState(receipt)
  if (receipt !== seenReceipt) {
    setSeenReceipt(receipt)
    if (receipt) setPanel('none')
  }
  useEffect(() => {
    setPanel('none')
    setNote(cap.note ?? '')
  }, [cap])

  const isOpen = cap.configured && cap.status === 'available'
  const trimmed = note.trim()
  const openLocked = saving || controlsLocked

  return (
    <>
      <tr className={panel === 'none' && !receipt ? 'border-b border-neutral-900/5 last:border-b-0' : ''}>
        <td className="px-4 py-2.5 font-bold text-neutral-800">{label}</td>
        <td className="px-4 py-2.5">
          <CapabilityState cap={cap} />
        </td>
        <td className="px-4 py-2.5" colSpan={2}>
          <div className="flex flex-wrap gap-2">
            {!isOpen && (
              <button
                type="button"
                disabled={openLocked}
                onClick={() => setPanel('open')}
                className="h-8 rounded-lg border border-primary-300 bg-primary-50 px-3 text-[12.5px] font-bold text-primary-700 disabled:opacity-40"
              >
                开通
              </button>
            )}
            {isOpen && (
              <button
                type="button"
                disabled={openLocked}
                onClick={() => setPanel('close')}
                className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[12.5px] font-bold text-neutral-700 disabled:opacity-40"
              >
                关闭
              </button>
            )}
            {!isOpen && cap.configured && (
              <button
                type="button"
                disabled={openLocked}
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
      {panel !== 'none' ? (
        <tr className="border-b border-neutral-900/5 last:border-b-0">
          <td colSpan={5} className="px-4 pb-3">
            {panel === 'open' ? (
              <div className="rounded-lg border border-primary-200 bg-primary-50/60 p-3 text-[12.5px] leading-relaxed text-neutral-700">
                <p className="font-bold text-neutral-800">确认为『{targetLabel}』开通签名？</p>
                <ul className="mt-1 list-disc pl-5">
                  <li>只收用户本人的手写签名图片，叠到用户自己的 PDF 上；</li>
                  <li>不做公章、圆形章或任何单位印章；</li>
                  <li>开通后这台一体机立即可用，本次操作会记入操作审计。</li>
                </ul>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={openLocked}
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
                <p className="text-[12px] text-neutral-500">关闭『{targetLabel}』后，一体机「打印扫描」页的签名卡片停用，标「本机暂未开通」并显示这句说明。</p>
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
                    disabled={openLocked || !trimmed}
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
      ) : receipt ? (
        <tr className="border-b border-neutral-900/5 last:border-b-0">
          <td colSpan={5} className="px-4 py-2.5 text-[12px] font-bold text-neutral-800">{receipt}</td>
        </tr>
      ) : null}
    </>
  )
}
