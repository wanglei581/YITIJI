// 报告生成不了时「带走本场问答」：作答区操作行与到点停住屏共用。生成、预览、扫码保存见 useInterviewTakeaway。

import { printInterviewTranscript, type InterviewAccess } from '../../services/api/interview'
import { useInterviewTakeaway } from './useInterviewTakeaway'

/**
 * 报告生成不了时，把本场题目和本人提交过的回答带走。
 * 只在本页亲眼见过非跳过的回答提交成功时由调用方渲染（服务端同样要求至少一条回答）。
 */
export function InterviewTranscriptTakeaway({
  sessionId,
  getAccess,
  disabled,
  look,
}: {
  sessionId: string
  getAccess: () => InterviewAccess
  disabled?: boolean
  /** wide：整行说明按钮（到点停住屏）；act：操作行里的一颗按钮（作答区）。 */
  look: 'wide' | 'act'
}) {
  const takeaway = useInterviewTakeaway('interview_practice')
  const go = () => void takeaway.open(() => printInterviewTranscript(sessionId, getAccess()), '本场问答没有生成，请稍后再试')
  const label = takeaway.busy ? '正在生成本场问答…' : '带走本场问答'
  return (
    <>
      {look === 'wide' ? (
        <button type="button" className="qxt-iv-wide" data-testid="interview-transcript-takeaway" disabled={disabled || takeaway.busy} onClick={go}>
          <b>{label}</b>
          <small>不需要 AI：题目和你提交过的回答生成一份 PDF，可以打印，也可以用本人手机扫码保存。</small>
        </button>
      ) : (
        <button type="button" data-testid="interview-transcript-takeaway" disabled={disabled || takeaway.busy} onClick={go}>
          {label}
        </button>
      )}
      {takeaway.error ? <p className="qxt-iv-err" role="alert">{takeaway.error}</p> : null}
      {takeaway.dialog}
    </>
  )
}
