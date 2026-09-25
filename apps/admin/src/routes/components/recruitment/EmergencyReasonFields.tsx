import {
  RECRUITMENT_EMERGENCY_NOTE_MAX,
  RECRUITMENT_EMERGENCY_REASON_LABELS,
  type RecruitmentEmergencyReasonCode,
} from '@ai-job-print/shared'
import type { EmergencyReasonValue } from './emergencyReason'

const inputCls =
  'w-full rounded-lg border border-neutral-200 bg-surface px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-50'

/** 紧急下架与熔断共用的「事由 + 说明」两项。两项都会写进审计，说明会发给所属机构。 */
export function EmergencyReasonFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string
  value: EmergencyReasonValue
  onChange: (next: EmergencyReasonValue) => void
  disabled?: boolean
}) {
  const textLength = value.reasonText.trim().length
  return (
    <div className="space-y-3">
      <label className="block" htmlFor={`${idPrefix}-reason`}>
        <span className="mb-1 block text-xs font-medium text-neutral-600">
          事由<span className="ml-0.5 text-error-fg">*</span>
        </span>
        <select
          id={`${idPrefix}-reason`}
          className={inputCls}
          value={value.reasonCode}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, reasonCode: e.target.value as EmergencyReasonValue['reasonCode'] })}
        >
          <option value="">请选择事由</option>
          {(Object.entries(RECRUITMENT_EMERGENCY_REASON_LABELS) as Array<[RecruitmentEmergencyReasonCode, string]>).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </label>
      <label className="block" htmlFor={`${idPrefix}-note`}>
        <span className="mb-1 block text-xs font-medium text-neutral-600">
          说明<span className="ml-0.5 text-error-fg">*</span>
          <span className="ml-2 font-normal text-neutral-400">写进审计，并随通知发给所属机构</span>
        </span>
        <textarea
          id={`${idPrefix}-note`}
          className={`${inputCls} h-20 resize-none`}
          maxLength={RECRUITMENT_EMERGENCY_NOTE_MAX}
          placeholder="写清依据，例如投诉编号、主管部门文书、违规表述所在位置"
          value={value.reasonText}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, reasonText: e.target.value })}
        />
        <span className="mt-1 block text-right text-[11px] tabular-nums text-neutral-400">
          {textLength} / {RECRUITMENT_EMERGENCY_NOTE_MAX}
        </span>
      </label>
    </div>
  )
}
