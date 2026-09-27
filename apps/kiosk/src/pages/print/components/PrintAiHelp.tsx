import { useNavigate } from 'react-router-dom'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import '../styles/print-ai-help.css'

/** 本步的「问小青」：把一句问题留给顾问页预填，由用户在顾问页确认后才发送。 */
export function PrintAiHelp({ label, draft }: { label: string; draft: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="qx-print-ai"
      onClick={() => {
        rememberAssistantDraft(draft)
        navigate('/assistant')
      }}
    >
      {label}
    </button>
  )
}
