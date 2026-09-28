import { KIcon } from '../../components/kiosk-icon'
import { AdvisorSectionLabel } from './AdvisorConversation'
import { CONSULTATION_TASKS, type ConsultationTask } from './advisorScenes'
import { advisorDisplayText } from './advisorUserCopy'

interface Props {
  no: number
  composing: boolean
  input: string
  selectedTask: ConsultationTask | null
  contextLabel?: string
  questions: readonly string[]
  loading: boolean
  aiLocked: boolean
  onSelect: (id: ConsultationTask['id']) => void
  onClear: () => void
  onQuestion: (question: string) => void
}

/** 稿 05 默认态只铺快捷问题；旧页的主题功能收进可展开区域，不丢上下文。 */
export function AssistantTaskPicker({ no, composing, input, selectedTask, contextLabel, questions, loading, aiLocked, onSelect, onClear, onQuestion }: Props) {
  return (
    <section className="assistant-task-picker" aria-labelledby="assistant-task-title">
      <AdvisorSectionLabel no={no} id="assistant-task-title" title={composing ? '这条还没发出' : '点一下就能问'} hint={composing ? '改完按右下角发送' : '点完落进输入框，可以改'} />
      <details className="assistant-topic-choices">
        <summary>{contextLabel ? `当前主题：${contextLabel}` : '选择咨询主题'}</summary>
        <div className="assistant-task-grid">
          {CONSULTATION_TASKS.map((task) => (
            <button type="button" className="assistant-task" aria-pressed={selectedTask?.id === task.id} key={task.id} onClick={() => onSelect(task.id)}>
              <span className="assistant-task-icon" aria-hidden="true"><KIcon name={task.icon} /></span>
              <span className="assistant-task-copy"><strong>{task.label}</strong><small>{task.description}</small></span>
            </button>
          ))}
          <button type="button" className="assistant-direct-question" aria-pressed={!contextLabel} onClick={onClear}>
            <strong>直接提问</strong><small>不选主题</small>
          </button>
        </div>
      </details>
      {composing && (
        <div className="assistant-draft-card" data-testid="cockpit-draft">
          <p className="assistant-draft-head"><KIcon name="chat" />将要发送的内容</p>
          <p className="assistant-draft-text">{advisorDisplayText(input.trim())}</p>
        </div>
      )}
      <div className="assistant-quick-questions" aria-label="快捷问题">
        {questions.map((question, index) => (
          <button type="button" key={question} data-testid={`cockpit-quick-${index}`} disabled={!aiLocked && loading} aria-disabled={aiLocked || undefined} onClick={() => onQuestion(question)}>
            <span className="assistant-quick-icon" aria-hidden="true"><KIcon name="help" /></span>
            <span className="assistant-quick-text">{question}</span>
            <span className="assistant-quick-go" aria-hidden="true">{composing ? '替换输入框' : '填入输入框'}<KIcon name="arrow" /></span>
          </button>
        ))}
      </div>
    </section>
  )
}
