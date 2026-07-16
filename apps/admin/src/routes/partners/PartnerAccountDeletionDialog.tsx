import { useEffect, useRef } from 'react'
import type { AdminOrgAccount } from '../../services/api/orgsAdmin'

export function PartnerAccountDeletionDialog({
  account,
  busy,
  onCancel,
  onConfirm,
}: {
  account: AdminOrgAccount | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!account) return
    cancelRef.current?.focus()
  }, [account])

  if (!account) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="partner-account-delete-title"
        aria-describedby="partner-account-delete-description"
        className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <h2 id="partner-account-delete-title" className="text-base font-semibold text-neutral-900">
          确认移除机构账号？
        </h2>
        <p id="partner-account-delete-description" className="mt-2 text-sm leading-6 text-neutral-600">
          将移除「{account.name}（{account.username}）」的登录访问。删除后不可直接恢复，原用户名和手机号可重新使用。
        </p>
        <p className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
          机构必须保留至少一个已启用账号；如被拒绝，请先新增并启用接替账号。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-error-fg px-3 py-2 text-sm font-medium text-white hover:bg-error-fg/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '移除中…' : '确认移除'}
          </button>
        </div>
      </div>
    </div>
  )
}
