// ============================================================
// ComingSoonNotice — 诚实「即将上线」提示
//
// 政策/资讯信息页（政策服务页等）里有些按钮（扫码预约 / 查看详情 /
// 去来源平台投递 等）对应的外部跳转 / 扫码能力尚未接入。为避免触控屏「点了没反应」，
// 统一弹出一个轻量说明覆盖层，明确告知功能即将上线、当前可前往官方渠道办理。
//
// 合规：本组件仅展示提示文案，不发起任何投递 / 收简历动作；调用方传入的 action
// 文案必须使用白名单（查看岗位/去来源平台投递/扫码投递/查看招聘会/去来源平台预约/
// 扫码预约 等），本组件不改写文案语义。
// ============================================================

import { useCallback, useState } from 'react'
import { InfoIcon, XIcon } from 'lucide-react'

export function useComingSoonNotice() {
  const [message, setMessage] = useState<string | null>(null)

  const notify = useCallback((action: string) => {
    setMessage(`「${action}」功能即将上线。当前可前往对应官方渠道或服务窗口办理，如需帮助可咨询 AI 助手。`)
  }, [])

  const close = useCallback(() => setMessage(null), [])

  const overlay = message ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50">
            <InfoIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-neutral-900">功能即将上线</p>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{message}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={close}
          className="mt-5 w-full rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-700"
        >
          我知道了
        </button>
      </div>
    </div>
  ) : null

  return { notify, overlay }
}
