import { useId } from 'react'

/**
 * 正文里的整行按钮（稿里的次出口都是这个样子）。
 * 读屏名只取标题；说明挂在 aria-describedby 上，所以按名字找（「取消扫描」「先登录再转换」）
 * 不会被说明文字拖长。
 */
export function FsRow({
  title,
  desc,
  onClick,
  disabled,
  ariaDisabled,
  testId,
}: {
  title: string
  desc?: string
  onClick: () => void
  disabled?: boolean
  /** 只写 aria-disabled、不写原生 disabled：按钮仍可点，由页面自己说明为什么不继续。 */
  ariaDisabled?: boolean
  testId?: string
}) {
  const descId = useId()
  return (
    <button
      type="button"
      className="fs-row"
      disabled={disabled}
      aria-disabled={ariaDisabled ? true : undefined}
      aria-label={title}
      aria-describedby={desc ? descId : undefined}
      data-testid={testId}
      onClick={onClick}
    >
      <span>
        <b>{title}</b>
        {desc ? <small id={descId}>{desc}</small> : null}
      </span>
    </button>
  )
}
