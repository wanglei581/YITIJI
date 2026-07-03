/** 筛选 chip（墨青纸感规范：h-30 圆角胶囊，激活态墨底白字，可带计数）。 */
export function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex h-[30px] items-center gap-1.5 rounded-full border px-[13px] text-[12.5px] font-bold transition-colors ' +
        (active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40')
      }
    >
      {label}
      {count !== undefined && (
        <span className={'text-[11px] font-extrabold ' + (active ? 'opacity-70' : 'text-neutral-500')}>
          {count}
        </span>
      )}
    </button>
  )
}
