import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type LoginResult,
  MemberApiError,
  memberLogin,
  sendSmsCode,
} from '../../../services/auth/memberAuthApi'
import { getMemberAuthDeviceId } from '../../../services/auth/memberAuthDevice'

export type { LoginResult } from '../../../services/auth/memberAuthApi'

export const MEMBER_PHONE_LENGTH = 11
export const MEMBER_CODE_LENGTH = 6

export type MemberPhoneLoginActiveInput = 'phone' | 'code'

export interface UseMemberPhoneLoginOptions {
  agreed: boolean
  onAgreementRequired: () => void
  onAuthenticated: (result: LoginResult) => void | Promise<void>
}

export interface MemberPhoneLoginPaneProps {
  phone: string
  code: string
  agreed: boolean
  loading: boolean
  countdown: number
  countdownTotal: number
  activeInput: MemberPhoneLoginActiveInput
  onActiveInputChange: (input: MemberPhoneLoginActiveInput) => void
  onDigit: (digit: string) => void
  onDelete: () => void
  onClear: () => void
  onSendCode: () => void
  onLogin: () => void
  notice: string | null
  error: string | null
}

export interface MemberPhoneLoginController extends MemberPhoneLoginPaneProps {
  sendingCode: boolean
  submitting: boolean
  shaking: boolean
  paneProps: MemberPhoneLoginPaneProps
  cancelPending: () => void
  clearFeedback: () => void
  requireAgreement: () => void
}

export function formatMemberPhone(raw: string): string {
  if (raw.length <= 3) return raw
  if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`
  return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0)
  const [total, setTotal] = useState(60)

  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])

  const start = useCallback((value: number) => {
    setTotal(value > 0 ? value : 60)
    setSeconds(value)
  }, [])

  return useMemo(() => ({ seconds, total, start }), [seconds, start, total])
}

export function useMemberPhoneLogin(
  options: UseMemberPhoneLoginOptions,
): MemberPhoneLoginController {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [activeInput, setActiveInput] = useState<MemberPhoneLoginActiveInput>('phone')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)
  const countdown = useCountdown()
  const previousPhoneLengthRef = useRef(0)
  const requestGenerationRef = useRef(0)
  const shakeTimerRef = useRef<number | null>(null)
  const onAgreementRequired = options.onAgreementRequired

  const isCurrentRequest = (generation: number) => generation === requestGenerationRef.current

  const raiseError = useCallback((message: string) => {
    setNotice(null)
    setError(message)
    setShaking(true)
    if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current)
    shakeTimerRef.current = window.setTimeout(() => {
      setShaking(false)
      shakeTimerRef.current = null
    }, 400)
  }, [])

  const clearFeedback = useCallback(() => {
    setNotice(null)
    setError(null)
  }, [])

  const requireAgreement = useCallback(() => {
    raiseError('请先阅读并同意用户服务协议和隐私政策')
    onAgreementRequired()
  }, [onAgreementRequired, raiseError])

  useEffect(() => {
    if (
      previousPhoneLengthRef.current < MEMBER_PHONE_LENGTH &&
      phone.length === MEMBER_PHONE_LENGTH
    ) {
      setActiveInput('code')
    }
    previousPhoneLengthRef.current = phone.length
  }, [phone])

  useEffect(
    () => () => {
      requestGenerationRef.current += 1
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current)
    },
    [],
  )

  const handleDigit = useCallback(
    (digit: string) => {
      if (activeInput === 'code') {
        setCode((previous) => (
          previous.length < MEMBER_CODE_LENGTH ? previous + digit : previous
        ))
        return
      }
      setPhone((previous) => (previous + digit).slice(0, MEMBER_PHONE_LENGTH))
    },
    [activeInput],
  )

  const handleDelete = useCallback(() => {
    if (activeInput === 'code') {
      if (code.length === 0) setActiveInput('phone')
      else setCode((previous) => previous.slice(0, -1))
      return
    }
    setPhone((previous) => previous.slice(0, -1))
  }, [activeInput, code.length])

  const handleClear = useCallback(() => {
    if (activeInput === 'code') setCode('')
    else setPhone('')
  }, [activeInput])

  const cancelPending = useCallback(() => {
    ++requestGenerationRef.current
    setLoading(false)
    setSendingCode(false)
    setSubmitting(false)
    setNotice(null)
    setError(null)
    setShaking(false)
    if (shakeTimerRef.current !== null) {
      window.clearTimeout(shakeTimerRef.current)
      shakeTimerRef.current = null
    }
  }, [])

  const handleSendCode = async () => {
    if (
      phone.length !== MEMBER_PHONE_LENGTH ||
      loading ||
      countdown.seconds > 0
    ) return
    if (!options.agreed) {
      requireAgreement()
      return
    }

    const requestGeneration = ++requestGenerationRef.current
    setLoading(true)
    setSendingCode(true)
    setError(null)
    setNotice(null)
    try {
      const deviceId = getMemberAuthDeviceId()
      const result = await sendSmsCode(phone, deviceId)
      if (!isCurrentRequest(requestGeneration)) return
      countdown.start(result.cooldownSeconds > 0 ? result.cooldownSeconds : 60)
      setNotice(`验证码已发送至 ${formatMemberPhone(phone)}`)
      setActiveInput('code')
    } catch (cause) {
      if (!isCurrentRequest(requestGeneration)) return
      raiseError(cause instanceof MemberApiError ? cause.message : '发送失败，请重试')
    } finally {
      if (isCurrentRequest(requestGeneration)) {
        setLoading(false)
        setSendingCode(false)
      }
    }
  }

  const handleLogin = async () => {
    if (
      phone.length !== MEMBER_PHONE_LENGTH ||
      code.length !== MEMBER_CODE_LENGTH ||
      loading
    ) return
    if (!options.agreed) {
      requireAgreement()
      return
    }

    const requestGeneration = ++requestGenerationRef.current
    setLoading(true)
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const deviceId = getMemberAuthDeviceId()
      const result = await memberLogin(phone, code, deviceId)
      if (!isCurrentRequest(requestGeneration)) return
      await options.onAuthenticated(result)
    } catch (cause) {
      if (!isCurrentRequest(requestGeneration)) return
      raiseError(cause instanceof MemberApiError ? cause.message : '验证失败，请重试')
      setCode('')
    } finally {
      if (isCurrentRequest(requestGeneration)) {
        setLoading(false)
        setSubmitting(false)
      }
    }
  }

  const paneProps: MemberPhoneLoginPaneProps = {
    phone,
    code,
    agreed: options.agreed,
    loading,
    countdown: countdown.seconds,
    countdownTotal: countdown.total,
    activeInput,
    onActiveInputChange: setActiveInput,
    onDigit: handleDigit,
    onDelete: handleDelete,
    onClear: handleClear,
    onSendCode: handleSendCode,
    onLogin: handleLogin,
    notice,
    error,
  }

  return {
    ...paneProps,
    sendingCode,
    submitting,
    shaking,
    paneProps,
    cancelPending,
    clearFeedback,
    requireAgreement,
  }
}
