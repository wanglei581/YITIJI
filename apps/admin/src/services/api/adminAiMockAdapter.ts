import type {
  AdminAiLogEntry, AdminAiUsage, AdminAiLogsQuery, AdminAiLogsResult, JobSourceQualitySummary,
  AiOperation, AiOperationCost,
} from './types'

/** 与后端 AiOperation 联合类型一一对应；漏一项会被 verify:ai-cost-coverage 拦下。 */
const ALL_AI_OPERATIONS: readonly AiOperation[] = [
  'parseResume', 'optimizeResume', 'adjustResumeLayout', 'generateResume',
  'chatAssistant', 'classifyIntent', 'jobRecommend', 'jobExplain', 'jobMatch',
  'careerPlan', 'fairVisitPlan', 'interviewQuestion', 'interviewReport',
  'voiceTranscribe', 'voiceSynthesize', 'selfAssessment', 'contractReview',
]

// ─── Mock 数据（仅元数据，无简历内容/聊天原文/文件名/fileId）──

const MOCK_LOG_ENTRIES: AdminAiLogEntry[] = [
  { taskId: 'mock-ai-1748260001-1',   operation: 'parseResume',   provider: 'mock', status: 'success', latencyMs: 82,    createdAt: '2026-05-26T14:52:01.000Z' },
  { taskId: 'mock-ai-1748260002-2',   operation: 'optimizeResume',provider: 'mock', status: 'success', latencyMs: 118,   createdAt: '2026-05-26T14:51:44.000Z' },
  { taskId: 'session-1748260003-ab3', operation: 'chatAssistant', provider: 'mock', status: 'success', latencyMs: 504,   createdAt: '2026-05-26T14:50:30.000Z' },
  { taskId: 'mock-ai-1748260004-4',   operation: 'parseResume',   provider: 'mock', status: 'success', latencyMs: 91,    createdAt: '2026-05-26T14:49:12.000Z' },
  { taskId: 'session-1748260005-cd5', operation: 'chatAssistant', provider: 'mock', status: 'success', latencyMs: 488,   createdAt: '2026-05-26T14:48:58.000Z' },
  { taskId: 'mock-ai-1748260006-6',   operation: 'optimizeResume',provider: 'mock', status: 'success', latencyMs: 127,   createdAt: '2026-05-26T14:47:33.000Z' },
  { taskId: 'mock-ai-1748260007-7',   operation: 'parseResume',   provider: 'mock', status: 'failed',  latencyMs: 30002, createdAt: '2026-05-26T14:46:21.000Z', errorCode: 'TIMEOUT' },
  { taskId: 'session-1748260008-ef8', operation: 'chatAssistant', provider: 'mock', status: 'success', latencyMs: 512,   createdAt: '2026-05-26T14:45:09.000Z' },
  { taskId: 'mock-ai-1748260009-9',   operation: 'parseResume',   provider: 'mock', status: 'success', latencyMs: 78,    createdAt: '2026-05-26T14:44:55.000Z' },
  { taskId: 'mock-ai-1748260010-10',  operation: 'optimizeResume',provider: 'mock', status: 'failed',  latencyMs: 15023, createdAt: '2026-05-26T14:43:40.000Z', errorCode: 'NotImplementedException' },
  { taskId: 'session-1748260011-gh11',operation: 'chatAssistant', provider: 'mock', status: 'success', latencyMs: 496,   createdAt: '2026-05-26T14:42:18.000Z' },
  { taskId: 'mock-ai-1748260012-12',  operation: 'parseResume',   provider: 'mock', status: 'success', latencyMs: 85,    createdAt: '2026-05-26T14:41:02.000Z' },
]

function computeUsage(entries: AdminAiLogEntry[]): AdminAiUsage {
  const total       = entries.length
  const successList = entries.filter((e) => e.status === 'success')
  const failList    = entries.filter((e) => e.status === 'failed')
  const avgLatencyMs = successList.length > 0
    ? Math.round(successList.reduce((s, e) => s + e.latencyMs, 0) / successList.length)
    : 0

  const errorCounts: Record<string, number> = {}
  for (const e of failList) {
    if (e.errorCode) errorCounts[e.errorCode] = (errorCounts[e.errorCode] ?? 0) + 1
  }

  // AI-COST-TRUTH：mock 数据全部来自 MockAiProvider —— 它不打任何上游，
  // 所以成本确定为 0（measuredCalls === calls），这是「成本为 0」态，
  // **不是**「未采集」态。两者在 UI 上必须长得不一样，mock 也不例外。
  const byOperation = Object.fromEntries(
    ALL_AI_OPERATIONS.map((op) => [op, entries.filter((e) => e.operation === op).length]),
  ) as Record<AiOperation, number>
  const costByOperation = Object.fromEntries(
    ALL_AI_OPERATIONS.map((op) => [op, { cny: 0, calls: byOperation[op], measuredCalls: byOperation[op] }]),
  ) as Record<AiOperation, AiOperationCost>

  return {
    providerName:    'MockAiProvider',
    totalCalls:      total,
    successCount:    successList.length,
    failCount:       failList.length,
    successRate:     total > 0 ? Math.round((successList.length / total) * 1000) / 10 : 0,
    avgLatencyMs,
    byOperation,
    errorDistribution: Object.entries(errorCounts).map(([code, count]) => ({ code, count })),
    tokenUsageTotals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    costByOperation,
    alerts: [],
    estimatedCostCny: 0,
    unmeasuredCalls: 0,
    costCollectionSince: '2026-08-17',
  }
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

export const adminAiMockAdapter = {
  async getAiUsage(): Promise<AdminAiUsage> {
    await delay()
    return computeUsage(MOCK_LOG_ENTRIES)
  },

  /**
   * mock 必须实现与后端**同样的服务端筛选语义**（先筛后切页，total 是匹配总数）。
   * 否则 mock 模式下页面看起来一切正常，切到 http 才暴露分页/计数不一致。
   */
  async getAiLogs(query: AdminAiLogsQuery = {}): Promise<AdminAiLogsResult> {
    await delay()
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const offset = Math.max(query.offset ?? 0, 0)
    const startAt = query.startAt ? Date.parse(query.startAt) : null
    const endAt = query.endAt ? Date.parse(query.endAt) : null
    const matched = MOCK_LOG_ENTRIES.filter((entry) => {
      if (query.operation && entry.operation !== query.operation) return false
      if (query.status && entry.status !== query.status) return false
      const at = Date.parse(entry.createdAt)
      if (startAt !== null && at < startAt) return false
      if (endAt !== null && at >= endAt) return false
      return true
    })
    return { total: matched.length, entries: matched.slice(offset, offset + limit), limit, offset }
  },

  async getAdminJobQualitySummary(): Promise<JobSourceQualitySummary[]> {
    await delay()
    return []
  },
}
