import { useState } from 'react'
import { Button } from '@ai-job-print/ui'
import { MicIcon } from 'lucide-react'
import { ResumeTranscriptConfirmDialog } from './ResumeTranscriptConfirmDialog'
import { AiDeclarationNote } from '../../../ai/AiDeclarationNote'

interface ResumeVoiceInputButtonProps {
  label: string
  className?: string
  disabled?: boolean
  onConfirm: (text: string) => void
}

export function ResumeVoiceInputButton({
  label,
  className,
  disabled,
  onConfirm,
}: ResumeVoiceInputButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <span className="qx-ai-declaration-slot">
        <Button
          size="sm"
          variant="secondary"
          className={['gap-1.5', className].filter(Boolean).join(' ')}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <MicIcon className="h-4 w-4" />
          语音填写
        </Button>
        <AiDeclarationNote />
      </span>
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
