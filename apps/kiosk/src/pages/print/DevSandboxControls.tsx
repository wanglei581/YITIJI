interface DevSandboxControlsProps {
  onSimulate: (result: 'success' | 'failed') => void
}

/** 仅开发构建按需加载；正式产物不得包含此模块。 */
export default function DevSandboxControls({ onSimulate }: DevSandboxControlsProps) {
  return (
    <div className="flex gap-2 rounded-lg border border-dashed border-warning/40 bg-warning-bg/40 p-3">
      <span className="self-center text-xs text-warning-fg">[DEV] 沙箱模拟</span>
      <button
        onClick={() => onSimulate('success')}
        className="rounded-md border border-success/40 bg-success-bg px-3 py-1.5 text-xs text-success-fg"
      >
        模拟支付成功
      </button>
      <button
        onClick={() => onSimulate('failed')}
        className="rounded-md border border-error/40 bg-error-bg px-3 py-1.5 text-xs text-error-fg"
      >
        模拟支付失败
      </button>
    </div>
  )
}
