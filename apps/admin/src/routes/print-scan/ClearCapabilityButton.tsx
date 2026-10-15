import { useState } from 'react'

/** 已登记行旁的次要按钮。先在页内确认，确认后才交给调用方发请求。 */
export function ClearCapabilityButton({
  disabled,
  onConfirm,
}: {
  disabled: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="rounded-lg border border-neutral-900/15 bg-surface px-3 py-1.5 text-[12px] font-bold text-neutral-600 disabled:opacity-40"
      >
        恢复未配置
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="恢复未配置"
          className="mt-2 max-w-md rounded-lg border border-neutral-900/10 bg-neutral-50 p-3 text-[12.5px] leading-relaxed text-neutral-700"
        >
          <p className="font-bold text-neutral-800">恢复这一项为未配置？</p>
          <p className="mt-1">
            恢复后这一项不再由后台登记决定，改为跟随服务器的默认设置。彩色、自动双面、签名这几项默认关闭，一体机显示「暂未开通」；其余能力在常规设置下放行，在严格设置下关闭。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
              className="h-8 rounded-lg bg-primary-700 px-3 text-[12.5px] font-bold text-white disabled:opacity-40"
            >
              确认恢复
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setOpen(false)}
              className="h-8 rounded-lg border border-neutral-900/15 bg-surface px-3 text-[12.5px] font-bold text-neutral-700"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </>
  )
}
