// KioskNumPad — 触控数字键盘（L2-4B）
//
// - 所有输入由此组件驱动，配套 input 必须设置 readOnly + inputMode="none"
// - 每个按键触控区域 ≥ 72px，满足 CLAUDE.md §8 触控规范
// - 不使用 type="number" / type="tel"，不触发系统软键盘
// - onConfirm 存在时渲染第 12 格确认键（蓝色），否则渲染空格占位

import { Delete } from 'lucide-react'

interface KioskNumPadProps {
  value: string
  maxLength: number
  onChange: (value: string) => void
  onConfirm?: () => void
  confirmDisabled?: boolean
  confirmLabel?: string
  className?: string
}

export function KioskNumPad({
  value,
  maxLength,
  onChange,
  onConfirm,
  confirmDisabled = false,
  confirmLabel = '确认',
  className = '',
}: KioskNumPadProps) {
  const handleDigit = (digit: string) => {
    if (value.length < maxLength) {
      onChange(value + digit)
    }
  }

  const handleBackspace = () => {
    onChange(value.slice(0, -1))
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div className={`grid grid-cols-3 gap-3 ${className}`}>
      {digits.map((d) => (
        <button
          key={d}
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            handleDigit(d)
          }}
          className="flex min-h-[72px] items-center justify-center rounded-xl border border-neutral-200 bg-white text-[1.5rem] font-semibold text-neutral-800 shadow-sm transition-colors active:bg-neutral-100"
          aria-label={d}
        >
          {d}
        </button>
      ))}

      {/* 第 10 格：退格 */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault()
          handleBackspace()
        }}
        disabled={value.length === 0}
        className="flex min-h-[72px] items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors active:bg-neutral-100 disabled:opacity-30"
        aria-label="删除"
      >
        <Delete className="h-6 w-6" />
      </button>

      {/* 第 11 格：0 */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault()
          handleDigit('0')
        }}
        className="flex min-h-[72px] items-center justify-center rounded-xl border border-neutral-200 bg-white text-[1.5rem] font-semibold text-neutral-800 shadow-sm transition-colors active:bg-neutral-100"
        aria-label="0"
      >
        0
      </button>

      {/* 第 12 格：确认（可选）或空占位 */}
      {onConfirm ? (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            if (!confirmDisabled) onConfirm()
          }}
          disabled={confirmDisabled}
          className="flex min-h-[72px] items-center justify-center rounded-xl bg-primary-600 text-base font-semibold text-white shadow-sm transition-colors active:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={confirmLabel}
        >
          {confirmLabel}
        </button>
      ) : (
        <div aria-hidden="true" />
      )}
    </div>
  )
}
