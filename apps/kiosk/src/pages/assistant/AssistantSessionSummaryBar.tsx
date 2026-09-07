import { useState } from 'react'
import type { AssistantSessionSummaryResponse } from '@ai-job-print/shared'
import { summarizeAssistantSession } from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'

interface AssistantSessionSummaryBarProps {
  sessionId: string
  canSave: boolean
  loggedIn: boolean
  token: string | null
}

export function AssistantSessionSummaryBar({
  sessionId,
  canSave,
  loggedIn,
  token,
}: AssistantSessionSummaryBarProps) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AssistantSessionSummaryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const blockedReason = !loggedIn
    ? '登录后可将本次要点保存到我的文档并打印。游客对话离场即清，不会写入账号。'
    : !canSave
      ? '先问小青至少一轮真实回答，才能保存本次要点。'
      : null

  const onSave = async () => {
    if (blockedReason || !token || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await summarizeAssistantSession(sessionId, token)
      setResult(saved)
    } catch (err) {
      setError(userMessageOf(err, '本次要点暂时保存不了，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="assistant-summary-bar">
      <button
        type="button"
        className="assistant-tool-button assistant-summary-save"
        aria-disabled={Boolean(blockedReason) || busy || undefined}
        onClick={() => { if (blockedReason || busy) return; void onSave() }}
      >
        {busy ? '正在保存…' : '保存本次要点'}
      </button>
      {blockedReason && <p className="assistant-summary-reason" role="status">{blockedReason}</p>}
      {error && <p className="assistant-summary-reason" role="status">{error}</p>}
      {result && (
        <div className="assistant-summary-result" role="status">
          <p>
            {result.document
              ? '本次要点已保存到我的文档，可打印。'
              : `本次要点已保存。${result.printUnavailableReason ?? '打印稿尚未生成。'}`}
          </p>
          {result.highlights.length > 0 && (
            <ol>
              {result.highlights.map((item) => <li key={item}>{item}</li>)}
            </ol>
          )}
          {result.todos.length > 0 && (
            <ul>
              {result.todos.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          <p className="assistant-summary-disclaimer">{result.disclaimer}。不构成录用、薪资或办理结果的承诺。</p>
        </div>
      )}
    </div>
  )
}
