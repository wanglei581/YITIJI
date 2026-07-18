import { useEffect, useRef } from 'react'
import type { AdminOrgAccount } from '../../../services/api/orgsAdmin'

export function PartnerAccountDeleteConfirmationDialog({
  account,
  organizationName,
  busy,
  ticketSeconds,
  onCancel,
  onConfirm,
}: {
  account: AdminOrgAccount
  organizationName: string
  busy: boolean
  ticketSeconds: number
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => { cancelRef.current?.focus() }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/55 p-4">
      <div
        ref={alertRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="partner-account-final-delete-title"
        aria-describedby="partner-account-final-delete-description"
        className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === 'Tab') {
            const focusable = Array.from(alertRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
            if (focusable.length === 0) return
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <h3 id="partner-account-final-delete-title" className="text-base font-semibold text-neutral-900">最终确认删除机构账号</h3>
        <p id="partner-account-final-delete-description" className="mt-2 text-sm leading-6 text-neutral-600">
          所属机构「{organizationName}」，机构账号姓名「{account.name}」，登录账号名「{account.username}」。删除后不可直接恢复，现有会话将失效，原用户名和手机号可重新使用。
        </p>
        <p className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
          机构必须保留至少一个已启用账号。当前操作授权剩余 {ticketSeconds} 秒，提交失败不会自动重试。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50">返回</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-error-fg px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? '删除中…' : '确认删除账号'}
          </button>
        </div>
      </div>
    </div>
  )
}
