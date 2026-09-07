type LeaveAction = () => void

export function ResumeOptimizeLeaveDialog(props: {
  guest: boolean
  onStay: () => void
  onLeave: LeaveAction
}) {
  return (
    <div className="qx-rd-overlay">
      <div className="qx-rd-leave">
        <p>离开前确认</p>
        <p>
          {props.guest
            ? '未登录，草稿不会保存。未导出 PDF 前离开，本次编辑内容不会保存。'
            : '还有未同步到草稿的改动。离开后本机改动会丢失。'}
        </p>
        <div className="qx-rd-leave-actions">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onStay}>继续编辑</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={props.onLeave}>确认离开</button>
        </div>
      </div>
    </div>
  )
}
