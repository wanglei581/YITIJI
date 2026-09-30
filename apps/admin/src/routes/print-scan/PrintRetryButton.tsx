// 打印任务「重试」只展示服务端已经算好的 retryBlockedReason。
// 字符串 = 不能点，并在按钮下写出这句原因；null = 可以点。
// 字段缺失（旧后端）不在这里推断，由调用方用原来的显示规则决定要不要出现。

export function PrintRetryButton({
  retryBlockedReason,
  legacyVisible,
  busy,
  onRetry,
  label,
  layout,
}: {
  retryBlockedReason: string | null | undefined
  legacyVisible: boolean
  busy: boolean
  onRetry: () => void
  label: string
  layout: 'list' | 'detail'
}) {
  if (retryBlockedReason === undefined && !legacyVisible) return null
  // 置灰只由「原因是字符串」决定。null 与字段缺失都不置灰。
  const retryBlocked = typeof retryBlockedReason === 'string'
  const buttonClass = layout === 'list'
    ? 'h-9 rounded-lg bg-primary-700 px-3 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50'
    : 'h-10 w-full rounded-lg bg-primary-700 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <div className={layout === 'list' ? 'max-w-[16rem]' : undefined}>
      <button
        type="button"
        disabled={busy || retryBlocked}
        aria-disabled={busy || retryBlocked}
        onClick={(event) => {
          event.stopPropagation()
          if (busy || retryBlocked) return
          onRetry()
        }}
        className={buttonClass}
      >
        {busy ? '处理中…' : label}
      </button>
      {retryBlocked ? <p className="mt-1 text-[11px] leading-snug text-neutral-600">{retryBlockedReason}</p> : null}
    </div>
  )
}
