import type { ReactNode } from 'react'
import { AiDeclarationNote } from '../../../ai/AiDeclarationNote'
import { QxAiHelp, QxStepActions } from '../../../components/qingxu/QxAiHelp'
import type { ResumeScreen } from './resumeSourceModel'
import { ResumeSourceActions } from './ResumeSourceActions'

type Frame = ResumeScreen | 'unknown'

/** 来源页底栏。确认屏次按钮用稿上的「换一份文件」。 */
export function ResumeSourceCta(props: {
  screen: Frame
  intent: 'diagnose' | 'optimize'
  uploadBusyPanel: boolean
  uploading: boolean
  error: boolean
  uploadUnknown: boolean
  uploadRecheck: boolean
  sourceBusy: boolean
  genericDiagnosis: boolean
  hasFile: boolean
  helpLine: string
  contextPrimary: string
  industryPrimary: string
  changeFileLabel: string
  onService: () => void
  onGeneric: () => void
  onOpenDirection: () => void
  onRemember: (screen: ResumeScreen) => void
  onPickFile: () => void
  onRetry: () => void
  onLeaveUnknown: () => void
  onLeavePage: () => void
  onRecheck: () => void
  onRevertIndustry: () => void
  onChangeFile: () => void
  onStart: () => void
  onHome: () => void
}): ReactNode {
  const { screen } = props
  return (
    <>
      <QxStepActions onPrev={props.onService}>
        <QxAiHelp label="问小青：帮我选诊断重点 →" draft="请先问我的求职方向，帮我选择这次简历诊断应重点看的部分。" />
      </QxStepActions>
      {screen === 'source' && !props.uploadBusyPanel ? (
        <ResumeSourceActions disabled={props.sourceBusy} onGeneric={props.onGeneric} onOpenWorkbench={props.onOpenDirection} />
      ) : null}
      {screen === 'source' && props.uploading ? <p className="qx-rt-ctxstrip">{props.helpLine}</p> : null}
      {screen === 'source' && props.error ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onPickFile}>{props.changeFileLabel}</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={props.onRetry}>重试上传</button>
        </>
      ) : null}
      {screen === 'source' && (props.uploadUnknown || props.uploadRecheck) ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onLeaveUnknown}>换一种来源</button>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onLeavePage}>先离开这一步</button>
          {props.uploadUnknown && !props.uploadRecheck ? (
            <button type="button" className="qx-btn" data-variant="primary" onClick={props.onRecheck}>再查刚才这一次的结果</button>
          ) : <p className="qx-rt-ctxstrip">{props.helpLine}</p>}
        </>
      ) : null}
      {screen === 'unknown' ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onHome}>回首页</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => props.onRemember('source')}>返回来源选择</button>
        </>
      ) : null}
      {screen === 'target' ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => props.onRemember('source')}>回到来源选择</button>
          <button type="button" className="qx-btn resume-primary-action" data-variant="primary" onClick={() => props.onRemember(props.genericDiagnosis ? 'source' : 'target-context')}>
            {props.genericDiagnosis ? '通用诊断，直接回来源选择' : '下一步：设目标岗位与背景'}
          </button>
        </>
      ) : null}
      {(screen === 'target-context' || screen === 'target-profile') ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => props.onRemember('target')}>上一步：诊断范围</button>
          <button type="button" className="qx-btn resume-primary-action" data-variant="primary" onClick={() => props.onRemember(props.hasFile ? 'summary' : 'source')}>
            {props.contextPrimary}
          </button>
        </>
      ) : null}
      {screen === 'target-industry' ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onRevertIndustry}>不改了，返回</button>
          <button type="button" className="qx-btn resume-primary-action" data-variant="primary" onClick={() => props.onRemember('target-context')}>{props.industryPrimary}</button>
        </>
      ) : null}
      {screen === 'summary' && props.hasFile ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onOpenDirection}>改诊断方向</button>
          <button type="button" className="qx-btn resume-change-file" data-variant="ghost" disabled={props.sourceBusy} onClick={props.onChangeFile}>{props.changeFileLabel}</button>
          <span className="qx-ai-declaration-slot">
            <button type="button" className="qx-btn resume-primary-action" data-variant="primary" disabled={props.sourceBusy} onClick={props.onStart}>
              {props.intent === 'optimize' ? 'AI 优化，看改进建议' : 'AI 诊断，看改进建议'}
            </button>
            <AiDeclarationNote />
          </span>
        </>
      ) : null}
    </>
  )
}
