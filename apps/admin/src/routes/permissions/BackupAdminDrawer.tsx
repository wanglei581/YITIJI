// 新建备用管理员：两步抽屉。
//   ① 备用手机号 + 管理员本人当前密码 → 发送验证码（start）；
//   ② 6 位验证码，显示脱敏号码、60 秒重发倒计时、5 分钟有效期倒计时；
//      到期（SMS_CODE_EXPIRED / BACKUP_ADMIN_CHALLENGE_UNAVAILABLE）回第一步。
// 成功后展示结果：账号名、状态「停用」、下一步说明。
//
// 密码 / 验证码 / ticket 只保存在当前抽屉内存中，不写任何浏览器存储、不进 URL。

import { KeyRoundIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Field } from '../../components/form'
import { ApiHttpError } from '../../services/api/client'
import type { InternalAccountItem } from '../../services/api/internalAccounts'
import { startBackupAdmin, verifyBackupAdmin } from '../../services/api/internalAccounts'
import { userMessageOf } from '../../services/api/userErrorMessage'

type Step = 'phone' | 'code' | 'result'

export interface BackupAdminDrawerProps {
  open: boolean
  onClose: () => void
  onCreated: (account: InternalAccountItem) => void
}

const inputCls =
  'min-h-12 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const RESTART_STEP_CODES = new Set([
  'SMS_CODE_EXPIRED',
  'BACKUP_ADMIN_CHALLENGE_UNAVAILABLE',
])

export function BackupAdminDrawer({ open, onClose, onCreated }: BackupAdminDrawerProps) {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [phoneMasked, setPhoneMasked] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [nowMs, setNowMs] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<InternalAccountItem | null>(null)
  const phoneRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => phoneRef.current?.focus(), 50)
      return () => window.clearTimeout(timer)
    }
    setStep('phone')
    setPhone('')
    setPassword('')
    setCode('')
    setTicket('')
    setPhoneMasked('')
    setExpiresAt(0)
    setResendAvailableAt(0)
    setError(null)
    setCreated(null)
  }, [open])

  // 每秒刷新倒计时；验证码 5 分钟有效期一到回到第一步。
  useEffect(() => {
    if (!open || step !== 'code') return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [open, step])

  useEffect(() => {
    if (step !== 'code' || !expiresAt) return
    if (Date.now() >= expiresAt) {
      setStep('phone')
      setTicket('')
      setExpiresAt(0)
      setError('验证码已过期，请重新开始')
    }
  }, [step, expiresAt, nowMs])

  if (!open) return null

  const trimmedPhone = phone.trim()
  const secondsLeft = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000))
  const resendSecondsLeft = Math.max(0, Math.ceil((resendAvailableAt - nowMs) / 1_000))
  const phoneValid = /^1[3-9]\d{9}$/.test(trimmedPhone)

  const handleStart = async () => {
    if (!phoneValid || password.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await startBackupAdmin({ phone: trimmedPhone, adminCurrentPassword: password })
      setTicket(result.ticket)
      setPhoneMasked(result.phoneMasked)
      setExpiresAt(Date.now() + result.expiresInSeconds * 1_000)
      setResendAvailableAt(Date.now() + result.cooldownSeconds * 1_000)
      setCode('')
      setStep('code')
    } catch (caught) {
      setError(userMessageOf(caught, '验证码发送失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  // 重发 = 重新调 start（服务端会作废上一张 ticket 再写新的）。
  const handleResend = async () => {
    if (resendSecondsLeft > 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await startBackupAdmin({ phone: trimmedPhone, adminCurrentPassword: password })
      setTicket(result.ticket)
      setPhoneMasked(result.phoneMasked)
      setExpiresAt(Date.now() + result.expiresInSeconds * 1_000)
      setResendAvailableAt(Date.now() + result.cooldownSeconds * 1_000)
      setCode('')
    } catch (caught) {
      setError(userMessageOf(caught, '验证码重新发送失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code) || busy) return
    setBusy(true)
    setError(null)
    try {
      const account = await verifyBackupAdmin({ ticket, code })
      setCreated(account)
      setStep('result')
      onCreated(account)
    } catch (caught) {
      const codeOfError = caught instanceof ApiHttpError ? caught.code : ''
      setError(userMessageOf(caught, '验证失败，请稍后重试'))
      // 只有过期 / 挑战失效回到第一步。验证码错、本人密码错、频控锁定都留在当前步重填。
      if (RESTART_STEP_CODES.has(codeOfError)) {
        setStep('phone')
        setTicket('')
        setExpiresAt(0)
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="新建备用管理员"
      >
        <div className="flex items-start justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-800">新建备用管理员</h2>
            <p className="mt-1 text-xs text-neutral-500">
              建出的账号默认停用、使用随机临时密码（没有人知道）；需要时由管理员在本页启用。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭新建备用管理员"
            disabled={busy}
            onClick={onClose}
            className="min-h-12 min-w-12 rounded px-3 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {step === 'phone' && (
            <div className="space-y-4">
              <Field label="备用管理员手机号" required hint="必须未被任何账号占用；建号后此手机号即验证通道">
                <input
                  ref={phoneRef}
                  className={inputCls}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="11 位手机号"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
                />
              </Field>
              <Field label="管理员本人当前密码" required hint="需要确认操作者身份；临时密码不能用于确认">
                <input
                  type="password"
                  autoComplete="current-password"
                  className={inputCls}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <button
                type="button"
                disabled={busy || !phoneValid || password.length === 0}
                onClick={() => void handleStart()}
                className="min-h-12 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '发送中…' : '发送验证码'}
              </button>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                验证码已发送至 <span className="font-mono font-medium">{phoneMasked}</span>
                （{secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)} 分 ${secondsLeft % 60} 秒内有效` : '即将过期'}）。
              </p>
              <Field label="短信验证码" required hint="6 位数字">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </Field>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy || !/^\d{6}$/.test(code)}
                  onClick={() => void handleVerify()}
                  className="min-h-12 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? '验证中…' : '验证并创建账号'}
                </button>
                <button
                  type="button"
                  disabled={busy || resendSecondsLeft > 0}
                  onClick={() => void handleResend()}
                  className="min-h-12 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resendSecondsLeft > 0 ? `${resendSecondsLeft} 秒后可重发` : '重新发送验证码'}
                </button>
              </div>
            </div>
          )}

          {step === 'result' && created && (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
                备用管理员已创建：<span className="font-mono font-medium">{created.username}</span>
                （状态：停用；密码状态：临时密码）。
              </div>
              <div className="space-y-2 text-sm leading-6 text-neutral-600">
                <p className="font-medium text-neutral-800">下一步说明：</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>需要时由管理员在本页「启用」该账号（同样需要填写事由并验证本人密码）。</li>
                  <li>主管理员无法登录时，按运维手册在服务器上应急启用（服务器端应急命令，不经过本页）。</li>
                  <li>启用后，本人用绑定的这个手机号（{phoneMasked}）在登录页「找回密码」设置新密码后才能登录。</li>
                </ul>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  data-autofocus
                  className="min-h-12 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                  onClick={onClose}
                >
                  完成
                </button>
              </div>
            </div>
          )}

          {step !== 'result' && (
            <p className="flex gap-2 rounded-lg bg-neutral-50 px-3 py-2.5 text-xs leading-5 text-neutral-500">
              <KeyRoundIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>手机号、密码与验证码只提交给服务端完成验证；本抽屉不保存、关闭后验证码票据随之作废。</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
