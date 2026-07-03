import { useState } from 'react'
import { Button } from '@ai-job-print/ui'
import { MicIcon } from 'lucide-react'
import { ResumeTranscriptConfirmDialog } from './ResumeTranscriptConfirmDialog'

interface ResumeVoiceInputButtonProps {
  label: string
  disabled?: boolean
  onConfirm: (text: string) => void
}

export function ResumeVoiceInputButton({
  label,
  disabled,
  onConfirm,
}: ResumeVoiceInputButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <MicIcon className="h-4 w-4" />
        语音填写
      </Button>
      {open && (
        <ResumeTranscriptConfirmDialog
          label={label}
          onClose={() => setOpen(false)}
          onConfirm={(text) => {
            onConfirm(text)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}
