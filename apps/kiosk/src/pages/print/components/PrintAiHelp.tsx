import { useNavigate } from 'react-router-dom'
import '../styles/print-ai-help.css'

/** 顾问页草稿协议：只写入 sessionStorage，由用户在顾问页确认后才发送。 */
const ASSISTANT_DRAFT_KEY = 'kiosk-assistant-draft'

function rememberAssistantDraft(draft: string) {
  try {
    sessionStorage.setItem(ASSISTANT_DRAFT_KEY, draft)
  } catch {
    /* 写不进草稿也不拦离开；顾问页仍可自己提问。 */
  }
}

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
