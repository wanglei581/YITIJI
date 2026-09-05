import { useState, type FormEvent } from 'react'
import { Card, Button, EmptyState } from '@ai-job-print/ui'
import { LockKeyholeIcon, UserCogIcon } from 'lucide-react'
import { Page } from '../Page'
import { changePassword, logout } from '../../services/auth'

const inputCls =
  'w-full rounded-lg border border-neutral-200 bg-surface px-3 py-2.5 text-sm text-neutral-900 ' +
  'transition-colors placeholder:text-neutral-400 ' +
  'focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20'

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

export default function AccountPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || successVisible) return
    setPwError(null)

    if (unicodeCharacterLength(newPassword) < 12) { setPwError('新密码至少 12 位'); return }
    if (utf8ByteLength(newPassword) > 72)          { setPwError('新密码按 UTF-8 计算不能超过 72 字节'); return }
    if (passwordCategoryCount(newPassword) < 3)    { setPwError('新密码至少包含大写字母、小写字母、数字、特殊字符中的 3 类'); return }
    if (newPassword !== confirmPassword)            { setPwError('两次输入的新密码不一致'); return }
    if (newPassword === currentPassword)            { setPwError('新密码不能与当前密码相同'); return }

    setSubmitting(true)
    try {
      const r = await changePassword(currentPassword, newPassword)
      if (!r.ok) { setPwError(r.message || '修改失败，请重试'); return }
      setSuccessVisible(true)
      window.setTimeout(() => logout(), 1200)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page title="账号" subtitle="修改登录密码；机构子账号与操作权限由平台侧管理">
      <div className="max-w-xl space-y-5">
        <Card className="p-5">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-primary-50 text-primary-600">
              <LockKeyholeIcon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-neutral-900">修改密码</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                修改成功后所有设备的登录状态将失效，需重新登录。
              </p>
            </div>
          </div>

          {successVisible ? (
            <p className="rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success-fg">
              密码已更新，即将返回登录页。
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-neutral-700" htmlFor="partner-current-password">当前密码</label>
                <input
                  id="partner-current-password" type="password"
                  autoComplete="current-password" maxLength={72}
                  className={inputCls} value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)} required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-neutral-700" htmlFor="partner-new-password">新密码</label>
                <input
                  id="partner-new-password" type="password"
                  autoComplete="new-password" minLength={12} maxLength={72}
                  placeholder="12 位以上，至少包含 3 类字符"
                  className={inputCls} value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} required
                />
                <p className="mt-1.5 text-[11.5px] text-neutral-400">
                  大写 + 小写 + 数字 + 特殊字符，至少 3 类；UTF-8 最多 72 字节。
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-neutral-700" htmlFor="partner-confirm-password">确认新密码</label>
                <input
                  id="partner-confirm-password" type="password"
                  autoComplete="new-password" minLength={12} maxLength={72}
                  className={inputCls} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} required
                />
              </div>
              {pwError && <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{pwError}</p>}
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? '提交中…' : '保存新密码'}
              </Button>
            </form>
          )}
        </Card>

        <EmptyState
          icon={UserCogIcon}
          title="账号与角色由平台侧统一管理"
          description="机构子账号与细粒度权限本阶段不开放自助配置。需要增删机构账号请联系平台运营，本页不做半套 RBAC。"
        />
      </div>
    </Page>
  )
}
