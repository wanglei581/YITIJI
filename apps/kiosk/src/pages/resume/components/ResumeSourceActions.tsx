interface ResumeSourceActionsProps {
  disabled?: boolean
  onGeneric: () => void
  onOpenWorkbench: () => void
}

/** 首屏底部两颗：留在本屏做通用诊断，或打开目标设置工作台。 */
export function ResumeSourceActions({ disabled = false, onGeneric, onOpenWorkbench }: ResumeSourceActionsProps) {
  return (
    <div className="qx-rt-source-actions" data-testid="resume-source-actions">
      <button type="button" className="qx-btn" data-variant="ghost" disabled={disabled} onClick={onGeneric}>
        先不设方向，按通用诊断
      </button>
      <button type="button" className="qx-btn resume-primary-action" data-variant="primary" disabled={disabled} onClick={onOpenWorkbench}>
        设置诊断方向与目标背景
      </button>
    </div>
  )
}
