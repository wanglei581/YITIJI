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

/**
 * 游标分页响应（Phase C-2D，所有 /me/* 列表统一形状）。
 * - cursor 为上一页最后一条的行 id；首页不传。
 * - pageSize 默认 20，服务端封顶 50；后端绝不做无界 findMany。
 */
export interface MemberAssetPage<T> {
  items: T[]
  /** 同条件下的真实总条数（头部统计用） */
  total: number
  /** 还有下一页时为下一页游标（最后一条 id）；否则 null */
  nextCursor: string | null
}

/** AI 服务记录种类：解析 / 优化 / 生成（AI 生成简历绝不展示为「简历解析」）。 */
export type MemberAiRecordKind = 'parse' | 'optimize' | 'generate' | 'job_fit' | 'career_plan'

/** 我的简历：会员名下简历资产（上传解析 parse / AI 生成 generate，一条 = 一个任务，仅元数据）。 */
export interface MemberResumeItem {
  /** AiResumeResult 行 id */
  id: string
  /** AI 任务 id（用于带本人 token 读回结果，结果读取走既有 /resume/records 或 /resume/generate） */
  taskId: string
  /** 简历来源：parse=上传并诊断的简历；generate=AI 引导生成的简历 */
  kind: 'parse' | 'generate'
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

/** AI 服务记录：会员名下 AI 解析 / 优化 / 生成调用历史（仅元数据，不含 payload）。 */
export interface MemberAiRecordItem {
  /** AiResumeResult 行 id */
  id: string
  taskId: string
  kind: MemberAiRecordKind
  status: AiTaskStatus
  provider: string
  createdAt: string
  expiresAt: string | null
}

// ── 浏览 / 外部跳转记录（P1 闭环）─────────────────────────────────────────────
// 合规：只记录「浏览」和「打开来源平台入口」两类本人行为；
// 投递/预约结果以来源平台为准，本系统不记录、类型上也不存在这类字段。

export type ActivityTargetType = 'job' | 'job_fair' | 'policy' | 'company_profile' | 'fair_company'

/**
 * 外部跳转动作（只描述打开了哪类入口，不描述办理结果）：
 * external_apply=岗位/参展企业投递入口；external_appointment=招聘会预约入口；external_open=政策官方入口。
 */
export type ActivityJumpAction = 'external_apply' | 'external_appointment' | 'external_open'

/** 浏览记录条目（目标快照 + 时间，无任何状态字段）。 */
export interface MemberBrowseLogItem {
  id: string
  targetType: ActivityTargetType
  targetId: string
  targetTitle: string | null
  sourceName: string | null
  sourceUrl: string | null
  externalId: string | null
  createdAt: string
}

/** 外部跳转记录条目。 */
export interface MemberJumpLogItem extends MemberBrowseLogItem {
  action: ActivityJumpAction
}
