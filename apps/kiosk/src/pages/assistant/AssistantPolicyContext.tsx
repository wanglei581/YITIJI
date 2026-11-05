import type { AssistantPolicyContext } from '../../services/assistantDraft'

export function AssistantPolicyMarker({ context, onClear }: {
  context: AssistantPolicyContext | null; onClear: () => void
}) {
  if (!context) return null
  return (
    <aside className="qxp-card" aria-label="当前政策讲解" style={{ fontSize: 20, padding: 20, margin: '0 40px', flexShrink: 0 }}>
      <p style={{ fontSize: 20, overflowWrap: 'anywhere' }}>按《{context.title || '这条政策'}》原文讲解 · 不判断能不能领</p>
      <button type="button" className="assistant-direct-question" onClick={onClear}
        style={{ minHeight: 64, minWidth: 64, fontSize: 20 }}>不按这条讲了</button>
    </aside>
  )
}
