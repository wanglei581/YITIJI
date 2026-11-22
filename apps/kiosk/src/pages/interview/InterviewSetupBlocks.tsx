import type { ReactNode } from 'react'
import { EMPLOYMENT_INDUSTRY_SECTORS } from '@ai-job-print/shared'
import { KioskFilterPickerModal } from '../../components/KioskFilterPickerModal'
import { InterviewNote, InterviewStatus } from './interviewQxParts'
import type { InterviewAiState } from './useInterviewAiCapabilities'

export function InterviewIndustryModal({
  open,
  industry,
  onChange,
  onClear,
  onClose,
}: {
  open: boolean
  industry: string
  onChange: (value: string) => void
  onClear: () => void
  onClose: () => void
}) {
  return (
    <KioskFilterPickerModal
      open={open}
      title="选择面试行业"
      description="从就业行业清单里选一个，用来调整这套练习题的方向。"
      sections={[{
        id: 'industry',
        label: '行业门类',
        value: industry,
        allLabel: '尚未选择',
        allowEmpty: false,
        options: EMPLOYMENT_INDUSTRY_SECTORS.map((item) => ({ value: item.label, label: item.label })),
      }]}
      onChange={(_, value) => onChange(value)}
      onClear={onClear}
      onClose={onClose}
    />
  )
}

export function InterviewSetupConditions() {
  return (
    <InterviewStatus
      label="本场练习条件"
      items={[
        { k: '文字回答', v: '可用', tone: 'ok' },
        { k: '语音回答', v: '进入后检测' },
        { k: '练习报告', v: '完成后生成' },
      ]}
    />
  )
}

export function InterviewSetupTipsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="qxt-iv-wide" onClick={onClick}>
      <b>{label}</b>
      <small>公开的准备方法，不依赖 AI</small>
    </button>
  )
}

export function InterviewSetupCapabilityNote({
  mockState,
  aiOutage,
  creating,
  step,
  downNote,
}: {
  mockState: InterviewAiState
  aiOutage: string | null
  creating: boolean
  step: 1 | 2 | 3
  downNote: string
}) {
  if (mockState === 'available' || aiOutage || creating) return null
  return (
    <InterviewNote lead={mockState === 'checking' ? '正在确认 AI 面试能力' : '暂时不能开始 AI 面试'}>
      <span>
        {mockState === 'off'
          ? downNote
          : `${mockState === 'checking' ? '正在确认AI能力状态' : '暂时无法确认AI能力状态'}。${step === 3 ? '下面的「先看面试技巧」' : '「先看面试技巧」'}不依赖 AI，现在就能看。`}
      </span>
    </InterviewNote>
  )
}

export function InterviewSetupSummaryCard({
  position,
  industry,
  experienceLabel,
  interviewerLabel,
  difficultyLabel,
  durationLabel,
  onEditStep,
}: {
  position: string
  industry: string
  experienceLabel: string
  interviewerLabel?: string
  difficultyLabel?: string
  durationLabel?: string
  onEditStep: (step: 1 | 2) => void
}) {
  return (
    <div className="qxt-iv-sum">
      <div className="qxt-iv-sum-r">
        <span>岗位</span>
        <b>{position.trim() || '尚未选择'} · {industry || '尚未选择'} · {experienceLabel || '尚未选择'}</b>
        <button type="button" className="qxt-iv-edit" aria-label="改岗位与经验" onClick={() => onEditStep(1)}>改</button>
      </div>
      <div className="qxt-iv-sum-r">
        <span>面试官</span>
        <b>{interviewerLabel} · {difficultyLabel}</b>
        <button type="button" className="qxt-iv-edit" aria-label="改面试官与难度" onClick={() => onEditStep(2)}>改</button>
      </div>
      <div className="qxt-iv-sum-r">
        <span>时长</span>
        <b>{durationLabel}</b>
        <button type="button" className="qxt-iv-edit" aria-label="改时长" onClick={() => onEditStep(2)}>改</button>
      </div>
    </div>
  )
}

export function InterviewSetupStep2Note({
  echo,
  interviewerLabel,
  interviewerDesc,
  difficultyLabel,
  difficultyDesc,
  durationLabel,
}: {
  echo: string
  interviewerLabel?: string
  interviewerDesc?: string
  difficultyLabel?: string
  difficultyDesc?: string
  durationLabel?: string
}) {
  return (
    <InterviewNote lead={echo}>
      <span>这一场：{interviewerLabel}。{interviewerDesc}</span>
      <span>难度：{difficultyLabel}。{difficultyDesc}</span>
      <span>时长：{durationLabel}。时间到会自动结束。</span>
    </InterviewNote>
  )
}

export function InterviewSetupStep3Guide({ disclaimer }: { disclaimer: ReactNode }) {
  return (
    <InterviewNote lead="三步都在这一场里">
      <span>第 1 步 创建配置：记录岗位、难度和时长，不等于已经生成题目。</span>
      <span>第 2 步 逐题作答：文字始终可以作答；语音要转写后由你确认。</span>
      <span>第 3 步 生成练习报告：报告只在这场练习真正完成后生成。</span>
      <span>{disclaimer}</span>
    </InterviewNote>
  )
}
