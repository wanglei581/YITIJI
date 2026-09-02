// KioskNumpad — 一体机页内数字键盘。
//
// 为什么必须页内自带：公共终端在 Windows Edge / Chrome 全屏 Kiosk 下运行，
// `inputMode="numeric"` 只是移动端提示，桌面浏览器不会因此弹出任何软键盘；
// 而调用 Windows 触摸键盘（TabTip）会带出输入法设置入口，是公共终端的逃逸面，
// 也违反 CLAUDE.md §17「不出现系统级弹窗阻断流程」。
//
// 交互约定：
//   · 按键用 onPointerDown + preventDefault —— 不夺走输入框焦点，
//     扫码器（HID 键盘）与手输可以随时交替，不会互相打断。
//   · 只负责改字符串，不发请求、不做校验、不判定成败；
//     格式判据与提交仍由调用方原有逻辑决定。
//   · 触控目标 96px，满足 27 寸竖屏站立操作（主按钮 ≥56px、可点区 ≥48px）。
import './kiosk-numpad.css'

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function KioskNumpad({
  value,
  onChange,
  maxLength,
  disabled = false,
  label = '数字键盘',
}: {
  value: string
  onChange: (next: string) => void
  maxLength?: number
  disabled?: boolean
  label?: string
}) {
  const press = (next: string) => {
    if (disabled) return
    onChange(next)
  }

  const key = (
    text: string,
    onPress: () => void,
    extra?: { className?: string; ariaLabel?: string; disabled?: boolean },
  ) => (
    <button
      type="button"
      className={`knp-key${extra?.className ? ` ${extra.className}` : ''}`}
      disabled={disabled || extra?.disabled}
      aria-label={extra?.ariaLabel ?? text}
      onPointerDown={event => {
        event.preventDefault()
        onPress()
      }}
    >
      {text}
    </button>
  )

  return (
    <div className="knp" role="group" aria-label={label} data-testid="kiosk-numpad">
      {DIGITS.map(d =>
        key(d, () => {
          if (maxLength && value.length >= maxLength) return
          press(value + d)
        }),
      )}
      {key('清空', () => press(''), {
        className: 'knp-fn',
        ariaLabel: '清空',
        disabled: value.length === 0,
      })}
      {key('0', () => {
        if (maxLength && value.length >= maxLength) return
        press(value + '0')
      })}
      {key('删除', () => press(value.slice(0, -1)), {
        className: 'knp-fn knp-del',
        ariaLabel: '删除',
        disabled: value.length === 0,
      })}
    </div>
  )
}
