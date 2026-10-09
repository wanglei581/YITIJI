import { useEffect, useState, type ReactNode } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import {
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
  type TerminalCapabilityView,
} from '../../services/api/printScan'
import { ClearCapabilityButton } from './ClearCapabilityButton'

function fmt(iso: string | null): string {
  return formatDateTime(iso)
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
  saving,
  label,
  state,
  onSave,
  onClear,
}: {
  cap: TerminalCapabilityView
  saving: boolean
  label: string
  state: ReactNode
  onSave: (key: PrintScanCapabilityKey, status: PrintScanCapabilityStatus, note: string) => void
  onClear: (key: PrintScanCapabilityKey) => void
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
        <td className="px-4 py-2.5 font-bold text-neutral-800">{label}</td>
        <td className="px-4 py-2.5">{state}</td>
        <td className="px-4 py-2.5" colSpan={2}>
          <div className="flex flex-wrap items-start gap-2">
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
            {cap.configured && <ClearCapabilityButton disabled={saving} onConfirm={() => onClear(cap.capabilityKey)} />}
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
                  placeholder="例如：本机暂不提供签名"
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
