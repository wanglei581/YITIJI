import { KioskModal } from '@ai-job-print/ui'
import { CheckIcon, RotateCcwIcon } from 'lucide-react'

export interface KioskFilterSection {
  id: string
  label: string
  value: string
  allLabel: string
  options: { value: string; label: string }[]
  allowEmpty?: boolean
}

export function KioskFilterPickerModal({
  open,
  title,
  description,
  sections,
  onChange,
  onClear,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  sections: KioskFilterSection[]
  onChange: (sectionId: string, value: string) => void
  onClear: () => void
  onClose: () => void
}) {
  return (
    <KioskModal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      className="max-w-[880px] [&_.ui-kiosk-modal-actions]:sticky [&_.ui-kiosk-modal-actions]:bottom-0 [&_.ui-kiosk-modal-actions]:z-[1] [&_.ui-kiosk-modal-actions]:bg-[var(--fy-surface)]"
      actions={(
        <>
          <button
            type="button"
            className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-7 text-xl font-semibold text-neutral-700"
            onClick={onClear}
          >
            <RotateCcwIcon className="h-5 w-5" aria-hidden="true" />
            清空筛选
          </button>
          <button
            type="button"
            className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-9 text-xl font-semibold text-white"
            onClick={onClose}
          >
            <CheckIcon className="h-5 w-5" aria-hidden="true" />
            完成
          </button>
        </>
      )}
    >
      <div className="space-y-7">
        {sections.map((section, index) => (
          <section key={section.id} className={index > 0 ? 'border-t border-neutral-200 pt-7' : undefined}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-[24px] font-bold text-neutral-900">{section.label}</h3>
              <span className="max-w-[55%] truncate text-lg text-neutral-500">
                当前：{section.options.find((option) => option.value === section.value)?.label ?? section.allLabel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {(section.allowEmpty === false
                ? section.options
                : [{ value: '', label: section.allLabel }, ...section.options]
              ).map((option) => {
                const active = option.value === section.value
                return (
                  <button
                    key={`${section.id}-${option.value || 'all'}`}
                    type="button"
                    aria-pressed={active}
                    className={[
                      'min-h-[58px] rounded-xl border px-4 py-2 text-center text-lg font-semibold transition-colors',
                      active
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-primary-300 hover:bg-primary-50',
                    ].join(' ')}
                    onClick={() => onChange(section.id, option.value)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </KioskModal>
  )
}
