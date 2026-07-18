import { useEffect, useRef, type RefObject } from 'react'
import { ActionCredentialSteps } from './partner-account-action-steps/ActionCredentialSteps'
import { PartnerAccountDeleteConfirmationDialog } from './partner-account-action-steps/PartnerAccountDeleteConfirmationDialog'
import { PhoneRebindSteps } from './partner-account-action-steps/PhoneRebindSteps'
import type { UsePartnerAccountActionResult } from './usePartnerAccountAction'

const errorMessages: Record<string, string> = {
  ADMIN_CREDENTIAL_INVALID: '管理员本人密码不正确，请重试。',
  ADMIN_CREDENTIAL_LOCKED: '管理员密码尝试次数过多，请等待锁定解除后重新开始。',
  ACCOUNT_CREDENTIAL_INVALID: '验证码或目标账号密码不正确，请重试。',
  ACCOUNT_CREDENTIAL_LOCKED: '验证尝试次数过多，请等待限制解除后重新开始。',
  ACCOUNT_ACTION_METHOD_UNAVAILABLE: '当前验证方式已不可用，请选择其他方式。',
  ACCOUNT_PASSWORD_PROOF_NOT_READY: '目标账号密码尚无独立持有人证明，请使用已验证手机号或完成线下核验恢复。',
  ACCOUNT_ACTION_TICKET_STALE: '账号信息已被其他操作更新，请刷新后重新开始。',
  ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE: '安全验证已过期或被替换，请重新开始。',
  ACCOUNT_ACTION_STEP_UP_REQUIRED: '安全授权已失效，请重新开始验证。',
  ACCOUNT_COMMIT_CONFLICT: '机构账号正在被其他管理员修改，请在授权有效期内稍后重试。',
  PHONE_TAKEN: '新手机号已被使用，请更换手机号并重新完成旧因子验证。',
  LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED: '该机构必须保留至少一个已启用账号，请先新增并启用接替账号。',
  ACCOUNT_NOT_FOUND: '账号已不存在或已被其他操作更新，机构详情已刷新。',
  NETWORK_ERROR: '网络状态异常，未自动重试最终操作；请以刷新后的机构详情为准。',
  SMS_TOO_FREQUENT: '验证码发送过于频繁，请稍后重试或改用其他验证方式。',
  SMS_DAILY_LIMIT: '今日验证码请求次数已达上限，请改用其他验证方式或稍后处理。',
  SMS_IP_LIMIT: '当前网络请求验证码过于频繁，请稍后重试。',
  SMS_DEVICE_LIMIT: '当前设备请求验证码过于频繁，请稍后重试。',
  SMS_PROVIDER_PHONE_DAILY_LIMIT: '该手机号今日短信发送次数已达上限，请稍后处理。',
  SMS_PROVIDER_RATE_LIMIT: '短信通道繁忙，请稍后重试。',
  SMS_SEND_FAILED: '短信发送失败；若旧因子授权已被消费，请重新完成安全验证。',
}

function secondsLeft(deadline: number, nowMs: number): number {
  return deadline > 0 ? Math.max(0, Math.ceil((deadline - nowMs) / 1_000)) : 0
}

export function PartnerAccountActionDialog({
  flow,
  fallbackFocusRef,
}: {
  flow: UsePartnerAccountActionResult
  fallbackFocusRef: RefObject<HTMLElement>
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(false)
  const state = flow.state
  const open = state.step !== 'closed'

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      requestAnimationFrame(() => {
        const initial = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')
        initial?.focus()
      })
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    requestAnimationFrame(() => {
      const trigger = flow.triggerElementRef.current
      if (trigger?.isConnected) trigger.focus()
      else fallbackFocusRef.current?.focus()
    })
  }, [fallbackFocusRef, flow.triggerElementRef, open, state.step])

  if (!open || !flow.account) return null

  const deleting = flow.state.action === 'delete_account'
  const title = deleting ? '安全删除机构账号' : '安全换绑机构账号手机号'
  const ticketSeconds = secondsLeft(flow.actionTicketDeadline, flow.nowMs)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="partner-account-action-title"
        aria-describedby="partner-account-action-description"
        aria-busy={state.busy}
        className="w-full max-w-lg rounded-xl bg-surface p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (!flow.state.busy) void flow.close()
            return
          }
          if (event.key === 'Tab') {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            ) ?? [])
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="partner-account-action-title" className="text-base font-semibold text-neutral-900">{title}</h2>
            <p id="partner-account-action-description" className="mt-1 text-xs leading-5 text-neutral-500">
              安全挑战、操作授权和换绑票据仅保存在当前弹窗内存中，关闭后会尽力撤销。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭账号安全操作"
            disabled={flow.state.busy}
            onClick={() => void flow.close()}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
          >
            关闭
          </button>
        </div>

        {flow.state.errorCode && (
          <p role="alert" className="mt-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg">
            {errorMessages[flow.state.errorCode] ?? '操作未完成，请检查信息后重试。'}
          </p>
        )}
        {flow.statusMessage && (
          <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700">
            {flow.statusMessage}
          </p>
        )}

        <div className="mt-5">
          <ActionCredentialSteps flow={flow} />
          <PhoneRebindSteps flow={flow} />

          {flow.state.step === 'result_uncertain' && (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-neutral-700">
                最终请求的结果暂时无法确认，系统没有自动重试。机构详情已刷新，请以当前账号列表为准。
              </p>
              <div className="flex justify-end">
                <button type="button" data-autofocus className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white" onClick={() => void flow.close()}>我已核对</button>
              </div>
            </div>
          )}

          {flow.state.step === 'success' && (
            <div className="space-y-3">
              <p className="text-sm text-success-fg">{deleting ? '账号已安全删除，机构详情已刷新。' : '手机号已换绑并验证，机构详情已刷新。'}</p>
              <div className="flex justify-end">
                <button type="button" data-autofocus className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white" onClick={() => void flow.close()}>完成</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(flow.state.step === 'delete_ready' || flow.state.step === 'delete_committing') && (
        <PartnerAccountDeleteConfirmationDialog
          account={flow.account}
          organizationName={flow.organizationName}
          busy={flow.state.busy}
          ticketSeconds={ticketSeconds}
          onCancel={() => void flow.close()}
          onConfirm={() => void flow.commitDelete()}
        />
      )}
    </div>
  )
}
