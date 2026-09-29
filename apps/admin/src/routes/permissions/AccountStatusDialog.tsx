// 启停管理员账号确认弹窗：事由（2–200 字，显示字数）+ 管理员本人当前密码。
// 服务端语义：成功返回该行新状态与 sessionInvalidation；本人密码错留在本步重填。

import { AlertTriangleIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Field } from '../../components/form'
import { ApiHttpError } from '../../services/api/client'
import type { InternalAccountItem, InternalAccountStatusResult } from '../../services/api/internalAccounts'
import { setInternalAccountStatus } from '../../services/api/internalAccounts'
import { userMessageOf } from '../../services/api/userErrorMessage'

export type StatusIntent = 'enable' | 'disable'

export interface AccountStatusDialogTarget {
  account: InternalAccountItem
  intent: StatusIntent
}

interface AccountStatusDialogProps {
  target: AccountStatusDialogTarget | null
  onClose: () => void
  /** 成功：用响应体就地刷新该行（sessionInvalidation 语义由父层提示）。 */
  onStatusApplied: (result: InternalAccountStatusResult, intent: StatusIntent) => void
  /** 409 状态类错误：名册可能与服务器不一致，让父层刷新列表。 */
  onRosterChanged: () => void
}

const inputCls =
  'min-h-12 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const RESTART_REFRESH_CODES = new Set([
  'INTERNAL_ACCOUNT_STATE_CHANGED',
  'INTERNAL_ACCOUNT_STATUS_UNCHANGED',
  'INTERNAL_ACCOUNT_NOT_FOUND',
])

export function AccountStatusDialog({ target, onClose, onStatusApplied, onRosterChanged }: AccountStatusDialogProps) {
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!target) return
    setReason('')
    setPassword('')
    setError(null)
    const timer = window.setTimeout(() => reasonRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [target])

  useEffect(() => {
    if (!target) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [target, busy, onClose])

  if (!target) return null

  const { account, intent } = target
  const isDisable = intent === 'disable'
  const title = isDisable ? '停用管理员账号' : '启用管理员账号'
  const trimmedReason = reason.trim()

  const submit = async () => {
    if (trimmedReason.length < 2 || password.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await setInternalAccountStatus(account.id, {
        action: intent,
        reason: trimmedReason,
        adminCurrentPassword: password,
      })
      onStatusApplied(result, intent)
      onClose()
    } catch (caught) {
      setError(userMessageOf(caught, '操作失败，请检查网络后重试'))
      if (caught instanceof ApiHttpError && RESTART_REFRESH_CODES.has(caught.code)) {
        onRosterChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {isDisable ? '停用' : '启用'}「{account.username}（{account.name || account.username}）」？
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          {isDisable && (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600">
              <li>停用后该账号无法登录管理后台，已登录的凭证在下一次请求时失效。</li>
              <li>如需恢复，可在本页再次启用（同样需要填写事由并验证本人密码）。</li>
            </ul>
          )}
          <p className="text-sm text-neutral-500">本次操作会记入审计日志（操作人、事由、来源）。</p>

          {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <Field label={isDisable ? '停用事由' : '启用事由'} required hint={`2-200 字，用于事后追责（${trimmedReason.length}/200）`}>
            <textarea
              ref={reasonRef}
              className={`${inputCls} h-20 resize-none`}
              placeholder={isDisable ? '例如：人员离岗，已交接工作' : '例如：人员返岗，恢复后台权限'}
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <Field label="管理员本人当前密码" required hint="高风险动作需要确认操作者身份；临时密码不能用于确认">
            <input
              type="password"
              autoComplete="current-password"
              className={inputCls}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>密码只提交给服务端做本人验证，本页不保存、不回显。</span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-12 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || trimmedReason.length < 2 || password.length === 0}
            onClick={() => void submit()}
            className={`min-h-12 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              isDisable ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {busy ? '提交中…' : isDisable ? '确认停用' : '确认启用'}
          </button>
        </div>
      </div>
    </div>
  )
}
