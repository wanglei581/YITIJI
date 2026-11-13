import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AssistantSessionSummaryResponse } from '@ai-job-print/shared'
import { summarizeAssistantSession } from '../../services/api'
import { AI_QUOTA_EXHAUSTED_ASSISTANT_COPY, errorCodeOf } from '../../services/api/userErrorMessage'
import { advisorDisplayText, advisorErrorMessage, advisorUserReason } from './advisorUserCopy'

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
  const navigate = useNavigate()
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
      // 2026-11-08 起保存后留在本页显示结果，不再跳小青作业面；
      // 作业面那条路由只留给「我的 → AI 服务记录」打开旧的小青作业。
      const saved = await summarizeAssistantSession(sessionId, token)
      setResult(saved)
    } catch (err) {
      setError(errorCodeOf(err) === 'AI_QUOTA_EXHAUSTED'
        ? AI_QUOTA_EXHAUSTED_ASSISTANT_COPY
        : advisorErrorMessage(err, '本次要点暂时保存不了，请稍后重试'))
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
        <strong>{busy ? '正在保存…' : '保存这次回答的要点'}</strong>
        <small>{loggedIn ? '存进我的文档，可打印' : '登录后才能保存'}</small>
      </button>
      {blockedReason && <p className="assistant-summary-reason" role="status">{blockedReason}</p>}
      {error && <p className="assistant-summary-reason" role="status">{error}</p>}
      {result && (
        <div className="assistant-summary-result" role="status">
          <p>
            {result.document
              ? '本次要点已保存到我的文档，可打印。'
              : `本次要点已保存。${advisorUserReason(result.printUnavailableReason, '打印稿尚未生成。')}`}
          </p>
          {result.document ? (
            <button type="button" className="assistant-tool-button assistant-summary-print" onClick={() => navigate('/me/documents')}>去「我的文档」打印</button>
          ) : null}
          {result.highlights.length > 0 && (
            <ol>
              {result.highlights.map((item) => <li key={item}>{advisorDisplayText(item)}</li>)}
            </ol>
          )}
          {result.todos.length > 0 && (
            <ul>
              {result.todos.map((item) => <li key={item}>{advisorDisplayText(item)}</li>)}
            </ul>
          )}
          <p className="assistant-summary-disclaimer">{advisorUserReason(result.disclaimer, '内容请本人核对后使用')}。不构成录用、薪资或办理结果的承诺。</p>
        </div>
      )}
    </div>
  )
}
