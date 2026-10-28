import type { ReactNode } from 'react'
import { KIcon } from '../../components/kiosk-icon'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { ArtBox, Card, Hit, Note } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusReport, IllusResume, IllusStack } from '../public-touch/PublicIllus'
import { CONSULTATION_TASKS, type ConsultationTask, type ToolboxAssistantScene } from './advisorScenes'

/** 主题卡右下角的小样，照稿：简历带批注、面试带报告、岗位带清单、入职一叠纸。 */
const TASK_ART: Record<ConsultationTask['id'], ReactNode> = {
  resume: <IllusResume w={160} annot />,
  interview: <IllusReport w={150} />,
  jobs: <IllusChecklist w={150} />,
  workplace: <IllusStack w={140} n={3} />,
}

/** 问题卡下面的小样，三张轮着用。 */
const QUESTION_ART: readonly ReactNode[] = [<IllusResume key="r" w={140} annot />, <IllusReport key="p" w={130} />, <IllusChecklist key="c" w={130} />]

interface Props {
  selectedTask: ConsultationTask | null
  /** URL intent 指向的专项场景（百宝箱、官方渠道里的「AI 求职方向探索」带进来）。 */
  scene?: ToolboxAssistantScene
  /** 选了主题后第一条说明（托管关闭时岗位主题会带一句「本终端未开放…」）。 */
  welcome: string
  questions: readonly string[]
  loading: boolean
  aiLocked: boolean
  /** 本机 AI 专项这一行的第二行字：8 项，还没问过时写「首轮提问后确认可用性」。 */
  toolsLine: string
  onSelect: (id: ConsultationTask['id']) => void
  onClear: () => void
  onQuestion: (question: string) => void
  onOpenTools: () => void
  onOpenManual: () => void
  onOpenActs: () => void
  onComplaint: () => void
}

/**
 * 触屏稿 xq 的三种待问形态：
 * 默认是「本机 AI 专项」一行 + 四张主题卡 + 两个按钮；选了主题是说明条 + 三张问题卡（点一下就发给小青）+ 三个按钮；
 * 专项场景是说明条 + 两张说明卡 + 三个按钮。已经问过之后由页面的对话区接手，不在这里。
 */
export function AssistantTaskPicker({
  selectedTask, scene, welcome, questions, loading, aiLocked, toolsLine,
  onSelect, onClear, onQuestion, onOpenTools, onOpenManual, onOpenActs, onComplaint,
}: Props) {
  const complaint = (
    <button type="button" className="assistant-complaint" onClick={onComplaint}>
      <strong>投诉 AI 内容</strong><small>对回答有异议走这里</small>
    </button>
  )
  const manual = (
    <button type="button" className="assistant-direct-question" onClick={onOpenManual}>
      <strong>不经过 AI，直接去办</strong><small>打印扫描、帮助、政策、简历</small>
    </button>
  )

  if (scene) {
    return (
      <section className="assistant-task-picker" data-mode="scene" aria-label="专项咨询">
        <QxTouchCallout kind="howto" icon="sparkle">{scene.welcome}</QxTouchCallout>
        <div className="qxp-pair assistant-scene-pair">
          <Card k="可以说" kAs="h2"><Note>{scene.placeholder}</Note><ArtBox><IllusChecklist w={200} /></ArtBox></Card>
          <Card k="结果怎么用" kAs="h2"><Note>{scene.disclaimer}</Note><ArtBox><IllusReport w={200} /></ArtBox></Card>
        </div>
        <div className="assistant-task-actions" data-cols="3">
          <button type="button" className="assistant-complaint" onClick={onClear}>
            <strong>重新选择主题</strong><small>回到四个咨询主题</small>
          </button>
          {manual}
          {complaint}
        </div>
      </section>
    )
  }

  if (selectedTask) {
    return (
      <section className="assistant-task-picker" data-mode="task" aria-label={`咨询主题：${selectedTask.label}`}>
        <QxTouchCallout kind="howto" icon="file">{welcome}</QxTouchCallout>
        <div className="assistant-quick-questions" aria-label="快捷问题">
          {questions.map((question, index) => (
            <button
              type="button"
              key={question}
              className="assistant-quick-question"
              data-testid={`cockpit-quick-${index}`}
              disabled={!aiLocked && loading}
              aria-disabled={aiLocked || undefined}
              onClick={() => onQuestion(question)}
            >
              <b>{question}</b>
              <small>点了就发给小青</small>
              <span className="assistant-quick-art" aria-hidden="true">{QUESTION_ART[index % QUESTION_ART.length]}</span>
            </button>
          ))}
        </div>
        <div className="assistant-task-actions" data-cols="3">
          <button type="button" className="assistant-direct-question" onClick={onOpenActs}>
            <strong>这一主题还能去哪</strong><small>打印、政策等入口</small>
          </button>
          <button type="button" className="assistant-complaint" onClick={onClear}>
            <strong>换一个主题</strong><small>回到四个咨询主题</small>
          </button>
          {complaint}
        </div>
      </section>
    )
  }

  return (
    <section className="assistant-task-picker" data-mode="grid" aria-label="咨询主题">
      <Hit
        className="assistant-tools-open"
        icon={<QxTouchIcon name="sparkle" size={32} />}
        title="本机 AI 专项"
        sub={toolsLine}
        chevron
        onClick={onOpenTools}
      />
      <div className="assistant-task-grid">
        {CONSULTATION_TASKS.map((task) => (
          <button type="button" className="assistant-task" key={task.id} onClick={() => onSelect(task.id)}>
            <span className="assistant-task-top">
              <span className="assistant-task-icon" aria-hidden="true"><KIcon name={task.icon} /></span>
              <span className="assistant-task-copy">
                <strong>{task.label}</strong>
                <small>{task.description}</small>
                <small>例如：{task.questions[0]}</small>
              </span>
            </span>
            <span className="assistant-task-art" aria-hidden="true">{TASK_ART[task.id]}</span>
          </button>
        ))}
      </div>
      <div className="assistant-task-actions">
        {manual}
        {complaint}
      </div>
    </section>
  )
}
