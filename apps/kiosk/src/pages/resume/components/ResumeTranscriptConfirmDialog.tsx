import { useEffect, useRef, useState } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { CheckIcon, MicIcon, RotateCcwIcon, SquareIcon, XIcon } from 'lucide-react'
import { transcribeResumeVoice } from '../../../services/api'
import { startWavRecorder, type WavRecorder } from '../../../utils/wavRecorder'

const MAX_RECORD_SECONDS = 58

type VoiceDialogStatus = 'idle' | 'requesting_permission' | 'recording' | 'transcribing' | 'ready' | 'error'

interface ResumeTranscriptConfirmDialogProps {
  label: string
  onClose: () => void
  onConfirm: (text: string) => void
}

export function ResumeTranscriptConfirmDialog({
  label,
  onClose,
  onConfirm,
}: ResumeTranscriptConfirmDialogProps) {
  const recorderRef = useRef<WavRecorder | null>(null)
  const intervalRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const [status, setStatus] = useState<VoiceDialogStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    startedAtRef.current = null
  }

  const cancelRecorder = () => {
    if (recorderRef.current) {
      recorderRef.current.cancel()
      recorderRef.current = null
    }
    clearTimer()
  }

  const stopRecording = async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    clearTimer()
    setStatus('transcribing')
    setError(null)

    try {
      const audio = await recorder.stop()
      const result = await transcribeResumeVoice(audio)
      const text = result.text.trim()
      if (!text) {
        setStatus('error')
        setError('没有识别到有效文字，请重新录音或改用文字输入')
        return
      }
      setTranscript(text)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : '语音转写失败，请改用文字输入')
    }
  }

  const startRecording = async () => {
    cancelRecorder()
    setTranscript('')
    setError(null)
    setSeconds(0)
    setStatus('requesting_permission')

    try {
      const recorder = await startWavRecorder()
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setStatus('recording')
      intervalRef.current = window.setInterval(() => {
        if (!startedAtRef.current) return
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setSeconds(elapsed)
        if (elapsed >= MAX_RECORD_SECONDS) void stopRecording()
      }, 250)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : '麦克风不可用，请改用文字输入')
      cancelRecorder()
    }
  }

  const close = () => {
    cancelRecorder()
    onClose()
  }

  const confirm = () => {
    const text = transcript.trim()
    if (!text) return
    cancelRecorder()
    onConfirm(text)
  }

  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.cancel()
        recorderRef.current = null
      }
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      startedAtRef.current = null
    }
  }, [])

  const recording = status === 'recording'
  const busy = status === 'requesting_permission' || status === 'transcribing'
  const canConfirm = status === 'ready' && transcript.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true">
      <Card className="w-[min(640px,100%)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-gray-900">语音填写：{label}</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              语音仅用于本次转写，不保存原始音频；请确认文字后再写入表单。
            </p>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={close}
            aria-label="关闭语音填写"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            {!recording ? (
              <Button
                size="lg"
                className="gap-2"
                disabled={busy}
                onClick={() => void startRecording()}
              >
                <MicIcon className="h-5 w-5" />
                {status === 'requesting_permission' ? '等待麦克风授权…' : transcript ? '重新录音' : '开始录音'}
              </Button>
            ) : (
              <Button
                size="lg"
                variant="secondary"
                className="gap-2"
                onClick={() => void stopRecording()}
              >
                <SquareIcon className="h-5 w-5" />
                结束录音
              </Button>
            )}
            <span className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-gray-600">
              {recording ? `正在录音 ${seconds}s / ${MAX_RECORD_SECONDS}s` : '单次最多 58 秒'}
            </span>
            {status === 'transcribing' && (
              <span className="text-sm font-medium text-primary-700">正在转写，请稍候…</span>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">转写文字</span>
          <textarea
            className="h-40 w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-800 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="转写结果会显示在这里，可修改后再写入表单"
            value={transcript}
            disabled={busy || recording}
            onChange={(event) => setTranscript(event.target.value.slice(0, 2000))}
          />
        </label>

        <div className="mt-5 flex gap-3">
          <Button size="lg" variant="secondary" className="flex-1 gap-2" onClick={close}>
            <XIcon className="h-5 w-5" />
            取消
          </Button>
          {status === 'ready' && (
            <Button size="lg" variant="secondary" className="gap-2" onClick={() => void startRecording()}>
              <RotateCcwIcon className="h-5 w-5" />
              重录
            </Button>
          )}
          <Button size="lg" className="flex-[2] gap-2" disabled={!canConfirm} onClick={confirm}>
            <CheckIcon className="h-5 w-5" />
            确认写入
          </Button>
        </div>
      </Card>
    </div>
  )
}
