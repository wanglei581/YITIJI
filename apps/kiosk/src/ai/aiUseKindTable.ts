/**
 * 一体机请求路径 → 服务端 @AiUse 种类。
 * 由 apps/kiosk/scripts/verify-kiosk-ai-declaration.mjs 对照控制器源码；手改一条就会红。
 */
export type AiUseKind = 'generate' | 'voice' | 'export' | 'read' | 'exempt'

export interface AiUseRoute {
  method: string
  path: string
  kind: AiUseKind
}

export const AI_USE_ROUTES: readonly AiUseRoute[] = [
  { method: 'GET', path: '/advisor/availability', kind: 'read' },
  { method: 'POST', path: '/advisor/sessions', kind: 'generate' },
  { method: 'GET', path: '/advisor/sessions/:sessionId', kind: 'read' },
  { method: 'POST', path: '/advisor/sessions/:sessionId/artifacts/:artifactId/print', kind: 'export' },
  { method: 'POST', path: '/advisor/sessions/:sessionId/ask', kind: 'generate' },
  { method: 'POST', path: '/advisor/sessions/:sessionId/pins', kind: 'exempt' },
  { method: 'DELETE', path: '/advisor/sessions/:sessionId/pins/:pinId', kind: 'exempt' },
  { method: 'POST', path: '/advisor/sessions/:sessionId/run', kind: 'generate' },
  { method: 'PATCH', path: '/advisor/sessions/:sessionId/skill', kind: 'generate' },
  { method: 'POST', path: '/advisor/sessions/:sessionId/slots', kind: 'exempt' },
  { method: 'POST', path: '/assistant/chat', kind: 'generate' },
  { method: 'POST', path: '/assistant/daily-report', kind: 'generate' },
  { method: 'POST', path: '/assistant/sessions/:sessionId/summary', kind: 'generate' },
  { method: 'POST', path: '/assistant/voice', kind: 'voice' },
  { method: 'POST', path: '/contract-reviews', kind: 'generate' },
  { method: 'DELETE', path: '/contract-reviews/:id', kind: 'exempt' },
  { method: 'GET', path: '/contract-reviews/:id', kind: 'read' },
  { method: 'POST', path: '/contract-reviews/:id/confirm', kind: 'generate' },
  { method: 'POST', path: '/contract-reviews/:id/report', kind: 'generate' },
  { method: 'POST', path: '/contract-reviews/:id/report/keep', kind: 'export' },
  { method: 'GET', path: '/contract-reviews/consent-scope', kind: 'read' },
  { method: 'DELETE', path: '/contract-reviews/reports/:fileId', kind: 'exempt' },
  { method: 'GET', path: '/job-fairs/:fairId/visit-plan/:taskId', kind: 'read' },
  { method: 'POST', path: '/job-fairs/:fairId/visit-plan/:taskId', kind: 'generate' },
  { method: 'POST', path: '/job-fairs/:fairId/visit-plan/:taskId/print', kind: 'export' },
  { method: 'POST', path: '/job-materials/generate', kind: 'exempt' },
  { method: 'GET', path: '/job-materials/templates', kind: 'exempt' },
  { method: 'POST', path: '/jobs/:id/ai/explain', kind: 'generate' },
  { method: 'POST', path: '/jobs/:id/ai/match', kind: 'generate' },
  { method: 'POST', path: '/jobs/ai/recommendations', kind: 'generate' },
  { method: 'GET', path: '/kiosk/ai/capabilities', kind: 'read' },
  { method: 'POST', path: '/materials/tasks', kind: 'exempt' },
  { method: 'GET', path: '/materials/tasks/:id', kind: 'read' },
  { method: 'POST', path: '/materials/tasks/:id/pii-findings/decisions', kind: 'exempt' },
  { method: 'POST', path: '/materials/tasks/:id/manual-confirmation', kind: 'exempt' },
  { method: 'GET', path: '/materials/tasks/:id/print-param-suggestions', kind: 'read' },
  { method: 'GET', path: '/me/job-ai-sessions', kind: 'read' },
  { method: 'DELETE', path: '/me/job-ai-sessions/:id', kind: 'exempt' },
  { method: 'GET', path: '/me/mock-interviews', kind: 'read' },
  { method: 'DELETE', path: '/me/mock-interviews/:id', kind: 'exempt' },
  { method: 'POST', path: '/mock-interviews', kind: 'generate' },
  { method: 'GET', path: '/mock-interviews/:id', kind: 'read' },
  { method: 'POST', path: '/mock-interviews/:id/answer', kind: 'generate' },
  { method: 'POST', path: '/mock-interviews/:id/end', kind: 'generate' },
  { method: 'POST', path: '/mock-interviews/:id/practice-sheet', kind: 'export' },
  { method: 'GET', path: '/mock-interviews/:id/report', kind: 'read' },
  { method: 'POST', path: '/mock-interviews/:id/report/print', kind: 'export' },
  { method: 'POST', path: '/mock-interviews/:id/start', kind: 'generate' },
  { method: 'POST', path: '/mock-interviews/:id/transcribe', kind: 'voice' },
  { method: 'POST', path: '/mock-interviews/:id/transcript/print', kind: 'export' },
  { method: 'POST', path: '/mock-interviews/:id/turns/:idx/audio', kind: 'voice' },
  { method: 'GET', path: '/mock-interviews/capabilities/voice', kind: 'read' },
  { method: 'GET', path: '/resume/career-plan/:taskId', kind: 'read' },
  { method: 'POST', path: '/resume/career-plan/:taskId', kind: 'generate' },
  { method: 'POST', path: '/resume/career-plan/:taskId/print', kind: 'export' },
  { method: 'GET', path: '/resume/export/pricing', kind: 'read' },
  { method: 'POST', path: '/resume/generate', kind: 'generate' },
  { method: 'GET', path: '/resume/generate/:taskId', kind: 'read' },
  { method: 'POST', path: '/resume/generate/export', kind: 'export' },
  { method: 'POST', path: '/resume/job-fit', kind: 'generate' },
  { method: 'GET', path: '/resume/job-fit/:taskId', kind: 'read' },
  { method: 'POST', path: '/resume/job-fit/:taskId/print', kind: 'export' },
  { method: 'POST', path: '/resume/job-fit/consent', kind: 'read' },
  { method: 'DELETE', path: '/resume/job-fit/consent/:taskId', kind: 'exempt' },
  { method: 'GET', path: '/resume/job-fit/consent/:taskId', kind: 'read' },
  { method: 'POST', path: '/resume/parse', kind: 'generate' },
  { method: 'GET', path: '/resume/records/:taskId', kind: 'read' },
  { method: 'GET', path: '/resume/records/:taskId/draft', kind: 'read' },
  { method: 'PUT', path: '/resume/records/:taskId/draft', kind: 'exempt' },
  { method: 'POST', path: '/resume/records/:taskId/export', kind: 'export' },
  { method: 'POST', path: '/resume/records/:taskId/fact-check', kind: 'generate' },
  { method: 'POST', path: '/resume/records/:taskId/layout-adjust', kind: 'generate' },
  { method: 'GET', path: '/resume/records/:taskId/optimize', kind: 'generate' },
  { method: 'GET', path: '/resume/records/:taskId/versions', kind: 'read' },
  { method: 'POST', path: '/resume/self-assessment', kind: 'exempt' },
  { method: 'DELETE', path: '/resume/self-assessment/:taskId', kind: 'exempt' },
  { method: 'GET', path: '/resume/self-assessment/:taskId', kind: 'read' },
  { method: 'POST', path: '/resume/self-assessment/:taskId/append', kind: 'exempt' },
  { method: 'POST', path: '/resume/self-assessment/:taskId/print', kind: 'exempt' },
  { method: 'GET', path: '/resume/self-assessment/questions', kind: 'read' },
  { method: 'POST', path: '/resume/voice/transcribe', kind: 'voice' },
  { method: 'POST', path: '/trtc/session', kind: 'voice' },
  { method: 'POST', path: '/trtc/session/stop', kind: 'exempt' },
]

function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

function matches(pattern: string, path: string): boolean {
  const left = segments(pattern)
  const right = segments(path)
  if (left.length !== right.length) return false
  return left.every((part, index) => part.startsWith(':') || part === right[index])
}

function specificity(pattern: string): [number, number] {
  const parts = segments(pattern)
  const staticCount = parts.filter((part) => !part.startsWith(':')).length
  return [staticCount, pattern.length]
}

/** 静态段更多的规则优先，其次更长的路径。未登记返回 null。 */
export function lookupAiUseKind(method: string, path: string): AiUseKind | null {
  const verb = method.toUpperCase()
  let best: { kind: AiUseKind; score: [number, number] } | null = null
  for (const route of AI_USE_ROUTES) {
    if (route.method !== verb || !matches(route.path, path)) continue
    const score = specificity(route.path)
    if (
      !best
      || score[0] > best.score[0]
      || (score[0] === best.score[0] && score[1] > best.score[1])
    ) {
      best = { kind: route.kind, score }
    }
  }
  return best?.kind ?? null
}
