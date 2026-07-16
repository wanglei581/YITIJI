import { useEffect, useRef, useState } from 'react'
import { KeyRoundIcon, SmartphoneIcon, Trash2Icon, UserPlusIcon } from 'lucide-react'
import { ApiHttpError } from '../../services/api/client'
import {
  orgsAdminService,
  type AdminOrgAccount,
} from '../../services/api/orgsAdmin'
import { PartnerAccountDeletionDialog } from './PartnerAccountDeletionDialog'

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function AccountField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

function TwoStepButton({
  account,
  busy,
  onConfirm,
}: {
  account: AdminOrgAccount
  busy: boolean
  onConfirm: () => void
}) {
  const [arming, setArming] = useState(false)

  useEffect(() => {
    if (!arming) return
    const timeout = window.setTimeout(() => setArming(false), 5_000)
    return () => window.clearTimeout(timeout)
  }, [arming])

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (arming) {
          setArming(false)
          onConfirm()
          return
        }
        setArming(true)
      }}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        arming
          ? account.enabled ? 'bg-warning text-white' : 'bg-success text-white'
          : account.enabled ? 'text-warning-fg hover:bg-warning-bg' : 'text-success-fg hover:bg-success-bg'
      }`}
    >
      {arming ? account.enabled ? '确认停用?' : '确认启用?' : account.enabled ? '停用' : '启用'}
    </button>
  )
}

function messageForDeleteError(error: unknown): string {
  if (error instanceof ApiHttpError && error.code === 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED') {
    return '该操作会使机构没有有效登录账号。请先新增并启用接替账号后再移除。'
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return '移除账号失败，请重试。'
}

export function PartnerAccountManager({
  orgId,
  accounts,
  onReload,
  onChanged,
}: {
  orgId: string
  accounts: AdminOrgAccount[]
  onReload: () => Promise<void>
  onChanged: () => void
}) {
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ username: '', password: '', name: '', phone: '' })
  const [resetTarget, setResetTarget] = useState<AdminOrgAccount | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AdminOrgAccount | null>(null)
  const [accountBusy, setAccountBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const deleteButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const sectionRef = useRef<HTMLDivElement>(null)

  const reloadAccounts = async () => {
    await onReload()
    onChanged()
  }

  const addAccount = async () => {
    setAccountBusy('create')
    setError(null)
    try {
      await orgsAdminService.createAccount(orgId, {
        username: newAccount.username.trim(),
        password: newAccount.password,
        name: newAccount.name.trim(),
        phone: newAccount.phone,
      })
      setShowNewAccount(false)
      setNewAccount({ username: '', password: '', name: '', phone: '' })
      await reloadAccounts()
    } catch (caught) {
      setError(messageForDeleteError(caught))
    } finally {
      setAccountBusy(null)
    }
  }

  const toggleAccount = async (account: AdminOrgAccount) => {
    setAccountBusy(account.id)
    setError(null)
    try {
      await orgsAdminService.setAccountStatus(orgId, account.id, account.enabled ? 'disable' : 'enable')
      await reloadAccounts()
    } catch (caught) {
      setError(messageForDeleteError(caught))
    } finally {
      setAccountBusy(null)
    }
  }

  const resetAccountPassword = async () => {
    if (!resetTarget) return
    setAccountBusy(resetTarget.id)
    setError(null)
    try {
      await orgsAdminService.resetAccountPassword(orgId, resetTarget.id, resetPassword)
      setResetTarget(null)
      setResetPassword('')
    } catch (caught) {
      setError(messageForDeleteError(caught))
    } finally {
      setAccountBusy(null)
    }
  }

  const closeDeleteDialog = () => {
    const targetId = deleteTarget?.id
    setDeleteTarget(null)
    if (targetId) requestAnimationFrame(() => deleteButtonRefs.current[targetId]?.focus())
  }

  const deleteAccount = async () => {
    if (!deleteTarget || accountBusy !== null) return
    setAccountBusy(deleteTarget.id)
    setError(null)
    try {
      await orgsAdminService.deleteAccount(orgId, deleteTarget.id)
      await onReload()
      onChanged()
      setDeleteTarget(null)
      requestAnimationFrame(() => sectionRef.current?.focus())
    } catch (caught) {
      setError(messageForDeleteError(caught))
    } finally {
      setAccountBusy(null)
    }
  }

  const canCreate =
    newAccount.username.trim().length >= 3
    && newAccount.password.length >= 8
    && Boolean(newAccount.name.trim())
    && /^1[3-9]\d{9}$/.test(newAccount.phone)

  return (
    <div ref={sectionRef} tabIndex={-1} className="space-y-3 border-t border-neutral-100 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-800">机构后台账号</p>
        <button
          type="button"
          onClick={() => setShowNewAccount((value) => !value)}
          disabled={accountBusy !== null}
          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UserPlusIcon className="h-3.5 w-3.5" />
          新增账号
        </button>
      </div>

      {error && <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{error}</p>}

      {showNewAccount && (
        <div className="space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <AccountField label="登录用户名" required>
              <input className={inputCls} value={newAccount.username} onChange={(event) => setNewAccount((value) => ({ ...value, username: event.target.value }))} />
            </AccountField>
            <AccountField label="账号姓名" required>
              <input className={inputCls} value={newAccount.name} onChange={(event) => setNewAccount((value) => ({ ...value, name: event.target.value }))} />
            </AccountField>
          </div>
          <AccountField label="登录手机号" required>
            <input
              className={inputCls}
              inputMode="numeric"
              value={newAccount.phone}
              onChange={(event) => setNewAccount((value) => ({ ...value, phone: event.target.value.replace(/\D/g, '').slice(0, 11) }))}
            />
          </AccountField>
          <AccountField label="初始密码（至少 8 位）" required>
            <input type="password" autoComplete="new-password" className={inputCls} value={newAccount.password} onChange={(event) => setNewAccount((value) => ({ ...value, password: event.target.value }))} />
          </AccountField>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void addAccount()}
              disabled={accountBusy !== null || !canCreate}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {accountBusy === 'create' ? '创建中…' : '创建账号'}
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <p className="rounded-lg bg-neutral-50 py-6 text-center text-xs text-neutral-400">该机构暂无后台账号</p>
      ) : (
        <div className="divide-y divide-neutral-900/[0.06] rounded-lg border border-neutral-100">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-800">{account.name}</p>
                <p className="font-mono text-xs text-neutral-400">{account.username}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                  <SmartphoneIcon className="h-3.5 w-3.5" />
                  {account.phoneMasked ?? '未绑定手机号'}
                </p>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${account.enabled ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-600'}`}>
                {account.enabled ? '启用' : '已停用'}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${account.phoneVerifiedAt ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg'}`}>
                {account.phoneVerifiedAt ? '手机号已验证' : '待验证'}
              </span>
              <button
                type="button"
                onClick={() => { setResetTarget(account); setResetPassword('') }}
                disabled={accountBusy !== null}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <KeyRoundIcon className="h-3.5 w-3.5" />
                重置密码
              </button>
              <TwoStepButton account={account} busy={accountBusy !== null} onConfirm={() => void toggleAccount(account)} />
              <button
                ref={(element) => { deleteButtonRefs.current[account.id] = element }}
                type="button"
                onClick={() => setDeleteTarget(account)}
                disabled={accountBusy !== null}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2Icon className="h-3.5 w-3.5" />
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      {resetTarget && (
        <div className="space-y-3 rounded-lg border border-warning/20 bg-warning-bg p-3">
          <p className="text-xs font-medium text-warning-fg">重置「{resetTarget.name}（{resetTarget.username}）」的登录密码</p>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            placeholder="新密码（至少 8 位）"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setResetTarget(null)} disabled={accountBusy !== null} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-surface disabled:opacity-50">取消</button>
            <button
              type="button"
              onClick={() => void resetAccountPassword()}
              disabled={accountBusy !== null || resetPassword.length < 8}
              className="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-white hover:bg-warning/90 disabled:opacity-50"
            >
              {accountBusy === resetTarget.id ? '重置中…' : '确认重置'}
            </button>
          </div>
        </div>
      )}

      <PartnerAccountDeletionDialog
        account={deleteTarget}
        busy={accountBusy !== null}
        onCancel={closeDeleteDialog}
        onConfirm={() => void deleteAccount()}
      />
    </div>
  )
}
