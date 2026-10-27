import type { InterviewDifficulty, InterviewDuration, InterviewerType } from '@ai-job-print/shared'
import { Button } from '@ai-job-print/ui'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { UploadSessionQrPanel } from '../upload/components/UploadSessionQrPanel'
import { ResumeUsbImportPanel } from '../resume/components/ResumeUsbImportPanel'
import { InterviewNote } from './interviewQxParts'

type ResumeChannel = 'phone' | 'usb' | 'desktop'

/** 第 2 步：五位面试官整行点选，下面难度、时长各一排。 */
export function InterviewSetupPersonas({
  interviewers,
  interviewerType,
  onInterviewer,
  difficulties,
  difficulty,
  onDifficulty,
  durations,
  duration,
  onDuration,
}: {
  interviewers: Array<{ key: InterviewerType; label: string; desc: string; mark: string }>
  interviewerType: InterviewerType
  onInterviewer: (key: InterviewerType) => void
  difficulties: Array<{ key: InterviewDifficulty; label: string; desc: string }>
  difficulty: InterviewDifficulty
  onDifficulty: (key: InterviewDifficulty) => void
  durations: Array<{ key: InterviewDuration; label: string; desc: string }>
  duration: InterviewDuration
  onDuration: (key: InterviewDuration) => void
}) {
  return (
    <>
      <div className="qxt-iv-personas" role="group" aria-label="面试官类型">
        {interviewers.map((item) => (
          <button
            key={item.key}
            type="button"
            className="qxt-iv-persona"
            aria-pressed={interviewerType === item.key}
            aria-label={item.label}
            onClick={() => onInterviewer(item.key)}
          >
            <span className="qxt-iv-av" aria-hidden="true">{item.mark}</span>
            <span><b>{item.label}</b><small>{item.desc}</small></span>
            <span className="qxt-iv-tick" aria-hidden="true">
              {interviewerType === item.key ? <QxTouchIcon name="check" size={28} strokeWidth={2.6} /> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="qxt-iv-sec">难度</div>
      <div className="qxt-iv-seg" role="group" aria-label="难度">
        {difficulties.map((item) => (
          <button key={item.key} type="button" aria-pressed={difficulty === item.key} onClick={() => onDifficulty(item.key)}>{item.label}</button>
        ))}
      </div>
      <div className="qxt-iv-sec">时长</div>
      <div className="qxt-iv-seg" role="group" aria-label="时长">
        {durations.map((item) => {
          const [main, sub] = item.label.split(' / ')
          return (
            <button key={item.key} type="button" aria-pressed={duration === item.key} aria-label={item.label} onClick={() => onDuration(item.key)}>
              {main}
              {sub ? <small>{sub}</small> : null}
            </button>
          )
        })}
      </div>
    </>
  )
}

/** 第 3 步的简历来源：选一条来源才去取文件，不上传也能开始。 */
export function InterviewSetupResume({
  resumeFile,
  onClearResume,
  resumeChannel,
  onResumeChannel,
  kiosk,
  uploading,
  onPickFile,
  onUploaded,
  onQrBusy,
  onUsbBusy,
}: {
  resumeFile: { fileId: string; name: string } | null
  onClearResume: () => void
  resumeChannel: ResumeChannel | null
  onResumeChannel: (channel: ResumeChannel | null) => void
  kiosk: boolean
  uploading: boolean
  onPickFile: () => void
  onUploaded: (file: { fileId: string; name: string }) => void
  onQrBusy: (busy: boolean) => void
  onUsbBusy: (busy: boolean) => void
}) {
  if (resumeFile) {
    return (
      <InterviewNote lead="已选用 1 份">
        <span>{resumeFile.name}</span>
        <span>这场练习会用这份简历出题</span>
        <span>移除后按通用问题练习，不会因此少一道题。</span>
        <button type="button" className="qxt-iv-wide" onClick={onClearResume}>
          <b>移除，不用简历</b>
        </button>
      </InterviewNote>
    )
  }
  const channels = ([
    { key: 'phone' as const, label: '手机扫码上传', hint: '把简历传到这台机器' },
    { key: 'usb' as const, label: 'U 盘导入', hint: '只读取你插入的这只盘' },
    { key: 'desktop' as const, label: '本机文件', hint: '从这台设备里选一份' },
  ]).filter((channel) => channel.key !== 'desktop' || !kiosk)
  return (
    <>
      <div className="qxt-iv-src" role="group" aria-label="简历来源">
        {channels.map((channel) => (
          <button
            key={channel.key}
            type="button"
            aria-pressed={resumeChannel === channel.key}
            onClick={() => onResumeChannel(resumeChannel === channel.key ? null : channel.key)}
          >
            <b>{channel.label}</b>
            <small>{channel.hint}</small>
          </button>
        ))}
      </div>
      {resumeChannel === 'phone' ? (
        <div className="qxt-iv-panel">
          <UploadSessionQrPanel
            purpose="resume_upload"
            title="手机扫码上传简历"
            description="手机只负责上传；这台机器确认后才会带进本次练习。不上传也可以开始。"
            confirmLabel="确认使用这份简历"
            onUploaded={onUploaded}
            onBusyChange={onQrBusy}
          />
        </div>
      ) : resumeChannel === 'usb' ? (
        <div className="qxt-iv-panel">
          <ResumeUsbImportPanel onUploaded={onUploaded} onBusyChange={onUsbBusy} />
        </div>
      ) : resumeChannel === 'desktop' && !kiosk ? (
        <div className="qxt-iv-panel">
          <Button variant="secondary" className="min-h-[64px] w-full text-base" disabled={uploading} onClick={onPickFile}>
            选择本设备上的文件
          </Button>
        </div>
      ) : (
        <p className="qxt-iv-sec">
          {uploading
            ? '正在上传。完成前不把这份文件算进本场练习。'
            : '不上传也能开始。选一条来源，本机才会去取文件。没有简历时按通用问题练习，不会因此少一道题。'}
        </p>
      )}
    </>
  )
}
