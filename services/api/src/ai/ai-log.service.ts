import { Injectable } from '@nestjs/common'
import type { AiProviderName } from './interfaces/ai-provider.interface'

// ============================================================
// AI 日志服务
//
// 严格合规约束：
// - 只记录元数据（taskId / provider / latency / tokenUsage / cost / status）
// - 禁止记录：简历文本、优化建议内容、聊天消息原文、文件名、fileId
// ============================================================

export type AiOperation = 'parseResume' | 'optimizeResume' | 'chatAssistant' | 'classifyIntent'

export interface AiLogEntry {
  taskId: string
  // provider 标签：内置 provider 名，或真实大模型 `llm:<vendor>`
  provider: AiProviderName | string
  operation: AiOperation
  latencyMs: number
  status: 'success' | 'failed'
  tokenUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  estimatedCostCny?: number
  errorCode?: string
  createdAt?: string            // ISO string; set by record() if omitted
  // ❌ 以下字段禁止记录：
  // fileContent / resumeText / chatMessage / suggestions / sections / fileId / fileName
}

// ─── Admin 接口响应类型 ────────────────────────────────────────

export interface AdminAiUsage {
  providerName: string
  totalCalls: number
  successCount: number
  failCount: number
  successRate: number           // 0–100, one decimal
  avgLatencyMs: number          // success-only average, rounded
  byOperation: {
    parseResume: number
    optimizeResume: number
    chatAssistant: number
    classifyIntent: number
  }
  errorDistribution: Array<{ code: string; count: number }>
  estimatedCostCny: number      // always 0 for mock provider
}

export interface AdminAiLogsResult {
  total: number
  entries: AiLogEntry[]         // safe — no content fields in AiLogEntry
}

@Injectable()
export class AiLogService {
  private readonly logs: AiLogEntry[] = []

  record(entry: Omit<AiLogEntry, 'createdAt'>): void {
    const full: AiLogEntry = { ...entry, createdAt: new Date().toISOString() }
    this.logs.push(full)
    // Phase 7.6: 控制台结构化输出；后续接入 DB 时替换此处
    console.log('[AI-LOG]', JSON.stringify({
      taskId:           full.taskId,
      provider:         full.provider,
      operation:        full.operation,
      latencyMs:        full.latencyMs,
      status:           full.status,
      tokenUsage:       full.tokenUsage,
      estimatedCostCny: full.estimatedCostCny,
      errorCode:        full.errorCode,
      createdAt:        full.createdAt,
    }))
  }

  getUsage(providerName: string): AdminAiUsage {
    const entries       = this.logs
    const total         = entries.length
    const successList   = entries.filter((e) => e.status === 'success')
    const failList      = entries.filter((e) => e.status === 'failed')
    const avgLatencyMs  = successList.length > 0
      ? Math.round(successList.reduce((s, e) => s + e.latencyMs, 0) / successList.length)
      : 0

    const byOperation = {
      parseResume:    entries.filter((e) => e.operation === 'parseResume').length,
      optimizeResume: entries.filter((e) => e.operation === 'optimizeResume').length,
      chatAssistant:  entries.filter((e) => e.operation === 'chatAssistant').length,
      classifyIntent: entries.filter((e) => e.operation === 'classifyIntent').length,
    }

    const errorCounts: Record<string, number> = {}
    for (const e of failList) {
      if (e.errorCode) {
        errorCounts[e.errorCode] = (errorCounts[e.errorCode] ?? 0) + 1
      }
    }
    const errorDistribution = Object.entries(errorCounts).map(([code, count]) => ({ code, count }))

    return {
      providerName,
      totalCalls:     total,
      successCount:   successList.length,
      failCount:      failList.length,
      successRate:    total > 0 ? Math.round((successList.length / total) * 1000) / 10 : 0,
      avgLatencyMs,
      byOperation,
      errorDistribution,
      estimatedCostCny: 0,      // Phase 7: mock provider has no real token cost
    }
  }

  getLogs(limit = 100): AdminAiLogsResult {
    const sliced = this.logs.slice(-limit)
    return { total: this.logs.length, entries: sliced }
  }
}
