import { QxTouchOverlay } from '../../../../components/qingxu/touch/QxTouchOverlay'

type LeaveAction = () => void

/**
 * 离开前确认（触屏弹层）：弹层打开时背后整屏不可点，遮罩不关闭。
 * 主按钮是「继续编辑」，误碰不会丢掉改动。
 */
export function ResumeOptimizeLeaveDialog(props: {
  guest: boolean
  onStay: () => void
  onLeave: LeaveAction
}) {
  return (
    <QxTouchOverlay
      kind="dialog"
      title="离开前确认"
      onClose={props.onStay}
      actions={(
        <>
          <button type="button" className="qxt-btn qxt-btn-pri" onClick={props.onStay}>继续编辑</button>
          <button type="button" className="qxt-btn qxt-btn-sec" onClick={props.onLeave}>确认离开</button>
        </>
      )}
    >
      <p>
        {props.guest
          ? '未登录，草稿不会保存。未导出 PDF 前离开，本次编辑内容不会保存。'
          : '还有未同步到草稿的改动。离开后本机改动会丢失。'}
      </p>
    </QxTouchOverlay>
  )
}
