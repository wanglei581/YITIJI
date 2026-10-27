export type QxTouchSegOption = { id: string; label: string; disabled?: boolean }

export function QxTouchSeg({
  options,
  value,
  onChange,
}: {
  options: readonly QxTouchSegOption[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="qxt-seg" role="group" aria-label="分段选择">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
