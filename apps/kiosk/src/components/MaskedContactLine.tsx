import { useState } from 'react'
import { maskEmail, maskPhone } from '../utils/maskPii'

export function MaskedContactLine({
  phone,
  email,
  extra = [],
  className = '',
}: {
  phone?: string | null
  email?: string | null
  extra?: string[]
  className?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const hasContact = Boolean(phone?.trim() || email?.trim())
  const parts = [
    ...extra.filter(Boolean),
    phone?.trim() ? `电话:${revealed ? phone.trim() : maskPhone(phone)}` : '',
    email?.trim() ? `邮箱:${revealed ? email.trim() : maskEmail(email)}` : '',
  ].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className={className}>
      <p>{parts.join(' · ')}</p>
      {hasContact && (
        <button
          type="button"
          className="mt-2 min-h-12 min-w-[48px] rounded-md px-3 text-sm font-medium text-primary-700 underline-offset-4 hover:underline"
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? '隐藏完整联系方式' : '显示完整联系方式'}
        </button>
      )}
    </div>
  )
}
