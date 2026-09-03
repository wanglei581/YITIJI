import type { AdminUserListItem, AdminUserStatusChangeResult } from '@ai-job-print/shared'
import { AlertTriangleIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Field, GhostButton } from '../../components/form'
import { ApiHttpError } from '../../services/api/client'
import { disable as disableUser, restore as restoreUser } from '../../services/api/adminUsers'
import { userDisplayName } from './userPresentation'

export type UserStatusIntent = 'disable' | 'restore'

export interface UserStatusDialogTarget {
  user: AdminUserListItem
  intent: UserStatusIntent
}

interface UserStatusDialogProps {
  target: UserStatusDialogTarget | null
  onClose: () => void
  onSuccess: (result: AdminUserStatusChangeResult, intent: UserStatusIntent) => void
}

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

/**
 * 停用后果说明。
 *
 * 每一条都对应读过的代码。不许改写成听起来更利落、但代码做不到的强断言
 * （verify-admin-users-ui.mjs 会逐条扫描这类夸大措辞并判红）：
 *   - 会话失效时机：common/guards/end-user-auth.guard.ts:61-71 每请求实时查库，
 *     所以是「下一次操作时」，不是「立刻关掉他正在看的页面」。
 *   - 已付款订单：print-jobs.controller.ts:33 的取件链路按终端 + 取件码放行，
 *     根本不查用户状态，纸照出。这是产品决策（停用是阻止继续消费，
 *     不是没收已付费的服务），不是待修的漏洞 —— 别把这条提示删掉。
 */
const DISABLE_CONSEQUENCES = [
  '该用户无法登录，已登录的会话在下一次操作时失效（不会立刻关闭他正在看的页面）。',
  '他无法再下新的打印订单、无法使用 AI 服务。',
]

export function UserStatusDialog({ target, onClose, onSuccess }: UserStatusDialogProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!target) return
    setReason('')
    setError(null)
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 50)
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

  const { user, intent } = target
  const isDisable = intent === 'disable'
  const title = isDisable ? '停用终端用户' : '恢复终端用户'
  const trimmedReason = reason.trim()

  const submit = async () => {
    if (!trimmedReason || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = isDisable
        ? await disableUser(user.id, trimmedReason)
        : await restoreUser(user.id, trimmedReason)
      onSuccess(result, intent)
      onClose()
    } catch (caught) {
      setError(
        caught instanceof ApiHttpError
          ? caught.message
          : '操作失败，请检查网络后重试',
      )
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
            {isDisable ? '停用' : '恢复'}「{userDisplayName(user)}（{user.maskedPhone}）」？
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          {isDisable ? (
            <div className="space-y-3">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600">
                {DISABLE_CONSEQUENCES.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">已付款的订单不受影响</strong>
                  ——他仍可在一体机上用取件码取走已付费的打印件。如需处理这类订单，请到订单管理单独操作。
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">恢复后该用户可重新登录并使用全部服务。</p>
          )}

          <p className="text-sm text-neutral-500">本次操作会记入审计日志。</p>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <Field label={isDisable ? '停用原因' : '恢复原因'} required hint="2-200 字，用于事后追责">
            <textarea
              ref={textareaRef}
              className={`${inputCls} h-20 resize-none`}
              placeholder={isDisable ? '例如：反复刷免费 AI 额度，已电话告知' : '例如：用户申诉成立，恢复使用'}
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          <GhostButton disabled={busy} onClick={onClose}>取消</GhostButton>
          <button
            type="button"
            disabled={busy || !trimmedReason}
            onClick={() => void submit()}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              isDisable ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {busy ? '提交中…' : isDisable ? '确认停用' : '确认恢复'}
          </button>
        </div>
      </div>
    </div>
  )
}
