// Admin 账号设置页 — 双栏布局
//
// 范围（P0）：当前账号信息只读展示（姓名/角色/手机号绑定与验证状态）+ 修改密码。
// 修改密码走登录态自助改密 POST /auth/password/change（须校验当前密码），
// 成功后后端旧 token 立即失效，前端主动 logout() 并跳登录页重新登录。

import { useEffect, useState, type FormEvent } from 'react'
import { Card, Button } from '@ai-job-print/ui'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LockKeyholeIcon,
  MonitorIcon,
  PhoneIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from 'lucide-react'
import { Page } from '../Page'
import { changePassword, getUser, logout, type AuthedUser } from '../../services/auth'
import { getAuditLogs, type AuditLogRecord } from '../../services/api/audit'
import { AdminInitialPhoneBindingCard } from './AdminInitialPhoneBindingCard'
import { AdminPhoneTransferCard } from './AdminPhoneTransferCard'

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin:   '超级管理员',
  partner: '合作机构',
  kiosk:   '终端用户',
}

function parseDevice(ua: string | null): string {
  if (!ua) return '未知设备'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS 设备'
  if (/Android/i.test(ua)) return 'Android 设备'
  if (/Macintosh/i.test(ua)) return 'macOS'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Linux/i.test(ua)) return 'Linux'
  return '浏览器'
}

function formatLoginTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const labelCls = 'block text-sm font-medium text-neutral-700 mb-1.5'
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

// ─── 已绑定手机状态卡（左栏 phone 已完成时占位）────────────────────────────────

function PhoneBoundCard({ phoneMasked, verifiedAt }: { phoneMasked: string; verifiedAt?: string | null }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-success-bg text-success-fg">
          <PhoneIcon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[14px] font-bold text-neutral-900">绑定手机号</p>
          <p className="mt-0.5 text-xs text-neutral-500">用于短信登录和找回密码。</p>
        </div>
      </div>
      <div className="rounded-lg border border-neutral-900/[0.06] bg-neutral-50/60 px-4 py-3">
        <p className="text-xs text-neutral-400">当前绑定</p>
        <p className="mt-1 text-sm font-semibold text-neutral-900">{phoneMasked}</p>
      </div>
      <div className={`mt-3 flex items-center gap-2 text-sm ${verifiedAt ? 'text-success-fg' : 'text-neutral-400'}`}>
        {verifiedAt
          ? <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
          : <ShieldOffIcon className="h-4 w-4" aria-hidden="true" />}
        <span>{verifiedAt ? '本人身份已验证' : '本人身份未验证'}</span>
      </div>
    </Card>
  )
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────

export default function AccountSettingsPage() {
  const [user, setUser] = useState<AuthedUser | null>(() => getUser())
  const [phoneBindingSuccess, setPhoneBindingSuccess] = useState<Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'> | null>(null)
  const [phoneBindingMode, setPhoneBindingMode] = useState<'initial' | 'transfer'>('initial')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)
  const [loginLogs, setLoginLogs] = useState<AuditLogRecord[]>([])

  useEffect(() => {
    getAuditLogs({ limit: 5, action: 'system.login' })
      .then((res) => setLoginLogs(res.items))
      .catch(() => undefined) // 非关键功能，失败不打断页面
  }, [])

  function handlePhoneBound(phone: Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>): void {
    setUser((current) => current ? { ...current, ...phone } : current)
    setPhoneBindingSuccess(phone)
  }

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

  const phoneBound = !!(user?.phoneMasked)

  return (
    <Page title="账号设置" subtitle="管理账号信息、手机绑定与登录密码">
      <div className="max-w-[940px] space-y-5">

        {/* ── 用户信息卡（顶部全宽）──────────────────────────── */}
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-5 bg-gradient-to-r from-primary-600/[0.08] via-primary-600/[0.03] to-transparent px-6 py-5">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[1.4rem] font-extrabold text-primary-700 ring-4 ring-primary-50">
              {(user?.name ?? '管')[0]}
              {phoneBound && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-success border-2 border-surface">
                  <ShieldCheckIcon className="h-2.5 w-2.5 text-white" aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-bold text-neutral-900 leading-tight">{user?.name ?? '当前用户'}</p>
              <p className="mt-0.5 text-xs text-neutral-500">{user ? ROLE_LABEL[user.role] : ''}</p>
            </div>
            <div className="hidden sm:flex items-center gap-6 pr-2">
              <div className="text-right">
                <p className="text-[10.5px] text-neutral-400 uppercase tracking-wide">手机绑定</p>
                <p className={`mt-0.5 text-sm font-semibold ${phoneBound ? 'text-neutral-800' : 'text-neutral-400'}`}>
                  {user?.phoneMasked ?? '未绑定'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10.5px] text-neutral-400 uppercase tracking-wide">身份验证</p>
                <p className={`mt-0.5 text-sm font-semibold ${user?.phoneVerifiedAt ? 'text-success-fg' : 'text-neutral-400'}`}>
                  {user?.phoneVerifiedAt ? '已验证' : '未验证'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* ── 绑定成功提示 ────────────────────────────────────── */}
        {phoneBindingSuccess && (
          <div role="status" aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-4 py-2.5 text-sm text-success-fg">
            <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>手机号 {phoneBindingSuccess.phoneMasked} 已绑定并完成验证。</span>
          </div>
        )}

        {/* ── 双栏：左=手机绑定  右=修改密码 ─────────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* 左栏：手机绑定 */}
          <div className="space-y-3">
            {phoneBound ? (
              <PhoneBoundCard phoneMasked={user!.phoneMasked!} verifiedAt={user?.phoneVerifiedAt} />
            ) : user?.role === 'admin' ? (
              <>
                {phoneBindingMode === 'initial' ? (
                  <>
                    <AdminInitialPhoneBindingCard onBound={handlePhoneBound} />
                    <button
                      type="button"
                      onClick={() => setPhoneBindingMode('transfer')}
                      className="w-full rounded-lg border border-neutral-200 bg-surface px-4 py-2.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
                    >
                      该号码已用于机构账号？安全转移
                    </button>
                  </>
                ) : (
                  <AdminPhoneTransferCard
                    onBound={handlePhoneBound}
                    onBack={() => setPhoneBindingMode('initial')}
                  />
                )}
              </>
            ) : (
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-neutral-100 text-neutral-500">
                    <PhoneIcon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-neutral-900">绑定手机号</p>
                    <p className="mt-0.5 text-xs text-neutral-500">暂未绑定，请联系管理员配置。</p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* 右栏：修改密码 */}
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

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="account-current-password">当前密码</label>
                <input
                  id="account-current-password" type="password"
                  autoComplete="current-password" maxLength={72}
                  className={inputCls} value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)} required
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="account-new-password">新密码</label>
                <input
                  id="account-new-password" type="password"
                  autoComplete="new-password" minLength={12} maxLength={72}
                  aria-describedby="account-new-password-hint"
                  placeholder="12 位以上，至少包含 3 类字符"
                  className={inputCls} value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} required
                />
                <p id="account-new-password-hint" className="mt-1.5 text-[11.5px] text-neutral-400">
                  大写 + 小写 + 数字 + 特殊字符，至少 3 类；UTF-8 最多 72 字节。
                </p>
              </div>
              <div>
                <label className={labelCls} htmlFor="account-confirm-password">确认新密码</label>
                <input
                  id="account-confirm-password" type="password"
                  autoComplete="new-password" minLength={12} maxLength={72}
                  className={inputCls} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} required
                />
              </div>

              {pwError && (
                <div role="alert"
                  className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
                  <CircleAlertIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{pwError}</span>
                </div>
              )}
              {successVisible && (
                <div role="status" aria-live="polite"
                  className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success-fg">
                  <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>密码已修改，正在退出登录…</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-neutral-400">修改后需重新登录</p>
                <Button type="submit" disabled={submitting || successVisible} className="min-w-[100px]">
                  <LockKeyholeIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {submitting ? '提交中…' : '确认修改'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* ── 最近登录记录 ─────────────────────────────────── */}
        {loginLogs.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-neutral-700">最近登录记录</h2>
            </div>
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-neutral-900/[0.06]">
                {loginLogs.map((log, i) => (
                  <div key={log.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-primary-50 text-primary-600">
                      <MonitorIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900">
                        {formatLoginTime(log.createdAt)}
                        {i === 0 && (
                          <span className="rounded-full bg-success-bg px-2 py-0.5 text-[10.5px] font-bold text-success-fg">
                            当前会话
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {log.ipAddress ?? '未记录 IP'} · {parseDevice(log.userAgent)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                      {new Date(log.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </Page>
  )
}
