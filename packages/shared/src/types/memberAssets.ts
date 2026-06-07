// ============================================================
// 会员个人资产中心 — 只读列表类型（Phase C-2B）
//
// 合规约束（所有资产列表必须遵守，CLAUDE.md §10/§11/§18）：
// - 只返回**归属于请求方本人**（endUserId）的资产；跨用户、匿名一律拒绝（后端 EndUserAuthGuard）。
// - 只返回**元数据**：绝不返回简历原文 / AI payload(payloadJson) / PII / 文件内容 /
//   storageKey / sha256 / accessTokenHash 等敏感字段。
// - 文件资产只给元数据 + 「必要的临时访问能力」：列表回传换取短期签名 URL 的端点路径，
//   会员凭本人 token 调用后才拿到 TTL 受控的下载/预览 URL（不在列表里直接签发，尊重 TTL）。
// - 空列表返回 []，不伪造数量。
// ============================================================

import type { AiTaskStatus } from './ai'

/** 我的简历：会员名下 AI 解析过的简历版本（一条 = 一个解析任务，仅元数据）。 */
export interface MemberResumeItem {
  /** AiResumeResult(parse) 行 id */
  id: string
  /** AI 任务 id（用于带本人 token 读回结果，结果读取走既有 /resume/records） */
  taskId: string
  status: AiTaskStatus
  provider: string
  /** 是否已生成优化版（同 taskId 是否存在 optimize 行） */
  optimized: boolean
  createdAt: string
  updatedAt: string
  /** 留存到期时间；到期后被清理治理移除，列表不再返回 */
  expiresAt: string | null
}

/** 我的文档：会员名下文件资产（仅元数据 + 临时访问端点路径，无文件内容）。 */
export interface MemberDocumentItem {
  /** FileObject id */
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  purpose: string
  sensitiveLevel: string
  createdAt: string
  expiresAt: string
  /** 临时访问能力：会员凭本人 token 调此端点换取短期签名下载 URL（不在列表直接签发） */
  downloadUrlPath: string
  /** 临时访问能力：换取短期签名预览 URL */
  previewUrlPath: string
}

/** AI 服务记录：会员名下 AI 解析 / 优化调用历史（仅元数据，不含 payload）。 */
export interface MemberAiRecordItem {
  /** AiResumeResult 行 id */
  id: string
  taskId: string
  kind: 'parse' | 'optimize'
  status: AiTaskStatus
  provider: string
  createdAt: string
  expiresAt: string | null
}
