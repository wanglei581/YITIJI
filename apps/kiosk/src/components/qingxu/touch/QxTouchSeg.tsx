export type QxTouchSegOption = { id: string; label: string; disabled?: boolean }

export function QxTouchSeg({
  options,
  value,
  onChange,
  label = '选择',
}: {
  options: readonly QxTouchSegOption[]
  value: string
  onChange: (id: string) => void
  label?: string
}) {
  return (
    <div className="qxt-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
