// Admin 账号设置页
//
// 范围（P0）：当前账号信息只读展示（姓名/角色/手机号绑定与验证状态）+ 修改密码。
// 修改密码走登录态自助改密 POST /auth/password/change（须校验当前密码），
// 成功后后端旧 token 立即失效，前端主动 logout() 并跳登录页重新登录。
// 手机号换绑、账号注销等仍不在本页范围内。

import { useState, type FormEvent } from 'react'
import { Card, Button } from '@ai-job-print/ui'
import { CircleAlertIcon, CircleCheckIcon, LockKeyholeIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { Page } from '../Page'
import { changePassword, getUser, logout, type AuthedUser } from '../../services/auth'
import { AdminInitialPhoneBindingCard } from './AdminInitialPhoneBindingCard'
import { AdminPhoneTransferCard } from './AdminPhoneTransferCard'

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin: '超级管理员',
  partner: '合作机构',
  kiosk: '终端用户',
}

const labelCls = 'block text-sm font-medium text-neutral-700 mb-1.5'
const inputCls = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20'

function passwordCategoryCount(value: string): number {
  return [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/u.test(value),
  ].filter(Boolean).length
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function unicodeCharacterLength(value: string): number {
  return Array.from(value).length
}

export default function AccountSettingsPage() {
  const [user, setUser] = useState<AuthedUser | null>(() => getUser())
  const [phoneBindingSuccess, setPhoneBindingSuccess] = useState<Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'> | null>(null)
  const [phoneBindingMode, setPhoneBindingMode] = useState<'initial' | 'transfer'>('initial')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)

  function handlePhoneBound(phone: Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>): void {
    setUser((current) => current ? { ...current, ...phone } : current)
    setPhoneBindingSuccess(phone)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || successVisible) return
    setError(null)

    if (unicodeCharacterLength(newPassword) < 12) {
      setError('新密码至少 12 位')
      return
    }
    if (utf8ByteLength(newPassword) > 72) {
      setError('新密码按 UTF-8 计算不能超过 72 字节')
      return
    }
    if (passwordCategoryCount(newPassword) < 3) {
      setError('新密码至少包含大写字母、小写字母、数字、特殊字符中的 3 类')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与当前密码相同')
      return
    }

    setSubmitting(true)
    try {
      const r = await changePassword(currentPassword, newPassword)
      if (!r.ok) {
        setError(r.message || '修改失败，请重试')
        return
      }
      setSuccessVisible(true)
      window.setTimeout(() => logout(), 1200)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page title="账号设置" subtitle="查看当前账号信息，修改登录密码">
      <div className="max-w-xl space-y-5">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <UserRoundIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900">{user?.name ?? '当前用户'}</p>
              <p className="mt-0.5 text-xs text-neutral-500">{user ? ROLE_LABEL[user.role] : ''}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4 text-sm">
            <div>
              <p className="text-xs text-neutral-400">绑定手机号</p>
              <p className="mt-1 text-neutral-900">{user?.phoneMasked ?? '未绑定'}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">本人验证状态</p>
              <p className={`mt-1 flex items-center gap-1 ${user?.phoneVerifiedAt ? 'text-success-fg' : 'text-neutral-400'}`}>
                {user?.phoneVerifiedAt && <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                {user?.phoneVerifiedAt ? '已验证' : '未验证'}
              </p>
            </div>
          </div>
        </Card>

        {phoneBindingSuccess && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success-fg">
            <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>手机号 {phoneBindingSuccess.phoneMasked} 已绑定并完成验证。</span>
          </div>
        )}

        {user?.role === 'admin' && !user.phoneMasked && (
          <div className="space-y-3">
            {phoneBindingMode === 'initial' ? (
              <>
                <AdminInitialPhoneBindingCard onBound={handlePhoneBound} />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setPhoneBindingMode('transfer')}
                >
                  该号码已用于机构账号？安全转移
                </Button>
              </>
            ) : (
              <AdminPhoneTransferCard
                onBound={handlePhoneBound}
                onBack={() => setPhoneBindingMode('initial')}
              />
            )}
          </div>
        )}

        <Card className="p-5">
          <div className="mb-4">
            <p className="text-sm font-medium text-neutral-900">修改密码</p>
            <p className="mt-1 text-xs text-neutral-500">
              需先验证当前密码；修改成功后本设备及其他已登录设备的登录状态都会失效，需重新登录。
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className={labelCls} htmlFor="account-current-password">当前密码</label>
              <input
                id="account-current-password"
                type="password"
                autoComplete="current-password"
                maxLength={72}
                className={inputCls}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="account-new-password">新密码</label>
              <input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                aria-describedby="account-new-password-hint"
                placeholder="12 位以上，至少包含 3 类字符"
                className={inputCls}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p id="account-new-password-hint" className="mt-1.5 text-xs text-neutral-500">
                至少包含大写字母、小写字母、数字、特殊字符中的 3 类；按 UTF-8 计算最多 72 字节。
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="account-confirm-password">确认新密码</label>
              <input
                id="account-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                className={inputCls}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
                <CircleAlertIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {successVisible && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success-fg">
                <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>密码已修改，正在退出登录…</span>
              </div>
            )}

            <Button type="submit" disabled={submitting || successVisible} className="w-full">
              <LockKeyholeIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {submitting ? '提交中…' : '确认修改'}
            </Button>
          </form>
        </Card>
      </div>
    </Page>
  )
}
