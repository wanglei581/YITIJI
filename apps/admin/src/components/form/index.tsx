import { useEffect, useState, type ReactNode } from 'react'
import { Trash2Icon } from 'lucide-react'

// Admin 表单共享 UI 原子。原先在 routes/fairs 与 routes/companies 各自重复定义,
// 此处收敛为单一来源;props 为两方并集(hint / confirmText 为可选),保持行为与视觉零变化。

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}

export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{message}</p>
}

export function InlineSuccess({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p>
}

/** 两步删除按钮:第一次点击进入确认态,5 秒内再点执行删除。 */
export function DangerDeleteButton({ onConfirm, busy, confirmText = '确认删除?' }: { onConfirm: () => void; busy?: boolean; confirmText?: string }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 5000)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      disabled={busy}
      onClick={() => {
        if (arming) {
          setArming(false)
          onConfirm()
        } else {
          setArming(true)
        }
      }}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        arming ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-500 hover:bg-red-50'
      }`}
    >
      {arming ? confirmText : <Trash2Icon className="h-3.5 w-3.5" />}
    </button>
  )
}
