import type { InterviewDifficulty, InterviewDuration, InterviewerType } from '@ai-job-print/shared'
import { MonitorSmartphoneIcon, QrCodeIcon, UsbIcon } from 'lucide-react'
import { Button } from '@ai-job-print/ui'
import { UploadSessionQrPanel } from '../upload/components/UploadSessionQrPanel'
import { ResumeUsbImportPanel } from '../resume/components/ResumeUsbImportPanel'

type ResumeChannel = 'phone' | 'usb' | 'desktop'

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
  interviewers: Array<{ key: InterviewerType; label: string; desc: string }>
  interviewerType: InterviewerType
  onInterviewer: (key: InterviewerType) => void
  difficulties: Array<{ key: InterviewDifficulty; label: string; desc: string }>
  difficulty: InterviewDifficulty
  onDifficulty: (key: InterviewDifficulty) => void
  durations: Array<{ key: InterviewDuration; label: string; desc: string }>
  duration: InterviewDuration
  onDuration: (key: InterviewDuration) => void
}) {
  const difficultyItem = difficulties.find((item) => item.key === difficulty)
  const durationItem = durations.find((item) => item.key === duration)
  return (
    <>
      <p>面试官类型</p>
      <div className="qxt-iv-personas">
        {interviewers.map((item) => (
          <button
            key={item.key}
            type="button"
            className="qxt-iv-persona"
            aria-pressed={interviewerType === item.key}
            aria-label={item.label}
            onClick={() => onInterviewer(item.key)}
          >
            <span className="qxt-iv-av" aria-hidden="true">{item.label.slice(0, 1)}</span>
            <span><b>{item.label}</b><small>{item.desc}</small></span>
            <span aria-hidden="true">{interviewerType === item.key ? '已选' : ''}</span>
          </button>
        ))}
      </div>
      <p>难度</p>
      <div className="iv-chips">
        {difficulties.map((item) => (
          <button key={item.key} type="button" className="interview-option" aria-pressed={difficulty === item.key} onClick={() => onDifficulty(item.key)}>{item.label}</button>
        ))}
      </div>
      <p className="iv-hint">{difficultyItem?.desc}</p>
      <p>时长</p>
      <div className="iv-chips">
        {durations.map((item) => (
          <button key={item.key} type="button" className="interview-option" aria-pressed={duration === item.key} onClick={() => onDuration(item.key)}>{item.label}</button>
        ))}
      </div>
      <p className="iv-hint">{durationItem?.desc}。练习时长到了，只提示你点结束，不自动出报告。</p>
    </>
  )
}

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
  return (
    <>
      {resumeFile ? (
        <div className="iv-panel">
          <div className="iv-head"><b>{resumeFile.name}</b><span>这场练习会用这份简历出题</span></div>
          <p className="iv-copy">移除后按通用问题练习，不会因此少一道题。</p>
          <button type="button" className="qxt-iv-wide" onClick={onClearResume}>
            <b>移除，不用简历</b>
          </button>
        </div>
      ) : (
        <>
          <div className="iv-tabs" role="group" aria-label="简历来源">
            {([
              { key: 'phone' as const, label: '手机扫码上传', hint: '把简历传到这台机器', icon: QrCodeIcon },
              { key: 'usb' as const, label: 'U 盘导入', hint: '只读取你插入的这只盘', icon: UsbIcon },
              { key: 'desktop' as const, label: '本机文件', hint: '从这台设备里选一份', icon: MonitorSmartphoneIcon },
            ]).filter((channel) => channel.key !== 'desktop' || !kiosk).map((channel) => (
              <button
                key={channel.key}
                type="button"
                aria-pressed={resumeChannel === channel.key}
                onClick={() => onResumeChannel(resumeChannel === channel.key ? null : channel.key)}
              >
                <channel.icon className="h-4 w-4" aria-hidden="true" />
                <b>{channel.label}</b>
                <small>{channel.hint}</small>
              </button>
            ))}
          </div>
          <div className="iv-panel">
            {resumeChannel === 'phone' ? (
              <UploadSessionQrPanel
                purpose="resume_upload"
                title="手机扫码上传简历"
                description="手机只负责上传；这台机器确认后才会带进本次练习。不上传也可以开始。"
                confirmLabel="确认使用这份简历"
                onUploaded={onUploaded}
                onBusyChange={onQrBusy}
              />
            ) : resumeChannel === 'usb' ? (
              <ResumeUsbImportPanel onUploaded={onUploaded} onBusyChange={onUsbBusy} />
            ) : resumeChannel === 'desktop' && !kiosk ? (
              <Button variant="secondary" className="min-h-[64px] w-full text-base" disabled={uploading} onClick={onPickFile}>
                选择本设备上的文件
              </Button>
            ) : uploading ? (
              <p className="iv-copy">正在上传。完成前不把这份文件算进本场练习。</p>
            ) : (
              <p className="iv-copy">选一条来源，本机才会去取文件。没有简历时按通用问题练习，不会因此少一道题。</p>
            )}
          </div>
        </>
      )}
    </>
  )
}
